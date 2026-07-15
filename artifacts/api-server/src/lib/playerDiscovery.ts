import { db, clubsTable, playersTable, playerCandidatesTable } from "@workspace/db";
import { logger } from "./logger";
import { afFetch } from "./apiFootballSync";
import { isFriendlyLeague } from "./playerStatsSync";

// ---------------------------------------------------------------------------
// Scans squad rosters at every tracked club for US-eligible players not yet
// in the player pool. Qualified candidates are inserted into
// `player_candidates` for manual operator review — nothing is auto-promoted.
//
// Eligibility signals (checked in priority order):
//   1. nationality === "USA"                           → "nationality"
//   2. birth_country === "USA", no non-US senior caps  → "birth_country"
//   3. birth_country === "USA", has non-US senior caps → "dual_national_unconfirmed"
//   4. Neither signal + non-US senior caps             → skip
//
// Quality gate (must satisfy at least one):
//   - 5+ starts in the fetched season, OR
//   - 450+ minutes played in the fetched season
// ---------------------------------------------------------------------------

interface AfSquadPlayer {
  id: number;
  name: string;
}

interface AfSquadResponse {
  team: { id: number; name: string };
  players: AfSquadPlayer[];
}

interface AfDiscoveryStatBlock {
  team: { id: number; name: string };
  league: { name: string; season: number };
  games: {
    lineups: number | null;
    minutes: number | null;
    position: string | null;
    rating: string | null;
  };
}

interface AfDiscoveryResponse {
  player: {
    id: number;
    name: string;
    age: number | null;
    nationality: string | null;
    birth: { country: string | null; date: string | null };
  };
  statistics: AfDiscoveryStatBlock[];
}

const MIN_STARTS = 5;
const MIN_MINUTES = 450;

// National team competitions — presence of these league names in a stat block
// means the player appeared for a national team, not a club.
const NATIONAL_TEAM_RE =
  /world cup|nations league|euro\b|copa am[eé]rica|gold cup|concacaf|olympic|qualification|qualifier|continental championship|africa cup|asian cup|afcon/i;

function looksLikeNationalTeamCompetition(leagueName: string): boolean {
  return NATIONAL_TEAM_RE.test(leagueName) && !isFriendlyLeague(leagueName);
}

function hasSeniorNonUsCaps(statistics: AfDiscoveryStatBlock[]): boolean {
  return statistics.some(
    (s) =>
      looksLikeNationalTeamCompetition(s.league.name) &&
      s.team.name !== "United States" &&
      s.team.name !== "USA" &&
      (s.games.lineups ?? 0) > 0,
  );
}

function applyQualityGate(statistics: AfDiscoveryStatBlock[]): {
  passes: boolean;
  starts: number;
  minutes: number;
} {
  let starts = 0;
  let minutes = 0;
  for (const s of statistics) {
    if (isFriendlyLeague(s.league.name)) continue;
    starts += s.games.lineups ?? 0;
    minutes += s.games.minutes ?? 0;
  }
  return { passes: starts >= MIN_STARTS || minutes >= MIN_MINUTES, starts, minutes };
}

function computeAvgRating(statistics: AfDiscoveryStatBlock[]): string | null {
  let weightedSum = 0;
  let weight = 0;
  for (const s of statistics) {
    if (isFriendlyLeague(s.league.name)) continue;
    const mins = s.games.minutes ?? 0;
    const rating = s.games.rating != null ? parseFloat(s.games.rating) : null;
    if (rating != null && Number.isFinite(rating) && mins > 0) {
      weightedSum += rating * mins;
      weight += mins;
    }
  }
  return weight > 0 ? (weightedSum / weight).toFixed(2) : null;
}

function inferPosition(statistics: AfDiscoveryStatBlock[]): string | null {
  for (const s of statistics) {
    if (s.games.position) return s.games.position;
  }
  return null;
}

/**
 * Scans every tracked club's squad for unknown players, fetches their
 * API-Football profile, and inserts US-eligible starters as candidates.
 * Runs after each daily club sync (called from `syncPlayerClubs`).
 */
