PROMPT 28c · READ-ONLY PRODUCTION AUDIT

# Seed-script data remaining in production

Observed October 20, 2026. All timestamps below are UTC, including database microseconds where available.

## Scope, evidence and limitations

**Confirmed:** All database calls used production read-only SELECTs. The database reported `pg_is_in_recovery() = true`, confirming replica access. Reference observation: `2026-10-20T19:31:37.254958+00:00`. Queries ran sequentially over several minutes, not in one atomic snapshot; live syncs may have continued independently.

No production browser, HTTP app request, seed execution, data change, workflow restart, deployment, or source/config change was performed. This report is the only file created. News article rows 1–12 were excluded from inspection and are not reproduced. Their link table was checked separately; no links remain for those article IDs.

**Labels:** **Confirmed** means directly visible in source or production SELECT results; **Likely** means the strongest supported attribution, without an audit trail; **Possible** means a non-unique fingerprint; **Unable to verify** means the available evidence cannot establish the claim. A seed-origin row is not automatically fictitious: clubs and players represent real entities. “Still seed” means exact retained seed values, not independent fact-checking.

None of the eleven inspected tables has an `updated_at` column in production. Both join tables also lack `created_at`. Therefore later updates cannot be dated from those columns. Original creation time is not a last-refresh time, and exact equality does not prove that a sync never wrote the same value again.

### Bottom line

- **Confirmed:** 50 original seed clubs and 52 original seed players remain. Original player IDs 23 (Obed Vargas) and 26 (Noahkai Banks) are absent.

- **Confirmed:** Both seed national-team windows remain completely unchanged.

- **Confirmed:** Fixture 1, USA–Belgium, retains the complete seeded match payload; a provider ID and senior classification were added later. Its seeded July 9 kickoff conflicts with July 7 provider-linked match logs. The 1–4 score is corroborated by those logs, so it is not classified as fabricated solely because it matches the seed.

- **Confirmed:** All 53 inspected seed-identity players (52 original plus later Justin Ellis) retain exact seed biographies, contract dates, market values and debut dates. Every inspected player has at least one seeded field changed; none is an untouched whole-row seed record.

- **Confirmed:** No surviving seed fingerprints were found in player_stats, match_logs, injuries, transfers, or news outside IDs 1–12. This does not reconstruct deleted records or certify all remaining provider data as true.

- **Confirmed:** Current seed code refuses a normal run when players exist (78 observed). Bypassing that guard makes it destructive to at least 15 current tables through cascading truncation.

## Which script version matters?

Current `scripts/src/seedUsmnt.ts` inserts into seven tables: `clubs`, `players`, `fixtures`, `fixture_players`, `news_articles`, `news_article_players`, and `national_team_windows`. It also truncates four tables it no longer fills: `player_stats`, `match_logs`, `injuries`, and `transfers`. Those eleven are the eleven per-table sections below.

The July 15 production batch is strongly fingerprinted by 50 club rows at `2026-07-15T02:46:09.457074+00:00`, 52 surviving players at `2026-07-15T02:46:09.468568+00:00`, fixture 1 at `2026-07-15T02:46:09.476302+00:00`, and two windows at `2026-07-15T02:46:09.612242+00:00`. Club IDs 1–50 and player IDs within 1–54 match the seed insertion order exactly. Reference historical source `d99e593` (July 15, 01:42 UTC) defines that 50-club / 54-player roster and five NT fixtures.

**Confirmed source history:** the earliest July 13 version defined generated stats and randomised match logs, seven injury variants across history, six transfers and speculative club/NT fixtures. By the historical version corresponding to the July 15 cohort, stats/logs/injuries were already not inserted. Transfers were removed July 16 (`0f6e8e0`); future NT seed fixtures were removed in stages. The nonempty-player guard was added August 25 (`09a2f7a`). I inspected all 25 recorded script revisions and deduplicated their fingerprint definitions, rather than assuming the current source describes past runs. Exact production execution revision and import/copy history are **Unable to verify** from row data alone.

## 1. clubs

**Writes:** current and historical inserts; also truncates. Fingerprint: ordered insertion IDs + exact seed name/league/country + original batch timestamp. Logos alone are not unique fingerprints because the sync uses the same public CDN. Provider team IDs were not set by the seed.

50 original cohort matches; two later name matches included with weaker labels. No original club is missing.

**Confirmed logo changes from historical seed:** ID 36 (Leeds United): https://media.api-sports.io/football/teams/63.png → https://media.api-sports.io/football/teams/14430.png; ID 38 (Coventry City): https://media.api-sports.io/football/teams/1346.png → https://media.api-sports.io/football/teams/15645.png; ID 41 (SV Elversberg): NULL → https://media.api-sports.io/football/teams/1660.png; ID 43 (San Diego FC): NULL → https://media.api-sports.io/football/teams/25484.png. Other original club logo values remain equal to the seed.

| Production ID | Identifying current fields | created_at | Seed provenance | Retained / overwritten evidence |
| --- | --- | --- | --- | --- |
| 1 | AC Milan<br>Serie A / Italy<br>provider team ID: 489 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 1, "name": "AC Milan", "league": "Serie A", "country": "Italy", "logo_url": "https://media.api-sports.io/football/teams/489.png", "api_football_team_id": 489, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 2 | Juventus<br>Serie A / Italy<br>provider team ID: 496 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 2, "name": "Juventus", "league": "Serie A", "country": "Italy", "logo_url": "https://media.api-sports.io/football/teams/496.png", "api_football_team_id": 496, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 3 | Bournemouth<br>Premier League / England<br>provider team ID: 35 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 3, "name": "Bournemouth", "league": "Premier League", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/35.png", "api_football_team_id": 35, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 4 | Fulham<br>Premier League / England<br>provider team ID: 36 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 4, "name": "Fulham", "league": "Premier League", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/36.png", "api_football_team_id": 36, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 5 | Atalanta<br>Serie A / Italy<br>provider team ID: 499 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 5, "name": "Atalanta", "league": "Serie A", "country": "Italy", "logo_url": "https://media.api-sports.io/football/teams/499.png", "api_football_team_id": 499, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 6 | PSV Eindhoven<br>Eredivisie / Netherlands<br>provider team ID: 197 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 6, "name": "PSV Eindhoven", "league": "Eredivisie", "country": "Netherlands", "logo_url": "https://media.api-sports.io/football/teams/197.png", "api_football_team_id": 197, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 7 | AS Monaco<br>Ligue 1 / France<br>provider team ID: 91 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 7, "name": "AS Monaco", "league": "Ligue 1", "country": "France", "logo_url": "https://media.api-sports.io/football/teams/91.png", "api_football_team_id": 91, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 8 | Olympique de Marseille<br>Ligue 1 / France<br>provider team ID: 81 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 8, "name": "Olympique de Marseille", "league": "Ligue 1", "country": "France", "logo_url": "https://media.api-sports.io/football/teams/81.png", "api_football_team_id": 81, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 9 | Crystal Palace<br>Premier League / England<br>provider team ID: 52 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 9, "name": "Crystal Palace", "league": "Premier League", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/52.png", "api_football_team_id": 52, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 10 | Borussia Dortmund<br>Bundesliga / Germany<br>provider team ID: 165 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 10, "name": "Borussia Dortmund", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/165.png", "api_football_team_id": 165, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 11 | Norwich City<br>Championship / England<br>provider team ID: 71 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 11, "name": "Norwich City", "league": "Championship", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/71.png", "api_football_team_id": 71, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 12 | Union Berlin<br>Bundesliga / Germany<br>provider team ID: 182 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 12, "name": "Union Berlin", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/182.png", "api_football_team_id": 182, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 13 | Middlesbrough<br>Championship / England<br>provider team ID: 70 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 13, "name": "Middlesbrough", "league": "Championship", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/70.png", "api_football_team_id": 70, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 14 | AZ Alkmaar<br>Eredivisie / Netherlands<br>provider team ID: 201 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 14, "name": "AZ Alkmaar", "league": "Eredivisie", "country": "Netherlands", "logo_url": "https://media.api-sports.io/football/teams/201.png", "api_football_team_id": 201, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 15 | Como 1907<br>Serie A / Italy<br>provider team ID: 895 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 15, "name": "Como 1907", "league": "Serie A", "country": "Italy", "logo_url": "https://media.api-sports.io/football/teams/895.png", "api_football_team_id": 895, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 16 | Philadelphia Union<br>MLS / USA<br>provider team ID: 1599 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 16, "name": "Philadelphia Union", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1599.png", "api_football_team_id": 1599, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 17 | FC Barcelona<br>La Liga / Spain<br>provider team ID: 529 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 17, "name": "FC Barcelona", "league": "La Liga", "country": "Spain", "logo_url": "https://media.api-sports.io/football/teams/529.png", "api_football_team_id": 529, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 18 | Inter Miami CF<br>MLS / USA<br>provider team ID: 9568 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 18, "name": "Inter Miami CF", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/9568.png", "api_football_team_id": 9568, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 19 | Werder Bremen<br>Bundesliga / Germany<br>provider team ID: 162 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 19, "name": "Werder Bremen", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/162.png", "api_football_team_id": 162, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 20 | Seattle Sounders FC<br>MLS / USA<br>provider team ID: 1595 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 20, "name": "Seattle Sounders FC", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1595.png", "api_football_team_id": 1595, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 21 | New England Revolution<br>MLS / USA<br>provider team ID: 1609 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 21, "name": "New England Revolution", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1609.png", "api_football_team_id": 1609, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 22 | FC Augsburg<br>Bundesliga / Germany<br>provider team ID: 170 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 22, "name": "FC Augsburg", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/170.png", "api_football_team_id": 170, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 23 | Bayern Munich<br>Bundesliga / Germany<br>provider team ID: 157 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 23, "name": "Bayern Munich", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/157.png", "api_football_team_id": 157, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 24 | Real Salt Lake<br>MLS / USA<br>provider team ID: 1606 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 24, "name": "Real Salt Lake", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1606.png", "api_football_team_id": 1606, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 25 | San Jose Earthquakes<br>MLS / USA<br>provider team ID: 1596 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 25, "name": "San Jose Earthquakes", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1596.png", "api_football_team_id": 1596, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 26 | Chicago Fire<br>MLS / USA<br>provider team ID: 1607 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 26, "name": "Chicago Fire", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1607.png", "api_football_team_id": 1607, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 27 | New York City FC<br>MLS / USA<br>provider team ID: 1604 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 27, "name": "New York City FC", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1604.png", "api_football_team_id": 1604, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 28 | Columbus Crew<br>MLS / USA<br>provider team ID: 1613 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 28, "name": "Columbus Crew", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1613.png", "api_football_team_id": 1613, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 29 | Villarreal<br>La Liga / Spain<br>provider team ID: 533 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 29, "name": "Villarreal", "league": "La Liga", "country": "Spain", "logo_url": "https://media.api-sports.io/football/teams/533.png", "api_football_team_id": 533, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 30 | Toulouse<br>Ligue 1 / France<br>provider team ID: 96 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 30, "name": "Toulouse", "league": "Ligue 1", "country": "France", "logo_url": "https://media.api-sports.io/football/teams/96.png", "api_football_team_id": 96, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 31 | Charlotte FC<br>MLS / USA<br>provider team ID: 18310 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 31, "name": "Charlotte FC", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/18310.png", "api_football_team_id": 18310, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 32 | FC Cincinnati<br>MLS / USA<br>provider team ID: 2242 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 32, "name": "FC Cincinnati", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/2242.png", "api_football_team_id": 2242, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 33 | Borussia Monchengladbach<br>Bundesliga / Germany<br>provider team ID: 163 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 33, "name": "Borussia Monchengladbach", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/163.png", "api_football_team_id": 163, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 34 | Celtic<br>Scottish Premiership / Scotland<br>provider team ID: 247 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 34, "name": "Celtic", "league": "Scottish Premiership", "country": "Scotland", "logo_url": "https://media.api-sports.io/football/teams/247.png", "api_football_team_id": 247, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 35 | Vancouver Whitecaps<br>MLS / USA<br>provider team ID: 1603 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 35, "name": "Vancouver Whitecaps", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1603.png", "api_football_team_id": 1603, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 36 | Leeds United<br>Premier League / England<br>provider team ID: 14430 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Confirmed** logo differs from seed (Leeds seed 63, current 14430; Coventry seed 1346, current 15645). Provider IDs alone are not proof that the team mapping is correct. **Current row** { "id": 36, "name": "Leeds United", "league": "Premier League", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/14430.png", "api_football_team_id": 14430, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 37 | Club America<br>Liga MX / Mexico<br>provider team ID: 2287 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 37, "name": "Club America", "league": "Liga MX", "country": "Mexico", "logo_url": "https://media.api-sports.io/football/teams/2287.png", "api_football_team_id": 2287, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 38 | Coventry City<br>Championship / England<br>provider team ID: 15645 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Confirmed** logo differs from seed (Leeds seed 63, current 14430; Coventry seed 1346, current 15645). Provider IDs alone are not proof that the team mapping is correct. **Current row** { "id": 38, "name": "Coventry City", "league": "Championship", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/15645.png", "api_football_team_id": 15645, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 39 | Chelsea<br>Premier League / England<br>provider team ID: 49 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 39, "name": "Chelsea", "league": "Premier League", "country": "England", "logo_url": "https://media.api-sports.io/football/teams/49.png", "api_football_team_id": 49, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 40 | Hamburger SV<br>Bundesliga / Germany<br>provider team ID: 175 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 40, "name": "Hamburger SV", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/175.png", "api_football_team_id": 175, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 41 | SV Elversberg<br>Bundesliga / Germany<br>provider team ID: 1660 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 41, "name": "SV Elversberg", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/1660.png", "api_football_team_id": 1660, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 42 | Hajduk Split<br>HNL / Croatia<br>provider team ID: 608 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 42, "name": "Hajduk Split", "league": "HNL", "country": "Croatia", "logo_url": "https://media.api-sports.io/football/teams/608.png", "api_football_team_id": 608, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 43 | San Diego FC<br>MLS / USA<br>provider team ID: 25484 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 43, "name": "San Diego FC", "league": "MLS", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/25484.png", "api_football_team_id": 25484, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 44 | Benfica<br>Primeira Liga / Portugal<br>provider team ID: 211 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 44, "name": "Benfica", "league": "Primeira Liga", "country": "Portugal", "logo_url": "https://media.api-sports.io/football/teams/211.png", "api_football_team_id": 211, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 45 | Bayer Leverkusen<br>Bundesliga / Germany<br>provider team ID: 168 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 45, "name": "Bayer Leverkusen", "league": "Bundesliga", "country": "Germany", "logo_url": "https://media.api-sports.io/football/teams/168.png", "api_football_team_id": 168, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 46 | Bayern Munich II<br>Regionalliga Bayern / Germany<br>provider team ID: NULL | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. No provider ID; **Unable to verify** any enrichment. **Current row** { "id": 46, "name": "Bayern Munich II", "league": "Regionalliga Bayern", "country": "Germany", "logo_url": null, "api_football_team_id": null, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 47 | Lyon<br>Ligue 1 / France<br>provider team ID: 80 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 47, "name": "Lyon", "league": "Ligue 1", "country": "France", "logo_url": "https://media.api-sports.io/football/teams/80.png", "api_football_team_id": 80, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 48 | Lyngby Boldklub<br>Danish Superliga / Denmark<br>provider team ID: 625 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 48, "name": "Lyngby Boldklub", "league": "Danish Superliga", "country": "Denmark", "logo_url": "https://media.api-sports.io/football/teams/625.png", "api_football_team_id": 625, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 49 | Real Monarchs<br>MLS Next Pro / USA<br>provider team ID: 4012 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 49, "name": "Real Monarchs", "league": "MLS Next Pro", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/4012.png", "api_football_team_id": 4012, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 50 | Benfica B<br>Liga Portugal 2 / Portugal<br>provider team ID: 229 | 2026-07-15T02:46:09.457074+00:00 | **Confirmed** seed-cohort identity; exact ordered seed ID + batch timestamp. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 50, "name": "Benfica B", "league": "Liga Portugal 2", "country": "Portugal", "logo_url": "https://media.api-sports.io/football/teams/229.png", "api_football_team_id": 229, "created_at": "2026-07-15T02:46:09.457074+00:00" } |
| 321 | Orlando City II<br>MLS Next Pro / USA<br>provider team ID: 4026 | 2026-08-25T18:50:36.279088+00:00 | **Likely** later seed-derived insertion; exact name/league/country and seed logo. Not the original full-script run. | Seed name/league/country still exact. These identify real clubs; this is not proof of invention. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 321, "name": "Orlando City II", "league": "MLS Next Pro", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/4026.png", "api_football_team_id": 4026, "created_at": "2026-08-25T18:50:36.279088+00:00" } |
| 322 | Orlando City SC<br>Major League Soccer / USA<br>provider team ID: 1598 | 2026-08-25T21:21:08.681255+00:00 | **Possible** name/identity match only; later insertion, league and logo differ from seed. | Changed: league seed MLS → Major League Soccer. **Confirmed** provider ID populated after seed (seed leaves it NULL); **Likely** live-sync enrichment. **Current row** { "id": 322, "name": "Orlando City SC", "league": "Major League Soccer", "country": "USA", "logo_url": "https://media.api-sports.io/football/teams/1598.png", "api_football_team_id": 1598, "created_at": "2026-08-25T21:21:08.681255+00:00" } |

## 2. players

**Writes:** current/historical inserts; also truncates. Fingerprint: exact slug and name, original insertion-order ID, shared batch timestamp and distinctive biography. Original IDs are not compared with today’s reordered seed; the July 15-era order is used. The newer Justin Ellis entry is included separately.

**Confirmed:** 53 identity matches, of which 52 are original seed-cohort rows. Every row is partially changed/enriched, but none has had its seed biography, market value, contract date or debut date replaced. **Likely** automatic refresh paths explain provider IDs/photos, club, age/DOB, caps/goals and call-up-score changes; manual changes cannot be excluded. Equal identities or equal true values are not called invented.

For all original rows, “seed” comparisons below use historical `d99e593`, including its manually supplied caps/goals, not today’s zero defaults. Justin Ellis comparisons use the current definition, whose caps/goals default to zero. Removed columns `performance_trend` and `trending` cannot be inspected in today’s schema; `trend`/`trending` are present in the current definition objects but are not passed to the current insert.

