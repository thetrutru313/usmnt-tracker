import type { DataMigration } from "./types";
import { sql } from "drizzle-orm";

// API-Football /leagues snapshot supplied 2026-11-13. Do not edit dates.
const starts: [number, string, string | null, string, "split" | "calendar"][] = [
  [39, "Premier League", "2025-08-15", "2026-08-21", "split"],
  [40, "Championship", "2025-08-08", "2026-08-14", "split"],
  [140, "La Liga", "2025-08-15", "2026-08-15", "split"],
  [141, "Segunda División", "2025-08-15", "2026-08-14", "split"],
  [78, "Bundesliga", "2025-08-22", "2026-08-28", "split"],
  [79, "2. Bundesliga", "2025-08-01", "2026-08-07", "split"],
  [135, "Serie A", "2025-08-23", "2026-08-22", "split"],
  [136, "Serie B", "2025-08-22", "2026-08-21", "split"],
  [61, "Ligue 1", "2025-08-15", "2026-08-21", "split"],
  [62, "Ligue 2", "2025-08-09", "2026-08-08", "split"],
  [88, "Eredivisie", "2025-08-08", "2026-08-07", "split"],
  [94, "Primeira Liga", "2025-08-08", "2026-08-07", "split"],
  [144, "Jupiler Pro League", "2025-07-25", "2026-08-07", "split"],
  [218, "Bundesliga (Austria)", "2025-08-01", "2026-07-31", "split"],
  [207, "Super League (Switzerland)", "2025-07-25", "2026-07-25", "split"],
  [119, "Superliga (Denmark)", "2025-07-18", "2026-07-24", "split"],
  [262, "Liga MX", "2025-07-12", "2026-07-17", "split"],
  [253, "Major League Soccer", "2025-02-22", "2026-02-21", "calendar"],
  [255, "USL Championship", "2025-03-09", "2026-03-07", "calendar"],
  [909, "MLS Next Pro", "2025-03-07", "2026-02-28", "calendar"],
  [489, "USL League One", "2025-03-08", "2026-03-08", "calendar"],
  [179, "Premiership (Scotland)", null, "2026-07-31", "split"],
  [42, "League Two", null, "2026-08-15", "split"],
];

export const leagueSeasons: DataMigration = {
  id: "0002_league_seasons",
  description: "Record league-specific start dates and season labels",
  run: async (tx) => {
    for (const [leagueId, name, start2025, start2026, type] of starts) {
      for (const [year, start] of [[2025, start2025], [2026, start2026]] as const) {
        if (start === null) continue;
        const label = type === "split" ? `${year}/${year + 1}` : `${year}`;
        await tx.execute(sql`
          INSERT INTO league_seasons (api_football_league_id, league_name, api_season, display_label, start_date)
          SELECT ${leagueId}, ${name}, ${year}, ${label}, ${start}::date
          WHERE NOT EXISTS (
            SELECT 1 FROM league_seasons
            WHERE api_football_league_id = ${leagueId} AND start_date = ${start}::date
          )
        `);
      }
    }
  },
};
