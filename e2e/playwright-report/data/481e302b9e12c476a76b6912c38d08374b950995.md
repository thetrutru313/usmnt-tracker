# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Navigation — each route loads without a crash >> Rankings (/rankings)
- Location: tests/smoke.spec.ts:174:9

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/rankings
Call log:
  - navigating to "http://localhost:5173/rankings", waiting until "load"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e6]:
    - heading "This site can’t be reached" [level=1] [ref=e7]
    - paragraph [ref=e8]:
      - strong [ref=e9]: localhost
      - text: refused to connect.
    - generic [ref=e10]:
      - paragraph [ref=e11]: "Try:"
      - list [ref=e12]:
        - listitem [ref=e13]: Checking the connection
        - listitem [ref=e14]:
          - link "Checking the proxy and the firewall" [ref=e15] [cursor=pointer]:
            - /url: "#buttons"
    - generic [ref=e16]: ERR_CONNECTION_REFUSED
  - generic [ref=e17]:
    - button "Reload" [ref=e19] [cursor=pointer]
    - button "Details" [ref=e20] [cursor=pointer]
```

# Test source

```ts
  75  |     await expect(heading).toBeVisible();
  76  |   });
  77  | 
  78  |   test("shows at least one player card or an empty-state message", async ({ page }) => {
  79  |     await page.goto("players");
  80  |     await waitForApp(page);
  81  | 
  82  |     // Wait for either a player card link or an empty-state to appear.
  83  |     // React Query may still be fetching when 'load' fires, so give it time.
  84  |     const cards = page.locator('a[href*="/players/"]');
  85  |     const emptyState = page.locator("text=/no players/i");
  86  | 
  87  |     // Wait until at least one of the two is present.
  88  |     await expect(cards.or(emptyState).first()).toBeVisible();
  89  |   });
  90  | });
  91  | 
  92  | // ─── Player profile ──────────────────────────────────────────────────────────
  93  | 
  94  | test.describe("Player profile", () => {
  95  |   test("clicking a player card navigates to their profile page", async ({ page }) => {
  96  |     await page.goto("players");
  97  |     await waitForApp(page);
  98  | 
  99  |     // Wait for the first player card to appear (React Query fetches on mount).
  100 |     // The database always has players; if this times out it is a real failure.
  101 |     const firstCard = page.locator('a[href*="/players/"]').first();
  102 |     await expect(firstCard).toBeVisible();
  103 | 
  104 |     await firstCard.click();
  105 |     await waitForApp(page);
  106 |     await expectNoErrorUI(page);
  107 | 
  108 |     // The URL should now contain /players/<id>.
  109 |     await expect(page).toHaveURL(/\/players\/\d+/);
  110 | 
  111 |     // The profile renders a heading with the player's name.
  112 |     const heading = page.locator("h1").first();
  113 |     await expect(heading).toBeVisible();
  114 |   });
  115 | });
  116 | 
  117 | // ─── Fixtures ────────────────────────────────────────────────────────────────
  118 | 
  119 | test.describe("Fixtures", () => {
  120 |   test("renders the Watch Guide heading without errors", async ({ page }) => {
  121 |     await page.goto("fixtures");
  122 |     await waitForApp(page);
  123 |     await expectNoErrorUI(page);
  124 | 
  125 |     // "Watch Guide" is the h1 on the Fixtures page (CSS uppercase; DOM text
  126 |     // is mixed case). Wait up to the expect timeout for it to appear.
  127 |     const heading = page.locator("h1").filter({ hasText: /watch guide/i });
  128 |     await expect(heading).toBeVisible();
  129 |   });
  130 | 
  131 |   test("shows fixture content or an empty-state message", async ({ page }) => {
  132 |     await page.goto("fixtures");
  133 |     await waitForApp(page);
  134 | 
  135 |     // Fixture cards are <div onClick={navigate(…)}>, not <a> elements, so we
  136 |     // cannot select them by href.  Instead check for one of:
  137 |     //   • a date-section heading (h2 — e.g. TODAY, TOMORROW, a formatted date)
  138 |     //   • the Recent Results accordion label
  139 |     //   • any of the three empty-state messages the page can display
  140 |     const sectionHeading = page.locator("h2");
  141 |     const recentResults   = page.locator("text=/recent results/i");
  142 |     const emptyAll        = page.locator("text=/no fixtures scheduled/i");
  143 |     const emptyUpcoming   = page.locator("text=/no upcoming fixtures/i");
  144 |     const emptyFiltered   = page.locator("text=/no fixtures match this filter/i");
  145 | 
  146 |     await expect(
  147 |       sectionHeading
  148 |         .or(recentResults)
  149 |         .or(emptyAll)
  150 |         .or(emptyUpcoming)
  151 |         .or(emptyFiltered)
  152 |         .first(),
  153 |     ).toBeVisible();
  154 |   });
  155 | });
  156 | 
  157 | // ─── Navigation ──────────────────────────────────────────────────────────────
  158 | 
  159 | test.describe("Navigation — each route loads without a crash", () => {
  160 |   const routes: { name: string; path: string }[] = [
  161 |     { name: "Dashboard",     path: ""             },
  162 |     { name: "Players",       path: "players"      },
  163 |     { name: "Fixtures",      path: "fixtures"     },
  164 |     { name: "News",          path: "news"         },
  165 |     { name: "Injuries",      path: "injuries"     },
  166 |     { name: "Transfers",     path: "transfers"    },
  167 |     { name: "Rankings",      path: "rankings"     },
  168 |     { name: "Schedule",      path: "schedule"     },
  169 |     { name: "About",         path: "about"        },
  170 |     { name: "Transparency",  path: "transparency" },
  171 |   ];
  172 | 
  173 |   for (const route of routes) {
  174 |     test(`${route.name} (/${route.path})`, async ({ page }) => {
> 175 |       await page.goto(route.path);
      |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/rankings
  176 |       await waitForApp(page);
  177 |       await expectNoErrorUI(page);
  178 | 
  179 |       // The nav sidebar must be present on every Layout-wrapped page.
  180 |       const nav = page.locator("nav").first();
  181 |       await expect(nav).toBeVisible();
  182 |     });
  183 |   }
  184 | });
  185 | 
```