| ID | Identity | created_at | Provenance | Still seed / unverified authored values | Changed or enriched evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Christian Pulisic<br>`christian-pulisic` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Christian Pulisic", "slug": "christian-pulisic", "position": "FW", "category": "current", "club": "AC Milan", "contract_until": "2028-06-30", "market_value_usd": 42000000, "youth_national_team": null, "debut_date": "2016-01-29", "potential_call_up_score": null, "bio": "The captain and the face of American soccer's rise in Europe. Since moving to Milan, Pulisic has rediscovered the explosive form that once made him the USMNT's most feared attacker, combining pace, close control, and a nose for the big moment.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 27 → 28; national_team_caps: 78 → 90; national_team_goals: 30 → 33.<br>**Likely** partial live refresh: provider player ID 17, Wikipedia Christian Pulisic, DOB 1998-09-18, squad checked 2026-10-20T13:41:56.659+00:00. Photo now https://media.api-sports.io/football/players/17.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 1, "name": "Christian Pulisic", "slug": "christian-pulisic", "position": "FW", "category": "current", "club": "AC Milan", "photo_url": "https://media.api-sports.io/football/players/17.png", "age": 28, "contract_until": "2028-06-30", "market_value_usd": 42000000, "national_team_caps": 90, "national_team_goals": 33, "youth_national_team": null, "debut_date": "2016-01-29", "potential_call_up_score": null, "bio": "The captain and the face of American soccer's rise in Europe. Since moving to Milan, Pulisic has rediscovered the explosive form that once made him the USMNT's most feared attacker, combining pace, close control, and a nose for the big moment.", "world_cup_roster": true, "api_football_player_id": 17, "wikipedia_title": "Christian Pulisic", "date_of_birth": "1998-09-18", "squad_last_checked_at": "2026-10-20T13:41:56.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 2 | Weston McKennie<br>`weston-mckennie` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Weston McKennie", "slug": "weston-mckennie", "position": "MF", "category": "current", "club": "Juventus", "contract_until": "2027-06-30", "market_value_usd": 28000000, "youth_national_team": null, "debut_date": "2018-05-28", "potential_call_up_score": null, "bio": "A box-to-box engine whose late runs and set-piece heading ability have made him a consistent source of goals from midfield for both club and country.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 27 → 28; national_team_caps: 55 → 80; national_team_goals: 12 → 14.<br>**Likely** partial live refresh: provider player ID 415, Wikipedia Weston McKennie, DOB 1998-08-28, squad checked 2026-10-20T13:41:18.659+00:00. Photo now https://media.api-sports.io/football/players/415.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 2, "name": "Weston McKennie", "slug": "weston-mckennie", "position": "MF", "category": "current", "club": "Juventus", "photo_url": "https://media.api-sports.io/football/players/415.png", "age": 28, "contract_until": "2027-06-30", "market_value_usd": 28000000, "national_team_caps": 80, "national_team_goals": 14, "youth_national_team": null, "debut_date": "2018-05-28", "potential_call_up_score": null, "bio": "A box-to-box engine whose late runs and set-piece heading ability have made him a consistent source of goals from midfield for both club and country.", "world_cup_roster": true, "api_football_player_id": 415, "wikipedia_title": "Weston McKennie", "date_of_birth": "1998-08-28", "squad_last_checked_at": "2026-10-20T13:41:18.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 3 | Tyler Adams<br>`tyler-adams` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Tyler Adams", "slug": "tyler-adams", "position": "MF", "category": "current", "club": "Bournemouth", "contract_until": "2027-06-30", "market_value_usd": 22000000, "youth_national_team": null, "debut_date": "2019-01-27", "potential_call_up_score": null, "bio": "The heartbeat of the USMNT midfield — a relentless ball-winner whose return from a long hamstring layoff has coincided with a run of commanding performances.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 26 → 27; national_team_caps: 40 → 62; national_team_goals: 1 → 2.<br>**Likely** partial live refresh: provider player ID 1150, Wikipedia Tyler Adams, DOB 1999-02-14, squad checked 2026-10-20T13:41:42.606+00:00. Photo now https://media.api-sports.io/football/players/1150.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 3, "name": "Tyler Adams", "slug": "tyler-adams", "position": "MF", "category": "current", "club": "Bournemouth", "photo_url": "https://media.api-sports.io/football/players/1150.png", "age": 27, "contract_until": "2027-06-30", "market_value_usd": 22000000, "national_team_caps": 62, "national_team_goals": 2, "youth_national_team": null, "debut_date": "2019-01-27", "potential_call_up_score": null, "bio": "The heartbeat of the USMNT midfield — a relentless ball-winner whose return from a long hamstring layoff has coincided with a run of commanding performances.", "world_cup_roster": true, "api_football_player_id": 1150, "wikipedia_title": "Tyler Adams", "date_of_birth": "1999-02-14", "squad_last_checked_at": "2026-10-20T13:41:42.606+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 4 | Antonee Robinson<br>`antonee-robinson` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Antonee Robinson", "slug": "antonee-robinson", "position": "DF", "category": "current", "club": "Fulham", "contract_until": "2029-06-30", "market_value_usd": 24000000, "youth_national_team": null, "debut_date": "2018-01-27", "potential_call_up_score": null, "bio": "Arguably the best left-back the US has produced, prized for his overlapping runs, recovery speed, and end product from wide areas.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 27 → 29; national_team_caps: 48 → 62; national_team_goals: 3 → 5.<br>**Likely** partial live refresh: provider player ID 19549, Wikipedia Antonee Robinson, DOB 1997-08-08, squad checked 2026-10-20T13:39:36.659+00:00. Photo now https://media.api-sports.io/football/players/19549.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 4, "name": "Antonee Robinson", "slug": "antonee-robinson", "position": "DF", "category": "current", "club": "Fulham", "photo_url": "https://media.api-sports.io/football/players/19549.png", "age": 29, "contract_until": "2029-06-30", "market_value_usd": 24000000, "national_team_caps": 62, "national_team_goals": 5, "youth_national_team": null, "debut_date": "2018-01-27", "potential_call_up_score": null, "bio": "Arguably the best left-back the US has produced, prized for his overlapping runs, recovery speed, and end product from wide areas.", "world_cup_roster": true, "api_football_player_id": 19549, "wikipedia_title": "Antonee Robinson", "date_of_birth": "1997-08-08", "squad_last_checked_at": "2026-10-20T13:39:36.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 5 | Yunus Musah<br>`yunus-musah` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Yunus Musah", "slug": "yunus-musah", "position": "MF", "category": "current", "contract_until": "2028-06-30", "market_value_usd": 26000000, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "A press-resistant carrier who glides past pressure in tight spaces, Musah has grown into one of Serie A's most reliable young midfielders.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Atalanta → AC Milan; age: 22 → 23; national_team_caps: 34 → 50.<br>**Likely** partial live refresh: provider player ID 162106, Wikipedia Yunus Musah, DOB 2002-11-29, squad checked 2026-10-20T13:39:26.659+00:00. Photo now https://media.api-sports.io/football/players/162106.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 5, "name": "Yunus Musah", "slug": "yunus-musah", "position": "MF", "category": "current", "club": "AC Milan", "photo_url": "https://media.api-sports.io/football/players/162106.png", "age": 23, "contract_until": "2028-06-30", "market_value_usd": 26000000, "national_team_caps": 50, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "A press-resistant carrier who glides past pressure in tight spaces, Musah has grown into one of Serie A's most reliable young midfielders.", "world_cup_roster": false, "api_football_player_id": 162106, "wikipedia_title": "Yunus Musah", "date_of_birth": "2002-11-29", "squad_last_checked_at": "2026-10-20T13:39:26.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 6 | Ricardo Pepi<br>`ricardo-pepi` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Ricardo Pepi", "slug": "ricardo-pepi", "position": "FW", "category": "current", "club": "PSV Eindhoven", "contract_until": "2027-06-30", "market_value_usd": 20000000, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "A ruthless penalty-box finisher who has rebuilt his career in the Netherlands into one of the most productive striker spells by an American abroad.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 22 → 23; national_team_caps: 30 → 42; national_team_goals: 12 → 13.<br>**Likely** partial live refresh: provider player ID 73868, Wikipedia Ricardo Pepi, DOB 2003-01-09, squad checked 2026-10-20T13:40:36.659+00:00. Photo now https://media.api-sports.io/football/players/73868.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 6, "name": "Ricardo Pepi", "slug": "ricardo-pepi", "position": "FW", "category": "current", "club": "PSV Eindhoven", "photo_url": "https://media.api-sports.io/football/players/73868.png", "age": 23, "contract_until": "2027-06-30", "market_value_usd": 20000000, "national_team_caps": 42, "national_team_goals": 13, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "A ruthless penalty-box finisher who has rebuilt his career in the Netherlands into one of the most productive striker spells by an American abroad.", "world_cup_roster": true, "api_football_player_id": 73868, "wikipedia_title": "Ricardo Pepi", "date_of_birth": "2003-01-09", "squad_last_checked_at": "2026-10-20T13:40:36.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 7 | Folarin Balogun<br>`folarin-balogun` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Folarin Balogun", "slug": "folarin-balogun", "position": "FW", "category": "current", "club": "AS Monaco", "contract_until": "2028-06-30", "market_value_usd": 30000000, "youth_national_team": null, "debut_date": "2023-09-09", "potential_call_up_score": null, "bio": "A sharp, mobile striker whose move to Ligue 1 was meant to be a proving ground — the goals have arrived in flashes, with more expected.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 23 → 25; national_team_caps: 12 → 31; national_team_goals: 4 → 12.<br>**Likely** partial live refresh: provider player ID 138835, Wikipedia Folarin Balogun, DOB 2001-07-03, squad checked 2026-10-20T13:42:30.659+00:00. Photo now https://media.api-sports.io/football/players/138835.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 7, "name": "Folarin Balogun", "slug": "folarin-balogun", "position": "FW", "category": "current", "club": "AS Monaco", "photo_url": "https://media.api-sports.io/football/players/138835.png", "age": 25, "contract_until": "2028-06-30", "market_value_usd": 30000000, "national_team_caps": 31, "national_team_goals": 12, "youth_national_team": null, "debut_date": "2023-09-09", "potential_call_up_score": null, "bio": "A sharp, mobile striker whose move to Ligue 1 was meant to be a proving ground — the goals have arrived in flashes, with more expected.", "world_cup_roster": true, "api_football_player_id": 138835, "wikipedia_title": "Folarin Balogun", "date_of_birth": "2001-07-03", "squad_last_checked_at": "2026-10-20T13:42:30.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 8 | Timothy Weah<br>`timothy-weah` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Timothy Weah", "slug": "timothy-weah", "position": "FW", "category": "current", "club": "Olympique de Marseille", "contract_until": "2027-06-30", "market_value_usd": 18000000, "youth_national_team": null, "debut_date": "2018-01-28", "potential_call_up_score": null, "bio": "Versatile enough to play across the front line or at right-back, Weah's directness and work rate make him a coach's favorite utility weapon.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 25 → 26; national_team_caps: 42 → 53; national_team_goals: 8 → 7.<br>**Likely** partial live refresh: provider player ID 1138, Wikipedia Timothy Weah, DOB 2000-02-22, squad checked 2026-10-20T13:42:34.759+00:00. Photo now https://media.api-sports.io/football/players/1138.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 8, "name": "Timothy Weah", "slug": "timothy-weah", "position": "FW", "category": "current", "club": "Olympique de Marseille", "photo_url": "https://media.api-sports.io/football/players/1138.png", "age": 26, "contract_until": "2027-06-30", "market_value_usd": 18000000, "national_team_caps": 53, "national_team_goals": 7, "youth_national_team": null, "debut_date": "2018-01-28", "potential_call_up_score": null, "bio": "Versatile enough to play across the front line or at right-back, Weah's directness and work rate make him a coach's favorite utility weapon.", "world_cup_roster": true, "api_football_player_id": 1138, "wikipedia_title": "Timothy Weah", "date_of_birth": "2000-02-22", "squad_last_checked_at": "2026-10-20T13:42:34.759+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 9 | Malik Tillman<br>`malik-tillman` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Malik Tillman", "slug": "malik-tillman", "position": "MF", "category": "current", "contract_until": "2027-06-30", "market_value_usd": 27000000, "youth_national_team": null, "debut_date": "2023-06-17", "potential_call_up_score": null, "bio": "Since switching allegiance to the US, Tillman has been PSV's chief creative outlet — a shifty attacking midfielder who scores as often as he assists.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: PSV Eindhoven → Bayer Leverkusen; age: 23 → 24; national_team_caps: 20 → 39; national_team_goals: 9 → 7.<br>**Likely** partial live refresh: provider player ID 162037, Wikipedia Malik Tillman, DOB 2002-05-28, squad checked 2026-10-20T13:40:30.659+00:00. Photo now https://media.api-sports.io/football/players/162037.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 9, "name": "Malik Tillman", "slug": "malik-tillman", "position": "MF", "category": "current", "club": "Bayer Leverkusen", "photo_url": "https://media.api-sports.io/football/players/162037.png", "age": 24, "contract_until": "2027-06-30", "market_value_usd": 27000000, "national_team_caps": 39, "national_team_goals": 7, "youth_national_team": null, "debut_date": "2023-06-17", "potential_call_up_score": null, "bio": "Since switching allegiance to the US, Tillman has been PSV's chief creative outlet — a shifty attacking midfielder who scores as often as he assists.", "world_cup_roster": true, "api_football_player_id": 162037, "wikipedia_title": "Malik Tillman", "date_of_birth": "2002-05-28", "squad_last_checked_at": "2026-10-20T13:40:30.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 10 | Sergiño Dest<br>`sergino-dest` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Sergiño Dest", "slug": "sergino-dest", "position": "DF", "category": "current", "club": "PSV Eindhoven", "contract_until": "2026-06-30", "market_value_usd": 16000000, "youth_national_team": null, "debut_date": "2019-11-15", "potential_call_up_score": null, "bio": "An attack-minded full-back whose overlapping runs and dribbling out of the back have made him a fan favorite whenever he's fit.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 24 → 25; national_team_caps: 33 → 46; national_team_goals: 2 → 3.<br>**Likely** partial live refresh: provider player ID 38735, Wikipedia Sergiño Dest, DOB 2000-11-03, squad checked 2026-10-20T13:38:58.959+00:00. Photo now https://media.api-sports.io/football/players/38735.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 10, "name": "Sergiño Dest", "slug": "sergino-dest", "position": "DF", "category": "current", "club": "PSV Eindhoven", "photo_url": "https://media.api-sports.io/football/players/38735.png", "age": 25, "contract_until": "2026-06-30", "market_value_usd": 16000000, "national_team_caps": 46, "national_team_goals": 3, "youth_national_team": null, "debut_date": "2019-11-15", "potential_call_up_score": null, "bio": "An attack-minded full-back whose overlapping runs and dribbling out of the back have made him a fan favorite whenever he's fit.", "world_cup_roster": true, "api_football_player_id": 38735, "wikipedia_title": "Sergiño Dest", "date_of_birth": "2000-11-03", "squad_last_checked_at": "2026-10-20T13:38:58.959+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 11 | Chris Richards<br>`chris-richards` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Chris Richards", "slug": "chris-richards", "position": "DF", "category": "current", "club": "Crystal Palace", "contract_until": "2028-06-30", "market_value_usd": 15000000, "youth_national_team": null, "debut_date": "2020-11-11", "potential_call_up_score": null, "bio": "A composed, ball-playing center-back who has finally found an extended run of fitness and form on Palace's Premier League backline.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 25 → 26; national_team_caps: 24 → 43; national_team_goals: 1 → 4.<br>**Likely** partial live refresh: provider player ID 126949, Wikipedia Chris Richards (soccer), DOB 2000-03-28, squad checked 2026-10-20T13:39:50.959+00:00. Photo now https://media.api-sports.io/football/players/126949.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 11, "name": "Chris Richards", "slug": "chris-richards", "position": "DF", "category": "current", "club": "Crystal Palace", "photo_url": "https://media.api-sports.io/football/players/126949.png", "age": 26, "contract_until": "2028-06-30", "market_value_usd": 15000000, "national_team_caps": 43, "national_team_goals": 4, "youth_national_team": null, "debut_date": "2020-11-11", "potential_call_up_score": null, "bio": "A composed, ball-playing center-back who has finally found an extended run of fitness and form on Palace's Premier League backline.", "world_cup_roster": true, "api_football_player_id": 126949, "wikipedia_title": "Chris Richards (soccer)", "date_of_birth": "2000-03-28", "squad_last_checked_at": "2026-10-20T13:39:50.959+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 12 | Matt Turner<br>`matt-turner` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Matt Turner", "slug": "matt-turner", "position": "GK", "category": "current", "contract_until": "2026-06-30", "market_value_usd": 6000000, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "The long-time USMNT number one, valued for his shot-stopping reflexes and calm distribution under pressure.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Crystal Palace → New England Revolution; age: 31 → 32; national_team_caps: 41 → 55.<br>**Likely** partial live refresh: provider player ID 50999, Wikipedia Matt Turner (soccer), DOB 1994-06-24, squad checked 2026-10-20T16:37:31.023+00:00. Photo now https://media.api-sports.io/football/players/50999.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 12, "name": "Matt Turner", "slug": "matt-turner", "position": "GK", "category": "current", "club": "New England Revolution", "photo_url": "https://media.api-sports.io/football/players/50999.png", "age": 32, "contract_until": "2026-06-30", "market_value_usd": 6000000, "national_team_caps": 55, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "The long-time USMNT number one, valued for his shot-stopping reflexes and calm distribution under pressure.", "world_cup_roster": true, "api_football_player_id": 50999, "wikipedia_title": "Matt Turner (soccer)", "date_of_birth": "1994-06-24", "squad_last_checked_at": "2026-10-20T16:37:31.023+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 13 | Giovanni Reyna<br>`giovanni-reyna` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Giovanni Reyna", "slug": "giovanni-reyna", "position": "MF", "category": "current", "age": 23, "contract_until": "2026-06-30", "market_value_usd": 14000000, "youth_national_team": null, "debut_date": "2020-09-03", "bio": "Once the USMNT's most hyped young creator, Reyna's injury-hit few years have quieted the noise around him, though the underlying quality remains obvious in flashes.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Borussia Dortmund → Strasbourg; national_team_caps: 27 → 0; national_team_goals: 6 → 0; potential_call_up_score: NULL → 37.<br>**Likely** partial live refresh: provider player ID 161921, Wikipedia Giovanni Reyna, DOB 2002-11-13, squad checked 2026-10-20T16:29:47.924+00:00. Photo now https://media.api-sports.io/football/players/161921.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 13, "name": "Giovanni Reyna", "slug": "giovanni-reyna", "position": "MF", "category": "current", "club": "Strasbourg", "photo_url": "https://media.api-sports.io/football/players/161921.png", "age": 23, "contract_until": "2026-06-30", "market_value_usd": 14000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2020-09-03", "potential_call_up_score": 37, "bio": "Once the USMNT's most hyped young creator, Reyna's injury-hit few years have quieted the noise around him, though the underlying quality remains obvious in flashes.", "world_cup_roster": true, "api_football_player_id": 161921, "wikipedia_title": "Giovanni Reyna", "date_of_birth": "2002-11-13", "squad_last_checked_at": "2026-10-20T16:29:47.924+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 14 | Josh Sargent<br>`josh-sargent` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Josh Sargent", "slug": "josh-sargent", "position": "FW", "category": "current", "contract_until": "2027-06-30", "market_value_usd": 11000000, "youth_national_team": null, "debut_date": "2018-01-28", "bio": "A hard-working target man whose hold-up play and aerial threat have made him a reliable Championship goal scorer for Norwich.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Norwich City → Toronto FC; age: 25 → 26; national_team_caps: 33 → 29; national_team_goals: 8 → 5; potential_call_up_score: NULL → 31.<br>**Likely** partial live refresh: provider player ID 25332, Wikipedia Josh Sargent, DOB 2000-02-20, squad checked 2026-10-20T13:40:12.659+00:00. Photo now https://media.api-sports.io/football/players/25332.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 14, "name": "Josh Sargent", "slug": "josh-sargent", "position": "FW", "category": "current", "club": "Toronto FC", "photo_url": "https://media.api-sports.io/football/players/25332.png", "age": 26, "contract_until": "2027-06-30", "market_value_usd": 11000000, "national_team_caps": 29, "national_team_goals": 5, "youth_national_team": null, "debut_date": "2018-01-28", "potential_call_up_score": 31, "bio": "A hard-working target man whose hold-up play and aerial threat have made him a reliable Championship goal scorer for Norwich.", "world_cup_roster": false, "api_football_player_id": 25332, "wikipedia_title": "Josh Sargent", "date_of_birth": "2000-02-20", "squad_last_checked_at": "2026-10-20T13:40:12.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 15 | Paxten Aaronson<br>`paxten-aaronson` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Paxten Aaronson", "slug": "paxten-aaronson", "position": "MF", "category": "fringe", "contract_until": "2027-06-30", "market_value_usd": 6000000, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2023-06-17", "bio": "A tidy, tactically intelligent attacking midfielder who has been on the fringes of the senior squad while establishing himself in the Bundesliga.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Union Berlin → Colorado Rapids; age: 21 → 23; national_team_caps: 3 → 4; potential_call_up_score: 62 → 66.<br>**Likely** partial live refresh: provider player ID 265884, Wikipedia Paxten Aaronson, DOB 2003-08-26, squad checked 2026-10-20T13:39:30.659+00:00. Photo now https://media.api-sports.io/football/players/265884.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 15, "name": "Paxten Aaronson", "slug": "paxten-aaronson", "position": "MF", "category": "fringe", "club": "Colorado Rapids", "photo_url": "https://media.api-sports.io/football/players/265884.png", "age": 23, "contract_until": "2027-06-30", "market_value_usd": 6000000, "national_team_caps": 4, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2023-06-17", "potential_call_up_score": 66, "bio": "A tidy, tactically intelligent attacking midfielder who has been on the fringes of the senior squad while establishing himself in the Bundesliga.", "world_cup_roster": false, "api_football_player_id": 265884, "wikipedia_title": "Paxten Aaronson", "date_of_birth": "2003-08-26", "squad_last_checked_at": "2026-10-20T13:39:30.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 16 | Aidan Morris<br>`aidan-morris` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Aidan Morris", "slug": "aidan-morris", "position": "MF", "category": "fringe", "club": "Middlesbrough", "age": 24, "contract_until": "2028-06-30", "market_value_usd": 7000000, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2023-01-25", "bio": "A tenacious defensive midfielder whose ball-winning profile mirrors Tyler Adams — a natural depth option in the deepest midfield role.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 8 → 14; potential_call_up_score: 58 → 48.<br>**Likely** partial live refresh: provider player ID 201714, Wikipedia Aidan Morris, DOB 2001-11-16, squad checked 2026-10-20T16:31:36.223+00:00. Photo now https://media.api-sports.io/football/players/201714.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 16, "name": "Aidan Morris", "slug": "aidan-morris", "position": "MF", "category": "fringe", "club": "Middlesbrough", "photo_url": "https://media.api-sports.io/football/players/201714.png", "age": 24, "contract_until": "2028-06-30", "market_value_usd": 7000000, "national_team_caps": 14, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2023-01-25", "potential_call_up_score": 48, "bio": "A tenacious defensive midfielder whose ball-winning profile mirrors Tyler Adams — a natural depth option in the deepest midfield role.", "world_cup_roster": false, "api_football_player_id": 201714, "wikipedia_title": "Aidan Morris", "date_of_birth": "2001-11-16", "squad_last_checked_at": "2026-10-20T16:31:36.223+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 17 | Djordje Mihailovic<br>`djordje-mihailovic` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Djordje Mihailovic", "slug": "djordje-mihailovic", "position": "MF", "category": "fringe", "contract_until": "2026-06-30", "market_value_usd": 9000000, "youth_national_team": null, "debut_date": "2021-06-06", "bio": "A left-footed playmaker who has quietly built one of the more productive underlying-numbers seasons of any American in Europe.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: AZ Alkmaar → Toronto FC; age: 26 → 27; national_team_caps: 15 → 11; national_team_goals: 2 → 3; potential_call_up_score: 55 → 43.<br>**Likely** partial live refresh: provider player ID 50913, Wikipedia Djordje Mihailovic, DOB 1998-11-10, squad checked 2026-10-20T13:38:46.66+00:00. Photo now https://media.api-sports.io/football/players/50913.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 17, "name": "Djordje Mihailovic", "slug": "djordje-mihailovic", "position": "MF", "category": "fringe", "club": "Toronto FC", "photo_url": "https://media.api-sports.io/football/players/50913.png", "age": 27, "contract_until": "2026-06-30", "market_value_usd": 9000000, "national_team_caps": 11, "national_team_goals": 3, "youth_national_team": null, "debut_date": "2021-06-06", "potential_call_up_score": 43, "bio": "A left-footed playmaker who has quietly built one of the more productive underlying-numbers seasons of any American in Europe.", "world_cup_roster": false, "api_football_player_id": 50913, "wikipedia_title": "Djordje Mihailovic", "date_of_birth": "1998-11-10", "squad_last_checked_at": "2026-10-20T13:38:46.66+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 18 | Tanner Tessmann<br>`tanner-tessmann` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Tanner Tessmann", "slug": "tanner-tessmann", "position": "MF", "category": "fringe", "contract_until": "2027-06-30", "market_value_usd": 8000000, "youth_national_team": null, "debut_date": "2022-06-05", "bio": "A physically imposing midfield anchor who has settled into Serie A quicker than expected after his move from MLS.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Como 1907 → Lyon; age: 23 → 25; national_team_caps: 6 → 14; national_team_goals: 0 → 1; potential_call_up_score: 51 → 41.<br>**Likely** partial live refresh: provider player ID 80752, Wikipedia Tanner Tessmann, DOB 2001-09-24, squad checked 2026-10-20T13:40:08.759+00:00. Photo now https://media.api-sports.io/football/players/80752.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 18, "name": "Tanner Tessmann", "slug": "tanner-tessmann", "position": "MF", "category": "fringe", "club": "Lyon", "photo_url": "https://media.api-sports.io/football/players/80752.png", "age": 25, "contract_until": "2027-06-30", "market_value_usd": 8000000, "national_team_caps": 14, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2022-06-05", "potential_call_up_score": 41, "bio": "A physically imposing midfield anchor who has settled into Serie A quicker than expected after his move from MLS.", "world_cup_roster": false, "api_football_player_id": 80752, "wikipedia_title": "Tanner Tessmann", "date_of_birth": "2001-09-24", "squad_last_checked_at": "2026-10-20T13:40:08.759+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 19 | Cavan Sullivan<br>`cavan-sullivan` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Cavan Sullivan", "slug": "cavan-sullivan", "position": "FW", "category": "prospect", "club": "Philadelphia Union", "contract_until": "2029-12-31", "market_value_usd": 3000000, "youth_national_team": "U-17", "debut_date": "2024-05-18", "bio": "The youngest player ever to appear in MLS, Sullivan's blistering acceleration and finishing instincts have scouts across Europe circling.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 15 → 17; national_team_caps: 0 → 3; national_team_goals: 0 → 1; potential_call_up_score: 34 → 70.<br>**Likely** partial live refresh: provider player ID 462853, Wikipedia Cavan Sullivan, DOB 2009-09-28, squad checked 2026-10-20T16:31:48.123+00:00. Photo now https://media.api-sports.io/football/players/462853.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 19, "name": "Cavan Sullivan", "slug": "cavan-sullivan", "position": "FW", "category": "prospect", "club": "Philadelphia Union", "photo_url": "https://media.api-sports.io/football/players/462853.png", "age": 17, "contract_until": "2029-12-31", "market_value_usd": 3000000, "national_team_caps": 3, "national_team_goals": 1, "youth_national_team": "U-17", "debut_date": "2024-05-18", "potential_call_up_score": 70, "bio": "The youngest player ever to appear in MLS, Sullivan's blistering acceleration and finishing instincts have scouts across Europe circling.", "world_cup_roster": false, "api_football_player_id": 462853, "wikipedia_title": "Cavan Sullivan", "date_of_birth": "2009-09-28", "squad_last_checked_at": "2026-10-20T16:31:48.123+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 20 | Diego Kochen<br>`diego-kochen` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Diego Kochen", "slug": "diego-kochen", "position": "GK", "category": "prospect", "contract_until": "2027-06-30", "market_value_usd": 2500000, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "bio": "A towering, composed shot-stopper progressing through Barcelona's famed academy pipeline, tipped as the long-term successor between the posts.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: FC Barcelona → Lyngby Boldklub; age: 18 → 20; national_team_caps: 0 → 4; potential_call_up_score: 22 → 31.<br>**Likely** partial live refresh: provider player ID 383647, Wikipedia Diego Kochen, DOB 2006-03-19, squad checked 2026-10-20T13:39:06.659+00:00. Photo now https://media.api-sports.io/football/players/383647.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 20, "name": "Diego Kochen", "slug": "diego-kochen", "position": "GK", "category": "prospect", "club": "Lyngby Boldklub", "photo_url": "https://media.api-sports.io/football/players/383647.png", "age": 20, "contract_until": "2027-06-30", "market_value_usd": 2500000, "national_team_caps": 4, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 31, "bio": "A towering, composed shot-stopper progressing through Barcelona's famed academy pipeline, tipped as the long-term successor between the posts.", "world_cup_roster": false, "api_football_player_id": 383647, "wikipedia_title": "Diego Kochen", "date_of_birth": "2006-03-19", "squad_last_checked_at": "2026-10-20T13:39:06.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 21 | Benjamin Cremaschi<br>`benjamin-cremaschi` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Benjamin Cremaschi", "slug": "benjamin-cremaschi", "position": "MF", "category": "prospect", "contract_until": "2027-12-31", "market_value_usd": 4000000, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2024-01-18", "bio": "A composed deep-lying playmaker who has thrived alongside Messi and Busquets at Inter Miami, dictating tempo well beyond his years.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Inter Miami CF → Parma; age: 20 → 21; national_team_caps: 2 → 3; potential_call_up_score: 41 → 34.<br>**Likely** partial live refresh: provider player ID 362061, Wikipedia Benjamin Cremaschi, DOB 2005-03-02, squad checked 2026-10-20T13:42:06.759+00:00. Photo now https://media.api-sports.io/football/players/362061.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 21, "name": "Benjamin Cremaschi", "slug": "benjamin-cremaschi", "position": "MF", "category": "prospect", "club": "Parma", "photo_url": "https://media.api-sports.io/football/players/362061.png", "age": 21, "contract_until": "2027-12-31", "market_value_usd": 4000000, "national_team_caps": 3, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2024-01-18", "potential_call_up_score": 34, "bio": "A composed deep-lying playmaker who has thrived alongside Messi and Busquets at Inter Miami, dictating tempo well beyond his years.", "world_cup_roster": false, "api_football_player_id": 362061, "wikipedia_title": "Benjamin Cremaschi", "date_of_birth": "2005-03-02", "squad_last_checked_at": "2026-10-20T13:42:06.759+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 22 | Noel Buck<br>`noel-buck` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Noel Buck", "slug": "noel-buck", "position": "MF", "category": "prospect", "club": "San Jose Earthquakes", "contract_until": "2027-12-31", "market_value_usd": 2000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "bio": "A tall, combative midfielder who has bounced between MLS and a Southampton loan spell, admired for his range of passing and tackling numbers.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 20 → 21; potential_call_up_score: 24 → 33.<br>**Likely** partial live refresh: provider player ID 310566, Wikipedia NULL, DOB 2005-04-05, squad checked 2026-10-20T13:39:56.659+00:00. Photo now https://media.api-sports.io/football/players/310566.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 22, "name": "Noel Buck", "slug": "noel-buck", "position": "MF", "category": "prospect", "club": "San Jose Earthquakes", "photo_url": "https://media.api-sports.io/football/players/310566.png", "age": 21, "contract_until": "2027-12-31", "market_value_usd": 2000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 33, "bio": "A tall, combative midfielder who has bounced between MLS and a Southampton loan spell, admired for his range of passing and tackling numbers.", "world_cup_roster": false, "api_football_player_id": 310566, "wikipedia_title": null, "date_of_birth": "2005-04-05", "squad_last_checked_at": "2026-10-20T13:39:56.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 24 | Nimfasha Berchimas<br>`nimfasha-berchimas` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Nimfasha Berchimas", "slug": "nimfasha-berchimas", "position": "DF", "category": "prospect", "contract_until": "2026-12-31", "market_value_usd": 1200000, "youth_national_team": "U-20", "debut_date": "2024-08-24", "bio": "An athletic, ball-playing center-back prospect who has forced his way into New England's first team ahead of schedule.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: New England Revolution → Charlotte FC; age: 19 → 18; national_team_caps: 0 → 5; national_team_goals: 0 → 1; potential_call_up_score: 19 → 40.<br>**Likely** partial live refresh: provider player ID 401644, Wikipedia Nimfasha Berchimas, DOB 2008-02-22, squad checked 2026-10-20T13:40:54.659+00:00. Photo now https://media.api-sports.io/football/players/401644.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 24, "name": "Nimfasha Berchimas", "slug": "nimfasha-berchimas", "position": "DF", "category": "prospect", "club": "Charlotte FC", "photo_url": "https://media.api-sports.io/football/players/401644.png", "age": 18, "contract_until": "2026-12-31", "market_value_usd": 1200000, "national_team_caps": 5, "national_team_goals": 1, "youth_national_team": "U-20", "debut_date": "2024-08-24", "potential_call_up_score": 40, "bio": "An athletic, ball-playing center-back prospect who has forced his way into New England's first team ahead of schedule.", "world_cup_roster": false, "api_football_player_id": 401644, "wikipedia_title": "Nimfasha Berchimas", "date_of_birth": "2008-02-22", "squad_last_checked_at": "2026-10-20T13:40:54.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 25 | Mathis Albert<br>`mathis-albert` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Mathis Albert", "slug": "mathis-albert", "position": "FW", "category": "prospect", "club": "Borussia Dortmund", "age": 17, "contract_until": "2028-06-30", "market_value_usd": 8000000, "youth_national_team": "U-20", "debut_date": null, "bio": "A dazzling dribbler who left the LA Galaxy academy for Dortmund and became the youngest American to play in the Bundesliga, already drawing senior-team buzz.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 0 → 4; national_team_goals: 0 → 1; potential_call_up_score: 44 → 45.<br>**Likely** partial live refresh: provider player ID 486522, Wikipedia Mathis Albert, DOB 2009-05-21, squad checked 2026-10-20T16:30:18.323+00:00. Photo now https://media.api-sports.io/football/players/486522.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 25, "name": "Mathis Albert", "slug": "mathis-albert", "position": "FW", "category": "prospect", "club": "Borussia Dortmund", "photo_url": "https://media.api-sports.io/football/players/486522.png", "age": 17, "contract_until": "2028-06-30", "market_value_usd": 8000000, "national_team_caps": 4, "national_team_goals": 1, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 45, "bio": "A dazzling dribbler who left the LA Galaxy academy for Dortmund and became the youngest American to play in the Bundesliga, already drawing senior-team buzz.", "world_cup_roster": false, "api_football_player_id": 486522, "wikipedia_title": "Mathis Albert", "date_of_birth": "2009-05-21", "squad_last_checked_at": "2026-10-20T16:30:18.323+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 27 | Leonard Prescott<br>`leonard-prescott` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Leonard Prescott", "slug": "leonard-prescott", "position": "GK", "category": "prospect", "club": "Bayern Munich", "age": 16, "contract_until": "2027-06-30", "market_value_usd": 2200000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": null, "debut_date": null, "bio": "Born in New York but raised in Germany's academy system, Prescott became one of the youngest goalkeepers to warm up for a Bayern Champions League matchday — a long-shot dual-national target for U.S. Soccer.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: potential_call_up_score: 15 → 51.<br>**Likely** partial live refresh: provider player ID 155731, Wikipedia NULL, DOB NULL, squad checked 2026-08-05T14:06:58.729+00:00. Photo now https://media.api-sports.io/football/players/155731.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 27, "name": "Leonard Prescott", "slug": "leonard-prescott", "position": "GK", "category": "prospect", "club": "Bayern Munich", "photo_url": "https://media.api-sports.io/football/players/155731.png", "age": 16, "contract_until": "2027-06-30", "market_value_usd": 2200000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": null, "debut_date": null, "potential_call_up_score": 51, "bio": "Born in New York but raised in Germany's academy system, Prescott became one of the youngest goalkeepers to warm up for a Bayern Champions League matchday — a long-shot dual-national target for U.S. Soccer.", "world_cup_roster": false, "api_football_player_id": 155731, "wikipedia_title": null, "date_of_birth": null, "squad_last_checked_at": "2026-08-05T14:06:58.729+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 28 | Zavier Gozo<br>`zavier-gozo` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Zavier Gozo", "slug": "zavier-gozo", "position": "FW", "category": "prospect", "age": 19, "contract_until": "2027-12-31", "market_value_usd": 1500000, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2026-05-02", "bio": "A direct, two-footed winger who forced his way into Real Salt Lake's first team and has scouts talking about a very bright USMNT future.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Real Salt Lake → Crystal Palace; national_team_caps: 0 → 1; potential_call_up_score: 27 → 23.<br>**Likely** partial live refresh: provider player ID 412227, Wikipedia Zavier Gozo, DOB 2007-03-22, squad checked 2026-10-20T13:40:02.659+00:00. Photo now https://media.api-sports.io/football/players/412227.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 28, "name": "Zavier Gozo", "slug": "zavier-gozo", "position": "FW", "category": "prospect", "club": "Crystal Palace", "photo_url": "https://media.api-sports.io/football/players/412227.png", "age": 19, "contract_until": "2027-12-31", "market_value_usd": 1500000, "national_team_caps": 1, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2026-05-02", "potential_call_up_score": 23, "bio": "A direct, two-footed winger who forced his way into Real Salt Lake's first team and has scouts talking about a very bright USMNT future.", "world_cup_roster": false, "api_football_player_id": 412227, "wikipedia_title": "Zavier Gozo", "date_of_birth": "2007-03-22", "squad_last_checked_at": "2026-10-20T13:40:02.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 29 | Chris Brady<br>`chris-brady` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Chris Brady", "slug": "chris-brady", "position": "GK", "category": "current", "club": "Chicago Fire", "contract_until": "2027-12-31", "market_value_usd": 4000000, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2026-03-22", "bio": "Chicago Fire's homegrown shot-stopper earned his senior debut in a World Cup warmup win over Senegal, giving Pochettino a genuine long-term option between the posts.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 24 → 22; national_team_caps: 1 → 2; potential_call_up_score: NULL → 68.<br>**Likely** partial live refresh: provider player ID 266606, Wikipedia Chris Brady (soccer), DOB 2004-03-03, squad checked 2026-10-20T13:42:18.659+00:00. Photo now https://media.api-sports.io/football/players/266606.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 29, "name": "Chris Brady", "slug": "chris-brady", "position": "GK", "category": "current", "club": "Chicago Fire", "photo_url": "https://media.api-sports.io/football/players/266606.png", "age": 22, "contract_until": "2027-12-31", "market_value_usd": 4000000, "national_team_caps": 2, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2026-03-22", "potential_call_up_score": 68, "bio": "Chicago Fire's homegrown shot-stopper earned his senior debut in a World Cup warmup win over Senegal, giving Pochettino a genuine long-term option between the posts.", "world_cup_roster": true, "api_football_player_id": 266606, "wikipedia_title": "Chris Brady (soccer)", "date_of_birth": "2004-03-03", "squad_last_checked_at": "2026-10-20T13:42:18.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 30 | Matt Freese<br>`matt-freese` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Matt Freese", "slug": "matt-freese", "position": "GK", "category": "current", "club": "New York City FC", "age": 28, "contract_until": "2027-12-31", "market_value_usd": 5000000, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2024-06-08", "bio": "An analytically minded shot-stopper who climbed from third-string to the World Cup roster on the back of standout distribution and shot-stopping numbers at NYCFC.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 14 → 20; potential_call_up_score: NULL → 51.<br>**Likely** partial live refresh: provider player ID 50728, Wikipedia Matt Freese, DOB 1998-09-02, squad checked 2026-10-20T13:40:10.659+00:00. Photo now https://media.api-sports.io/football/players/50728.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 30, "name": "Matt Freese", "slug": "matt-freese", "position": "GK", "category": "current", "club": "New York City FC", "photo_url": "https://media.api-sports.io/football/players/50728.png", "age": 28, "contract_until": "2027-12-31", "market_value_usd": 5000000, "national_team_caps": 20, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2024-06-08", "potential_call_up_score": 51, "bio": "An analytically minded shot-stopper who climbed from third-string to the World Cup roster on the back of standout distribution and shot-stopping numbers at NYCFC.", "world_cup_roster": true, "api_football_player_id": 50728, "wikipedia_title": "Matt Freese", "date_of_birth": "1998-09-02", "squad_last_checked_at": "2026-10-20T13:40:10.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 31 | Max Arfsten<br>`max-arfsten` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Max Arfsten", "slug": "max-arfsten", "position": "DF", "category": "current", "contract_until": "2028-12-31", "market_value_usd": 6000000, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2024-06-05", "bio": "A left-back who doubles as an attacking outlet, Arfsten's overlapping runs for the Crew translated quickly into a regular seat in the senior player pool.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Columbus Crew → Middlesbrough; age: 26 → 25; national_team_caps: 18 → 21; potential_call_up_score: NULL → 40.<br>**Likely** partial live refresh: provider player ID 362400, Wikipedia Max Arfsten, DOB 2001-04-19, squad checked 2026-10-20T13:41:04.659+00:00. Photo now https://media.api-sports.io/football/players/362400.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 31, "name": "Max Arfsten", "slug": "max-arfsten", "position": "DF", "category": "current", "club": "Middlesbrough", "photo_url": "https://media.api-sports.io/football/players/362400.png", "age": 25, "contract_until": "2028-12-31", "market_value_usd": 6000000, "national_team_caps": 21, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2024-06-05", "potential_call_up_score": 40, "bio": "A left-back who doubles as an attacking outlet, Arfsten's overlapping runs for the Crew translated quickly into a regular seat in the senior player pool.", "world_cup_roster": true, "api_football_player_id": 362400, "wikipedia_title": "Max Arfsten", "date_of_birth": "2001-04-19", "squad_last_checked_at": "2026-10-20T13:41:04.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 32 | Alex Freeman<br>`alex-freeman` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Alex Freeman", "slug": "alex-freeman", "position": "DF", "category": "current", "club": "Villarreal", "contract_until": "2029-06-30", "market_value_usd": 14000000, "youth_national_team": "U-20", "debut_date": "2025-06-01", "bio": "After arguably the best fullback season MLS has produced in over a decade, Freeman jumped straight to Villarreal and into the World Cup squad within a year of his pro debut.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 21 → 22; national_team_caps: 15 → 26; national_team_goals: 2 → 3; potential_call_up_score: NULL → 58.<br>**Likely** partial live refresh: provider player ID 355994, Wikipedia Alex Freeman, DOB 2004-08-09, squad checked 2026-10-20T13:40:26.802+00:00. Photo now https://media.api-sports.io/football/players/355994.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 32, "name": "Alex Freeman", "slug": "alex-freeman", "position": "DF", "category": "current", "club": "Villarreal", "photo_url": "https://media.api-sports.io/football/players/355994.png", "age": 22, "contract_until": "2029-06-30", "market_value_usd": 14000000, "national_team_caps": 26, "national_team_goals": 3, "youth_national_team": "U-20", "debut_date": "2025-06-01", "potential_call_up_score": 58, "bio": "After arguably the best fullback season MLS has produced in over a decade, Freeman jumped straight to Villarreal and into the World Cup squad within a year of his pro debut.", "world_cup_roster": true, "api_football_player_id": 355994, "wikipedia_title": "Alex Freeman", "date_of_birth": "2004-08-09", "squad_last_checked_at": "2026-10-20T13:40:26.802+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 33 | Mark McKenzie<br>`mark-mckenzie` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Mark McKenzie", "slug": "mark-mckenzie", "position": "DF", "category": "current", "club": "Toulouse", "contract_until": "2027-06-30", "market_value_usd": 9000000, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2020-09-03", "potential_call_up_score": null, "bio": "A composed center-back who has bounced between Genk and Ligue 1, valued for his passing range and reliability as senior center-back depth.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 26 → 27; national_team_caps: 27 → 30.<br>**Likely** partial live refresh: provider player ID 50735, Wikipedia Mark McKenzie (soccer, born 1999), DOB 1999-02-25, squad checked 2026-10-20T16:32:13.256+00:00. Photo now https://media.api-sports.io/football/players/50735.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 33, "name": "Mark McKenzie", "slug": "mark-mckenzie", "position": "DF", "category": "current", "club": "Toulouse", "photo_url": "https://media.api-sports.io/football/players/50735.png", "age": 27, "contract_until": "2027-06-30", "market_value_usd": 9000000, "national_team_caps": 30, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2020-09-03", "potential_call_up_score": null, "bio": "A composed center-back who has bounced between Genk and Ligue 1, valued for his passing range and reliability as senior center-back depth.", "world_cup_roster": true, "api_football_player_id": 50735, "wikipedia_title": "Mark McKenzie (soccer, born 1999)", "date_of_birth": "1999-02-25", "squad_last_checked_at": "2026-10-20T16:32:13.256+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 34 | Tim Ream<br>`tim-ream` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Tim Ream", "slug": "tim-ream", "position": "DF", "category": "current", "club": "Charlotte FC", "contract_until": "2026-12-31", "market_value_usd": 1500000, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2010-01-24", "potential_call_up_score": null, "bio": "The elder statesman of the backline, Ream's reading of the game has kept him a starting center-back into his late 30s, with a shot at being the oldest man to play a U.S. World Cup match.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 38 → 39; national_team_caps: 80 → 86.<br>**Likely** partial live refresh: provider player ID 19023, Wikipedia Tim Ream, DOB 1987-10-05, squad checked 2026-10-20T13:40:04.606+00:00. Photo now https://media.api-sports.io/football/players/19023.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 34, "name": "Tim Ream", "slug": "tim-ream", "position": "DF", "category": "current", "club": "Charlotte FC", "photo_url": "https://media.api-sports.io/football/players/19023.png", "age": 39, "contract_until": "2026-12-31", "market_value_usd": 1500000, "national_team_caps": 86, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2010-01-24", "potential_call_up_score": null, "bio": "The elder statesman of the backline, Ream's reading of the game has kept him a starting center-back into his late 30s, with a shot at being the oldest man to play a U.S. World Cup match.", "world_cup_roster": true, "api_football_player_id": 19023, "wikipedia_title": "Tim Ream", "date_of_birth": "1987-10-05", "squad_last_checked_at": "2026-10-20T13:40:04.606+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 35 | Miles Robinson<br>`miles-robinson` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Miles Robinson", "slug": "miles-robinson", "position": "DF", "category": "current", "club": "FC Cincinnati", "age": 29, "contract_until": "2027-12-31", "market_value_usd": 7000000, "national_team_goals": 3, "youth_national_team": null, "debut_date": "2018-01-28", "potential_call_up_score": null, "bio": "An Achilles tear cost him the 2022 World Cup; a return to form with Cincinnati has finally delivered the World Cup appearance that injury once denied him.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 38 → 42.<br>**Likely** partial live refresh: provider player ID 50879, Wikipedia Miles Robinson (soccer), DOB 1997-03-14, squad checked 2026-10-20T13:39:14.603+00:00. Photo now https://media.api-sports.io/football/players/50879.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 35, "name": "Miles Robinson", "slug": "miles-robinson", "position": "DF", "category": "current", "club": "FC Cincinnati", "photo_url": "https://media.api-sports.io/football/players/50879.png", "age": 29, "contract_until": "2027-12-31", "market_value_usd": 7000000, "national_team_caps": 42, "national_team_goals": 3, "youth_national_team": null, "debut_date": "2018-01-28", "potential_call_up_score": null, "bio": "An Achilles tear cost him the 2022 World Cup; a return to form with Cincinnati has finally delivered the World Cup appearance that injury once denied him.", "world_cup_roster": true, "api_football_player_id": 50879, "wikipedia_title": "Miles Robinson (soccer)", "date_of_birth": "1997-03-14", "squad_last_checked_at": "2026-10-20T13:39:14.603+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 36 | Joe Scally<br>`joe-scally` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Joe Scally", "slug": "joe-scally", "position": "DF", "category": "current", "club": "Borussia Monchengladbach", "age": 23, "contract_until": "2027-06-30", "market_value_usd": 12000000, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2021-11-14", "bio": "A durable, tactically versatile right-back who has quietly logged four full Bundesliga seasons in Germany and edged out the midfield competition for a World Cup roster spot.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 24 → 28; potential_call_up_score: NULL → 56.<br>**Likely** partial live refresh: provider player ID 50852, Wikipedia Joe Scally, DOB 2002-12-31, squad checked 2026-10-20T16:31:59.424+00:00. Photo now https://media.api-sports.io/football/players/50852.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 36, "name": "Joe Scally", "slug": "joe-scally", "position": "DF", "category": "current", "club": "Borussia Monchengladbach", "photo_url": "https://media.api-sports.io/football/players/50852.png", "age": 23, "contract_until": "2027-06-30", "market_value_usd": 12000000, "national_team_caps": 28, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2021-11-14", "potential_call_up_score": 56, "bio": "A durable, tactically versatile right-back who has quietly logged four full Bundesliga seasons in Germany and edged out the midfield competition for a World Cup roster spot.", "world_cup_roster": true, "api_football_player_id": 50852, "wikipedia_title": "Joe Scally", "date_of_birth": "2002-12-31", "squad_last_checked_at": "2026-10-20T16:31:59.424+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 37 | Auston Trusty<br>`auston-trusty` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Auston Trusty", "slug": "auston-trusty", "position": "DF", "category": "current", "club": "Celtic", "contract_until": "2028-06-30", "market_value_usd": 8000000, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2024-09-10", "bio": "A center-back who scored on his first senior start, Trusty has become a trusted squad piece at Celtic and the biggest riser in the USMNT defensive pool this cycle.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 26 → 28; national_team_caps: 6 → 14; potential_call_up_score: NULL → 46.<br>**Likely** partial live refresh: provider player ID 50737, Wikipedia Auston Trusty, DOB 1998-08-12, squad checked 2026-10-20T13:42:24.659+00:00. Photo now https://media.api-sports.io/football/players/50737.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 37, "name": "Auston Trusty", "slug": "auston-trusty", "position": "DF", "category": "current", "club": "Celtic", "photo_url": "https://media.api-sports.io/football/players/50737.png", "age": 28, "contract_until": "2028-06-30", "market_value_usd": 8000000, "national_team_caps": 14, "national_team_goals": 1, "youth_national_team": null, "debut_date": "2024-09-10", "potential_call_up_score": 46, "bio": "A center-back who scored on his first senior start, Trusty has become a trusted squad piece at Celtic and the biggest riser in the USMNT defensive pool this cycle.", "world_cup_roster": true, "api_football_player_id": 50737, "wikipedia_title": "Auston Trusty", "date_of_birth": "1998-08-12", "squad_last_checked_at": "2026-10-20T13:42:24.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 38 | Sebastian Berhalter<br>`sebastian-berhalter` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Sebastian Berhalter", "slug": "sebastian-berhalter", "position": "MF", "category": "current", "contract_until": "2027-12-31", "market_value_usd": 3500000, "youth_national_team": "U-20", "debut_date": "2024-01-18", "bio": "The son of former USMNT coach Gregg Berhalter, Sebastian earned his own World Cup spot as a tidy, defensively disciplined depth midfielder for Vancouver.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Vancouver Whitecaps → Middlesbrough; age: 24 → 25; national_team_caps: 11 → 22; national_team_goals: 1 → 4; potential_call_up_score: NULL → 39.<br>**Likely** partial live refresh: provider player ID 201713, Wikipedia Sebastian Berhalter, DOB 2001-05-10, squad checked 2026-10-20T13:40:44.659+00:00. Photo now https://media.api-sports.io/football/players/201713.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 38, "name": "Sebastian Berhalter", "slug": "sebastian-berhalter", "position": "MF", "category": "current", "club": "Middlesbrough", "photo_url": "https://media.api-sports.io/football/players/201713.png", "age": 25, "contract_until": "2027-12-31", "market_value_usd": 3500000, "national_team_caps": 22, "national_team_goals": 4, "youth_national_team": "U-20", "debut_date": "2024-01-18", "potential_call_up_score": 39, "bio": "The son of former USMNT coach Gregg Berhalter, Sebastian earned his own World Cup spot as a tidy, defensively disciplined depth midfielder for Vancouver.", "world_cup_roster": true, "api_football_player_id": 201713, "wikipedia_title": "Sebastian Berhalter", "date_of_birth": "2001-05-10", "squad_last_checked_at": "2026-10-20T13:40:44.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 39 | Cristian Roldan<br>`cristian-roldan` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Cristian Roldan", "slug": "cristian-roldan", "position": "MF", "category": "current", "club": "Seattle Sounders FC", "age": 31, "contract_until": "2026-12-31", "market_value_usd": 2500000, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2021-06-06", "potential_call_up_score": null, "bio": "A long-time MLS mainstay whose two-way work rate and locker-room leadership earned him a surprise return to the senior fold for a home World Cup.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 45 → 47.<br>**Likely** partial live refresh: provider player ID 51114, Wikipedia Cristian Roldan, DOB 1995-06-03, squad checked 2026-10-20T13:39:44.659+00:00. Photo now https://media.api-sports.io/football/players/51114.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 39, "name": "Cristian Roldan", "slug": "cristian-roldan", "position": "MF", "category": "current", "club": "Seattle Sounders FC", "photo_url": "https://media.api-sports.io/football/players/51114.png", "age": 31, "contract_until": "2026-12-31", "market_value_usd": 2500000, "national_team_caps": 47, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2021-06-06", "potential_call_up_score": null, "bio": "A long-time MLS mainstay whose two-way work rate and locker-room leadership earned him a surprise return to the senior fold for a home World Cup.", "world_cup_roster": true, "api_football_player_id": 51114, "wikipedia_title": "Cristian Roldan", "date_of_birth": "1995-06-03", "squad_last_checked_at": "2026-10-20T13:39:44.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 40 | Brenden Aaronson<br>`brenden-aaronson` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, potential_call_up_score, bio, world_cup_roster. **Exact retained seed values** { "name": "Brenden Aaronson", "slug": "brenden-aaronson", "position": "MF", "category": "current", "age": 25, "contract_until": "2028-06-30", "market_value_usd": 16000000, "national_team_goals": 9, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "Paxten's older brother has rediscovered his best form back in the Premier League with Leeds, pressing relentlessly and chipping in with regular goals.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Leeds United → Leeds; national_team_caps: 57 → 61.<br>**Likely** partial live refresh: provider player ID 50739, Wikipedia Brenden Aaronson, DOB 2000-10-22, squad checked 2026-10-20T13:41:02.689+00:00. Photo now https://media.api-sports.io/football/players/50739.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 40, "name": "Brenden Aaronson", "slug": "brenden-aaronson", "position": "MF", "category": "current", "club": "Leeds", "photo_url": "https://media.api-sports.io/football/players/50739.png", "age": 25, "contract_until": "2028-06-30", "market_value_usd": 16000000, "national_team_caps": 61, "national_team_goals": 9, "youth_national_team": null, "debut_date": "2021-01-31", "potential_call_up_score": null, "bio": "Paxten's older brother has rediscovered his best form back in the Premier League with Leeds, pressing relentlessly and chipping in with regular goals.", "world_cup_roster": true, "api_football_player_id": 50739, "wikipedia_title": "Brenden Aaronson", "date_of_birth": "2000-10-22", "squad_last_checked_at": "2026-10-20T13:41:02.689+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 41 | Alejandro Zendejas<br>`alejandro-zendejas` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Alejandro Zendejas", "slug": "alejandro-zendejas", "position": "FW", "category": "current", "club": "Club America", "age": 28, "contract_until": "2027-12-31", "market_value_usd": 9000000, "national_team_goals": 2, "youth_national_team": null, "debut_date": "2023-03-27", "bio": "A dual national who chose the U.S. over Mexico, Zendejas brings Liga MX-honed dribbling and end product off the wing as a genuine World Cup squad player.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 13 → 15; potential_call_up_score: NULL → 39.<br>**Likely** partial live refresh: provider player ID 35885, Wikipedia Alejandro Zendejas, DOB 1998-02-07, squad checked 2026-10-20T13:39:40.659+00:00. Photo now https://media.api-sports.io/football/players/35885.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 41, "name": "Alejandro Zendejas", "slug": "alejandro-zendejas", "position": "FW", "category": "current", "club": "Club America", "photo_url": "https://media.api-sports.io/football/players/35885.png", "age": 28, "contract_until": "2027-12-31", "market_value_usd": 9000000, "national_team_caps": 15, "national_team_goals": 2, "youth_national_team": null, "debut_date": "2023-03-27", "potential_call_up_score": 39, "bio": "A dual national who chose the U.S. over Mexico, Zendejas brings Liga MX-honed dribbling and end product off the wing as a genuine World Cup squad player.", "world_cup_roster": true, "api_football_player_id": 35885, "wikipedia_title": "Alejandro Zendejas", "date_of_birth": "1998-02-07", "squad_last_checked_at": "2026-10-20T13:39:40.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 42 | Haji Wright<br>`haji-wright` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Haji Wright", "slug": "haji-wright", "position": "FW", "category": "current", "age": 28, "contract_until": "2027-06-30", "market_value_usd": 11000000, "national_team_goals": 7, "youth_national_team": null, "debut_date": "2022-06-05", "bio": "The 2022 World Cup breakout striker rebuilt his career in England's Championship, scoring 17 goals to help Coventry reach the Premier League and reclaim his World Cup spot.", "world_cup_roster": true } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Coventry City → Coventry; national_team_caps: 20 → 24; potential_call_up_score: NULL → 59.<br>**Likely** partial live refresh: provider player ID 427, Wikipedia Haji Wright, DOB 1998-03-27, squad checked 2026-10-20T13:42:14.659+00:00. Photo now https://media.api-sports.io/football/players/427.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 42, "name": "Haji Wright", "slug": "haji-wright", "position": "FW", "category": "current", "club": "Coventry", "photo_url": "https://media.api-sports.io/football/players/427.png", "age": 28, "contract_until": "2027-06-30", "market_value_usd": 11000000, "national_team_caps": 24, "national_team_goals": 7, "youth_national_team": null, "debut_date": "2022-06-05", "potential_call_up_score": 59, "bio": "The 2022 World Cup breakout striker rebuilt his career in England's Championship, scoring 17 goals to help Coventry reach the Premier League and reclaim his World Cup spot.", "world_cup_roster": true, "api_football_player_id": 427, "wikipedia_title": "Haji Wright", "date_of_birth": "1998-03-27", "squad_last_checked_at": "2026-10-20T13:42:14.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 43 | Diego Luna<br>`diego-luna` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Diego Luna", "slug": "diego-luna", "position": "MF", "category": "fringe", "club": "Real Salt Lake", "contract_until": "2027-12-31", "market_value_usd": 7000000, "youth_national_team": "U-20", "debut_date": "2024-06-05", "bio": "A shifty, left-footed creator who broke through at the 2025 Gold Cup, Luna has been a Pochettino favorite for well over a year despite missing out on the final 26.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 22 → 23; national_team_caps: 9 → 18; national_team_goals: 1 → 4; potential_call_up_score: 68 → 31.<br>**Likely** partial live refresh: provider player ID 312896, Wikipedia Diego Luna (soccer, born 2003), DOB 2003-09-07, squad checked 2026-10-20T13:38:56.159+00:00. Photo now https://media.api-sports.io/football/players/312896.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 43, "name": "Diego Luna", "slug": "diego-luna", "position": "MF", "category": "fringe", "club": "Real Salt Lake", "photo_url": "https://media.api-sports.io/football/players/312896.png", "age": 23, "contract_until": "2027-12-31", "market_value_usd": 7000000, "national_team_caps": 18, "national_team_goals": 4, "youth_national_team": "U-20", "debut_date": "2024-06-05", "potential_call_up_score": 31, "bio": "A shifty, left-footed creator who broke through at the 2025 Gold Cup, Luna has been a Pochettino favorite for well over a year despite missing out on the final 26.", "world_cup_roster": false, "api_football_player_id": 312896, "wikipedia_title": "Diego Luna (soccer, born 2003)", "date_of_birth": "2003-09-07", "squad_last_checked_at": "2026-10-20T13:38:56.159+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 44 | Gaga Slonina<br>`gaga-slonina` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Gaga Slonina", "slug": "gaga-slonina", "position": "GK", "category": "fringe", "club": "Chelsea", "age": 22, "contract_until": "2028-06-30", "market_value_usd": 5000000, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2023-01-25", "bio": "A Chicago Fire academy product turned Chelsea goalkeeper, Slonina's loan spells have been about accumulating minutes while he waits behind the senior pecking order.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 2 → 1; potential_call_up_score: 44 → 54.<br>**Likely** partial live refresh: provider player ID 201711, Wikipedia Gabriel Slonina, DOB NULL, squad checked 2026-08-05T14:05:03.706+00:00. Photo now https://media.api-sports.io/football/players/201711.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 44, "name": "Gaga Slonina", "slug": "gaga-slonina", "position": "GK", "category": "fringe", "club": "Chelsea", "photo_url": "https://media.api-sports.io/football/players/201711.png", "age": 22, "contract_until": "2028-06-30", "market_value_usd": 5000000, "national_team_caps": 1, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2023-01-25", "potential_call_up_score": 54, "bio": "A Chicago Fire academy product turned Chelsea goalkeeper, Slonina's loan spells have been about accumulating minutes while he waits behind the senior pecking order.", "world_cup_roster": false, "api_football_player_id": 201711, "wikipedia_title": "Gabriel Slonina", "date_of_birth": null, "squad_last_checked_at": "2026-08-05T14:05:03.706+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 45 | Caleb Wiley<br>`caleb-wiley` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Caleb Wiley", "slug": "caleb-wiley", "position": "DF", "category": "fringe", "age": 21, "contract_until": "2029-06-30", "market_value_usd": 10000000, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2023-09-09", "bio": "An attacking left-back who made the jump from Atlanta United to Chelsea as a teenager, Wiley's development has stalled amid loan spells but he remains firmly in the senior picture.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Chelsea → Preston; national_team_caps: 8 → 3; potential_call_up_score: 47 → 45.<br>**Likely** partial live refresh: provider player ID 265733, Wikipedia Caleb Wiley, DOB 2004-12-22, squad checked 2026-10-20T13:40:20.659+00:00. Photo now https://media.api-sports.io/football/players/265733.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 45, "name": "Caleb Wiley", "slug": "caleb-wiley", "position": "DF", "category": "fringe", "club": "Preston", "photo_url": "https://media.api-sports.io/football/players/265733.png", "age": 21, "contract_until": "2029-06-30", "market_value_usd": 10000000, "national_team_caps": 3, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2023-09-09", "potential_call_up_score": 45, "bio": "An attacking left-back who made the jump from Atlanta United to Chelsea as a teenager, Wiley's development has stalled amid loan spells but he remains firmly in the senior picture.", "world_cup_roster": false, "api_football_player_id": 265733, "wikipedia_title": "Caleb Wiley", "date_of_birth": "2004-12-22", "squad_last_checked_at": "2026-10-20T13:40:20.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 46 | Damion Downs<br>`damion-downs` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Damion Downs", "slug": "damion-downs", "position": "FW", "category": "fringe", "contract_until": "2027-06-30", "market_value_usd": 6000000, "youth_national_team": "U-23", "debut_date": "2024-09-10", "bio": "A physical target man who impressed at the 2025 Gold Cup, Downs is rebuilding minutes on loan in the Bundesliga after a quiet spell at Southampton.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Hamburger SV → St. Louis City; age: 21 → 22; national_team_caps: 6 → 7; national_team_goals: 2 → 0; potential_call_up_score: 45 → 36.<br>**Likely** partial live refresh: provider player ID 334362, Wikipedia Damion Downs, DOB 2004-07-06, squad checked 2026-10-20T13:40:00.759+00:00. Photo now https://media.api-sports.io/football/players/334362.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 46, "name": "Damion Downs", "slug": "damion-downs", "position": "FW", "category": "fringe", "club": "St. Louis City", "photo_url": "https://media.api-sports.io/football/players/334362.png", "age": 22, "contract_until": "2027-06-30", "market_value_usd": 6000000, "national_team_caps": 7, "national_team_goals": 0, "youth_national_team": "U-23", "debut_date": "2024-09-10", "potential_call_up_score": 36, "bio": "A physical target man who impressed at the 2025 Gold Cup, Downs is rebuilding minutes on loan in the Bundesliga after a quiet spell at Southampton.", "world_cup_roster": false, "api_football_player_id": 334362, "wikipedia_title": "Damion Downs", "date_of_birth": "2004-07-06", "squad_last_checked_at": "2026-10-20T13:40:00.759+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 47 | Cole Campbell<br>`cole-campbell` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, age, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Cole Campbell", "slug": "cole-campbell", "position": "MF", "category": "prospect", "club": "SV Elversberg", "age": 20, "contract_until": "2030-06-30", "market_value_usd": 4000000, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "bio": "A Texas-born dual national (US/Iceland) who left Borussia Dortmund's academy for a permanent move to Bundesliga newcomer Elversberg, chasing first-team minutes and a senior call-up.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: national_team_caps: 0 → 1; potential_call_up_score: 36 → 42.<br>**Likely** partial live refresh: provider player ID 328617, Wikipedia Cole Campbell, DOB 2006-02-20, squad checked 2026-10-20T13:40:42.659+00:00. Photo now https://media.api-sports.io/football/players/328617.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 47, "name": "Cole Campbell", "slug": "cole-campbell", "position": "MF", "category": "prospect", "club": "SV Elversberg", "photo_url": "https://media.api-sports.io/football/players/328617.png", "age": 20, "contract_until": "2030-06-30", "market_value_usd": 4000000, "national_team_caps": 1, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 42, "bio": "A Texas-born dual national (US/Iceland) who left Borussia Dortmund's academy for a permanent move to Bundesliga newcomer Elversberg, chasing first-team minutes and a senior call-up.", "world_cup_roster": false, "api_football_player_id": 328617, "wikipedia_title": "Cole Campbell", "date_of_birth": "2006-02-20", "squad_last_checked_at": "2026-10-20T13:40:42.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 48 | Bajung Darboe<br>`bajung-darboe` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Bajung Darboe", "slug": "bajung-darboe", "position": "FW", "category": "fringe", "age": 19, "contract_until": "2029-06-30", "market_value_usd": 1800000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-17", "debut_date": null, "bio": "A Gambian-born winger who came up through the Philadelphia Union and LAFC academy pipeline before Bayern Munich paid a $1.5M fee to bring him to Germany, where he's starting out with the club's second team in the Regionalliga.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Bayern Munich II → Bayern Munich; potential_call_up_score: 21 → 51.<br>**Likely** partial live refresh: provider player ID 362156, Wikipedia Bajung Darboe, DOB 2006-11-07, squad checked 2026-10-20T13:41:26.659+00:00. Photo now https://media.api-sports.io/football/players/362156.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 48, "name": "Bajung Darboe", "slug": "bajung-darboe", "position": "FW", "category": "fringe", "club": "Bayern Munich", "photo_url": "https://media.api-sports.io/football/players/362156.png", "age": 19, "contract_until": "2029-06-30", "market_value_usd": 1800000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-17", "debut_date": null, "potential_call_up_score": 51, "bio": "A Gambian-born winger who came up through the Philadelphia Union and LAFC academy pipeline before Bayern Munich paid a $1.5M fee to bring him to Germany, where he's starting out with the club's second team in the Regionalliga.", "world_cup_roster": false, "api_football_player_id": 362156, "wikipedia_title": "Bajung Darboe", "date_of_birth": "2006-11-07", "squad_last_checked_at": "2026-10-20T13:41:26.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 49 | Montrell Culbreath<br>`montrell-culbreath` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Montrell Culbreath", "slug": "montrell-culbreath", "position": "MF", "category": "prospect", "club": "Bayer Leverkusen", "contract_until": "2028-06-30", "market_value_usd": 3200000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2025-12-20", "bio": "A German-American right winger who scored on his Bundesliga debut for Leverkusen as a teenager. Still uncapped by either country he's eligible for, but very much on U.S. Soccer's radar.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 18 → 19; potential_call_up_score: 25 → 31.<br>**Likely** partial live refresh: provider player ID 444961, Wikipedia Montrell Culbreath, DOB 2007-08-29, squad checked 2026-10-20T13:41:14.659+00:00. Photo now https://media.api-sports.io/football/players/444961.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 49, "name": "Montrell Culbreath", "slug": "montrell-culbreath", "position": "MF", "category": "prospect", "club": "Bayer Leverkusen", "photo_url": "https://media.api-sports.io/football/players/444961.png", "age": 19, "contract_until": "2028-06-30", "market_value_usd": 3200000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": null, "debut_date": "2025-12-20", "potential_call_up_score": 31, "bio": "A German-American right winger who scored on his Bundesliga debut for Leverkusen as a teenager. Still uncapped by either country he's eligible for, but very much on U.S. Soccer's radar.", "world_cup_roster": false, "api_football_player_id": 444961, "wikipedia_title": "Montrell Culbreath", "date_of_birth": "2007-08-29", "squad_last_checked_at": "2026-10-20T13:41:14.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 50 | Rokas Pukstas<br>`rokas-pukstas` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Rokas Pukstas", "slug": "rokas-pukstas", "position": "MF", "category": "prospect", "contract_until": "2027-06-30", "market_value_usd": 5000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "bio": "A U.S.-eligible dual national starring for Hajduk Split in Croatia's top flight, Pukstas has drawn interest from German clubs and pundit chatter about a surprise World Cup call.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Hajduk Split → Middlesbrough; age: 20 → 22; potential_call_up_score: 38 → 30.<br>**Likely** partial live refresh: provider player ID 340571, Wikipedia Rokas Pukštas, DOB 2004-08-25, squad checked 2026-10-20T13:39:00.76+00:00. Photo now https://media.api-sports.io/football/players/340571.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 50, "name": "Rokas Pukstas", "slug": "rokas-pukstas", "position": "MF", "category": "prospect", "club": "Middlesbrough", "photo_url": "https://media.api-sports.io/football/players/340571.png", "age": 22, "contract_until": "2027-06-30", "market_value_usd": 5000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 30, "bio": "A U.S.-eligible dual national starring for Hajduk Split in Croatia's top flight, Pukstas has drawn interest from German clubs and pundit chatter about a surprise World Cup call.", "world_cup_roster": false, "api_football_player_id": 340571, "wikipedia_title": "Rokas Pukštas", "date_of_birth": "2004-08-25", "squad_last_checked_at": "2026-10-20T13:39:00.76+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 51 | Quinn Sullivan<br>`quinn-sullivan` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Quinn Sullivan", "slug": "quinn-sullivan", "position": "FW", "category": "fringe", "club": "Philadelphia Union", "contract_until": "2027-12-31", "market_value_usd": 4500000, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2025-09-06", "bio": "The most productive goal-and-assist producer in his age group, Sullivan's rise stalled when a torn ACL cost him a chance to push for a World Cup roster spot.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 21 → 22; national_team_caps: 1 → 3; potential_call_up_score: 40 → 30.<br>**Likely** partial live refresh: provider player ID 265882, Wikipedia Quinn Sullivan (soccer), DOB 2004-03-27, squad checked 2026-10-20T13:41:06.659+00:00. Photo now https://media.api-sports.io/football/players/265882.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 51, "name": "Quinn Sullivan", "slug": "quinn-sullivan", "position": "FW", "category": "fringe", "club": "Philadelphia Union", "photo_url": "https://media.api-sports.io/football/players/265882.png", "age": 22, "contract_until": "2027-12-31", "market_value_usd": 4500000, "national_team_caps": 3, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": "2025-09-06", "potential_call_up_score": 30, "bio": "The most productive goal-and-assist producer in his age group, Sullivan's rise stalled when a torn ACL cost him a chance to push for a World Cup roster spot.", "world_cup_roster": false, "api_football_player_id": 265882, "wikipedia_title": "Quinn Sullivan (soccer)", "date_of_birth": "2004-03-27", "squad_last_checked_at": "2026-10-20T13:41:06.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 52 | Luca Bombino<br>`luca-bombino` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, age, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Luca Bombino", "slug": "luca-bombino", "position": "DF", "category": "prospect", "age": 20, "contract_until": "2028-12-31", "market_value_usd": 2000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "bio": "A progressive-passing left-back and member of the U-20 World Cup squad, Bombino ranked in the 93rd percentile among MLS fullbacks for progressive passes last season.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: San Diego FC → Stoke City; potential_call_up_score: 30 → 35.<br>**Likely** partial live refresh: provider player ID 418851, Wikipedia Luca Bombino, DOB 2006-07-10, squad checked 2026-10-20T13:41:30.659+00:00. Photo now https://media.api-sports.io/football/players/418851.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 52, "name": "Luca Bombino", "slug": "luca-bombino", "position": "DF", "category": "prospect", "club": "Stoke City", "photo_url": "https://media.api-sports.io/football/players/418851.png", "age": 20, "contract_until": "2028-12-31", "market_value_usd": 2000000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 35, "bio": "A progressive-passing left-back and member of the U-20 World Cup squad, Bombino ranked in the 93rd percentile among MLS fullbacks for progressive passes last season.", "world_cup_roster": false, "api_football_player_id": 418851, "wikipedia_title": "Luca Bombino", "date_of_birth": "2006-07-10", "squad_last_checked_at": "2026-10-20T13:41:30.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 53 | Peyton Miller<br>`peyton-miller` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, club, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Peyton Miller", "slug": "peyton-miller", "position": "DF", "category": "prospect", "club": "New England Revolution", "contract_until": "2028-12-31", "market_value_usd": 1800000, "youth_national_team": "U-21", "debut_date": null, "bio": "A Revolution homegrown fullback who has moved through the U-20 and U-21 national teams, Miller's athleticism and minutes have him ahead of older peers in the pipeline.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: age: 19 → 18; national_team_caps: 0 → 5; national_team_goals: 0 → 1; potential_call_up_score: 29 → 91.<br>**Likely** partial live refresh: provider player ID 413230, Wikipedia Peyton Miller, DOB 2007-11-08, squad checked 2026-10-20T13:40:46.959+00:00. Photo now https://media.api-sports.io/football/players/413230.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 53, "name": "Peyton Miller", "slug": "peyton-miller", "position": "DF", "category": "prospect", "club": "New England Revolution", "photo_url": "https://media.api-sports.io/football/players/413230.png", "age": 18, "contract_until": "2028-12-31", "market_value_usd": 1800000, "national_team_caps": 5, "national_team_goals": 1, "youth_national_team": "U-21", "debut_date": null, "potential_call_up_score": 91, "bio": "A Revolution homegrown fullback who has moved through the U-20 and U-21 national teams, Miller's athleticism and minutes have him ahead of older peers in the pipeline.", "world_cup_roster": false, "api_football_player_id": 413230, "wikipedia_title": "Peyton Miller", "date_of_birth": "2007-11-08", "squad_last_checked_at": "2026-10-20T13:40:46.959+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 54 | Joshua Wynder<br>`joshua-wynder` | 2026-07-15T02:46:09.468568+00:00 | **Confirmed** seed cohort: exact original ordered ID/slug + batch timestamp. | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, national_team_caps, national_team_goals, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Joshua Wynder", "slug": "joshua-wynder", "position": "DF", "category": "prospect", "contract_until": "2028-06-30", "market_value_usd": 4500000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "bio": "A U-20 World Cup center-back who racked up nearly 3,000 USL minutes before turning 19, Wynder is now waiting for a Champions League breakthrough at Benfica.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Benfica → New England Revolution; age: 20 → 21; potential_call_up_score: 26 → 42.<br>**Likely** partial live refresh: provider player ID 312164, Wikipedia Joshua Wynder, DOB 2005-05-02, squad checked 2026-10-20T13:39:46.659+00:00. Photo now https://media.api-sports.io/football/players/312164.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 54, "name": "Joshua Wynder", "slug": "joshua-wynder", "position": "DF", "category": "prospect", "club": "New England Revolution", "photo_url": "https://media.api-sports.io/football/players/312164.png", "age": 21, "contract_until": "2028-06-30", "market_value_usd": 4500000, "national_team_caps": 0, "national_team_goals": 0, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 42, "bio": "A U-20 World Cup center-back who racked up nearly 3,000 USL minutes before turning 19, Wynder is now waiting for a Champions League breakthrough at Benfica.", "world_cup_roster": false, "api_football_player_id": 312164, "wikipedia_title": "Joshua Wynder", "date_of_birth": "2005-05-02", "squad_last_checked_at": "2026-10-20T13:39:46.659+00:00", "created_at": "2026-07-15T02:46:09.468568+00:00" } |
| 303 | Justin Ellis<br>`justin-ellis` | 2026-08-25T18:51:19.797843+00:00 | **Likely** later seed-derived insert (not original full-script run). | **Confirmed** seed fields retained: name, slug, position, category, contract_until, market_value_usd, youth_national_team, debut_date, bio, world_cup_roster. **Exact retained seed values** { "name": "Justin Ellis", "slug": "justin-ellis", "position": "MF", "category": "prospect", "contract_until": "2027-12-31", "market_value_usd": 1500000, "youth_national_team": "U-20", "debut_date": null, "bio": "A combative, box-to-box midfielder who has forced his way into Orlando City's first-team picture, Ellis is firmly on U.S. Soccer's radar for the next youth cycle.", "world_cup_roster": false } **Unable to verify** these are factually correct merely because unchanged. Biographies are seed-authored; monetary estimates, dates and roster flags are not independently validated by this audit. | **Confirmed** values changed: club: Orlando City II → Orlando City SC; age: 21 → 19; national_team_caps: 0 → 3; national_team_goals: 0 → 2; potential_call_up_score: NULL → 58.<br>**Likely** partial live refresh: provider player ID 461514, Wikipedia Justin Ellis (soccer), DOB 2007-05-14, squad checked 2026-10-20T13:38:37.759+00:00. Photo now https://media.api-sports.io/football/players/461514.png. A changed value is confirmed; which writer changed it is not individually auditable. **Complete inspected current row** { "id": 303, "name": "Justin Ellis", "slug": "justin-ellis", "position": "MF", "category": "prospect", "club": "Orlando City SC", "photo_url": "https://media.api-sports.io/football/players/461514.png", "age": 19, "contract_until": "2027-12-31", "market_value_usd": 1500000, "national_team_caps": 3, "national_team_goals": 2, "youth_national_team": "U-20", "debut_date": null, "potential_call_up_score": 58, "bio": "A combative, box-to-box midfielder who has forced his way into Orlando City's first-team picture, Ellis is firmly on U.S. Soccer's radar for the next youth cycle.", "world_cup_roster": false, "api_football_player_id": 461514, "wikipedia_title": "Justin Ellis (soccer)", "date_of_birth": "2007-05-14", "squad_last_checked_at": "2026-10-20T13:38:37.759+00:00", "created_at": "2026-08-25T18:51:19.797843+00:00" } |

