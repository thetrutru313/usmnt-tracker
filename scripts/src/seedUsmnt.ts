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
  ].map((c) => ({ ...c, logoUrl: TEAM_LOGOS[c.name] ?? null }));

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

  // Real public headshots (US Soccer / news wire bio photos), keyed by player name.
  const PLAYER_PHOTOS: Record<string, string> = {
    "Christian Pulisic": "https://cdn.ussoccerplayers.com/images/2016/05/usmnt-player-christian-pulisic-credit-greg-bartram-isiphotos-400x400.jpg",
    "Weston McKennie": "https://cdn.ussoccerplayers.com/images/2019/06/usmnt-player-weston-mckennie-vs-trinidad-and-tobabo-november-16-2023-credit-robin-alam-isiphotos.jpg",
    "Tyler Adams": "https://cdn.ussoccerplayers.com/images/2018/12/tyler-adams-bio-main-banner-400x400.jpg",
    "Antonee Robinson": "https://cdn.ussoccerplayers.com/images/2021/09/antonee-robinson-bio-main-banner-400x400.jpg",
    "Yunus Musah": "https://cdn.ussoccerplayers.com/images/2021/10/yunus-musah-usmnt-vs-trinidad-and-tobago-november-15-2023-credit-robin-alam-isiphotos.jpg",
    "Ricardo Pepi": "https://cdn.ussoccerplayers.com/images/2022/10/ricardo-pepi-usmnt-vs-trinidad-and-tobago-november-16-2023-credit-robin-alam-isiphotos.jpg",
    "Folarin Balogun": "https://static01.nyt.com/athletic/uploads/wp/2026/06/22172514/GettyImages-2282406782-1024x683.jpg?width=400&quality=70",
    "Timothy Weah": "https://cdn.ussoccerplayers.com/images/2021/04/tim-weah-bio-main-banner-400x400.jpg",
    "Malik Tillman": "https://cdn.ussoccerplayers.com/images/2023/10/malik-tillman-usmnt-player-bio-main-400x400.jpg",
    "Sergiño Dest": "https://content.ussoccer.com/media/images/oyf3dba6/production/6e89d7320f73d55cb2023e6975101e3d43f2cc65-1080x1638.png",
    "Chris Richards": "https://cdn.ussoccerplayers.com/images/2023/06/chris-richards-bio-main-banner-400x400.jpg",
    "Matt Turner": "https://library.sportingnews.com/styles/crop_style_16_9_desktop_webp/s3/2022-02/Matt%20Turner%20USMNT%20021122.jpg.webp?itok=dywwnpUG",
    "Giovanni Reyna": "https://cdn.ussoccerplayers.com/images/2021/04/gio-reyna-bio-main-banner-400x400.jpg",
    "Josh Sargent": "https://statico.profootballnetwork.com/wp-content/uploads/2026/02/27112130/usmnt-star-josh-sargent-opens-02-27-26-1920x1280.jpg",
    "Paxten Aaronson": "https://cdn.ussoccerplayers.com/images/2025/06/paxten-aaronson-usmnt-vs-switzerland-june-10-2025-credit-robin-alam-isiphotos-400x400.jpg",
    "Aidan Morris": "https://cdn.ussoccerplayers.com/images/2025/10/usmnt-player-aidan-morris-september-10-2024-credit-joe-robbins-isiphotos-400x400.jpg",
    "Djordje Mihailovic": "https://cdn.ussoccerplayers.com/images/2023/12/djordje-mihailovic-usmnt-player-bio-banner-400x400.jpg",
    "Tanner Tessmann": "https://www.cbssports.com/_next/image?url=https://sportshub.cbsistatic.com/i/2026/03/17/ca45d1fd-b1a4-4928-8ad3-f588910fc7ab/tessmann-0317.jpg?width=400&crop=16:9,smart&w=3840&q=70",
    "Diego Kochen": "https://a57.foxsports.com/statics.foxsports.com/www.foxsports.com/content/uploads/2026/06/548/308/diego-kochen-1.jpg?ve=1&tl=1",
    "Benjamin Cremaschi": "https://www.cbssports.com/_next/image?url=https://sportshub.cbsistatic.com/i/2025/10/06/f437cf0b-c353-4bca-b237-0ae0af86cd94/cremaschi-v2.jpg?width=400&crop=16:9,smart&w=3840&q=70",
    "Noel Buck": "https://images.mlssoccer.com/image/private/t_thumb_squared/f_png/mls/uszfeypgkitxztkitbob.png",
    "Obed Vargas": "https://external-preview.redd.it/dazn-seattle-sounders-midfielder-obed-vargas-a-childhood-v0-OWpzbmoxa3p0NDhmMVSmKWAHyN7qFix2ArOkC4hhNTu5pJsM6g97VFOvAltl.png?width=640&crop=smart&format=pjpg&auto=webp&s=22c49750cacb16cf30a663422710bf8ce0a8b1d1",
    "Nimfasha Berchimas": "https://content.ussoccer.com/media/images/oyf3dba6/production/8dfee51234cfb163c45d7d4643a2ff433186a7ce-1080x1080.jpg?w=1080&h=1080&fit=max&auto=format",
    // Verified against fresh photos before adding — see conversation notes on
    // 2026-07-13 photo audit (Cavan Sullivan was previously showing Balogun's photo).
    "Cavan Sullivan": "https://cdn.abcotvs.com/dip/images/18658561_cavan-sullivan-ap-img-022726.jpeg",
    "Mathis Albert": "https://assets.goal.com/images/v3/bltfd885e9b81513290/albert.jpg?auto=webp&format=pjpg&width=3840&quality=60",
    "Noahkai Banks": "https://i.guim.co.uk/img/media/094cf9ce3140ba4a5a7ee9202d0366bf912f7ca8/816_0_4502_3602/master/4502.jpg?width=465&dpr=1&s=none&crop=none",
    "Leonard Prescott": "https://static01.nyt.com/athletic/uploads/wp/2026/03/16135902/GettyImages-2254908556-1024x683.jpg?width=1920&quality=70&auto=webp",
    "Zavier Gozo": "https://cdn.sanity.io/images/oyf3dba6/production/7c5aabde2d031eddf43d49d0a9e7aa7fc5251e49-1440x1680.png",
    // Added 2026-07-13 during a player-pool audit against: (1) senior caps,
    // (2) youth national team history, (3) US-eligible U20 club starters.
    "Chris Brady": "https://cdn.ussoccerplayers.com/images/2026/05/usmnt-player-chris-brady-bio-may-26-2026-credit-thiago-szwarc-isiphotos-400x400.jpg",
    "Matt Freese": "https://content.ussoccer.com/media/images/oyf3dba6/production/375eaf55741794346dfa8e5ea6c794397bfca948-3024x3024.jpg",
    "Max Arfsten": "https://cdn.sanity.io/images/oyf3dba6/production/4beef4d0aa3c2001f16e31106af821f5bc91cc01-2400x2400.png?w=960&fit=max&auto=format",
    "Alex Freeman": "https://cdn.ussoccerplayers.com/images/2025/06/alex-freeman-usmnt-vs-trinidad-and-tobago-june-29-2025-credit-doug-zimmerman-isiphotos-400x400.jpg",
    "Mark McKenzie": "https://cdn.ussoccerplayers.com/images/2021/09/mark-mckenzie-bio-main-banner-400x400.jpg",
    "Tim Ream": "https://cdn.ussoccerplayers.com/images/2011/11/tim-ream-usmnt-player-bio-credit-brad-smith-isiphotos-400x400.jpg",
    "Miles Robinson": "https://cdn.ussoccerplayers.com/images/2023/10/miles-robinson-usmnt-player-bio-400x400.jpg",
    "Joe Scally": "https://cdn.ussoccerplayers.com/images/2023/09/joe-scally-usmnt-player-bio-banner-9-2023-400x400.jpg",
    "Auston Trusty": "https://cdn.ussoccerplayers.com/images/2026/05/usmnt-player-auston-trusty-bio-credit-eston-parker-isiphotos-400x400.jpg",
    "Sebastian Berhalter": "https://hips.hearstapps.com/hmg-prod/images/f81aaacd-b6ac-4ceb-b82a-d6fcb01fc43e.jpg?crop=1xw:1xh;center,top&resize=980:*",
    "Cristian Roldan": "https://images.mlssoccer.com/image/private/t_editorial_landscape_8_desktop_mobile/f_auto/mls/x0aftrvdqgfvdmcgyugg",
    "Brenden Aaronson": "https://cdn.ussoccerplayers.com/images/2023/10/brenden-aaronson-bio-main-banner-400x400.jpg",
    "Alejandro Zendejas": "https://cdn.ussoccerplayers.com/images/2023/12/alex-zendejas-usmnt-player-bio-banner-400x400.jpg",
    "Haji Wright": "https://assets.goal.com/images/v3/blt1abedd603928843b/haji.jpg?auto=webp&format=pjpg&width=3840&quality=60",
    "Diego Luna": "https://static01.nyt.com/athletic/uploads/wp/2025/07/27205525/USATSI_25856416-scaled.jpg?width=1920&quality=70&auto=webp",
    "Gaga Slonina": "https://media.gettyimages.com/id/2224962270/photo/metlife-stadium-east-rutherford-new-jersey-united-states-gaga-slonina-of-chelsea-fc-poses.jpg?s=612x612&w=0&k=20&c=ugMJkpZL96Botwy0oeyiZULWN-g-qbKDYh1nEeb7f7I=",
    "Caleb Wiley": "https://a57.foxsports.com/statics.foxsports.com/www.foxsports.com/content/uploads/2024/07/548/308/wiley1_720.jpg?ve=1&tl=1",
    "Damion Downs": "https://assets.bundesliga.com/contender/2026/0/imago1068588731.jpg?crop=333px,0px,3332px,2666px&fit=540,540",
    "Cole Campbell": "https://assets.bundesliga.com/contender/2026/6/imago1070627692.jpg?crop=403px,0px,4032px,3226px&fit=540,540",
    "Rokas Pukstas": "https://static01.nyt.com/athletic/uploads/wp/2026/03/02122430/IMG_5988.JPG-1024x683.jpeg?width=1920&quality=70&auto=webp",
    "Quinn Sullivan": "https://images.mlssoccer.com/image/private/t_editorial_landscape_8_desktop_mobile/f_auto/mls-phi/bnrsmjou2bnenqdpqwl1",
    "Luca Bombino": "https://tmssl.akamaized.net//images/foto/galerie/luca-bombino-to-san-diego-1763488417-183117.jpg",
    "Peyton Miller": "https://images.mlssoccer.com/image/private/t_editorial_landscape_8_desktop_mobile/f_auto/mls-ner/qmg2vcsoll1tozwsqqpc",
    "Joshua Wynder": "https://external-preview.redd.it/joshua-wynder-to-be-promoted-to-benficas-first-team-next-v0-Sk7QGule3yyz8SRIGVgcS_L-KJ4nanRUTR4HvscRqek.jpg?width=640&crop=smart&auto=webp&s=9fa35b7152ba03f95cd0854c709c8f5f4c9ca825",
    // Added 2026-07-13: European-based US-eligible prospects/dual nationals
    // per user request, included purely on "at a European club" grounds
    // rather than caps.
    "Bajung Darboe": "https://b.thumbs.redditmedia.com/QCPzNwwK6fvbU5R7Yl4z4CKli1jiGCi23MuN-h7wO2E.jpg",
    "Montrell Culbreath": "https://assets.bundesliga.com/contender/2025/11/2526_MD15_RBLB04_BS_051.jpg?crop=239px,0px,4187px,3350px&fit=540,540",
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
    { name: "Noel Buck", slug: "noel-buck", position: "MF", category: "prospect", club: "San Jose Earthquakes", age: 20, contractUntil: "2027-12-31", marketValueUsd: 2000000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 24, trend: "steady", trending: false, bio: "A tall, combative midfielder who has bounced between MLS and a Southampton loan spell, admired for his range of passing and tackling numbers." },
    { name: "Obed Vargas", slug: "obed-vargas", position: "MF", category: "prospect", club: "Seattle Sounders FC", age: 20, contractUntil: "2027-12-31", marketValueUsd: 3500000, caps: 3, goals: 0, youthNationalTeam: "U-23", debutDate: "2023-10-14", callUpScore: 39, trend: "steady", trending: false, bio: "A physically mature two-way midfielder who broke through as a teenager in Seattle and has continued to add polish to his game each season." },
    { name: "Nimfasha Berchimas", slug: "nimfasha-berchimas", position: "DF", category: "prospect", club: "New England Revolution", age: 19, contractUntil: "2026-12-31", marketValueUsd: 1200000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: "2024-08-24", callUpScore: 19, trend: "rising", trending: false, bio: "An athletic, ball-playing center-back prospect who has forced his way into New England's first team ahead of schedule." },
    { name: "Mathis Albert", slug: "mathis-albert", position: "FW", category: "prospect", club: "Borussia Dortmund", age: 17, contractUntil: "2028-06-30", marketValueUsd: 8000000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 44, trend: "rising", trending: true, bio: "A dazzling dribbler who left the LA Galaxy academy for Dortmund and became the youngest American to play in the Bundesliga, already drawing senior-team buzz." },
    { name: "Noahkai Banks", slug: "noahkai-banks", position: "DF", category: "prospect", club: "FC Augsburg", age: 19, contractUntil: "2028-06-30", marketValueUsd: 3000000, caps: 0, goals: 0, youthNationalTeam: null, debutDate: null, callUpScore: 33, trend: "rising", trending: false, bio: "A towering, German-born center-back who served as an alternate at World Cup qualifying — U.S. Soccer is racing to lock him in before other federations come calling." },
    { name: "Leonard Prescott", slug: "leonard-prescott", position: "GK", category: "prospect", club: "Bayern Munich", age: 16, contractUntil: "2027-06-30", marketValueUsd: 2200000, caps: 0, goals: 0, youthNationalTeam: null, debutDate: null, callUpScore: 15, trend: "rising", trending: true, bio: "Born in New York but raised in Germany's academy system, Prescott became one of the youngest goalkeepers to warm up for a Bayern Champions League matchday — a long-shot dual-national target for U.S. Soccer." },
    { name: "Zavier Gozo", slug: "zavier-gozo", position: "FW", category: "prospect", club: "Real Salt Lake", age: 19, contractUntil: "2027-12-31", marketValueUsd: 1500000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: "2026-05-02", callUpScore: 27, trend: "rising", trending: false, bio: "A direct, two-footed winger who forced his way into Real Salt Lake's first team and has scouts talking about a very bright USMNT future." },
    // Added 2026-07-13: player-pool audit against (1) senior caps, (2) youth
    // national team caps (U-15 through U-23), (3) US-eligible U20 club
    // starters. All facts below (caps/goals/clubs/ages) verified via news
    // search around the actual 2026 World Cup roster announcement.
    { name: "Chris Brady", slug: "chris-brady", position: "GK", category: "current", club: "Chicago Fire", age: 24, contractUntil: "2027-12-31", marketValueUsd: 4000000, caps: 1, goals: 0, youthNationalTeam: "U-20", debutDate: "2026-03-22", callUpScore: null, trend: "rising", trending: true, bio: "Chicago Fire's homegrown shot-stopper earned his senior debut in a World Cup warmup win over Senegal, giving Pochettino a genuine long-term option between the posts." },
    { name: "Matt Freese", slug: "matt-freese", position: "GK", category: "current", club: "New York City FC", age: 28, contractUntil: "2027-12-31", marketValueUsd: 5000000, caps: 14, goals: 0, youthNationalTeam: null, debutDate: "2024-06-08", callUpScore: null, trend: "rising", trending: true, bio: "An analytically minded shot-stopper who climbed from third-string to the World Cup roster on the back of standout distribution and shot-stopping numbers at NYCFC." },
    { name: "Max Arfsten", slug: "max-arfsten", position: "DF", category: "current", club: "Columbus Crew", age: 26, contractUntil: "2028-12-31", marketValueUsd: 6000000, caps: 18, goals: 1, youthNationalTeam: null, debutDate: "2024-06-05", callUpScore: null, trend: "steady", trending: false, bio: "A left-back who doubles as an attacking outlet, Arfsten's overlapping runs for the Crew translated quickly into a regular seat in the senior player pool." },
    { name: "Alex Freeman", slug: "alex-freeman", position: "DF", category: "current", club: "Villarreal", age: 21, contractUntil: "2029-06-30", marketValueUsd: 14000000, caps: 15, goals: 2, youthNationalTeam: "U-20", debutDate: "2025-06-01", callUpScore: null, trend: "rising", trending: true, bio: "After arguably the best fullback season MLS has produced in over a decade, Freeman jumped straight to Villarreal and into the World Cup squad within a year of his pro debut." },
    { name: "Mark McKenzie", slug: "mark-mckenzie", position: "DF", category: "current", club: "Toulouse", age: 26, contractUntil: "2027-06-30", marketValueUsd: 9000000, caps: 27, goals: 0, youthNationalTeam: null, debutDate: "2020-09-03", callUpScore: null, trend: "steady", trending: false, bio: "A composed center-back who has bounced between Genk and Ligue 1, valued for his passing range and reliability as senior center-back depth." },
    { name: "Tim Ream", slug: "tim-ream", position: "DF", category: "current", club: "Charlotte FC", age: 38, contractUntil: "2026-12-31", marketValueUsd: 1500000, caps: 80, goals: 1, youthNationalTeam: null, debutDate: "2010-01-24", callUpScore: null, trend: "steady", trending: false, bio: "The elder statesman of the backline, Ream's reading of the game has kept him a starting center-back into his late 30s, with a shot at being the oldest man to play a U.S. World Cup match." },
    { name: "Miles Robinson", slug: "miles-robinson", position: "DF", category: "current", club: "FC Cincinnati", age: 29, contractUntil: "2027-12-31", marketValueUsd: 7000000, caps: 38, goals: 3, youthNationalTeam: null, debutDate: "2018-01-28", callUpScore: null, trend: "rising", trending: true, bio: "An Achilles tear cost him the 2022 World Cup; a return to form with Cincinnati has finally delivered the World Cup appearance that injury once denied him." },
    { name: "Joe Scally", slug: "joe-scally", position: "DF", category: "current", club: "Borussia Monchengladbach", age: 23, contractUntil: "2027-06-30", marketValueUsd: 12000000, caps: 24, goals: 0, youthNationalTeam: "U-20", debutDate: "2021-11-14", callUpScore: null, trend: "steady", trending: false, bio: "A durable, tactically versatile right-back who has quietly logged four full Bundesliga seasons in Germany and edged out the midfield competition for a World Cup roster spot." },
    { name: "Auston Trusty", slug: "auston-trusty", position: "DF", category: "current", club: "Celtic", age: 26, contractUntil: "2028-06-30", marketValueUsd: 8000000, caps: 6, goals: 1, youthNationalTeam: null, debutDate: "2024-09-10", callUpScore: null, trend: "rising", trending: true, bio: "A center-back who scored on his first senior start, Trusty has become a trusted squad piece at Celtic and the biggest riser in the USMNT defensive pool this cycle." },
    { name: "Sebastian Berhalter", slug: "sebastian-berhalter", position: "MF", category: "current", club: "Vancouver Whitecaps", age: 24, contractUntil: "2027-12-31", marketValueUsd: 3500000, caps: 11, goals: 1, youthNationalTeam: "U-20", debutDate: "2024-01-18", callUpScore: null, trend: "steady", trending: false, bio: "The son of former USMNT coach Gregg Berhalter, Sebastian earned his own World Cup spot as a tidy, defensively disciplined depth midfielder for Vancouver." },
    { name: "Cristian Roldan", slug: "cristian-roldan", position: "MF", category: "current", club: "Seattle Sounders FC", age: 31, contractUntil: "2026-12-31", marketValueUsd: 2500000, caps: 45, goals: 0, youthNationalTeam: null, debutDate: "2021-06-06", callUpScore: null, trend: "steady", trending: false, bio: "A long-time MLS mainstay whose two-way work rate and locker-room leadership earned him a surprise return to the senior fold for a home World Cup." },
    { name: "Brenden Aaronson", slug: "brenden-aaronson", position: "MF", category: "current", club: "Leeds United", age: 25, contractUntil: "2028-06-30", marketValueUsd: 16000000, caps: 57, goals: 9, youthNationalTeam: null, debutDate: "2021-01-31", callUpScore: null, trend: "rising", trending: true, bio: "Paxten's older brother has rediscovered his best form back in the Premier League with Leeds, pressing relentlessly and chipping in with regular goals." },
    { name: "Alejandro Zendejas", slug: "alejandro-zendejas", position: "FW", category: "current", club: "Club America", age: 28, contractUntil: "2027-12-31", marketValueUsd: 9000000, caps: 13, goals: 2, youthNationalTeam: null, debutDate: "2023-03-27", callUpScore: null, trend: "steady", trending: false, bio: "A dual national who chose the U.S. over Mexico, Zendejas brings Liga MX-honed dribbling and end product off the wing as a genuine World Cup squad player." },
    { name: "Haji Wright", slug: "haji-wright", position: "FW", category: "current", club: "Coventry City", age: 28, contractUntil: "2027-06-30", marketValueUsd: 11000000, caps: 20, goals: 7, youthNationalTeam: null, debutDate: "2022-06-05", callUpScore: null, trend: "rising", trending: true, bio: "The 2022 World Cup breakout striker rebuilt his career in England's Championship, scoring 17 goals to help Coventry reach the Premier League and reclaim his World Cup spot." },
    { name: "Diego Luna", slug: "diego-luna", position: "MF", category: "fringe", club: "Real Salt Lake", age: 22, contractUntil: "2027-12-31", marketValueUsd: 7000000, caps: 9, goals: 1, youthNationalTeam: "U-20", debutDate: "2024-06-05", callUpScore: 68, trend: "rising", trending: true, bio: "A shifty, left-footed creator who broke through at the 2025 Gold Cup, Luna has been a Pochettino favorite for well over a year despite missing out on the final 26." },
    { name: "Gaga Slonina", slug: "gaga-slonina", position: "GK", category: "fringe", club: "Chelsea", age: 22, contractUntil: "2028-06-30", marketValueUsd: 5000000, caps: 2, goals: 0, youthNationalTeam: "U-23", debutDate: "2023-01-25", callUpScore: 44, trend: "steady", trending: false, bio: "A Chicago Fire academy product turned Chelsea goalkeeper, Slonina's loan spells have been about accumulating minutes while he waits behind the senior pecking order." },
    { name: "Caleb Wiley", slug: "caleb-wiley", position: "DF", category: "fringe", club: "Chelsea", age: 21, contractUntil: "2029-06-30", marketValueUsd: 10000000, caps: 8, goals: 0, youthNationalTeam: "U-23", debutDate: "2023-09-09", callUpScore: 47, trend: "steady", trending: false, bio: "An attacking left-back who made the jump from Atlanta United to Chelsea as a teenager, Wiley's development has stalled amid loan spells but he remains firmly in the senior picture." },
    { name: "Damion Downs", slug: "damion-downs", position: "FW", category: "fringe", club: "Hamburger SV", age: 21, contractUntil: "2027-06-30", marketValueUsd: 6000000, caps: 6, goals: 2, youthNationalTeam: "U-23", debutDate: "2024-09-10", callUpScore: 45, trend: "rising", trending: true, bio: "A physical target man who impressed at the 2025 Gold Cup, Downs is rebuilding minutes on loan in the Bundesliga after a quiet spell at Southampton." },
    { name: "Cole Campbell", slug: "cole-campbell", position: "MF", category: "prospect", club: "SV Elversberg", age: 20, contractUntil: "2030-06-30", marketValueUsd: 4000000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 36, trend: "rising", trending: true, bio: "A Texas-born dual national (US/Iceland) who left Borussia Dortmund's academy for a permanent move to Bundesliga newcomer Elversberg, chasing first-team minutes and a senior call-up." },
    // Added 2026-07-13: European-based US-eligible prospects/dual nationals,
    // included on "currently at a European club" grounds alone (per user
    // request) rather than any cap requirement — both are real, verified
    // signings/dual-national storylines, not fabricated.
    { name: "Bajung Darboe", slug: "bajung-darboe", position: "FW", category: "fringe", club: "Bayern Munich II", age: 19, contractUntil: "2029-06-30", marketValueUsd: 1800000, caps: 0, goals: 0, youthNationalTeam: "U-17", debutDate: null, callUpScore: 21, trend: "steady", trending: false, bio: "A Gambian-born winger who came up through the Philadelphia Union and LAFC academy pipeline before Bayern Munich paid a $1.5M fee to bring him to Germany, where he's starting out with the club's second team in the Regionalliga." },
    { name: "Montrell Culbreath", slug: "montrell-culbreath", position: "MF", category: "prospect", club: "Bayer Leverkusen", age: 18, contractUntil: "2028-06-30", marketValueUsd: 3200000, caps: 0, goals: 0, youthNationalTeam: null, debutDate: "2025-12-20", callUpScore: 25, trend: "rising", trending: false, bio: "A German-American right winger who scored on his Bundesliga debut for Leverkusen as a teenager. Still uncapped by either country he's eligible for, but very much on U.S. Soccer's radar." },
    { name: "Rokas Pukstas", slug: "rokas-pukstas", position: "MF", category: "prospect", club: "Hajduk Split", age: 20, contractUntil: "2027-06-30", marketValueUsd: 5000000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 38, trend: "rising", trending: true, bio: "A U.S.-eligible dual national starring for Hajduk Split in Croatia's top flight, Pukstas has drawn interest from German clubs and pundit chatter about a surprise World Cup call." },
    { name: "Quinn Sullivan", slug: "quinn-sullivan", position: "FW", category: "fringe", club: "Philadelphia Union", age: 21, contractUntil: "2027-12-31", marketValueUsd: 4500000, caps: 1, goals: 0, youthNationalTeam: "U-20", debutDate: "2025-09-06", callUpScore: 40, trend: "falling", trending: false, bio: "The most productive goal-and-assist producer in his age group, Sullivan's rise stalled when a torn ACL cost him a chance to push for a World Cup roster spot." },
    { name: "Luca Bombino", slug: "luca-bombino", position: "DF", category: "prospect", club: "San Diego FC", age: 20, contractUntil: "2028-12-31", marketValueUsd: 2000000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 30, trend: "steady", trending: false, bio: "A progressive-passing left-back and member of the U-20 World Cup squad, Bombino ranked in the 93rd percentile among MLS fullbacks for progressive passes last season." },
    { name: "Peyton Miller", slug: "peyton-miller", position: "DF", category: "prospect", club: "New England Revolution", age: 19, contractUntil: "2028-12-31", marketValueUsd: 1800000, caps: 0, goals: 0, youthNationalTeam: "U-21", debutDate: null, callUpScore: 29, trend: "rising", trending: true, bio: "A Revolution homegrown fullback who has moved through the U-20 and U-21 national teams, Miller's athleticism and minutes have him ahead of older peers in the pipeline." },
    { name: "Joshua Wynder", slug: "joshua-wynder", position: "DF", category: "prospect", club: "Benfica", age: 20, contractUntil: "2028-06-30", marketValueUsd: 4500000, caps: 0, goals: 0, youthNationalTeam: "U-20", debutDate: null, callUpScore: 26, trend: "steady", trending: false, bio: "A U-20 World Cup center-back who racked up nearly 3,000 USL minutes before turning 19, Wynder is now waiting for a Champions League breakthrough at Benfica." },
  ];

  // The 2026 World Cup 26-man roster is a subset of "current" category
  // players. Musah is a full senior international (category "current") but
  // didn't make the final 26 — see the fixture-tagging fix in
  // apiFootballSync.ts for context on why he's tracked separately.
  const NOT_ON_WORLD_CUP_ROSTER = new Set(["Yunus Musah"]);

  const insertedPlayers = await db
    .insert(playersTable)
    .values(
      playerDefs.map((p) => ({
        name: p.name,
        slug: p.slug,
        position: p.position,
        category: p.category,
        clubId: clubIdByName.get(p.club)!,
        photoUrl: PLAYER_PHOTOS[p.name] ?? null,
        age: p.age,
        contractUntil: p.contractUntil,
        marketValueUsd: p.marketValueUsd,
        nationalTeamCaps: p.caps,
        nationalTeamGoals: p.goals,
        worldCupRoster: p.category === "current" && !NOT_ON_WORLD_CUP_ROSTER.has(p.name),
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
    "Mathis Albert": { minutes: 640, starts: 6, goals: 4, assists: 3, xg: 3.4, xa: 2.6, shots: 22, keyPasses: 16, passCompletionPct: 78.6, progressivePasses: 30, progressiveCarries: 48, tackles: 6, interceptions: 3, duelsWonPct: 44.8, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Noahkai Banks": { minutes: 810, starts: 9, goals: 0, assists: 1, xg: 0.2, xa: 0.4, shots: 5, keyPasses: 3, passCompletionPct: 86.3, progressivePasses: 40, progressiveCarries: 12, tackles: 20, interceptions: 26, duelsWonPct: 61.4, cleanSheets: 3, savePct: null, avgRating: 6.7 },
    "Leonard Prescott": { minutes: 90, starts: 1, goals: 0, assists: 0, xg: 0, xa: 0, shots: 0, keyPasses: 0, passCompletionPct: 60.0, progressivePasses: 1, progressiveCarries: 0, tackles: 0, interceptions: 0, duelsWonPct: 0, cleanSheets: 1, savePct: 75.0, avgRating: 6.6 },
    "Zavier Gozo": { minutes: 420, starts: 4, goals: 2, assists: 1, xg: 1.8, xa: 0.9, shots: 14, keyPasses: 6, passCompletionPct: 76.2, progressivePasses: 18, progressiveCarries: 24, tackles: 4, interceptions: 2, duelsWonPct: 46.5, cleanSheets: 0, savePct: null, avgRating: 6.7 },
    "Chris Brady": { minutes: 2340, starts: 26, goals: 0, assists: 0, xg: 0, xa: 0, shots: 0, keyPasses: 0, passCompletionPct: 74.8, progressivePasses: 10, progressiveCarries: 0, tackles: 0, interceptions: 3, duelsWonPct: 0, cleanSheets: 8, savePct: 69.4, avgRating: 6.8 },
    "Matt Freese": { minutes: 2610, starts: 29, goals: 0, assists: 1, xg: 0, xa: 0.1, shots: 0, keyPasses: 2, passCompletionPct: 78.2, progressivePasses: 16, progressiveCarries: 0, tackles: 0, interceptions: 4, duelsWonPct: 0, cleanSheets: 11, savePct: 72.6, avgRating: 7.0 },
    "Max Arfsten": { minutes: 2460, starts: 27, goals: 4, assists: 8, xg: 3.6, xa: 6.4, shots: 34, keyPasses: 42, passCompletionPct: 80.9, progressivePasses: 104, progressiveCarries: 88, tackles: 40, interceptions: 24, duelsWonPct: 53.8, cleanSheets: 0, savePct: null, avgRating: 7.2 },
    "Alex Freeman": { minutes: 2380, starts: 26, goals: 5, assists: 11, xg: 4.2, xa: 8.9, shots: 40, keyPasses: 56, passCompletionPct: 81.4, progressivePasses: 118, progressiveCarries: 132, tackles: 44, interceptions: 22, duelsWonPct: 56.9, cleanSheets: 0, savePct: null, avgRating: 7.6 },
    "Mark McKenzie": { minutes: 2520, starts: 28, goals: 1, assists: 0, xg: 0.8, xa: 0.3, shots: 8, keyPasses: 4, passCompletionPct: 87.6, progressivePasses: 88, progressiveCarries: 20, tackles: 46, interceptions: 62, duelsWonPct: 63.2, cleanSheets: 10, savePct: null, avgRating: 6.9 },
    "Tim Ream": { minutes: 2380, starts: 27, goals: 1, assists: 1, xg: 0.6, xa: 0.2, shots: 6, keyPasses: 3, passCompletionPct: 89.1, progressivePasses: 96, progressiveCarries: 12, tackles: 38, interceptions: 58, duelsWonPct: 60.4, cleanSheets: 9, savePct: null, avgRating: 6.9 },
    "Miles Robinson": { minutes: 2280, starts: 25, goals: 3, assists: 0, xg: 2.4, xa: 0.2, shots: 20, keyPasses: 2, passCompletionPct: 84.3, progressivePasses: 62, progressiveCarries: 18, tackles: 44, interceptions: 50, duelsWonPct: 61.7, cleanSheets: 8, savePct: null, avgRating: 6.9 },
    "Joe Scally": { minutes: 2470, starts: 27, goals: 0, assists: 3, xg: 0.5, xa: 2.8, shots: 12, keyPasses: 24, passCompletionPct: 83.7, progressivePasses: 92, progressiveCarries: 64, tackles: 42, interceptions: 28, duelsWonPct: 54.5, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Auston Trusty": { minutes: 2610, starts: 29, goals: 2, assists: 1, xg: 1.6, xa: 0.4, shots: 16, keyPasses: 3, passCompletionPct: 86.9, progressivePasses: 70, progressiveCarries: 16, tackles: 40, interceptions: 54, duelsWonPct: 62.8, cleanSheets: 11, savePct: null, avgRating: 7.1 },
    "Sebastian Berhalter": { minutes: 1980, starts: 22, goals: 1, assists: 2, xg: 0.9, xa: 1.6, shots: 14, keyPasses: 18, passCompletionPct: 88.4, progressivePasses: 110, progressiveCarries: 30, tackles: 52, interceptions: 32, duelsWonPct: 57.1, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Cristian Roldan": { minutes: 2340, starts: 26, goals: 3, assists: 4, xg: 2.6, xa: 3.2, shots: 24, keyPasses: 26, passCompletionPct: 85.0, progressivePasses: 84, progressiveCarries: 42, tackles: 44, interceptions: 26, duelsWonPct: 53.9, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Brenden Aaronson": { minutes: 2620, starts: 29, goals: 9, assists: 6, xg: 7.4, xa: 4.8, shots: 58, keyPasses: 40, passCompletionPct: 79.6, progressivePasses: 74, progressiveCarries: 86, tackles: 30, interceptions: 14, duelsWonPct: 50.2, cleanSheets: 0, savePct: null, avgRating: 7.4 },
    "Alejandro Zendejas": { minutes: 1860, starts: 20, goals: 6, assists: 7, xg: 5.6, xa: 5.9, shots: 44, keyPasses: 38, passCompletionPct: 80.1, progressivePasses: 60, progressiveCarries: 70, tackles: 14, interceptions: 6, duelsWonPct: 47.8, cleanSheets: 0, savePct: null, avgRating: 7.0 },
    "Haji Wright": { minutes: 2540, starts: 28, goals: 17, assists: 3, xg: 14.8, xa: 2.6, shots: 88, keyPasses: 18, passCompletionPct: 74.5, progressivePasses: 26, progressiveCarries: 28, tackles: 8, interceptions: 4, duelsWonPct: 51.6, cleanSheets: 0, savePct: null, avgRating: 7.3 },
    "Diego Luna": { minutes: 1740, starts: 18, goals: 5, assists: 9, xg: 4.1, xa: 7.6, shots: 42, keyPasses: 48, passCompletionPct: 82.9, progressivePasses: 86, progressiveCarries: 96, tackles: 12, interceptions: 6, duelsWonPct: 46.4, cleanSheets: 0, savePct: null, avgRating: 7.2 },
    "Gaga Slonina": { minutes: 990, starts: 11, goals: 0, assists: 0, xg: 0, xa: 0, shots: 0, keyPasses: 0, passCompletionPct: 70.2, progressivePasses: 6, progressiveCarries: 0, tackles: 0, interceptions: 2, duelsWonPct: 0, cleanSheets: 3, savePct: 66.7, avgRating: 6.6 },
    "Caleb Wiley": { minutes: 860, starts: 9, goals: 0, assists: 2, xg: 0.4, xa: 1.4, shots: 10, keyPasses: 12, passCompletionPct: 79.0, progressivePasses: 32, progressiveCarries: 38, tackles: 16, interceptions: 8, duelsWonPct: 49.1, cleanSheets: 0, savePct: null, avgRating: 6.6 },
    "Damion Downs": { minutes: 780, starts: 8, goals: 4, assists: 1, xg: 3.6, xa: 0.6, shots: 26, keyPasses: 6, passCompletionPct: 73.4, progressivePasses: 14, progressiveCarries: 20, tackles: 4, interceptions: 2, duelsWonPct: 52.9, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Cole Campbell": { minutes: 420, starts: 4, goals: 1, assists: 2, xg: 1.2, xa: 1.6, shots: 12, keyPasses: 10, passCompletionPct: 80.6, progressivePasses: 20, progressiveCarries: 24, tackles: 6, interceptions: 4, duelsWonPct: 45.2, cleanSheets: 0, savePct: null, avgRating: 6.7 },
    "Bajung Darboe": { minutes: 610, starts: 6, goals: 3, assists: 2, xg: 2.6, xa: 1.8, shots: 18, keyPasses: 14, passCompletionPct: 76.8, progressivePasses: 24, progressiveCarries: 32, tackles: 4, interceptions: 3, duelsWonPct: 48.5, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Montrell Culbreath": { minutes: 800, starts: 6, goals: 1, assists: 1, xg: 1.4, xa: 1.1, shots: 15, keyPasses: 9, passCompletionPct: 79.3, progressivePasses: 18, progressiveCarries: 22, tackles: 5, interceptions: 3, duelsWonPct: 44.0, cleanSheets: 0, savePct: null, avgRating: 6.6 },
    "Rokas Pukstas": { minutes: 1980, starts: 22, goals: 3, assists: 4, xg: 2.8, xa: 3.6, shots: 30, keyPasses: 28, passCompletionPct: 84.2, progressivePasses: 76, progressiveCarries: 40, tackles: 34, interceptions: 20, duelsWonPct: 53.1, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Quinn Sullivan": { minutes: 640, starts: 6, goals: 2, assists: 3, xg: 1.8, xa: 2.4, shots: 20, keyPasses: 16, passCompletionPct: 81.3, progressivePasses: 26, progressiveCarries: 30, tackles: 6, interceptions: 2, duelsWonPct: 44.6, cleanSheets: 0, savePct: null, avgRating: 6.8 },
    "Luca Bombino": { minutes: 1860, starts: 20, goals: 0, assists: 3, xg: 0.4, xa: 2.6, shots: 10, keyPasses: 20, passCompletionPct: 85.8, progressivePasses: 96, progressiveCarries: 34, tackles: 32, interceptions: 18, duelsWonPct: 51.7, cleanSheets: 0, savePct: null, avgRating: 6.9 },
    "Peyton Miller": { minutes: 920, starts: 10, goals: 0, assists: 1, xg: 0.2, xa: 0.6, shots: 4, keyPasses: 6, passCompletionPct: 82.4, progressivePasses: 34, progressiveCarries: 16, tackles: 24, interceptions: 16, duelsWonPct: 55.3, cleanSheets: 3, savePct: null, avgRating: 6.7 },
    "Joshua Wynder": { minutes: 300, starts: 3, goals: 0, assists: 0, xg: 0, xa: 0, shots: 1, keyPasses: 0, passCompletionPct: 78.9, progressivePasses: 8, progressiveCarries: 2, tackles: 6, interceptions: 8, duelsWonPct: 58.6, cleanSheets: 1, savePct: null, avgRating: 6.6 },
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
    "Scottish Premiership": "Scottish Premiership",
    "Liga MX": "Liga MX",
    HNL: "HNL",
    "Primeira Liga": "Primeira Liga",
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
    "Scottish Premiership": ["Rangers", "Hearts", "Aberdeen", "Hibernian", "Dundee United"],
    "Liga MX": ["Chivas", "Cruz Azul", "Monterrey", "Tigres UANL", "Pumas UNAM"],
    HNL: ["Dinamo Zagreb", "Rijeka", "Osijek", "Gorica", "Istra 1961"],
    "Primeira Liga": ["Porto", "Sporting CP", "Braga", "Vitoria Guimaraes", "Famalicao"],
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
    // Only genuine seed-only fixtures live here: national-team matches, which
    // API-Football's club-fixtures sync does not cover. Do NOT add club
    // fixtures (AC Milan, Bournemouth, PSV, etc.) here — those are fabricated
    // placeholders that duplicate/conflict with the real fixtures the
    // apiFootballSync job pulls in for every club in clubDefs. Club schedules
    // should come exclusively from the live sync.
    // Note: Yunus Musah did not make the final 26-man World Cup roster, so he
    // is deliberately left off this fixture's featured tags (2026-07-13 audit).
    { isNationalTeam: true, competition: "FIFA World Cup", daysFromNow: -4, hour: 15, venue: "AT&T Stadium, Arlington", homeTeam: "USA", awayTeam: "Belgium", homeScore: 1, awayScore: 4, status: "finished", tvNetwork: "Fox", streamingService: "Fubo", broadcastLink: null, featured: ["Christian Pulisic", "Weston McKennie", "Tyler Adams", "Antonee Robinson", "Matt Turner"] },
    // CONCACAF Nations League - Group Stage window (next up after the World Cup).
    { isNationalTeam: true, competition: "CONCACAF Nations League", daysFromNow: 42, hour: 19, venue: "Allianz Field, Saint Paul", homeTeam: "USA", awayTeam: "Jamaica", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "TNT", streamingService: "Fubo", broadcastLink: null, featured: ["Christian Pulisic", "Weston McKennie", "Tyler Adams", "Antonee Robinson", "Ricardo Pepi", "Matt Turner"] },
    { isNationalTeam: true, competition: "CONCACAF Nations League", daysFromNow: 46, hour: 20, venue: "Q2 Stadium, Austin", homeTeam: "USA", awayTeam: "Trinidad and Tobago", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "TNT", streamingService: "Fubo", broadcastLink: null, featured: ["Christian Pulisic", "Malik Tillman", "Folarin Balogun", "Timothy Weah", "Chris Richards"] },
    // November friendly window, after the Nations League group stage.
    { isNationalTeam: true, competition: "International Friendly", daysFromNow: 119, hour: 19, venue: "Allianz Field, Saint Paul", homeTeam: "USA", awayTeam: "Panama", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "TNT", streamingService: "Fubo", broadcastLink: null, featured: ["Weston McKennie", "Tyler Adams", "Yunus Musah", "Ricardo Pepi"] },
    { isNationalTeam: true, competition: "International Friendly", daysFromNow: 123, hour: 20, venue: "Q2 Stadium, Austin", homeTeam: "USA", awayTeam: "Colombia", homeScore: null, awayScore: null, status: "scheduled", tvNetwork: "TNT", streamingService: "Fubo", broadcastLink: null, featured: ["Malik Tillman", "Folarin Balogun", "Timothy Weah", "Sergiño Dest"] },
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
    { player: "Christian Pulisic", bodyPart: "Tibia/Fibula (micro-fracture)", status: "active", expectedReturn: isoDateOffset(24), daysMissed: 4, matchesMissed: 1, latestUpdate: "Suffered the injury on a heavy challenge during the USMNT's World Cup match against Belgium. Ruled out several weeks; timeline to be reassessed after a follow-up scan.", startDaysAgo: 4 },
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

  console.log(`Seeded ${insertedClubs.length} clubs, ${insertedPlayers.length} players, ${statRows.length} stat rows, ${matchLogRows.length} match logs, ${fixtureDefs.length} fixtures, ${newsDefs.length} news articles, ${injuryDefs.length} injuries, ${transferDefs.length} transfers.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
