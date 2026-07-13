import { db } from "@workspace/db";
import {
  clubsTable,
  playersTable,
  playerStatsTable,
  matchLogsTable,
  fixturesTable,
  fixturePlayersTable,
  newsArticlesTable,
  newsArticlePlayersTable,
  injuriesTable,
  transfersTable,
  nationalTeamWindowsTable,
} from "@workspace/db";

async function main() {
  console.log("Seeding USMNT Tracker data...");

  // Clear existing data so this script can be re-run idempotently.
  await db.execute(`TRUNCATE TABLE
    fixture_players, news_article_players, match_logs, player_stats,
    injuries, transfers, fixtures, news_articles, national_team_windows,
    players, clubs
    RESTART IDENTITY CASCADE`);

  // ---- Clubs ----
  const clubDefs = [
    { name: "AC Milan", league: "Serie A", country: "Italy" },
    { name: "Juventus", league: "Serie A", country: "Italy" },
    { name: "Bournemouth", league: "Premier League", country: "England" },
    { name: "Fulham", league: "Premier League", country: "England" },
    { name: "Atalanta", league: "Serie A", country: "Italy" },
    { name: "PSV Eindhoven", league: "Eredivisie", country: "Netherlands" },
    { name: "AS Monaco", league: "Ligue 1", country: "France" },
    { name: "Olympique de Marseille", league: "Ligue 1", country: "France" },
    { name: "Crystal Palace", league: "Premier League", country: "England" },
    { name: "Borussia Dortmund", league: "Bundesliga", country: "Germany" },
    { name: "Norwich City", league: "Championship", country: "England" },
    { name: "Union Berlin", league: "Bundesliga", country: "Germany" },
    { name: "Middlesbrough", league: "Championship", country: "England" },
    { name: "AZ Alkmaar", league: "Eredivisie", country: "Netherlands" },
    { name: "Como 1907", league: "Serie A", country: "Italy" },
    { name: "Philadelphia Union", league: "MLS", country: "USA" },
    { name: "FC Barcelona", league: "La Liga", country: "Spain" },
    { name: "Inter Miami CF", league: "MLS", country: "USA" },
    { name: "Werder Bremen", league: "Bundesliga", country: "Germany" },
    { name: "Seattle Sounders FC", league: "MLS", country: "USA" },
    { name: "New England Revolution", league: "MLS", country: "USA" },
  ];

  const insertedClubs = await db.insert(clubsTable).values(clubDefs).returning();
  const clubIdByName = new Map(insertedClubs.map((c) => [c.name, c.id]));

  // ---- Players ----
  type PlayerDef = {
    name: string;
    slug: string;
    position: string;
    category: "current" | "fringe" | "prospect";
    club: string;
    age: number;
    contractUntil: string | null;
    marketValueUsd: number | null;
    caps: number;
    goals: number;
    youthNationalTeam: string | null;
    debutDate: string | null;
    callUpScore: number | null;
    trend: "rising" | "steady" | "falling";
    trending: boolean;
    bio: string;
  };

  const playerDefs: PlayerDef[] = [
    { name: "Christian Pulisic", slug: "christian-pulisic", position: "FW", category: "current", club: "AC Milan", age: 27, contractUntil: "2028-06-30", marketValueUsd: 42000000, caps: 78, goals: 30, youthNationalTeam: null, debutDate: "2016-01-29", callUpScore: null, trend: "rising", trending: true, bio: "The captain and the face of American soccer's rise in Europe. Since moving to Milan, Pulisic has rediscovered the explosive form that once made him the USMNT's most feared attacker, combining pace, close control, and a nose for the big moment." },
    { name: "Weston McKennie", slug: "weston-mckennie", position: "MF", category: "current", club: "Juventus", age: 27, contractUntil: "2027-06-30", marketValueUsd: 28000000, caps: 55, goals: 12, youthNationalTeam: null, debutDate: "2018-05-28", callUpScore: null, trend: "steady", trending: false, bio: "A box-to-box engine whose late runs and set-piece heading ability have made him a consistent source of goals from midfield for both club and country." },
    { name: "Tyler Adams", slug: "tyler-adams", position: "MF", category: "current", club: "Bournemouth", age: 26, contractUntil: "2027-06-30", marketValueUsd: 22000000, caps: 40, goals: 1, youthNationalTeam: null, debutDate: "2019-01-27", callUpScore: null, trend: "rising", trending: true, bio: "The heartbeat of the USMNT midfield — a relentless ball-winner whose return from a long hamstring layoff has coincided with a run of commanding performances." },
    { name: "Antonee Robinson", slug: "antonee-robinson", position: "DF", category: "current", club: "Fulham", age: 27, contractUntil: "2029-06-30", marketValueUsd: 24000000, caps: 48, goals: 3, youthNationalTeam: null, debutDate: "2018-01-27", callUpScore: null, trend: "steady", trending: false, bio: "Arguably the best left-back the US has produced, prized for his overlapping runs, recovery speed, and end product from wide areas." },
    { name: "Yunus Musah", slug: "yunus-musah", position: "MF", category: "current", club: "Atalanta", age: 22, contractUntil: "2028-06-30", marketValueUsd: 26000000, caps: 34, goals: 1, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "rising", trending: true, bio: "A press-resistant carrier who glides past pressure in tight spaces, Musah has grown into one of Serie A's most reliable young midfielders." },
    { name: "Ricardo Pepi", slug: "ricardo-pepi", position: "FW", category: "current", club: "PSV Eindhoven", age: 22, contractUntil: "2027-06-30", marketValueUsd: 20000000, caps: 30, goals: 12, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "rising", trending: true, bio: "A ruthless penalty-box finisher who has rebuilt his career in the Netherlands into one of the most productive striker spells by an American abroad." },
    { name: "Folarin Balogun", slug: "folarin-balogun", position: "FW", category: "current", club: "AS Monaco", age: 23, contractUntil: "2028-06-30", marketValueUsd: 30000000, caps: 12, goals: 4, youthNationalTeam: null, debutDate: "2023-09-09", callUpScore: null, trend: "steady", trending: false, bio: "A sharp, mobile striker whose move to Ligue 1 was meant to be a proving ground — the goals have arrived in flashes, with more expected." },
    { name: "Timothy Weah", slug: "timothy-weah", position: "FW", category: "current", club: "Olympique de Marseille", age: 25, contractUntil: "2027-06-30", marketValueUsd: 18000000, caps: 42, goals: 8, youthNationalTeam: null, debutDate: "2018-01-28", callUpScore: null, trend: "steady", trending: false, bio: "Versatile enough to play across the front line or at right-back, Weah's directness and work rate make him a coach's favorite utility weapon." },
    { name: "Malik Tillman", slug: "malik-tillman", position: "MF", category: "current", club: "PSV Eindhoven", age: 23, contractUntil: "2027-06-30", marketValueUsd: 27000000, caps: 20, goals: 9, youthNationalTeam: null, debutDate: "2023-06-17", callUpScore: null, trend: "rising", trending: true, bio: "Since switching allegiance to the US, Tillman has been PSV's chief creative outlet — a shifty attacking midfielder who scores as often as he assists." },
    { name: "Sergiño Dest", slug: "sergino-dest", position: "DF", category: "current", club: "PSV Eindhoven", age: 24, contractUntil: "2026-06-30", marketValueUsd: 16000000, caps: 33, goals: 2, youthNationalTeam: null, debutDate: "2019-11-15", callUpScore: null, trend: "steady", trending: false, bio: "An attack-minded full-back whose overlapping runs and dribbling out of the back have made him a fan favorite whenever he's fit." },
    { name: "Chris Richards", slug: "chris-richards", position: "DF", category: "current", club: "Crystal Palace", age: 25, contractUntil: "2028-06-30", marketValueUsd: 15000000, caps: 24, goals: 1, youthNationalTeam: null, debutDate: "2020-11-11", callUpScore: null, trend: "steady", trending: false, bio: "A composed, ball-playing center-back who has finally found an extended run of fitness and form on Palace's Premier League backline." },
    { name: "Matt Turner", slug: "matt-turner", position: "GK", category: "current", club: "Crystal Palace", age: 31, contractUntil: "2026-06-30", marketValueUsd: 6000000, caps: 41, goals: 0, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "steady", trending: false, bio: "The long-time USMNT number one, valued for his shot-stopping reflexes and calm distribution under pressure." },
    { name: "Giovanni Reyna", slug: "giovanni-reyna", position: "MF", category: "current", club: "Borussia Dortmund", age: 23, contractUntil: "2026-06-30", marketValueUsd: 14000000, caps: 27, goals: 6, youthNationalTeam: null, debutDate: "2020-09-03", callUpScore: null, trend: "falling", trending: false, bio: "Once the USMNT's most hyped young creator, Reyna's injury-hit few years have quieted the noise around him, though the underlying quality remains obvious in flashes." },
    { name: "Josh Sargent", slug: "josh-sargent", position: "FW", category: "current", club: "Norwich City", age: 25, contractUntil: "2027-06-30", marketValueUsd: 11000000, caps: 33, goals: 8, youthNationalTeam: null, debutDate: "2018-01-28", callUpScore: null, trend: "steady", trending: false, bio: "A hard-working target man whose hold-up play and aerial threat have made him a reliable Championship goal scorer for Norwich." },
    { name: "Paxten Aaronson", slug: "paxten-aaronson", position: "MF", category: "fringe", club: "Union Berlin", age: 21, contractUntil: "2027-06-30", marketValueUsd: 6000000, caps: 3, goals: 0, youthNationalTeam: null, debutDate: "2023-06-17", callUpScore: 62, trend: "rising", trending: true, bio: "A tidy, tactically intelligent attacking midfielder who has been on the fringes of the senior squad while establishing himself in the Bundesliga." },
    { name: "Aidan Morris", slug: "aidan-morris", position: "MF", category: "fringe", club: "Middlesbrough", age: 24, contractUntil: "2028-06-30", marketValueUsd: 7000000, caps: 8, goals: 0, youthNationalTeam: null, debutDate: "2023-01-25", callUpScore: 58, trend: "steady", trending: false, bio: "A tenacious defensive midfielder whose ball-winning profile mirrors Tyler Adams — a natural depth option in the deepest midfield role." },
    { name: "Djordje Mihailovic", slug: "djordje-mihailovic", position: "MF", category: "fringe", club: "AZ Alkmaar", age: 26, contractUntil: "2026-06-30", marketValueUsd: 9000000, caps: 15, goals: 2, youthNationalTeam: null, debutDate: "2021-06-06", callUpScore: 55, trend: "steady", trending: false, bio: "A left-footed playmaker who has quietly built one of the more productive underlying-numbers seasons of any American in Europe." },
    { name: "Tanner Tessmann", slug: "tanner-tessmann", position: "MF", category: "fringe", club: "Como 1907", age: 23, contractUntil: "2027-06-30", marketValueUsd: 8000000, caps: 6, goals: 0, youthNationalTeam: null, debutDate: "2022-06-05", callUpScore: 51, trend: "rising", trending: true, bio: "A physically imposing midfield anchor who has settled into Serie A quicker than expected after his move from MLS." },
    { name: "Cavan Sullivan", slug: "cavan-sullivan", position: "FW", category: "prospect", club: "Philadelphia Union", age: 15, contractUntil: "2029-12-31", marketValueUsd: 3000000, caps: 0, goals: 0, youthNationalTeam: "U-17", debutDate: "2024-05-18", callUpScore: 34, trend: "rising", trending: true, bio: "The youngest player ever to appear in MLS, Sullivan's blistering acceleration and finishing instincts have scouts across Europe circling." },
    { name: "Diego Kochen", slug: "diego-kochen", position: "GK", category: "prospect", club: "FC Barcelona", age: 18, contractUntil: "2027-06-30", marketValueUsd: 2500000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 22, trend: "rising", trending: false, bio: "A towering, composed shot-stopper progressing through Barcelona's famed academy pipeline, tipped as the long-term successor between the posts." },
    { name: "Benjamin Cremaschi", slug: "benjamin-cremaschi", position: "MF", category: "prospect", club: "Inter Miami CF", age: 20, contractUntil: "2027-12-31", marketValueUsd: 4000000, caps: 2, goals: 0, youthNationalTeam: "U-23", debutDate: "2024-01-18", callUpScore: 41, trend: "rising", trending: true, bio: "A composed deep-lying playmaker who has thrived alongside Messi and Busquets at Inter Miami, dictating tempo well beyond his years." },
    { name: "Noel Buck", slug: "noel-buck", position: "MF", category: "prospect", club: "Werder Bremen", age: 20, contractUntil: "2026-06-30", marketValueUsd: 2000000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 24, trend: "steady", trending: false, bio: "A tall, combative midfielder working his way up Werder Bremen's squad, admired for his range of passing and tackling numbers." },
    { name: "Obed Vargas", slug: "obed-vargas", position: "MF", category: "prospect", club: "Seattle Sounders FC", age: 20, contractUntil: "2027-12-31", marketValueUsd: 3500000, caps: 3, goals: 0, youthNationalTeam: "U-23", debutDate: "2023-10-14", callUpScore: 39, trend: "steady", trending: false, bio: "A physically mature two-way midfielder who broke through as a teenager in Seattle and has continued to add polish to his game each season." },
    { name: "Nimfasha Berchimas", slug: "nimfasha-berchimas", position: "DF", category: "prospect", club: "New England Revolution", age: 19, contractUntil: "2026-12-31", marketValueUsd: 1200000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: "2024-08-24", callUpScore: 19, trend: "rising", trending: false, bio: "An athletic, ball-playing center-back prospect who has forced his way into New England's first team ahead of schedule." },
  ];

  const insertedPlayers = await db
    .insert(playersTable)
    .values(
      playerDefs.map((p) => ({
        name: p.name,
        slug: p.slug,
        position: p.position,
        category: p.category,
        clubId: clubIdByName.get(p.club)!,
        photoUrl: null,
        age: p.age,
        contractUntil: p.contractUntil,
        marketValueUsd: p.marketValueUsd,
        nationalTeamCaps: p.caps,
        nationalTeamGoals: p.goals,
        youthNationalTeam: p.youthNationalTeam,
        debutDate: p.debutDate,
        potentialCallUpScore: p.callUpScore,
        performanceTrend: p.trend,
        trending: p.trending,
        bio: p.bio,
      })),
    )
    .returning();

  const playerIdBySlug = new Map(insertedPlayers.map((p) => [p.slug, p.id]));
  const playerByName = new Map(playerDefs.map((p, i) => [p.name, insertedPlayers[i]]));

  // ---- Player Stats (season, last5, previous_season) ----
  type StatProfile = {
    minutes: number;
    starts: number;
    goals: number;
    assists: number;
    xg: number;
    xa: number;
    shots: number;
    keyPasses: number;
    passCompletionPct: number;
    progressivePasses: number;
    progressiveCarries: number;
    tackles: number;
    interceptions: number;
    duelsWonPct: number;
    cleanSheets: number;
    savePct: number | null;
    avgRating: number;
  };

  function scale(profile: StatProfile, factor: number): StatProfile {
    return {
      minutes: Math.round(profile.minutes * factor),
      starts: Math.max(0, Math.round(profile.starts * factor)),
      goals: Math.max(0, Math.round(profile.goals * factor)),
      assists: Math.max(0, Math.round(profile.assists * factor)),
      xg: Math.round(profile.xg * factor * 10) / 10,
      xa: Math.round(profile.xa * factor * 10) / 10,
      shots: Math.round(profile.shots * factor),
      keyPasses: Math.round(profile.keyPasses * factor),
      passCompletionPct: profile.passCompletionPct,
      progressivePasses: Math.round(profile.progressivePasses * factor),
      progressiveCarries: Math.round(profile.progressiveCarries * factor),
      tackles: Math.round(profile.tackles * factor),
      interceptions: Math.round(profile.interceptions * factor),
      duelsWonPct: profile.duelsWonPct,
      cleanSheets: Math.round(profile.cleanSheets * factor),
      savePct: profile.savePct,
      avgRating: profile.avgRating,
    };
  }

  const seasonProfiles: Record<string, StatProfile> = {
    "Christian Pulisic": { minutes: 2450, starts: 27, goals: 14, assists: 9, xg: 12.1, xa: 7.8, shots: 78, keyPasses: 54, passCompletionPct: 82.4, progressivePasses: 96, progressiveCarries: 112, tackles: 22, interceptions: 14, duelsWonPct: 51.2, cleanSheets: 0, savePct: null, avgRating: 7.4 },
    "Weston McKennie": { minutes: 2280, starts: 26, goals: 7, assists: 4, xg: 5.2, xa: 3.6, shots: 41, keyPasses: 22, passCompletionPct: 86.1, progressivePasses: 128, progressiveCarries: 64, tackles: 48, interceptions: 26, duelsWonPct: 58.4, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Tyler Adams": { minutes: 1580, starts: 18, goals: 0, assists: 2, xg: 0.6, xa: 1.4, shots: 9, keyPasses: 14, passCompletionPct: 89.7, progressivePasses: 142, progressiveCarries: 38, tackles: 68, interceptions: 44, duelsWonPct: 62.1, cleanSheets: 0, savePct: null, avgRating: 7.1 },
    "Antonee Robinson": { minutes: 2610, starts: 29, goals: 2, assists: 6, xg: 1.4, xa: 4.9, shots: 24, keyPasses: 38, passCompletionPct: 80.5, progressivePasses: 118, progressiveCarries: 96, tackles: 52, interceptions: 34, duelsWonPct: 55.6, cleanSheets: 0, savePct: null, avgRating: 7.0 },
    "Yunus Musah": { minutes: 2140, starts: 24, goals: 1, assists: 3, xg: 1.1, xa: 2.4, shots: 18, keyPasses: 19, passCompletionPct: 90.2, progressivePasses: 108, progressiveCarries: 122, tackles: 44, interceptions: 22, duelsWonPct: 56.8, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Ricardo Pepi": { minutes: 2380, starts: 27, goals: 18, assists: 5, xg: 15.4, xa: 3.9, shots: 92, keyPasses: 21, passCompletionPct: 76.9, progressivePasses: 38, progressiveCarries: 44, tackles: 8, interceptions: 6, duelsWonPct: 48.9, cleanSheets: 0, savePct: null, avgRating: 7.5 },
    "Folarin Balogun": { minutes: 1720, starts: 19, goals: 9, assists: 2, xg: 9.8, xa: 1.6, shots: 61, keyPasses: 14, passCompletionPct: 74.2, progressivePasses: 22, progressiveCarries: 34, tackles: 6, interceptions: 4, duelsWonPct: 46.1, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Timothy Weah": { minutes: 1980, starts: 22, goals: 5, assists: 4, xg: 4.6, xa: 3.2, shots: 38, keyPasses: 26, passCompletionPct: 79.8, progressivePasses: 64, progressiveCarries: 58, tackles: 24, interceptions: 12, duelsWonPct: 52.3, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Malik Tillman": { minutes: 2560, starts: 28, goals: 12, assists: 11, xg: 10.9, xa: 8.7, shots: 71, keyPasses: 62, passCompletionPct: 81.6, progressivePasses: 88, progressiveCarries: 104, tackles: 18, interceptions: 10, duelsWonPct: 49.8, cleanSheets: 0, savePct: null, avgRating: 7.6 },
    "Sergiño Dest": { minutes: 1340, starts: 15, goals: 1, assists: 3, xg: 1.0, xa: 2.6, shots: 16, keyPasses: 22, passCompletionPct: 82.1, progressivePasses: 62, progressiveCarries: 58, tackles: 26, interceptions: 16, duelsWonPct: 53.4, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Chris Richards": { minutes: 2670, starts: 29, goals: 1, assists: 1, xg: 1.2, xa: 0.6, shots: 14, keyPasses: 6, passCompletionPct: 88.9, progressivePasses: 74, progressiveCarries: 22, tackles: 42, interceptions: 58, duelsWonPct: 64.7, cleanSheets: 9, savePct: null, avgRating: 6.9 },
    "Matt Turner": { minutes: 900, starts: 10, goals: 0, assists: 0, xg: 0, xa: 0, shots: 0, keyPasses: 0, passCompletionPct: 68.4, progressivePasses: 4, progressiveCarries: 0, tackles: 0, interceptions: 2, duelsWonPct: 0, cleanSheets: 3, savePct: 71.2, avgRating: 6.6 },
    "Giovanni Reyna": { minutes: 980, starts: 10, goals: 3, assists: 3, xg: 2.8, xa: 2.2, shots: 26, keyPasses: 18, passCompletionPct: 83.5, progressivePasses: 42, progressiveCarries: 48, tackles: 10, interceptions: 6, duelsWonPct: 47.2, cleanSheets: 0, savePct: null, avgRating: 6.7 },
    "Josh Sargent": { minutes: 2210, starts: 25, goals: 11, assists: 4, xg: 9.6, xa: 3.4, shots: 58, keyPasses: 20, passCompletionPct: 75.1, progressivePasses: 28, progressiveCarries: 30, tackles: 12, interceptions: 8, duelsWonPct: 54.9, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Paxten Aaronson": { minutes: 860, starts: 8, goals: 2, assists: 3, xg: 1.9, xa: 2.4, shots: 20, keyPasses: 16, passCompletionPct: 84.7, progressivePasses: 36, progressiveCarries: 40, tackles: 10, interceptions: 6, duelsWonPct: 50.1, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Aidan Morris": { minutes: 1620, starts: 18, goals: 0, assists: 1, xg: 0.4, xa: 0.9, shots: 8, keyPasses: 10, passCompletionPct: 87.3, progressivePasses: 92, progressiveCarries: 24, tackles: 56, interceptions: 34, duelsWonPct: 59.6, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Djordje Mihailovic": { minutes: 2320, starts: 26, goals: 6, assists: 10, xg: 5.4, xa: 8.9, shots: 44, keyPasses: 58, passCompletionPct: 83.0, progressivePasses: 76, progressiveCarries: 66, tackles: 20, interceptions: 12, duelsWonPct: 48.6, cleanSheets: 0, savePct: null, avgRating: 7.2 },
    "Tanner Tessmann": { minutes: 1740, starts: 19, goals: 1, assists: 2, xg: 0.8, xa: 1.6, shots: 12, keyPasses: 12, passCompletionPct: 88.1, progressivePasses: 84, progressiveCarries: 20, tackles: 50, interceptions: 30, duelsWonPct: 57.9, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Cavan Sullivan": { minutes: 620, starts: 4, goals: 3, assists: 2, xg: 2.6, xa: 1.8, shots: 18, keyPasses: 10, passCompletionPct: 71.4, progressivePasses: 14, progressiveCarries: 26, tackles: 4, interceptions: 2, duelsWonPct: 42.3, cleanSheets: 0, savePct: null, avgRating: 6.7 },
    "Diego Kochen": { minutes: 270, starts: 3, goals: 0, assists: 0, xg: 0, xa: 0, shots: 0, keyPasses: 0, passCompletionPct: 65.2, progressivePasses: 2, progressiveCarries: 0, tackles: 0, interceptions: 1, duelsWonPct: 0, cleanSheets: 1, savePct: 68.8, avgRating: 6.5 },
    "Benjamin Cremaschi": { minutes: 1980, starts: 22, goals: 4, assists: 8, xg: 3.6, xa: 6.9, shots: 30, keyPasses: 46, passCompletionPct: 86.8, progressivePasses: 94, progressiveCarries: 42, tackles: 24, interceptions: 16, duelsWonPct: 49.4, cleanSheets: 0, savePct: null, avgRating: 7.1 },
    "Noel Buck": { minutes: 540, starts: 5, goals: 0, assists: 1, xg: 0.3, xa: 0.7, shots: 6, keyPasses: 6, passCompletionPct: 82.6, progressivePasses: 22, progressiveCarries: 10, tackles: 16, interceptions: 10, duelsWonPct: 52.8, cleanSheets: 0, savePct: null, avgRating: 6.6 },
    "Obed Vargas": { minutes: 1640, starts: 17, goals: 1, assists: 2, xg: 0.9, xa: 1.4, shots: 14, keyPasses: 14, passCompletionPct: 85.4, progressivePasses: 70, progressiveCarries: 34, tackles: 46, interceptions: 24, duelsWonPct: 55.1, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Nimfasha Berchimas": { minutes: 980, starts: 10, goals: 0, assists: 0, xg: 0.1, xa: 0.2, shots: 3, keyPasses: 4, passCompletionPct: 84.9, progressivePasses: 32, progressiveCarries: 8, tackles: 22, interceptions: 20, duelsWonPct: 58.2, cleanSheets: 4, savePct: null, avgRating: 6.7 },
  };

  const statRows = [];
  for (const [name, profile] of Object.entries(seasonProfiles)) {
    const player = playerByName.get(name)!;
    statRows.push({ playerId: player.id, periodType: "season", season: "2025/26", ...profile });
    statRows.push({ playerId: player.id, periodType: "last5", season: "2025/26", ...scale(profile, 5 / 32) });
    statRows.push({ playerId: player.id, periodType: "previous_season", season: "2024/25", ...scale(profile, 0.85) });
  }
  await db.insert(playerStatsTable).values(statRows);

  // ---- Match Logs (5 recent matches per current/fringe player) ----
  const competitionsByLeague: Record<string, string> = {
    "Serie A": "Serie A",
    "Premier League": "Premier League",
    Eredivisie: "Eredivisie",
    "Ligue 1": "Ligue 1",
    Bundesliga: "Bundesliga",
    Championship: "Championship",
    MLS: "MLS",
    "La Liga": "La Liga",
  };

  const opponentsByLeague: Record<string, string[]> = {
    "Serie A": ["Inter", "Napoli", "Roma", "Fiorentina", "Bologna"],
    "Premier League": ["Arsenal", "Newcastle", "Brighton", "Everton", "Aston Villa"],
    Eredivisie: ["Ajax", "Feyenoord", "Twente", "Utrecht", "AZ Alkmaar"],
    "Ligue 1": ["PSG", "Lyon", "Lille", "Nice", "Rennes"],
    Bundesliga: ["Bayern Munich", "RB Leipzig", "Leverkusen", "Freiburg", "Mainz"],
    Championship: ["Leeds United", "Sunderland", "Sheffield United", "West Brom", "Coventry"],
    MLS: ["LAFC", "Columbus Crew", "Orlando City", "Atlanta United", "FC Cincinnati"],
    "La Liga": ["Real Madrid", "Atletico Madrid", "Sevilla", "Villarreal", "Real Sociedad"],
  };

  const dayOffsets = [-4, -11, -18, -25, -32];
  const matchLogRows = [];
  for (const [name, profile] of Object.entries(seasonProfiles)) {
    const player = playerByName.get(name)!;
    const def = playerDefs.find((p) => p.name === name)!;
    const club = insertedClubs.find((c) => c.id === player.clubId)!;
    const opponents = opponentsByLeague[club.league] ?? ["Regional FC"];
    for (let i = 0; i < 5; i++) {
      const opponent = opponents[i % opponents.length];
      const goals = i === 0 && profile.goals > 8 ? 1 : Math.random() < profile.goals / 100 ? 1 : 0;
      const assists = i === 1 && profile.assists > 6 ? 1 : 0;
      const results = ["W 2-1", "D 1-1", "W 3-0", "L 0-1", "W 2-0"];
      const rating = Math.round((profile.avgRating + (Math.random() * 1.2 - 0.6)) * 10) / 10;
      matchLogRows.push({
        playerId: player.id,
        date: isoDateOffset(dayOffsets[i]),
        opponent,
        competition: competitionsByLeague[club.league] ?? club.league,
        result: results[i % results.length],
        minutes: def.position === "GK" ? 90 : 60 + Math.round(Math.random() * 30),
        goals,
        assists,
        rating: Math.max(5.5, Math.min(9.5, rating)),
      });
    }
  }
  await db.insert(matchLogsTable).values(matchLogRows);

  // ---- Fixtures ----
  function isoDateOffset(days: number): string {
    const d = new Date("2026-07-13T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function isoDateTimeOffset(days: number, hour: number, minute = 0): Date {
    const d = new Date("2026-07-13T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hour, minute, 0, 0);
    return d;
  }

  const fixtureDefs: {
    isNationalTeam: boolean;
    competition: string;
    daysFromNow: number;
    hour: number;
    venue: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number | null;
    awayScore: number | null;
    status: "scheduled" | "live" | "finished" | "postponed";
    tvNetwork: string | null;
    streamingService: string | null;
    broadcastLink: string | null;
    featured: string[];
  }[] = [
    { isNationalTeam: false, competition: "Serie A", daysFromNow: 0, hour: 14, venue: "San Siro, Milan", homeTeam: "AC Milan", awayTeam: "Inter", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "CBS Sports Network", streamingService: "Paramount+", broadcastLink: null, featured: ["Christian Pulisic"] },
    { isNationalTeam: false, competition: "Premier League", daysFromNow: 0, hour: 15, venue: "Vitality Stadium, Bournemouth", homeTeam: "Bournemouth", awayTeam: "Fulham", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "USA Network", streamingService: "Fubo", broadcastLink: null, featured: ["Tyler Adams", "Antonee Robinson"] },
    { isNationalTeam: false, competition: "Eredivisie", daysFromNow: 0, hour: 18, venue: "Philips Stadion, Eindhoven", homeTeam: "PSV Eindhoven", awayTeam: "AZ Alkmaar", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: null, streamingService: "ESPN+", broadcastLink: null, featured: ["Ricardo Pepi", "Malik Tillman", "Sergiño Dest", "Djordje Mihailovic"] },
    { isNationalTeam: false, competition: "Serie A", daysFromNow: 1, hour: 12, venue: "Allianz Stadium, Turin", homeTeam: "Juventus", awayTeam: "Bologna", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "CBS Sports Network", streamingService: "Paramount+", broadcastLink: null, featured: ["Weston McKennie"] },
    { isNationalTeam: false, competition: "Ligue 1", daysFromNow: 2, hour: 19, venue: "Stade Louis II, Monaco", homeTeam: "AS Monaco", awayTeam: "Lille", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: null, streamingService: "beIN Sports", broadcastLink: null, featured: ["Folarin Balogun"] },
    { isNationalTeam: false, competition: "Bundesliga", daysFromNow: 3, hour: 13, venue: "Signal Iduna Park, Dortmund", homeTeam: "Borussia Dortmund", awayTeam: "Mainz", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: null, streamingService: "ESPN+", broadcastLink: null, featured: ["Giovanni Reyna"] },
    { isNationalTeam: false, competition: "Championship", daysFromNow: 4, hour: 14, venue: "Carrow Road, Norwich", homeTeam: "Norwich City", awayTeam: "Leeds United", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: null, streamingService: "ESPN+", broadcastLink: null, featured: ["Josh Sargent"] },
    { isNationalTeam: false, competition: "MLS", daysFromNow: 5, hour: 20, venue: "Subaru Park, Philadelphia", homeTeam: "Philadelphia Union", awayTeam: "Columbus Crew", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: null, streamingService: "Apple TV", broadcastLink: null, featured: ["Cavan Sullivan"] },
    { isNationalTeam: false, competition: "MLS", daysFromNow: 5, hour: 21, venue: "Chase Stadium, Fort Lauderdale", homeTeam: "Inter Miami CF", awayTeam: "Atlanta United", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: null, streamingService: "Apple TV", broadcastLink: null, featured: ["Benjamin Cremaschi"] },
    { isNationalTeam: false, competition: "Premier League", daysFromNow: -3, hour: 15, venue: "Selhurst Park, London", homeTeam: "Crystal Palace", awayTeam: "Everton", homeScore: 2, awayScore: 1, status: "finished", tvNetwork: "USA Network", streamingService: "Fubo", broadcastLink: null, featured: ["Chris Richards", "Matt Turner"] },
    { isNationalTeam: true, competition: "World Cup Qualifying", daysFromNow: 42, hour: 19, venue: "Allianz Field, Saint Paul", homeTeam: "USA", awayTeam: "Panama", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "TNT", streamingService: "Fubo", broadcastLink: null, featured: ["Christian Pulisic", "Weston McKennie", "Tyler Adams", "Antonee Robinson", "Yunus Musah", "Ricardo Pepi", "Matt Turner"] },
    { isNationalTeam: true, competition: "International Friendly", daysFromNow: 46, hour: 20, venue: "Q2 Stadium, Austin", homeTeam: "USA", awayTeam: "Colombia", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "TNT", streamingService: "Fubo", broadcastLink: null, featured: ["Christian Pulisic", "Malik Tillman", "Folarin Balogun", "Timothy Weah", "Chris Richards"] },
  ];

  for (const f of fixtureDefs) {
    const [fixture] = await db
      .insert(fixturesTable)
      .values({
        isNationalTeam: f.isNationalTeam,
        competition: f.competition,
        kickoff: isoDateTimeOffset(f.daysFromNow, f.hour),
        venue: f.venue,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        homeLogoUrl: null,
        awayLogoUrl: null,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        status: f.status,
        tvNetwork: f.tvNetwork,
        streamingService: f.streamingService,
        broadcastLink: f.broadcastLink,
      })
      .returning();
    const rows = f.featured
      .map((name) => playerByName.get(name))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ fixtureId: fixture.id, playerId: p.id }));
    if (rows.length) await db.insert(fixturePlayersTable).values(rows);
  }

  // ---- News Articles ----
  const newsDefs: {
    headline: string;
    source: string;
    hoursAgo: number;
    category: string;
    url: string;
    summary: string;
    whyItMatters: string;
    impactScore: number;
    sentiment: "positive" | "neutral" | "negative";
    players: string[];
  }[] = [
    { headline: "Tyler Adams returns to the starting XI after hamstring scare", source: "ESPN Soccer", hoursAgo: 6, category: "Injuries", url: "https://espn.com/soccer", summary: "Tyler Adams started for Bournemouth for the first time in three weeks, playing 75 minutes before being withdrawn as a precaution. He looked sharp in the tackle and controlled tempo from deep.", whyItMatters: "A fit Adams anchoring midfield is central to the USMNT's defensive identity heading into World Cup qualifying.", impactScore: 8, sentiment: "positive", players: ["Tyler Adams"] },
    { headline: "Malik Tillman nets brace as PSV cruise past AZ", source: "The Athletic", hoursAgo: 14, category: "Goals", url: "https://theathletic.com", summary: "Malik Tillman scored twice and set up a third as PSV extended their unbeaten run, continuing arguably the best form of any American abroad this season.", whyItMatters: "Tillman is emerging as a genuine attacking-midfield option for the national team, adding goal threat from a deeper role.", impactScore: 7, sentiment: "positive", players: ["Malik Tillman"] },
    { headline: "Folarin Balogun linked with Ligue 1 rivals amid patchy Monaco minutes", source: "Fabrizio Romano", hoursAgo: 20, category: "Transfer Rumors", url: "https://fabrizioromano.com", summary: "Sources close to the player suggest Balogun is growing frustrated with rotation at Monaco, with at least two Ligue 1 clubs monitoring his situation ahead of the winter window.", whyItMatters: "Regular minutes matter more than club prestige for a striker fighting for a World Cup roster spot.", impactScore: 6, sentiment: "neutral", players: ["Folarin Balogun"] },
    { headline: "Christian Pulisic named Milan's Player of the Month", source: "Goal", hoursAgo: 26, category: "Awards", url: "https://goal.com", summary: "Pulisic was voted AC Milan's Player of the Month after contributing four goals and three assists across six appearances, his best individual run in Serie A to date.", whyItMatters: "Pulisic's captaincy and form give the USMNT a clear focal point in the final third.", impactScore: 9, sentiment: "positive", players: ["Christian Pulisic"] },
    { headline: "Chris Richards signs contract extension through 2028", source: "BBC Sport", hoursAgo: 30, category: "Contract Extensions", url: "https://bbc.com/sport", summary: "Crystal Palace confirmed Chris Richards has signed a new three-year deal, rewarding a breakout season at the heart of their defense.", whyItMatters: "Long-term stability at center-back strengthens the USMNT's backline depth chart.", impactScore: 6, sentiment: "positive", players: ["Chris Richards"] },
    { headline: "Gio Reyna limited to bench role again at Dortmund", source: "Bundesliga", hoursAgo: 34, category: "Club News", url: "https://bundesliga.com", summary: "Reyna made a late substitute appearance in Dortmund's midweek win, his fourth straight game starting from the bench under the current manager.", whyItMatters: "Reduced minutes make it harder for Reyna to force his way back into a crowded USMNT attacking pool.", impactScore: 5, sentiment: "negative", players: ["Giovanni Reyna"] },
    { headline: "Weston McKennie's agent confirms Juventus wants new deal", source: "ESPN Soccer", hoursAgo: 40, category: "Contract Extensions", url: "https://espn.com/soccer", summary: "McKennie's representatives confirmed talks are underway over an extension that would keep the midfielder in Turin beyond 2027.", whyItMatters: "Settled club situations tend to correlate with McKennie's best national-team form.", impactScore: 5, sentiment: "positive", players: ["Weston McKennie"] },
    { headline: "Cavan Sullivan named to preliminary U-20 squad", source: "US Soccer", hoursAgo: 44, category: "National Team Call-ups", url: "https://ussoccer.com", summary: "The 15-year-old Philadelphia Union forward was included in the preliminary U-20 roster, another step in an accelerated development pathway.", whyItMatters: "Sullivan remains the clearest teenage breakthrough talent in the American pool, with senior-team buzz already building.", impactScore: 6, sentiment: "positive", players: ["Cavan Sullivan"] },
    { headline: "Djordje Mihailovic quietly posts a career-best assist tally", source: "MLS Soccer", hoursAgo: 50, category: "Club News", url: "https://mlssoccer.com", summary: "Mihailovic's ten assists in the Eredivisie put him among the league's most productive creators, a number that has flown under the radar stateside.", whyItMatters: "His underlying numbers make a case for a recall that hasn't followed the results yet.", impactScore: 5, sentiment: "positive", players: ["Djordje Mihailovic"] },
    { headline: "Sergiño Dest working back to full fitness after knee issue", source: "FotMob", hoursAgo: 55, category: "Injuries", url: "https://fotmob.com", summary: "Dest featured for PSV's reserve side as part of a graded return-to-play plan, with the club hopeful he rejoins first-team training within two weeks.", whyItMatters: "A healthy Dest gives the USMNT a genuine attacking option at right-back for qualifying.", impactScore: 6, sentiment: "neutral", players: ["Sergiño Dest"] },
    { headline: "Ricardo Pepi's goal streak draws Bundesliga interest", source: "Sofascore", hoursAgo: 60, category: "Transfer Rumors", url: "https://sofascore.com", summary: "Pepi's run of six goals in seven Eredivisie appearances has reportedly attracted scouting interest from two Bundesliga clubs ahead of the summer window.", whyItMatters: "A step up in league quality could sharpen Pepi's case as the USMNT's long-term No. 9.", impactScore: 6, sentiment: "positive", players: ["Ricardo Pepi"] },
    { headline: "US Soccer confirms September qualifying window dates and venues", source: "US Soccer", hoursAgo: 70, category: "International Break", url: "https://ussoccer.com", summary: "The federation confirmed Saint Paul and Austin will host the USMNT's next qualifying and friendly fixtures, with ticket details to follow.", whyItMatters: "Fans finally have concrete dates to plan around for the next chance to see the full player pool together.", impactScore: 4, sentiment: "neutral", players: ["Christian Pulisic", "Tyler Adams"] },
  ];

  for (const n of newsDefs) {
    const publishedAt = new Date("2026-07-13T12:00:00Z");
    publishedAt.setUTCHours(publishedAt.getUTCHours() - n.hoursAgo);
    const [article] = await db
      .insert(newsArticlesTable)
      .values({
        headline: n.headline,
        source: n.source,
        publishedAt: publishedAt,
        category: n.category,
        url: n.url,
        summary: n.summary,
        whyItMatters: n.whyItMatters,
        impactScore: n.impactScore,
        sentiment: n.sentiment,
      })
      .returning();
    const rows = n.players
      .map((name) => playerByName.get(name))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ articleId: article.id, playerId: p.id }));
    if (rows.length) await db.insert(newsArticlePlayersTable).values(rows);
  }

  // ---- Injuries ----
  const injuryDefs: {
    player: string;
    bodyPart: string;
    status: "active" | "recovering" | "returned";
    expectedReturn: string | null;
    daysMissed: number;
    matchesMissed: number;
    latestUpdate: string;
    startDaysAgo: number;
  }[] = [
    { player: "Sergiño Dest", bodyPart: "Knee", status: "recovering", expectedReturn: isoDateOffset(10), daysMissed: 38, matchesMissed: 9, latestUpdate: "Cleared for non-contact training; expected to rejoin full sessions within two weeks.", startDaysAgo: 38 },
    { player: "Giovanni Reyna", bodyPart: "Hamstring", status: "active", expectedReturn: isoDateOffset(21), daysMissed: 14, matchesMissed: 3, latestUpdate: "Dortmund's medical staff say Reyna will be reassessed after a further week of rehab.", startDaysAgo: 14 },
    { player: "Tyler Adams", bodyPart: "Hamstring", status: "returned", expectedReturn: isoDateOffset(-6), daysMissed: 91, matchesMissed: 18, latestUpdate: "Made a full 75-minute return to the Bournemouth starting XI over the weekend without setback.", startDaysAgo: 97 },
    { player: "Josh Sargent", bodyPart: "Ankle", status: "recovering", expectedReturn: isoDateOffset(5), daysMissed: 12, matchesMissed: 2, latestUpdate: "Sargent is back running on the pitch and targeting a return for Norwich's next home fixture.", startDaysAgo: 12 },
    { player: "Diego Kochen", bodyPart: "Wrist", status: "active", expectedReturn: isoDateOffset(15), daysMissed: 8, matchesMissed: 1, latestUpdate: "Barcelona's academy staff are managing the injury conservatively given his age and workload.", startDaysAgo: 8 },
    { player: "Obed Vargas", bodyPart: "Groin", status: "returned", expectedReturn: isoDateOffset(-14), daysMissed: 21, matchesMissed: 4, latestUpdate: "Back to full training with Seattle and available for selection.", startDaysAgo: 35 },
  ];

  for (const inj of injuryDefs) {
    const player = playerByName.get(inj.player)!;
    await db.insert(injuriesTable).values({
      playerId: player.id,
      bodyPart: inj.bodyPart,
      status: inj.status,
      expectedReturn: inj.expectedReturn,
      daysMissed: inj.daysMissed,
      matchesMissed: inj.matchesMissed,
      latestUpdate: inj.latestUpdate,
      startDate: isoDateOffset(-inj.startDaysAgo),
    });
  }

  // ---- Transfers ----
  const transferDefs: {
    player: string;
    fromClub: string;
    toClub: string;
    transferType: "transfer" | "loan" | "contract_extension";
    fee: string | null;
    status: "confirmed" | "rumor";
    probabilityScore: number | null;
    daysAgo: number;
    summary: string;
  }[] = [
    { player: "Chris Richards", fromClub: "Crystal Palace", toClub: "Crystal Palace", transferType: "contract_extension", fee: null, status: "confirmed", probabilityScore: null, daysAgo: 1, summary: "Richards signed a new three-year deal keeping him at Selhurst Park through 2028." },
    { player: "Folarin Balogun", fromClub: "AS Monaco", toClub: "Undisclosed Ligue 1 club", transferType: "transfer", fee: "€25M (est.)", status: "rumor", probabilityScore: 42, daysAgo: 2, summary: "Reports suggest Balogun could seek a move away from Monaco in search of regular minutes ahead of the World Cup." },
    { player: "Malik Tillman", fromClub: "PSV Eindhoven", toClub: "PSV Eindhoven", transferType: "contract_extension", fee: null, status: "rumor", probabilityScore: 68, daysAgo: 4, summary: "PSV are reportedly preparing an improved contract to ward off interest from Bundesliga and Premier League suitors." },
    { player: "Ricardo Pepi", fromClub: "PSV Eindhoven", toClub: "Bundesliga club (unnamed)", transferType: "transfer", fee: "€30M (est.)", status: "rumor", probabilityScore: 35, daysAgo: 6, summary: "Scouts from at least two Bundesliga clubs have been tracking Pepi's scoring form this season." },
    { player: "Djordje Mihailovic", fromClub: "AZ Alkmaar", toClub: "Eredivisie rival", transferType: "loan", fee: null, status: "rumor", probabilityScore: 18, daysAgo: 9, summary: "Unconfirmed reports suggest a loan swap is being discussed, though AZ have downplayed the speculation." },
    { player: "Benjamin Cremaschi", fromClub: "Inter Miami CF", toClub: "Inter Miami CF", transferType: "contract_extension", fee: null, status: "confirmed", probabilityScore: null, daysAgo: 12, summary: "Inter Miami confirmed a contract extension for Cremaschi through the 2027 season with a club option for 2028." },
  ];

  for (const t of transferDefs) {
    const player = playerByName.get(t.player)!;
    const announcedAt = new Date("2026-07-13T12:00:00Z");
    announcedAt.setUTCDate(announcedAt.getUTCDate() - t.daysAgo);
    await db.insert(transfersTable).values({
      playerId: player.id,
      fromClub: t.fromClub,
      toClub: t.toClub,
      transferType: t.transferType,
      fee: t.fee,
      status: t.status,
      probabilityScore: t.probabilityScore,
      announcedAt: announcedAt,
      summary: t.summary,
    });
  }

  // ---- National Team Window ----
  await db.insert(nationalTeamWindowsTable).values({
    name: "September World Cup Qualifying Window",
    startDate: isoDateOffset(42),
    endDate: isoDateOffset(50),
    description: "The USMNT gathers for two fixtures — a World Cup Qualifier against Panama in Saint Paul and an international friendly against Colombia in Austin.",
  });

  console.log(`Seeded ${insertedClubs.length} clubs, ${insertedPlayers.length} players, ${statRows.length} stat rows, ${matchLogRows.length} match logs, ${fixtureDefs.length} fixtures, ${newsDefs.length} news articles, ${injuryDefs.length} injuries, ${transferDefs.length} transfers.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
