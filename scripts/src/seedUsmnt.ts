import { db } from "@workspace/db";
import {
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
  newsArticlesTable,
  newsArticlePlayersTable,
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

  // ---- Team/country logo & flag crests (real API-Football media CDN URLs,
  // resolved once via the team-search endpoint; see scripts/src/fetchLogos.ts) ----
  const TEAM_LOGOS: Record<string, string> = {
    "AC Milan": "https://media.api-sports.io/football/teams/489.png",
    Juventus: "https://media.api-sports.io/football/teams/496.png",
    Bournemouth: "https://media.api-sports.io/football/teams/35.png",
    Fulham: "https://media.api-sports.io/football/teams/36.png",
    Atalanta: "https://media.api-sports.io/football/teams/499.png",
    "PSV Eindhoven": "https://media.api-sports.io/football/teams/197.png",
    "AS Monaco": "https://media.api-sports.io/football/teams/91.png",
    "Olympique de Marseille": "https://media.api-sports.io/football/teams/81.png",
    "Crystal Palace": "https://media.api-sports.io/football/teams/52.png",
    "Borussia Dortmund": "https://media.api-sports.io/football/teams/165.png",
    "Norwich City": "https://media.api-sports.io/football/teams/71.png",
    "Union Berlin": "https://media.api-sports.io/football/teams/182.png",
    Middlesbrough: "https://media.api-sports.io/football/teams/70.png",
    "AZ Alkmaar": "https://media.api-sports.io/football/teams/201.png",
    "Como 1907": "https://media.api-sports.io/football/teams/895.png",
    "Philadelphia Union": "https://media.api-sports.io/football/teams/1599.png",
    "FC Barcelona": "https://media.api-sports.io/football/teams/529.png",
    "Inter Miami CF": "https://media.api-sports.io/football/teams/9568.png",
    "Werder Bremen": "https://media.api-sports.io/football/teams/162.png",
    "Seattle Sounders FC": "https://media.api-sports.io/football/teams/1595.png",
    "New England Revolution": "https://media.api-sports.io/football/teams/1609.png",
    Inter: "https://media.api-sports.io/football/teams/505.png",
    Bologna: "https://media.api-sports.io/football/teams/500.png",
    Lille: "https://media.api-sports.io/football/teams/79.png",
    Mainz: "https://media.api-sports.io/football/teams/164.png",
    "Leeds United": "https://media.api-sports.io/football/teams/63.png",
    "Columbus Crew": "https://media.api-sports.io/football/teams/1613.png",
    "Atlanta United": "https://media.api-sports.io/football/teams/1608.png",
    Everton: "https://media.api-sports.io/football/teams/45.png",
    USA: "https://media.api-sports.io/football/teams/2384.png",
    Belgium: "https://media.api-sports.io/football/teams/1.png",
    Panama: "https://media.api-sports.io/football/teams/11.png",
    Colombia: "https://media.api-sports.io/football/teams/8.png",
    Jamaica: "https://media.api-sports.io/football/teams/2385.png",
    "Trinidad and Tobago": "https://media.api-sports.io/football/teams/5168.png",
    "FC Augsburg": "https://media.api-sports.io/football/teams/170.png",
    "Bayern Munich": "https://media.api-sports.io/football/teams/157.png",
    "Real Salt Lake": "https://media.api-sports.io/football/teams/1606.png",
    "San Jose Earthquakes": "https://media.api-sports.io/football/teams/1596.png",
    "Chicago Fire": "https://media.api-sports.io/football/teams/1607.png",
    "New York City FC": "https://media.api-sports.io/football/teams/1604.png",
    Villarreal: "https://media.api-sports.io/football/teams/533.png",
    Toulouse: "https://media.api-sports.io/football/teams/96.png",
    "Charlotte FC": "https://media.api-sports.io/football/teams/18310.png",
    "FC Cincinnati": "https://media.api-sports.io/football/teams/2242.png",
    "Borussia Monchengladbach": "https://media.api-sports.io/football/teams/163.png",
    Celtic: "https://media.api-sports.io/football/teams/247.png",
    "Vancouver Whitecaps": "https://media.api-sports.io/football/teams/1603.png",
    "Club America": "https://media.api-sports.io/football/teams/2287.png",
    "Coventry City": "https://media.api-sports.io/football/teams/1346.png",
    Chelsea: "https://media.api-sports.io/football/teams/49.png",
    "Hamburger SV": "https://media.api-sports.io/football/teams/175.png",
    "Hajduk Split": "https://media.api-sports.io/football/teams/608.png",
    Benfica: "https://media.api-sports.io/football/teams/211.png",
    "Bayer Leverkusen": "https://media.api-sports.io/football/teams/168.png",
    // Added 2026-07-14 after auditing syncPlayerClubs "not tracked" warnings —
    // real transfer destinations the live sync kept skipping because the
    // club wasn't seeded yet (see playerClubSync.ts comment above this list).
    Lyon: "https://media.api-sports.io/football/teams/80.png",
    "Lyngby Boldklub": "https://media.api-sports.io/football/teams/625.png",
    "Real Monarchs": "https://media.api-sports.io/football/teams/4012.png",
    "Benfica B": "https://media.api-sports.io/football/teams/229.png",
    "Orlando City SC": "https://media.api-sports.io/football/teams/1610.png",
    "Orlando City II": "https://media.api-sports.io/football/teams/4026.png",
    // Not found in API-Football's DB (too new / too small a league) — logoUrl
    // will fall back to null for clubs whose name isn't a key here. This
    // includes "Bayern Munich II" (Regionalliga Bayern reserve side) — API-
    // Football's team search has no entry for it.
  };

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
    { name: "FC Augsburg", league: "Bundesliga", country: "Germany" },
    { name: "Bayern Munich", league: "Bundesliga", country: "Germany" },
    { name: "Real Salt Lake", league: "MLS", country: "USA" },
    { name: "San Jose Earthquakes", league: "MLS", country: "USA" },
    { name: "Chicago Fire", league: "MLS", country: "USA" },
    { name: "New York City FC", league: "MLS", country: "USA" },
    { name: "Columbus Crew", league: "MLS", country: "USA" },
    { name: "Villarreal", league: "La Liga", country: "Spain" },
    { name: "Toulouse", league: "Ligue 1", country: "France" },
    { name: "Charlotte FC", league: "MLS", country: "USA" },
    { name: "FC Cincinnati", league: "MLS", country: "USA" },
    { name: "Borussia Monchengladbach", league: "Bundesliga", country: "Germany" },
    { name: "Celtic", league: "Scottish Premiership", country: "Scotland" },
    { name: "Vancouver Whitecaps", league: "MLS", country: "USA" },
    { name: "Leeds United", league: "Premier League", country: "England" },
    { name: "Club America", league: "Liga MX", country: "Mexico" },
    { name: "Coventry City", league: "Championship", country: "England" },
    { name: "Chelsea", league: "Premier League", country: "England" },
    { name: "Hamburger SV", league: "Bundesliga", country: "Germany" },
    { name: "SV Elversberg", league: "Bundesliga", country: "Germany" },
    { name: "Hajduk Split", league: "HNL", country: "Croatia" },
    { name: "San Diego FC", league: "MLS", country: "USA" },
    { name: "Benfica", league: "Primeira Liga", country: "Portugal" },
    { name: "Bayer Leverkusen", league: "Bundesliga", country: "Germany" },
    { name: "Bayern Munich II", league: "Regionalliga Bayern", country: "Germany" },
    // Added 2026-07-14: real transfer destinations the live sync flagged as
    // untracked (see TEAM_LOGOS comment above for the audit context).
    { name: "Lyon", league: "Ligue 1", country: "France" },
    { name: "Lyngby Boldklub", league: "Danish Superliga", country: "Denmark" },
    { name: "Real Monarchs", league: "MLS Next Pro", country: "USA" },
    { name: "Benfica B", league: "Liga Portugal 2", country: "Portugal" },
    // Added 2026-07-28: Justin Ellis's club.
    { name: "Orlando City SC", league: "MLS", country: "USA" },
    { name: "Orlando City II", league: "MLS Next Pro", country: "USA" },
  ].map((c) => ({ ...c, logoUrl: TEAM_LOGOS[c.name] ?? null }));

  // Guard against accidentally seeding the same real-world club twice under
  // two different name strings (the root cause of the "Lyngby Boldklub" /
  // "Lyngby" duplicate) — this can't be checked by name/id alone since the
  // whole failure mode is two *different* names for the same club, so the
  // authoritative source of truth is API-Football's team id. That id isn't
  // known until the live sync resolves it after this insert (see
  // `resolveTeamId` in apiFootballSync.ts, which now checks-before-write and
  // is backed by a partial unique index on clubs.api_football_team_id).
  // What we *can* catch here is a literal copy-paste duplicate name, which
  // this cheap check guards against before it ever reaches the DB.
  const duplicateNames = clubDefs.map((c) => c.name).filter((name, i, arr) => arr.indexOf(name) !== i);
  if (duplicateNames.length > 0) {
    throw new Error(`Duplicate club name(s) in clubDefs — remove the repeat before seeding: ${[...new Set(duplicateNames)].join(", ")}`);
  }

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
    youthNationalTeam: string | null;
    debutDate: string | null;
    callUpScore: number | null;
    trend: "rising" | "steady" | "falling";
    trending: boolean;
    bio: string;
  };

  // Photos are no longer seeded here — they're synced live from
  // API-Football's per-player headshot URL (`ensurePlayerApiFootballIds` in
  // playerClubSync.ts, called from the club/stats syncs) once each player's
  // apiFootballPlayerId is resolved. That replaced this file's old hand-
  // picked PLAYER_PHOTOS map (static ussoccerplayers.com/news-wire URLs),
  // which had grown stale and inconsistent (outdated photos, text/graphics
  // baked into some images) since it was never revisited after being added.
  // New rows seed with `photoUrl: null` and pick up a real photo on the next
  // sync run for any player with a resolvable API-Football id.

  const playerDefs: PlayerDef[] = [
    { name: "Christian Pulisic", slug: "christian-pulisic", position: "FW", category: "current", club: "AC Milan", age: 27, contractUntil: "2028-06-30", marketValueUsd: 42000000, youthNationalTeam: null, debutDate: "2016-01-29", callUpScore: null, trend: "rising", trending: true, bio: "The captain and the face of American soccer's rise in Europe. Since moving to Milan, Pulisic has rediscovered the explosive form that once made him the USMNT's most feared attacker, combining pace, close control, and a nose for the big moment." },
    { name: "Weston McKennie", slug: "weston-mckennie", position: "MF", category: "current", club: "Juventus", age: 27, contractUntil: "2027-06-30", marketValueUsd: 28000000, youthNationalTeam: null, debutDate: "2018-05-28", callUpScore: null, trend: "steady", trending: false, bio: "A box-to-box engine whose late runs and set-piece heading ability have made him a consistent source of goals from midfield for both club and country." },
    { name: "Tyler Adams", slug: "tyler-adams", position: "MF", category: "current", club: "Bournemouth", age: 26, contractUntil: "2027-06-30", marketValueUsd: 22000000, youthNationalTeam: null, debutDate: "2019-01-27", callUpScore: null, trend: "rising", trending: true, bio: "The heartbeat of the USMNT midfield — a relentless ball-winner whose return from a long hamstring layoff has coincided with a run of commanding performances." },
    { name: "Antonee Robinson", slug: "antonee-robinson", position: "DF", category: "current", club: "Fulham", age: 27, contractUntil: "2029-06-30", marketValueUsd: 24000000, youthNationalTeam: null, debutDate: "2018-01-27", callUpScore: null, trend: "steady", trending: false, bio: "Arguably the best left-back the US has produced, prized for his overlapping runs, recovery speed, and end product from wide areas." },
    { name: "Yunus Musah", slug: "yunus-musah", position: "MF", category: "current", club: "Atalanta", age: 22, contractUntil: "2028-06-30", marketValueUsd: 26000000, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "rising", trending: true, bio: "A press-resistant carrier who glides past pressure in tight spaces, Musah has grown into one of Serie A's most reliable young midfielders." },
    { name: "Ricardo Pepi", slug: "ricardo-pepi", position: "FW", category: "current", club: "PSV Eindhoven", age: 22, contractUntil: "2027-06-30", marketValueUsd: 20000000, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "rising", trending: true, bio: "A ruthless penalty-box finisher who has rebuilt his career in the Netherlands into one of the most productive striker spells by an American abroad." },
    { name: "Folarin Balogun", slug: "folarin-balogun", position: "FW", category: "current", club: "AS Monaco", age: 23, contractUntil: "2028-06-30", marketValueUsd: 30000000, youthNationalTeam: null, debutDate: "2023-09-09", callUpScore: null, trend: "steady", trending: false, bio: "A sharp, mobile striker whose move to Ligue 1 was meant to be a proving ground — the goals have arrived in flashes, with more expected." },
    { name: "Timothy Weah", slug: "timothy-weah", position: "FW", category: "current", club: "Olympique de Marseille", age: 25, contractUntil: "2027-06-30", marketValueUsd: 18000000, youthNationalTeam: null, debutDate: "2018-01-28", callUpScore: null, trend: "steady", trending: false, bio: "Versatile enough to play across the front line or at right-back, Weah's directness and work rate make him a coach's favorite utility weapon." },
    { name: "Malik Tillman", slug: "malik-tillman", position: "MF", category: "current", club: "PSV Eindhoven", age: 23, contractUntil: "2027-06-30", marketValueUsd: 27000000, youthNationalTeam: null, debutDate: "2023-06-17", callUpScore: null, trend: "rising", trending: true, bio: "Since switching allegiance to the US, Tillman has been PSV's chief creative outlet — a shifty attacking midfielder who scores as often as he assists." },
    { name: "Sergiño Dest", slug: "sergino-dest", position: "DF", category: "current", club: "PSV Eindhoven", age: 24, contractUntil: "2026-06-30", marketValueUsd: 16000000, youthNationalTeam: null, debutDate: "2019-11-15", callUpScore: null, trend: "steady", trending: false, bio: "An attack-minded full-back whose overlapping runs and dribbling out of the back have made him a fan favorite whenever he's fit." },
    { name: "Chris Richards", slug: "chris-richards", position: "DF", category: "current", club: "Crystal Palace", age: 25, contractUntil: "2028-06-30", marketValueUsd: 15000000, youthNationalTeam: null, debutDate: "2020-11-11", callUpScore: null, trend: "steady", trending: false, bio: "A composed, ball-playing center-back who has finally found an extended run of fitness and form on Palace's Premier League backline." },
    { name: "Matt Turner", slug: "matt-turner", position: "GK", category: "current", club: "Crystal Palace", age: 31, contractUntil: "2026-06-30", marketValueUsd: 6000000, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "steady", trending: false, bio: "The long-time USMNT number one, valued for his shot-stopping reflexes and calm distribution under pressure." },
    { name: "Giovanni Reyna", slug: "giovanni-reyna", position: "MF", category: "current", club: "Borussia Dortmund", age: 23, contractUntil: "2026-06-30", marketValueUsd: 14000000, youthNationalTeam: null, debutDate: "2020-09-03", callUpScore: null, trend: "falling", trending: false, bio: "Once the USMNT's most hyped young creator, Reyna's injury-hit few years have quieted the noise around him, though the underlying quality remains obvious in flashes." },
    { name: "Josh Sargent", slug: "josh-sargent", position: "FW", category: "current", club: "Norwich City", age: 25, contractUntil: "2027-06-30", marketValueUsd: 11000000, youthNationalTeam: null, debutDate: "2018-01-28", callUpScore: null, trend: "steady", trending: false, bio: "A hard-working target man whose hold-up play and aerial threat have made him a reliable Championship goal scorer for Norwich." },
    { name: "Paxten Aaronson", slug: "paxten-aaronson", position: "MF", category: "fringe", club: "Union Berlin", age: 21, contractUntil: "2027-06-30", marketValueUsd: 6000000, youthNationalTeam: null, debutDate: "2023-06-17", callUpScore: 62, trend: "rising", trending: true, bio: "A tidy, tactically intelligent attacking midfielder who has been on the fringes of the senior squad while establishing himself in the Bundesliga." },
    { name: "Aidan Morris", slug: "aidan-morris", position: "MF", category: "fringe", club: "Middlesbrough", age: 24, contractUntil: "2028-06-30", marketValueUsd: 7000000, youthNationalTeam: null, debutDate: "2023-01-25", callUpScore: 58, trend: "steady", trending: false, bio: "A tenacious defensive midfielder whose ball-winning profile mirrors Tyler Adams — a natural depth option in the deepest midfield role." },
    { name: "Djordje Mihailovic", slug: "djordje-mihailovic", position: "MF", category: "fringe", club: "AZ Alkmaar", age: 26, contractUntil: "2026-06-30", marketValueUsd: 9000000, youthNationalTeam: null, debutDate: "2021-06-06", callUpScore: 55, trend: "steady", trending: false, bio: "A left-footed playmaker who has quietly built one of the more productive underlying-numbers seasons of any American in Europe." },
    { name: "Tanner Tessmann", slug: "tanner-tessmann", position: "MF", category: "fringe", club: "Como 1907", age: 23, contractUntil: "2027-06-30", marketValueUsd: 8000000, youthNationalTeam: null, debutDate: "2022-06-05", callUpScore: 51, trend: "rising", trending: true, bio: "A physically imposing midfield anchor who has settled into Serie A quicker than expected after his move from MLS." },
    { name: "Cavan Sullivan", slug: "cavan-sullivan", position: "FW", category: "prospect", club: "Philadelphia Union", age: 15, contractUntil: "2029-12-31", marketValueUsd: 3000000, youthNationalTeam: "U-17", debutDate: "2024-05-18", callUpScore: 34, trend: "rising", trending: true, bio: "The youngest player ever to appear in MLS, Sullivan's blistering acceleration and finishing instincts have scouts across Europe circling." },
    { name: "Diego Kochen", slug: "diego-kochen", position: "GK", category: "prospect", club: "FC Barcelona", age: 18, contractUntil: "2027-06-30", marketValueUsd: 2500000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 22, trend: "rising", trending: false, bio: "A towering, composed shot-stopper progressing through Barcelona's famed academy pipeline, tipped as the long-term successor between the posts." },
    { name: "Benjamin Cremaschi", slug: "benjamin-cremaschi", position: "MF", category: "prospect", club: "Inter Miami CF", age: 20, contractUntil: "2027-12-31", marketValueUsd: 4000000, youthNationalTeam: "U-23", debutDate: "2024-01-18", callUpScore: 41, trend: "rising", trending: true, bio: "A composed deep-lying playmaker who has thrived alongside Messi and Busquets at Inter Miami, dictating tempo well beyond his years." },
    { name: "Noel Buck", slug: "noel-buck", position: "MF", category: "prospect", club: "San Jose Earthquakes", age: 20, contractUntil: "2027-12-31", marketValueUsd: 2000000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 24, trend: "steady", trending: false, bio: "A tall, combative midfielder who has bounced between MLS and a Southampton loan spell, admired for his range of passing and tackling numbers." },

    { name: "Nimfasha Berchimas", slug: "nimfasha-berchimas", position: "DF", category: "prospect", club: "New England Revolution", age: 19, contractUntil: "2026-12-31", marketValueUsd: 1200000, youthNationalTeam: "U-20", debutDate: "2024-08-24", callUpScore: 19, trend: "rising", trending: false, bio: "An athletic, ball-playing center-back prospect who has forced his way into New England's first team ahead of schedule." },
    { name: "Mathis Albert", slug: "mathis-albert", position: "FW", category: "prospect", club: "Borussia Dortmund", age: 17, contractUntil: "2028-06-30", marketValueUsd: 8000000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 44, trend: "rising", trending: true, bio: "A dazzling dribbler who left the LA Galaxy academy for Dortmund and became the youngest American to play in the Bundesliga, already drawing senior-team buzz." },
    { name: "Noahkai Banks", slug: "noahkai-banks", position: "DF", category: "prospect", club: "FC Augsburg", age: 19, contractUntil: "2028-06-30", marketValueUsd: 3000000, youthNationalTeam: null, debutDate: null, callUpScore: 33, trend: "rising", trending: false, bio: "A towering, German-born center-back who served as an alternate at World Cup qualifying — U.S. Soccer is racing to lock him in before other federations come calling." },
    { name: "Leonard Prescott", slug: "leonard-prescott", position: "GK", category: "prospect", club: "Bayern Munich", age: 16, contractUntil: "2027-06-30", marketValueUsd: 2200000, youthNationalTeam: null, debutDate: null, callUpScore: 15, trend: "rising", trending: true, bio: "Born in New York but raised in Germany's academy system, Prescott became one of the youngest goalkeepers to warm up for a Bayern Champions League matchday — a long-shot dual-national target for U.S. Soccer." },
    { name: "Zavier Gozo", slug: "zavier-gozo", position: "FW", category: "prospect", club: "Real Salt Lake", age: 19, contractUntil: "2027-12-31", marketValueUsd: 1500000, youthNationalTeam: "U-20", debutDate: "2026-05-02", callUpScore: 27, trend: "rising", trending: false, bio: "A direct, two-footed winger who forced his way into Real Salt Lake's first team and has scouts talking about a very bright USMNT future." },
    // Added 2026-07-13: player-pool audit against (1) senior caps, (2) youth
    // national team caps (U-15 through U-23), (3) US-eligible U20 club
    // starters. All facts below (caps/goals/clubs/ages) verified via news
    // search around the actual 2026 World Cup roster announcement.
    { name: "Chris Brady", slug: "chris-brady", position: "GK", category: "current", club: "Chicago Fire", age: 24, contractUntil: "2027-12-31", marketValueUsd: 4000000, youthNationalTeam: "U-20", debutDate: "2026-03-22", callUpScore: null, trend: "rising", trending: true, bio: "Chicago Fire's homegrown shot-stopper earned his senior debut in a World Cup warmup win over Senegal, giving Pochettino a genuine long-term option between the posts." },
    { name: "Matt Freese", slug: "matt-freese", position: "GK", category: "current", club: "New York City FC", age: 28, contractUntil: "2027-12-31", marketValueUsd: 5000000, youthNationalTeam: null, debutDate: "2024-06-08", callUpScore: null, trend: "rising", trending: true, bio: "An analytically minded shot-stopper who climbed from third-string to the World Cup roster on the back of standout distribution and shot-stopping numbers at NYCFC." },
    { name: "Max Arfsten", slug: "max-arfsten", position: "DF", category: "current", club: "Columbus Crew", age: 26, contractUntil: "2028-12-31", marketValueUsd: 6000000, youthNationalTeam: null, debutDate: "2024-06-05", callUpScore: null, trend: "steady", trending: false, bio: "A left-back who doubles as an attacking outlet, Arfsten's overlapping runs for the Crew translated quickly into a regular seat in the senior player pool." },
    { name: "Alex Freeman", slug: "alex-freeman", position: "DF", category: "current", club: "Villarreal", age: 21, contractUntil: "2029-06-30", marketValueUsd: 14000000, youthNationalTeam: "U-20", debutDate: "2025-06-01", callUpScore: null, trend: "rising", trending: true, bio: "After arguably the best fullback season MLS has produced in over a decade, Freeman jumped straight to Villarreal and into the World Cup squad within a year of his pro debut." },
    { name: "Mark McKenzie", slug: "mark-mckenzie", position: "DF", category: "current", club: "Toulouse", age: 26, contractUntil: "2027-06-30", marketValueUsd: 9000000, youthNationalTeam: null, debutDate: "2020-09-03", callUpScore: null, trend: "steady", trending: false, bio: "A composed center-back who has bounced between Genk and Ligue 1, valued for his passing range and reliability as senior center-back depth." },
    { name: "Tim Ream", slug: "tim-ream", position: "DF", category: "current", club: "Charlotte FC", age: 38, contractUntil: "2026-12-31", marketValueUsd: 1500000, youthNationalTeam: null, debutDate: "2010-01-24", callUpScore: null, trend: "steady", trending: false, bio: "The elder statesman of the backline, Ream's reading of the game has kept him a starting center-back into his late 30s, with a shot at being the oldest man to play a U.S. World Cup match." },
    { name: "Miles Robinson", slug: "miles-robinson", position: "DF", category: "current", club: "FC Cincinnati", age: 29, contractUntil: "2027-12-31", marketValueUsd: 7000000, youthNationalTeam: null, debutDate: "2018-01-28", callUpScore: null, trend: "rising", trending: true, bio: "An Achilles tear cost him the 2022 World Cup; a return to form with Cincinnati has finally delivered the World Cup appearance that injury once denied him." },
    { name: "Joe Scally", slug: "joe-scally", position: "DF", category: "current", club: "Borussia Monchengladbach", age: 23, contractUntil: "2027-06-30", marketValueUsd: 12000000, youthNationalTeam: "U-20", debutDate: "2021-11-14", callUpScore: null, trend: "steady", trending: false, bio: "A durable, tactically versatile right-back who has quietly logged four full Bundesliga seasons in Germany and edged out the midfield competition for a World Cup roster spot." },
    { name: "Auston Trusty", slug: "auston-trusty", position: "DF", category: "current", club: "Celtic", age: 26, contractUntil: "2028-06-30", marketValueUsd: 8000000, youthNationalTeam: null, debutDate: "2024-09-10", callUpScore: null, trend: "rising", trending: true, bio: "A center-back who scored on his first senior start, Trusty has become a trusted squad piece at Celtic and the biggest riser in the USMNT defensive pool this cycle." },
    { name: "Sebastian Berhalter", slug: "sebastian-berhalter", position: "MF", category: "current", club: "Vancouver Whitecaps", age: 24, contractUntil: "2027-12-31", marketValueUsd: 3500000, youthNationalTeam: "U-20", debutDate: "2024-01-18", callUpScore: null, trend: "steady", trending: false, bio: "The son of former USMNT coach Gregg Berhalter, Sebastian earned his own World Cup spot as a tidy, defensively disciplined depth midfielder for Vancouver." },
    { name: "Cristian Roldan", slug: "cristian-roldan", position: "MF", category: "current", club: "Seattle Sounders FC", age: 31, contractUntil: "2026-12-31", marketValueUsd: 2500000, youthNationalTeam: null, debutDate: "2021-06-06", callUpScore: null, trend: "steady", trending: false, bio: "A long-time MLS mainstay whose two-way work rate and locker-room leadership earned him a surprise return to the senior fold for a home World Cup." },
    { name: "Brenden Aaronson", slug: "brenden-aaronson", position: "MF", category: "current", club: "Leeds United", age: 25, contractUntil: "2028-06-30", marketValueUsd: 16000000, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "rising", trending: true, bio: "Paxten's older brother has rediscovered his best form back in the Premier League with Leeds, pressing relentlessly and chipping in with regular goals." },
    { name: "Alejandro Zendejas", slug: "alejandro-zendejas", position: "FW", category: "current", club: "Club America", age: 28, contractUntil: "2027-12-31", marketValueUsd: 9000000, youthNationalTeam: null, debutDate: "2023-03-27", callUpScore: null, trend: "steady", trending: false, bio: "A dual national who chose the U.S. over Mexico, Zendejas brings Liga MX-honed dribbling and end product off the wing as a genuine World Cup squad player." },
    { name: "Haji Wright", slug: "haji-wright", position: "FW", category: "current", club: "Coventry City", age: 28, contractUntil: "2027-06-30", marketValueUsd: 11000000, youthNationalTeam: null, debutDate: "2022-06-05", callUpScore: null, trend: "rising", trending: true, bio: "The 2022 World Cup breakout striker rebuilt his career in England's Championship, scoring 17 goals to help Coventry reach the Premier League and reclaim his World Cup spot." },
    { name: "Diego Luna", slug: "diego-luna", position: "MF", category: "fringe", club: "Real Salt Lake", age: 22, contractUntil: "2027-12-31", marketValueUsd: 7000000, youthNationalTeam: "U-20", debutDate: "2024-06-05", callUpScore: 68, trend: "rising", trending: true, bio: "A shifty, left-footed creator who broke through at the 2025 Gold Cup, Luna has been a Pochettino favorite for well over a year despite missing out on the final 26." },
    { name: "Gaga Slonina", slug: "gaga-slonina", position: "GK", category: "fringe", club: "Chelsea", age: 22, contractUntil: "2028-06-30", marketValueUsd: 5000000, youthNationalTeam: "U-23", debutDate: "2023-01-25", callUpScore: 44, trend: "steady", trending: false, bio: "A Chicago Fire academy product turned Chelsea goalkeeper, Slonina's loan spells have been about accumulating minutes while he waits behind the senior pecking order." },
    { name: "Caleb Wiley", slug: "caleb-wiley", position: "DF", category: "fringe", club: "Chelsea", age: 21, contractUntil: "2029-06-30", marketValueUsd: 10000000, youthNationalTeam: "U-23", debutDate: "2023-09-09", callUpScore: 47, trend: "steady", trending: false, bio: "An attacking left-back who made the jump from Atlanta United to Chelsea as a teenager, Wiley's development has stalled amid loan spells but he remains firmly in the senior picture." },
    { name: "Damion Downs", slug: "damion-downs", position: "FW", category: "fringe", club: "Hamburger SV", age: 21, contractUntil: "2027-06-30", marketValueUsd: 6000000, youthNationalTeam: "U-23", debutDate: "2024-09-10", callUpScore: 45, trend: "rising", trending: true, bio: "A physical target man who impressed at the 2025 Gold Cup, Downs is rebuilding minutes on loan in the Bundesliga after a quiet spell at Southampton." },
    { name: "Cole Campbell", slug: "cole-campbell", position: "MF", category: "prospect", club: "SV Elversberg", age: 20, contractUntil: "2030-06-30", marketValueUsd: 4000000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 36, trend: "rising", trending: true, bio: "A Texas-born dual national (US/Iceland) who left Borussia Dortmund's academy for a permanent move to Bundesliga newcomer Elversberg, chasing first-team minutes and a senior call-up." },
    // Added 2026-07-13: European-based US-eligible prospects/dual nationals,
    // included on "currently at a European club" grounds alone (per user
    // request) rather than any cap requirement — both are real, verified
    // signings/dual-national storylines, not fabricated.
    { name: "Bajung Darboe", slug: "bajung-darboe", position: "FW", category: "fringe", club: "Bayern Munich II", age: 19, contractUntil: "2029-06-30", marketValueUsd: 1800000, youthNationalTeam: "U-17", debutDate: null, callUpScore: 21, trend: "steady", trending: false, bio: "A Gambian-born winger who came up through the Philadelphia Union and LAFC academy pipeline before Bayern Munich paid a $1.5M fee to bring him to Germany, where he's starting out with the club's second team in the Regionalliga." },
    { name: "Montrell Culbreath", slug: "montrell-culbreath", position: "MF", category: "prospect", club: "Bayer Leverkusen", age: 18, contractUntil: "2028-06-30", marketValueUsd: 3200000, youthNationalTeam: null, debutDate: "2025-12-20", callUpScore: 25, trend: "rising", trending: false, bio: "A German-American right winger who scored on his Bundesliga debut for Leverkusen as a teenager. Still uncapped by either country he's eligible for, but very much on U.S. Soccer's radar." },
    { name: "Rokas Pukstas", slug: "rokas-pukstas", position: "MF", category: "prospect", club: "Hajduk Split", age: 20, contractUntil: "2027-06-30", marketValueUsd: 5000000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 38, trend: "rising", trending: true, bio: "A U.S.-eligible dual national starring for Hajduk Split in Croatia's top flight, Pukstas has drawn interest from German clubs and pundit chatter about a surprise World Cup call." },
    { name: "Quinn Sullivan", slug: "quinn-sullivan", position: "FW", category: "fringe", club: "Philadelphia Union", age: 21, contractUntil: "2027-12-31", marketValueUsd: 4500000, youthNationalTeam: "U-20", debutDate: "2025-09-06", callUpScore: 40, trend: "falling", trending: false, bio: "The most productive goal-and-assist producer in his age group, Sullivan's rise stalled when a torn ACL cost him a chance to push for a World Cup roster spot." },
    { name: "Luca Bombino", slug: "luca-bombino", position: "DF", category: "prospect", club: "San Diego FC", age: 20, contractUntil: "2028-12-31", marketValueUsd: 2000000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 30, trend: "steady", trending: false, bio: "A progressive-passing left-back and member of the U-20 World Cup squad, Bombino ranked in the 93rd percentile among MLS fullbacks for progressive passes last season." },
    { name: "Peyton Miller", slug: "peyton-miller", position: "DF", category: "prospect", club: "New England Revolution", age: 19, contractUntil: "2028-12-31", marketValueUsd: 1800000, youthNationalTeam: "U-21", debutDate: null, callUpScore: 29, trend: "rising", trending: true, bio: "A Revolution homegrown fullback who has moved through the U-20 and U-21 national teams, Miller's athleticism and minutes have him ahead of older peers in the pipeline." },
    { name: "Joshua Wynder", slug: "joshua-wynder", position: "DF", category: "prospect", club: "Benfica", age: 20, contractUntil: "2028-06-30", marketValueUsd: 4500000, youthNationalTeam: "U-20", debutDate: null, callUpScore: 26, trend: "steady", trending: false, bio: "A U-20 World Cup center-back who racked up nearly 3,000 USL minutes before turning 19, Wynder is now waiting for a Champions League breakthrough at Benfica." },
    // Added 2026-07-28: Justin Ellis (Orlando City II MF).
    { name: "Justin Ellis", slug: "justin-ellis", position: "MF", category: "prospect", club: "Orlando City II", age: 21, contractUntil: "2027-12-31", marketValueUsd: 1500000, youthNationalTeam: "U-20", debutDate: null, callUpScore: null, trend: "steady", trending: false, bio: "A combative, box-to-box midfielder who has forced his way into Orlando City's first-team picture, Ellis is firmly on U.S. Soccer's radar for the next youth cycle." },
  ];

  // The 2026 World Cup 26-man roster is a subset of "current" category
  // players. Listed explicitly (inclusion-based) rather than as an
  // exclusion set so it's obvious at a glance who is actually on the squad.
  // Two "current" internationals are deliberately left off:
  //  - Yunus Musah: full senior international who didn't make the final 26
  //    (see the fixture-tagging fix in apiFootballSync.ts for context).
  //  - Josh Sargent: also did not make the final 26-man roster (2026-07-14
  //    correction — he was previously miscategorized as "core" because the
  //    old exclusion-based list only named Musah).
  const WORLD_CUP_ROSTER_26 = new Set([
    "Christian Pulisic",
    "Weston McKennie",
    "Tyler Adams",
    "Antonee Robinson",
    "Ricardo Pepi",
    "Folarin Balogun",
    "Timothy Weah",
    "Malik Tillman",
    "Sergiño Dest",
    "Chris Richards",
    "Matt Turner",
    "Giovanni Reyna",
    "Chris Brady",
    "Matt Freese",
    "Max Arfsten",
    "Alex Freeman",
    "Mark McKenzie",
    "Tim Ream",
    "Miles Robinson",
    "Joe Scally",
    "Auston Trusty",
    "Sebastian Berhalter",
    "Cristian Roldan",
    "Brenden Aaronson",
    "Alejandro Zendejas",
    "Haji Wright",
  ]);

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
        // nationalTeamCaps/nationalTeamGoals are NOT seeded here — they come
        // exclusively from the live Wikidata sync
        // (artifacts/api-server/src/lib/nationalTeamSync.ts), which runs
        // daily and populates real senior-caps/goals totals (default 0 until
        // that sync resolves each player). See replit.md and
        // .agents/memory/usmnt-tracker.md.
        worldCupRoster: p.category === "current" && WORLD_CUP_ROSTER_26.has(p.name),
        youthNationalTeam: p.youthNationalTeam,
        debutDate: p.debutDate,
        potentialCallUpScore: p.callUpScore,
        performanceTrend: p.trend,
        trending: p.trending,
        bio: p.bio,
      })),
    )
    .returning();

  const _playerIdBySlug = new Map(insertedPlayers.map((p) => [p.slug, p.id])); // reserved for future FK wiring
  const playerByName = new Map(playerDefs.map((p, i) => [p.name, insertedPlayers[i]]));

  // ---- Player Stats, match logs, and injuries are NOT seeded here. ----
  // These now come exclusively from the live API-Football sync
  // (artifacts/api-server/src/lib/playerStatsSync.ts), which runs daily and
  // populates player_stats/match_logs/injuries with real data — no
  // hardcoded/fabricated per-player numbers. See replit.md and
  // .agents/memory/usmnt-tracker.md for why this changed.

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
    // Only genuine seed-only fixtures live here: national-team matches, which
    // API-Football's club-fixtures sync does not cover. Do NOT add club
    // fixtures (AC Milan, Bournemouth, PSV, etc.) here — those are fabricated
    // placeholders that duplicate/conflict with the real fixtures the
    // apiFootballSync job pulls in for every club in clubDefs. Club schedules
    // should come exclusively from the live sync.
    // Note: Yunus Musah did not make the final 26-man World Cup roster, so he
    // is deliberately left off this fixture's featured tags (2026-07-13 audit).
    { isNationalTeam: true, competition: "FIFA World Cup", daysFromNow: -4, hour: 15, venue: "AT&T Stadium, Arlington", homeTeam: "USA", awayTeam: "Belgium", homeScore: 1, awayScore: 4, status: "finished", tvNetwork: "Fox", streamingService: "Fubo", broadcastLink: null, featured: ["Christian Pulisic", "Weston McKennie", "Tyler Adams", "Antonee Robinson", "Matt Turner"] },
    // Future USMNT fixtures are intentionally NOT seeded here. Speculative
    // entries with daysFromNow offsets caused phantom fixtures (e.g. Jamaica /
    // Trinidad and Tobago) that couldn't be deleted because re-seeding
    // recreated them. Real upcoming fixtures are sourced exclusively via
    // syncNationalTeamFixtures() matching against API-Football's USMNT schedule.
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
        homeLogoUrl: TEAM_LOGOS[f.homeTeam] ?? null,
        awayLogoUrl: TEAM_LOGOS[f.awayTeam] ?? null,
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
    { headline: "Christian Pulisic ruled out several weeks with tibia/fibula injury from Belgium clash", source: "ESPN Soccer", hoursAgo: 5, category: "Injuries", url: "https://espn.com/soccer", summary: "Pulisic was withdrawn late in the USMNT's World Cup match against Belgium after a heavy challenge left him with a micro-fracture in his tibia/fibula. Scans have confirmed a moderate injury expected to keep him out for several weeks.", whyItMatters: "Losing the captain and top attacking threat for an extended stretch is a major blow for both AC Milan and the USMNT's momentum.", impactScore: 9, sentiment: "negative", players: ["Christian Pulisic"] },
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


  // ---- National Team Windows ----
  // Post-World Cup, the next two official FIFA windows are a CONCACAF
  // Nations League group-stage window (first up) and a friendly window
  // after it — not a lone "September friendlies" window (fixed 2026-07-13).
  await db.insert(nationalTeamWindowsTable).values([
    {
      name: "CONCACAF Nations League - Group Stage",
      startDate: isoDateOffset(42),
      endDate: isoDateOffset(50),
      description: "The USMNT opens Nations League group play on home soil, with the new-cycle player pool getting its first competitive minutes since the World Cup.",
    },
    {
      name: "November International Friendlies",
      startDate: isoDateOffset(119),
      endDate: isoDateOffset(127),
      description: "A pair of send-off-style friendlies against European opposition rounds out the fall calendar as Pochettino continues auditioning depth ahead of the next Nations League window.",
    },
  ]);

  console.log(`Seeded ${insertedClubs.length} clubs, ${insertedPlayers.length} players, ${fixtureDefs.length} fixtures, ${newsDefs.length} news articles. Transfers are populated by the live API-Football sync, not seeded.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