## 3. fixtures

**Writes:** current/historical inserts; also truncates. Fingerprint: exact teams + date derived from fixed July 13 anchor, competition, venue, scores/status and broadcast metadata; original batch timestamp and IDs strengthen attribution. Seed provider fixture IDs were NULL.

| ID | Identifying fields | created_at | Still seed vs overwritten | Evidence |
| --- | --- | --- | --- | --- |
| 1 | USA vs Belgium; FIFA World Cup; 2026-07-09 15:00 UTC; AT&T Stadium, Arlington; finished 1–4; Fox / Fubo | 2026-07-15T02:46:09.476302+00:00 | **Confirmed** seed-origin fixture with retained core match payload. **Confirmed** later enrichment: provider ID 1570715 (seed NULL) and nt_level SENIOR (not a field in that historical insert). **Likely** sync bound the ID; not a full factual refresh. | All seeded insert fields remain exact, including logos and NULL broadcast_link. **Confirmed stale/conflicting date:** 16 provider-linked national-team match logs for 1570715 all say 2026-07-07 and L 1-4; fixture still says July 9. Their created_at range begins July 15 23:21 UTC, after the seed. The 1–4 result is corroborated, not proven invented. **Unable to verify:** independent accuracy of venue/broadcast and whether a sync re-wrote equal values. **Full current fixture** { "id": 1, "is_national_team": true, "competition": "FIFA World Cup", "kickoff": "2026-07-09T15:00:00+00:00", "venue": "AT&T Stadium, Arlington", "home_team": "USA", "away_team": "Belgium", "home_logo_url": "https://media.api-sports.io/football/teams/2384.png", "away_logo_url": "https://media.api-sports.io/football/teams/1.png", "home_score": 1, "away_score": 4, "status": "finished", "tv_network": "Fox", "streaming_service": "Fubo", "broadcast_link": null, "created_at": "2026-07-15T02:46:09.476302+00:00", "api_football_fixture_id": 1570715, "elapsed_minute": null, "city": null, "nt_level": "SENIOR", "kickoff_time_tbd": false, "squad_synced_at": null } **Provider-linked log evidence** [ { "id": 1172, "player_id": 1, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 59, "goals": 0, "assists": 0, "rating": 6.2, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.392849+00:00" }, { "id": 1218, "player_id": 10, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 45, "goals": 0, "assists": 0, "rating": 6.7, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.431509+00:00" }, { "id": 1247, "player_id": 9, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 90, "goals": 1, "assists": 0, "rating": 7.2, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.437571+00:00" }, { "id": 1278, "player_id": 30, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 90, "goals": 0, "assists": 0, "rating": 5.9, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.443268+00:00" }, { "id": 1368, "player_id": 4, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 89, "goals": 0, "assists": 0, "rating": 6.7, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.461707+00:00" }, { "id": 1408, "player_id": 11, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 90, "goals": 0, "assists": 0, "rating": 6.2, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.467705+00:00" }, { "id": 1444, "player_id": 7, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 89, "goals": 0, "assists": 0, "rating": 6.2, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.472505+00:00" }, { "id": 1473, "player_id": 32, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 90, "goals": 0, "assists": 0, "rating": 6.9, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.477305+00:00" }, { "id": 1531, "player_id": 13, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 45, "goals": 0, "assists": 0, "rating": 6.7, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.490805+00:00" }, { "id": 1620, "player_id": 6, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 18, "goals": 0, "assists": 0, "rating": 6.9, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.528151+00:00" }, { "id": 1770, "player_id": 2, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 90, "goals": 0, "assists": 0, "rating": 6, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.554416+00:00" }, { "id": 1809, "player_id": 3, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 72, "goals": 0, "assists": 0, "rating": 6.7, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.558485+00:00" }, { "id": 1877, "player_id": 42, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 1, "goals": 0, "assists": 0, "rating": null, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.569403+00:00" }, { "id": 1895, "player_id": 34, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 90, "goals": 0, "assists": 0, "rating": 5.5, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.573398+00:00" }, { "id": 1958, "player_id": 31, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 1, "goals": 0, "assists": 0, "rating": null, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.581431+00:00" }, { "id": 2011, "player_id": 38, "date": "2026-07-07", "opponent": "Belgium", "competition": "World Cup", "result": "L 1-4", "minutes": 31, "goals": 0, "assists": 0, "rating": 6.9, "api_football_fixture_id": 1570715, "is_national_team": true, "created_at": "2026-07-15T23:21:13.596035+00:00" } ] |

**Confirmed:** no historical seed-pair + seed-date matches survive for the other speculative fixtures, and original fixture IDs 2–5 are absent. Current Jamaica fixture 4579 is NOT the old seed: USA–Jamaica, December 14 2026 00:00 UTC (time TBD), International Friendly, created October 20 16:29:02.241537 UTC, sentinel -2007. The old seed was August 24 19:00 UTC, CONCACAF Nations League. Opponent name alone would falsely match it.

**All distinct historical fixture fingerprints checked**

```text
[
  {
    "isNationalTeam": true,
    "competition": "FIFA World Cup",
    "daysFromNow": -4,
    "hour": 15,
    "venue": "AT&T Stadium, Arlington",
    "homeTeam": "USA",
    "awayTeam": "Belgium",
    "homeScore": 1,
    "awayScore": 4,
    "status": "finished",
    "tvNetwork": "Fox",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Weston McKennie",
      "Tyler Adams",
      "Antonee Robinson",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "CONCACAF Nations League",
    "daysFromNow": 42,
    "hour": 19,
    "venue": "Allianz Field, Saint Paul",
    "homeTeam": "USA",
    "awayTeam": "Jamaica",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Weston McKennie",
      "Tyler Adams",
      "Antonee Robinson",
      "Ricardo Pepi",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "CONCACAF Nations League",
    "daysFromNow": 46,
    "hour": 20,
    "venue": "Q2 Stadium, Austin",
    "homeTeam": "USA",
    "awayTeam": "Trinidad and Tobago",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Malik Tillman",
      "Folarin Balogun",
      "Timothy Weah",
      "Chris Richards"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "International Friendly",
    "daysFromNow": 119,
    "hour": 19,
    "venue": "Allianz Field, Saint Paul",
    "homeTeam": "USA",
    "awayTeam": "Panama",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Weston McKennie",
      "Tyler Adams",
      "Yunus Musah",
      "Ricardo Pepi"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "International Friendly",
    "daysFromNow": 123,
    "hour": 20,
    "venue": "Q2 Stadium, Austin",
    "homeTeam": "USA",
    "awayTeam": "Colombia",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Malik Tillman",
      "Folarin Balogun",
      "Timothy Weah",
      "Sergiño Dest"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "FIFA World Cup",
    "daysFromNow": -4,
    "hour": 15,
    "venue": "AT&T Stadium, Arlington",
    "homeTeam": "USA",
    "awayTeam": "Belgium",
    "homeScore": 1,
    "awayScore": 4,
    "status": "finished",
    "tvNetwork": "Fox",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Weston McKennie",
      "Tyler Adams",
      "Antonee Robinson",
      "Yunus Musah",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "International Friendly",
    "daysFromNow": 42,
    "hour": 19,
    "venue": "Allianz Field, Saint Paul",
    "homeTeam": "USA",
    "awayTeam": "Panama",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Weston McKennie",
      "Tyler Adams",
      "Antonee Robinson",
      "Yunus Musah",
      "Ricardo Pepi",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "International Friendly",
    "daysFromNow": 46,
    "hour": 20,
    "venue": "Q2 Stadium, Austin",
    "homeTeam": "USA",
    "awayTeam": "Colombia",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Malik Tillman",
      "Folarin Balogun",
      "Timothy Weah",
      "Chris Richards"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "FIFA World Cup",
    "daysFromNow": -4,
    "hour": 15,
    "venue": "AT&T Stadium, Arlington",
    "homeTeam": "USA",
    "awayTeam": "Belgium",
    "homeScore": 2,
    "awayScore": 1,
    "status": "finished",
    "tvNetwork": "Fox",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Weston McKennie",
      "Tyler Adams",
      "Antonee Robinson",
      "Yunus Musah",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Serie A",
    "daysFromNow": 0,
    "hour": 14,
    "venue": "San Siro, Milan",
    "homeTeam": "AC Milan",
    "awayTeam": "Inter",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "CBS Sports Network",
    "streamingService": "Paramount+",
    "broadcastLink": null,
    "featured": []
  },
  {
    "isNationalTeam": false,
    "competition": "Premier League",
    "daysFromNow": 0,
    "hour": 15,
    "venue": "Vitality Stadium, Bournemouth",
    "homeTeam": "Bournemouth",
    "awayTeam": "Fulham",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "USA Network",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Tyler Adams",
      "Antonee Robinson"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Eredivisie",
    "daysFromNow": 0,
    "hour": 18,
    "venue": "Philips Stadion, Eindhoven",
    "homeTeam": "PSV Eindhoven",
    "awayTeam": "AZ Alkmaar",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": null,
    "streamingService": "ESPN+",
    "broadcastLink": null,
    "featured": [
      "Ricardo Pepi",
      "Malik Tillman",
      "Sergiño Dest",
      "Djordje Mihailovic"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Serie A",
    "daysFromNow": 1,
    "hour": 12,
    "venue": "Allianz Stadium, Turin",
    "homeTeam": "Juventus",
    "awayTeam": "Bologna",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "CBS Sports Network",
    "streamingService": "Paramount+",
    "broadcastLink": null,
    "featured": [
      "Weston McKennie"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Ligue 1",
    "daysFromNow": 2,
    "hour": 19,
    "venue": "Stade Louis II, Monaco",
    "homeTeam": "AS Monaco",
    "awayTeam": "Lille",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": null,
    "streamingService": "beIN Sports",
    "broadcastLink": null,
    "featured": [
      "Folarin Balogun"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Bundesliga",
    "daysFromNow": 3,
    "hour": 13,
    "venue": "Signal Iduna Park, Dortmund",
    "homeTeam": "Borussia Dortmund",
    "awayTeam": "Mainz",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": null,
    "streamingService": "ESPN+",
    "broadcastLink": null,
    "featured": [
      "Giovanni Reyna"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Championship",
    "daysFromNow": 4,
    "hour": 14,
    "venue": "Carrow Road, Norwich",
    "homeTeam": "Norwich City",
    "awayTeam": "Leeds United",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": null,
    "streamingService": "ESPN+",
    "broadcastLink": null,
    "featured": [
      "Josh Sargent"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "MLS",
    "daysFromNow": 5,
    "hour": 20,
    "venue": "Subaru Park, Philadelphia",
    "homeTeam": "Philadelphia Union",
    "awayTeam": "Columbus Crew",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": null,
    "streamingService": "Apple TV",
    "broadcastLink": null,
    "featured": [
      "Cavan Sullivan"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "MLS",
    "daysFromNow": 5,
    "hour": 21,
    "venue": "Chase Stadium, Fort Lauderdale",
    "homeTeam": "Inter Miami CF",
    "awayTeam": "Atlanta United",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": null,
    "streamingService": "Apple TV",
    "broadcastLink": null,
    "featured": [
      "Benjamin Cremaschi"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Premier League",
    "daysFromNow": -3,
    "hour": 15,
    "venue": "Selhurst Park, London",
    "homeTeam": "Crystal Palace",
    "awayTeam": "Everton",
    "homeScore": 2,
    "awayScore": 1,
    "status": "finished",
    "tvNetwork": "USA Network",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Chris Richards",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": true,
    "competition": "World Cup Qualifying",
    "daysFromNow": 42,
    "hour": 19,
    "venue": "Allianz Field, Saint Paul",
    "homeTeam": "USA",
    "awayTeam": "Panama",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "TNT",
    "streamingService": "Fubo",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic",
      "Weston McKennie",
      "Tyler Adams",
      "Antonee Robinson",
      "Yunus Musah",
      "Ricardo Pepi",
      "Matt Turner"
    ]
  },
  {
    "isNationalTeam": false,
    "competition": "Serie A",
    "daysFromNow": 0,
    "hour": 14,
    "venue": "San Siro, Milan",
    "homeTeam": "AC Milan",
    "awayTeam": "Inter",
    "homeScore": null,
    "awayScore": null,
    "status": "scheduled",
    "tvNetwork": "CBS Sports Network",
    "streamingService": "Paramount+",
    "broadcastLink": null,
    "featured": [
      "Christian Pulisic"
    ]
  }
]
```

## 4. fixture_players

**Writes:** current/historical inserts; also truncates. Fingerprint: fixture identity and the ordered featured-player list. `created_at` does not exist here; parent creation time is shown only as context and must not be mistaken for the link’s insertion time.

| Link ID | Identifying fields | created_at | State / evidence |
| --- | --- | --- | --- |
| 1 | fixture_id=1; player_id=1; Christian Pulisic; club_id=NULL | Not present in schema. Parent fixture: 2026-07-15T02:46:09.476302+00:00 | **Confirmed** exact original ordered seed link. **Likely** retained original link rather than later re-creation, because both IDs and order match. No per-link audit timestamp to prove overwrite. These are curated tags, not proof of real match participation. |
| 2 | fixture_id=1; player_id=2; Weston McKennie; club_id=NULL | Not present in schema. Parent fixture: 2026-07-15T02:46:09.476302+00:00 | **Confirmed** exact original ordered seed link. **Likely** retained original link rather than later re-creation, because both IDs and order match. No per-link audit timestamp to prove overwrite. These are curated tags, not proof of real match participation. |
| 3 | fixture_id=1; player_id=3; Tyler Adams; club_id=NULL | Not present in schema. Parent fixture: 2026-07-15T02:46:09.476302+00:00 | **Confirmed** exact original ordered seed link. **Likely** retained original link rather than later re-creation, because both IDs and order match. No per-link audit timestamp to prove overwrite. These are curated tags, not proof of real match participation. |
| 4 | fixture_id=1; player_id=4; Antonee Robinson; club_id=NULL | Not present in schema. Parent fixture: 2026-07-15T02:46:09.476302+00:00 | **Confirmed** exact original ordered seed link. **Likely** retained original link rather than later re-creation, because both IDs and order match. No per-link audit timestamp to prove overwrite. These are curated tags, not proof of real match participation. |
| 5 | fixture_id=1; player_id=12; Matt Turner; club_id=NULL | Not present in schema. Parent fixture: 2026-07-15T02:46:09.476302+00:00 | **Confirmed** exact original ordered seed link. **Likely** retained original link rather than later re-creation, because both IDs and order match. No per-link audit timestamp to prove overwrite. These are curated tags, not proof of real match participation. |

Five seed links remain. Twelve additional links to fixture 1, IDs 2824–2835, are not part of the five-player seed list: 2824 (Ricardo Pepi), 2825 (Folarin Balogun), 2826 (Malik Tillman), 2827 (Sergiño Dest), 2828 (Chris Richards), 2829 (Giovanni Reyna), 2830 (Matt Freese), 2831 (Max Arfsten), 2832 (Alex Freeman), 2833 (Tim Ream), 2834 (Sebastian Berhalter), 2835 (Haji Wright). These show that the link set expanded later; they do not prove that every old curated tag is correct. No surviving parents remain for historical seeded fixture IDs 2–5.

## 5. news_articles

**Writes:** current/historical inserts; also truncates. Fingerprints: exact distinctive headline/summary; generic source homepage URL rather than an article URL; published_at computed from fixed `2026-07-13T12:00:00Z` minus 5–70 hours; seed-run created_at. Thirteen distinct headline/summary variants occur across history (one article changed), representing twelve per-run seed articles. IDs alone are not sufficient after a truncation/reset.

| Matches outside excluded IDs | ID / identifying fields | created_at | State / evidence |
| --- | --- | --- | --- |
| 0 | No rows; IDs 1–12 excluded. | N/A | **Confirmed** no exact historical headline or summary matches and no additional seed-era-created article outside 1–12. **Unable to verify** whether an article was edited so extensively that every fingerprint was lost and its original created_at was also replaced. No claim about the user’s ongoing deletion is inferred from this query. |

## 6. news_article_players

**Writes:** current/historical inserts; also truncates. Fingerprints: article_id plus featured player (resolved by identity, not just today’s numeric player ID). Twelve seed articles yield thirteen links because the last article tags Pulisic and Adams. This table has no created_at.

| Matches | ID / identifying fields | created_at | State / evidence |
| --- | --- | --- | --- |
| 0 | No surviving article_id 1–12 links; no links to matching extra seed articles. | Not present in schema. | **Confirmed** no surviving seed associations found. **Unable to verify** when or by whom links were removed, or whether this was part of the user’s deletion. Article rows 1–12 were not retrieved. |

## 7. national_team_windows

**Writes:** current/historical inserts; also truncates. Strong fingerprint: exact names, descriptions and dates, plus shared seed-run timestamp and IDs 1–2. Dates are hardcoded offsets from July 13, not offsets from execution day. No refresh writer for this table was found in the inspected current application code; its application references re-export/read the table.

| ID | Exact seed/current identifying fields | created_at | Still seed vs overwritten |
| --- | --- | --- | --- |
| 1 | CONCACAF Nations League - Group Stage<br>2026-08-24 – 2026-09-01<br>The USMNT opens Nations League group play on home soil, with the new-cycle player pool getting its first competitive minutes since the World Cup. | 2026-07-15T02:46:09.612242+00:00 | **Confirmed** every seeded value is still exact; no factual refresh is evidenced. **Likely** unverified/speculative seed calendar narrative, not provider-refreshed data. **Unable to verify** independent real-world validity of the name/dates/description. |
| 2 | November International Friendlies<br>2026-11-09 – 2026-11-17<br>A pair of send-off-style friendlies against European opposition rounds out the fall calendar as Pochettino continues auditioning depth ahead of the next Nations League window. | 2026-07-15T02:46:09.612242+00:00 | **Confirmed** every seeded value is still exact; no factual refresh is evidenced. **Likely** unverified/speculative seed calendar narrative, not provider-refreshed data. **Unable to verify** independent real-world validity of the name/dates/description. |

## 8. player_stats

**Writes:** historical inserts only; current script truncates without replacing. Fingerprints: exact player identity + period_type/season + the full numeric profile; July 15 batch time if retained. Historical season rows use 2025/26 profile values; last5 uses profile × 5/32 with rounded counting stats; previous_season uses 2024/25 and × 0.85. Percentages and avg_rating stay unchanged. xg, xa, progressive_passes and progressive_carries no longer exist in the production schema and cannot be compared.

| Matches | ID / identifying fields | created_at | State / evidence |
| --- | --- | --- | --- |
| 0 | No seed-era rows and no full remaining-column matches against 162 fingerprints (54 distinct historical profiles × 3 periods). | No matched row. Oldest current row: 2026-10-20T16:30:46.635679+00:00. | **Confirmed** no surviving seed-created or exact invented profile found among 520 rows at the count snapshot. **Likely** current rows were recreated by live sync. **Unable to verify** that a specific old row was overwritten rather than deleted/replaced, or that every current statistic is correct. July 15 reference script already excluded stats insertion. |

**All exact profile fingerprints tested (remaining production columns)**

```text
[
  {
    "player": "Christian Pulisic",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2450,
    "starts": 27,
    "goals": 14,
    "assists": 9,
    "shots": 78,
    "key_passes": 54,
    "pass_completion_pct": 82.4,
    "tackles": 22,
    "interceptions": 14,
    "duels_won_pct": 51.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.4
  },
  {
    "player": "Christian Pulisic",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 383,
    "starts": 4,
    "goals": 2,
    "assists": 1,
    "shots": 12,
    "key_passes": 8,
    "pass_completion_pct": 82.4,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 51.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.4
  },
  {
    "player": "Christian Pulisic",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2083,
    "starts": 23,
    "goals": 12,
    "assists": 8,
    "shots": 66,
    "key_passes": 46,
    "pass_completion_pct": 82.4,
    "tackles": 19,
    "interceptions": 12,
    "duels_won_pct": 51.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.4
  },
  {
    "player": "Weston McKennie",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2280,
    "starts": 26,
    "goals": 7,
    "assists": 4,
    "shots": 41,
    "key_passes": 22,
    "pass_completion_pct": 86.1,
    "tackles": 48,
    "interceptions": 26,
    "duels_won_pct": 58.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Weston McKennie",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 356,
    "starts": 4,
    "goals": 1,
    "assists": 1,
    "shots": 6,
    "key_passes": 3,
    "pass_completion_pct": 86.1,
    "tackles": 8,
    "interceptions": 4,
    "duels_won_pct": 58.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Weston McKennie",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1938,
    "starts": 22,
    "goals": 6,
    "assists": 3,
    "shots": 35,
    "key_passes": 19,
    "pass_completion_pct": 86.1,
    "tackles": 41,
    "interceptions": 22,
    "duels_won_pct": 58.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Tyler Adams",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1580,
    "starts": 18,
    "goals": 0,
    "assists": 2,
    "shots": 9,
    "key_passes": 14,
    "pass_completion_pct": 89.7,
    "tackles": 68,
    "interceptions": 44,
    "duels_won_pct": 62.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Tyler Adams",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 247,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 2,
    "pass_completion_pct": 89.7,
    "tackles": 11,
    "interceptions": 7,
    "duels_won_pct": 62.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Tyler Adams",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1343,
    "starts": 15,
    "goals": 0,
    "assists": 2,
    "shots": 8,
    "key_passes": 12,
    "pass_completion_pct": 89.7,
    "tackles": 58,
    "interceptions": 37,
    "duels_won_pct": 62.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Antonee Robinson",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2610,
    "starts": 29,
    "goals": 2,
    "assists": 6,
    "shots": 24,
    "key_passes": 38,
    "pass_completion_pct": 80.5,
    "tackles": 52,
    "interceptions": 34,
    "duels_won_pct": 55.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7
  },
  {
    "player": "Antonee Robinson",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 408,
    "starts": 5,
    "goals": 0,
    "assists": 1,
    "shots": 4,
    "key_passes": 6,
    "pass_completion_pct": 80.5,
    "tackles": 8,
    "interceptions": 5,
    "duels_won_pct": 55.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7
  },
  {
    "player": "Antonee Robinson",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2219,
    "starts": 25,
    "goals": 2,
    "assists": 5,
    "shots": 20,
    "key_passes": 32,
    "pass_completion_pct": 80.5,
    "tackles": 44,
    "interceptions": 29,
    "duels_won_pct": 55.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7
  },
  {
    "player": "Yunus Musah",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2140,
    "starts": 24,
    "goals": 1,
    "assists": 3,
    "shots": 18,
    "key_passes": 19,
    "pass_completion_pct": 90.2,
    "tackles": 44,
    "interceptions": 22,
    "duels_won_pct": 56.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Yunus Musah",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 334,
    "starts": 4,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 3,
    "pass_completion_pct": 90.2,
    "tackles": 7,
    "interceptions": 3,
    "duels_won_pct": 56.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Yunus Musah",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1819,
    "starts": 20,
    "goals": 1,
    "assists": 3,
    "shots": 15,
    "key_passes": 16,
    "pass_completion_pct": 90.2,
    "tackles": 37,
    "interceptions": 19,
    "duels_won_pct": 56.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Ricardo Pepi",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2380,
    "starts": 27,
    "goals": 18,
    "assists": 5,
    "shots": 92,
    "key_passes": 21,
    "pass_completion_pct": 76.9,
    "tackles": 8,
    "interceptions": 6,
    "duels_won_pct": 48.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.5
  },
  {
    "player": "Ricardo Pepi",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 372,
    "starts": 4,
    "goals": 3,
    "assists": 1,
    "shots": 14,
    "key_passes": 3,
    "pass_completion_pct": 76.9,
    "tackles": 1,
    "interceptions": 1,
    "duels_won_pct": 48.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.5
  },
  {
    "player": "Ricardo Pepi",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2023,
    "starts": 23,
    "goals": 15,
    "assists": 4,
    "shots": 78,
    "key_passes": 18,
    "pass_completion_pct": 76.9,
    "tackles": 7,
    "interceptions": 5,
    "duels_won_pct": 48.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.5
  },
  {
    "player": "Folarin Balogun",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1720,
    "starts": 19,
    "goals": 9,
    "assists": 2,
    "shots": 61,
    "key_passes": 14,
    "pass_completion_pct": 74.2,
    "tackles": 6,
    "interceptions": 4,
    "duels_won_pct": 46.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Folarin Balogun",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 269,
    "starts": 3,
    "goals": 1,
    "assists": 0,
    "shots": 10,
    "key_passes": 2,
    "pass_completion_pct": 74.2,
    "tackles": 1,
    "interceptions": 1,
    "duels_won_pct": 46.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Folarin Balogun",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1462,
    "starts": 16,
    "goals": 8,
    "assists": 2,
    "shots": 52,
    "key_passes": 12,
    "pass_completion_pct": 74.2,
    "tackles": 5,
    "interceptions": 3,
    "duels_won_pct": 46.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Timothy Weah",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1980,
    "starts": 22,
    "goals": 5,
    "assists": 4,
    "shots": 38,
    "key_passes": 26,
    "pass_completion_pct": 79.8,
    "tackles": 24,
    "interceptions": 12,
    "duels_won_pct": 52.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Timothy Weah",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 309,
    "starts": 3,
    "goals": 1,
    "assists": 1,
    "shots": 6,
    "key_passes": 4,
    "pass_completion_pct": 79.8,
    "tackles": 4,
    "interceptions": 2,
    "duels_won_pct": 52.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Timothy Weah",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1683,
    "starts": 19,
    "goals": 4,
    "assists": 3,
    "shots": 32,
    "key_passes": 22,
    "pass_completion_pct": 79.8,
    "tackles": 20,
    "interceptions": 10,
    "duels_won_pct": 52.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Malik Tillman",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2560,
    "starts": 28,
    "goals": 12,
    "assists": 11,
    "shots": 71,
    "key_passes": 62,
    "pass_completion_pct": 81.6,
    "tackles": 18,
    "interceptions": 10,
    "duels_won_pct": 49.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.6
  },
  {
    "player": "Malik Tillman",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 400,
    "starts": 4,
    "goals": 2,
    "assists": 2,
    "shots": 11,
    "key_passes": 10,
    "pass_completion_pct": 81.6,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 49.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.6
  },
  {
    "player": "Malik Tillman",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2176,
    "starts": 24,
    "goals": 10,
    "assists": 9,
    "shots": 60,
    "key_passes": 53,
    "pass_completion_pct": 81.6,
    "tackles": 15,
    "interceptions": 9,
    "duels_won_pct": 49.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.6
  },
  {
    "player": "Sergiño Dest",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1340,
    "starts": 15,
    "goals": 1,
    "assists": 3,
    "shots": 16,
    "key_passes": 22,
    "pass_completion_pct": 82.1,
    "tackles": 26,
    "interceptions": 16,
    "duels_won_pct": 53.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Sergiño Dest",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 209,
    "starts": 2,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 3,
    "pass_completion_pct": 82.1,
    "tackles": 4,
    "interceptions": 3,
    "duels_won_pct": 53.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Sergiño Dest",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1139,
    "starts": 13,
    "goals": 1,
    "assists": 3,
    "shots": 14,
    "key_passes": 19,
    "pass_completion_pct": 82.1,
    "tackles": 22,
    "interceptions": 14,
    "duels_won_pct": 53.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Chris Richards",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2670,
    "starts": 29,
    "goals": 1,
    "assists": 1,
    "shots": 14,
    "key_passes": 6,
    "pass_completion_pct": 88.9,
    "tackles": 42,
    "interceptions": 58,
    "duels_won_pct": 64.7,
    "clean_sheets": 9,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Chris Richards",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 417,
    "starts": 5,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 1,
    "pass_completion_pct": 88.9,
    "tackles": 7,
    "interceptions": 9,
    "duels_won_pct": 64.7,
    "clean_sheets": 1,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Chris Richards",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2270,
    "starts": 25,
    "goals": 1,
    "assists": 1,
    "shots": 12,
    "key_passes": 5,
    "pass_completion_pct": 88.9,
    "tackles": 36,
    "interceptions": 49,
    "duels_won_pct": 64.7,
    "clean_sheets": 8,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Matt Turner",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 900,
    "starts": 10,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 68.4,
    "tackles": 0,
    "interceptions": 2,
    "duels_won_pct": 0,
    "clean_sheets": 3,
    "save_pct": 71.2,
    "avg_rating": 6.6
  },
  {
    "player": "Matt Turner",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 141,
    "starts": 2,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 68.4,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 0,
    "save_pct": 71.2,
    "avg_rating": 6.6
  },
  {
    "player": "Matt Turner",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 765,
    "starts": 9,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 68.4,
    "tackles": 0,
    "interceptions": 2,
    "duels_won_pct": 0,
    "clean_sheets": 3,
    "save_pct": 71.2,
    "avg_rating": 6.6
  },
  {
    "player": "Giovanni Reyna",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 980,
    "starts": 10,
    "goals": 3,
    "assists": 3,
    "shots": 26,
    "key_passes": 18,
    "pass_completion_pct": 83.5,
    "tackles": 10,
    "interceptions": 6,
    "duels_won_pct": 47.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Giovanni Reyna",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 153,
    "starts": 2,
    "goals": 0,
    "assists": 0,
    "shots": 4,
    "key_passes": 3,
    "pass_completion_pct": 83.5,
    "tackles": 2,
    "interceptions": 1,
    "duels_won_pct": 47.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Giovanni Reyna",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 833,
    "starts": 9,
    "goals": 3,
    "assists": 3,
    "shots": 22,
    "key_passes": 15,
    "pass_completion_pct": 83.5,
    "tackles": 9,
    "interceptions": 5,
    "duels_won_pct": 47.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Josh Sargent",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2210,
    "starts": 25,
    "goals": 11,
    "assists": 4,
    "shots": 58,
    "key_passes": 20,
    "pass_completion_pct": 75.1,
    "tackles": 12,
    "interceptions": 8,
    "duels_won_pct": 54.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Josh Sargent",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 345,
    "starts": 4,
    "goals": 2,
    "assists": 1,
    "shots": 9,
    "key_passes": 3,
    "pass_completion_pct": 75.1,
    "tackles": 2,
    "interceptions": 1,
    "duels_won_pct": 54.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Josh Sargent",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1879,
    "starts": 21,
    "goals": 9,
    "assists": 3,
    "shots": 49,
    "key_passes": 17,
    "pass_completion_pct": 75.1,
    "tackles": 10,
    "interceptions": 7,
    "duels_won_pct": 54.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Paxten Aaronson",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 860,
    "starts": 8,
    "goals": 2,
    "assists": 3,
    "shots": 20,
    "key_passes": 16,
    "pass_completion_pct": 84.7,
    "tackles": 10,
    "interceptions": 6,
    "duels_won_pct": 50.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Paxten Aaronson",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 134,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 3,
    "pass_completion_pct": 84.7,
    "tackles": 2,
    "interceptions": 1,
    "duels_won_pct": 50.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Paxten Aaronson",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 731,
    "starts": 7,
    "goals": 2,
    "assists": 3,
    "shots": 17,
    "key_passes": 14,
    "pass_completion_pct": 84.7,
    "tackles": 9,
    "interceptions": 5,
    "duels_won_pct": 50.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Aidan Morris",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1620,
    "starts": 18,
    "goals": 0,
    "assists": 1,
    "shots": 8,
    "key_passes": 10,
    "pass_completion_pct": 87.3,
    "tackles": 56,
    "interceptions": 34,
    "duels_won_pct": 59.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Aidan Morris",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 253,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 2,
    "pass_completion_pct": 87.3,
    "tackles": 9,
    "interceptions": 5,
    "duels_won_pct": 59.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Aidan Morris",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1377,
    "starts": 15,
    "goals": 0,
    "assists": 1,
    "shots": 7,
    "key_passes": 9,
    "pass_completion_pct": 87.3,
    "tackles": 48,
    "interceptions": 29,
    "duels_won_pct": 59.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Djordje Mihailovic",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2320,
    "starts": 26,
    "goals": 6,
    "assists": 10,
    "shots": 44,
    "key_passes": 58,
    "pass_completion_pct": 83,
    "tackles": 20,
    "interceptions": 12,
    "duels_won_pct": 48.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Djordje Mihailovic",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 363,
    "starts": 4,
    "goals": 1,
    "assists": 2,
    "shots": 7,
    "key_passes": 9,
    "pass_completion_pct": 83,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 48.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Djordje Mihailovic",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1972,
    "starts": 22,
    "goals": 5,
    "assists": 9,
    "shots": 37,
    "key_passes": 49,
    "pass_completion_pct": 83,
    "tackles": 17,
    "interceptions": 10,
    "duels_won_pct": 48.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Tanner Tessmann",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1740,
    "starts": 19,
    "goals": 1,
    "assists": 2,
    "shots": 12,
    "key_passes": 12,
    "pass_completion_pct": 88.1,
    "tackles": 50,
    "interceptions": 30,
    "duels_won_pct": 57.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Tanner Tessmann",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 272,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 2,
    "pass_completion_pct": 88.1,
    "tackles": 8,
    "interceptions": 5,
    "duels_won_pct": 57.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Tanner Tessmann",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1479,
    "starts": 16,
    "goals": 1,
    "assists": 2,
    "shots": 10,
    "key_passes": 10,
    "pass_completion_pct": 88.1,
    "tackles": 43,
    "interceptions": 26,
    "duels_won_pct": 57.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Cavan Sullivan",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 620,
    "starts": 4,
    "goals": 3,
    "assists": 2,
    "shots": 18,
    "key_passes": 10,
    "pass_completion_pct": 71.4,
    "tackles": 4,
    "interceptions": 2,
    "duels_won_pct": 42.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Cavan Sullivan",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 97,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 2,
    "pass_completion_pct": 71.4,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 42.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Cavan Sullivan",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 527,
    "starts": 3,
    "goals": 3,
    "assists": 2,
    "shots": 15,
    "key_passes": 9,
    "pass_completion_pct": 71.4,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 42.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Diego Kochen",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 270,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 65.2,
    "tackles": 0,
    "interceptions": 1,
    "duels_won_pct": 0,
    "clean_sheets": 1,
    "save_pct": 68.8,
    "avg_rating": 6.5
  },
  {
    "player": "Diego Kochen",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 42,
    "starts": 0,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 65.2,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 0,
    "save_pct": 68.8,
    "avg_rating": 6.5
  },
  {
    "player": "Diego Kochen",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 230,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 65.2,
    "tackles": 0,
    "interceptions": 1,
    "duels_won_pct": 0,
    "clean_sheets": 1,
    "save_pct": 68.8,
    "avg_rating": 6.5
  },
  {
    "player": "Benjamin Cremaschi",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1980,
    "starts": 22,
    "goals": 4,
    "assists": 8,
    "shots": 30,
    "key_passes": 46,
    "pass_completion_pct": 86.8,
    "tackles": 24,
    "interceptions": 16,
    "duels_won_pct": 49.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Benjamin Cremaschi",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 309,
    "starts": 3,
    "goals": 1,
    "assists": 1,
    "shots": 5,
    "key_passes": 7,
    "pass_completion_pct": 86.8,
    "tackles": 4,
    "interceptions": 3,
    "duels_won_pct": 49.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Benjamin Cremaschi",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1683,
    "starts": 19,
    "goals": 3,
    "assists": 7,
    "shots": 26,
    "key_passes": 39,
    "pass_completion_pct": 86.8,
    "tackles": 20,
    "interceptions": 14,
    "duels_won_pct": 49.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Noel Buck",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 540,
    "starts": 5,
    "goals": 0,
    "assists": 1,
    "shots": 6,
    "key_passes": 6,
    "pass_completion_pct": 82.6,
    "tackles": 16,
    "interceptions": 10,
    "duels_won_pct": 52.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Noel Buck",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 84,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 1,
    "pass_completion_pct": 82.6,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 52.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Noel Buck",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 459,
    "starts": 4,
    "goals": 0,
    "assists": 1,
    "shots": 5,
    "key_passes": 5,
    "pass_completion_pct": 82.6,
    "tackles": 14,
    "interceptions": 9,
    "duels_won_pct": 52.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Obed Vargas",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1640,
    "starts": 17,
    "goals": 1,
    "assists": 2,
    "shots": 14,
    "key_passes": 14,
    "pass_completion_pct": 85.4,
    "tackles": 46,
    "interceptions": 24,
    "duels_won_pct": 55.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Obed Vargas",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 256,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 2,
    "pass_completion_pct": 85.4,
    "tackles": 7,
    "interceptions": 4,
    "duels_won_pct": 55.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Obed Vargas",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1394,
    "starts": 14,
    "goals": 1,
    "assists": 2,
    "shots": 12,
    "key_passes": 12,
    "pass_completion_pct": 85.4,
    "tackles": 39,
    "interceptions": 20,
    "duels_won_pct": 55.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Nimfasha Berchimas",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 980,
    "starts": 10,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 4,
    "pass_completion_pct": 84.9,
    "tackles": 22,
    "interceptions": 20,
    "duels_won_pct": 58.2,
    "clean_sheets": 4,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Nimfasha Berchimas",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 153,
    "starts": 2,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 1,
    "pass_completion_pct": 84.9,
    "tackles": 3,
    "interceptions": 3,
    "duels_won_pct": 58.2,
    "clean_sheets": 1,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Nimfasha Berchimas",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 833,
    "starts": 9,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 3,
    "pass_completion_pct": 84.9,
    "tackles": 19,
    "interceptions": 17,
    "duels_won_pct": 58.2,
    "clean_sheets": 3,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Mathis Albert",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 640,
    "starts": 6,
    "goals": 4,
    "assists": 3,
    "shots": 22,
    "key_passes": 16,
    "pass_completion_pct": 78.6,
    "tackles": 6,
    "interceptions": 3,
    "duels_won_pct": 44.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Mathis Albert",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 100,
    "starts": 1,
    "goals": 1,
    "assists": 0,
    "shots": 3,
    "key_passes": 3,
    "pass_completion_pct": 78.6,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 44.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Mathis Albert",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 544,
    "starts": 5,
    "goals": 3,
    "assists": 3,
    "shots": 19,
    "key_passes": 14,
    "pass_completion_pct": 78.6,
    "tackles": 5,
    "interceptions": 3,
    "duels_won_pct": 44.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Noahkai Banks",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 810,
    "starts": 9,
    "goals": 0,
    "assists": 1,
    "shots": 5,
    "key_passes": 3,
    "pass_completion_pct": 86.3,
    "tackles": 20,
    "interceptions": 26,
    "duels_won_pct": 61.4,
    "clean_sheets": 3,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Noahkai Banks",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 127,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 0,
    "pass_completion_pct": 86.3,
    "tackles": 3,
    "interceptions": 4,
    "duels_won_pct": 61.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Noahkai Banks",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 689,
    "starts": 8,
    "goals": 0,
    "assists": 1,
    "shots": 4,
    "key_passes": 3,
    "pass_completion_pct": 86.3,
    "tackles": 17,
    "interceptions": 22,
    "duels_won_pct": 61.4,
    "clean_sheets": 3,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Leonard Prescott",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 90,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 60,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 1,
    "save_pct": 75,
    "avg_rating": 6.6
  },
  {
    "player": "Leonard Prescott",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 14,
    "starts": 0,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 60,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 0,
    "save_pct": 75,
    "avg_rating": 6.6
  },
  {
    "player": "Leonard Prescott",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 77,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 60,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 1,
    "save_pct": 75,
    "avg_rating": 6.6
  },
  {
    "player": "Zavier Gozo",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 420,
    "starts": 4,
    "goals": 2,
    "assists": 1,
    "shots": 14,
    "key_passes": 6,
    "pass_completion_pct": 76.2,
    "tackles": 4,
    "interceptions": 2,
    "duels_won_pct": 46.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Zavier Gozo",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 66,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 1,
    "pass_completion_pct": 76.2,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 46.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Zavier Gozo",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 357,
    "starts": 3,
    "goals": 2,
    "assists": 1,
    "shots": 12,
    "key_passes": 5,
    "pass_completion_pct": 76.2,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 46.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Chris Brady",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2340,
    "starts": 26,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 74.8,
    "tackles": 0,
    "interceptions": 3,
    "duels_won_pct": 0,
    "clean_sheets": 8,
    "save_pct": 69.4,
    "avg_rating": 6.8
  },
  {
    "player": "Chris Brady",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 366,
    "starts": 4,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 74.8,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 1,
    "save_pct": 69.4,
    "avg_rating": 6.8
  },
  {
    "player": "Chris Brady",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1989,
    "starts": 22,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 74.8,
    "tackles": 0,
    "interceptions": 3,
    "duels_won_pct": 0,
    "clean_sheets": 7,
    "save_pct": 69.4,
    "avg_rating": 6.8
  },
  {
    "player": "Matt Freese",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2610,
    "starts": 29,
    "goals": 0,
    "assists": 1,
    "shots": 0,
    "key_passes": 2,
    "pass_completion_pct": 78.2,
    "tackles": 0,
    "interceptions": 4,
    "duels_won_pct": 0,
    "clean_sheets": 11,
    "save_pct": 72.6,
    "avg_rating": 7
  },
  {
    "player": "Matt Freese",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 408,
    "starts": 5,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 78.2,
    "tackles": 0,
    "interceptions": 1,
    "duels_won_pct": 0,
    "clean_sheets": 2,
    "save_pct": 72.6,
    "avg_rating": 7
  },
  {
    "player": "Matt Freese",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2219,
    "starts": 25,
    "goals": 0,
    "assists": 1,
    "shots": 0,
    "key_passes": 2,
    "pass_completion_pct": 78.2,
    "tackles": 0,
    "interceptions": 3,
    "duels_won_pct": 0,
    "clean_sheets": 9,
    "save_pct": 72.6,
    "avg_rating": 7
  },
  {
    "player": "Max Arfsten",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2460,
    "starts": 27,
    "goals": 4,
    "assists": 8,
    "shots": 34,
    "key_passes": 42,
    "pass_completion_pct": 80.9,
    "tackles": 40,
    "interceptions": 24,
    "duels_won_pct": 53.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Max Arfsten",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 384,
    "starts": 4,
    "goals": 1,
    "assists": 1,
    "shots": 5,
    "key_passes": 7,
    "pass_completion_pct": 80.9,
    "tackles": 6,
    "interceptions": 4,
    "duels_won_pct": 53.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Max Arfsten",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2091,
    "starts": 23,
    "goals": 3,
    "assists": 7,
    "shots": 29,
    "key_passes": 36,
    "pass_completion_pct": 80.9,
    "tackles": 34,
    "interceptions": 20,
    "duels_won_pct": 53.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Alex Freeman",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2380,
    "starts": 26,
    "goals": 5,
    "assists": 11,
    "shots": 40,
    "key_passes": 56,
    "pass_completion_pct": 81.4,
    "tackles": 44,
    "interceptions": 22,
    "duels_won_pct": 56.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.6
  },
  {
    "player": "Alex Freeman",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 372,
    "starts": 4,
    "goals": 1,
    "assists": 2,
    "shots": 6,
    "key_passes": 9,
    "pass_completion_pct": 81.4,
    "tackles": 7,
    "interceptions": 3,
    "duels_won_pct": 56.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.6
  },
  {
    "player": "Alex Freeman",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2023,
    "starts": 22,
    "goals": 4,
    "assists": 9,
    "shots": 34,
    "key_passes": 48,
    "pass_completion_pct": 81.4,
    "tackles": 37,
    "interceptions": 19,
    "duels_won_pct": 56.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.6
  },
  {
    "player": "Mark McKenzie",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2520,
    "starts": 28,
    "goals": 1,
    "assists": 0,
    "shots": 8,
    "key_passes": 4,
    "pass_completion_pct": 87.6,
    "tackles": 46,
    "interceptions": 62,
    "duels_won_pct": 63.2,
    "clean_sheets": 10,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Mark McKenzie",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 394,
    "starts": 4,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 1,
    "pass_completion_pct": 87.6,
    "tackles": 7,
    "interceptions": 10,
    "duels_won_pct": 63.2,
    "clean_sheets": 2,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Mark McKenzie",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2142,
    "starts": 24,
    "goals": 1,
    "assists": 0,
    "shots": 7,
    "key_passes": 3,
    "pass_completion_pct": 87.6,
    "tackles": 39,
    "interceptions": 53,
    "duels_won_pct": 63.2,
    "clean_sheets": 9,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Tim Ream",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2380,
    "starts": 27,
    "goals": 1,
    "assists": 1,
    "shots": 6,
    "key_passes": 3,
    "pass_completion_pct": 89.1,
    "tackles": 38,
    "interceptions": 58,
    "duels_won_pct": 60.4,
    "clean_sheets": 9,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Tim Ream",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 372,
    "starts": 4,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 0,
    "pass_completion_pct": 89.1,
    "tackles": 6,
    "interceptions": 9,
    "duels_won_pct": 60.4,
    "clean_sheets": 1,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Tim Ream",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2023,
    "starts": 23,
    "goals": 1,
    "assists": 1,
    "shots": 5,
    "key_passes": 3,
    "pass_completion_pct": 89.1,
    "tackles": 32,
    "interceptions": 49,
    "duels_won_pct": 60.4,
    "clean_sheets": 8,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Miles Robinson",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2280,
    "starts": 25,
    "goals": 3,
    "assists": 0,
    "shots": 20,
    "key_passes": 2,
    "pass_completion_pct": 84.3,
    "tackles": 44,
    "interceptions": 50,
    "duels_won_pct": 61.7,
    "clean_sheets": 8,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Miles Robinson",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 356,
    "starts": 4,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 0,
    "pass_completion_pct": 84.3,
    "tackles": 7,
    "interceptions": 8,
    "duels_won_pct": 61.7,
    "clean_sheets": 1,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Miles Robinson",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1938,
    "starts": 21,
    "goals": 3,
    "assists": 0,
    "shots": 17,
    "key_passes": 2,
    "pass_completion_pct": 84.3,
    "tackles": 37,
    "interceptions": 43,
    "duels_won_pct": 61.7,
    "clean_sheets": 7,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Joe Scally",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2470,
    "starts": 27,
    "goals": 0,
    "assists": 3,
    "shots": 12,
    "key_passes": 24,
    "pass_completion_pct": 83.7,
    "tackles": 42,
    "interceptions": 28,
    "duels_won_pct": 54.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Joe Scally",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 386,
    "starts": 4,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 4,
    "pass_completion_pct": 83.7,
    "tackles": 7,
    "interceptions": 4,
    "duels_won_pct": 54.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Joe Scally",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2100,
    "starts": 23,
    "goals": 0,
    "assists": 3,
    "shots": 10,
    "key_passes": 20,
    "pass_completion_pct": 83.7,
    "tackles": 36,
    "interceptions": 24,
    "duels_won_pct": 54.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Auston Trusty",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2610,
    "starts": 29,
    "goals": 2,
    "assists": 1,
    "shots": 16,
    "key_passes": 3,
    "pass_completion_pct": 86.9,
    "tackles": 40,
    "interceptions": 54,
    "duels_won_pct": 62.8,
    "clean_sheets": 11,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Auston Trusty",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 408,
    "starts": 5,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 0,
    "pass_completion_pct": 86.9,
    "tackles": 6,
    "interceptions": 8,
    "duels_won_pct": 62.8,
    "clean_sheets": 2,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Auston Trusty",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2219,
    "starts": 25,
    "goals": 2,
    "assists": 1,
    "shots": 14,
    "key_passes": 3,
    "pass_completion_pct": 86.9,
    "tackles": 34,
    "interceptions": 46,
    "duels_won_pct": 62.8,
    "clean_sheets": 9,
    "save_pct": null,
    "avg_rating": 7.1
  },
  {
    "player": "Sebastian Berhalter",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1980,
    "starts": 22,
    "goals": 1,
    "assists": 2,
    "shots": 14,
    "key_passes": 18,
    "pass_completion_pct": 88.4,
    "tackles": 52,
    "interceptions": 32,
    "duels_won_pct": 57.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Sebastian Berhalter",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 309,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 3,
    "pass_completion_pct": 88.4,
    "tackles": 8,
    "interceptions": 5,
    "duels_won_pct": 57.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Sebastian Berhalter",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1683,
    "starts": 19,
    "goals": 1,
    "assists": 2,
    "shots": 12,
    "key_passes": 15,
    "pass_completion_pct": 88.4,
    "tackles": 44,
    "interceptions": 27,
    "duels_won_pct": 57.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Cristian Roldan",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2340,
    "starts": 26,
    "goals": 3,
    "assists": 4,
    "shots": 24,
    "key_passes": 26,
    "pass_completion_pct": 85,
    "tackles": 44,
    "interceptions": 26,
    "duels_won_pct": 53.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Cristian Roldan",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 366,
    "starts": 4,
    "goals": 0,
    "assists": 1,
    "shots": 4,
    "key_passes": 4,
    "pass_completion_pct": 85,
    "tackles": 7,
    "interceptions": 4,
    "duels_won_pct": 53.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Cristian Roldan",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1989,
    "starts": 22,
    "goals": 3,
    "assists": 3,
    "shots": 20,
    "key_passes": 22,
    "pass_completion_pct": 85,
    "tackles": 37,
    "interceptions": 22,
    "duels_won_pct": 53.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Brenden Aaronson",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2620,
    "starts": 29,
    "goals": 9,
    "assists": 6,
    "shots": 58,
    "key_passes": 40,
    "pass_completion_pct": 79.6,
    "tackles": 30,
    "interceptions": 14,
    "duels_won_pct": 50.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.4
  },
  {
    "player": "Brenden Aaronson",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 409,
    "starts": 5,
    "goals": 1,
    "assists": 1,
    "shots": 9,
    "key_passes": 6,
    "pass_completion_pct": 79.6,
    "tackles": 5,
    "interceptions": 2,
    "duels_won_pct": 50.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.4
  },
  {
    "player": "Brenden Aaronson",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2227,
    "starts": 25,
    "goals": 8,
    "assists": 5,
    "shots": 49,
    "key_passes": 34,
    "pass_completion_pct": 79.6,
    "tackles": 26,
    "interceptions": 12,
    "duels_won_pct": 50.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.4
  },
  {
    "player": "Alejandro Zendejas",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1860,
    "starts": 20,
    "goals": 6,
    "assists": 7,
    "shots": 44,
    "key_passes": 38,
    "pass_completion_pct": 80.1,
    "tackles": 14,
    "interceptions": 6,
    "duels_won_pct": 47.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7
  },
  {
    "player": "Alejandro Zendejas",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 291,
    "starts": 3,
    "goals": 1,
    "assists": 1,
    "shots": 7,
    "key_passes": 6,
    "pass_completion_pct": 80.1,
    "tackles": 2,
    "interceptions": 1,
    "duels_won_pct": 47.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7
  },
  {
    "player": "Alejandro Zendejas",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1581,
    "starts": 17,
    "goals": 5,
    "assists": 6,
    "shots": 37,
    "key_passes": 32,
    "pass_completion_pct": 80.1,
    "tackles": 12,
    "interceptions": 5,
    "duels_won_pct": 47.8,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7
  },
  {
    "player": "Haji Wright",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 2540,
    "starts": 28,
    "goals": 17,
    "assists": 3,
    "shots": 88,
    "key_passes": 18,
    "pass_completion_pct": 74.5,
    "tackles": 8,
    "interceptions": 4,
    "duels_won_pct": 51.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.3
  },
  {
    "player": "Haji Wright",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 397,
    "starts": 4,
    "goals": 3,
    "assists": 0,
    "shots": 14,
    "key_passes": 3,
    "pass_completion_pct": 74.5,
    "tackles": 1,
    "interceptions": 1,
    "duels_won_pct": 51.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.3
  },
  {
    "player": "Haji Wright",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 2159,
    "starts": 24,
    "goals": 14,
    "assists": 3,
    "shots": 75,
    "key_passes": 15,
    "pass_completion_pct": 74.5,
    "tackles": 7,
    "interceptions": 3,
    "duels_won_pct": 51.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.3
  },
  {
    "player": "Diego Luna",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1740,
    "starts": 18,
    "goals": 5,
    "assists": 9,
    "shots": 42,
    "key_passes": 48,
    "pass_completion_pct": 82.9,
    "tackles": 12,
    "interceptions": 6,
    "duels_won_pct": 46.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Diego Luna",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 272,
    "starts": 3,
    "goals": 1,
    "assists": 1,
    "shots": 7,
    "key_passes": 8,
    "pass_completion_pct": 82.9,
    "tackles": 2,
    "interceptions": 1,
    "duels_won_pct": 46.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Diego Luna",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1479,
    "starts": 15,
    "goals": 4,
    "assists": 8,
    "shots": 36,
    "key_passes": 41,
    "pass_completion_pct": 82.9,
    "tackles": 10,
    "interceptions": 5,
    "duels_won_pct": 46.4,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 7.2
  },
  {
    "player": "Gaga Slonina",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 990,
    "starts": 11,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 70.2,
    "tackles": 0,
    "interceptions": 2,
    "duels_won_pct": 0,
    "clean_sheets": 3,
    "save_pct": 66.7,
    "avg_rating": 6.6
  },
  {
    "player": "Gaga Slonina",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 155,
    "starts": 2,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 70.2,
    "tackles": 0,
    "interceptions": 0,
    "duels_won_pct": 0,
    "clean_sheets": 0,
    "save_pct": 66.7,
    "avg_rating": 6.6
  },
  {
    "player": "Gaga Slonina",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 842,
    "starts": 9,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 70.2,
    "tackles": 0,
    "interceptions": 2,
    "duels_won_pct": 0,
    "clean_sheets": 3,
    "save_pct": 66.7,
    "avg_rating": 6.6
  },
  {
    "player": "Caleb Wiley",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 860,
    "starts": 9,
    "goals": 0,
    "assists": 2,
    "shots": 10,
    "key_passes": 12,
    "pass_completion_pct": 79,
    "tackles": 16,
    "interceptions": 8,
    "duels_won_pct": 49.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Caleb Wiley",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 134,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 2,
    "pass_completion_pct": 79,
    "tackles": 3,
    "interceptions": 1,
    "duels_won_pct": 49.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Caleb Wiley",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 731,
    "starts": 8,
    "goals": 0,
    "assists": 2,
    "shots": 9,
    "key_passes": 10,
    "pass_completion_pct": 79,
    "tackles": 14,
    "interceptions": 7,
    "duels_won_pct": 49.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Damion Downs",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 780,
    "starts": 8,
    "goals": 4,
    "assists": 1,
    "shots": 26,
    "key_passes": 6,
    "pass_completion_pct": 73.4,
    "tackles": 4,
    "interceptions": 2,
    "duels_won_pct": 52.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Damion Downs",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 122,
    "starts": 1,
    "goals": 1,
    "assists": 0,
    "shots": 4,
    "key_passes": 1,
    "pass_completion_pct": 73.4,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 52.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Damion Downs",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 663,
    "starts": 7,
    "goals": 3,
    "assists": 1,
    "shots": 22,
    "key_passes": 5,
    "pass_completion_pct": 73.4,
    "tackles": 3,
    "interceptions": 2,
    "duels_won_pct": 52.9,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Cole Campbell",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 420,
    "starts": 4,
    "goals": 1,
    "assists": 2,
    "shots": 12,
    "key_passes": 10,
    "pass_completion_pct": 80.6,
    "tackles": 6,
    "interceptions": 4,
    "duels_won_pct": 45.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Cole Campbell",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 66,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 2,
    "pass_completion_pct": 80.6,
    "tackles": 1,
    "interceptions": 1,
    "duels_won_pct": 45.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Cole Campbell",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 357,
    "starts": 3,
    "goals": 1,
    "assists": 2,
    "shots": 10,
    "key_passes": 9,
    "pass_completion_pct": 80.6,
    "tackles": 5,
    "interceptions": 3,
    "duels_won_pct": 45.2,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Bajung Darboe",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 610,
    "starts": 6,
    "goals": 3,
    "assists": 2,
    "shots": 18,
    "key_passes": 14,
    "pass_completion_pct": 76.8,
    "tackles": 4,
    "interceptions": 3,
    "duels_won_pct": 48.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Bajung Darboe",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 95,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 2,
    "pass_completion_pct": 76.8,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 48.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Bajung Darboe",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 519,
    "starts": 5,
    "goals": 3,
    "assists": 2,
    "shots": 15,
    "key_passes": 12,
    "pass_completion_pct": 76.8,
    "tackles": 3,
    "interceptions": 3,
    "duels_won_pct": 48.5,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Montrell Culbreath",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 800,
    "starts": 6,
    "goals": 1,
    "assists": 1,
    "shots": 15,
    "key_passes": 9,
    "pass_completion_pct": 79.3,
    "tackles": 5,
    "interceptions": 3,
    "duels_won_pct": 44,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Montrell Culbreath",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 125,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 1,
    "pass_completion_pct": 79.3,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 44,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Montrell Culbreath",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 680,
    "starts": 5,
    "goals": 1,
    "assists": 1,
    "shots": 13,
    "key_passes": 8,
    "pass_completion_pct": 79.3,
    "tackles": 4,
    "interceptions": 3,
    "duels_won_pct": 44,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Rokas Pukstas",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1980,
    "starts": 22,
    "goals": 3,
    "assists": 4,
    "shots": 30,
    "key_passes": 28,
    "pass_completion_pct": 84.2,
    "tackles": 34,
    "interceptions": 20,
    "duels_won_pct": 53.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Rokas Pukstas",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 309,
    "starts": 3,
    "goals": 0,
    "assists": 1,
    "shots": 5,
    "key_passes": 4,
    "pass_completion_pct": 84.2,
    "tackles": 5,
    "interceptions": 3,
    "duels_won_pct": 53.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Rokas Pukstas",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1683,
    "starts": 19,
    "goals": 3,
    "assists": 3,
    "shots": 26,
    "key_passes": 24,
    "pass_completion_pct": 84.2,
    "tackles": 29,
    "interceptions": 17,
    "duels_won_pct": 53.1,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Quinn Sullivan",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 640,
    "starts": 6,
    "goals": 2,
    "assists": 3,
    "shots": 20,
    "key_passes": 16,
    "pass_completion_pct": 81.3,
    "tackles": 6,
    "interceptions": 2,
    "duels_won_pct": 44.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Quinn Sullivan",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 100,
    "starts": 1,
    "goals": 0,
    "assists": 0,
    "shots": 3,
    "key_passes": 3,
    "pass_completion_pct": 81.3,
    "tackles": 1,
    "interceptions": 0,
    "duels_won_pct": 44.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Quinn Sullivan",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 544,
    "starts": 5,
    "goals": 2,
    "assists": 3,
    "shots": 17,
    "key_passes": 14,
    "pass_completion_pct": 81.3,
    "tackles": 5,
    "interceptions": 2,
    "duels_won_pct": 44.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.8
  },
  {
    "player": "Luca Bombino",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 1860,
    "starts": 20,
    "goals": 0,
    "assists": 3,
    "shots": 10,
    "key_passes": 20,
    "pass_completion_pct": 85.8,
    "tackles": 32,
    "interceptions": 18,
    "duels_won_pct": 51.7,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Luca Bombino",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 291,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 2,
    "key_passes": 3,
    "pass_completion_pct": 85.8,
    "tackles": 5,
    "interceptions": 3,
    "duels_won_pct": 51.7,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Luca Bombino",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 1581,
    "starts": 17,
    "goals": 0,
    "assists": 3,
    "shots": 9,
    "key_passes": 17,
    "pass_completion_pct": 85.8,
    "tackles": 27,
    "interceptions": 15,
    "duels_won_pct": 51.7,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.9
  },
  {
    "player": "Peyton Miller",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 920,
    "starts": 10,
    "goals": 0,
    "assists": 1,
    "shots": 4,
    "key_passes": 6,
    "pass_completion_pct": 82.4,
    "tackles": 24,
    "interceptions": 16,
    "duels_won_pct": 55.3,
    "clean_sheets": 3,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Peyton Miller",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 144,
    "starts": 2,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 1,
    "pass_completion_pct": 82.4,
    "tackles": 4,
    "interceptions": 3,
    "duels_won_pct": 55.3,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Peyton Miller",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 782,
    "starts": 9,
    "goals": 0,
    "assists": 1,
    "shots": 3,
    "key_passes": 5,
    "pass_completion_pct": 82.4,
    "tackles": 20,
    "interceptions": 14,
    "duels_won_pct": 55.3,
    "clean_sheets": 3,
    "save_pct": null,
    "avg_rating": 6.7
  },
  {
    "player": "Joshua Wynder",
    "period_type": "season",
    "season": "2025/26",
    "minutes": 300,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 0,
    "pass_completion_pct": 78.9,
    "tackles": 6,
    "interceptions": 8,
    "duels_won_pct": 58.6,
    "clean_sheets": 1,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Joshua Wynder",
    "period_type": "last5",
    "season": "2025/26",
    "minutes": 47,
    "starts": 0,
    "goals": 0,
    "assists": 0,
    "shots": 0,
    "key_passes": 0,
    "pass_completion_pct": 78.9,
    "tackles": 1,
    "interceptions": 1,
    "duels_won_pct": 58.6,
    "clean_sheets": 0,
    "save_pct": null,
    "avg_rating": 6.6
  },
  {
    "player": "Joshua Wynder",
    "period_type": "previous_season",
    "season": "2024/25",
    "minutes": 255,
    "starts": 3,
    "goals": 0,
    "assists": 0,
    "shots": 1,
    "key_passes": 0,
    "pass_completion_pct": 78.9,
    "tackles": 5,
    "interceptions": 7,
    "duels_won_pct": 58.6,
    "clean_sheets": 1,
    "save_pct": null,
    "avg_rating": 6.6
  }
]
```

## 9. injuries

**Writes:** historical inserts only; current script truncates without replacing. Fingerprints: player + body_part + fixed start_date/expected_return, numeric days/matches missed, and especially exact invented latest_update prose. All seven historical variants are below. Current rows: 164 at count snapshot; oldest created_at `2026-10-20T16:31:32.937358+00:00`. The July 15 reference script already excluded injury insertion.

**Confirmed:** zero candidate rows for these fingerprints. **Likely:** live-sync replacement has removed any earlier seed injuries. This is not proof that an original injury row was updated in place.

| Production ID | Historical identifying fingerprint checked | created_at | State / evidence |
| --- | --- | --- | --- |
| None | Christian Pulisic; Tibia/Fibula (micro-fracture); status=active; start=2026-07-09; expected_return=2026-08-06; days_missed=4; matches_missed=1<br>Suffered the injury on a heavy challenge during the USMNT's World Cup match against Belgium. Ruled out several weeks; timeline to be reassessed after a follow-up scan. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |
| None | Sergiño Dest; Knee; status=recovering; start=2026-06-05; expected_return=2026-07-23; days_missed=38; matches_missed=9<br>Cleared for non-contact training; expected to rejoin full sessions within two weeks. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |
| None | Giovanni Reyna; Hamstring; status=active; start=2026-06-29; expected_return=2026-08-03; days_missed=14; matches_missed=3<br>Dortmund's medical staff say Reyna will be reassessed after a further week of rehab. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |
| None | Tyler Adams; Hamstring; status=returned; start=2026-04-07; expected_return=2026-07-07; days_missed=91; matches_missed=18<br>Made a full 75-minute return to the Bournemouth starting XI over the weekend without setback. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |
| None | Josh Sargent; Ankle; status=recovering; start=2026-07-01; expected_return=2026-07-18; days_missed=12; matches_missed=2<br>Sargent is back running on the pitch and targeting a return for Norwich's next home fixture. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |
| None | Diego Kochen; Wrist; status=active; start=2026-07-05; expected_return=2026-07-28; days_missed=8; matches_missed=1<br>Barcelona's academy staff are managing the injury conservatively given his age and workload. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |
| None | Obed Vargas; Groin; status=returned; start=2026-06-08; expected_return=2026-06-29; days_missed=21; matches_missed=4<br>Back to full training with Seattle and available for selection. | No matched row. | **Confirmed** no seed-era row, exact seeded update text, or matching player/body-part/start-date fingerprint. **Unable to verify** deleted vs replaced historical row. |

## 10. match_logs

**Writes:** historical inserts only; current script truncates without replacing. Fingerprints: NULL api_football_fixture_id, original created_at, player/league-specific five-opponent sequence, dates June 11, June 18, June 25, July 2 and July 9 2026, and fixed results W 2-1, D 1-1, W 3-0, L 0-1, W 2-0 in newest-first order. Goals, ratings and outfield minutes included Math.random(), so exact reconstruction of those values is impossible. Goalkeepers used 90 minutes; outfield minutes were 60–90; ratings were rounded around the player profile and clamped 5.5–9.5. There is no unique exact-value ID fingerprint for these random fields.

| Matches | ID / identifying fields | created_at | State / evidence |
| --- | --- | --- | --- |
| 0 | No NULL-provider-ID rows and no rows created in/before the original batch. | No matched row. Oldest current log: 2026-07-15T23:21:13.392849+00:00. | **Confirmed** all 1,416 current logs at count snapshot have a provider fixture ID; none preserves the original seed creation time. The July 15 reference script already excluded log insertion. **Likely** current logs are live-sourced replacements. **Unable to verify** the prior existence or in-place overwrite of specific random seed logs. |

## 11. transfers

**Writes:** historical inserts only; current script truncates without replacing. Fingerprints: original IDs 1–6; creation near the seed batch; exact player/from/to/type/status/fee/probability, invented narrative and announced_at from fixed July 13 noon minus daysAgo. All 39 current rows were read for comparison; none matches. Earliest current row is ID 7, created `2026-07-15T02:56:35.049335+00:00`, after the seed batch.

**Confirmed:** original IDs 1–6 and all six exact fingerprints are absent. **Likely:** seed transfers were deleted/replaced, not retained untouched. For example current Tillman transfer ID 12 is PSV → Bayer Leverkusen, not the invented PSV contract-extension rumor. Different rows for the same player are not counted as overwritten seed records.

| Production ID | Historical identifying fingerprint checked | created_at | State / evidence |
| --- | --- | --- | --- |
| None | Chris Richards; Crystal Palace → Crystal Palace; contract_extension; confirmed; announced_at=2026-07-12T12:00:00.000Z; fee=NULL; probability=NULL<br>Richards signed a new three-year deal keeping him at Selhurst Park through 2028. | No matched row. | **Confirmed** seed ID, timestamp, summary, invented destination and player/announced-date searches found no match. **Unable to verify** deleted vs overwritten history. |
| None | Folarin Balogun; AS Monaco → Undisclosed Ligue 1 club; transfer; rumor; announced_at=2026-07-11T12:00:00.000Z; fee=€25M (est.); probability=42<br>Reports suggest Balogun could seek a move away from Monaco in search of regular minutes ahead of the World Cup. | No matched row. | **Confirmed** seed ID, timestamp, summary, invented destination and player/announced-date searches found no match. **Unable to verify** deleted vs overwritten history. |
| None | Malik Tillman; PSV Eindhoven → PSV Eindhoven; contract_extension; rumor; announced_at=2026-07-09T12:00:00.000Z; fee=NULL; probability=68<br>PSV are reportedly preparing an improved contract to ward off interest from Bundesliga and Premier League suitors. | No matched row. | **Confirmed** seed ID, timestamp, summary, invented destination and player/announced-date searches found no match. **Unable to verify** deleted vs overwritten history. |
| None | Ricardo Pepi; PSV Eindhoven → Bundesliga club (unnamed); transfer; rumor; announced_at=2026-07-07T12:00:00.000Z; fee=€30M (est.); probability=35<br>Scouts from at least two Bundesliga clubs have been tracking Pepi's scoring form this season. | No matched row. | **Confirmed** seed ID, timestamp, summary, invented destination and player/announced-date searches found no match. **Unable to verify** deleted vs overwritten history. |
| None | Djordje Mihailovic; AZ Alkmaar → Eredivisie rival; loan; rumor; announced_at=2026-07-04T12:00:00.000Z; fee=NULL; probability=18<br>Unconfirmed reports suggest a loan swap is being discussed, though AZ have downplayed the speculation. | No matched row. | **Confirmed** seed ID, timestamp, summary, invented destination and player/announced-date searches found no match. **Unable to verify** deleted vs overwritten history. |
| None | Benjamin Cremaschi; Inter Miami CF → Inter Miami CF; contract_extension; confirmed; announced_at=2026-07-01T12:00:00.000Z; fee=NULL; probability=NULL<br>Inter Miami confirmed a contract extension for Cremaschi through the 2027 season with a club option for 2028. | No matched row. | **Confirmed** seed ID, timestamp, summary, invented destination and player/announced-date searches found no match. **Unable to verify** deleted vs overwritten history. |

## Would running the current script destroy production data?

**Confirmed — an ordinary unforced run against the observed database should stop before destructive SQL:** lines 29–50 inspect whether the arguments contain the bypass flag, then count players and exit with code 1 if the count is greater than zero. Production had 78 players. This conclusion is based on source inspection and the SELECT count; the script was not executed.

**Confirmed — if that guard is bypassed or fails open, it is destructive:** lines 58–62 truncate the eleven named tables, restart their ID sequences and cascade to referencing tables. It is not an upsert/idempotent rerun. The later duplicate-club-name check happens after truncation and cannot protect existing data. No enclosing transaction makes the destructive clear and all subsequent inserts one recoverable unit.

**Confirmed additional cascade scope from production foreign-key metadata:** besides the eleven named tables, `player_candidates`, `eligibility_signals`, `player_status_history`, and `user_follows` are in the recursive truncation dependency closure. In particular, this can remove user follows and candidate/history records, not only placeholders. This is a minimum current ordinary-FK closure (15 tables total); custom trigger/partition effects were not audited.

**Confirmed limitations of the guard:** it only checks the players table, not an explicit production environment or database identity; it accepts a bypass flag; it would allow truncation if players were empty even when the other tables had valuable rows. Its optional-chain fallback treats an unexpectedly missing count-result row as zero rather than failing closed, though the normal driver result is expected to contain the count. The count and truncation are separate operations, so the check is not concurrency-safe protection against intervening changes.

**Confirmed configuration:** the DB module uses the DATABASE_URL environment variable; no hostname, read-only role or production-environment check exists in this script. No credential value was inspected. The package script points directly to seedUsmnt.ts; inspected root scripts, API startup and current production build/run configuration do not invoke seedUsmnt.ts automatically. API startup has separate bootstrap/repair writes; that does not mean it invokes this destructive script. **Unable to verify:** the deployed copy of the script/guard, the permissions of its potential execution role, or every external invocation not represented in this repository. The audit tool’s read-only replica restriction protects this inspection, not an independently executed application script.

No data-changing SQL, cleanup proposal or write procedure is included in this report.

## Source references and query audit

Current source: scripts/src/seedUsmnt.ts (truncation/guard lines 12–62; club insert 211; player insert 346–374; absence of stats/logs/injuries 377–382; fixture insert 431–454; news 488–505; windows 513–526). DB connection: lib/db/src/index.ts. Live update evidence: playerClubSync.ts (club/provider/photo), playerStatsSync.ts (age/DOB and call-up score), nationalTeamSync.ts (caps/goals), apiFootballSync.ts (club provider/logo enrichment and fixture updates), usmntSync.ts (provider ID promotion). Production schema was queried independently; source schema alone was not assumed to match production.

Historical script references: earliest 8c4a763; expanded July 13 fingerprints 266cc52; cohort-era d99e593; transfer removal 0f6e8e0; guard introduction 09a2f7a. Current source and these historical definitions were read only; no checkout or execution occurred.

**Production table-count SELECT result (news 1–12 excluded)**

```text
table_name,rows,oldest,newest
clubs,88,2026-07-15 02:46:09.457074+00,2026-10-08 02:09:37.543123+00
players,78,2026-07-15 02:46:09.468568+00,2026-10-08 02:09:37.543123+00
fixtures,1071,2026-07-15 02:46:09.476302+00,2026-10-20 19:12:44.882853+00
player_stats,520,2026-10-20 16:30:46.635679+00,2026-10-20 19:15:11.981295+00
match_logs,1416,2026-07-15 23:21:13.392849+00,2026-10-20 19:15:06.782752+00
injuries,164,2026-10-20 16:31:32.937358+00,2026-10-20 17:46:51.237062+00
transfers,39,2026-07-15 02:56:35.049335+00,2026-10-08 20:34:33.504835+00
national_team_windows,2,2026-07-15 02:46:09.612242+00,2026-07-15 02:46:09.612242+00
news_articles (excluding 1-12),3630,2026-07-15 02:46:15.88637+00,2026-10-20 19:23:13.276537+00
fixture_players,1876,,
news_article_players,1707,,

```

**Production schema SELECT result**

```text
table_name,column_name,data_type
clubs,id,integer
clubs,name,text
clubs,league,text
clubs,country,text
clubs,logo_url,text
clubs,created_at,timestamp with time zone
clubs,api_football_team_id,integer
fixture_players,id,integer
fixture_players,fixture_id,integer
fixture_players,player_id,integer
fixture_players,club_id,integer
fixtures,id,integer
fixtures,is_national_team,boolean
fixtures,competition,text
fixtures,kickoff,timestamp with time zone
fixtures,venue,text
fixtures,home_team,text
fixtures,away_team,text
fixtures,home_logo_url,text
fixtures,away_logo_url,text
fixtures,home_score,integer
fixtures,away_score,integer
fixtures,status,text
fixtures,tv_network,text
fixtures,streaming_service,text
fixtures,broadcast_link,text
fixtures,created_at,timestamp with time zone
fixtures,api_football_fixture_id,integer
fixtures,elapsed_minute,integer
fixtures,city,text
fixtures,nt_level,text
fixtures,kickoff_time_tbd,boolean
fixtures,squad_synced_at,timestamp with time zone
injuries,id,integer
injuries,player_id,integer
injuries,body_part,text
injuries,status,text
injuries,expected_return,date
injuries,days_missed,integer
injuries,matches_missed,integer
injuries,latest_update,text
injuries,start_date,date
injuries,created_at,timestamp with time zone
match_logs,id,integer
match_logs,player_id,integer
match_logs,date,text
match_logs,opponent,text
match_logs,competition,text
match_logs,result,text
match_logs,minutes,integer
match_logs,goals,integer
match_logs,assists,integer
match_logs,rating,double precision
match_logs,created_at,timestamp with time zone
match_logs,api_football_fixture_id,integer
match_logs,conceded,integer
match_logs,is_national_team,boolean
match_logs,cycle,text
national_team_windows,id,integer
national_team_windows,name,text
national_team_windows,start_date,date
national_team_windows,end_date,date
national_team_windows,description,text
national_team_windows,created_at,timestamp with time zone
news_article_players,id,integer
news_article_players,article_id,integer
news_article_players,player_id,integer
news_articles,id,integer
news_articles,headline,text
news_articles,source,text
news_articles,published_at,timestamp with time zone
news_articles,category,text
news_articles,url,text
news_articles,summary,text
news_articles,why_it_matters,text
news_articles,impact_score,integer
news_articles,sentiment,text
news_articles,created_at,timestamp with time zone
player_stats,id,integer
player_stats,player_id,integer
player_stats,period_type,text
player_stats,season,text
player_stats,minutes,integer
player_stats,starts,integer
player_stats,goals,integer
player_stats,assists,integer
player_stats,shots,integer
player_stats,key_passes,integer
player_stats,pass_completion_pct,double precision
player_stats,tackles,integer
player_stats,interceptions,integer
player_stats,duels_won_pct,double precision
player_stats,clean_sheets,integer
player_stats,save_pct,double precision
player_stats,avg_rating,double precision
player_stats,created_at,timestamp with time zone
players,id,integer
players,name,text
players,slug,text
players,position,text
players,category,text
players,club_id,integer
players,photo_url,text
players,age,integer
players,contract_until,date
players,market_value_usd,double precision
players,national_team_caps,integer
players,national_team_goals,integer
players,youth_national_team,text
players,debut_date,date
players,potential_call_up_score,integer
players,bio,text
players,created_at,timestamp with time zone
players,world_cup_roster,boolean
players,api_football_player_id,integer
players,wikipedia_title,text
players,date_of_birth,text
players,squad_last_checked_at,timestamp with time zone
players,usmnt_status,USER-DEFINED
players,needs_review,boolean
players,eligibility_confidence,integer
players,club_override_id,integer
players,club_override_set_at,timestamp with time zone
transfers,id,integer
transfers,player_id,integer
transfers,from_club,text
transfers,to_club,text
transfers,transfer_type,text
transfers,fee,text
transfers,status,text
transfers,probability_score,integer
transfers,announced_at,timestamp with time zone
transfers,summary,text
transfers,created_at,timestamp with time zone

```

**Observed original timestamp cohorts**

```text
table_name,created_at,rows,min_id,max_id
clubs,2026-07-15 02:46:09.457074+00,50,1,50
clubs,2026-07-16 15:38:41.624175+00,1,51,51
clubs,2026-07-16 15:38:45.373035+00,1,52,52
clubs,2026-07-16 16:01:39.373541+00,1,53,53
clubs,2026-07-16 16:01:42.570349+00,1,54,54
clubs,2026-07-16 16:01:45.955012+00,1,55,55
clubs,2026-07-16 16:01:49.139309+00,1,56,56
clubs,2026-07-16 16:01:52.361089+00,1,57,57
clubs,2026-07-16 16:01:55.506362+00,1,58,58
clubs,2026-07-16 16:02:08.144616+00,1,59,59
clubs,2026-07-20 19:59:03.939741+00,1,300,300
clubs,2026-07-20 19:59:19.667757+00,1,301,301
clubs,2026-07-20 19:59:49.539761+00,1,302,302
clubs,2026-07-20 20:00:09.739588+00,1,303,303
clubs,2026-07-20 20:00:15.239199+00,1,304,304
clubs,2026-07-20 20:00:25.039522+00,1,305,305
clubs,2026-07-20 20:00:31.910062+00,1,306,306
clubs,2026-07-20 20:00:42.455116+00,1,307,307
clubs,2026-07-20 20:01:37.338895+00,1,308,308
clubs,2026-07-20 20:01:41.338776+00,1,309,309
clubs,2026-07-20 20:01:59.238979+00,1,310,310
clubs,2026-07-20 20:02:13.238762+00,1,311,311
clubs,2026-07-20 20:02:45.138557+00,1,312,312
clubs,2026-07-20 20:03:25.838853+00,1,313,313
clubs,2026-07-20 20:03:29.738763+00,1,314,314
clubs,2026-07-20 20:03:47.838571+00,1,315,315
clubs,2026-07-20 20:04:03.738734+00,1,316,316
clubs,2026-07-28 05:48:36.20206+00,1,317,317
clubs,2026-08-04 04:36:32.290373+00,1,318,318
clubs,2026-08-10 02:05:46.65419+00,1,319,319
clubs,2026-08-15 12:19:07.030655+00,1,320,320
clubs,2026-08-25 18:50:36.279088+00,1,321,321
clubs,2026-08-25 21:21:08.681255+00,1,322,322
clubs,2026-08-31 10:17:57.672774+00,1,323,323
clubs,2026-08-31 17:37:25.076744+00,1,324,324
clubs,2026-09-07 02:22:40.843909+00,1,325,325
clubs,2026-09-07 02:24:34.759741+00,1,326,326
clubs,2026-09-07 02:24:54.751889+00,1,327,327
clubs,2026-10-08 02:09:37.543123+00,1,328,328
fixtures,2026-07-15 02:46:09.476302+00,1,1,1
fixtures,2026-07-15 02:46:21.574868+00,1,6,6
fixtures,2026-07-15 02:46:21.584173+00,1,7,7
fixtures,2026-07-15 02:46:21.597339+00,1,8,8
fixtures,2026-07-15 02:46:21.606303+00,1,9,9
fixtures,2026-07-15 02:46:21.618301+00,1,10,10
fixtures,2026-07-15 02:46:21.626055+00,1,11,11
fixtures,2026-07-15 02:46:21.634296+00,1,12,12
fixtures,2026-07-15 02:46:21.642968+00,1,13,13
fixtures,2026-07-15 02:46:35.580606+00,1,14,14
fixtures,2026-07-15 02:46:35.674059+00,1,15,15
fixtures,2026-07-15 02:46:35.683168+00,1,16,16
fixtures,2026-07-15 02:46:35.6903+00,1,17,17
fixtures,2026-07-15 02:46:35.69685+00,1,18,18
fixtures,2026-07-15 02:46:35.710118+00,1,20,20
fixtures,2026-07-15 02:46:35.716217+00,1,21,21
fixtures,2026-07-15 02:46:59.017368+00,1,22,22
fixtures,2026-07-15 02:46:59.030628+00,1,23,23
fixtures,2026-07-15 02:46:59.038842+00,1,24,24
fixtures,2026-07-15 02:46:59.121421+00,1,25,25
fixtures,2026-07-15 02:46:59.130107+00,1,26,26
fixtures,2026-07-15 02:46:59.138973+00,1,27,27
fixtures,2026-07-15 02:46:59.150015+00,1,28,28
fixtures,2026-07-15 02:46:59.159072+00,1,29,29
players,2026-07-15 02:46:09.468568+00,52,1,54
players,2026-07-16 15:39:50.107051+00,1,55,55
players,2026-07-16 15:39:53.470106+00,1,56,56
players,2026-07-16 15:39:56.666224+00,1,57,57
players,2026-07-16 15:39:59.799873+00,1,58,58
players,2026-07-16 16:06:06.784113+00,1,59,59
players,2026-07-16 16:06:10.107624+00,1,60,60
players,2026-07-16 16:06:13.360477+00,1,61,61
players,2026-07-16 16:06:16.609093+00,1,62,62
players,2026-07-16 16:06:19.978684+00,1,63,63
players,2026-07-16 16:06:23.214182+00,1,64,64
players,2026-07-16 16:06:27.174801+00,1,65,65
players,2026-07-16 16:06:30.434009+00,1,66,66
players,2026-07-16 16:06:33.68304+00,1,67,67
players,2026-07-16 16:06:37.003747+00,1,68,68
players,2026-07-16 16:06:40.32084+00,1,69,69
players,2026-07-16 16:06:43.796662+00,1,70,70
players,2026-07-16 16:06:47.02122+00,1,71,71
players,2026-07-16 16:06:50.221557+00,1,72,72
players,2026-07-16 16:06:53.445033+00,1,73,73
players,2026-07-16 16:06:56.6388+00,1,74,74
players,2026-07-16 16:06:59.947145+00,1,75,75
players,2026-07-16 16:07:03.315839+00,1,76,76
players,2026-07-16 16:07:06.661556+00,1,77,77
players,2026-08-25 18:51:19.797843+00,1,303,303
players,2026-10-08 02:09:37.543123+00,2,304,305
transfers,2026-07-15 02:56:35.049335+00,1,7,7
transfers,2026-07-15 02:58:13.097879+00,1,8,8
transfers,2026-07-15 03:00:33.174911+00,1,9,9
transfers,2026-07-15 15:05:34.907628+00,1,10,10
transfers,2026-07-15 15:05:41.908947+00,1,11,11
transfers,2026-07-15 15:05:49.114631+00,1,12,12
transfers,2026-07-15 15:06:03.000757+00,1,13,13
transfers,2026-07-15 15:11:27.966434+00,1,14,14
transfers,2026-07-15 15:13:06.030871+00,1,15,15
transfers,2026-07-16 19:09:14.146081+00,1,16,16
transfers,2026-07-16 19:09:44.059356+00,1,18,18
transfers,2026-07-16 19:14:23.35231+00,1,19,19
transfers,2026-07-20 15:18:45.005297+00,1,21,21
transfers,2026-07-20 15:21:14.831496+00,1,22,22
transfers,2026-07-23 17:35:59.708527+00,1,26,26
transfers,2026-07-23 17:36:44.382536+00,1,27,27
transfers,2026-07-23 17:36:54.708771+00,1,28,28
transfers,2026-07-23 17:37:54.712129+00,1,29,29
transfers,2026-07-23 17:38:02.726577+00,1,30,30

```

**Recursive foreign-key closure**

```text
[
  {
    "table_name": "clubs"
  },
  {
    "table_name": "eligibility_signals"
  },
  {
    "table_name": "fixture_players"
  },
  {
    "table_name": "fixtures"
  },
  {
    "table_name": "injuries"
  },
  {
    "table_name": "match_logs"
  },
  {
    "table_name": "national_team_windows"
  },
  {
    "table_name": "news_article_players"
  },
  {
    "table_name": "news_articles"
  },
  {
    "table_name": "player_candidates"
  },
  {
    "table_name": "player_stats"
  },
  {
    "table_name": "player_status_history"
  },
  {
    "table_name": "players"
  },
  {
    "table_name": "transfers"
  },
  {
    "table_name": "user_follows"
  }
]
```

Following are the row-evidence SELECTs and bound parameters. They are included to make the audit reproducible; none changes data. Arrays are fingerprint inputs, not current article rows. There is deliberately no destructive SQL text.

**clubs — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT id,name,league,country,logo_url,api_football_team_id,created_at FROM clubs WHERE name=ANY($1::text[]) OR created_at<$2::timestamptz) t",
  "params": [
    [
      "AC Milan",
      "Juventus",
      "Bournemouth",
      "Fulham",
      "Atalanta",
      "PSV Eindhoven",
      "AS Monaco",
      "Olympique de Marseille",
      "Crystal Palace",
      "Borussia Dortmund",
      "Norwich City",
      "Union Berlin",
      "Middlesbrough",
      "AZ Alkmaar",
      "Como 1907",
      "Philadelphia Union",
      "FC Barcelona",
      "Inter Miami CF",
      "Werder Bremen",
      "Seattle Sounders FC",
      "New England Revolution",
      "FC Augsburg",
      "Bayern Munich",
      "Real Salt Lake",
      "San Jose Earthquakes",
      "Chicago Fire",
      "New York City FC",
      "Columbus Crew",
      "Villarreal",
      "Toulouse",
      "Charlotte FC",
      "FC Cincinnati",
      "Borussia Monchengladbach",
      "Celtic",
      "Vancouver Whitecaps",
      "Leeds United",
      "Club America",
      "Coventry City",
      "Chelsea",
      "Hamburger SV",
      "SV Elversberg",
      "Hajduk Split",
      "San Diego FC",
      "Benfica",
      "Bayer Leverkusen",
      "Bayern Munich II",
      "Lyon",
      "Lyngby Boldklub",
      "Real Monarchs",
      "Benfica B",
      "Orlando City SC",
      "Orlando City II"
    ],
    "2026-07-15T02:46:10Z"
  ]
}
```

**players — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT p.id,p.name,p.slug,p.position,p.category,c.name AS club,p.photo_url,p.age,p.contract_until,p.market_value_usd,p.national_team_caps,p.national_team_goals,p.youth_national_team,p.debut_date,p.potential_call_up_score,p.bio,p.world_cup_roster,p.api_football_player_id,p.wikipedia_title,p.date_of_birth,p.squad_last_checked_at,p.created_at FROM players p JOIN clubs c ON c.id=p.club_id WHERE p.slug=ANY($1::text[]) OR p.created_at<$2::timestamptz) t",
  "params": [
    [
      "christian-pulisic",
      "weston-mckennie",
      "tyler-adams",
      "antonee-robinson",
      "yunus-musah",
      "ricardo-pepi",
      "folarin-balogun",
      "timothy-weah",
      "malik-tillman",
      "sergino-dest",
      "chris-richards",
      "matt-turner",
      "giovanni-reyna",
      "josh-sargent",
      "paxten-aaronson",
      "aidan-morris",
      "djordje-mihailovic",
      "tanner-tessmann",
      "cavan-sullivan",
      "diego-kochen",
      "benjamin-cremaschi",
      "noel-buck",
      "obed-vargas",
      "nimfasha-berchimas",
      "mathis-albert",
      "noahkai-banks",
      "leonard-prescott",
      "zavier-gozo",
      "chris-brady",
      "matt-freese",
      "max-arfsten",
      "alex-freeman",
      "mark-mckenzie",
      "tim-ream",
      "miles-robinson",
      "joe-scally",
      "auston-trusty",
      "sebastian-berhalter",
      "cristian-roldan",
      "brenden-aaronson",
      "alejandro-zendejas",
      "haji-wright",
      "diego-luna",
      "gaga-slonina",
      "caleb-wiley",
      "damion-downs",
      "cole-campbell",
      "bajung-darboe",
      "montrell-culbreath",
      "rokas-pukstas",
      "quinn-sullivan",
      "luca-bombino",
      "peyton-miller",
      "joshua-wynder",
      "justin-ellis"
    ],
    "2026-07-15T02:46:10Z"
  ]
}
```

