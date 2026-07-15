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
  player: { id: number; name: string; firstname: string; lastname: string; nationality: string; birth: { date: string | null } };
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
type PlayerRow = { id: number; name: string; clubId: number; apiFootballPlayerId: number | null; age?: number };

/**
 * Manually-verified API-Football player ids, kept as a pinned fast-path for
 * prospects that were once missed by the automated resolution — either
 * because they weren't in their on-file club's current squad listing, or
 * because `resolvePlayerIdBySearch` rejected the right person over a
 * nickname-vs-legal-name or compound-surname mismatch (see that function's
 * docs — it now handles both patterns generically, so this map is a safety
 * net rather than the only way these resolve).
 *
 * Each id below was verified against `/players/teams?player=<id>` history
 * (club/national-team history matching the player's known bio) rather than
 * trusting the search endpoint alone. Keyed by our stored player name so
 * this doubles as a lookup for the case where the row's id gets cleared
 * (e.g. a reseed) — checked before the squad/search resolution steps.
 */
export const KNOWN_PLAYER_IDS: Record<string, number> = {
  "Yunus Musah": 162106,
  "Diego Kochen": 383647,
  "Gaga Slonina": 201711,
  "Montrell Culbreath": 444961,
  "Nimfasha Berchimas": 401644,
  "Obed Vargas": 313383,
  "Paxten Aaronson": 265884,
  "Tanner Tessmann": 80752,
  "Alejandro Zendejas": 35885,
  // Verified 2026-07-15 against /players/squads?team=1599 (Philadelphia
  // Union's current squad) after `resolvePlayerIdBySearch` mismatched him to
  // id 427770 — "Cori Michelle Sullivan," an unrelated USWNT player who also
  // indexes as "C. Sullivan" (same surname + first initial + USA
  // nationality, which is all the search fallback checked). That wrong id
  // was surfacing as his photo showing a different, unrelated person.
  "Cavan Sullivan": 462853,
};

/**
 * Applies `KNOWN_PLAYER_IDS` to player rows before other resolution steps
 * run. Enforces the pinned id even when a row already has a *different*
 * `apiFootballPlayerId` set — some of these entries exist specifically to
 * correct a previously-resolved wrong id (e.g. Cavan Sullivan was
 * auto-matched to an unrelated player), so leaving already-set ids alone
 * would never actually fix them.
 */
