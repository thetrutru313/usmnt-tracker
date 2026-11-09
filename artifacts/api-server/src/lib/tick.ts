import { db, fixturePlayersTable, fixturesTable, playersTable, pushEventsTable } from "@workspace/db";
import { and, eq, gte, isNotNull, lte, notIlike, or, sql } from "drizzle-orm";
import { afFetch } from "./apiFootballSync";
import { mapStatus, type AfFixture } from "./fixtureReconciliation";
import { syncStatsForFinishedFixture } from "./playerStatsSync";
import { claimPushEvent, runDueAlerts, sendAlert } from "./pushAlerts";
import { logger } from "./logger";

// ─── Timing ──────────────────────────────────────────────────────────────────

/** Start checking a match for lineups this long before kickoff. */
export const LINEUP_WINDOW_MS = 75 * 60 * 1000;
/** Keep checking a "scheduled" match this long after kickoff (late starts, missed updates). */
export const MATCH_WINDOW_MS = 4 * 60 * 60 * 1000;
/** API-Football player stats take this long after full time to appear. */
export const POST_MATCH_DELAY_MS = 35 * 60 * 1000;
/** Finished matches this recent are checked for post-match stats. */
export const POST_MATCH_LOOKBACK_MS = 8 * 60 * 60 * 1000;
/** Stop starting new work after this long, so a tick stays inside the cron service's timeout. */
export const TICK_BUDGET_MS = 20_000;

// ─── API shapes (fields used here only) ──────────────────────────────────────

type AfEvent = {
  time: { elapsed: number | null; extra: number | null };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
};
type AfLineupPlayer = { player: { id: number | null; name: string | null } };
type AfLineup = { startXI?: AfLineupPlayer[]; substitutes?: AfLineupPlayer[] };
type AfFixtureDetail = AfFixture & { events?: AfEvent[]; lineups?: AfLineup[] };

type DueFixture = {
  id: number;
  apiId: number;
  status: string;
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  elapsedMinute: number | null;
};

