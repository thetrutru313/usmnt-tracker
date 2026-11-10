import {
  db,
  fixturePlayersTable,
  fixturesTable,
  injuriesTable,
  matchLogsTable,
  playersTable,
  pushEventsTable,
  pushSubscriptionsTable,
  transfersTable,
  userFollowsTable,
  type PushAlertKind,
} from "@workspace/db";
import { and, eq, gt, gte, inArray, isNotNull, lt, lte, notIlike, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendPush, type PushPayload } from "./push";
import { displayTeamName } from "./teamNames";

// ─── Timing ──────────────────────────────────────────────────────────────────

/**
 * Fallback kickoff reminder: sent this close to kickoff only when the cron
 * tick hasn't already sent the combined "kicks off in … / lineup" alert, which
 * usually goes out 40–60 min before when lineups are announced. Both claim
 * `kickoff:<fixtureId>`, so a match gets one pre-match alert, never two.
 */
export const KICKOFF_LEAD_MS = 15 * 60 * 1000;
/** Ratings are looked for on matches that kicked off within this window. */
export const RATINGS_LOOKBACK_MS = 12 * 60 * 60 * 1000;
/** Only injuries that started this recently count as new. */
export const INJURY_LOOKBACK_DAYS = 2;
/** Only transfer rows recorded this recently count as new… */
export const TRANSFER_RECORDED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** …and only if the move itself is this recent (not a backfilled old move). */
export const TRANSFER_ANNOUNCED_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
/** push_events rows older than this are pruned. Every scan window is far shorter. */
export const PUSH_EVENT_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

// ─── Core ────────────────────────────────────────────────────────────────────

/** Claim an alert event. True only for the first caller, across instances. */
export async function claimPushEvent(key: string, kind: PushAlertKind): Promise<boolean> {
  const rows = await db
    .insert(pushEventsTable)
    .values({ key, kind })
    .onConflictDoNothing()
    .returning({ key: pushEventsTable.key });
  return rows.length > 0;
}

export type AlertResult = { devices: number; sent: number };

/**
 * Send an alert to every device with `kind` switched on.
 * - Player alerts: a device set to "My Players" only gets it if it follows at
 *   least one of `playerIds`, and `build` receives just those players. A device
 *   set to "All tracked players" gets all of them.
 * - Announcements: pass `playerIds` = null; every device with them on gets it.
 */
export async function sendAlert(
  kind: PushAlertKind,
  playerIds: number[] | null,
  build: (players: number[]) => PushPayload,
): Promise<AlertResult> {
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(sql`(${pushSubscriptionsTable.prefs} ->> ${kind})::boolean = true`);
  if (subs.length === 0) return { devices: 0, sent: 0 };

  const follows = new Map<number, Set<number>>();
  if (playerIds && playerIds.length > 0 && subs.some((s) => s.prefs.scope !== "all")) {
    const rows = await db
      .select({ anonUserId: userFollowsTable.anonUserId, playerId: userFollowsTable.playerId })
      .from(userFollowsTable)
      .where(and(
        inArray(userFollowsTable.anonUserId, [...new Set(subs.map((s) => s.anonUserId))]),
        inArray(userFollowsTable.playerId, playerIds),
      ));
    for (const r of rows) {
      if (!follows.has(r.anonUserId)) follows.set(r.anonUserId, new Set());
      follows.get(r.anonUserId)!.add(r.playerId);
    }
  }

  let devices = 0;
  let sent = 0;
  for (const sub of subs) {
    let players: number[] = [];
    if (playerIds !== null) {
      players = sub.prefs.scope === "all"
        ? playerIds
        : playerIds.filter((id) => follows.get(sub.anonUserId)?.has(id));
      if (players.length === 0) continue;
    }
    devices++;
    if ((await sendPush(sub, build(players))) === "sent") sent++;
  }
  return { devices, sent };
}

