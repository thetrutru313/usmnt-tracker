import { db, clubsTable, playersTable, transfersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch } from "./apiFootballSync";

interface AfSquadPlayer {
  id: number;
  name: string;
}

interface AfSquadResponse {
  team: { id: number; name: string };
  players: AfSquadPlayer[];
}

interface AfPlayerProfile {
  player: { id: number; name: string; firstname: string; lastname: string; nationality: string };
}

interface AfTransfer {
  date: string; // YYYY-MM-DD
  // API-Football overloads this field with either a fee ("€5M", "Free") or "Loan".
  type: string | null;
  teams: {
    in: { id: number; name: string; logo: string | null };
    out: { id: number; name: string; logo: string | null };
  };
}

interface AfTransfersResponse {
  player: { id: number; name: string };
  transfers: AfTransfer[];
}

type ClubRow = { id: number; name: string; apiFootballTeamId: number | null };
type PlayerRow = { id: number; name: string; clubId: number; apiFootballPlayerId: number | null };

/** Loose name matching: lowercase, strip accents/punctuation, collapse whitespace. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves API-Football player ids for players missing one by fetching each
 * distinct on-file club's full squad once (far cheaper than one search call
 * per player) and matching by normalized name. Players not found in their
 * on-file club's current squad — most often because they already transferred
 * away — are left unresolved here; the caller falls back to a per-player
 * name search for those, which is exactly the case that matters most.
 */
async function resolvePlayerIdsViaSquads(players: PlayerRow[], clubsById: Map<number, ClubRow>): Promise<void> {
  const unresolved = players.filter((p) => !p.apiFootballPlayerId);
  const clubIds = [...new Set(unresolved.map((p) => p.clubId))];

  for (const clubId of clubIds) {
    const club = clubsById.get(clubId);
    if (!club?.apiFootballTeamId) continue;
    const clubPlayers = unresolved.filter((p) => p.clubId === clubId);
    if (clubPlayers.length === 0) continue;

    try {
      const squads = await afFetch<AfSquadResponse[]>(`/players/squads?team=${club.apiFootballTeamId}`);
      const roster = squads[0]?.players ?? [];
      const byName = new Map(roster.map((r) => [normalizeName(r.name), r.id]));
      for (const player of clubPlayers) {
        const match = byName.get(normalizeName(player.name));
        if (!match) continue;
        await db.update(playersTable).set({ apiFootballPlayerId: match }).where(eq(playersTable.id, player.id));
        player.apiFootballPlayerId = match;
      }
    } catch (err) {
      logger.warn({ err, club: club.name }, "API-Football squad fetch failed while resolving player ids");
    }
  }
}

/**
 * Fallback for a single player not found in their on-file club's squad —
 * searches by name directly. API-Football's `search` param only accepts
 * alphanumeric characters/spaces (accented names like "Sergiño Dest" 400) and
 * matches against `firstname`/`lastname`/short display name, not our stored
 * "Firstname Lastname" string (e.g. "Christian Pulisic" returns zero results
 * even though "Pulisic" alone matches) — so search on the surname only.
 *
 * Common surnames are ambiguous: e.g. searching "Richards" for our "Chris
 * Richards" (USMNT defender) also returns an unrelated USA-nationality lower
 * league player with the same surname (id 102616, "Brent Anthony Richards").
 * Require BOTH an exact surname match AND a matching first-name initial
 * (plus USA nationality preference) before accepting a candidate — a wrong
 * id here would silently misattribute that player's future transfers, which
 * is worse than leaving the club unresolved for one run.
 */
async function resolvePlayerIdBySearch(player: { id: number; name: string }): Promise<number | null> {
  const normalized = normalizeName(player.name).split(" ");
  const surname = normalized.at(-1);
  const firstInitial = normalized[0]?.[0];
  if (!surname || !firstInitial) return null;
  try {
    const results = await afFetch<AfPlayerProfile[]>(`/players/profiles?search=${encodeURIComponent(surname)}`);
    const isCandidate = (r: AfPlayerProfile) =>
      normalizeName(r.player.lastname ?? "") === surname && normalizeName(r.player.firstname ?? "")[0] === firstInitial;
    const match = results.find((r) => isCandidate(r) && r.player.nationality === "USA") ?? results.find(isCandidate);
    if (!match) {
      logger.warn({ player: player.name }, "API-Football player search returned no confident match");
      return null;
    }
    await db.update(playersTable).set({ apiFootballPlayerId: match.player.id }).where(eq(playersTable.id, player.id));
    return match.player.id;
  } catch (err) {
    logger.warn({ err, player: player.name }, "API-Football player search failed");
    return null;
  }
}