export type TickSummary = {
  fixturesChecked: number;
  fixturesUpdated: number;
  lineupAlerts: number;
  goalAlerts: number;
  postMatchRuns: number;
  outOfTime: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// A tracked match: has linked players, or is a national-team match.
// Club friendlies are skipped, as everywhere else in the app.
function trackedMatch() {
  return and(
    or(
      eq(fixturesTable.isNationalTeam, true),
      sql`EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixturesTable.id})`,
    ),
    or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
  );
}

async function eventExists(key: string): Promise<boolean> {
  const rows = await db.select({ key: pushEventsTable.key }).from(pushEventsTable).where(eq(pushEventsTable.key, key)).limit(1);
  return rows.length > 0;
}

/** Record a non-alert marker (e.g. when a match was first seen finished). Returns its time. */
async function markOnce(key: string, at: Date): Promise<Date> {
  await db.insert(pushEventsTable).values({ key, kind: "system", createdAt: at }).onConflictDoNothing();
  const [row] = await db.select({ createdAt: pushEventsTable.createdAt }).from(pushEventsTable).where(eq(pushEventsTable.key, key)).limit(1);
  return row?.createdAt ?? at;
}

async function linkedPlayers(fixtureId: number) {
  return db
    .select({ id: playersTable.id, name: playersTable.name, apiId: playersTable.apiFootballPlayerId })
    .from(fixturePlayersTable)
    .innerJoin(playersTable, eq(playersTable.id, fixturePlayersTable.playerId))
    .where(eq(fixturePlayersTable.fixtureId, fixtureId));
}

function scoreLine(f: { homeTeam: string; awayTeam: string }, home: number | null, away: number | null): string {
  return home !== null && away !== null ? `${f.homeTeam} ${home}–${away} ${f.awayTeam}` : `${f.homeTeam} vs ${f.awayTeam}`;
}

// ─── Due matches: status, score, lineups, goals ──────────────────────────────

/** Matches worth an API call this tick: live, about to start, or past kickoff but not yet marked live. */
export async function findDueFixtures(now: Date): Promise<DueFixture[]> {
  const rows = await db
    .select({
      id: fixturesTable.id,
      apiId: fixturesTable.apiFootballFixtureId,
      status: fixturesTable.status,
      kickoff: fixturesTable.kickoff,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      homeScore: fixturesTable.homeScore,
      awayScore: fixturesTable.awayScore,
      elapsedMinute: fixturesTable.elapsedMinute,
    })
    .from(fixturesTable)
    .where(and(
      isNotNull(fixturesTable.apiFootballFixtureId),
      trackedMatch(),
      or(
        eq(fixturesTable.status, "live"),
        and(
          eq(fixturesTable.status, "scheduled"),
          eq(fixturesTable.kickoffTimeTbd, false),
          gte(fixturesTable.kickoff, new Date(now.getTime() - MATCH_WINDOW_MS)),
          lte(fixturesTable.kickoff, new Date(now.getTime() + LINEUP_WINDOW_MS)),
        ),
      ),
    ));

  const due: DueFixture[] = [];
  for (const r of rows) {
    // Before kickoff, a match is only checked until its lineups have been seen.
    if (r.status === "scheduled" && r.kickoff > now && (await eventExists(`lineup:${r.id}`))) continue;
    due.push({ ...r, apiId: r.apiId! });
  }
  return due;
}

/**
 * When lineups first appear, send the one pre-match alert: when the match
 * kicks off, and whether each of the device's players starts or is on the
 * bench. It claims `kickoff:<id>` — the same key as the fallback kickoff
 * reminder — so a match never gets both.
 */
async function handleLineups(f: DueFixture, fresh: AfFixtureDetail, status: string, now: Date): Promise<boolean> {
  if (status === "finished") return false;
  const lineups = fresh.lineups ?? [];
  if (!lineups.some((l) => (l.startXI ?? []).length > 0)) return false;
  // Marks the lineups as seen, so the match isn't fetched again before kickoff.
  if (!(await claimPushEvent(`lineup:${f.id}`, "lineups"))) return false;

  const starters = new Set(lineups.flatMap((l) => (l.startXI ?? []).map((p) => p.player.id)));
  const bench = new Set(lineups.flatMap((l) => (l.substitutes ?? []).map((p) => p.player.id)));
  // Starters first, then the bench, so the alert reads in a sensible order.
  const players = await linkedPlayers(f.id);
  const roles = new Map<number, { name: string; role: string }>();
  for (const p of players) if (p.apiId !== null && starters.has(p.apiId)) roles.set(p.id, { name: p.name, role: "starts" });
  for (const p of players) {
    if (p.apiId !== null && !starters.has(p.apiId) && bench.has(p.apiId)) roles.set(p.id, { name: p.name, role: "on the bench" });
  }
  // None of the match's players found in the lineups (e.g. not in the
  // squad): leave it to the fallback kickoff reminder.
  if (roles.size === 0) return false;
  if (!(await claimPushEvent(`kickoff:${f.id}`, "kickoff"))) return false;
  const minutes = Math.round((f.kickoff.getTime() - now.getTime()) / 60_000);
  const title = minutes >= 1
    ? `Kicks off in ${minutes} min: ${f.homeTeam} vs ${f.awayTeam}`
    : `Lineups: ${f.homeTeam} vs ${f.awayTeam}`;
  await sendAlert("kickoff", [...roles.keys()], (ids) => ({
    title,
    body: ids.map((id) => `${roles.get(id)!.name} ${roles.get(id)!.role}`).join(" · "),
    url: `/matches/${f.id}`,
    tag: `kickoff-${f.id}`,
  }));
  return true;
}

async function handleGoals(f: DueFixture, fresh: AfFixtureDetail): Promise<number> {
  const goals = (fresh.events ?? []).filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty");
  if (goals.length === 0) return 0;
  const byApiId = new Map<number, { id: number; name: string }>();
  for (const p of await linkedPlayers(f.id)) if (p.apiId !== null) byApiId.set(p.apiId, p);
  if (byApiId.size === 0) return 0;

  const score = scoreLine(f, fresh.goals.home ?? null, fresh.goals.away ?? null);
  let alerts = 0;
  for (const e of goals) {
    const minute = `${e.time.elapsed ?? "?"}${e.time.extra ? `+${e.time.extra}` : ""}′`;
    const at = `${e.time.elapsed ?? 0}+${e.time.extra ?? 0}`;
    const scorer = e.player.id !== null ? byApiId.get(e.player.id) : undefined;
    if (scorer && e.detail !== "Own Goal" && (await claimPushEvent(`goal:${f.id}:${at}:${e.player.id}`, "goals"))) {
      const pen = e.detail === "Penalty" ? " (pen)" : "";
      await sendAlert("goals", [scorer.id], () => ({
        title: `Goal: ${scorer.name}${pen}`,
        body: `${score} · ${minute}`,
        url: `/matches/${f.id}`,
      }));
      alerts++;
    }
    const assister = e.assist.id !== null ? byApiId.get(e.assist.id) : undefined;
    if (assister && e.detail !== "Own Goal" && (await claimPushEvent(`assist:${f.id}:${at}:${e.assist.id}`, "goals"))) {
      await sendAlert("goals", [assister.id], () => ({
        title: `Assist: ${assister.name}`,
        body: `Sets up ${e.player.name ?? "a goal"} · ${score} · ${minute}`,
        url: `/matches/${f.id}`,
      }));
      alerts++;
    }
  }
  return alerts;
}

// ─── Post-match stats ────────────────────────────────────────────────────────

/**
 * For matches finished recently, run the post-match stats sync once,
 * POST_MATCH_DELAY_MS after the tick first saw the match finished. One per
 * tick: each run makes several API calls.
 */
export async function runDuePostMatch(now: Date): Promise<number> {
  const finished = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(and(
      eq(fixturesTable.status, "finished"),
      trackedMatch(),
      gte(fixturesTable.kickoff, new Date(now.getTime() - POST_MATCH_LOOKBACK_MS)),
      lte(fixturesTable.kickoff, now),
    ));
  for (const { id } of finished) {
    const seenAt = await markOnce(`finished:${id}`, now);
    if (now.getTime() - seenAt.getTime() < POST_MATCH_DELAY_MS) continue;
    if (await eventExists(`postmatch:${id}`)) continue;
    await db.insert(pushEventsTable).values({ key: `postmatch:${id}`, kind: "system", createdAt: now }).onConflictDoNothing();
    const playerIds = (await linkedPlayers(id)).map((p) => p.id);
    if (playerIds.length > 0) await syncStatsForFinishedFixture(playerIds);
    return 1;
  }
  return 0;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * One cron tick: refresh due matches (status, score, lineups, goals), run any
 * due post-match stats, then the other alert scanners. Stops starting new
 * work after TICK_BUDGET_MS; whatever is left runs on the next tick.
 */
export async function runTick(now = new Date()): Promise<TickSummary> {
  const started = Date.now();
  const outOfTime = () => Date.now() - started > TICK_BUDGET_MS;
  const summary: TickSummary = {
    fixturesChecked: 0, fixturesUpdated: 0, lineupAlerts: 0, goalAlerts: 0, postMatchRuns: 0, outOfTime: false,
  };

  for (const f of await findDueFixtures(now)) {
    if (outOfTime()) { summary.outOfTime = true; break; }
    try {
      const [fresh] = await afFetch<AfFixtureDetail[]>(`/fixtures?id=${f.apiId}`);
      summary.fixturesChecked++;
      if (!fresh) continue;
      const status = mapStatus(fresh.fixture.status.short);
      const homeScore = fresh.goals.home ?? null;
      const awayScore = fresh.goals.away ?? null;
      const elapsed = status === "live" ? (fresh.fixture.status.elapsed ?? null) : null;
      if (status !== f.status || homeScore !== f.homeScore || awayScore !== f.awayScore || elapsed !== f.elapsedMinute) {
        await db.update(fixturesTable)
          .set({ status, homeScore, awayScore, elapsedMinute: elapsed })
          .where(eq(fixturesTable.id, f.id));
        summary.fixturesUpdated++;
      }
      if (await handleLineups(f, fresh, status, now)) summary.lineupAlerts++;
      summary.goalAlerts += await handleGoals(f, fresh);
    } catch (err) {
      logger.warn({ err, fixtureId: f.id }, "Tick: match refresh failed");
    }
  }

  if (!outOfTime()) {
    try {
      summary.postMatchRuns = await runDuePostMatch(now);
    } catch (err) {
      logger.warn({ err }, "Tick: post-match stats failed");
    }
  } else {
    summary.outOfTime = true;
  }

  await runDueAlerts(now);
  return summary;
}
