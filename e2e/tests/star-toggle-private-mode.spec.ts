/**
 * Star toggle — private/incognito mode (localStorage blocked)
 *
 * # Automated coverage
 *
 * Simulates Safari private mode by overriding localStorage.getItem and
 * localStorage.setItem to throw a SecurityError before the page loads.
 * This matches the exact runtime failure mode Safari introduces in private
 * browsing (DOMException: "The operation is insecure."), so the code path
 * exercised is identical regardless of which browser engine executes the test.
 *
 * Tests verify that:
 *   1. The page does not crash (no Vite error overlay, no error-boundary copy).
 *   2. Clicking the star button optimistically toggles the aria-label between
 *      "Add to My Players" and "Remove from My Players".
 *   3. Clicking again reverses the toggle.
 *
 * These tests run on Chromium in all environments.  When a WebKit binary is
 * discoverable (PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH or `which MiniBrowser`),
 * playwright.config.ts adds a `webkit` project and the same spec runs there
 * automatically, exercising the full Safari engine stack.
 *
 * No persistence is expected — optimistic-only state is the intended behaviour
 * when localStorage is unavailable (MyPlayersContext.saveLocalFollows catches
 * the SecurityError and silently skips the write).
 *
 * # Manual Safari Private Browsing verification
 *
 * Run the following steps in **Safari → File → New Private Window** any time
 * the MyPlayersContext storage logic changes, or after a dependency upgrade.
 * Confirmed working as of 2026-07-28 (Safari 17, macOS Sonoma 14).
 *
 * 1. Open the app URL in a Safari Private window.
 * 2. Open DevTools → Storage tab and confirm localStorage is inaccessible
 *    (any manual `localStorage.setItem(...)` call in the console should throw
 *    SecurityError).
 * 3. Navigate to /players.  The page must load without a white screen or
 *    "Something went wrong" error.
 * 4. Click the ☆ star on any player card.
 *    Expected: aria-label changes to "Remove from My Players"; no console error.
 * 5. Click the ★ star again.
 *    Expected: aria-label reverts to "Add to My Players"; no console error.
 * 6. Navigate to any player's profile page (/players/<id>).
 * 7. Click the ☆ star in the profile header.
 *    Expected: same toggle behaviour as step 4–5.
 * 8. Reload the tab.
 *    Expected: star resets to "Add to My Players" (no persistence — correct).
 * 9. Check the DevTools console throughout — zero unhandled exceptions.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── localStorage blocker ─────────────────────────────────────────────────────

/**
 * Inject a script that replaces the real localStorage with a stub whose
 * getItem / setItem / removeItem throw a DOMException with name "SecurityError".
 * This matches the browser behaviour in Safari private mode and in contexts
 * where third-party storage is blocked.
 */
