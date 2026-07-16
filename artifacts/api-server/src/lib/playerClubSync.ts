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

type ClubRow = { id: number; name: string; apiFootballTeamId: number | null; country?: string };
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
/**
 * Pinned player ↔ API-Football id map.
 * - number  → use this id (even if a different id is already stored)
 * - null    → player is not yet indexed in API-Football (or has a common
 *             surname that causes false positives). Skip auto-resolution
 *             entirely and keep api_football_player_id as NULL.
 */
export const KNOWN_PLAYER_IDS: Record<string, number | null> = {
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
  // Not yet indexed in API-Football — common surnames cause false positive
  // matches via surname search. Pin to null until a verified id is known.
  //
  // Cruz Medina: verified 2026-07-16 against /players/squads?team=1596 (San
  // Jose Earthquakes) and /players/profiles?search=Medina — not present in
  // either. No USA-nationality "C. Medina" of the right age exists in the
  // index. Previously the age-tolerance check matched a Chilean C. Medina
  // (born 2001) — the pin prevents that false-positive from re-emerging.
  // To lift: verify against the 2026-27 San Jose squad once published, or
  // search /players/profiles?search=Medina and confirm birth date, then
  // replace null with the verified number and run trigger-sync for player 66.
  "Cruz Medina": null,
  // Manu Romero: verified 2026-07-16 against /players/profiles?search=Romero
  // — no USA-nationality "M. Romero" exists in the index. The historical
  // false-positive was id 171435 ("G. Romero" / Gregorio Romero, USA,
  // no birth date on file), which the resolver's USA-domestic initial gate
  // now blocks at runtime (first initial "g" ≠ "m"). The null pin adds a
  // second layer of defence so that any future rollback of the initial-gate
  // fix cannot silently re-match the wrong player.
  // To lift: search /players/profiles?search=Romero once Manu Romero is
  // indexed, confirm birth date and club history via /players/teams?player=<id>,
  // then replace null with the verified number and run trigger-sync for the
  // corresponding player row.
  "Manu Romero": null,
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
    if (known === undefined) continue; // not in map — let auto-resolution proceed

    if (known === null) {
      // Explicitly unresolvable — clear any previously-wrong id that auto-resolution
      // may have written so future syncs don't use a false-positive match.
      if (player.apiFootballPlayerId != null) {
        await db.update(playersTable).set({ apiFootballPlayerId: null }).where(eq(playersTable.id, player.id));
        player.apiFootballPlayerId = null;
        logger.info({ player: player.name }, "Cleared false-positive API-Football id (pinned to null in KNOWN_PLAYER_IDS)");
      }
      continue;
    }

    if (player.apiFootballPlayerId === known) continue;
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
 * API-Football birth date implies an age more than 3 years off are dropped
 * before the initial/nationality tie-break runs, so this class of mismatch
 * fails safe (unresolved) rather than confidently picking the wrong person.
 *
 * Secondary nationality gate (USA-domestic clubs only): when the player's
 * on-file club is a USA-domestic league (country === "USA"), any non-USA
 * candidate in the initial-match pool is silently dropped if at least one
 * USA-nationality candidate with the same initial also exists. This prevents
 * a Chilean/Mexican player with the same initial from winning the tie-break
 * over the correct USA player — the tighter age window handles most cases,
 * but the gate adds a second line of defence against future edge-cases where
 * a foreign player happens to be within ±3 years of our prospect.
 */
export function ageFromBirthDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const birth = new Date(dateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const ageMs = Date.now() - birth.getTime();
  return Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
}

/** Age-consistency tolerance in years used by `resolvePlayerIdBySearch`. */
export const AGE_TOLERANCE_YEARS = 3;

async function resolvePlayerIdBySearch(
  player: { id: number; name: string; age?: number },
  opts?: { isUSADomestic?: boolean },
): Promise<number | null> {
  const isUSADomestic = opts?.isUSADomestic ?? false;
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
    const isUSANationality = (r: AfPlayerProfile) => r.player.nationality === "USA";
    /** True when the candidate has a birth date AND that age is within tolerance of our player's on-file age. */
    const isAgeConsistent = (r: AfPlayerProfile) => {
      if (player.age == null) return true; // no on-file age to check against — don't reject on this alone
      const candidateAge = ageFromBirthDate(r.player.birth?.date);
      if (candidateAge == null) return true; // API-Football didn't report a birth date — passes filter but is lower confidence (see hasBirthDate)
      return Math.abs(candidateAge - player.age) <= AGE_TOLERANCE_YEARS;
    };
    /** True when the candidate has a confirmed birth date in API-Football (regardless of age match). */
    const hasBirthDate = (r: AfPlayerProfile) => ageFromBirthDate(r.player.birth?.date) != null;

    const rejectedForAge = results.filter((r) => isSurnameMatch(r) && !isAgeConsistent(r));
    if (rejectedForAge.length > 0) {
      logger.info(
        { player: player.name, onFileAge: player.age, rejected: rejectedForAge.map((r) => ({ id: r.player.id, name: r.player.name, birth: r.player.birth?.date })) },
        "Rejected surname-matching candidate(s) whose age is inconsistent with our on-file player",
      );
    }

    const surnameCandidates = results.filter((r) => isSurnameMatch(r) && isAgeConsistent(r));

    // Split surname candidates by birth-date confidence: "confident" = has a
    // birth date that passed the age check, "dateless" = no birth date on file
    // (age-consistent by default but unverifiable).  Dateless candidates are
    // lower-confidence and only enter the initial-match pool when no
    // age-confirmed candidate with the same initial also exists — this is the
    // core fix for the Manu Romero class of wrong match (birth=None, passes
    // every gate, wins on unambiguous surname alone).
    const confidentSurnameCandidates = surnameCandidates.filter(hasBirthDate);
    const datelessSurnameCandidates  = surnameCandidates.filter((r) => !hasBirthDate(r));

    const confidentInitialCandidates = confidentSurnameCandidates.filter(isInitialMatch);
    const datelessInitialCandidates  = datelessSurnameCandidates.filter(isInitialMatch);

    // Build the initial-match pool.  For USA-domestic clubs, apply the
    // nationality gate: if any USA-nationality candidate also matches the
    // initial, restrict the pool to USA-only so a non-USA player with the
    // same initial cannot win the tie-break.
    //
    // Confidence preference: if there are any age-confirmed candidates with a
    // matching initial, exclude dateless ones from the pool entirely so they
    // cannot win the tie-break over a person whose age we can actually verify.
    const allInitialCandidates =
      confidentInitialCandidates.length > 0 ? confidentInitialCandidates : datelessInitialCandidates;
    const usaInitialCandidates = allInitialCandidates.filter(isUSANationality);
    const effectiveInitialCandidates =
      isUSADomestic && usaInitialCandidates.length > 0 ? usaInitialCandidates : allInitialCandidates;

    // Strongest signal: surname + initial, preferring USA nationality.
    // Guard: if multiple USA-nationality candidates all pass the surname+initial+age
    // filters (e.g. two brothers or unrelated players sharing a common surname and
    // first initial), we cannot pick one without guessing — leave unresolved.
    const usaEffectiveCandidates = effectiveInitialCandidates.filter(isUSANationality);
    let match: AfPlayerProfile | undefined;
    if (usaEffectiveCandidates.length === 1) {
      match = usaEffectiveCandidates[0];
    } else if (usaEffectiveCandidates.length === 0) {
      // No USA candidates — accept a sole non-USA candidate (e.g. a foreign-league
      // prospect whose club is not in the USA) or leave ambiguous if multiple.
      match = effectiveInitialCandidates.length === 1 ? effectiveInitialCandidates[0] : undefined;
    } else {
      // usaEffectiveCandidates.length > 1 — ambiguous, leave unresolved.
      logger.warn(
        {
          player: player.name,
          ambiguousCandidates: usaEffectiveCandidates.map((r) => ({ id: r.player.id, name: r.player.name, birth: r.player.birth?.date })),
        },
        "Resolver: multiple USA-nationality candidates match surname+initial+age — leaving unresolved to avoid picking the wrong person",
      );
    }

    if (isUSADomestic && allInitialCandidates.length > 0 && usaInitialCandidates.length > 0 && allInitialCandidates.length !== effectiveInitialCandidates.length) {
      logger.info(
        { player: player.name, rejectedNonUSA: allInitialCandidates.filter((r) => !isUSANationality(r)).map((r) => ({ id: r.player.id, name: r.player.name, nationality: r.player.nationality })) },
        "USA-domestic nationality gate: rejected non-USA initial-match candidate(s) because a USA-nationality match also exists",
      );
    }

    // When a dateless candidate is the sole winner and our player has an
    // on-file age, emit a prominent warning: we cannot verify age-consistency,
    // so the match is lower-confidence than usual.
    if (match && !hasBirthDate(match) && player.age != null) {
      logger.warn(
        {
          player: player.name,
          onFileAge: player.age,
          candidateId: match.player.id,
          candidateName: match.player.name,
          candidateNationality: match.player.nationality,
        },
        "DATELESS CANDIDATE MATCHED — API-Football has no birth date for this candidate; age cannot be verified. If the photo or stats look wrong, add a null pin to KNOWN_PLAYER_IDS.",
      );
    }

    if (!match) {
      // No first-initial match — likely a nickname vs. legal-name mismatch
      // rather than the wrong player, since the surname search already
      // narrowed the field. Only safe to accept without the initial check
      // when the surname match is unambiguous.
      //
      // USA-domestic initial gate: for players at USA-domestic clubs, an
      // unambiguous surname match is NOT sufficient when the candidate's
      // first initial also disagrees with ours. The Manu Romero case showed
      // this exactly — "G. Romero USA, birth=None" was the only USA-nationality
      // Romero in the index, so it won the unambiguous-surname path despite
      // having the wrong initial ("G" vs our "M"). Without a birth date to
      // check, neither the age filter nor the initial gate (which only applies
      // to the initial-match pool above) could block it. For USA-domestic
      // clubs we therefore require the initial to match even in this fallback;
      // if it doesn't we log a prominent warning and leave the player unresolved
      // rather than silently accepting the wrong person.
      //
      // Confidence preference in surname fallback: prefer a candidate with a
      // confirmed birth date over a dateless one. If the only unambiguous
      // surname match is dateless and our player has an on-file age, reject it
      // rather than silently accepting an unverifiable match.
      const usaConfidentSurnameCandidates = confidentSurnameCandidates.filter(isUSANationality);
      const usaDatelessSurnameCandidates  = datelessSurnameCandidates.filter(isUSANationality);

      // Prefer age-confirmed candidates; fall back to dateless only when no
      // confident candidate is unambiguously unique.
      const usaSurnameCandidates =
        usaConfidentSurnameCandidates.length > 0 ? usaConfidentSurnameCandidates : usaDatelessSurnameCandidates;
      const effectiveSurnameCandidates =
        confidentSurnameCandidates.length > 0 ? confidentSurnameCandidates : datelessSurnameCandidates;

      const candidateBlockedByInitial = (candidate: AfPlayerProfile): boolean => {
        if (!isUSADomestic) return false;
        const candidateInitial = normalizeName(candidate.player.firstname ?? "")[0];
        return candidateInitial != null && candidateInitial !== firstInitial;
      };

      let candidate: AfPlayerProfile | undefined;
      if (effectiveSurnameCandidates.length === 1) {
        candidate = effectiveSurnameCandidates[0];
      } else if (usaSurnameCandidates.length === 1) {
        candidate = usaSurnameCandidates[0];
      }

      if (candidate) {
        if (candidateBlockedByInitial(candidate)) {
          logger.warn(
            {
              player: player.name,
              ourInitial: firstInitial,
              candidateId: candidate.player.id,
              candidateName: candidate.player.name,
              candidateFirstname: candidate.player.firstname,
              candidateNationality: candidate.player.nationality,
            },
            "USA-domestic initial gate (surname fallback): rejected unambiguous surname match because candidate's first initial disagrees — leaving unresolved to avoid a Manu-Romero-style wrong match",
          );
        } else if (!hasBirthDate(candidate) && player.age != null) {
          // The only unambiguous match has no birth date and we have an on-file
          // age — too risky to accept silently. Log and leave unresolved so an
          // admin can verify and pin in KNOWN_PLAYER_IDS.
          logger.warn(
            {
              player: player.name,
              onFileAge: player.age,
              candidateId: candidate.player.id,
              candidateName: candidate.player.name,
              candidateNationality: candidate.player.nationality,
            },
            "DATELESS SURNAME-FALLBACK CANDIDATE REJECTED — player has an on-file age but the only unambiguous surname match has no birth date; leaving unresolved. Verify via /players/teams?player=<id> and pin in KNOWN_PLAYER_IDS if correct.",
          );
        } else {
          match = candidate;
          const isDatelessMatch = !hasBirthDate(candidate);
          logger.info(
            {
              player: player.name,
              matchedName: match.player.name,
              matchedFirstname: match.player.firstname,
              ...(isDatelessMatch ? { dateless: true, warning: "No birth date on file — age could not be verified" } : {}),
            },
            "Matched via unambiguous surname rather than first-initial — likely a nickname vs. legal-name mismatch",
          );
        }
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
    // Skip players explicitly pinned to null — they are not yet indexed in
    // API-Football (or have a surname so common that search always false-positives).
    // `applyKnownPlayerIdOverrides` already cleared any bad id; don't re-search.
    if (KNOWN_PLAYER_IDS[player.name] === null) continue;
    const club = clubsById.get(player.clubId);
    player.apiFootballPlayerId = await resolvePlayerIdBySearch(player, { isUSADomestic: club?.country === "USA" });
  }
  await syncResolvedPlayerPhotos(players);
}

/**
 * Re-checks every null-pinned player (KNOWN_PLAYER_IDS[name] === null) against
 * API-Football once per sync cycle. If a confident, age-consistent candidate is
 * found — via squad lookup or profile search — a WARNING-level alert is logged
 * with the candidate id and birth date so an admin can verify and promote it to
 * a confirmed pin in KNOWN_PLAYER_IDS. The id is intentionally NOT written to
 * the database; the alert is purely for human review.
 */
async function checkNullPinnedPlayers(players: PlayerRow[], clubsById: Map<number, ClubRow>): Promise<void> {
  const nullPinnedNames = new Set(
    Object.entries(KNOWN_PLAYER_IDS)
      .filter(([, v]) => v === null)
      .map(([k]) => k),
  );
  if (nullPinnedNames.size === 0) return;

  const nullPinnedPlayers = players.filter((p) => nullPinnedNames.has(p.name));
  if (nullPinnedPlayers.length === 0) return;

  logger.info({ players: nullPinnedPlayers.map((p) => p.name) }, "Null-pinned player check: starting re-check for unindexed players");

  for (const player of nullPinnedPlayers) {
    let candidateId: number | null = null;
    let candidateName: string | null = null;
    let candidateBirth: string | null = null;
    let source: string | null = null;

    // Step 1: check their on-file club's current squad.
    const club = clubsById.get(player.clubId);
    if (club?.apiFootballTeamId) {
      try {
        const squads = await afFetch<AfSquadResponse[]>(`/players/squads?team=${club.apiFootballTeamId}`);
        const roster = squads[0]?.players ?? [];
        const normalizedPlayerName = normalizeName(player.name);
        const match = roster.find((r) => normalizeName(r.name) === normalizedPlayerName);
        if (match) {
          candidateId = match.id;
          candidateName = match.name;
          source = `squad of ${club.name}`;
        }
      } catch (err) {
        logger.warn({ err, player: player.name, club: club.name }, "Null-pinned check: squad fetch failed");
      }
    }

    // Step 2: if squad didn't find them, try a profile search (read-only).
    if (!candidateId) {
      const normalized = normalizeName(player.name).split(" ");
      const surname = normalized.at(-1);
      const firstInitial = normalized[0]?.[0];
      if (surname && firstInitial) {
        try {
          const results = await afFetch<AfPlayerProfile[]>(`/players/profiles?search=${encodeURIComponent(surname)}`);

          const isSurnameMatch = (r: AfPlayerProfile) =>
            normalizeName(r.player.lastname ?? "")
              .split(" ")
              .filter(Boolean)
              .includes(surname);
          const isInitialMatch = (r: AfPlayerProfile) => normalizeName(r.player.firstname ?? "")[0] === firstInitial;
          const isAgeConsistent = (r: AfPlayerProfile) => {
            if (player.age == null) return true;
            const candidateAge = ageFromBirthDate(r.player.birth?.date);
            if (candidateAge == null) return true;
            return Math.abs(candidateAge - player.age) <= AGE_TOLERANCE_YEARS;
          };

          const surnameCandidates = results.filter((r) => isSurnameMatch(r) && isAgeConsistent(r));
          const initialCandidates = surnameCandidates.filter(isInitialMatch);

          // Apply the same USA-domestic nationality gate used in resolvePlayerIdBySearch.
          const isUSADomestic = club?.country === "USA";
          const isUSANationality = (r: AfPlayerProfile) => r.player.nationality === "USA";
          const usaInitialCandidates = initialCandidates.filter(isUSANationality);
          const effectiveInitialCandidates =
            isUSADomestic && usaInitialCandidates.length > 0 ? usaInitialCandidates : initialCandidates;

          let match: AfPlayerProfile | undefined;
          const usaEffective = effectiveInitialCandidates.filter(isUSANationality);
          if (usaEffective.length === 1) {
            match = usaEffective[0];
          } else if (usaEffective.length === 0 && effectiveInitialCandidates.length === 1) {
            match = effectiveInitialCandidates[0];
          }

          if (match) {
            candidateId = match.player.id;
            candidateName = match.player.name;
            candidateBirth = match.player.birth?.date ?? null;
            source = "profile search";
          }
        } catch (err) {
          logger.warn({ err, player: player.name }, "Null-pinned check: profile search failed");
        }
      }
    }

    if (candidateId) {
      logger.warn(
        {
          player: player.name,
          candidateId,
          candidateName,
          candidateBirth,
          source,
          action: "Verify via /players/teams?player=" + candidateId + " then update KNOWN_PLAYER_IDS to confirm",
        },
        "NULL-PINNED PLAYER CANDIDATE FOUND — manual verification required before promoting to a confirmed pin",
      );
    } else {
      logger.info({ player: player.name }, "Null-pinned check: player still not indexed in API-Football");
    }
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
      age: playersTable.age,
    })
    .from(playersTable);
  const clubs: ClubRow[] = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId, country: clubsTable.country })
    .from(clubsTable);
  const clubsById = new Map(clubs.map((c) => [c.id, c]));
  const clubsByApiFootballId = new Map(clubs.filter((c): c is ClubRow & { apiFootballTeamId: number } => c.apiFootballTeamId != null).map((c) => [c.apiFootballTeamId, c]));

  await ensurePlayerApiFootballIds(players, clubsById);
  await checkNullPinnedPlayers(players, clubsById);

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
      // Prefer the API's teams.out.name (who they left) over the current DB
      // club — if the DB club was wrong at sync time, currentClub?.name would
      // record the transfer direction backwards.
      const fromClubName = latest.teams.out.name || currentClub?.name || "Unknown";
      await db.update(playersTable).set({ clubId: newClub.id }).where(eq(playersTable.id, player.id));
      await db.insert(transfersTable).values({
        playerId: player.id,
        fromClub: fromClubName,
        toClub: newClub.name,
        transferType: isLoan ? "loan" : "transfer",
        fee: !isLoan ? (latest.type ?? null) : null,
        status: "confirmed",
        announcedAt: new Date(latest.date),
        summary: `${player.name} moved from ${fromClubName} to ${newClub.name} (synced from API-Football transfer history).`,
      });
      clubsUpdated++;
      logger.info({ player: player.name, from: fromClubName, to: newClub.name }, "Player club updated via API-Football sync");
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
  const { claimSyncRun } = require("./syncGuard") as typeof import("./syncGuard");
  const COOLDOWN = 23 * 60 * 60 * 1000;
  const run = async () => {
    if (!(await claimSyncRun("playerClub", COOLDOWN))) return;
    syncPlayerClubs().catch((err) => logger.error({ err }, "Player-club sync failed"));
  };
  run();
  intervalHandle = setInterval(run, intervalMs);
}

export function stopPlayerClubSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
