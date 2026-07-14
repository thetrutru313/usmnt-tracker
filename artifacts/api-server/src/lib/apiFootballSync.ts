import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
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

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
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
  team: { id: number; name: string; logo: string | null };
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
// to a generic streaming-only entry for leagues not explicitly listed.
const BROADCAST_BY_LEAGUE: Record<string, { tvNetwork: string | null; streamingService: string }> = {
  "Premier League": { tvNetwork: "USA Network", streamingService: "Fubo" },
  "Championship": { tvNetwork: null, streamingService: "ESPN+" },
  "Serie A": { tvNetwork: "CBS Sports Network", streamingService: "Paramount+" },
  "La Liga": { tvNetwork: "ESPN Deportes", streamingService: "ESPN+" },
  "Bundesliga": { tvNetwork: null, streamingService: "ESPN+" },
  "Ligue 1": { tvNetwork: "beIN Sports", streamingService: "beIN Sports Connect" },
  "Eredivisie": { tvNetwork: null, streamingService: "ESPN+" },
  "Primeira Liga": { tvNetwork: null, streamingService: "ESPN+" },
  "Major League Soccer": { tvNetwork: "Apple TV", streamingService: "MLS Season Pass" },
  "UEFA Champions League": { tvNetwork: "CBS", streamingService: "Paramount+" },
  "UEFA Europa League": { tvNetwork: null, streamingService: "Paramount+" },
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

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
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

/** Finds (and caches) a club's API-Football team id via the team search endpoint. */
async function resolveTeamId(club: { id: number; name: string; apiFootballTeamId: number | null }): Promise<number | null> {
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
    await db
      .update(clubsTable)
      .set({ apiFootballTeamId: match.team.id, logoUrl: match.team.logo })
      .where(eq(clubsTable.id, club.id));
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
export async function syncApiFootballFixtures(): Promise<{ clubsSynced: number; fixturesUpserted: number; fixturesReconciled: number; fixturesRemoved: number; failures: number }> {
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
          await db.insert(fixturePlayersTable).values(toLink.map((playerId) => ({ fixtureId, playerId })));
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
  syncApiFootballFixtures().catch((err) => logger.error({ err }, "Initial API-Football sync failed"));
  intervalHandle = setInterval(() => {
    syncApiFootballFixtures().catch((err) => logger.error({ err }, "Scheduled API-Football sync failed"));
  }, intervalMs);
}

export function stopApiFootballSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
