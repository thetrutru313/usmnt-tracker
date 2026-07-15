import { db, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Senior national-team caps/goals come from English Wikipedia's article
// infobox wikitext, not API-Football or Wikidata's structured claims.
//
// API-Football is club-focused and doesn't cover international career totals
// at all. ESPN's public site API was tried next, but its per-athlete
// endpoints only expose the *current* season's per-competition stats (e.g.
// "4 appearances" for this year's World Cup) — there's no career-total
// field, and rebuilding one would mean iterating every season since debut,
// unreliable across ESPN's undocumented API.
//
// Wikidata was tried after that — it models exactly the right relationship
// ("member of sports team" claim, P54, qualified by "number of matches
// played"/P1350 and goals/P1351) — but empirically many current senior
// internationals (e.g. Tyler Adams, Yunus Musah) have the P54 claim for the
// senior team with those qualifiers simply left blank, even though the same
// player's Wikipedia infobox has accurate, current numbers. Wikidata's
// claims lag; Wikipedia's infobox is the thing editors actually keep
// current, so it's used directly via {{Infobox football biography}}'s
// `nationalteamN`/`nationalcapsN`/`nationalgoalsN` parameters.
// ---------------------------------------------------------------------------

// Wikimedia's API etiquette asks for a descriptive User-Agent identifying the
// application and how to reach the operator, and will otherwise more
// aggressively rate-limit/block anonymous traffic.
const USER_AGENT = "USMNTTrackerSync/1.0 (Replit sports-tracker app; internal, low-volume use)";
const API_BASE = "https://en.wikipedia.org/w/api.php";

type PlayerRow = { id: number; name: string; wikipediaTitle: string | null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Empirically, anonymous traffic to Wikimedia's API from this environment
// gets 429'd/blocked quickly if requests aren't well spaced — observed with
// both Wikidata and Wikipedia while building this sync. Space every request
// out and back off (honoring Retry-After) rather than just pacing once up
// front.
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_RETRIES = 4;

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function wmFetch<T>(url: string, attempt = 0): Promise<T> {
  await throttle();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfterSec = Number(res.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : MIN_REQUEST_INTERVAL_MS * 2 ** (attempt + 1);
    logger.warn({ url, attempt, backoffMs }, "Wikipedia API rate-limited, backing off");
    await sleep(backoffMs);
    return wmFetch<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Wikipedia API request failed (${res.status}): ${url}`);
  return (await res.json()) as T;
}

interface QuerySearchResponse {
  query?: { pages?: Record<string, { pageid: number; title: string; revisions?: { slots: { main: { "*": string } } }[] }> };
}

/** Fetches the raw wikitext for up to 50 article titles in one call. */
async function fetchWikitextByTitles(titles: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    if (batch.length === 0) continue;
    const url = `${API_BASE}?action=query&titles=${encodeURIComponent(batch.join("|"))}&prop=revisions&rvprop=content&rvslots=main&format=json`;
    const json = await wmFetch<QuerySearchResponse>(url);
    for (const page of Object.values(json.query?.pages ?? {})) {
      const wikitext = page.revisions?.[0]?.slots.main["*"];
      if (wikitext) result.set(page.title, wikitext);
    }
  }
  return result;
}

/** Searches for a player's article and returns the top few candidates' titles + wikitext in one call. */
async function searchPlayerArticles(name: string): Promise<{ title: string; wikitext: string }[]> {
  const url = `${API_BASE}?action=query&generator=search&gsrsearch=${encodeURIComponent(`${name} soccer`)}&gsrlimit=3&prop=revisions&rvprop=content&rvslots=main&format=json`;
  const json = await wmFetch<QuerySearchResponse>(url);
  return Object.values(json.query?.pages ?? {})
    .map((page) => ({ title: page.title, wikitext: page.revisions?.[0]?.slots.main["*"] ?? "" }))
    .filter((p) => p.wikitext);
}

interface NationalTeamEntry {
  teamText: string;
  caps: number;
  goals: number;
}

/** Parses every `nationalteamN`/`nationalcapsN`/`nationalgoalsN` triple out of an {{Infobox football biography}}. */
function parseNationalTeamEntries(wikitext: string): NationalTeamEntry[] {
  const entries: NationalTeamEntry[] = [];
  const teamRe = /nationalteam(\d+)\s*=\s*([^\n|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = teamRe.exec(wikitext))) {
    const idx = m[1];
    const teamText = m[2].trim();
    const capsMatch = wikitext.match(new RegExp(`nationalcaps${idx}\\s*=\\s*(\\d+)`));
    const goalsMatch = wikitext.match(new RegExp(`nationalgoals${idx}\\s*=\\s*(\\d+)`));
    entries.push({ teamText, caps: capsMatch ? Number(capsMatch[1]) : 0, goals: goalsMatch ? Number(goalsMatch[1]) : 0 });
  }
  return entries;
}

/** Senior USMNT entries only — excludes any under-age youth national team entry (e.g. "United States men's national under-20 soccer team"). */
function seniorUsmntEntries(entries: NationalTeamEntry[]): NationalTeamEntry[] {
  return entries.filter((e) => /united states/i.test(e.teamText) && !/under-?\d/i.test(e.teamText));
}

function hasFootballInfobox(wikitext: string): boolean {
  return /\{\{\s*infobox\s+football\s+biography/i.test(wikitext);
}

function hasAnyUsNationalTeamEntry(wikitext: string): boolean {
  return /nationalteam\d+\s*=\s*[^\n|]*united states/i.test(wikitext);
}

/**
 * Resolves a Wikipedia article for a player not yet cached, by searching
 * "<name> soccer" and requiring the candidate be a football biography that
 * lists at least one United States national team appearance (senior or
 * youth) — the same "don't guess on ambiguity" posture as API-Football's
 * name-search fallback (see playerClubSync.ts): if none of the top few
 * search results confirm identity this way, the player is left unresolved
 * rather than risking a wrong attribution.
 */
async function resolvePlayerWikipediaArticle(player: PlayerRow): Promise<{ title: string; wikitext: string } | null> {
  try {
    const candidates = await searchPlayerArticles(player.name);
    const match = candidates.find((c) => hasFootballInfobox(c.wikitext) && hasAnyUsNationalTeamEntry(c.wikitext));
    if (!match) {
      logger.warn({ player: player.name, candidateCount: candidates.length }, "No confirmed Wikipedia football-biography match for national-team caps/goals sync");
      return null;
    }
    await db.update(playersTable).set({ wikipediaTitle: match.title }).where(eq(playersTable.id, player.id));
    return match;
  } catch (err) {
    logger.warn({ err, player: player.name }, "Wikipedia search failed while resolving national-team caps/goals");
    return null;
  }
}

function extractSeniorCapsAndGoals(wikitext: string): { caps: number; goals: number } {
  const senior = seniorUsmntEntries(parseNationalTeamEntries(wikitext));
  return {
    caps: senior.reduce((sum, e) => sum + e.caps, 0),
    goals: senior.reduce((sum, e) => sum + e.goals, 0),
  };
}

export interface NationalTeamSyncResult {
  playersChecked: number;
  playersResolved: number;
  playersUpdated: number;
  failures: number;
}

/**
 * Refreshes every tracked player's senior USMNT caps/goals from Wikipedia's
 * infobox. Players without a resolvable article, or without a senior-team
 * entry yet (uncapped prospects with only youth-team entries), end up with
 * 0/0 rather than a stale or fabricated number — matching the "graceful
 * gaps" requirement.
 */
export async function syncNationalTeamCapsAndGoals(): Promise<NationalTeamSyncResult> {
  const players: PlayerRow[] = await db
    .select({ id: playersTable.id, name: playersTable.name, wikipediaTitle: playersTable.wikipediaTitle })
    .from(playersTable);

  let playersResolved = 0;
  let failures = 0;
  const resolvedWikitext = new Map<number, string>();

  for (const player of players) {
    if (player.wikipediaTitle) continue;
    const result = await resolvePlayerWikipediaArticle(player);
    if (result) {
      player.wikipediaTitle = result.title;
      resolvedWikitext.set(player.id, result.wikitext);
      playersResolved++;
    } else {
      failures++;
    }
  }

  // Re-fetch every cached title in one batched call so already-resolved
  // players pick up new caps/goals too (that's the entire point of a
  // periodic sync — a player who gets called up or scores should show it,
  // not just the ones resolved for the first time this run).
  const titlesNeedingFetch = players.filter((p) => p.wikipediaTitle && !resolvedWikitext.has(p.id)).map((p) => p.wikipediaTitle!);
  let fetchedWikitext = new Map<string, string>();
  try {
    fetchedWikitext = await fetchWikitextByTitles(titlesNeedingFetch);
  } catch (err) {
    logger.warn({ err }, "Wikipedia batch wikitext fetch failed — previously-cached players' caps/goals left unchanged this run");
  }

  let playersUpdated = 0;
  for (const player of players) {
    if (!player.wikipediaTitle) continue;
    const wikitext = resolvedWikitext.get(player.id) ?? fetchedWikitext.get(player.wikipediaTitle);
    if (!wikitext) continue; // fetch failure or page renamed — leave existing value rather than wiping it
    const { caps, goals } = extractSeniorCapsAndGoals(wikitext);
    await db.update(playersTable).set({ nationalTeamCaps: caps, nationalTeamGoals: goals }).where(eq(playersTable.id, player.id));
    playersUpdated++;
  }

  const result = { playersChecked: players.length, playersResolved, playersUpdated, failures };
  logger.info(result, "National-team caps/goals sync complete");
  return result;
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Runs the sync immediately, then daily — no API key needed, Wikipedia's API is public. */
export function startNationalTeamSyncSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
  syncNationalTeamCapsAndGoals().catch((err) => logger.error({ err }, "Initial national-team caps/goals sync failed"));
  intervalHandle = setInterval(() => {
    syncNationalTeamCapsAndGoals().catch((err) => logger.error({ err }, "Scheduled national-team caps/goals sync failed"));
  }, intervalMs);
}

export function stopNationalTeamSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
