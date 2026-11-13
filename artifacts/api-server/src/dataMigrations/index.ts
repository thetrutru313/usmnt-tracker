import { baseline } from "./0001_baseline";
import { leagueSeasons } from "./0002_league_seasons";
import type { DataMigration } from "./types";

export type { DataMigration } from "./types";
export const DATA_MIGRATIONS: DataMigration[] = [baseline, leagueSeasons];