/**
 * Keeps each tracked player's club current by checking API-Football's
 * transfer history for their most recent move. Only clubs already tracked in
 * our `clubs` table (i.e. previously resolved by the fixtures sync) are
 * considered valid destinations — a transfer to an untracked club is logged
 * and the player's last known club is left in place rather than guessing at
 * league/country details we don't have.
 */
export async function syncPlayerClubs(): Promise<{ playersChecked: number; clubsUpdated: number; failures: number }> {
  const players: PlayerRow[] = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      clubId: playersTable.clubId,
      apiFootballPlayerId: playersTable.apiFootballPlayerId,
    })
    .from(playersTable);
  const clubs: ClubRow[] = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const clubsById = new Map(clubs.map((c) => [c.id, c]));
  const clubsByApiFootballId = new Map(clubs.filter((c): c is ClubRow & { apiFootballTeamId: number } => c.apiFootballTeamId != null).map((c) => [c.apiFootballTeamId, c]));

  await resolvePlayerIdsViaSquads(players, clubsById);

  let playersChecked = 0;
  let clubsUpdated = 0;
  let failures = 0;

  for (const player of players) {
    let apiFootballPlayerId = player.apiFootballPlayerId;
    if (!apiFootballPlayerId) {
      apiFootballPlayerId = await resolvePlayerIdBySearch(player);
    }
    if (!apiFootballPlayerId) {
      failures++;
      continue;
    }

    try {
      const [transferData] = await afFetch<AfTransfersResponse[]>(`/transfers?player=${apiFootballPlayerId}`);
      playersChecked++;
      const transfers = transferData?.transfers ?? [];
      const now = Date.now();
      const latest = [...transfers]
        .filter((t) => t.date && new Date(t.date).getTime() <= now)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (!latest) continue;

      const currentClub = clubsById.get(player.clubId);
      if (currentClub?.apiFootballTeamId === latest.teams.in.id) continue; // already up to date

      const newClub = clubsByApiFootballId.get(latest.teams.in.id);
      if (!newClub) {
        logger.warn(
          { player: player.name, newClubName: latest.teams.in.name },
          "Player transferred to a club not tracked in our clubs table — keeping last known club",
        );
        continue;
      }

      const isLoan = (latest.type ?? "").toLowerCase().includes("loan");
      await db.update(playersTable).set({ clubId: newClub.id }).where(eq(playersTable.id, player.id));
      await db.insert(transfersTable).values({
        playerId: player.id,
        fromClub: currentClub?.name ?? latest.teams.out.name,
        toClub: newClub.name,
        transferType: isLoan ? "loan" : "transfer",
        fee: !isLoan ? (latest.type ?? null) : null,
        status: "confirmed",
        announcedAt: new Date(latest.date),
        summary: `${player.name} moved from ${currentClub?.name ?? latest.teams.out.name} to ${newClub.name} (synced from API-Football transfer history).`,
      });
      clubsUpdated++;
      logger.info({ player: player.name, from: currentClub?.name, to: newClub.name }, "Player club updated via API-Football sync");
    } catch (err) {
      failures++;
      logger.warn({ err, player: player.name }, "API-Football transfers fetch failed — keeping last known club");
    }
  }

  logger.info({ playersChecked, clubsUpdated, failures }, "API-Football player-club sync complete");
  return { playersChecked, clubsUpdated, failures };
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Runs the sync immediately, then daily — transfer windows and mid-season
 * moves don't need hourly checking, and this keeps the API request volume
 * (2 calls/club to resolve squads once, ~1 call/player thereafter) modest.
 */
export function startPlayerClubSyncSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
  if (!process.env["API_FOOTBALL_KEY"]) {
    logger.warn("API_FOOTBALL_KEY not set — skipping player-club sync, using seeded club assignments only");
    return;
  }
  syncPlayerClubs().catch((err) => logger.error({ err }, "Initial player-club sync failed"));
  intervalHandle = setInterval(() => {
    syncPlayerClubs().catch((err) => logger.error({ err }, "Scheduled player-club sync failed"));
  }, intervalMs);
}

export function stopPlayerClubSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
