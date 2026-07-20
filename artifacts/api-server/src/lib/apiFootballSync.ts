import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, and, inArray, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  type AfFixture,
  FINISHED_STATUSES,
  mapStatus,
  reconcileClubFixtures,
  purgeStalePostponedFixtures,
} from "./fixtureReconciliation.js";

// Re-export so existing callers (usmntSync, playerStatsSync, etc.) keep working.
export { FINISHED_STATUSES };
export type { AfFixture, ReconcileClubFixturesInput } from "./fixtureReconciliation.js";
export { reconcileClubFixtures } from "./fixtureReconciliation.js";

const BASE_URL = "https://v3.football.api-sports.io";
// API-Football player statistics are typically not available until 15–30 min
// after a final whistle.  Both the hourly sweep and live poll wait this long
// before firing the post-match stats pipeline so they don't read empty data
// and leave match logs in a permanent "pending" state.
const POST_MATCH_STATS_DELAY_MINUTES = 35;
// Pro plan allows 30 requests/minute (1 every 2s). The original 7s interval
// was for the free plan (~10/min) and made 99-fixture USMNT syncs take
// 11+ minutes — longer than a typical server restart window — so writes
// never committed. Reduced to 2s to match the actual Pro plan limit.
const MIN_REQUEST_INTERVAL_MS = 2000;
const MAX_RETRIES = 2;