**windows — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT * FROM national_team_windows) t",
  "params": []
}
```

**fixtures — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT * FROM fixtures WHERE created_at<$1::timestamptz OR (is_national_team AND ((home_team IN ('USA','United States') AND away_team IN ('Belgium','Jamaica','Trinidad and Tobago','Panama','Colombia')) OR (away_team IN ('USA','United States') AND home_team IN ('Belgium','Jamaica','Trinidad and Tobago','Panama','Colombia'))))) t",
  "params": [
    "2026-07-15T02:46:10Z"
  ]
}
```

**transfers — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT t.*,p.name AS player FROM transfers t LEFT JOIN players p ON p.id=t.player_id) t",
  "params": []
}
```

**injuryMatches — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT i.*,p.name AS player FROM injuries i LEFT JOIN players p ON p.id=i.player_id WHERE i.created_at<$1::timestamptz OR i.latest_update=ANY($2::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements($3::jsonb) s WHERE s->>'player'=p.name AND s->>'bodyPart'=i.body_part AND (DATE '2026-07-13' - (s->>'startDaysAgo')::int)=i.start_date)) t",
  "params": [
    "2026-07-15T02:46:10Z",
    [
      "Suffered the injury on a heavy challenge during the USMNT's World Cup match against Belgium. Ruled out several weeks; timeline to be reassessed after a follow-up scan.",
      "Cleared for non-contact training; expected to rejoin full sessions within two weeks.",
      "Dortmund's medical staff say Reyna will be reassessed after a further week of rehab.",
      "Made a full 75-minute return to the Bournemouth starting XI over the weekend without setback.",
      "Sargent is back running on the pitch and targeting a return for Norwich's next home fixture.",
      "Barcelona's academy staff are managing the injury conservatively given his age and workload.",
      "Back to full training with Seattle and available for selection."
    ],
    "[{\"player\":\"Christian Pulisic\",\"bodyPart\":\"Tibia/Fibula (micro-fracture)\",\"status\":\"active\",\"expectedReturn\":\"2026-08-06\",\"daysMissed\":4,\"matchesMissed\":1,\"latestUpdate\":\"Suffered the injury on a heavy challenge during the USMNT's World Cup match against Belgium. Ruled out several weeks; timeline to be reassessed after a follow-up scan.\",\"startDaysAgo\":4},{\"player\":\"Sergiño Dest\",\"bodyPart\":\"Knee\",\"status\":\"recovering\",\"expectedReturn\":\"2026-07-23\",\"daysMissed\":38,\"matchesMissed\":9,\"latestUpdate\":\"Cleared for non-contact training; expected to rejoin full sessions within two weeks.\",\"startDaysAgo\":38},{\"player\":\"Giovanni Reyna\",\"bodyPart\":\"Hamstring\",\"status\":\"active\",\"expectedReturn\":\"2026-08-03\",\"daysMissed\":14,\"matchesMissed\":3,\"latestUpdate\":\"Dortmund's medical staff say Reyna will be reassessed after a further week of rehab.\",\"startDaysAgo\":14},{\"player\":\"Tyler Adams\",\"bodyPart\":\"Hamstring\",\"status\":\"returned\",\"expectedReturn\":\"2026-07-07\",\"daysMissed\":91,\"matchesMissed\":18,\"latestUpdate\":\"Made a full 75-minute return to the Bournemouth starting XI over the weekend without setback.\",\"startDaysAgo\":97},{\"player\":\"Josh Sargent\",\"bodyPart\":\"Ankle\",\"status\":\"recovering\",\"expectedReturn\":\"2026-07-18\",\"daysMissed\":12,\"matchesMissed\":2,\"latestUpdate\":\"Sargent is back running on the pitch and targeting a return for Norwich's next home fixture.\",\"startDaysAgo\":12},{\"player\":\"Diego Kochen\",\"bodyPart\":\"Wrist\",\"status\":\"active\",\"expectedReturn\":\"2026-07-28\",\"daysMissed\":8,\"matchesMissed\":1,\"latestUpdate\":\"Barcelona's academy staff are managing the injury conservatively given his age and workload.\",\"startDaysAgo\":8},{\"player\":\"Obed Vargas\",\"bodyPart\":\"Groin\",\"status\":\"returned\",\"expectedReturn\":\"2026-06-29\",\"daysMissed\":21,\"matchesMissed\":4,\"latestUpdate\":\"Back to full training with Seattle and available for selection.\",\"startDaysAgo\":35}]"
  ]
}
```