async function applyKnownPlayerIdOverrides(players: PlayerRow[]): Promise<void> {
  for (const player of players) {
    const known = KNOWN_PLAYER_IDS[player.name];
    if (!known || player.apiFootballPlayerId === known) continue;
    await db.update(playersTable).set({ apiFootballPlayerId: known }).where(eq(playersTable.id, player.id));
    player.apiFootballPlayerId = known;
  }
}

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
 * Two name patterns showed up repeatedly while resolving prospects and both
 * need handling here rather than one-off overrides, since they'll keep
 * recurring as new prospects are added:
 *
 * - Compound/two-part surnames (common for Latino players): API-Football's
 *   `lastname` carries both paternal and maternal surnames (e.g. "Zendejas
 *   Saavedra", "Gómez Vargas") while we only store one surname word. A
 *   candidate counts as a surname match if our surname is ANY word of their
 *   `lastname`, not just an exact-string match.
 * - Nickname vs. legal first name: our stored nickname (e.g. "Gaga Slonina",
 *   "Tanner Tessmann") doesn't share an initial with API-Football's legal
 *   `firstname` ("Nicholas", "Francis"). The first-initial check can't help
 *   distinguish these, so it's only used as a *disambiguator* when the
 *   surname search returns more than one candidate — if the surname match is
 *   unique on its own, or unique once narrowed to USA-nationality
 *   candidates, that's corroboration enough to accept it without the initial
 *   matching.
 *
 * Common surnames are still ambiguous on their own: e.g. searching
 * "Richards" for our "Chris Richards" (USMNT defender) also returns an
 * unrelated USA-nationality lower league player with the same surname (id
 * 102616, "Brent Anthony Richards") — the first-initial check (or, failing
 * that, USA-nationality uniqueness) is what breaks that tie. A wrong id here
 * would silently misattribute that player's future transfers, which is worse
 * than leaving the club unresolved for one run, so any remaining ambiguity
 * is left unresolved rather than guessed at.
 *
 * Surname + first-initial + USA-nationality still isn't always enough,
 * though: our "Cavan Sullivan" (a teenage MLS prospect) was once matched to
 * id 427770, "Cori Michelle Sullivan" — an unrelated USWNT player who also
 * indexes as "C. Sullivan" and is USA-nationality. Neither of those checks
 * catches a same-initial, same-surname person who is an entirely different
 * age (and gender). When our on-file `age` is known, candidates whose
 * API-Football birth date implies an age more than 6 years off are dropped
 * before the initial/nationality tie-break runs, so this class of mismatch
 * fails safe (unresolved) rather than confidently picking the wrong person.
 */
export function ageFromBirthDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const birth = new Date(dateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const ageMs = Date.now() - birth.getTime();
  return Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
}

async function resolvePlayerIdBySearch(player: { id: number; name: string; age?: number }): Promise<number | null> {
  const normalized = normalizeName(player.name).split(" ");
  const surname = normalized.at(-1);
  const firstInitial = normalized[0]?.[0];
  if (!surname || !firstInitial) return null;
  try {
    const results = await afFetch<AfPlayerProfile[]>(`/players/profiles?search=${encodeURIComponent(surname)}`);

    const isSurnameMatch = (r: AfPlayerProfile) =>
      normalizeName(r.player.lastname ?? "")
        .split(" ")
        .filter(Boolean)
        .includes(surname);
    const isInitialMatch = (r: AfPlayerProfile) => normalizeName(r.player.firstname ?? "")[0] === firstInitial;
    const isAgeConsistent = (r: AfPlayerProfile) => {
      if (player.age == null) return true; // no on-file age to check against — don't reject on this alone
      const candidateAge = ageFromBirthDate(r.player.birth?.date);
      if (candidateAge == null) return true; // API-Football didn't report a birth date — can't check, don't reject
      return Math.abs(candidateAge - player.age) <= 6;
    };

    const rejectedForAge = results.filter((r) => isSurnameMatch(r) && !isAgeConsistent(r));
    if (rejectedForAge.length > 0) {
      logger.info(
        { player: player.name, onFileAge: player.age, rejected: rejectedForAge.map((r) => ({ id: r.player.id, name: r.player.name, birth: r.player.birth?.date })) },
        "Rejected surname-matching candidate(s) whose age is inconsistent with our on-file player",
      );
    }

    const surnameCandidates = results.filter((r) => isSurnameMatch(r) && isAgeConsistent(r));

    // Strongest signal: surname match plus a matching first-name initial,
    // preferring USA nationality to break ties on common surnames.
    let match =
      surnameCandidates.find((r) => isInitialMatch(r) && r.player.nationality === "USA") ??
      surnameCandidates.find(isInitialMatch);

    if (!match) {
      // No first-initial match — likely a nickname vs. legal-name mismatch
      // rather than the wrong player, since the surname search already
      // narrowed the field. Only safe to accept without the initial check
      // when the surname match is unambiguous.
      const usaSurnameCandidates = surnameCandidates.filter((r) => r.player.nationality === "USA");
      if (surnameCandidates.length === 1) {
        match = surnameCandidates[0];
      } else if (usaSurnameCandidates.length === 1) {
        match = usaSurnameCandidates[0];
      }
      if (match) {
        logger.info(
          { player: player.name, matchedName: match.player.name, matchedFirstname: match.player.firstname },
          "Matched via unambiguous surname rather than first-initial — likely a nickname vs. legal-name mismatch",
        );
      }
    }

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
 * Writes each resolved player's official API-Football headshot, replacing
 * whatever was there before (the old hand-picked seed photos, or a stale
 * headshot from a previously-resolved id). The URL is a deterministic path
 * on API-Football's media CDN — no extra API call needed, just the id we
 * already resolved above. Players still missing an id are left untouched so
 * whatever photo they already have (seeded or null) isn't cleared out from
 * under them.
 */
async function syncResolvedPlayerPhotos(players: PlayerRow[]): Promise<void> {
  for (const player of players) {
    if (!player.apiFootballPlayerId) continue;
    const photoUrl = `https://media.api-sports.io/football/players/${player.apiFootballPlayerId}.png`;
    await db.update(playersTable).set({ photoUrl }).where(eq(playersTable.id, player.id));
  }
}

/**
 * Resolves API-Football ids for every player missing one, mutating each
 * row's `apiFootballPlayerId` in place (and persisting it) as it goes —
 * shared by the player-club sync and the player-stats/match-log/injuries
 * sync so both reuse the same known-id overrides, squad-lookup, and
 * name-search fallback rather than re-resolving independently. Also keeps
 * each resolved player's photo current (see `syncResolvedPlayerPhotos`).
 */
export async function ensurePlayerApiFootballIds(players: PlayerRow[], clubsById: Map<number, ClubRow>): Promise<void> {
  await applyKnownPlayerIdOverrides(players);
  await resolvePlayerIdsViaSquads(players, clubsById);
  for (const player of players) {
    if (player.apiFootballPlayerId) continue;
    player.apiFootballPlayerId = await resolvePlayerIdBySearch(player);
  }
  await syncResolvedPlayerPhotos(players);
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
      age: playersTable.age,
    })
    .from(playersTable);
  const clubs: ClubRow[] = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const clubsById = new Map(clubs.map((c) => [c.id, c]));
  const clubsByApiFootballId = new Map(clubs.filter((c): c is ClubRow & { apiFootballTeamId: number } => c.apiFootballTeamId != null).map((c) => [c.apiFootballTeamId, c]));

  await ensurePlayerApiFootballIds(players, clubsById);

  let playersChecked = 0;
  let clubsUpdated = 0;
  let failures = 0;

  for (const player of players) {
    const apiFootballPlayerId = player.apiFootballPlayerId;
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
        .sort((a, b) => {
          const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (dateDiff !== 0) return dateDiff;
          // API-Football sometimes reports the same move twice with the same
          // date, once with a resolvable team id and once with it null —
          // prefer the resolvable duplicate so a real move to a club we
          // already track isn't skipped just because of record ordering.
          return (a.teams.in.id == null ? 1 : 0) - (b.teams.in.id == null ? 1 : 0);
        })[0];
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

  // Discovery pass — scan squads for US-eligible players not yet in the pool.
  // Runs after the main sync so all API IDs are up to date before we compare.
  try {
    const { discoverUSProspects } = await import("./playerDiscovery");
    await discoverUSProspects();
  } catch (err) {
    logger.warn({ err }, "Player discovery pass failed — main sync unaffected");
  }

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