export function apiKey(): string {
  const key = process.env["API_FOOTBALL_KEY"];
  if (!key) throw new Error("API_FOOTBALL_KEY is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tracks the earliest time the *next* request is allowed to fire. This is a
// simple reservation queue rather than a "check-then-sleep-then-stamp" gate:
// the three sync schedules (club fixtures, club stats, USMNT) run on
// independent timers and can each call afFetch concurrently, and a single
// sync can itself fan out concurrent calls (e.g. Promise.all across season
// years). If throttle() read `nextSlotAt`, awaited a sleep, and only *then*
// updated it, every concurrent caller would read the same stale value,
// compute the same wait, and fire together the moment they all wake up —
// which is exactly the burst that was tripping API-Football's per-minute
// limit. Reserving the slot synchronously (no await between the read and the
// write) means each concurrent caller gets a strictly later slot before any
// of them starts sleeping, so the actual network calls stay spaced out.
let nextSlotAt = 0;

async function throttle(): Promise<void> {
  const mySlot = Math.max(nextSlotAt, Date.now());
  nextSlotAt = mySlot + MIN_REQUEST_INTERVAL_MS;
  const wait = mySlot - Date.now();
  if (wait > 0) await sleep(wait);
}

export async function afFetch<T>(path: string, attempt = 0): Promise<T> {
  await throttle();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "x-apisports-key": apiKey() },
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    logger.warn({ path, attempt }, "API-Football rate-limited, backing off");
    await sleep(MIN_REQUEST_INTERVAL_MS * 2);
    return afFetch<T>(path, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API-Football request failed (${res.status}): ${path} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { response: T; errors?: unknown };
  if (json.errors && Array.isArray(json.errors) ? json.errors.length > 0 : json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football returned errors for ${path}: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.response;
}

interface AfTeamSearchResult {
  team: { id: number; name: string; logo: string | null; national?: boolean; country?: string };
}

// API-Football's fixtures endpoint doesn't return US broadcast info on our
// plan, so map each league to its primary US TV/streaming home. Falls back
// to null for leagues not explicitly listed.
// Keys must match the exact league-name strings returned by API-Football.
// Rights change regularly — update this map when deals change rather than
// touching fixture rows.
const BROADCAST_BY_LEAGUE: Record<string, { tvNetwork: string | null; streamingService: string | null }> = {
  // ── England ──────────────────────────────────────────────────────────────
  "Premier League":      { tvNetwork: "NBC Sports / Peacock", streamingService: "Peacock" },
  "Championship":        { tvNetwork: null,                   streamingService: "Paramount+" },
  "League One":          { tvNetwork: null,                   streamingService: "Paramount+" },
  "League Two":          { tvNetwork: null,                   streamingService: "Paramount+" },
  "FA Cup":              { tvNetwork: null,                   streamingService: "ESPN+" },
  "League Cup":          { tvNetwork: null,                   streamingService: "Paramount+" }, // Carabao Cup
  "EFL Trophy":          { tvNetwork: null,                   streamingService: "Paramount+" },

  // ── Spain ─────────────────────────────────────────────────────────────────
  "La Liga":             { tvNetwork: "ESPN Deportes",        streamingService: "ESPN+" },
  "La Liga 2":           { tvNetwork: null,                   streamingService: "ESPN+" },

  // ── Germany ───────────────────────────────────────────────────────────────
  // New US deal (2026-27 onward): USA Network & Fubo
  "Bundesliga":          { tvNetwork: "USA Network",          streamingService: "Fubo" },
  "2. Bundesliga":       { tvNetwork: null,                   streamingService: "Fubo" },
  "DFB Pokal":           { tvNetwork: null,                   streamingService: "Fubo" },

  // ── Italy ─────────────────────────────────────────────────────────────────
  "Serie A":             { tvNetwork: "CBS Sports Network",   streamingService: "Paramount+" },
  "Coppa Italia":        { tvNetwork: null,                   streamingService: "Paramount+" },

  // ── France ────────────────────────────────────────────────────────────────
  "Ligue 1":             { tvNetwork: "beIN Sports",          streamingService: "beIN Sports Connect" },

  // ── Netherlands ───────────────────────────────────────────────────────────
  "Eredivisie":          { tvNetwork: null,                   streamingService: "ESPN+" },

  // ── Portugal ──────────────────────────────────────────────────────────────
  "Primeira Liga":       { tvNetwork: null,                   streamingService: "GolTV / Fanatiz" },
  "Segunda Liga":        { tvNetwork: null,                   streamingService: "GolTV / Fanatiz" },

  // ── Belgium ───────────────────────────────────────────────────────────────
  "Belgian Pro League":  { tvNetwork: null,                   streamingService: "DAZN" },
  "Jupiler Pro League":  { tvNetwork: null,                   streamingService: "DAZN" }, // alt name

  // ── Scotland ──────────────────────────────────────────────────────────────
  "Premiership":         { tvNetwork: null,                   streamingService: "Paramount+" }, // Scottish Premiership

  // ── Austria ───────────────────────────────────────────────────────────────
  "Austrian Bundesliga": { tvNetwork: null,                   streamingService: "OneFootball" },
  "Bundesliga Austria":  { tvNetwork: null,                   streamingService: "OneFootball" }, // alt name

  // ── Switzerland ───────────────────────────────────────────────────────────
  "Super League":        { tvNetwork: null,                   streamingService: "OneFootball / Fanatiz" },

  // ── Denmark ───────────────────────────────────────────────────────────────
  "Superliga":           { tvNetwork: null,                   streamingService: "OneFootball" }, // Danish Superliga & Serbian SuperLiga

  // ── Norway ────────────────────────────────────────────────────────────────
  "Eliteserien":         { tvNetwork: null,                   streamingService: "OneFootball" },

  // ── Sweden ────────────────────────────────────────────────────────────────
  "Allsvenskan":         { tvNetwork: null,                   streamingService: "OneFootball" },

  // ── Turkey ────────────────────────────────────────────────────────────────
  "Süper Lig":           { tvNetwork: "beIN Sports",          streamingService: "beIN Sports" },

  // ── Croatia ───────────────────────────────────────────────────────────────
  "HNL":                 { tvNetwork: null,                   streamingService: "OneFootball" },

  // ── MLS / US ──────────────────────────────────────────────────────────────
  "Major League Soccer": { tvNetwork: "Apple TV",             streamingService: "MLS Season Pass" },
  "MLS Next Pro":        { tvNetwork: null,                   streamingService: "MLS Season Pass" },
  "Leagues Cup":         { tvNetwork: null,                   streamingService: "MLS Season Pass" },
  "USL Championship":    { tvNetwork: null,                   streamingService: "ESPN+ / Paramount+" },
  "USL League One":      { tvNetwork: null,                   streamingService: "ESPN+" },

  // ── Mexico ────────────────────────────────────────────────────────────────
  "Liga MX":             { tvNetwork: "TUDN / UniMás",        streamingService: "ViX / Peacock" },
  "Liga de Expansión":   { tvNetwork: null,                   streamingService: "ViX" },

  // ── Brazil ────────────────────────────────────────────────────────────────
  "Brasileirão Série A": { tvNetwork: null,                   streamingService: "Fanatiz" },
  "Serie A Brazil":      { tvNetwork: null,                   streamingService: "Fanatiz" }, // alt name

  // ── Argentina ─────────────────────────────────────────────────────────────
  "Liga Profesional":    { tvNetwork: null,                   streamingService: "Fanatiz" },

  // ── UEFA club competitions ─────────────────────────────────────────────────
  "UEFA Champions League":   { tvNetwork: "CBS",  streamingService: "Paramount+" },
  "UEFA Europa League":      { tvNetwork: null,   streamingService: "Paramount+" },
  "UEFA Conference League":  { tvNetwork: null,   streamingService: "Paramount+" },

  // ── CONCACAF club competitions ────────────────────────────────────────────
  "CONCACAF Champions Cup":  { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },

  // ── International / national team ─────────────────────────────────────────
  "FIFA World Cup":          { tvNetwork: "FOX",        streamingService: "FOX Sports App" },
  "FIFA Club World Cup":     { tvNetwork: null,         streamingService: "DAZN" },
  "CONCACAF Nations League": { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "CONCACAF Gold Cup":       { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "Copa América":            { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "UEFA Nations League":     { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "International Friendly":  { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "Copa Libertadores":       { tvNetwork: "beIN Sports", streamingService: "beIN Sports" },
  "Copa Sudamericana":       { tvNetwork: "beIN Sports", streamingService: "beIN Sports" },
};

function broadcastFor(leagueName: string): { tvNetwork: string | null; streamingService: string | null } {
  return BROADCAST_BY_LEAGUE[leagueName] ?? { tvNetwork: null, streamingService: null };
}

// Reserve/academy/development sides (e.g. "Leeds United U21" in the EFL
// Trophy) show up as a club's "fixture" in API-Football but never field
// senior full internationals. Skip tagging entirely when either side looks
// like a non-first-team squad.
const RESERVE_TEAM_PATTERN = /\b(u1[5-9]|u2[0-3]|reserves?|development squad|academy)\b|(?:\sB|\sII)$/i;

export function isReserveOrYouthTeam(name: string): boolean {
  return RESERVE_TEAM_PATTERN.test(name.trim());
}

/**
 * Returns true when a team name refers to a US men's national team — either
 * the senior side ("USA") or a men's youth age-group side ("USA U17",
 * "USA U20", "United States U17", etc.).
 *
 * Deliberately excludes the women's programme: "USA W" and
 * "United States W" do NOT match.
 */
function isUsMensNationalTeamName(name: string): boolean {
  if (name === "USA") return true;
  // Men's youth age-group pattern: "USA U17", "USA U20", "United States U20", …
  return /^(USA|United States) U\d+$/.test(name);
}

/**
 * Returns true when the fixture should be skipped for player tagging.
 *
 * A fixture is treated as a reserve/youth entry only when the club's own
 * side in the fixture (a) carries a name that matches RESERVE_TEAM_PATTERN
 * AND (b) differs from the club's registered name.
 *
 * The (b) condition prevents a club that is explicitly tracked under a name
 * ending in " B" or " II" (e.g. "Benfica B") from being incorrectly
 * excluded — the club is first-team for our purposes regardless of suffix.
 *
 * Exported for unit testing.
 */
export function isReserveFixtureForClub(
  registeredClubName: string,
  clubSideApiName: string,
): boolean {
  return (
    clubSideApiName.toLowerCase() !== registeredClubName.toLowerCase() &&
    isReserveOrYouthTeam(clubSideApiName)
  );
}

// API-Football's search matches on short/informal names, not full official
// names — "AS Monaco" returns nothing but "Monaco" does. Override the search
// term for clubs where the official name in our DB doesn't match.
export const SEARCH_TERM_OVERRIDES: Record<string, string> = {
  "AS Monaco": "Monaco",
  "FC Barcelona": "Barcelona",
  "Inter Miami CF": "Inter Miami",
  "Olympique de Marseille": "Marseille",
  "Seattle Sounders FC": "Seattle Sounders",
  "Norwich City": "Norwich",
  "Como 1907": "Como",
  "Bayern Munich": "Bayern Munchen",
  "Charlotte FC": "Charlotte",
  "San Diego FC": "San Diego",
  "Parma Calcio 1913": "Parma",
  // API-Football's search param rejects accented characters outright ("The
  // Search field may only contain alpha-numeric characters and spaces").
  "Atlético Madrid": "Atletico Madrid",
  "Lyngby Boldklub": "Lyngby",
  "Los Angeles FC": "Los Angeles FC",
  "LA Galaxy": "Galaxy",
};

let usmntTeamId: number | null = null;

/**
 * Finds (and caches in-memory) the USMNT senior men's national team's
 * API-Football team id. Searches for "USA" and takes the result flagged
 * `national: true` — API-Football represents national teams as regular
 * teams, and a plain name search also returns MLS clubs and USMNT youth/
 * women's sides, so the `national` flag is the only reliable way to pick
 * the senior men's side out of that list.
 */
export async function resolveUsmntTeamId(): Promise<number | null> {
  if (usmntTeamId) return usmntTeamId;
  try {
    const results = await afFetch<AfTeamSearchResult[]>(`/teams?search=USA`);
    const match = results.find((r) => r.team.national === true && r.team.name === "USA");
    if (!match) {
      logger.warn("API-Football team search found no senior USMNT national team match");
      return null;
    }
    usmntTeamId = match.team.id;
    return usmntTeamId;
  } catch (err) {
    logger.warn({ err }, "API-Football USMNT team search failed");
    return null;
  }
}

/** Finds (and caches) a club's API-Football team id via the team search endpoint. */
export async function resolveTeamId(club: { id: number; name: string; apiFootballTeamId: number | null }): Promise<number | null> {
  if (club.apiFootballTeamId) return club.apiFootballTeamId;

  const searchTerm = SEARCH_TERM_OVERRIDES[club.name] ?? club.name;
  try {
    const results = await afFetch<AfTeamSearchResult[]>(`/teams?search=${encodeURIComponent(searchTerm)}`);
    // Prefer an exact (case-insensitive) name match over the first result —
    // searches like "Barcelona" return a dozen youth/reserve/women's teams.
    const match = results.find((r) => r.team.name.toLowerCase() === searchTerm.toLowerCase()) ?? results[0];
    if (!match) {
      logger.warn({ club: club.name, searchTerm }, "API-Football team search returned no match");
      return null;
    }

    // Guard against tracking the same real-world club twice under two
    // different names (e.g. "Lyngby Boldklub" vs "Lyngby" both resolving to
    // team id 625) — check for an existing row with this team id *before*
    // writing, rather than relying solely on the DB unique index to reject
    // it after the fact. Surfaces the duplicate for manual merging instead
    // of silently leaving this club's id unresolved forever.
    const [existing] = await db
      .select({ id: clubsTable.id, name: clubsTable.name })
      .from(clubsTable)
      .where(and(eq(clubsTable.apiFootballTeamId, match.team.id), sql`${clubsTable.id} != ${club.id}`));
    if (existing) {
      logger.warn(
        { club: club.name, clubId: club.id, existingClub: existing.name, existingClubId: existing.id, teamId: match.team.id },
        "API-Football team search resolved to a team id already tracked under a different club row — likely a duplicate club; not assigning, needs manual merge",
      );
      return null;
    }

    try {
      await db
        .update(clubsTable)
        .set({ apiFootballTeamId: match.team.id, logoUrl: match.team.logo })
        .where(eq(clubsTable.id, club.id));
    } catch (err) {
      // Defense-in-depth against the race between the check above and this
      // write (e.g. two sync runs overlapping) — the partial unique index on
      // api_football_team_id will reject a genuine duplicate.
      logger.warn({ err, club: club.name, teamId: match.team.id }, "Failed to assign API-Football team id — likely a duplicate club row");
      return null;
    }
    return match.team.id;
  } catch (err) {
    logger.warn({ err, club: club.name, searchTerm }, "API-Football team search failed");
    return null;
  }
}

/**
 * Purges `fixture_players` links for players who have since transferred away
 * from the club the link was created for.  Only scheduled/live fixtures are
 * affected — finished fixtures keep their links as a historical record of
 * who was tagged at the time the fixture was played.
 *
 * Run at the start of every fixture-sync sweep (after
 * `backfillLegacyFixturePlayerClubIds` so every link already has a club_id
 * stamped before we compare).  Idempotent: no rows are touched when no
 * transfers have occurred since the last sweep.
 *
 * Recovery path: the per-club `runRepairPass` that follows in the same sweep
 * creates fresh links for the player's current club's upcoming fixtures, so
 * the fixture card is restored within one full sync cycle.
 *
 * @param scopeToPlayerIds  When provided, only `fixture_players` rows whose
 *   `player_id` is in this list are eligible for deletion.  Pass the list of
 *   player ids inserted by the current test run so the purge cannot touch live
 *   data while the test suite is executing against the development database.
 *   Omit (or pass `undefined`) in production — the full table is scanned.
 */
export async function purgeStaleTransferredPlayerLinks(
  { scopeToPlayerIds }: { scopeToPlayerIds?: number[] } = {},
): Promise<{ purged: number }> {
  // When a scope is explicitly requested but the list is empty (e.g. no rows
  // were inserted yet in the current test), treat the call as a no-op rather
  // than falling through to an unscoped full-table DELETE.
  if (scopeToPlayerIds !== undefined && scopeToPlayerIds.length === 0) {
    return { purged: 0 };
  }

  // Build a fully-parameterized scope clause — never use sql.raw for IDs so
  // the query is safe regardless of who calls this function.
  const scopeClause =
    scopeToPlayerIds && scopeToPlayerIds.length > 0
      ? sql` AND fp.player_id IN (${sql.join(scopeToPlayerIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;

  const result = await db.execute(sql`
    DELETE FROM fixture_players fp
    USING players p, fixtures f
    WHERE fp.player_id = p.id
      AND fp.fixture_id = f.id
      AND fp.club_id IS NOT NULL
      AND fp.club_id != p.club_id
      AND f.status IN ('scheduled', 'live')
      ${scopeClause}
  `);
  const purged = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (purged > 0) {
    logger.info({ purged }, "Purged stale fixture_players links for transferred players — runRepairPass will recreate links for current clubs");
  }
  return { purged };
}

/**
 * Syncs upcoming club fixtures from API-Football for every club that has a
 * tracked player. National-team fixtures (World Cup qualifiers etc.) stay
 * curated/seeded — API-Football club fixtures are the part that changes
 * weekly and is impractical to hand-maintain.
 */
/**
 * Backfills `fixture_players.club_id` for legacy links created before that
 * column existed. Matches each unstamped, non-national-team link's fixture
 * to whichever tracked club's name equals the fixture's home or away team —
 * that's the club this sync originally created the link for. Idempotent and
 * safe to run on every sync so any future gaps self-heal without a manual
 * one-off migration.
 *
 * @param scopeToFixtureIds  When provided, only `fixture_players` rows whose
 *   `fixture_id` is in this list are eligible for the UPDATE.  Pass the list
 *   of fixture ids inserted by the current test run so the backfill cannot
 *   touch live data while the test suite is executing against the development
 *   database.  Omit (or pass `undefined`) in production.
 */
export async function backfillLegacyFixturePlayerClubIds(
  { scopeToFixtureIds }: { scopeToFixtureIds?: number[] } = {},
): Promise<{ backfilled: number }> {
  // When a scope is explicitly requested but the list is empty, treat the call
  // as a no-op rather than falling through to an unscoped full-table UPDATE.
  if (scopeToFixtureIds !== undefined && scopeToFixtureIds.length === 0) {
    return { backfilled: 0 };
  }

  // Build a fully-parameterized scope clause — never use sql.raw for IDs.
  const scopeClause =
    scopeToFixtureIds && scopeToFixtureIds.length > 0
      ? sql` AND fp.fixture_id IN (${sql.join(scopeToFixtureIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;

  const result = await db.execute(sql`
    UPDATE fixture_players fp
    SET club_id = c.id
    FROM fixtures f
    JOIN clubs c ON (c.name = f.home_team OR c.name = f.away_team)
    WHERE fp.fixture_id = f.id
      AND f.is_national_team = false
      AND fp.club_id IS NULL
      ${scopeClause}
  `);
  const backfilled = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (backfilled > 0) {
    logger.info({ backfilled }, "Backfilled legacy fixture_players.club_id for pre-existing club-fixture links");
  }
  return { backfilled };
}

/**
 * Iterates every fixture in `allNewlyFinished` and fires `syncFn` once per
 * entry (fire-and-forget via `.catch()`).  Extracted so tests can drive the
 * trigger loop directly with a stub `syncFn` — avoiding the lazy
 * `require("./playerStatsSync")` that is necessary in production to break the
 * circular import but cannot be intercepted by vitest's module mocking.
 *
 * @param allNewlyFinished  Map of DB fixture id → set of player ids, produced
 *                          by merging `reconcileClubFixtures` results across
 *                          all clubs in the sweep.
 * @param syncFn            Called once per fixture with the union of player ids.
 *                          Defaults to the real `syncStatsForFinishedFixture`
 *                          (injected by `syncApiFootballFixtures` via lazy require).
 */
export function dispatchPostMatchTriggers(
  allNewlyFinished: Map<number, Set<number>>,
  syncFn: (playerIds: number[]) => Promise<void>,
): void {
  for (const [fixtureId, playerIdSet] of allNewlyFinished) {
    const playerIds = [...playerIdSet];
    logger.info(
      { fixtureId, playerCount: playerIds.length },
      "Hourly sweep: post-match stats pipeline triggered for newly-finished fixture",
    );
    syncFn(playerIds).catch((err) =>
      logger.error(
        { err, fixtureId },
        "Post-match stats trigger failed — daily job remains as catch-all",
      ),
    );
  }
}

/**
 * Schedules a post-match stats sync for a fixture that the live-poll loop
 * just observed transitioning to "finished".  Extracted so tests can drive
 * the wiring with a stub `syncFn` and a zero delay without touching the DB
 * or the API-Football client.
 *
 * Mirrors the `dispatchPostMatchTriggers` extraction for the reconciliation
 * path: both helpers take an injectable `syncFn` to break the lazy-require
 * circular-import chain and make the trigger logic independently testable.
 *
 * @param fixtureId  DB fixture id (used only for logging/error context).
 * @param playerIds  Players linked to this fixture — forwarded as-is to syncFn.
 * @param syncFn     Called after `delayMs` with the player ids.
 * @param delayMs    Milliseconds to wait before invoking syncFn.  Defaults to
 *                   the production 35-minute hold so API-Football has time to
 *                   populate individual player statistics.
 */
export function scheduleLivePollStatsSync(
  fixtureId: number,
  playerIds: number[],
  syncFn: (playerIds: number[]) => Promise<void>,
  delayMs: number = POST_MATCH_STATS_DELAY_MINUTES * 60 * 1000,
): void {
  setTimeout(() => {
    syncFn(playerIds).catch((err) =>
      logger.error({ err, fixtureId }, "Live poll: post-match stats trigger failed"),
    );
  }, delayMs);
}

/**
 * Repair pass: backfills missing `fixture_players` links for every scheduled/
 * live fixture that is present in `freshById` (the current season's API pull).
 *
 * Extracted from `syncApiFootballFixtures` so tests can drive it directly with
 * controlled `freshById` data — bypassing the need to mock the internal `afFetch`
 * call inside the parent function (ESM module-internal calls can't be spied on).
 *
 * ## Reserve-guard
 * The pass applies the same side-aware `isReserveFixtureForClub` check used in
 * the main upsert loop: only the club's OWN slot in the fixture (resolved via
 * `teamId`) is checked, and a club explicitly registered under a name matching
 * the reserve pattern (e.g. "Benfica B") is never blocked when the API name
 * agrees with the registered name.  Fixtures absent from `freshById` are
 * backfilled without a reserve check — they were validated as non-reserve when
 * first inserted and are no longer in the live season window.
 */
export async function runRepairPass({
  club,
  teamId,
  freshById,
  clubPlayerIds,
}: {
  club: { id: number; name: string };
  teamId: number;
  freshById: Map<number, AfFixture>;
  clubPlayerIds: number[];
}): Promise<void> {
  const freshApiIds = [...freshById.keys()];
  if (freshApiIds.length === 0) return;

  const dbFixtures = await db
    .select({ id: fixturesTable.id, apiFootballFixtureId: fixturesTable.apiFootballFixtureId })
    .from(fixturesTable)
    .where(
      and(
        inArray(fixturesTable.apiFootballFixtureId, freshApiIds),
        inArray(fixturesTable.status, ["scheduled", "live"]),
      ),
    );

  for (const dbFixture of dbFixtures) {
    // Apply the same side-aware reserve guard as the main upsert loop.
    // `freshById` carries numeric team IDs — the only reliable way to
    // determine which side of the fixture is the club we are tracking.
    const apiFixture = dbFixture.apiFootballFixtureId !== null
      ? freshById.get(dbFixture.apiFootballFixtureId)
      : undefined;
    if (apiFixture) {
      const clubSideApiName =
        apiFixture.teams.home.id === teamId
          ? apiFixture.teams.home.name
          : apiFixture.teams.away.name;
      if (isReserveFixtureForClub(club.name, clubSideApiName)) {
        // Genuine reserve entry (e.g. "Leeds United U21" in the club's
        // season feed) — skip backfill to match the main loop's decision.
        continue;
      }
    }
    // Fixture not in freshById: validated as non-reserve on insertion;
    // safe to backfill without the guard.

    const existingLinks = await db
      .select({ playerId: fixturePlayersTable.playerId })
      .from(fixturePlayersTable)
      .where(eq(fixturePlayersTable.fixtureId, dbFixture.id));
    const alreadyLinked = new Set(existingLinks.map((l) => l.playerId));
    const toLink = clubPlayerIds.filter((pid) => !alreadyLinked.has(pid));
    if (toLink.length > 0) {
      await db
        .insert(fixturePlayersTable)
        .values(toLink.map((playerId) => ({ fixtureId: dbFixture.id, playerId, clubId: club.id })));
      logger.info(
        { fixtureId: dbFixture.id, club: club.name, linked: toLink.length },
        "Repair pass: backfilled missing fixture_players links",
      );
    }
  }
}

/**
 * Repair pass for national-team fixtures: ensures every player who has a
 * `fixture_players` link on a *finished* national-team fixture in a given
 * competition is also linked to all *upcoming* national-team fixtures in the
 * same competition.
 *
 * ## Why this is safe and future-proof
 * Currently there are no tracked youth national-team players, so this pass is a
 * complete no-op.  When U20/U17 roster data is eventually added and players
 * accumulate match history, links appear automatically the next time the sync
 * runs — no separate migration needed.
 *
 * Using finished-fixture history (rather than a hardcoded player list) means
 * the pass is self-healing: it never over-links (a player can only be linked
 * to a competition they've already appeared in) and never requires schema
 * changes when new age-group teams are added.
 *
 * club_id is left NULL for national-team links because the player is
 * representing their country, not a club.  `purgeStaleTransferredPlayerLinks`
 * skips rows where club_id IS NULL, so these links are permanent until the
 * fixture itself is deleted.
 */
export async function runNationalTeamRepairPass(): Promise<{ linked: number }> {
  // Find all upcoming / live national-team fixtures.
  const upcoming = await db
    .select({ id: fixturesTable.id, competition: fixturesTable.competition })
    .from(fixturesTable)
    .where(
      and(
        eq(fixturesTable.isNationalTeam, true),
        inArray(fixturesTable.status, ["scheduled", "live"]),
      ),
    );

  if (upcoming.length === 0) return { linked: 0 };

  // Group upcoming fixtures by competition for efficient per-competition lookup.
  const byCompetition = new Map<string, number[]>();
  for (const f of upcoming) {
    const ids = byCompetition.get(f.competition) ?? [];
    ids.push(f.id);
    byCompetition.set(f.competition, ids);
  }

  let linked = 0;

  for (const [competition, fixtureIds] of byCompetition) {
    // Find players who have ever played in a *finished* NT fixture in this
    // competition — they should be linked to all upcoming ones too.
    const veterans = await db
      .selectDistinct({ playerId: fixturePlayersTable.playerId })
      .from(fixturePlayersTable)
      .innerJoin(fixturesTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
      .where(
        and(
          eq(fixturesTable.isNationalTeam, true),
          eq(fixturesTable.competition, competition),
          eq(fixturesTable.status, "finished"),
        ),
      );

    if (veterans.length === 0) continue;
    const playerIds = veterans.map((r) => r.playerId);

    for (const fixtureId of fixtureIds) {
      const existing = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureId));

      const alreadyLinked = new Set(existing.map((r) => r.playerId));
      const toLink = playerIds.filter((pid) => !alreadyLinked.has(pid));

      if (toLink.length > 0) {
        await db
          .insert(fixturePlayersTable)
          .values(toLink.map((playerId) => ({ fixtureId, playerId, clubId: null })));
        logger.info(
          { fixtureId, competition, linked: toLink.length },
          "NT repair pass: backfilled fixture_players links for national-team fixture",
        );
        linked += toLink.length;
      }
    }
  }

  return { linked };
}

// ─── Player-to-team resolution helpers ───────────────────────────────────────

/**
 * API-Football squad response shape — `/players/squads?player={id}` returns
 * which team(s) a player is currently registered with.
 */
interface AfSquadEntry {
  team: { id: number; name: string; logo: string | null; national?: boolean };
  players: Array<{ id: number; name: string }>;
}

/**
 * Returns true when a squad-entry team name looks like a national team.
 *
 * This is the name-based backstop used when the API's `national` flag is
 * absent or incorrect (e.g. United States U20 returns national=false from
 * `/teams?id=10306`).  The ID-based cache in `isNationalTeamId` is the
 * primary check; this function is secondary.
 *
 *   • Youth national teams (any country): name contains "U" + 2 digits, e.g.
 *     "Germany U18", "United States U20", "USA U19".  Note this also matches
 *     club reserve names like "RB Leipzig U19" — acceptable because those
 *     players are preserved via the stored club_id fallback (their stats
 *     correctly identify them when they later enter the senior squad).
 *   • Senior US national teams: "USA" alone or "United States" alone.
 *   • Women's sides: any name ending in " W" (e.g. "Houston Dash W",
 *     "USA W").  All tracked players are male; women's team entries should
 *     never become a player's primary club.
 */
/** @internal Exported for unit-testing only — not part of the public API. */
export function isLikelyNationalTeamName(name: string): boolean {
  const trimmed = name.trim();
  // Women's side — trailing " W" (e.g. "Houston Dash W", "USA W")
  if (trimmed.endsWith(" W")) return true;
  // Youth national team suffix — "U17" … "U23"
  if (/\bU(1[5-9]|2[0-3])\b/.test(trimmed)) return true;
  // Senior US national squads (exact match)
  return trimmed === "USA" || trimmed === "United States";
}

/**
 * In-process cache: API-Football team id → is this a national team?
 *
 * Populated lazily via `/teams?id={teamId}` on first encounter.  Persists for
 * the lifetime of the server process, so each unique team id costs at most one
 * extra API call across all sync runs.  The handful of national-team ids that
 * recur across every player (e.g. 2384 = USA senior) are looked up once and
 * then served from cache for every subsequent player.
 */
const nationalTeamIdCache = new Map<number, boolean>();

/**
 * In-process cache: API-Football team id → country name.
 *
 * Populated as a side-effect whenever `/teams?id={teamId}` is called — either
 * by `isNationalTeamId` (Phase A squad walk) or by `fetchTeamCountry` (new-
 * club enrichment in `ensureClubForTeam`).  Ensures a genuinely new club
 * costs at most one extra API call even if `isNationalTeamId` already fetched
 * the team details earlier in the same sweep.
 */
const teamCountryCache = new Map<number, string>();

/**
 * Returns the country name for the given API-Football team id.
 *
 * Checks `teamCountryCache` first (populated as a side-effect of
 * `isNationalTeamId`), then calls `/teams?id={teamId}` if needed.  Falls back
 * to "Unknown" on error so the clubs row is always in a consistent state.
 */
async function fetchTeamCountry(teamId: number): Promise<string> {
  if (teamCountryCache.has(teamId)) return teamCountryCache.get(teamId)!;
  try {
    const results = await afFetch<AfTeamSearchResult[]>(`/teams?id=${teamId}`);
    const country = results[0]?.team?.country ?? "Unknown";
    teamCountryCache.set(teamId, country);
    // Also populate the national-team cache as a free side-effect.
    if (!nationalTeamIdCache.has(teamId) && results.length > 0) {
      const isNational =
        results[0].team.national === true || isLikelyNationalTeamName(results[0].team.name);
      nationalTeamIdCache.set(teamId, isNational);
    }
    return country;
  } catch (err) {
    logger.warn({ err, teamId }, "fetchTeamCountry: /teams lookup failed — defaulting to 'Unknown'");
    return "Unknown";
  }
}

/**
 * Returns true when the given API-Football team id represents a national team.
 *
 * Resolution order:
 *  1. In-process cache (instant, no API call).
 *  2. Name fast-path for known senior US names ("USA", "United States") and
 *     women's suffixes — avoids an API call for the most common entries.
 *  3. `/teams?id={teamId}` lookup — stores the `national` flag; falls back to
 *     `isLikelyNationalTeamName` when the API flag is wrong (e.g. US U20
 *     returns national=false despite being a national youth side).
 *  4. Name-heuristic-only fallback when the API call fails.
 */
async function isNationalTeamId(teamId: number, teamName: string): Promise<boolean> {
  if (nationalTeamIdCache.has(teamId)) return nationalTeamIdCache.get(teamId)!;

  // Fast-path for senior US national teams and women's entries — saves an API
  // call for the most common squad entries we encounter.
  const trimmed = teamName.trim();
  if (trimmed === "USA" || trimmed === "United States" || trimmed.endsWith(" W")) {
    nationalTeamIdCache.set(teamId, true);
    return true;
  }

  // Look up the team's national flag from the API.  The flag is authoritative
  // for most teams; isLikelyNationalTeamName is a backstop for the cases where
  // the API returns the wrong value (confirmed: US U20 / team 10306 → false).
  try {
    const results = await afFetch<AfTeamSearchResult[]>(`/teams?id=${teamId}`);
    const isNational =
      results.length > 0 &&
      (results[0].team.national === true || isLikelyNationalTeamName(results[0].team.name));
    nationalTeamIdCache.set(teamId, isNational);
    // Populate country cache as a free side-effect — fetchTeamCountry can
    // skip the API call for any team already seen here.
    if (!teamCountryCache.has(teamId) && results[0]?.team?.country) {
      teamCountryCache.set(teamId, results[0].team.country);
    }
    return isNational;
  } catch (err) {
    logger.warn({ err, teamId, teamName }, "isNationalTeamId: /teams lookup failed — using name heuristic");
    const isNational = isLikelyNationalTeamName(teamName);
    nationalTeamIdCache.set(teamId, isNational);
    return isNational;
  }
}

/**
 * API-Football player-statistics response shape — `/players?id={id}&season={year}`.
 * Each element in `statistics` represents one competition the player appeared in;
 * multiple entries may share the same `team.id` (e.g. Premier League + FA Cup
 * both for Fulham).  Summing minutes by team id identifies the primary club.
 */
interface AfPlayerStatsEntry {
  player: { id: number; name: string };
  statistics: Array<{
    team: { id: number; name: string; logo: string | null };
    league: { id: number; name: string; country: string; season: number };
    games: { minutes: number | null; appearences: number | null };
  }>;
}

/**
 * Secondary club-resolution strategy used when `/players/squads` returns only
 * national-team entries (e.g. during a Gold Cup or Nations League window).
 *
 * Calls `/players?id={id}&season={year}` and sums `games.minutes` by team,
 * filtering out national teams via the ID cache.  The team with the most total
 * minutes across all competitions is returned as the player's current club.
 *
 * Tries the current calendar year first (covers MLS, which uses Jan–Dec
 * seasons), then year-1 (covers European leagues where season 2024 = Aug
 * 2024 – May 2025).  Returns null when neither season yields a resolvable club.
 */
async function fetchPlayerCurrentTeamFromStats(
  apiFootballPlayerId: number,
): Promise<{ teamId: number; teamName: string; logoUrl: string | null } | null> {
  const currentYear = new Date().getUTCFullYear();
  for (const season of [currentYear, currentYear - 1]) {
    try {
      const results = await afFetch<AfPlayerStatsEntry[]>(`/players?id=${apiFootballPlayerId}&season=${season}`);
      if (!results.length || !results[0].statistics.length) continue;

      // Aggregate minutes per team, skipping national-team entries.
      const minutesByTeam = new Map<number, { minutes: number; teamName: string; logoUrl: string | null }>();
      for (const stat of results[0].statistics) {
        if (await isNationalTeamId(stat.team.id, stat.team.name)) continue;
        const minutes = stat.games.minutes ?? 0;
        const existing = minutesByTeam.get(stat.team.id);
        if (existing) {
          existing.minutes += minutes;
        } else {
          minutesByTeam.set(stat.team.id, { minutes, teamName: stat.team.name, logoUrl: stat.team.logo });
        }
      }
      if (minutesByTeam.size === 0) continue;

      // Pick the team with the most accumulated minutes.
      let bestTeamId = 0;
      let bestMinutes = -1;
      let bestName = "";
      let bestLogo: string | null = null;
      for (const [teamId, entry] of minutesByTeam) {
        if (entry.minutes > bestMinutes) {
          bestTeamId = teamId;
          bestMinutes = entry.minutes;
          bestName = entry.teamName;
          bestLogo = entry.logoUrl;
        }
      }

      logger.info(
        { apiFootballPlayerId, teamId: bestTeamId, teamName: bestName, season, minutes: bestMinutes },
        "fetchPlayerCurrentTeam: resolved via season-stats fallback (squads returned only national-team entries)",
      );
      return { teamId: bestTeamId, teamName: bestName, logoUrl: bestLogo };
    } catch (err) {
      logger.warn({ err, apiFootballPlayerId, season }, "fetchPlayerCurrentTeam: season-stats fallback failed for season");
    }
  }

  logger.warn(
    { apiFootballPlayerId },
    "fetchPlayerCurrentTeam: season-stats fallback found no club data — will fall back to stored club_id",
  );
  return null;
}

/**
 * Asks API-Football which squad a player is currently in by calling
 * `/players/squads?player={id}`.  Returns the primary *club* team entry, or
 * null when the player has no current squad data or the call fails.
 *
 * This is the authoritative source of "where is this player right now" — it
 * reflects current squad membership rather than historical stats, so it
 * handles mid-season transfers, loans, and pre-season moves without waiting
 * for stats data to accumulate under the new club.
 *
 * During international windows API-Football may list only national-team
 * call-ups.  When that happens the function falls back to
 * `fetchPlayerCurrentTeamFromStats`, which resolves the club from the
 * player's season-statistics data — unaffected by international windows.
 *
 * National-team identification uses a two-layer check:
 *  1. `isNationalTeamId` — looks up the team's `national` flag via
 *     `/teams?id={teamId}` (cached per team id for the process lifetime).
 *  2. `isLikelyNationalTeamName` — name-pattern backstop for cases where the
 *     API flag is wrong (e.g. US U20 returns national=false).
 */
async function fetchPlayerCurrentTeam(
  apiFootballPlayerId: number,
): Promise<{ teamId: number; teamName: string; logoUrl: string | null } | null> {
  try {
    const data = await afFetch<AfSquadEntry[]>(`/players/squads?player=${apiFootballPlayerId}`);
    if (!data.length) return null;

    // Walk the squad entries and return the first non-national club.
    for (const entry of data) {
      if (!(await isNationalTeamId(entry.team.id, entry.team.name))) {
        return { teamId: entry.team.id, teamName: entry.team.name, logoUrl: entry.team.logo };
      }
    }

    // All squad entries are national teams — this is expected during
    // international windows.  Try the season-stats fallback before giving up.
    logger.info(
      { apiFootballPlayerId, squadEntries: data.map((e) => e.team.name) },
      "fetchPlayerCurrentTeam: all squad entries are national teams — trying season-stats fallback",
    );
    return await fetchPlayerCurrentTeamFromStats(apiFootballPlayerId);
  } catch (err) {
    logger.warn({ err, apiFootballPlayerId }, "fetchPlayerCurrentTeam: API call failed — will fall back to stored club");
    return null;
  }
}

/**
 * Ensures a `clubs` row exists for the given API-Football team id, creating a
 * minimal one when necessary.  Resolution order:
 *   1. Existing row already keyed by this `api_football_team_id` (fast path).
 *   2. Existing row whose `name` matches and has no team id yet (back-fill it).
 *   3. Insert a new minimal row (`league` and `country` default to "Unknown";
 *      the fixture `competition` field drives all display and broadcast logic
 *      so the club-level league string is not critical).
 * Handles concurrent sync runs via `onConflictDoNothing` + re-fetch on race.
 */
async function ensureClubForTeam(
  teamId: number,
  teamName: string,
  logoUrl: string | null,
): Promise<{ id: number; name: string }> {
  // Fast path: already tracked by team id.
  const [byTeamId] = await db
    .select({ id: clubsTable.id, name: clubsTable.name })
    .from(clubsTable)
    .where(eq(clubsTable.apiFootballTeamId, teamId));
  if (byTeamId) return byTeamId;

  // Back-fill an existing name-matched row that has no team id yet
  // (e.g. a club added manually before it was first synced).
  const [byName] = await db
    .select({ id: clubsTable.id, name: clubsTable.name })
    .from(clubsTable)
    .where(and(eq(clubsTable.name, teamName), sql`${clubsTable.apiFootballTeamId} IS NULL`));
  if (byName) {
    try {
      await db.update(clubsTable).set({ apiFootballTeamId: teamId, logoUrl }).where(eq(clubsTable.id, byName.id));
    } catch {
      // Lost the race to a concurrent run — not a problem.
    }
    return byName;
  }

  // New club — fetch the country from the API then insert.  The league is
  // set to "Unknown" here; it will be filled in by Phase B of the fixture
  // sweep once the fixture list is available (first fixture's competition).
  // fetchTeamCountry is cached by team id, so this call is free for any team
  // whose /teams?id=… was already fetched earlier in the same sweep by
  // isNationalTeamId.
  const country = await fetchTeamCountry(teamId);
  const [inserted] = await db
    .insert(clubsTable)
    .values({ name: teamName, league: "Unknown", country, apiFootballTeamId: teamId, logoUrl })
    .onConflictDoNothing()
    .returning({ id: clubsTable.id, name: clubsTable.name });

  if (inserted) {
    logger.info({ teamId, teamName, country }, "Fixture sync: inserted new club row for auto-resolved team");
    return inserted;
  }

  // Race: another concurrent sync beat us to the insert — look it up now.
  const [raceWinner] = await db
    .select({ id: clubsTable.id, name: clubsTable.name })
    .from(clubsTable)
    .where(eq(clubsTable.apiFootballTeamId, teamId));
  if (!raceWinner) {
    throw new Error(`ensureClubForTeam: could not find or create club for teamId=${teamId} name=${teamName}`);
  }
  return raceWinner;
}

// ─── Main fixture sync (player-centric) ──────────────────────────────────────

/**
 * Syncs upcoming club fixtures from API-Football for every tracked player.
 *
 * **Player-centric approach**: instead of starting from the `clubs` table
 * (whose player assignments can lag behind real-world transfers), we ask
 * API-Football what team each player is currently in via `/players/squads`,
 * then pull fixtures for those teams.  A player who moves clubs gets the
 * correct fixture cards on the very next sweep — no separate club-assignment
 * sync step required.
 *
 * Players without an `api_football_player_id` (null-pinned, currently 3 of
 * 76) fall back to their stored `players.club_id` so they are never dropped.
 * `players.club_id` is updated as a side-effect whenever the live API
 * disagrees, keeping the stored value accurate for subsequent reads.
 *
 * National-team fixtures (World Cup qualifiers etc.) stay curated/seeded and
 * are handled separately by `syncNationalTeamFixtures`.
 */
export async function syncApiFootballFixtures(
  /** When provided, only syncs fixtures for the given player DB ids.  The
   *  hourly scheduled run omits this to sweep all tracked players. */
  playerIds?: number[],
): Promise<{ clubsSynced: number; fixturesUpserted: number; fixturesReconciled: number; fixturesRemoved: number; failures: number }> {
  // Step 1: stamp club_id on any legacy links that predate the column.
  await backfillLegacyFixturePlayerClubIds();
  // Step 2: remove future links for players who've since transferred — the
  // per-club runRepairPass below will recreate links under their new club.
  await purgeStaleTransferredPlayerLinks();

  // ── Phase A: derive each player's current club from the live API ──────────
  const allPlayers = await db
    .select({
      id: playersTable.id,
      clubId: playersTable.clubId,
      apiFootballPlayerId: playersTable.apiFootballPlayerId,
    })
    .from(playersTable);
  const scopedPlayers = playerIds ? allPlayers.filter((p) => playerIds.includes(p.id)) : allPlayers;

  // clubPlayerMap: club DB id → list of player DB ids currently at that club
  // (derived from the live API squad data, not the stale DB column).
  const clubPlayerMap = new Map<number, number[]>();
  // preResolvedTeamId: club DB id → API-Football team id (short-circuits
  // resolveTeamId's name-search for clubs we auto-resolved in this pass).
  const preResolvedTeamId = new Map<number, number>();

  let failures = 0;

  for (const player of scopedPlayers) {
    const apiId = player.apiFootballPlayerId;

    if (!apiId) {
      // No API-Football id — fall back to the player's stored club.
      const list = clubPlayerMap.get(player.clubId) ?? [];
      list.push(player.id);
      clubPlayerMap.set(player.clubId, list);
      continue;
    }

    // Ask API-Football which squad this player is currently registered with.
    const current = await fetchPlayerCurrentTeam(apiId);
    if (!current) {
      // Call failed or no squad data returned — fall back gracefully.
      failures++;
      const list = clubPlayerMap.get(player.clubId) ?? [];
      list.push(player.id);
      clubPlayerMap.set(player.clubId, list);
      continue;
    }

    // Ensure the club row exists in our DB (upsert by team id, creating a
    // minimal row when the club is brand-new to our tracker).
    let club: { id: number; name: string };
    try {
      club = await ensureClubForTeam(current.teamId, current.teamName, current.logoUrl);
    } catch (err) {
      logger.warn({ err, teamId: current.teamId, playerId: player.id }, "ensureClubForTeam failed — falling back to stored club");
      failures++;
      const list = clubPlayerMap.get(player.clubId) ?? [];
      list.push(player.id);
      clubPlayerMap.set(player.clubId, list);
      continue;
    }

    // Keep players.club_id current as a side-effect — no separate sync needed.
    if (club.id !== player.clubId) {
      await db.update(playersTable).set({ clubId: club.id }).where(eq(playersTable.id, player.id));
      logger.info(
        { playerId: player.id, fromClubId: player.clubId, toClubId: club.id, toClub: club.name },
        "Fixture sync: corrected player club assignment from live API squad data",
      );
    }

    preResolvedTeamId.set(club.id, current.teamId);
    const list = clubPlayerMap.get(club.id) ?? [];
    list.push(player.id);
    clubPlayerMap.set(club.id, list);
  }

  // ── Phase B: load club rows and fetch fixtures for each unique team ───────
  const allClubIds = [...clubPlayerMap.keys()];
  const clubRows = allClubIds.length > 0
    ? await db
        .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId, league: clubsTable.league, country: clubsTable.country })
        .from(clubsTable)
        .where(inArray(clubsTable.id, allClubIds))
    : [];
  const clubById = new Map(clubRows.map((c) => [c.id, c]));

  const now = Date.now();
  const currentYear = new Date(now).getUTCFullYear();

  let clubsSynced = 0;
  let fixturesUpserted = 0;
  let fixturesReconciled = 0;
  let fixturesRemoved = 0;
  // Accumulates every fixture that transitioned to "finished" across all clubs
  // this sweep, keyed by fixture id to deduplicate clubs sharing a fixture.
  const allNewlyFinished = new Map<number, Set<number>>();

  for (const [clubId, clubPlayerIds] of clubPlayerMap) {
    const club = clubById.get(clubId);
    if (!club) {
      logger.warn({ clubId }, "No club row found for player-derived clubId — skipping");
      failures++;
      continue;
    }

    // Phase A may have already resolved the team id via fetchPlayerCurrentTeam;
    // if so, skip the name-search entirely.  For fallback clubs (no API id on
    // the player), resolveTeamId searches by club name as before.
    const teamId = preResolvedTeamId.get(clubId) ?? (await resolveTeamId(club));
    if (!teamId) {
      failures++;
      continue;
    }

    // Free plan doesn't support the `next` param — pull the season's full
    // fixture list instead and filter to not-yet-started matches ourselves.
    // Straddle two season labels (leagues use Aug-May seasons, MLS uses the
    // calendar year) so we don't miss fixtures right around a season boundary.
    let seasonFixtures: AfFixture[] = [];
    let anySeasonFetchSucceeded = false;
    let anySeasonFetchFailed = false;
    for (const season of [currentYear, currentYear - 1]) {
      try {
        const fixtures = await afFetch<AfFixture[]>(`/fixtures?team=${teamId}&season=${season}`);
        seasonFixtures = seasonFixtures.concat(fixtures);
        anySeasonFetchSucceeded = true;
      } catch (err) {
        anySeasonFetchFailed = true;
        logger.warn({ err, club: club.name, teamId, season }, "API-Football fixtures fetch failed for season");
      }
      if (seasonFixtures.some((f) => f.fixture.status.short === "NS" && new Date(f.fixture.date).getTime() > now)) break;
    }

    // Only treat this as a hard failure (and skip reconciliation) when every
    // fetch attempt errored out — we can't trust an empty result as "the
    // provider confirms nothing" if we never actually got a response. A
    // successful fetch that happens to return zero fixtures is still valid,
    // trustworthy data (e.g. an off-season club), so reconciliation should
    // still run against it.
    if (!anySeasonFetchSucceeded) {
      failures++;
      continue;
    }

    // ── Enrich auto-created clubs whose metadata is still "Unknown" ───────────
    // `ensureClubForTeam` already fills country at insert time; this branch
    // handles: (a) the race where country was set to "Unknown" before this
    // feature shipped, and (b) league, which can only be inferred from the
    // first fixture in the sweep (not available at insert time).
    //
    // We do a single conditional DB update, touching only the rows that still
    // need enrichment, so existing well-formed clubs are never written to.
    {
      const needsLeague  = club.league  === "Unknown";
      const needsCountry = club.country === "Unknown";
      if (needsLeague || needsCountry) {
        const enriched: { league?: string; country?: string } = {};

        if (needsLeague) {
          // Use the competition name from the first fixture in the season list
          // (before filtering to upcoming-only) — this includes finished
          // fixtures whose competition name is still authoritative.
          const firstFixture = seasonFixtures[0];
          if (firstFixture) {
            enriched.league = firstFixture.league.name;
          }
        }

        if (needsCountry) {
          // fetchTeamCountry is cached; if isNationalTeamId already hit
          // /teams?id={teamId} earlier in Phase A this call is free.
          enriched.country = await fetchTeamCountry(teamId);
        }

        if (Object.keys(enriched).length > 0) {
          await db.update(clubsTable).set(enriched).where(eq(clubsTable.id, club.id));
          logger.info({ clubId: club.id, club: club.name, ...enriched }, "Fixture sync: enriched club metadata that was previously 'Unknown'");
        }
      }
    }

    const upcoming = seasonFixtures
      .filter((f) => f.fixture.status.short === "NS" && new Date(f.fixture.date).getTime() > now)
      .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime())
      .slice(0, 8);

    // Reconcile fixtures already tracked for this club's players against the
    // fresh pull: API-Football sometimes keeps serving a fixture as "not
    // started" past its real outcome, or drops it from the team's fixture
    // list entirely once a bracket/tie is decided. Deliberately do NOT limit
    // this to future kickoffs — a fixture whose kickoff has already passed
    // while still stuck at "scheduled" or "live" is exactly the stale case
    // we're after. reconcileClubFixtures checks both statuses so a match
    // that went live in a previous cycle (and was correctly written as
    // "live, 0-0") will be updated to "finished" with the real score on
    // the next run.
    //
    // Removing a fixture that's genuinely missing from the fresh pull is only
    // safe when we trust that pull completely — if any season fetch for this
    // club failed, `freshById` is incomplete and a real fixture could look
    // "missing" purely because of the failed request, not because it's
    // actually gone. Require every attempted season fetch to have succeeded
    // before allowing removals this run; status updates for fixtures we DID
    // find are unaffected by this and stay on regardless.
    const removalsTrustworthy = anySeasonFetchSucceeded && !anySeasonFetchFailed;
    const freshById = new Map(seasonFixtures.map((f) => [f.fixture.id, f]));
    const reconciled = await reconcileClubFixtures({ club, clubPlayerIds, freshById, removalsTrustworthy, now });
    fixturesReconciled += reconciled.fixturesReconciled;
    fixturesRemoved += reconciled.fixturesRemoved;
    // Merge this club's newly-finished fixtures into the sweep-level map.
    for (const { fixtureId, playerIds: pids } of reconciled.newlyFinished) {
      const existing = allNewlyFinished.get(fixtureId) ?? new Set<number>();
      for (const pid of pids) existing.add(pid);
      allNewlyFinished.set(fixtureId, existing);
    }

    for (const f of upcoming) {
      const broadcast = broadcastFor(f.league.name);
      const values = {
        apiFootballFixtureId: f.fixture.id,
        // Mark as national-team if either participant is a US men's national
        // team (senior or youth).  This ensures U20/U17 fixtures that enter
        // via the club sync bypass the chipless-fixture filter and always
        // appear on the Fixtures page even before roster data is available.
        isNationalTeam:
          isUsMensNationalTeamName(f.teams.home.name) ||
          isUsMensNationalTeamName(f.teams.away.name),
        competition: f.league.name,
        kickoff: new Date(f.fixture.date),
        venue: f.fixture.venue.name ?? "TBD",
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        homeLogoUrl: f.teams.home.logo,
        awayLogoUrl: f.teams.away.logo,
        status: mapStatus(f.fixture.status.short),
        elapsedMinute: mapStatus(f.fixture.status.short) === "live" ? (f.fixture.status.elapsed ?? null) : null,
        tvNetwork: broadcast.tvNetwork,
        streamingService: broadcast.streamingService,
      };

      const [existing] = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.apiFootballFixtureId, f.fixture.id));

      let fixtureId: number;
      if (existing) {
        await db.update(fixturesTable).set(values).where(eq(fixturesTable.id, existing.id));
        fixtureId = existing.id;
      } else {
        const [inserted] = await db.insert(fixturesTable).values(values).returning({ id: fixturesTable.id });
        if (!inserted) continue;
        fixtureId = inserted.id;
      }

      // The guard's purpose: API-Football sometimes returns reserve/youth
      // fixtures under a senior club's team ID (e.g. an EFL Trophy match
      // appearing in Leeds United's feed as "Leeds United U21"). We skip
      // tagging those because the senior player didn't actually play.
      //
      // Correct logic: only treat a fixture as "reserve" if the club's OWN
      // slot carries a name that (a) looks like a reserve squad AND (b) does
      // NOT match the club's own registered name. A club explicitly tracked
      // under "Benfica B" is the first-team we care about — its fixtures
      // must always be tagged regardless of the " B" suffix in the pattern.
      const clubSideName = f.teams.home.id === teamId ? f.teams.home.name : f.teams.away.name;
      const isReserveFixture = isReserveFixtureForClub(club.name, clubSideName);
      const eligibleIds = isReserveFixture ? [] : clubPlayerIds;
      if (eligibleIds.length > 0) {
        const existingLinks = await db
          .select({ playerId: fixturePlayersTable.playerId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, fixtureId));
        const alreadyLinked = new Set(existingLinks.map((l) => l.playerId));
        const toLink = eligibleIds.filter((pid) => !alreadyLinked.has(pid));
        if (toLink.length > 0) {
          // Stamp the club this link was created for so reads can tell when
          // a player has since transferred away — see the `clubId` comment
          // on `fixturePlayersTable`.
          await db.insert(fixturePlayersTable).values(toLink.map((playerId) => ({ fixtureId, playerId, clubId: club.id })));
        }
      }
      fixturesUpserted++;
    }

    // ── Repair pass: backfill missing fixture_players links ──────────────────
    if (clubPlayerIds.length > 0) {
      await runRepairPass({ club, teamId, freshById, clubPlayerIds });
    }

    clubsSynced++;
  }

  // Fire the post-match stats pipeline for every fixture that transitioned to
  // "finished" this sweep.  Each fixture's player set is the union of all club
  // player IDs that were linked to it, deduplicated across clubs.
  //
  // Fired with .catch() so a stats failure never aborts the fixture-sweep
  // result.  The daily player-stats job remains as a catch-all for anything
  // the trigger misses (API outage, server restart mid-sync, etc.).
  if (allNewlyFinished.size > 0) {
    // Lazy require avoids circular import: playerStatsSync → apiFootballSync.
    const { syncStatsForFinishedFixture } = require("./playerStatsSync") as typeof import("./playerStatsSync");
    dispatchPostMatchTriggers(allNewlyFinished, syncStatsForFinishedFixture);
  }

  // National-team repair pass: link players with finished NT match history to
  // all upcoming NT fixtures in the same competition.  No-op today (no tracked
  // youth players), but activates automatically when roster data is added.
  try {
    await runNationalTeamRepairPass();
  } catch (err) {
    logger.warn({ err }, "NT repair pass failed — will retry on next sync cycle");
  }

  // Purge postponed fixtures whose original kickoff was more than 24 hours ago.
  // Runs once per sync cycle (not per club) so the cutoff is consistent across
  // all clubs. A failure here must never abort the sync result — the purge is
  // best-effort cleanup, not a correctness requirement.
  let purgedPostponed = 0;
  try {
    const purgeResult = await purgeStalePostponedFixtures();
    purgedPostponed = purgeResult.purged;
  } catch (err) {
    logger.warn({ err }, "Stale postponed fixture purge failed — will retry on next sync cycle");
  }

  logger.info(
    { clubsSynced, fixturesUpserted, fixturesReconciled, fixturesRemoved, purgedPostponed, failures },
    "API-Football fixtures sync complete",
  );
  return { clubsSynced, fixturesUpserted, fixturesReconciled, fixturesRemoved, failures };
}

/**
 * Syncs scores and statuses for seeded national-team fixtures
 * (`is_national_team = true`) where USA is a participant. Because seeded rows
 * have no `api_football_fixture_id`, matching is done by kickoff date (±1 day)
 * against the USMNT's fixture list from API-Football. On first successful
 * match, the `api_football_fixture_id` is written back so future runs can join
 * directly without the date scan.
 */
export async function syncNationalTeamFixtures(): Promise<{
  fixturesChecked: number;
  fixturesUpdated: number;
  idsBound: number;
  phantomsPurged: number;
  failures: number;
}> {
  const teamId = await resolveUsmntTeamId();
  if (!teamId) {
    logger.warn("NT fixture sync: could not resolve USMNT team id — skipping");
    return { fixturesChecked: 0, fixturesUpdated: 0, idsBound: 0, phantomsPurged: 0, failures: 1 };
  }

  // Fetch the current and previous season so fixtures right around a calendar
  // boundary (e.g. a Dec qualifier whose season label is the prior year) are
  // still caught.
  const currentYear = new Date().getUTCFullYear();
  let afFixtures: AfFixture[] = [];
  for (const season of [currentYear, currentYear - 1]) {
    try {
      const fetched = await afFetch<AfFixture[]>(`/fixtures?team=${teamId}&season=${season}`);
      afFixtures = afFixtures.concat(fetched);
    } catch (err) {
      logger.warn({ err, season }, "NT fixture sync: API-Football fetch failed for season");
    }
  }

  if (afFixtures.length === 0) {
    logger.warn("NT fixture sync: no fixtures returned from API-Football for USMNT");
    return { fixturesChecked: 0, fixturesUpdated: 0, idsBound: 0, phantomsPurged: 0, failures: 1 };
  }

  // Keyed by API-Football fixture id for O(1) lookups once an id is bound.
  const afByFixtureId = new Map<number, AfFixture>(afFixtures.map((f) => [f.fixture.id, f]));

  // Load every seeded national-team fixture — only rows with no
  // api_football_fixture_id still need the date-based scan; already-bound
  // rows use the id directly.
  const seededRows = await db
    .select({
      id: fixturesTable.id,
      apiFootballFixtureId: fixturesTable.apiFootballFixtureId,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      kickoff: fixturesTable.kickoff,
      status: fixturesTable.status,
      homeScore: fixturesTable.homeScore,
      awayScore: fixturesTable.awayScore,
    })
    .from(fixturesTable)
    .where(eq(fixturesTable.isNationalTeam, true));

  // Only act on rows where USA is a participant (the table may also contain
  // opponent-only fixtures for context, but we can only update what we can
  // correctly match via the USMNT fixture list).
  const usaRows = seededRows.filter((f) => f.homeTeam === "USA" || f.awayTeam === "USA");

  let fixturesUpdated = 0;
  let idsBound = 0;
  let failures = 0;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const row of usaRows) {
    try {
      let afMatch: AfFixture | undefined;

      if (row.apiFootballFixtureId !== null) {
        // Already bound — look up directly, no date scan needed.
        afMatch = afByFixtureId.get(row.apiFootballFixtureId);
      } else {
        // Unbound — match by kickoff within ±1 day. Use a generous window
        // because API-Football stores UTC times and seeded kickoffs may have
        // been entered in local time; ±1 day covers any plausible timezone
        // difference while remaining unambiguous for USMNT fixtures (they
        // rarely play more than once in a 48-hour span).
        const kickoffMs = row.kickoff.getTime();
        afMatch = afFixtures.find((af) => {
          const afMs = new Date(af.fixture.date).getTime();
          return Math.abs(afMs - kickoffMs) <= ONE_DAY_MS;
        });
      }

      if (!afMatch) continue; // future fixture not yet in API-Football, or no date match

      const newStatus = mapStatus(afMatch.fixture.status.short);
      const newHomeScore = afMatch.goals.home ?? null;
      const newAwayScore = afMatch.goals.away ?? null;
      const needsIdBind = row.apiFootballFixtureId === null;

      const statusChanged = row.status !== newStatus;
      const scoresChanged = row.homeScore !== newHomeScore || row.awayScore !== newAwayScore;

      if (!statusChanged && !scoresChanged && !needsIdBind) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatePayload: Record<string, any> = {
        status: newStatus,
        homeScore: newHomeScore,
        awayScore: newAwayScore,
        elapsedMinute: newStatus === "live" ? (afMatch.fixture.status.elapsed ?? null) : null,
      };
      if (needsIdBind) {
        updatePayload["apiFootballFixtureId"] = afMatch.fixture.id;
        idsBound++;
      }

      await db.update(fixturesTable).set(updatePayload).where(eq(fixturesTable.id, row.id));
      fixturesUpdated++;

      logger.info(
        {
          fixtureId: row.id,
          afFixtureId: afMatch.fixture.id,
          status: newStatus,
          homeScore: newHomeScore,
          awayScore: newAwayScore,
          idBound: needsIdBind,
        },
        "NT fixture sync: updated fixture",
      );
    } catch (err) {
      logger.warn({ err, fixtureId: row.id }, "NT fixture sync: failed to update fixture row");
      failures++;
    }
  }

  // Purge upcoming seeded NT fixtures that API-Football has no knowledge of.
  // These are speculative entries (kickoff still in the future, never matched
  // to an API-Football id) that don't correspond to real announced matches.
  // A real fixture scheduled within the next 90 days would appear in API-
  // Football's USMNT season schedule — if it doesn't, it's a phantom.
  // Using 90 days because API-Football typically lists fixtures 2–3 months out.
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  let phantomsPurged = 0;

  for (const row of usaRows) {
    if (row.apiFootballFixtureId !== null) continue; // already bound — not a phantom
    const kickoffMs = row.kickoff.getTime();
    if (kickoffMs <= nowMs) continue; // past fixture — leave historical rows alone
    if (kickoffMs > nowMs + NINETY_DAYS_MS) continue; // too far out — may not be in API-Football yet

    // If no afFixture falls within ±1 day of this kickoff, it's unresolvable.
    const hasApiMatch = afFixtures.some(
      (af) => Math.abs(new Date(af.fixture.date).getTime() - kickoffMs) <= ONE_DAY_MS,
    );
    if (hasApiMatch) continue;

    logger.warn(
      { fixtureId: row.id, homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoff: row.kickoff },
      "NT fixture sync: upcoming seeded fixture has no API-Football match within 90-day window — purging as phantom",
    );
    try {
      await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, row.id));
      await db.delete(fixturesTable).where(eq(fixturesTable.id, row.id));
      phantomsPurged++;
    } catch (err) {
      logger.warn({ err, fixtureId: row.id }, "NT fixture sync: failed to purge phantom fixture");
      failures++;
    }
  }

  const result = { fixturesChecked: usaRows.length, fixturesUpdated, idsBound, phantomsPurged, failures };
  logger.info(result, "National-team fixture sync complete");
  return result;
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Polls only the fixtures that are currently "live" in the DB, fetching each
 * one by its API-Football fixture id.  Makes zero API calls when there are no
 * live fixtures, so quota cost during quiet periods is nil.
 *
 * When a live fixture transitions to "finished" the post-match stats pipeline
 * is fired immediately — same logic as the hourly sweep — so profiles update
 * within 5 minutes of a final whistle rather than waiting until the next
 * hourly tick.
 *
 * Exported so it can be called from integration tests or a manual admin route.
 */
export async function pollLiveFixtures(): Promise<{ polled: number; updated: number; newlyFinished: number }> {
  const liveRows = await db
    .select({
      id: fixturesTable.id,
      apiFootballFixtureId: fixturesTable.apiFootballFixtureId,
      homeScore: fixturesTable.homeScore,
      awayScore: fixturesTable.awayScore,
    })
    .from(fixturesTable)
    .where(and(eq(fixturesTable.status, "live"), isNotNull(fixturesTable.apiFootballFixtureId)));

  if (liveRows.length === 0) return { polled: 0, updated: 0, newlyFinished: 0 };

  let updated = 0;
  let newlyFinished = 0;

  for (const row of liveRows) {
    if (row.apiFootballFixtureId === null) continue;
    try {
      const results = await afFetch<AfFixture[]>(`/fixtures?id=${row.apiFootballFixtureId}`);
      const fresh = results[0];
      if (!fresh) continue;

      const freshStatus = mapStatus(fresh.fixture.status.short);
      const freshHomeScore = fresh.goals.home ?? null;
      const freshAwayScore = fresh.goals.away ?? null;
      const freshElapsed = freshStatus === "live" ? (fresh.fixture.status.elapsed ?? null) : null;

      // Skip no-op writes: still live, score unchanged.
      if (freshStatus === "live" && row.homeScore === freshHomeScore && row.awayScore === freshAwayScore) continue;

      await db
        .update(fixturesTable)
        .set({ status: freshStatus, homeScore: freshHomeScore, awayScore: freshAwayScore, elapsedMinute: freshElapsed })
        .where(eq(fixturesTable.id, row.id));
      updated++;
      logger.info(
        { fixtureId: row.id, apiFootballFixtureId: row.apiFootballFixtureId, freshStatus, freshHomeScore, freshAwayScore },
        "Live poll: updated fixture",
      );

      // Fixture just finished — schedule post-match stats pipeline after the
      // delay so API-Football has time to populate individual player stats.
      if (freshStatus === "finished") {
        newlyFinished++;
        const links = await db
          .select({ playerId: fixturePlayersTable.playerId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, row.id));
        const playerIds = links.map((l) => l.playerId);
        if (playerIds.length > 0) {
          const { syncStatsForFinishedFixture } = require("./playerStatsSync") as typeof import("./playerStatsSync");
          logger.info(
            { fixtureId: row.id, playerCount: playerIds.length, delayMinutes: POST_MATCH_STATS_DELAY_MINUTES },
            "Live poll: post-match stats pipeline scheduled — waiting for API-Football stats to populate",
          );
          scheduleLivePollStatsSync(row.id, playerIds, syncStatsForFinishedFixture);
        }
      }
    } catch (err) {
      logger.warn({ err, fixtureId: row.id, apiFootballFixtureId: row.apiFootballFixtureId }, "Live poll: failed to fetch/update fixture");
    }
  }

  logger.info({ polled: liveRows.length, updated, newlyFinished }, "Live fixture poll complete");
  return { polled: liveRows.length, updated, newlyFinished };
}

/** Runs the sync immediately, then hourly (matches the recommended fixtures refresh cadence). */
export function startApiFootballSyncSchedule(intervalMs = 60 * 60 * 1000): void {
  if (!process.env["API_FOOTBALL_KEY"]) {
    logger.warn("API_FOOTBALL_KEY not set — skipping live fixtures sync, using seeded fixtures only");
    return;
  }
  const { claimSyncRun } = require("./syncGuard") as typeof import("./syncGuard");
  const COOLDOWN = 50 * 60 * 1000; // 50 min — skip startup re-run if already ran this hour
  const run = async () => {
    if (!(await claimSyncRun("fixtures", COOLDOWN))) return;
    // Run club fixtures and NT fixtures in sequence — both share the same
    // rate-limited afFetch queue so they naturally throttle each other.
    syncApiFootballFixtures().catch((err) => logger.error({ err }, "API-Football fixtures sync failed"));
    syncNationalTeamFixtures().catch((err) => logger.error({ err }, "NT fixture sync failed"));
  };
  run();
  intervalHandle = setInterval(run, intervalMs);

  // ── Live fixture polling loop ────────────────────────────────────────────
  // Runs alongside the hourly sweep but only touches fixtures currently marked
  // "live" in the DB.  Quota cost is zero during quiet periods (no live rows →
  // no API calls).  An in-process mutex prevents concurrent runs from racing;
  // the shared afFetch throttle ensures this loop and the hourly sweep don't
  // burst the per-minute rate limit even if they happen to overlap.
  //
  // Interval is controlled by LIVE_POLL_INTERVAL_MS (default: 5 minutes).
  // Set to 0 or a negative value to disable the live-poll loop entirely.
  // Non-numeric or empty values are rejected and fall back to the default
  // with a warning rather than silently passing NaN to setInterval.
  const DEFAULT_LIVE_POLL_MS = 5 * 60 * 1000;
  const rawLivePollEnv = process.env["LIVE_POLL_INTERVAL_MS"];
  let livePollIntervalMs: number;
  if (rawLivePollEnv === undefined) {
    livePollIntervalMs = DEFAULT_LIVE_POLL_MS;
  } else {
    const parsed = Number(rawLivePollEnv);
    if (rawLivePollEnv.trim() === "" || !Number.isFinite(parsed)) {
      logger.warn(
        { rawLivePollEnv, defaultMs: DEFAULT_LIVE_POLL_MS },
        "LIVE_POLL_INTERVAL_MS is not a valid finite number — falling back to default",
      );
      livePollIntervalMs = DEFAULT_LIVE_POLL_MS;
    } else {
      livePollIntervalMs = parsed;
    }
  }

  if (livePollIntervalMs <= 0) {
    logger.info(
      { livePollIntervalMs },
      "Live fixture poll loop DISABLED (LIVE_POLL_INTERVAL_MS ≤ 0)",
    );
  } else {
    logger.info(
      { livePollIntervalMs },
      "Live fixture poll loop starting",
    );
    let liveLoopRunning = false;
    const livePoll = async () => {
      if (liveLoopRunning) {
        logger.debug("Live fixture poll skipped — previous run still in progress");
        return;
      }
      liveLoopRunning = true;
      try {
        await pollLiveFixtures();
      } catch (err) {
        logger.error({ err }, "Live fixture poll failed");
      } finally {
        liveLoopRunning = false;
      }
    };
    setInterval(livePoll, livePollIntervalMs);
  }
}

export function stopApiFootballSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
