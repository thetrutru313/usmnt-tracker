import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";

const BASE_URL = "https://v3.football.api-sports.io";
// Free plan is rate-limited to ~10 requests/minute. Space calls out generously
// (one every 7s) so a full club sync (2 calls/club) doesn't trip 429s.
const MIN_REQUEST_INTERVAL_MS = 7000;
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

interface AfFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601 with offset
    status: { short: string }; // e.g. NS (not started), FT (finished), PST (postponed)
    venue: { name: string | null };
  };
  league: { name: string };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
  goals: { home: number | null; away: number | null };
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

export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const POSTPONED_STATUSES = new Set(["PST", "CANC", "ABD"]);

function mapStatus(short: string): string {
  if (FINISHED_STATUSES.has(short)) return "finished";
  if (POSTPONED_STATUSES.has(short)) return "postponed";
  if (short === "1H" || short === "2H" || short === "HT" || short === "ET" || short === "LIVE") return "live";
  return "scheduled";
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

export async function syncApiFootballFixtures(): Promise<{ clubsSynced: number; fixturesUpserted: number; fixturesReconciled: number; fixturesRemoved: number; failures: number }> {
  await backfillLegacyFixturePlayerClubIds();

  const clubs = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const players = await db.select({ id: playersTable.id, clubId: playersTable.clubId }).from(playersTable);
  const playersByClub = new Map<number, typeof players>();
  for (const p of players) playersByClub.set(p.clubId, [...(playersByClub.get(p.clubId) ?? []), p]);

  let clubsSynced = 0;
  let fixturesUpserted = 0;
  let fixturesReconciled = 0;
  let fixturesRemoved = 0;
  let failures = 0;

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
    // while still stuck at "scheduled" is exactly the stale case we're
    // after. Only fixtures linked to this club's players are checked here,
    // since that's the scope this sync can safely reason about without extra
    // rate-limited API calls.
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
    if (clubPlayerIds.length > 0) {
      const trackedRows = await db
        .select({
          id: fixturesTable.id,
          apiFootballFixtureId: fixturesTable.apiFootballFixtureId,
          homeTeam: fixturesTable.homeTeam,
          awayTeam: fixturesTable.awayTeam,
          kickoff: fixturesTable.kickoff,
        })
        .from(fixturesTable)
        .innerJoin(fixturePlayersTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
        .where(and(inArray(fixturePlayersTable.playerId, clubPlayerIds), eq(fixturesTable.status, "scheduled")));

      const trackedFixtures = new Map(trackedRows.map((row) => [row.id, row]));
      for (const tracked of trackedFixtures.values()) {
        if (tracked.apiFootballFixtureId === null) continue;
        const fresh = freshById.get(tracked.apiFootballFixtureId);
        if (fresh) {
          const freshStatus = mapStatus(fresh.fixture.status.short);
          if (freshStatus !== "scheduled") {
            await db
              .update(fixturesTable)
              .set({ status: freshStatus, homeScore: fresh.goals.home, awayScore: fresh.goals.away })
              .where(eq(fixturesTable.id, tracked.id));
            logger.info(
              {
                fixtureId: tracked.id,
                apiFootballFixtureId: tracked.apiFootballFixtureId,
                homeTeam: tracked.homeTeam,
                awayTeam: tracked.awayTeam,
                newStatus: freshStatus,
              },
              "Reconciled fixture that was stuck as 'scheduled' to the provider's current status",
            );
            fixturesReconciled++;
          }
        } else if (!removalsTrustworthy) {
          // A season fetch failed this run, so we can't tell whether this
          // fixture is genuinely gone or just missing because of that
          // failure. Leave it alone — a future run with a clean fetch will
          // resolve it correctly.
          continue;
        } else if (tracked.kickoff.getTime() >= now) {
          // Missing from a fully-successful fetch, but still in the future —
          // too risky to delete a fixture that hasn't happened yet on a
          // single "not found" signal (could be a provider hiccup or a
          // fixture rescheduled outside the season window we queried).
          // Flag it for review instead; if it's genuinely gone, it'll also be
          // missing once its kickoff has passed, and will be removed then.
          logger.warn(
            {
              fixtureId: tracked.id,
              apiFootballFixtureId: tracked.apiFootballFixtureId,
              homeTeam: tracked.homeTeam,
              awayTeam: tracked.awayTeam,
              kickoff: tracked.kickoff,
              club: club.name,
            },
            "Tracked upcoming fixture is missing from API-Football's fresh pull — flagging for review, not removing",
          );
        } else {
          // Kickoff has already passed and a fully-successful fetch no
          // longer lists this fixture at all — e.g. a bracket match already
          // decided elsewhere. Safe to remove rather than leaving a match on
          // the Dashboard/Fixtures pages that will never actually happen.
          await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, tracked.id));
          await db.delete(fixturesTable).where(eq(fixturesTable.id, tracked.id));
          logger.warn(
            {
              fixtureId: tracked.id,
              apiFootballFixtureId: tracked.apiFootballFixtureId,
              homeTeam: tracked.homeTeam,
              awayTeam: tracked.awayTeam,
              kickoff: tracked.kickoff,
              club: club.name,
            },
            "Removed stale past-kickoff fixture no longer confirmed by API-Football",
          );
          fixturesRemoved++;
        }
      }
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
    clubsSynced++;
  }

  logger.info(
    { clubsSynced, fixturesUpserted, fixturesReconciled, fixturesRemoved, failures },
    "API-Football fixtures sync complete",
  );
  return { clubsSynced, fixturesUpserted, fixturesReconciled, fixturesRemoved, failures };
}

let intervalHandle: NodeJS.Timeout | null = null;

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
    syncApiFootballFixtures().catch((err) => logger.error({ err }, "API-Football fixtures sync failed"));
  };
  run();
  intervalHandle = setInterval(run, intervalMs);
}

export function stopApiFootballSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
