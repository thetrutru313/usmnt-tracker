import { db, leagueSeasonsTable, type LeagueSeasonRow } from "@workspace/db";
import { logger } from "./logger";

export type SeasonRow = Pick<LeagueSeasonRow, "apiFootballLeagueId" | "leagueName" | "apiSeason" | "displayLabel" | "startDate">;
export type SeasonFlag = "unlisted" | "needsRow" | null;

export async function loadLeagueSeasons(): Promise<SeasonRow[]> {
  try {
    const rows = await db.select().from(leagueSeasonsTable);
    if (rows.length === 0) logger.warn("League seasons table is empty; using legacy season rules");
    return rows;
  } catch (err) {
    logger.warn({ err }, "Cannot load league seasons; using legacy season rules");
    return [];
  }
}

export function resolvePlayerSeasons({ leagueId, rows, labelsWithData, today }: {
  leagueId: number | null; rows: SeasonRow[]; labelsWithData: number[]; today: string;
}): { current: number | null; previous: number | null; flag: SeasonFlag } {
  const labels = [...new Set(labelsWithData)].sort((a, b) => b - a);
  const tableCurrent = leagueCurrentLabel(leagueId, rows, today);
  if (tableCurrent === null) {
    return { current: labels[0] ?? null, previous: labels[1] ?? null, flag: "unlisted" };
  }
  const newest = labels[0];
  const needsRow = newest != null && newest > tableCurrent
    && !rows.some((r) => r.apiFootballLeagueId === leagueId && r.apiSeason === newest);
  const current = needsRow ? newest
    : labels.includes(tableCurrent) ? tableCurrent
      : labels.find((label) => label < tableCurrent) ?? null;
  const previous = current === null ? null : labels.find((label) => label < current) ?? null;
  return { current, previous, flag: needsRow ? "needsRow" : null };
}

export function displaySeasonLabel(leagueId: number | null, apiSeason: number, rows: SeasonRow[]): string {
  const leagueRows = rows.filter((r) => r.apiFootballLeagueId === leagueId);
  const exact = leagueRows.find((r) => r.apiSeason === apiSeason);
  if (exact) return exact.displayLabel;
  const nearest = [...leagueRows].sort((a, b) => Math.abs(a.apiSeason - apiSeason) - Math.abs(b.apiSeason - apiSeason))[0];
  return nearest && !nearest.displayLabel.includes("/") ? `${apiSeason}` : `${apiSeason}/${apiSeason + 1}`;
}

export function leagueCurrentLabel(leagueId: number | null, rows: SeasonRow[], today: string): number | null {
  return rows.filter((r) => r.apiFootballLeagueId === leagueId && r.startDate <= today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]?.apiSeason ?? null;
}
