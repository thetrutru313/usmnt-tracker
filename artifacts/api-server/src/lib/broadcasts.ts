/**
 * US TV / streaming info for matches.
 *
 * - league_broadcasts: each competition's usual US home, edited on the admin
 *   page. The fixture syncs read it through an in-memory copy (broadcastFor),
 *   refreshed at startup, every 10 minutes and after each admin edit, so the
 *   syncs make no extra database calls.
 * - fixtures.broadcast_set_by_admin: a match whose TV / streaming / link an
 *   admin set by hand. The syncs and the startup seed leave those fields alone.
 */
import { db, fixturesTable, leagueBroadcastsTable } from "@workspace/db";
import { and, asc, count, eq, gt, lt, ne, notIlike, or, sql } from "drizzle-orm";
import { logger } from "./logger.js";

export type Broadcast = { tvNetwork: string | null; streamingService: string | null };

// Seeded into league_broadcasts once, when the table is empty; after that the
// admin page is the source of truth. Keys are the exact competition names
// API-Football returns.
export const DEFAULT_LEAGUE_BROADCASTS: Record<string, Broadcast> = {
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
  "CONCACAF U20":            { tvNetwork: "FOX Sports", streamingService: "Fox One" },

  // ── International / national team ─────────────────────────────────────────
  "FIFA World Cup":          { tvNetwork: "FOX",        streamingService: "FOX Sports App" },
  "World Cup - U17":         { tvNetwork: null,         streamingService: "FIFA+" },
  "FIFA Club World Cup":     { tvNetwork: null,         streamingService: "DAZN" },
  "CONCACAF Nations League": { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "CONCACAF Gold Cup":       { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "Copa América":            { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "UEFA Nations League":     { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "International Friendly":  { tvNetwork: "FOX Sports", streamingService: "FOX Sports App" },
  "Copa Libertadores":       { tvNetwork: "beIN Sports", streamingService: "beIN Sports" },
  "Copa Sudamericana":       { tvNetwork: "beIN Sports", streamingService: "beIN Sports" },
};

const NONE: Broadcast = { tvNetwork: null, streamingService: null };
let byLeague = new Map<string, Broadcast>(Object.entries(DEFAULT_LEAGUE_BROADCASTS));

/** A competition's usual US TV / streaming home (empty when it has none). */
export function broadcastFor(league: string): Broadcast {
  return byLeague.get(league) ?? NONE;
}

/**
 * The broadcast fields a sync should write for an existing match: none when an
 * admin set this match's broadcast by hand, otherwise the league's.
 */
export function syncBroadcastColumns(
  league: string,
  existing?: { broadcastSetByAdmin?: boolean | null },
): Partial<Broadcast> {
  return existing?.broadcastSetByAdmin ? {} : broadcastFor(league);
}

/** Fill league_broadcasts from the defaults, only when it's empty. */
export async function seedLeagueBroadcastDefaults(): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(leagueBroadcastsTable);
  if (n > 0) return 0;
  const rows = Object.entries(DEFAULT_LEAGUE_BROADCASTS).map(([league, b]) => ({ league, ...b }));
  await db.insert(leagueBroadcastsTable).values(rows).onConflictDoNothing();
  logger.info({ leagues: rows.length }, "Seeded league broadcast defaults");
  return rows.length;
}

/** Reload the in-memory copy from league_broadcasts (kept as-is if the table is empty). */
export async function refreshLeagueBroadcasts(): Promise<number> {
  const rows = await db.select().from(leagueBroadcastsTable);
  if (rows.length > 0) {
    byLeague = new Map(rows.map((r) => [r.league, { tvNetwork: r.tvNetwork, streamingService: r.streamingService }]));
  }
  return rows.length;
}

export function startLeagueBroadcastRefresh(intervalMs = 10 * 60 * 1000): void {
  setInterval(() => {
    refreshLeagueBroadcasts().catch((err) => logger.warn({ err }, "League broadcast refresh failed"));
  }, intervalMs);
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listLeagueBroadcasts() {
  return db
    .select({
      league: leagueBroadcastsTable.league,
      tvNetwork: leagueBroadcastsTable.tvNetwork,
      streamingService: leagueBroadcastsTable.streamingService,
    })
    .from(leagueBroadcastsTable)
    .orderBy(asc(leagueBroadcastsTable.league));
}

/**
 * Add or change a league's broadcast, and apply it straight away to upcoming
 * club matches in that competition that weren't set by hand. National-team
 * matches are edited one by one. Returns how many matches changed.
 */
export async function saveLeagueBroadcast(league: string, b: Broadcast): Promise<number> {
  await db
    .insert(leagueBroadcastsTable)
    .values({ league, ...b, updatedAt: new Date() })
    .onConflictDoUpdate({ target: leagueBroadcastsTable.league, set: { ...b, updatedAt: new Date() } });
  await refreshLeagueBroadcasts();
  const changed = await db
    .update(fixturesTable)
    .set(b)
    .where(and(
      eq(fixturesTable.competition, league),
      gt(fixturesTable.kickoff, new Date()),
      eq(fixturesTable.isNationalTeam, false),
      eq(fixturesTable.broadcastSetByAdmin, false),
    ))
    .returning({ id: fixturesTable.id });
  return changed.length;
}

export async function deleteLeagueBroadcast(league: string): Promise<boolean> {
  const deleted = await db
    .delete(leagueBroadcastsTable)
    .where(eq(leagueBroadcastsTable.league, league))
    .returning({ league: leagueBroadcastsTable.league });
  if (deleted.length > 0) byLeague.delete(league);
  await refreshLeagueBroadcasts();
  return deleted.length > 0;
}

/**
 * Upcoming matches shown on the Fixtures page (national-team matches, and
 * club matches with a tracked player, club friendlies excluded) in the next
 * `days` days, soonest first.
 */
export async function upcomingBroadcastFixtures(days = 21) {
  const now = new Date();
  return db
    .select({
      id: fixturesTable.id,
      kickoff: fixturesTable.kickoff,
      kickoffTimeTbd: fixturesTable.kickoffTimeTbd,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      competition: fixturesTable.competition,
      isNationalTeam: fixturesTable.isNationalTeam,
      tvNetwork: fixturesTable.tvNetwork,
      streamingService: fixturesTable.streamingService,
      broadcastLink: fixturesTable.broadcastLink,
      broadcastSetByAdmin: fixturesTable.broadcastSetByAdmin,
    })
    .from(fixturesTable)
    .where(and(
      gt(fixturesTable.kickoff, now),
      lt(fixturesTable.kickoff, new Date(now.getTime() + days * 24 * 60 * 60 * 1000)),
      ne(fixturesTable.status, "finished"),
      or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
      or(
        eq(fixturesTable.isNationalTeam, true),
        sql`EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixturesTable.id})`,
      ),
    ))
    .orderBy(asc(fixturesTable.kickoff));
}

/** Set one match's broadcast by hand; the syncs then leave it alone. False if there's no such match. */
export async function setFixtureBroadcast(
  id: number,
  b: Broadcast & { broadcastLink: string | null },
): Promise<boolean> {
  const rows = await db
    .update(fixturesTable)
    .set({ ...b, broadcastSetByAdmin: true })
    .where(eq(fixturesTable.id, id))
    .returning({ id: fixturesTable.id });
  return rows.length > 0;
}

/** Hand a match back to its league's broadcast (and drop its link). False if there's no such match. */
export async function resetFixtureBroadcast(id: number): Promise<boolean> {
  const [row] = await db
    .select({ competition: fixturesTable.competition })
    .from(fixturesTable)
    .where(eq(fixturesTable.id, id));
  if (!row) return false;
  await db
    .update(fixturesTable)
    .set({ ...broadcastFor(row.competition), broadcastLink: null, broadcastSetByAdmin: false })
    .where(eq(fixturesTable.id, id));
  return true;
}
