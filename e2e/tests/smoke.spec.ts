/**
 * USMNT Tracker — end-to-end smoke tests
 *
 * Run against the live dev stack (Vite + Express API) and confirm the five
 * core flows survive without a React error boundary crash, a blank page, or a
 * broken route.  Intentionally shallow — the goal is to catch whole-stack
 * regressions that unit tests miss.
 *
 * Routing note: the Vite dev server runs with BASE_PATH=/ so all routes live
 * at the root of the dev-server port (http://localhost:<PORT>/players, etc).
 * playwright.config.ts discovers the port at runtime and sets baseURL
 * accordingly.  Relative paths in page.goto() resolve against baseURL.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wait for the page to finish its initial load.
 * We use 'load' (DOMContentLoaded + resources) rather than 'networkidle'
 * because Vite's HMR WebSocket keeps connections open permanently and would
 * make networkidle time out on every test.
 */
async function waitForApp(page: Page) {
  await page.waitForLoadState("load");
}

/**
 * Assert that no unhandled error UI is displayed.
 * Covers the Vite runtime error overlay and common React error boundary copy.
 */
async function expectNoErrorUI(page: Page) {
  const errorModal = page.locator("vite-error-overlay");
  await expect(errorModal).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("Application error");
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

test.describe("Dashboard", () => {
  test("loads without an error and shows the sidebar nav", async ({ page }) => {
    await page.goto("");
    await waitForApp(page);
    await expectNoErrorUI(page);

    // The Layout sidebar is always present — a reliable signal the app shell
    // rendered (not just a blank div or a 404 shell).
    const nav = page.locator("nav").first();
    await expect(nav).toBeVisible();
  });

  test("shows at least one section with visible content", async ({ page }) => {
    await page.goto("");
    await waitForApp(page);

    // Dashboard renders h2 section headings (Top Performers, Upcoming Matches,
    // Latest News, etc.).  Wait up to the expect timeout for the first one.
    const firstSection = page.locator("h2").first();
    await expect(firstSection).toBeVisible();
  });
});

// ─── Players list ────────────────────────────────────────────────────────────

test.describe("Players list", () => {
  test("renders the page heading without errors", async ({ page }) => {
    await page.goto("players");
    await waitForApp(page);
    await expectNoErrorUI(page);

    // The Players page always renders an h1 (e.g. "PLAYER POOL").
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
  });

  test("shows at least one player card or an empty-state message", async ({ page }) => {
    await page.goto("players");
    await waitForApp(page);

    // Wait for either a player card link or an empty-state to appear.
    // React Query may still be fetching when 'load' fires, so give it time.
    const cards = page.locator('a[href*="/players/"]');
    const emptyState = page.locator("text=/no players/i");

    // Wait until at least one of the two is present.
    await expect(cards.or(emptyState).first()).toBeVisible();
  });
});

// ─── Player profile ──────────────────────────────────────────────────────────

test.describe("Player profile", () => {
  test("clicking a player card navigates to their profile page", async ({ page }) => {
    await page.goto("players");
    await waitForApp(page);

    // Wait for the first player card to appear (React Query fetches on mount).
    // The database always has players; if this times out it is a real failure.
    const firstCard = page.locator('a[href*="/players/"]').first();
    await expect(firstCard).toBeVisible();

    await firstCard.click();
    await waitForApp(page);
    await expectNoErrorUI(page);

    // The URL should now contain /players/<id>.
    await expect(page).toHaveURL(/\/players\/\d+/);

    // The profile renders a heading with the player's name.
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
  });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

test.describe("Fixtures", () => {
  test("renders the Watch Guide heading without errors", async ({ page }) => {
    await page.goto("fixtures");
    await waitForApp(page);
    await expectNoErrorUI(page);

    // "Watch Guide" is the h1 on the Fixtures page (CSS uppercase; DOM text
    // is mixed case). Wait up to the expect timeout for it to appear.
    const heading = page.locator("h1").filter({ hasText: /watch guide/i });
    await expect(heading).toBeVisible();
  });

  test("shows fixture content or an empty-state message", async ({ page }) => {
    await page.goto("fixtures");
    await waitForApp(page);

    // Fixture cards are <div onClick={navigate(…)}>, not <a> elements, so we
    // cannot select them by href.  Instead check for one of:
    //   • a date-section heading (h2 — e.g. TODAY, TOMORROW, a formatted date)
    //   • the Recent Results accordion label
    //   • any of the three empty-state messages the page can display
    const sectionHeading = page.locator("h2");
    const recentResults   = page.locator("text=/recent results/i");
    const emptyAll        = page.locator("text=/no fixtures scheduled/i");
    const emptyUpcoming   = page.locator("text=/no upcoming fixtures/i");
    const emptyFiltered   = page.locator("text=/no fixtures match this filter/i");

    await expect(
      sectionHeading
        .or(recentResults)
        .or(emptyAll)
        .or(emptyUpcoming)
        .or(emptyFiltered)
        .first(),
    ).toBeVisible();
  });
});

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe("Navigation — each route loads without a crash", () => {
  const routes: { name: string; path: string }[] = [
    { name: "Dashboard",     path: ""             },
    { name: "Players",       path: "players"      },
    { name: "Fixtures",      path: "fixtures"     },
    { name: "News",          path: "news"         },
    { name: "Injuries",      path: "injuries"     },
    { name: "Transfers",     path: "transfers"    },
    { name: "Rankings",      path: "rankings"     },
    { name: "Schedule",      path: "schedule"     },
    { name: "About",         path: "about"        },
    { name: "Transparency",  path: "transparency" },
  ];

  for (const route of routes) {
    test(`${route.name} (/${route.path})`, async ({ page }) => {
      await page.goto(route.path);
      await waitForApp(page);
      await expectNoErrorUI(page);

      // The nav sidebar must be present on every Layout-wrapped page.
      const nav = page.locator("nav").first();
      await expect(nav).toBeVisible();
    });
  }
});
