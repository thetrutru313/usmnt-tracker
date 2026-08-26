// ---------------------------------------------------------------------------
// Team-nationality cache — the authoritative discriminator for "is this
// stat block a national-team appearance, or a club competition whose name
// happens to contain a national-team-sounding word (e.g. CONCACAF Champions
// League, FIFA Club World Cup)".
//
// API-Football's `/teams?id=` endpoint returns a `national` boolean on the
// team object — this is ground truth, unlike inferring from league name.
// A team's national/club status never changes, so once resolved it is
// cached permanently in `api_football_teams` and never re-fetched.
// ---------------------------------------------------------------------------

import { db, apiFootballTeamsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { afFetch, isLikelyNationalTeamName } from "./apiFootballSync";
import { logger } from "./logger";

interface AfTeamLookupResponse {
  team: {
    id: number;
    name: string;
    country: string | null;
    national?: boolean;
  };
}

/**
 * Resolves whether an API-Football team id represents a national team.
 *
 * `team.national` from `/teams?id=` is the primary, authoritative signal —
 * but it is known to be unreliable specifically for national *youth* teams
 * (e.g. United States U20 / team 10306 returns `national: false`; see
 * `isLikelyNationalTeamName` in apiFootballSync.ts, which exists precisely
 * for this gap). `teamName` is used only as an OR-backstop to catch that
 * false-negative case — it can never turn a real club into a "national"
 * result for the names it matches (youth-suffix patterns, or the exact
 * strings "USA"/"United States"), so it does not reopen the original bug
 * (club *competition* names like "CONCACAF Champions League" being read as
 * evidence of a national-team appearance). Once a team id is cached, later
 * calls skip the name check entirely — the API flag alone decided it.
 *
 * Fails closed: a missing id, a failed lookup, or an empty API-Football
 * response all return `false` (treated as a club, i.e. not counted as a
 * national-team appearance) and log a warning rather than guessing. This is
 * the deliberately safer error — under-counting a dual national costs a
 * second manual look, while a false flag silently buries a US-eligible
 * prospect in the DUAL_NATIONAL bucket.
 */
export async function isTeamNational(
  teamId: number | undefined | null,
  teamName?: string,
): Promise<boolean> {
  if (teamId == null) {
    logger.warn("Team-nationality lookup: stat block has no team id — treating as non-national");
    return false;
  }

  const [cached] = await db
    .select()
    .from(apiFootballTeamsTable)
    .where(eq(apiFootballTeamsTable.apiFootballTeamId, teamId))
    .limit(1);
  if (cached) return cached.isNational;

  let data: AfTeamLookupResponse[];
  try {
    data = await afFetch<AfTeamLookupResponse[]>(`/teams?id=${teamId}`);
  } catch (err) {
    logger.warn({ err, teamId }, "Team-nationality lookup failed — treating as non-national");
    return false;
  }

  const team = data[0]?.team;
  if (!team) {
    logger.warn({ teamId }, "Team-nationality lookup: API-Football returned no team — treating as non-national");
    return false;
  }

  const isNational = team.national === true || isLikelyNationalTeamName(teamName ?? team.name);

  // A club never becomes a national team and vice versa — cache permanently.
  // onConflictDoNothing guards a race between concurrent callers resolving
  // the same unknown team id at once; whichever insert lands first wins and
  // both callers already have the resolved value in hand to return.
  await db
    .insert(apiFootballTeamsTable)
    .values({
      apiFootballTeamId: teamId,
      name: team.name,
      country: team.country,
      isNational,
    })
    .onConflictDoNothing();

  return isNational;
}

export type { AfTeamLookupResponse };