/** "A, B, C +2 more" */
function nameList(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

// Club friendlies are hidden across the app; NT friendlies are kept.
// (A function, so nothing touches the schema when the module loads.)
function notClubFriendly() {
  return or(
    eq(fixturesTable.isNationalTeam, true),
    notIlike(fixturesTable.competition, "%Friendlies%"),
  );
}

// ─── Kickoff reminders (fallback when lineups aren't out yet) ─────────────────

export async function sendKickoffReminders(now = new Date()): Promise<number> {
  const rows = await db
    .select({
      fixtureId: fixturesTable.id,
      kickoff: fixturesTable.kickoff,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      playerId: playersTable.id,
      playerName: playersTable.name,
    })
    .from(fixturesTable)
    .innerJoin(fixturePlayersTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
    .innerJoin(playersTable, eq(playersTable.id, fixturePlayersTable.playerId))
    .where(and(
      eq(fixturesTable.status, "scheduled"),
      eq(fixturesTable.kickoffTimeTbd, false),
      gt(fixturesTable.kickoff, now),
      lte(fixturesTable.kickoff, new Date(now.getTime() + KICKOFF_LEAD_MS)),
      notClubFriendly(),
    ));

  const byFixture = groupBy(rows, (r) => r.fixtureId);
  let alerts = 0;
  for (const [fixtureId, fixtureRows] of byFixture) {
    if (!(await claimPushEvent(`kickoff:${fixtureId}`, "kickoff"))) continue;
    const f = fixtureRows[0]!;
    const minutes = Math.max(1, Math.round((f.kickoff.getTime() - now.getTime()) / 60_000));
    const names = new Map(fixtureRows.map((r) => [r.playerId, r.playerName]));
    await sendAlert("kickoff", [...names.keys()], (ids) => ({
      title: `Kicks off in ${minutes} min: ${displayTeamName(f.homeTeam)} vs ${displayTeamName(f.awayTeam)}`,
      body: nameList(ids.map((id) => names.get(id)!)),
      url: `/matches/${fixtureId}`,
      tag: `kickoff-${fixtureId}`,
    }));
    alerts++;
  }
  return alerts;
}

// ─── Post-match ratings ──────────────────────────────────────────────────────

export async function sendRatingAlerts(now = new Date()): Promise<number> {
  const rows = await db
    .select({
      fixtureId: fixturesTable.id,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      homeScore: fixturesTable.homeScore,
      awayScore: fixturesTable.awayScore,
      playerId: playersTable.id,
      playerName: playersTable.name,
      rating: matchLogsTable.rating,
      minutes: matchLogsTable.minutes,
      goals: matchLogsTable.goals,
      assists: matchLogsTable.assists,
    })
    .from(fixturesTable)
    .innerJoin(fixturePlayersTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
    .innerJoin(playersTable, eq(playersTable.id, fixturePlayersTable.playerId))
    .innerJoin(matchLogsTable, and(
      eq(matchLogsTable.playerId, playersTable.id),
      eq(matchLogsTable.apiFootballFixtureId, fixturesTable.apiFootballFixtureId),
    ))
    .where(and(
      eq(fixturesTable.status, "finished"),
      gte(fixturesTable.kickoff, new Date(now.getTime() - RATINGS_LOOKBACK_MS)),
      lte(fixturesTable.kickoff, now),
      isNotNull(matchLogsTable.rating),
      gt(matchLogsTable.minutes, 0),
    ));

  const byFixture = groupBy(rows, (r) => r.fixtureId);
  let alerts = 0;
  for (const [fixtureId, fixtureRows] of byFixture) {
    // Claimed per player: logs can arrive at different times for each side.
    const fresh: typeof fixtureRows = [];
    for (const r of fixtureRows) {
      if (fresh.some((x) => x.playerId === r.playerId)) continue;
      if (await claimPushEvent(`rating:${fixtureId}:${r.playerId}`, "ratings")) fresh.push(r);
    }
    if (fresh.length === 0) continue;
    const f = fresh[0]!;
    const byPlayer = new Map(fresh.map((r) => [r.playerId, r]));
    const score = f.homeScore !== null && f.awayScore !== null ? ` ${f.homeScore}–${f.awayScore} ` : " vs ";
    await sendAlert("ratings", [...byPlayer.keys()], (ids) => ({
      title: `Ratings: ${displayTeamName(f.homeTeam)}${score}${displayTeamName(f.awayTeam)}`,
      body: ids.map((id) => ratingLine(byPlayer.get(id)!)).join(" · "),
      url: `/matches/${fixtureId}`,
      tag: `ratings-${fixtureId}`,
    }));
    alerts++;
  }
  return alerts;
}

function ratingLine(r: { playerName: string; rating: number | null; minutes: number; goals: number; assists: number }): string {
  const extras = [r.goals > 0 ? `${r.goals}G` : "", r.assists > 0 ? `${r.assists}A` : ""].filter(Boolean).join(" ");
  return `${r.playerName} ${r.rating!.toFixed(1)} (${r.minutes}′${extras ? `, ${extras}` : ""})`;
}

// ─── Injuries ────────────────────────────────────────────────────────────────

export async function sendInjuryAlerts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INJURY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      playerId: injuriesTable.playerId,
      playerName: playersTable.name,
      bodyPart: injuriesTable.bodyPart,
      startDate: injuriesTable.startDate,
    })
    .from(injuriesTable)
    .innerJoin(playersTable, eq(playersTable.id, injuriesTable.playerId))
    .where(and(eq(injuriesTable.status, "active"), gte(injuriesTable.startDate, cutoff)));

  let alerts = 0;
  for (const r of rows) {
    // Injury rows are rebuilt on every sync, so the key is the episode itself.
    if (!(await claimPushEvent(`injury:${r.playerId}:${r.startDate}:${r.bodyPart}`, "injuries"))) continue;
    await sendAlert("injuries", [r.playerId], () => ({
      title: `Injury: ${r.playerName}`,
      body: r.bodyPart,
      url: `/players/${r.playerId}`,
      tag: `injury-${r.playerId}`,
    }));
    alerts++;
  }
  return alerts;
}