**nullLogs — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT m.*,p.name AS player FROM match_logs m LEFT JOIN players p ON p.id=m.player_id WHERE m.api_football_fixture_id IS NULL OR m.created_at<$1::timestamptz) t",
  "params": [
    "2026-07-15T02:46:10Z"
  ]
}
```

**historicalFixtureMatches — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT f.* FROM fixtures f WHERE EXISTS (SELECT 1 FROM jsonb_array_elements($1::jsonb) s WHERE s->>'homeTeam'=f.home_team AND s->>'awayTeam'=f.away_team AND f.kickoff::date=DATE '2026-07-13' + (s->>'daysFromNow')::int) OR (f.id<=5)) t",
  "params": [
    "[{\"isNationalTeam\":true,\"competition\":\"FIFA World Cup\",\"daysFromNow\":-4,\"hour\":15,\"venue\":\"AT&T Stadium, Arlington\",\"homeTeam\":\"USA\",\"awayTeam\":\"Belgium\",\"homeScore\":1,\"awayScore\":4,\"status\":\"finished\",\"tvNetwork\":\"Fox\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Weston McKennie\",\"Tyler Adams\",\"Antonee Robinson\",\"Matt Turner\"]},{\"isNationalTeam\":true,\"competition\":\"CONCACAF Nations League\",\"daysFromNow\":42,\"hour\":19,\"venue\":\"Allianz Field, Saint Paul\",\"homeTeam\":\"USA\",\"awayTeam\":\"Jamaica\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Weston McKennie\",\"Tyler Adams\",\"Antonee Robinson\",\"Ricardo Pepi\",\"Matt Turner\"]},{\"isNationalTeam\":true,\"competition\":\"CONCACAF Nations League\",\"daysFromNow\":46,\"hour\":20,\"venue\":\"Q2 Stadium, Austin\",\"homeTeam\":\"USA\",\"awayTeam\":\"Trinidad and Tobago\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Malik Tillman\",\"Folarin Balogun\",\"Timothy Weah\",\"Chris Richards\"]},{\"isNationalTeam\":true,\"competition\":\"International Friendly\",\"daysFromNow\":119,\"hour\":19,\"venue\":\"Allianz Field, Saint Paul\",\"homeTeam\":\"USA\",\"awayTeam\":\"Panama\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Weston McKennie\",\"Tyler Adams\",\"Yunus Musah\",\"Ricardo Pepi\"]},{\"isNationalTeam\":true,\"competition\":\"International Friendly\",\"daysFromNow\":123,\"hour\":20,\"venue\":\"Q2 Stadium, Austin\",\"homeTeam\":\"USA\",\"awayTeam\":\"Colombia\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Malik Tillman\",\"Folarin Balogun\",\"Timothy Weah\",\"Sergiño Dest\"]},{\"isNationalTeam\":true,\"competition\":\"FIFA World Cup\",\"daysFromNow\":-4,\"hour\":15,\"venue\":\"AT&T Stadium, Arlington\",\"homeTeam\":\"USA\",\"awayTeam\":\"Belgium\",\"homeScore\":1,\"awayScore\":4,\"status\":\"finished\",\"tvNetwork\":\"Fox\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Weston McKennie\",\"Tyler Adams\",\"Antonee Robinson\",\"Yunus Musah\",\"Matt Turner\"]},{\"isNationalTeam\":true,\"competition\":\"International Friendly\",\"daysFromNow\":42,\"hour\":19,\"venue\":\"Allianz Field, Saint Paul\",\"homeTeam\":\"USA\",\"awayTeam\":\"Panama\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Weston McKennie\",\"Tyler Adams\",\"Antonee Robinson\",\"Yunus Musah\",\"Ricardo Pepi\",\"Matt Turner\"]},{\"isNationalTeam\":true,\"competition\":\"International Friendly\",\"daysFromNow\":46,\"hour\":20,\"venue\":\"Q2 Stadium, Austin\",\"homeTeam\":\"USA\",\"awayTeam\":\"Colombia\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Malik Tillman\",\"Folarin Balogun\",\"Timothy Weah\",\"Chris Richards\"]},{\"isNationalTeam\":true,\"competition\":\"FIFA World Cup\",\"daysFromNow\":-4,\"hour\":15,\"venue\":\"AT&T Stadium, Arlington\",\"homeTeam\":\"USA\",\"awayTeam\":\"Belgium\",\"homeScore\":2,\"awayScore\":1,\"status\":\"finished\",\"tvNetwork\":\"Fox\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Weston McKennie\",\"Tyler Adams\",\"Antonee Robinson\",\"Yunus Musah\",\"Matt Turner\"]},{\"isNationalTeam\":false,\"competition\":\"Serie A\",\"daysFromNow\":0,\"hour\":14,\"venue\":\"San Siro, Milan\",\"homeTeam\":\"AC Milan\",\"awayTeam\":\"Inter\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"CBS Sports Network\",\"streamingService\":\"Paramount+\",\"broadcastLink\":null,\"featured\":[]},{\"isNationalTeam\":false,\"competition\":\"Premier League\",\"daysFromNow\":0,\"hour\":15,\"venue\":\"Vitality Stadium, Bournemouth\",\"homeTeam\":\"Bournemouth\",\"awayTeam\":\"Fulham\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"USA Network\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Tyler Adams\",\"Antonee Robinson\"]},{\"isNationalTeam\":false,\"competition\":\"Eredivisie\",\"daysFromNow\":0,\"hour\":18,\"venue\":\"Philips Stadion, Eindhoven\",\"homeTeam\":\"PSV Eindhoven\",\"awayTeam\":\"AZ Alkmaar\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":null,\"streamingService\":\"ESPN+\",\"broadcastLink\":null,\"featured\":[\"Ricardo Pepi\",\"Malik Tillman\",\"Sergiño Dest\",\"Djordje Mihailovic\"]},{\"isNationalTeam\":false,\"competition\":\"Serie A\",\"daysFromNow\":1,\"hour\":12,\"venue\":\"Allianz Stadium, Turin\",\"homeTeam\":\"Juventus\",\"awayTeam\":\"Bologna\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"CBS Sports Network\",\"streamingService\":\"Paramount+\",\"broadcastLink\":null,\"featured\":[\"Weston McKennie\"]},{\"isNationalTeam\":false,\"competition\":\"Ligue 1\",\"daysFromNow\":2,\"hour\":19,\"venue\":\"Stade Louis II, Monaco\",\"homeTeam\":\"AS Monaco\",\"awayTeam\":\"Lille\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":null,\"streamingService\":\"beIN Sports\",\"broadcastLink\":null,\"featured\":[\"Folarin Balogun\"]},{\"isNationalTeam\":false,\"competition\":\"Bundesliga\",\"daysFromNow\":3,\"hour\":13,\"venue\":\"Signal Iduna Park, Dortmund\",\"homeTeam\":\"Borussia Dortmund\",\"awayTeam\":\"Mainz\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":null,\"streamingService\":\"ESPN+\",\"broadcastLink\":null,\"featured\":[\"Giovanni Reyna\"]},{\"isNationalTeam\":false,\"competition\":\"Championship\",\"daysFromNow\":4,\"hour\":14,\"venue\":\"Carrow Road, Norwich\",\"homeTeam\":\"Norwich City\",\"awayTeam\":\"Leeds United\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":null,\"streamingService\":\"ESPN+\",\"broadcastLink\":null,\"featured\":[\"Josh Sargent\"]},{\"isNationalTeam\":false,\"competition\":\"MLS\",\"daysFromNow\":5,\"hour\":20,\"venue\":\"Subaru Park, Philadelphia\",\"homeTeam\":\"Philadelphia Union\",\"awayTeam\":\"Columbus Crew\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":null,\"streamingService\":\"Apple TV\",\"broadcastLink\":null,\"featured\":[\"Cavan Sullivan\"]},{\"isNationalTeam\":false,\"competition\":\"MLS\",\"daysFromNow\":5,\"hour\":21,\"venue\":\"Chase Stadium, Fort Lauderdale\",\"homeTeam\":\"Inter Miami CF\",\"awayTeam\":\"Atlanta United\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":null,\"streamingService\":\"Apple TV\",\"broadcastLink\":null,\"featured\":[\"Benjamin Cremaschi\"]},{\"isNationalTeam\":false,\"competition\":\"Premier League\",\"daysFromNow\":-3,\"hour\":15,\"venue\":\"Selhurst Park, London\",\"homeTeam\":\"Crystal Palace\",\"awayTeam\":\"Everton\",\"homeScore\":2,\"awayScore\":1,\"status\":\"finished\",\"tvNetwork\":\"USA Network\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Chris Richards\",\"Matt Turner\"]},{\"isNationalTeam\":true,\"competition\":\"World Cup Qualifying\",\"daysFromNow\":42,\"hour\":19,\"venue\":\"Allianz Field, Saint Paul\",\"homeTeam\":\"USA\",\"awayTeam\":\"Panama\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"TNT\",\"streamingService\":\"Fubo\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\",\"Weston McKennie\",\"Tyler Adams\",\"Antonee Robinson\",\"Yunus Musah\",\"Ricardo Pepi\",\"Matt Turner\"]},{\"isNationalTeam\":false,\"competition\":\"Serie A\",\"daysFromNow\":0,\"hour\":14,\"venue\":\"San Siro, Milan\",\"homeTeam\":\"AC Milan\",\"awayTeam\":\"Inter\",\"homeScore\":null,\"awayScore\":null,\"status\":\"scheduled\",\"tvNetwork\":\"CBS Sports Network\",\"streamingService\":\"Paramount+\",\"broadcastLink\":null,\"featured\":[\"Christian Pulisic\"]}]"
  ]
}
```

