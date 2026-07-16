import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const BASE_URL = "https://api.sportmonks.com/v3/football";

function apiToken(): string {
  const token = process.env["SPORTMONKS_API_TOKEN"];
  if (!token) throw new Error("SPORTMONKS_API_TOKEN is not set");
  return token;
}

async function smFetch<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}api_token=${apiToken()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sportmonks request failed (${res.status}): ${path} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface SmTeamSearchResult {
  data: { id: number; name: string; image_path: string | null }[];
}

interface SmParticipant {
  id: number;
  name: string;
  image_path: string | null;
  meta?: { location?: "home" | "away" };
}

interface SmUpcomingFixture {
  id: number;
  name: string;
  starting_at: string; // "YYYY-MM-DD HH:mm:ss" UTC
  state_id: number;
  league?: { name: string } | null;
  venue?: { name: string } | null;
  participants?: SmParticipant[];
}

interface SmTeamByIdResult {
  data: { id: number; name: string; upcoming?: SmUpcomingFixture[] };
}

// Sportmonks fixture state_id -> our status string. See docs.sportmonks.com states endpoint.
// 1 = Not Started, 22 = Postponed/Cancelled family, 5 = Finished (varies) — we keep this
// conservative: anything not explicitly "finished-like" defaults to "scheduled".
const FINISHED_STATE_IDS = new Set([5, 7, 8]);
const POSTPONED_STATE_IDS = new Set([9, 22, 23]);

function mapStatus(stateId: number): string {
  if (FINISHED_STATE_IDS.has(stateId)) return "finished";
  if (POSTPONED_STATE_IDS.has(stateId)) return "postponed";
  return "scheduled";
}

/** Finds (and caches) a club's Sportmonks team id via the team-search-by-name endpoint. */
async function resolveTeamId(club: { id: number; name: string; sportmonksTeamId: number | null }): Promise<number | null> {
  if (club.sportmonksTeamId) return club.sportmonksTeamId;

  try {
    const result = await smFetch<SmTeamSearchResult>(`/teams/search/${encodeURIComponent(club.name)}`);
    const match = result.data?.[0];
    if (!match) {
      logger.warn({ club: club.name }, "Sportmonks team search returned no match");
      return null;
    }
    await db.update(clubsTable).set({ sportmonksTeamId: match.id }).where(eq(clubsTable.id, club.id));
    return match.id;
  } catch (err) {
    logger.warn({ err, club: club.name }, "Sportmonks team search failed");
    return null;
  }
}

/**
 * Syncs upcoming club fixtures from Sportmonks for every club that has a
 * tracked player. National-team fixtures (World Cup qualifiers etc.) stay
 * curated/seeded — Sportmonks club fixtures are the part that changes weekly
 * and is impractical to hand-maintain.
 *
 * @param clubIds - Optional list of DB club IDs to sync. When omitted, all
 *   clubs are synced (the normal scheduled-sync path).
 */
export async function syncSportmonksFixtures(clubIds?: number[]): Promise<{ clubsSynced: number; fixturesUpserted: number; failures: number }> {
  const allClubs = await db
    .select({ id: clubsTable.id, name: clubsTable.name, sportmonksTeamId: clubsTable.sportmonksTeamId })
    .from(clubsTable);
  const clubs = clubIds ? allClubs.filter((c) => clubIds.includes(c.id)) : allClubs;
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

    let teamData: SmTeamByIdResult;
    try {
      teamData = await smFetch<SmTeamByIdResult>(`/teams/${teamId}?include=upcoming.participants;upcoming.league;upcoming.venue`);
    } catch (err) {
      logger.warn({ err, club: club.name, teamId }, "Sportmonks upcoming-fixtures fetch failed");
      failures++;
      continue;
    }

    const upcoming = teamData.data.upcoming ?? [];
    for (const f of upcoming) {
      const home = f.participants?.find((p) => p.meta?.location === "home");
      const away = f.participants?.find((p) => p.meta?.location === "away");
      if (!home || !away) continue;

      const values = {
        sportmonksFixtureId: f.id,
        isNationalTeam: false,
        competition: f.league?.name ?? "Unknown competition",
        kickoff: new Date(`${f.starting_at.replace(" ", "T")}Z`),
        venue: f.venue?.name ?? "TBD",
        homeTeam: home.name,
        awayTeam: away.name,
        homeLogoUrl: home.image_path,
        awayLogoUrl: away.image_path,
        status: mapStatus(f.state_id),
      };

      const [existing] = await db.select({ id: fixturesTable.id }).from(fixturesTable).where(eq(fixturesTable.sportmonksFixtureId, f.id));

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

  logger.info({ clubsSynced, fixturesUpserted, failures }, "Sportmonks fixtures sync complete");
  return { clubsSynced, fixturesUpserted, failures };
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Runs the sync immediately, then hourly (matches the recommended fixtures refresh cadence). */
export function startSportmonksSyncSchedule(intervalMs = 60 * 60 * 1000): void {
  if (!process.env["SPORTMONKS_API_TOKEN"]) {
    logger.warn("SPORTMONKS_API_TOKEN not set — skipping live fixtures sync, using seeded fixtures only");
    return;
  }
  syncSportmonksFixtures().catch((err) => logger.error({ err }, "Initial Sportmonks sync failed"));
  intervalHandle = setInterval(() => {
    syncSportmonksFixtures().catch((err) => logger.error({ err }, "Scheduled Sportmonks sync failed"));
  }, intervalMs);
}

export function stopSportmonksSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