// ─── Transfers ───────────────────────────────────────────────────────────────

export async function sendTransferAlerts(now = new Date()): Promise<number> {
  const rows = await db
    .select({
      transferId: transfersTable.id,
      playerId: transfersTable.playerId,
      playerName: playersTable.name,
      fromClub: transfersTable.fromClub,
      toClub: transfersTable.toClub,
      transferType: transfersTable.transferType,
    })
    .from(transfersTable)
    .innerJoin(playersTable, eq(playersTable.id, transfersTable.playerId))
    .where(and(
      eq(transfersTable.status, "confirmed"),
      gte(transfersTable.createdAt, new Date(now.getTime() - TRANSFER_RECORDED_LOOKBACK_MS)),
      gte(transfersTable.announcedAt, new Date(now.getTime() - TRANSFER_ANNOUNCED_LOOKBACK_MS)),
    ));

  let alerts = 0;
  for (const r of rows) {
    if (!(await claimPushEvent(`transfer:${r.transferId}`, "transfers"))) continue;
    const verb = r.transferType === "loan" ? "Joins on loan:" : "Joins";
    await sendAlert("transfers", [r.playerId], () => ({
      title: `Transfer: ${r.playerName}`,
      body: `${verb} ${r.toClub} from ${r.fromClub}`,
      url: `/players/${r.playerId}`,
      tag: `transfer-${r.playerId}`,
    }));
    alerts++;
  }
  return alerts;
}

// ─── Announcements ───────────────────────────────────────────────────────────

/** Devices that would receive an announcement right now. */
export async function announcementAudience(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pushSubscriptionsTable)
    .where(sql`(${pushSubscriptionsTable.prefs} ->> 'announcements')::boolean = true`);
  return row?.n ?? 0;
}

export async function sendAnnouncement(payload: PushPayload): Promise<AlertResult> {
  return sendAlert("announcements", null, () => payload);
}

// ─── Scheduler entry point ───────────────────────────────────────────────────

/**
 * Run every scanner once. Called on each live-poll cycle (every 5 min while
 * the server is awake). Never throws: one failing scanner doesn't stop the rest.
 */
export async function runDueAlerts(now = new Date()): Promise<void> {
  const scanners: [string, (now: Date) => Promise<number>][] = [
    ["kickoff", sendKickoffReminders],
    ["ratings", sendRatingAlerts],
    ["injuries", sendInjuryAlerts],
    ["transfers", sendTransferAlerts],
  ];
  for (const [name, scan] of scanners) {
    try {
      const alerts = await scan(now);
      if (alerts > 0) logger.info({ scanner: name, alerts }, "Push alerts sent");
    } catch (err) {
      logger.warn({ err, scanner: name }, "Push alert scan failed");
    }
  }
  try {
    await db.delete(pushEventsTable).where(lt(pushEventsTable.createdAt, new Date(Date.now() - PUSH_EVENT_RETENTION_MS)));
  } catch (err) {
    logger.warn({ err }, "Pruning push_events failed");
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}