**fixtureLinks — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT fp.*,p.name AS player,f.home_team,f.away_team,f.kickoff,f.created_at AS parent_created_at FROM fixture_players fp JOIN fixtures f ON f.id=fp.fixture_id LEFT JOIN players p ON p.id=fp.player_id WHERE f.id<=5 OR f.created_at<$1::timestamptz) t",
  "params": [
    "2026-07-15T02:46:10Z"
  ]
}
```

**newsMatches — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT n.* FROM news_articles n WHERE n.id NOT BETWEEN 1 AND 12 AND (n.headline=ANY($1::text[]) OR n.summary=ANY($2::text[]) OR n.created_at<$3::timestamptz)) t",
  "params": [
    [
      "Tyler Adams returns to the starting XI after hamstring scare",
      "Malik Tillman nets brace as PSV cruise past AZ",
      "Folarin Balogun linked with Ligue 1 rivals amid patchy Monaco minutes",
      "Christian Pulisic ruled out several weeks with tibia/fibula injury from Belgium clash",
      "Chris Richards signs contract extension through 2028",
      "Gio Reyna limited to bench role again at Dortmund",
      "Weston McKennie's agent confirms Juventus wants new deal",
      "Cavan Sullivan named to preliminary U-20 squad",
      "Djordje Mihailovic quietly posts a career-best assist tally",
      "Sergiño Dest working back to full fitness after knee issue",
      "Ricardo Pepi's goal streak draws Bundesliga interest",
      "US Soccer confirms September qualifying window dates and venues",
      "Christian Pulisic named Milan's Player of the Month"
    ],
    [
      "Tyler Adams started for Bournemouth for the first time in three weeks, playing 75 minutes before being withdrawn as a precaution. He looked sharp in the tackle and controlled tempo from deep.",
      "Malik Tillman scored twice and set up a third as PSV extended their unbeaten run, continuing arguably the best form of any American abroad this season.",
      "Sources close to the player suggest Balogun is growing frustrated with rotation at Monaco, with at least two Ligue 1 clubs monitoring his situation ahead of the winter window.",
      "Pulisic was withdrawn late in the USMNT's World Cup match against Belgium after a heavy challenge left him with a micro-fracture in his tibia/fibula. Scans have confirmed a moderate injury expected to keep him out for several weeks.",
      "Crystal Palace confirmed Chris Richards has signed a new three-year deal, rewarding a breakout season at the heart of their defense.",
      "Reyna made a late substitute appearance in Dortmund's midweek win, his fourth straight game starting from the bench under the current manager.",
      "McKennie's representatives confirmed talks are underway over an extension that would keep the midfielder in Turin beyond 2027.",
      "The 15-year-old Philadelphia Union forward was included in the preliminary U-20 roster, another step in an accelerated development pathway.",
      "Mihailovic's ten assists in the Eredivisie put him among the league's most productive creators, a number that has flown under the radar stateside.",
      "Dest featured for PSV's reserve side as part of a graded return-to-play plan, with the club hopeful he rejoins first-team training within two weeks.",
      "Pepi's run of six goals in seven Eredivisie appearances has reportedly attracted scouting interest from two Bundesliga clubs ahead of the summer window.",
      "The federation confirmed Saint Paul and Austin will host the USMNT's next qualifying and friendly fixtures, with ticket details to follow.",
      "Pulisic was voted AC Milan's Player of the Month after contributing four goals and three assists across six appearances, his best individual run in Serie A to date."
    ],
    "2026-07-15T02:46:10Z"
  ]
}
```

