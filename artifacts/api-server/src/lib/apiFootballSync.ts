import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const BASE_URL = "https://v3.football.api-sports.io";
// Free plan is rate-limited to ~10 requests/minute. Space calls out generously
// (one every 7s) so a full club sync (2 calls/club) doesn't trip 429s.
const MIN_REQUEST_INTERVAL_MS = 7000;
const MAX_RETRIES = 2;

function apiKey(): string {
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

async function afFetch<T>(path: string, attempt = 0): Promise<T> {
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
}

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const POSTPONED_STATUSES = new Set(["PST", "CANC", "ABD"]);

function mapStatus(short: string): string {
  if (FINISHED_STATUSES.has(short)) return "finished";
  if (POSTPONED_STATUSES.has(short)) return "postponed";
  if (short === "1H" || short === "2H" || short === "HT" || short === "ET" || short === "LIVE") return "live";
  return "scheduled";
}

/** Finds (and caches) a club's API-Football team id via the team search endpoint. */
async function resolveTeamId(club: { id: number; name: string; apiFootballTeamId: number | null }): Promise<number | null> {
  if (club.apiFootballTeamId) return club.apiFootballTeamId;

  try {
    const results = await afFetch<AfTeamSearchResult[]>(`/teams?search=${encodeURIComponent(club.name)}`);
    const match = results[0];
    if (!match) {
      logger.warn({ club: club.name }, "API-Football team search returned no match");
      return null;
    }
    await db.update(clubsTable).set({ apiFootballTeamId: match.team.id }).where(eq(clubsTable.id, club.id));
    return match.team.id;
  } catch (err) {
    logger.warn({ err, club: club.name }, "API-Football team search failed");
    return null;
  }
}

/**
 * Syncs upcoming club fixtures from API-Football for every club that has a
 * tracked player. National-team fixtures (World Cup qualifiers etc.) stay
 * curated/seeded — API-Football club fixtures are the part that changes
 * weekly and is impractical to hand-maintain.
 */
export async function syncApiFootballFixtures(): Promise<{ clubsSynced: number; fixturesUpserted: number; failures: number }> {
  const clubs = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const players = await db.select({ id: playersTable.id, clubId: playersTable.clubId }).from(playersTable);
  const playersByClub = new Map<number, number[]>();
  for (const p of players) playersByClub.set(p.clubId, [...(playersByClub.get(p.clubId) ?? []), p.id]);

  let clubsSynced = 0;
  let fixturesUpserted = 0;
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
    for (const season of [currentYear, currentYear - 1]) {
      try {
        const fixtures = await afFetch<AfFixture[]>(`/fixtures?team=${teamId}&season=${season}`);
        seasonFixtures = seasonFixtures.concat(fixtures);
      } catch (err) {
        logger.warn({ err, club: club.name, teamId, season }, "API-Football fixtures fetch failed for season");
      }
      if (seasonFixtures.some((f) => f.fixture.status.short === "NS" && new Date(f.fixture.date).getTime() > now)) break;
    }

    const upcoming = seasonFixtures
      .filter((f) => f.fixture.status.short === "NS" && new Date(f.fixture.date).getTime() > now)
      .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime())
      .slice(0, 8);

    if (upcoming.length === 0 && seasonFixtures.length === 0) {
      failures++;
      continue;
    }

    for (const f of upcoming) {
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

      const linkedPlayerIds = playersByClub.get(club.id) ?? [];
      if (linkedPlayerIds.length > 0) {
        const existingLinks = await db
          .select({ playerId: fixturePlayersTable.playerId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, fixtureId));
        const alreadyLinked = new Set(existingLinks.map((l) => l.playerId));
        const toLink = linkedPlayerIds.filter((id) => !alreadyLinked.has(id));
        if (toLink.length > 0) {
          await db.insert(fixturePlayersTable).values(toLink.map((playerId) => ({ fixtureId, playerId })));
        }
      }
      fixturesUpserted++;
    }
    clubsSynced++;
  }

  logger.info({ clubsSynced, fixturesUpserted, failures }, "API-Football fixtures sync complete");
  return { clubsSynced, fixturesUpserted, failures };
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
