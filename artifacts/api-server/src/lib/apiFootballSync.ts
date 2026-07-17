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
  team: { id: number; name: string; logo: string | null; national?: boolean };
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

function isReserveOrYouthTeam(name: string): boolean {
  return RESERVE_TEAM_PATTERN.test(name.trim());
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
 */
export async function backfillLegacyFixturePlayerClubIds(): Promise<{ backfilled: number }> {
  const result = await db.execute(sql`
    UPDATE fixture_players fp
    SET club_id = c.id
    FROM fixtures f
    JOIN clubs c ON (c.name = f.home_team OR c.name = f.away_team)
    WHERE fp.fixture_id = f.id
      AND f.is_national_team = false
      AND fp.club_id IS NULL
  `);
  const backfilled = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (backfilled > 0) {
    logger.info({ backfilled }, "Backfilled legacy fixture_players.club_id for pre-existing club-fixture links");
  }
  return { backfilled };
}

export async function syncApiFootballFixtures(
  /** When provided, only syncs fixtures for the given club DB ids. Clubs
   *  outside this list are skipped entirely, incurring zero additional API
   *  calls. The hourly scheduled run omits this parameter to sync all clubs. */
  clubIds?: number[],
): Promise<{ clubsSynced: number; fixturesUpserted: number; fixturesReconciled: number; fixturesRemoved: number; failures: number }> {
  await backfillLegacyFixturePlayerClubIds();

  const allClubs = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const clubs = clubIds ? allClubs.filter((c) => clubIds.includes(c.id)) : allClubs;
  const players = await db.select({ id: playersTable.id, clubId: playersTable.clubId }).from(playersTable);
  const playersByClub = new Map<number, typeof players>();
  for (const p of players) playersByClub.set(p.clubId, [...(playersByClub.get(p.clubId) ?? []), p]);

  let clubsSynced = 0;
  let fixturesUpserted = 0;
  let fixturesReconciled = 0;
  let fixturesRemoved = 0;
  let failures = 0;
  // Accumulates every fixture that transitioned to "finished" across all clubs
  // this sweep, keyed by fixture id to deduplicate clubs sharing a fixture.
  const allNewlyFinished = new Map<number, Set<number>>();

  for (const club of clubs) {
    const teamId = await resolveTeamId(club);
    if (!teamId) {
      failures++;
      continue;
    }

    // Free plan doesn't support the `next` param — pull the season's full
    // fixture list instead and filter to not-yet-started matches ourselves.
    // Straddle two season labels (leagues use Aug-May seasons, MLS uses the
    // calendar year) so we don't miss fixtures right around a season boundary.
    const now = Date.now();
    const currentYear = new Date(now).getUTCFullYear();
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
    // the next run. Only fixtures linked to this club's players are checked
    // here, since that's the scope this sync can safely reason about without
    // extra rate-limited API calls.
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
    const clubPlayerIds = (playersByClub.get(club.id) ?? []).map((p) => p.id);
    const reconciled = await reconcileClubFixtures({ club, clubPlayerIds, freshById, removalsTrustworthy, now });
    fixturesReconciled += reconciled.fixturesReconciled;
    fixturesRemoved += reconciled.fixturesRemoved;
    // Merge this club's newly-finished fixtures into the sweep-level map.
    for (const { fixtureId, playerIds } of reconciled.newlyFinished) {
      const existing = allNewlyFinished.get(fixtureId) ?? new Set<number>();
      for (const pid of playerIds) existing.add(pid);
      allNewlyFinished.set(fixtureId, existing);
    }

    for (const f of upcoming) {
      const broadcast = broadcastFor(f.league.name);
      const values = {
        apiFootballFixtureId: f.fixture.id,
        isNationalTeam: false,
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

      const clubPlayers = playersByClub.get(club.id) ?? [];
      const isReserveFixture = isReserveOrYouthTeam(f.teams.home.name) || isReserveOrYouthTeam(f.teams.away.name);
      const eligiblePlayers = isReserveFixture ? [] : clubPlayers;
      if (eligiblePlayers.length > 0) {
        const existingLinks = await db
          .select({ playerId: fixturePlayersTable.playerId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, fixtureId));
        const alreadyLinked = new Set(existingLinks.map((l) => l.playerId));
        const toLink = eligiblePlayers.filter((p) => !alreadyLinked.has(p.id)).map((p) => p.id);
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
    // The upsert loop above only covers the top-8 upcoming (NS) fixtures.
    // If a fixture was already in the DB from a previous cycle before the
    // player's API ID was resolved, the original link step ran with an empty
    // player list and left the fixture untagged.  This pass catches every
    // non-finished fixture for this club's season pull and fills in any
    // missing links, so club matches always show tagged players after the next
    // sweep following player-ID resolution.
    if (clubPlayerIds.length > 0) {
      const freshApiIds = [...freshById.keys()];
      if (freshApiIds.length > 0) {
        const dbFixtures = await db
          .select({ id: fixturesTable.id, homeTeam: fixturesTable.homeTeam, awayTeam: fixturesTable.awayTeam })
          .from(fixturesTable)
          .where(
            and(
              inArray(fixturesTable.apiFootballFixtureId, freshApiIds),
              inArray(fixturesTable.status, ["scheduled", "live"]),
            ),
          );

        for (const dbFixture of dbFixtures) {
          // Re-apply the reserve/youth guard using the team names already on
          // the DB row — no need to re-fetch from the API.
          if (isReserveOrYouthTeam(dbFixture.homeTeam) || isReserveOrYouthTeam(dbFixture.awayTeam)) continue;

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
    for (const [fixtureId, playerIdSet] of allNewlyFinished) {
      const playerIds = [...playerIdSet];
      logger.info(
        { fixtureId, playerCount: playerIds.length, delayMinutes: POST_MATCH_STATS_DELAY_MINUTES },
        "Hourly sweep: post-match stats pipeline scheduled — waiting for API-Football stats to populate",
      );
      // Delay by POST_MATCH_STATS_DELAY_MINUTES before fetching: API-Football
      // player statistics are typically not available until 15–30 minutes after
      // a final whistle, so syncing immediately yields empty results and no
      // match logs are written.  The daily job remains a catch-all for anything
      // the delayed trigger still misses (e.g. server restart during the wait).
      setTimeout(() => {
        syncStatsForFinishedFixture(playerIds).catch((err) =>
          logger.error(
            { err, fixtureId },
            "Post-match stats trigger failed — daily job remains as catch-all",
          ),
        );
      }, POST_MATCH_STATS_DELAY_MINUTES * 60 * 1000);
    }
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
  failures: number;
}> {
  const teamId = await resolveUsmntTeamId();
  if (!teamId) {
    logger.warn("NT fixture sync: could not resolve USMNT team id — skipping");
    return { fixturesChecked: 0, fixturesUpdated: 0, idsBound: 0, failures: 1 };
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
    return { fixturesChecked: 0, fixturesUpdated: 0, idsBound: 0, failures: 1 };
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

  const result = { fixturesChecked: usaRows.length, fixturesUpdated, idsBound, failures };
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
          setTimeout(() => {
            syncStatsForFinishedFixture(playerIds).catch((err) =>
              logger.error({ err, fixtureId: row.id }, "Live poll: post-match stats trigger failed"),
            );
          }, POST_MATCH_STATS_DELAY_MINUTES * 60 * 1000);
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