async function blockLocalStorage(page: Page) {
  await page.addInitScript(() => {
    const deny = () => {
      throw Object.assign(
        new DOMException("The operation is insecure.", "SecurityError"),
        { code: DOMException.SECURITY_ERR },
      );
    };
    const stub: Storage = {
      length: 0,
      getItem: deny,
      setItem: deny,
      removeItem: deny,
      clear() {},
      key: () => null,
    };
    Object.defineProperty(window, "localStorage", {
      value: stub,
      writable: false,
      configurable: false,
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForApp(page: Page) {
  await page.waitForLoadState("load");
}

async function expectNoErrorUI(page: Page) {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("Application error");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Star toggle with localStorage blocked (private/incognito mode)", () => {
  /**
   * Profile-page star: navigate to the players list, grab the first player's
   * URL, then navigate directly to the profile and toggle the header star.
   *
   * We navigate directly (page.goto) rather than clicking the card link so
   * that we can wait for the profile heading — confirming the player data has
   * loaded — before we assert on the star button.
   *
   * The profile header star is always the first "Add to My Players" button in
   * DOM order (it lives at the top of the page, before any embedded player
   * cards lower down).
   */
  test("star button on player profile toggles without crash", async ({
    page,
  }) => {
    await blockLocalStorage(page);

    // Step 1 — discover a real player URL from the list.
    await page.goto("players");
    await waitForApp(page);
    await expectNoErrorUI(page);

    const firstCard = page.locator('a[href*="/players/"]').first();
    await expect(firstCard).toBeVisible();
    const playerHref = await firstCard.getAttribute("href");

    // Step 2 — navigate directly to the profile page.
    await page.goto(playerHref!);
    await waitForApp(page);
    await expectNoErrorUI(page);

    // Confirm we're on a profile URL.
    await expect(page).toHaveURL(/\/players\/\d+/);

    // Step 3 — wait for the player heading (data loaded) before asserting on
    // the star button.  The star button only renders once the player record is
    // available from React Query.
    const profileHeading = page.locator("h1").first();
    await expect(profileHeading).toBeVisible();

    // The profile header star is the first "Add to My Players" button in the
    // page's DOM order.
    const starBtn = page
      .locator('button[aria-label="Add to My Players"]')
      .first();
    await expect(starBtn).toBeVisible();

    // ── First click: add ──────────────────────────────────────────────────────
    await starBtn.click();

    // After the optimistic update the profile star should flip label.
    const removeBtn = page
      .locator('button[aria-label="Remove from My Players"]')
      .first();
    await expect(removeBtn).toBeVisible();

    // The page must not have crashed.
    await expectNoErrorUI(page);

    // ── Second click: remove ──────────────────────────────────────────────────
    await removeBtn.click();

    // Label should revert to "Add to My Players".
    await expect(
      page.locator('button[aria-label="Add to My Players"]').first(),
    ).toBeVisible();

    await expectNoErrorUI(page);
  });

  /**
   * Reload after toggle in private mode: toggle a specific player's star,
   * reload the page, and confirm that player's star resets to "Add to My
   * Players" without a crash.
   *
   * In private mode the token is never written to localStorage, so on reload
   * ensureToken fires again (a fresh provisioning call), the remote follows
   * list comes back empty, and optimisticIds resets to an empty Set.  The star
   * must return to its unfollowed label — no persistence is the correct
   * behaviour — and neither a crash nor an error UI must appear.
   *
   * Scoping strategy: the PlayerCard renders its star inside the same <a>
   * anchor as the player link (`<Link href="/players/{id}">`), so we can
   * identify the card container by its href and scope all assertions to that
   * anchor.  After reload we re-locate the same card by href and assert its
   * button is back to "Add to My Players".  We also assert that zero
   * "Remove from My Players" buttons exist anywhere on the page, ruling out
   * the case where a different card still shows the followed state.
   */
  test("star resets to unfollowed state after page reload in private mode", async ({
    page,
  }) => {
    await blockLocalStorage(page);

    await page.goto("players");
    await waitForApp(page);
    await expectNoErrorUI(page);

    // Grab the href of the first player card so we can re-locate it after
    // reload by a stable identifier (the player's own URL path).
    const firstCard = page.locator('a[href*="/players/"]').first();
    await expect(firstCard).toBeVisible();
    const playerHref = await firstCard.getAttribute("href");

    // The star button lives inside the card anchor — scope directly to it.
    const starInCard = firstCard.locator('button[aria-label="Add to My Players"]');
    await expect(starInCard).toBeVisible();

    // ── Toggle on: optimistic update flips the button label ──────────────────
    await starInCard.click();

    // The same card should now show "Remove from My Players".
    const removeInCard = firstCard.locator('button[aria-label="Remove from My Players"]');
    await expect(removeInCard).toBeVisible();
    await expectNoErrorUI(page);

    // ── Reload — init script re-runs so localStorage remains blocked ─────────
    await page.reload();
    await waitForApp(page);
    await expectNoErrorUI(page);

    // Re-locate the same card by its player href.
    const sameCard = page.locator(`a[href="${playerHref}"]`);
    await expect(sameCard).toBeVisible();

    // PRIMARY assertion: that specific card's star must be back to "Add".
    await expect(
      sameCard.locator('button[aria-label="Add to My Players"]'),
    ).toBeVisible();

    // SECONDARY (stronger negative): zero "Remove from My Players" buttons
    // anywhere on the page — the private-mode token was never persisted so no
    // player should appear as followed after the fresh provisioning.
    await expect(
      page.locator('button[aria-label="Remove from My Players"]'),
    ).toHaveCount(0);

    // No crash, no error UI after reload + re-provisioning.
    await expectNoErrorUI(page);
  });

  /**
   * Player-list card star: open the players list, click the first card's star,
   * and confirm the label flips and back without a crash.
   */
  test("star button on player card (players list) toggles without crash", async ({
    page,
  }) => {
    await blockLocalStorage(page);

    await page.goto("players");
    await waitForApp(page);
    await expectNoErrorUI(page);

    // Wait for at least one star button to be rendered in the cards grid.
    const firstStar = page
      .locator('button[aria-label="Add to My Players"]')
      .first();
    await expect(firstStar).toBeVisible();

    // ── First click: add ──────────────────────────────────────────────────────
    await firstStar.click();

    // The clicked button should now read "Remove from My Players".
    const removeBtn = page
      .locator('button[aria-label="Remove from My Players"]')
      .first();
    await expect(removeBtn).toBeVisible();
    await expectNoErrorUI(page);

    // ── Second click: remove ──────────────────────────────────────────────────
    await removeBtn.click();

    await expect(
      page.locator('button[aria-label="Add to My Players"]').first(),
    ).toBeVisible();
    await expectNoErrorUI(page);
  });
});