**newsLinks — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT np.id,np.article_id,np.player_id,p.name AS player,n.created_at AS parent_created_at FROM news_article_players np LEFT JOIN players p ON p.id=np.player_id LEFT JOIN news_articles n ON n.id=np.article_id WHERE np.article_id BETWEEN 1 AND 12 OR (n.id NOT BETWEEN 1 AND 12 AND n.headline=ANY($1::text[]))) t",
  "params": [
    [
      "Tyler Adams returns to the starting XI after hamstring scare",
      "Malik Tillman nets brace as PSV cruise past AZ",
      "Folarin Balogun linked with Ligue 1 rivals amid patchy Monaco minutes",
      "Christian Pulisic ruled out several weeks with tibia/fibula injury from Belgium clash",
      "Chris Richards signs contract extension through 2028",
      "Gio Reyna limited to bench role again at Dortmund",
      "Weston McKennie's agent confirms Juventus wants new deal",
      "Cavan Sullivan named to preliminary U-20 squad",
      "Djordje Mihailovic quietly posts a career-best assist tally",
      "Sergiño Dest working back to full fitness after knee issue",
      "Ricardo Pepi's goal streak draws Bundesliga interest",
      "US Soccer confirms September qualifying window dates and venues",
      "Christian Pulisic named Milan's Player of the Month"
    ]
  ]
}
```

**statsMatches — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT ps.*,p.name AS player FROM player_stats ps LEFT JOIN players p ON p.id=ps.player_id WHERE ps.created_at<$1::timestamptz OR EXISTS (SELECT 1 FROM jsonb_array_elements($2::jsonb) s WHERE s->>'player'=p.name AND to_jsonb(ps) @> (s-'player'))) t",
  "params": [
    "2026-07-15T02:46:10Z",
    "[{\"player\":\"Christian Pulisic\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2450,\"starts\":27,\"goals\":14,\"assists\":9,\"shots\":78,\"key_passes\":54,\"pass_completion_pct\":82.4,\"tackles\":22,\"interceptions\":14,\"duels_won_pct\":51.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.4},{\"player\":\"Christian Pulisic\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":383,\"starts\":4,\"goals\":2,\"assists\":1,\"shots\":12,\"key_passes\":8,\"pass_completion_pct\":82.4,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":51.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.4},{\"player\":\"Christian Pulisic\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2083,\"starts\":23,\"goals\":12,\"assists\":8,\"shots\":66,\"key_passes\":46,\"pass_completion_pct\":82.4,\"tackles\":19,\"interceptions\":12,\"duels_won_pct\":51.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.4},{\"player\":\"Weston McKennie\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2280,\"starts\":26,\"goals\":7,\"assists\":4,\"shots\":41,\"key_passes\":22,\"pass_completion_pct\":86.1,\"tackles\":48,\"interceptions\":26,\"duels_won_pct\":58.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Weston McKennie\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":356,\"starts\":4,\"goals\":1,\"assists\":1,\"shots\":6,\"key_passes\":3,\"pass_completion_pct\":86.1,\"tackles\":8,\"interceptions\":4,\"duels_won_pct\":58.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Weston McKennie\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1938,\"starts\":22,\"goals\":6,\"assists\":3,\"shots\":35,\"key_passes\":19,\"pass_completion_pct\":86.1,\"tackles\":41,\"interceptions\":22,\"duels_won_pct\":58.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Tyler Adams\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1580,\"starts\":18,\"goals\":0,\"assists\":2,\"shots\":9,\"key_passes\":14,\"pass_completion_pct\":89.7,\"tackles\":68,\"interceptions\":44,\"duels_won_pct\":62.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Tyler Adams\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":247,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":2,\"pass_completion_pct\":89.7,\"tackles\":11,\"interceptions\":7,\"duels_won_pct\":62.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Tyler Adams\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1343,\"starts\":15,\"goals\":0,\"assists\":2,\"shots\":8,\"key_passes\":12,\"pass_completion_pct\":89.7,\"tackles\":58,\"interceptions\":37,\"duels_won_pct\":62.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Antonee Robinson\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2610,\"starts\":29,\"goals\":2,\"assists\":6,\"shots\":24,\"key_passes\":38,\"pass_completion_pct\":80.5,\"tackles\":52,\"interceptions\":34,\"duels_won_pct\":55.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7},{\"player\":\"Antonee Robinson\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":408,\"starts\":5,\"goals\":0,\"assists\":1,\"shots\":4,\"key_passes\":6,\"pass_completion_pct\":80.5,\"tackles\":8,\"interceptions\":5,\"duels_won_pct\":55.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7},{\"player\":\"Antonee Robinson\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2219,\"starts\":25,\"goals\":2,\"assists\":5,\"shots\":20,\"key_passes\":32,\"pass_completion_pct\":80.5,\"tackles\":44,\"interceptions\":29,\"duels_won_pct\":55.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7},{\"player\":\"Yunus Musah\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2140,\"starts\":24,\"goals\":1,\"assists\":3,\"shots\":18,\"key_passes\":19,\"pass_completion_pct\":90.2,\"tackles\":44,\"interceptions\":22,\"duels_won_pct\":56.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Yunus Musah\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":334,\"starts\":4,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":3,\"pass_completion_pct\":90.2,\"tackles\":7,\"interceptions\":3,\"duels_won_pct\":56.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Yunus Musah\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1819,\"starts\":20,\"goals\":1,\"assists\":3,\"shots\":15,\"key_passes\":16,\"pass_completion_pct\":90.2,\"tackles\":37,\"interceptions\":19,\"duels_won_pct\":56.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Ricardo Pepi\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2380,\"starts\":27,\"goals\":18,\"assists\":5,\"shots\":92,\"key_passes\":21,\"pass_completion_pct\":76.9,\"tackles\":8,\"interceptions\":6,\"duels_won_pct\":48.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.5},{\"player\":\"Ricardo Pepi\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":372,\"starts\":4,\"goals\":3,\"assists\":1,\"shots\":14,\"key_passes\":3,\"pass_completion_pct\":76.9,\"tackles\":1,\"interceptions\":1,\"duels_won_pct\":48.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.5},{\"player\":\"Ricardo Pepi\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2023,\"starts\":23,\"goals\":15,\"assists\":4,\"shots\":78,\"key_passes\":18,\"pass_completion_pct\":76.9,\"tackles\":7,\"interceptions\":5,\"duels_won_pct\":48.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.5},{\"player\":\"Folarin Balogun\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1720,\"starts\":19,\"goals\":9,\"assists\":2,\"shots\":61,\"key_passes\":14,\"pass_completion_pct\":74.2,\"tackles\":6,\"interceptions\":4,\"duels_won_pct\":46.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Folarin Balogun\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":269,\"starts\":3,\"goals\":1,\"assists\":0,\"shots\":10,\"key_passes\":2,\"pass_completion_pct\":74.2,\"tackles\":1,\"interceptions\":1,\"duels_won_pct\":46.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Folarin Balogun\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1462,\"starts\":16,\"goals\":8,\"assists\":2,\"shots\":52,\"key_passes\":12,\"pass_completion_pct\":74.2,\"tackles\":5,\"interceptions\":3,\"duels_won_pct\":46.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Timothy Weah\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1980,\"starts\":22,\"goals\":5,\"assists\":4,\"shots\":38,\"key_passes\":26,\"pass_completion_pct\":79.8,\"tackles\":24,\"interceptions\":12,\"duels_won_pct\":52.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Timothy Weah\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":309,\"starts\":3,\"goals\":1,\"assists\":1,\"shots\":6,\"key_passes\":4,\"pass_completion_pct\":79.8,\"tackles\":4,\"interceptions\":2,\"duels_won_pct\":52.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Timothy Weah\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1683,\"starts\":19,\"goals\":4,\"assists\":3,\"shots\":32,\"key_passes\":22,\"pass_completion_pct\":79.8,\"tackles\":20,\"interceptions\":10,\"duels_won_pct\":52.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Malik Tillman\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2560,\"starts\":28,\"goals\":12,\"assists\":11,\"shots\":71,\"key_passes\":62,\"pass_completion_pct\":81.6,\"tackles\":18,\"interceptions\":10,\"duels_won_pct\":49.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.6},{\"player\":\"Malik Tillman\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":400,\"starts\":4,\"goals\":2,\"assists\":2,\"shots\":11,\"key_passes\":10,\"pass_completion_pct\":81.6,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":49.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.6},{\"player\":\"Malik Tillman\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2176,\"starts\":24,\"goals\":10,\"assists\":9,\"shots\":60,\"key_passes\":53,\"pass_completion_pct\":81.6,\"tackles\":15,\"interceptions\":9,\"duels_won_pct\":49.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.6},{\"player\":\"Sergiño Dest\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1340,\"starts\":15,\"goals\":1,\"assists\":3,\"shots\":16,\"key_passes\":22,\"pass_completion_pct\":82.1,\"tackles\":26,\"interceptions\":16,\"duels_won_pct\":53.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Sergiño Dest\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":209,\"starts\":2,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":3,\"pass_completion_pct\":82.1,\"tackles\":4,\"interceptions\":3,\"duels_won_pct\":53.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Sergiño Dest\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1139,\"starts\":13,\"goals\":1,\"assists\":3,\"shots\":14,\"key_passes\":19,\"pass_completion_pct\":82.1,\"tackles\":22,\"interceptions\":14,\"duels_won_pct\":53.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Chris Richards\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2670,\"starts\":29,\"goals\":1,\"assists\":1,\"shots\":14,\"key_passes\":6,\"pass_completion_pct\":88.9,\"tackles\":42,\"interceptions\":58,\"duels_won_pct\":64.7,\"clean_sheets\":9,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Chris Richards\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":417,\"starts\":5,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":1,\"pass_completion_pct\":88.9,\"tackles\":7,\"interceptions\":9,\"duels_won_pct\":64.7,\"clean_sheets\":1,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Chris Richards\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2270,\"starts\":25,\"goals\":1,\"assists\":1,\"shots\":12,\"key_passes\":5,\"pass_completion_pct\":88.9,\"tackles\":36,\"interceptions\":49,\"duels_won_pct\":64.7,\"clean_sheets\":8,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Matt Turner\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":900,\"starts\":10,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":68.4,\"tackles\":0,\"interceptions\":2,\"duels_won_pct\":0,\"clean_sheets\":3,\"save_pct\":71.2,\"avg_rating\":6.6},{\"player\":\"Matt Turner\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":141,\"starts\":2,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":68.4,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":0,\"save_pct\":71.2,\"avg_rating\":6.6},{\"player\":\"Matt Turner\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":765,\"starts\":9,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":68.4,\"tackles\":0,\"interceptions\":2,\"duels_won_pct\":0,\"clean_sheets\":3,\"save_pct\":71.2,\"avg_rating\":6.6},{\"player\":\"Giovanni Reyna\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":980,\"starts\":10,\"goals\":3,\"assists\":3,\"shots\":26,\"key_passes\":18,\"pass_completion_pct\":83.5,\"tackles\":10,\"interceptions\":6,\"duels_won_pct\":47.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Giovanni Reyna\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":153,\"starts\":2,\"goals\":0,\"assists\":0,\"shots\":4,\"key_passes\":3,\"pass_completion_pct\":83.5,\"tackles\":2,\"interceptions\":1,\"duels_won_pct\":47.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Giovanni Reyna\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":833,\"starts\":9,\"goals\":3,\"assists\":3,\"shots\":22,\"key_passes\":15,\"pass_completion_pct\":83.5,\"tackles\":9,\"interceptions\":5,\"duels_won_pct\":47.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Josh Sargent\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2210,\"starts\":25,\"goals\":11,\"assists\":4,\"shots\":58,\"key_passes\":20,\"pass_completion_pct\":75.1,\"tackles\":12,\"interceptions\":8,\"duels_won_pct\":54.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Josh Sargent\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":345,\"starts\":4,\"goals\":2,\"assists\":1,\"shots\":9,\"key_passes\":3,\"pass_completion_pct\":75.1,\"tackles\":2,\"interceptions\":1,\"duels_won_pct\":54.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Josh Sargent\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1879,\"starts\":21,\"goals\":9,\"assists\":3,\"shots\":49,\"key_passes\":17,\"pass_completion_pct\":75.1,\"tackles\":10,\"interceptions\":7,\"duels_won_pct\":54.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Paxten Aaronson\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":860,\"starts\":8,\"goals\":2,\"assists\":3,\"shots\":20,\"key_passes\":16,\"pass_completion_pct\":84.7,\"tackles\":10,\"interceptions\":6,\"duels_won_pct\":50.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Paxten Aaronson\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":134,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":3,\"pass_completion_pct\":84.7,\"tackles\":2,\"interceptions\":1,\"duels_won_pct\":50.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Paxten Aaronson\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":731,\"starts\":7,\"goals\":2,\"assists\":3,\"shots\":17,\"key_passes\":14,\"pass_completion_pct\":84.7,\"tackles\":9,\"interceptions\":5,\"duels_won_pct\":50.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Aidan Morris\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1620,\"starts\":18,\"goals\":0,\"assists\":1,\"shots\":8,\"key_passes\":10,\"pass_completion_pct\":87.3,\"tackles\":56,\"interceptions\":34,\"duels_won_pct\":59.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Aidan Morris\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":253,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":2,\"pass_completion_pct\":87.3,\"tackles\":9,\"interceptions\":5,\"duels_won_pct\":59.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Aidan Morris\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1377,\"starts\":15,\"goals\":0,\"assists\":1,\"shots\":7,\"key_passes\":9,\"pass_completion_pct\":87.3,\"tackles\":48,\"interceptions\":29,\"duels_won_pct\":59.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Djordje Mihailovic\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2320,\"starts\":26,\"goals\":6,\"assists\":10,\"shots\":44,\"key_passes\":58,\"pass_completion_pct\":83,\"tackles\":20,\"interceptions\":12,\"duels_won_pct\":48.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Djordje Mihailovic\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":363,\"starts\":4,\"goals\":1,\"assists\":2,\"shots\":7,\"key_passes\":9,\"pass_completion_pct\":83,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":48.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Djordje Mihailovic\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1972,\"starts\":22,\"goals\":5,\"assists\":9,\"shots\":37,\"key_passes\":49,\"pass_completion_pct\":83,\"tackles\":17,\"interceptions\":10,\"duels_won_pct\":48.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Tanner Tessmann\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1740,\"starts\":19,\"goals\":1,\"assists\":2,\"shots\":12,\"key_passes\":12,\"pass_completion_pct\":88.1,\"tackles\":50,\"interceptions\":30,\"duels_won_pct\":57.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Tanner Tessmann\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":272,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":2,\"pass_completion_pct\":88.1,\"tackles\":8,\"interceptions\":5,\"duels_won_pct\":57.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Tanner Tessmann\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1479,\"starts\":16,\"goals\":1,\"assists\":2,\"shots\":10,\"key_passes\":10,\"pass_completion_pct\":88.1,\"tackles\":43,\"interceptions\":26,\"duels_won_pct\":57.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Cavan Sullivan\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":620,\"starts\":4,\"goals\":3,\"assists\":2,\"shots\":18,\"key_passes\":10,\"pass_completion_pct\":71.4,\"tackles\":4,\"interceptions\":2,\"duels_won_pct\":42.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Cavan Sullivan\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":97,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":2,\"pass_completion_pct\":71.4,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":42.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Cavan Sullivan\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":527,\"starts\":3,\"goals\":3,\"assists\":2,\"shots\":15,\"key_passes\":9,\"pass_completion_pct\":71.4,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":42.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Diego Kochen\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":270,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":65.2,\"tackles\":0,\"interceptions\":1,\"duels_won_pct\":0,\"clean_sheets\":1,\"save_pct\":68.8,\"avg_rating\":6.5},{\"player\":\"Diego Kochen\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":42,\"starts\":0,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":65.2,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":0,\"save_pct\":68.8,\"avg_rating\":6.5},{\"player\":\"Diego Kochen\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":230,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":65.2,\"tackles\":0,\"interceptions\":1,\"duels_won_pct\":0,\"clean_sheets\":1,\"save_pct\":68.8,\"avg_rating\":6.5},{\"player\":\"Benjamin Cremaschi\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1980,\"starts\":22,\"goals\":4,\"assists\":8,\"shots\":30,\"key_passes\":46,\"pass_completion_pct\":86.8,\"tackles\":24,\"interceptions\":16,\"duels_won_pct\":49.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Benjamin Cremaschi\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":309,\"starts\":3,\"goals\":1,\"assists\":1,\"shots\":5,\"key_passes\":7,\"pass_completion_pct\":86.8,\"tackles\":4,\"interceptions\":3,\"duels_won_pct\":49.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Benjamin Cremaschi\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1683,\"starts\":19,\"goals\":3,\"assists\":7,\"shots\":26,\"key_passes\":39,\"pass_completion_pct\":86.8,\"tackles\":20,\"interceptions\":14,\"duels_won_pct\":49.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Noel Buck\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":540,\"starts\":5,\"goals\":0,\"assists\":1,\"shots\":6,\"key_passes\":6,\"pass_completion_pct\":82.6,\"tackles\":16,\"interceptions\":10,\"duels_won_pct\":52.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Noel Buck\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":84,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":1,\"pass_completion_pct\":82.6,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":52.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Noel Buck\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":459,\"starts\":4,\"goals\":0,\"assists\":1,\"shots\":5,\"key_passes\":5,\"pass_completion_pct\":82.6,\"tackles\":14,\"interceptions\":9,\"duels_won_pct\":52.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Obed Vargas\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1640,\"starts\":17,\"goals\":1,\"assists\":2,\"shots\":14,\"key_passes\":14,\"pass_completion_pct\":85.4,\"tackles\":46,\"interceptions\":24,\"duels_won_pct\":55.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Obed Vargas\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":256,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":2,\"pass_completion_pct\":85.4,\"tackles\":7,\"interceptions\":4,\"duels_won_pct\":55.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Obed Vargas\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1394,\"starts\":14,\"goals\":1,\"assists\":2,\"shots\":12,\"key_passes\":12,\"pass_completion_pct\":85.4,\"tackles\":39,\"interceptions\":20,\"duels_won_pct\":55.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Nimfasha Berchimas\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":980,\"starts\":10,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":4,\"pass_completion_pct\":84.9,\"tackles\":22,\"interceptions\":20,\"duels_won_pct\":58.2,\"clean_sheets\":4,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Nimfasha Berchimas\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":153,\"starts\":2,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":1,\"pass_completion_pct\":84.9,\"tackles\":3,\"interceptions\":3,\"duels_won_pct\":58.2,\"clean_sheets\":1,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Nimfasha Berchimas\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":833,\"starts\":9,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":3,\"pass_completion_pct\":84.9,\"tackles\":19,\"interceptions\":17,\"duels_won_pct\":58.2,\"clean_sheets\":3,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Mathis Albert\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":640,\"starts\":6,\"goals\":4,\"assists\":3,\"shots\":22,\"key_passes\":16,\"pass_completion_pct\":78.6,\"tackles\":6,\"interceptions\":3,\"duels_won_pct\":44.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Mathis Albert\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":100,\"starts\":1,\"goals\":1,\"assists\":0,\"shots\":3,\"key_passes\":3,\"pass_completion_pct\":78.6,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":44.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Mathis Albert\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":544,\"starts\":5,\"goals\":3,\"assists\":3,\"shots\":19,\"key_passes\":14,\"pass_completion_pct\":78.6,\"tackles\":5,\"interceptions\":3,\"duels_won_pct\":44.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Noahkai Banks\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":810,\"starts\":9,\"goals\":0,\"assists\":1,\"shots\":5,\"key_passes\":3,\"pass_completion_pct\":86.3,\"tackles\":20,\"interceptions\":26,\"duels_won_pct\":61.4,\"clean_sheets\":3,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Noahkai Banks\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":127,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":0,\"pass_completion_pct\":86.3,\"tackles\":3,\"interceptions\":4,\"duels_won_pct\":61.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Noahkai Banks\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":689,\"starts\":8,\"goals\":0,\"assists\":1,\"shots\":4,\"key_passes\":3,\"pass_completion_pct\":86.3,\"tackles\":17,\"interceptions\":22,\"duels_won_pct\":61.4,\"clean_sheets\":3,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Leonard Prescott\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":90,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":60,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":1,\"save_pct\":75,\"avg_rating\":6.6},{\"player\":\"Leonard Prescott\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":14,\"starts\":0,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":60,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":0,\"save_pct\":75,\"avg_rating\":6.6},{\"player\":\"Leonard Prescott\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":77,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":60,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":1,\"save_pct\":75,\"avg_rating\":6.6},{\"player\":\"Zavier Gozo\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":420,\"starts\":4,\"goals\":2,\"assists\":1,\"shots\":14,\"key_passes\":6,\"pass_completion_pct\":76.2,\"tackles\":4,\"interceptions\":2,\"duels_won_pct\":46.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Zavier Gozo\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":66,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":1,\"pass_completion_pct\":76.2,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":46.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Zavier Gozo\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":357,\"starts\":3,\"goals\":2,\"assists\":1,\"shots\":12,\"key_passes\":5,\"pass_completion_pct\":76.2,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":46.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Chris Brady\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2340,\"starts\":26,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":74.8,\"tackles\":0,\"interceptions\":3,\"duels_won_pct\":0,\"clean_sheets\":8,\"save_pct\":69.4,\"avg_rating\":6.8},{\"player\":\"Chris Brady\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":366,\"starts\":4,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":74.8,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":1,\"save_pct\":69.4,\"avg_rating\":6.8},{\"player\":\"Chris Brady\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1989,\"starts\":22,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":74.8,\"tackles\":0,\"interceptions\":3,\"duels_won_pct\":0,\"clean_sheets\":7,\"save_pct\":69.4,\"avg_rating\":6.8},{\"player\":\"Matt Freese\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2610,\"starts\":29,\"goals\":0,\"assists\":1,\"shots\":0,\"key_passes\":2,\"pass_completion_pct\":78.2,\"tackles\":0,\"interceptions\":4,\"duels_won_pct\":0,\"clean_sheets\":11,\"save_pct\":72.6,\"avg_rating\":7},{\"player\":\"Matt Freese\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":408,\"starts\":5,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":78.2,\"tackles\":0,\"interceptions\":1,\"duels_won_pct\":0,\"clean_sheets\":2,\"save_pct\":72.6,\"avg_rating\":7},{\"player\":\"Matt Freese\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2219,\"starts\":25,\"goals\":0,\"assists\":1,\"shots\":0,\"key_passes\":2,\"pass_completion_pct\":78.2,\"tackles\":0,\"interceptions\":3,\"duels_won_pct\":0,\"clean_sheets\":9,\"save_pct\":72.6,\"avg_rating\":7},{\"player\":\"Max Arfsten\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2460,\"starts\":27,\"goals\":4,\"assists\":8,\"shots\":34,\"key_passes\":42,\"pass_completion_pct\":80.9,\"tackles\":40,\"interceptions\":24,\"duels_won_pct\":53.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Max Arfsten\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":384,\"starts\":4,\"goals\":1,\"assists\":1,\"shots\":5,\"key_passes\":7,\"pass_completion_pct\":80.9,\"tackles\":6,\"interceptions\":4,\"duels_won_pct\":53.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Max Arfsten\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2091,\"starts\":23,\"goals\":3,\"assists\":7,\"shots\":29,\"key_passes\":36,\"pass_completion_pct\":80.9,\"tackles\":34,\"interceptions\":20,\"duels_won_pct\":53.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Alex Freeman\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2380,\"starts\":26,\"goals\":5,\"assists\":11,\"shots\":40,\"key_passes\":56,\"pass_completion_pct\":81.4,\"tackles\":44,\"interceptions\":22,\"duels_won_pct\":56.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.6},{\"player\":\"Alex Freeman\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":372,\"starts\":4,\"goals\":1,\"assists\":2,\"shots\":6,\"key_passes\":9,\"pass_completion_pct\":81.4,\"tackles\":7,\"interceptions\":3,\"duels_won_pct\":56.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.6},{\"player\":\"Alex Freeman\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2023,\"starts\":22,\"goals\":4,\"assists\":9,\"shots\":34,\"key_passes\":48,\"pass_completion_pct\":81.4,\"tackles\":37,\"interceptions\":19,\"duels_won_pct\":56.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.6},{\"player\":\"Mark McKenzie\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2520,\"starts\":28,\"goals\":1,\"assists\":0,\"shots\":8,\"key_passes\":4,\"pass_completion_pct\":87.6,\"tackles\":46,\"interceptions\":62,\"duels_won_pct\":63.2,\"clean_sheets\":10,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Mark McKenzie\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":394,\"starts\":4,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":1,\"pass_completion_pct\":87.6,\"tackles\":7,\"interceptions\":10,\"duels_won_pct\":63.2,\"clean_sheets\":2,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Mark McKenzie\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2142,\"starts\":24,\"goals\":1,\"assists\":0,\"shots\":7,\"key_passes\":3,\"pass_completion_pct\":87.6,\"tackles\":39,\"interceptions\":53,\"duels_won_pct\":63.2,\"clean_sheets\":9,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Tim Ream\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2380,\"starts\":27,\"goals\":1,\"assists\":1,\"shots\":6,\"key_passes\":3,\"pass_completion_pct\":89.1,\"tackles\":38,\"interceptions\":58,\"duels_won_pct\":60.4,\"clean_sheets\":9,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Tim Ream\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":372,\"starts\":4,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":0,\"pass_completion_pct\":89.1,\"tackles\":6,\"interceptions\":9,\"duels_won_pct\":60.4,\"clean_sheets\":1,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Tim Ream\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2023,\"starts\":23,\"goals\":1,\"assists\":1,\"shots\":5,\"key_passes\":3,\"pass_completion_pct\":89.1,\"tackles\":32,\"interceptions\":49,\"duels_won_pct\":60.4,\"clean_sheets\":8,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Miles Robinson\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2280,\"starts\":25,\"goals\":3,\"assists\":0,\"shots\":20,\"key_passes\":2,\"pass_completion_pct\":84.3,\"tackles\":44,\"interceptions\":50,\"duels_won_pct\":61.7,\"clean_sheets\":8,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Miles Robinson\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":356,\"starts\":4,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":0,\"pass_completion_pct\":84.3,\"tackles\":7,\"interceptions\":8,\"duels_won_pct\":61.7,\"clean_sheets\":1,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Miles Robinson\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1938,\"starts\":21,\"goals\":3,\"assists\":0,\"shots\":17,\"key_passes\":2,\"pass_completion_pct\":84.3,\"tackles\":37,\"interceptions\":43,\"duels_won_pct\":61.7,\"clean_sheets\":7,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Joe Scally\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2470,\"starts\":27,\"goals\":0,\"assists\":3,\"shots\":12,\"key_passes\":24,\"pass_completion_pct\":83.7,\"tackles\":42,\"interceptions\":28,\"duels_won_pct\":54.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Joe Scally\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":386,\"starts\":4,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":4,\"pass_completion_pct\":83.7,\"tackles\":7,\"interceptions\":4,\"duels_won_pct\":54.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Joe Scally\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2100,\"starts\":23,\"goals\":0,\"assists\":3,\"shots\":10,\"key_passes\":20,\"pass_completion_pct\":83.7,\"tackles\":36,\"interceptions\":24,\"duels_won_pct\":54.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Auston Trusty\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2610,\"starts\":29,\"goals\":2,\"assists\":1,\"shots\":16,\"key_passes\":3,\"pass_completion_pct\":86.9,\"tackles\":40,\"interceptions\":54,\"duels_won_pct\":62.8,\"clean_sheets\":11,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Auston Trusty\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":408,\"starts\":5,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":0,\"pass_completion_pct\":86.9,\"tackles\":6,\"interceptions\":8,\"duels_won_pct\":62.8,\"clean_sheets\":2,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Auston Trusty\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2219,\"starts\":25,\"goals\":2,\"assists\":1,\"shots\":14,\"key_passes\":3,\"pass_completion_pct\":86.9,\"tackles\":34,\"interceptions\":46,\"duels_won_pct\":62.8,\"clean_sheets\":9,\"save_pct\":null,\"avg_rating\":7.1},{\"player\":\"Sebastian Berhalter\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1980,\"starts\":22,\"goals\":1,\"assists\":2,\"shots\":14,\"key_passes\":18,\"pass_completion_pct\":88.4,\"tackles\":52,\"interceptions\":32,\"duels_won_pct\":57.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Sebastian Berhalter\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":309,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":3,\"pass_completion_pct\":88.4,\"tackles\":8,\"interceptions\":5,\"duels_won_pct\":57.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Sebastian Berhalter\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1683,\"starts\":19,\"goals\":1,\"assists\":2,\"shots\":12,\"key_passes\":15,\"pass_completion_pct\":88.4,\"tackles\":44,\"interceptions\":27,\"duels_won_pct\":57.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Cristian Roldan\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2340,\"starts\":26,\"goals\":3,\"assists\":4,\"shots\":24,\"key_passes\":26,\"pass_completion_pct\":85,\"tackles\":44,\"interceptions\":26,\"duels_won_pct\":53.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Cristian Roldan\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":366,\"starts\":4,\"goals\":0,\"assists\":1,\"shots\":4,\"key_passes\":4,\"pass_completion_pct\":85,\"tackles\":7,\"interceptions\":4,\"duels_won_pct\":53.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Cristian Roldan\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1989,\"starts\":22,\"goals\":3,\"assists\":3,\"shots\":20,\"key_passes\":22,\"pass_completion_pct\":85,\"tackles\":37,\"interceptions\":22,\"duels_won_pct\":53.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Brenden Aaronson\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2620,\"starts\":29,\"goals\":9,\"assists\":6,\"shots\":58,\"key_passes\":40,\"pass_completion_pct\":79.6,\"tackles\":30,\"interceptions\":14,\"duels_won_pct\":50.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.4},{\"player\":\"Brenden Aaronson\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":409,\"starts\":5,\"goals\":1,\"assists\":1,\"shots\":9,\"key_passes\":6,\"pass_completion_pct\":79.6,\"tackles\":5,\"interceptions\":2,\"duels_won_pct\":50.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.4},{\"player\":\"Brenden Aaronson\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2227,\"starts\":25,\"goals\":8,\"assists\":5,\"shots\":49,\"key_passes\":34,\"pass_completion_pct\":79.6,\"tackles\":26,\"interceptions\":12,\"duels_won_pct\":50.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.4},{\"player\":\"Alejandro Zendejas\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1860,\"starts\":20,\"goals\":6,\"assists\":7,\"shots\":44,\"key_passes\":38,\"pass_completion_pct\":80.1,\"tackles\":14,\"interceptions\":6,\"duels_won_pct\":47.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7},{\"player\":\"Alejandro Zendejas\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":291,\"starts\":3,\"goals\":1,\"assists\":1,\"shots\":7,\"key_passes\":6,\"pass_completion_pct\":80.1,\"tackles\":2,\"interceptions\":1,\"duels_won_pct\":47.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7},{\"player\":\"Alejandro Zendejas\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1581,\"starts\":17,\"goals\":5,\"assists\":6,\"shots\":37,\"key_passes\":32,\"pass_completion_pct\":80.1,\"tackles\":12,\"interceptions\":5,\"duels_won_pct\":47.8,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7},{\"player\":\"Haji Wright\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":2540,\"starts\":28,\"goals\":17,\"assists\":3,\"shots\":88,\"key_passes\":18,\"pass_completion_pct\":74.5,\"tackles\":8,\"interceptions\":4,\"duels_won_pct\":51.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.3},{\"player\":\"Haji Wright\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":397,\"starts\":4,\"goals\":3,\"assists\":0,\"shots\":14,\"key_passes\":3,\"pass_completion_pct\":74.5,\"tackles\":1,\"interceptions\":1,\"duels_won_pct\":51.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.3},{\"player\":\"Haji Wright\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":2159,\"starts\":24,\"goals\":14,\"assists\":3,\"shots\":75,\"key_passes\":15,\"pass_completion_pct\":74.5,\"tackles\":7,\"interceptions\":3,\"duels_won_pct\":51.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.3},{\"player\":\"Diego Luna\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1740,\"starts\":18,\"goals\":5,\"assists\":9,\"shots\":42,\"key_passes\":48,\"pass_completion_pct\":82.9,\"tackles\":12,\"interceptions\":6,\"duels_won_pct\":46.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Diego Luna\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":272,\"starts\":3,\"goals\":1,\"assists\":1,\"shots\":7,\"key_passes\":8,\"pass_completion_pct\":82.9,\"tackles\":2,\"interceptions\":1,\"duels_won_pct\":46.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Diego Luna\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1479,\"starts\":15,\"goals\":4,\"assists\":8,\"shots\":36,\"key_passes\":41,\"pass_completion_pct\":82.9,\"tackles\":10,\"interceptions\":5,\"duels_won_pct\":46.4,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":7.2},{\"player\":\"Gaga Slonina\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":990,\"starts\":11,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":70.2,\"tackles\":0,\"interceptions\":2,\"duels_won_pct\":0,\"clean_sheets\":3,\"save_pct\":66.7,\"avg_rating\":6.6},{\"player\":\"Gaga Slonina\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":155,\"starts\":2,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":70.2,\"tackles\":0,\"interceptions\":0,\"duels_won_pct\":0,\"clean_sheets\":0,\"save_pct\":66.7,\"avg_rating\":6.6},{\"player\":\"Gaga Slonina\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":842,\"starts\":9,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":70.2,\"tackles\":0,\"interceptions\":2,\"duels_won_pct\":0,\"clean_sheets\":3,\"save_pct\":66.7,\"avg_rating\":6.6},{\"player\":\"Caleb Wiley\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":860,\"starts\":9,\"goals\":0,\"assists\":2,\"shots\":10,\"key_passes\":12,\"pass_completion_pct\":79,\"tackles\":16,\"interceptions\":8,\"duels_won_pct\":49.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Caleb Wiley\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":134,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":2,\"pass_completion_pct\":79,\"tackles\":3,\"interceptions\":1,\"duels_won_pct\":49.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Caleb Wiley\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":731,\"starts\":8,\"goals\":0,\"assists\":2,\"shots\":9,\"key_passes\":10,\"pass_completion_pct\":79,\"tackles\":14,\"interceptions\":7,\"duels_won_pct\":49.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Damion Downs\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":780,\"starts\":8,\"goals\":4,\"assists\":1,\"shots\":26,\"key_passes\":6,\"pass_completion_pct\":73.4,\"tackles\":4,\"interceptions\":2,\"duels_won_pct\":52.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Damion Downs\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":122,\"starts\":1,\"goals\":1,\"assists\":0,\"shots\":4,\"key_passes\":1,\"pass_completion_pct\":73.4,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":52.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Damion Downs\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":663,\"starts\":7,\"goals\":3,\"assists\":1,\"shots\":22,\"key_passes\":5,\"pass_completion_pct\":73.4,\"tackles\":3,\"interceptions\":2,\"duels_won_pct\":52.9,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Cole Campbell\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":420,\"starts\":4,\"goals\":1,\"assists\":2,\"shots\":12,\"key_passes\":10,\"pass_completion_pct\":80.6,\"tackles\":6,\"interceptions\":4,\"duels_won_pct\":45.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Cole Campbell\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":66,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":2,\"pass_completion_pct\":80.6,\"tackles\":1,\"interceptions\":1,\"duels_won_pct\":45.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Cole Campbell\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":357,\"starts\":3,\"goals\":1,\"assists\":2,\"shots\":10,\"key_passes\":9,\"pass_completion_pct\":80.6,\"tackles\":5,\"interceptions\":3,\"duels_won_pct\":45.2,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Bajung Darboe\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":610,\"starts\":6,\"goals\":3,\"assists\":2,\"shots\":18,\"key_passes\":14,\"pass_completion_pct\":76.8,\"tackles\":4,\"interceptions\":3,\"duels_won_pct\":48.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Bajung Darboe\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":95,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":2,\"pass_completion_pct\":76.8,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":48.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Bajung Darboe\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":519,\"starts\":5,\"goals\":3,\"assists\":2,\"shots\":15,\"key_passes\":12,\"pass_completion_pct\":76.8,\"tackles\":3,\"interceptions\":3,\"duels_won_pct\":48.5,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Montrell Culbreath\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":800,\"starts\":6,\"goals\":1,\"assists\":1,\"shots\":15,\"key_passes\":9,\"pass_completion_pct\":79.3,\"tackles\":5,\"interceptions\":3,\"duels_won_pct\":44,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Montrell Culbreath\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":125,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":1,\"pass_completion_pct\":79.3,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":44,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Montrell Culbreath\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":680,\"starts\":5,\"goals\":1,\"assists\":1,\"shots\":13,\"key_passes\":8,\"pass_completion_pct\":79.3,\"tackles\":4,\"interceptions\":3,\"duels_won_pct\":44,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Rokas Pukstas\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1980,\"starts\":22,\"goals\":3,\"assists\":4,\"shots\":30,\"key_passes\":28,\"pass_completion_pct\":84.2,\"tackles\":34,\"interceptions\":20,\"duels_won_pct\":53.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Rokas Pukstas\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":309,\"starts\":3,\"goals\":0,\"assists\":1,\"shots\":5,\"key_passes\":4,\"pass_completion_pct\":84.2,\"tackles\":5,\"interceptions\":3,\"duels_won_pct\":53.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Rokas Pukstas\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1683,\"starts\":19,\"goals\":3,\"assists\":3,\"shots\":26,\"key_passes\":24,\"pass_completion_pct\":84.2,\"tackles\":29,\"interceptions\":17,\"duels_won_pct\":53.1,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Quinn Sullivan\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":640,\"starts\":6,\"goals\":2,\"assists\":3,\"shots\":20,\"key_passes\":16,\"pass_completion_pct\":81.3,\"tackles\":6,\"interceptions\":2,\"duels_won_pct\":44.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Quinn Sullivan\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":100,\"starts\":1,\"goals\":0,\"assists\":0,\"shots\":3,\"key_passes\":3,\"pass_completion_pct\":81.3,\"tackles\":1,\"interceptions\":0,\"duels_won_pct\":44.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Quinn Sullivan\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":544,\"starts\":5,\"goals\":2,\"assists\":3,\"shots\":17,\"key_passes\":14,\"pass_completion_pct\":81.3,\"tackles\":5,\"interceptions\":2,\"duels_won_pct\":44.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.8},{\"player\":\"Luca Bombino\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":1860,\"starts\":20,\"goals\":0,\"assists\":3,\"shots\":10,\"key_passes\":20,\"pass_completion_pct\":85.8,\"tackles\":32,\"interceptions\":18,\"duels_won_pct\":51.7,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Luca Bombino\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":291,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":2,\"key_passes\":3,\"pass_completion_pct\":85.8,\"tackles\":5,\"interceptions\":3,\"duels_won_pct\":51.7,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Luca Bombino\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":1581,\"starts\":17,\"goals\":0,\"assists\":3,\"shots\":9,\"key_passes\":17,\"pass_completion_pct\":85.8,\"tackles\":27,\"interceptions\":15,\"duels_won_pct\":51.7,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.9},{\"player\":\"Peyton Miller\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":920,\"starts\":10,\"goals\":0,\"assists\":1,\"shots\":4,\"key_passes\":6,\"pass_completion_pct\":82.4,\"tackles\":24,\"interceptions\":16,\"duels_won_pct\":55.3,\"clean_sheets\":3,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Peyton Miller\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":144,\"starts\":2,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":1,\"pass_completion_pct\":82.4,\"tackles\":4,\"interceptions\":3,\"duels_won_pct\":55.3,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Peyton Miller\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":782,\"starts\":9,\"goals\":0,\"assists\":1,\"shots\":3,\"key_passes\":5,\"pass_completion_pct\":82.4,\"tackles\":20,\"interceptions\":14,\"duels_won_pct\":55.3,\"clean_sheets\":3,\"save_pct\":null,\"avg_rating\":6.7},{\"player\":\"Joshua Wynder\",\"period_type\":\"season\",\"season\":\"2025/26\",\"minutes\":300,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":0,\"pass_completion_pct\":78.9,\"tackles\":6,\"interceptions\":8,\"duels_won_pct\":58.6,\"clean_sheets\":1,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Joshua Wynder\",\"period_type\":\"last5\",\"season\":\"2025/26\",\"minutes\":47,\"starts\":0,\"goals\":0,\"assists\":0,\"shots\":0,\"key_passes\":0,\"pass_completion_pct\":78.9,\"tackles\":1,\"interceptions\":1,\"duels_won_pct\":58.6,\"clean_sheets\":0,\"save_pct\":null,\"avg_rating\":6.6},{\"player\":\"Joshua Wynder\",\"period_type\":\"previous_season\",\"season\":\"2024/25\",\"minutes\":255,\"starts\":3,\"goals\":0,\"assists\":0,\"shots\":1,\"key_passes\":0,\"pass_completion_pct\":78.9,\"tackles\":5,\"interceptions\":7,\"duels_won_pct\":58.6,\"clean_sheets\":1,\"save_pct\":null,\"avg_rating\":6.6}]"
  ]
}
```