export async function discoverUSProspects(): Promise<{
  checked: number;
  inserted: number;
  skippedQuality: number;
  skippedEligibility: number;
}> {
  const clubs = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);

  const trackedClubs = clubs.filter(
    (c): c is typeof c & { apiFootballTeamId: number } => c.apiFootballTeamId != null,
  );

  // All API-Football IDs already tracked (players table) or previously evaluated (candidates table)
  const [trackedPlayers, existingCandidates] = await Promise.all([
    db.select({ apiFootballPlayerId: playersTable.apiFootballPlayerId }).from(playersTable),
    db.select({ apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId }).from(playerCandidatesTable),
  ]);

  const knownApiIds = new Set<number>([
    ...trackedPlayers.flatMap((p) => (p.apiFootballPlayerId != null ? [p.apiFootballPlayerId] : [])),
    ...existingCandidates.map((c) => c.apiFootballPlayerId),
  ]);

  const currentYear = new Date().getUTCFullYear();
  const seasonCandidates = [currentYear, currentYear - 1];

  let checked = 0;
  let inserted = 0;
  let skippedQuality = 0;
  let skippedEligibility = 0;

  for (const club of trackedClubs) {
    let roster: AfSquadPlayer[];
    try {
      const squads = await afFetch<AfSquadResponse[]>(`/players/squads?team=${club.apiFootballTeamId}`);
      roster = squads[0]?.players ?? [];
    } catch (err) {
      logger.warn({ err, club: club.name }, "Discovery: squad fetch failed, skipping club");
      continue;
    }

    const unknownPlayers = roster.filter((p) => !knownApiIds.has(p.id));
    if (unknownPlayers.length === 0) continue;

    for (const squadPlayer of unknownPlayers) {
      checked++;

      // Mark as known immediately so duplicate squad appearances across clubs
      // don't trigger multiple profile fetches for the same player in this run.
      knownApiIds.add(squadPlayer.id);

      // Try current season first, fall back to previous year.
      let profile: AfDiscoveryResponse | null = null;
      for (const season of seasonCandidates) {
        try {
          const results = await afFetch<AfDiscoveryResponse[]>(`/players?id=${squadPlayer.id}&season=${season}`);
          if (results[0]?.statistics?.length) {
            profile = results[0];
            break;
          }
        } catch {
          // Try the next season year
        }
      }

      if (!profile) continue; // no stats available — too new or not in API's coverage

      const { player, statistics } = profile;

      // Quality gate — reject bench-warmers before the (more interesting) eligibility check
      const { passes, starts, minutes } = applyQualityGate(statistics);
      if (!passes) {
        skippedQuality++;
        continue;
      }

      // Eligibility
      const nationality = player.nationality ?? null;
      const birthCountry = player.birth.country ?? null;
      const isUsNationality = nationality === "USA";
      const isUsBorn = birthCountry === "USA" || birthCountry === "United States";

      if (!isUsNationality && !isUsBorn) {
        skippedEligibility++;
        continue;
      }

      let eligibilityBasis: string;
      if (isUsNationality) {
        eligibilityBasis = "nationality";
      } else if (!hasSeniorNonUsCaps(statistics)) {
        eligibilityBasis = "birth_country";
      } else {
        // Born in the US but has senior caps for another country — flag for human review
        eligibilityBasis = "dual_national_unconfirmed";
      }

      const priorNationalTeamCaps = statistics
        .filter((s) => looksLikeNationalTeamCompetition(s.league.name))
        .reduce((sum, s) => sum + (s.games.lineups ?? 0), 0);

      try {
        const rows = await db
          .insert(playerCandidatesTable)
          .values({
            name: player.name,
            position: inferPosition(statistics),
            age: player.age ?? null,
            clubId: club.id,
            apiFootballPlayerId: player.id,
            nationality,
            birthCountry,
            currentSeasonStarts: starts,
            currentSeasonMinutes: minutes,
            currentSeasonRating: computeAvgRating(statistics),
            priorNationalTeamCaps: priorNationalTeamCaps > 0 ? priorNationalTeamCaps : null,
            eligibilityBasis,
            status: "pending",
          })
          .onConflictDoNothing() // unique on apiFootballPlayerId — already seen in a prior run
          .returning({ id: playerCandidatesTable.id });
        if (rows.length === 0) continue; // conflict — row already existed, not a new insertion
        inserted++;
        logger.info(
          { name: player.name, club: club.name, eligibilityBasis, starts, minutes },
          "Discovery: new US-eligible prospect inserted as candidate",
        );
      } catch (err) {
        logger.warn({ err, name: player.name, club: club.name }, "Discovery: candidate insert failed");
      }
    }
  }

  logger.info({ checked, inserted, skippedQuality, skippedEligibility }, "Discovery: US prospect scan complete");
  return { checked, inserted, skippedQuality, skippedEligibility };
}