**snapshot — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t),'[]'::json) AS data FROM (SELECT current_timestamp AS observed_at,pg_is_in_recovery() AS is_replica,(SELECT count(*) FROM players) AS player_count,(SELECT count(*) FROM match_logs WHERE api_football_fixture_id IS NULL) AS null_provider_logs,(SELECT min(created_at) FROM player_stats) AS oldest_stats,(SELECT min(created_at) FROM injuries) AS oldest_injury) t",
  "params": []
}
```

**cascadeFks — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t),'[]'::json) AS data FROM (SELECT c.conrelid::regclass::text AS child,c.confrelid::regclass::text AS parent,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c WHERE c.contype='f' AND c.confrelid IN ('clubs'::regclass,'players'::regclass,'fixtures'::regclass,'news_articles'::regclass,'fixture_players'::regclass,'news_article_players'::regclass,'match_logs'::regclass,'player_stats'::regclass,'injuries'::regclass,'transfers'::regclass,'national_team_windows'::regclass) ORDER BY 1,2) t",
  "params": []
}
```

**belgiumLogs — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT id,player_id,date,opponent,competition,result,minutes,goals,assists,rating,api_football_fixture_id,is_national_team,created_at FROM match_logs WHERE api_football_fixture_id=$1) t",
  "params": [
    1570715
  ]
}
```

**transferSeedMatches — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) AS data FROM (SELECT tr.*,p.name AS player FROM transfers tr LEFT JOIN players p ON p.id=tr.player_id WHERE tr.id BETWEEN 1 AND 6 OR tr.created_at<$1::timestamptz OR tr.summary=ANY($2::text[]) OR tr.to_club=ANY($3::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements($4::jsonb) s WHERE s->>'player'=p.name AND tr.announced_at=(TIMESTAMPTZ '2026-07-13 12:00:00+00' - (s->>'daysAgo')::int * INTERVAL '1 day'))) t",
  "params": [
    "2026-07-15T02:46:10Z",
    [
      "Richards signed a new three-year deal keeping him at Selhurst Park through 2028.",
      "Reports suggest Balogun could seek a move away from Monaco in search of regular minutes ahead of the World Cup.",
      "PSV are reportedly preparing an improved contract to ward off interest from Bundesliga and Premier League suitors.",
      "Scouts from at least two Bundesliga clubs have been tracking Pepi's scoring form this season.",
      "Unconfirmed reports suggest a loan swap is being discussed, though AZ have downplayed the speculation.",
      "Inter Miami confirmed a contract extension for Cremaschi through the 2027 season with a club option for 2028."
    ],
    [
      "Undisclosed Ligue 1 club",
      "Bundesliga club (unnamed)",
      "Eredivisie rival"
    ],
    "[{\"player\":\"Chris Richards\",\"fromClub\":\"Crystal Palace\",\"toClub\":\"Crystal Palace\",\"transferType\":\"contract_extension\",\"fee\":null,\"status\":\"confirmed\",\"probabilityScore\":null,\"daysAgo\":1,\"summary\":\"Richards signed a new three-year deal keeping him at Selhurst Park through 2028.\"},{\"player\":\"Folarin Balogun\",\"fromClub\":\"AS Monaco\",\"toClub\":\"Undisclosed Ligue 1 club\",\"transferType\":\"transfer\",\"fee\":\"€25M (est.)\",\"status\":\"rumor\",\"probabilityScore\":42,\"daysAgo\":2,\"summary\":\"Reports suggest Balogun could seek a move away from Monaco in search of regular minutes ahead of the World Cup.\"},{\"player\":\"Malik Tillman\",\"fromClub\":\"PSV Eindhoven\",\"toClub\":\"PSV Eindhoven\",\"transferType\":\"contract_extension\",\"fee\":null,\"status\":\"rumor\",\"probabilityScore\":68,\"daysAgo\":4,\"summary\":\"PSV are reportedly preparing an improved contract to ward off interest from Bundesliga and Premier League suitors.\"},{\"player\":\"Ricardo Pepi\",\"fromClub\":\"PSV Eindhoven\",\"toClub\":\"Bundesliga club (unnamed)\",\"transferType\":\"transfer\",\"fee\":\"€30M (est.)\",\"status\":\"rumor\",\"probabilityScore\":35,\"daysAgo\":6,\"summary\":\"Scouts from at least two Bundesliga clubs have been tracking Pepi's scoring form this season.\"},{\"player\":\"Djordje Mihailovic\",\"fromClub\":\"AZ Alkmaar\",\"toClub\":\"Eredivisie rival\",\"transferType\":\"loan\",\"fee\":null,\"status\":\"rumor\",\"probabilityScore\":18,\"daysAgo\":9,\"summary\":\"Unconfirmed reports suggest a loan swap is being discussed, though AZ have downplayed the speculation.\"},{\"player\":\"Benjamin Cremaschi\",\"fromClub\":\"Inter Miami CF\",\"toClub\":\"Inter Miami CF\",\"transferType\":\"contract_extension\",\"fee\":null,\"status\":\"confirmed\",\"probabilityScore\":null,\"daysAgo\":12,\"summary\":\"Inter Miami confirmed a contract extension for Cremaschi through the 2027 season with a club option for 2028.\"}]"
  ]
}
```

**cascadeRecursive — SELECT and parameters**

```text
{
  "sql": "SELECT COALESCE(json_agg(t),'[]'::json) AS data FROM (WITH RECURSIVE affected(oid) AS (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('fixture_players','news_article_players','match_logs','player_stats','injuries','transfers','fixtures','news_articles','national_team_windows','players','clubs') UNION SELECT c.conrelid FROM pg_constraint c JOIN affected a ON c.confrelid=a.oid WHERE c.contype='f') SELECT a.oid::regclass::text AS table_name FROM affected a ORDER BY 1) t",
  "params": []
}
```
