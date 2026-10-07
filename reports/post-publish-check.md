# Post-publish check — Prompt 20

This report records the completed checks. No checks were rerun to create this Markdown download.

## Step 1 — Repository state

**Confirmed:** `git status --short` returned no output; the working tree was clean.

**Confirmed:** Local HEAD:

```text
00a2e55efff8f751c28556a9e65916ef43b88e9e
```

**Confirmed:** Before pushing, `git log --oneline origin/main..HEAD` returned:

```text
00a2e55 Published your App
cb54cce Add production verification schedule and update agent metadata
a82b106 Update agent assets and add schedule rebuild report
```

**Confirmed:** `git diff --stat origin/main HEAD`:

```text
 .agents/agent_assets_metadata.toml          |  28 +++
 .agents/memory/MEMORY.md                    |   2 +-
 .agents/memory/ci-seeding-blocker.md         |  26 ++-
 reports/schedule-production-verification.md |  63 +++++
 reports/schedule-rebuild-report.md          | 346 ++++++++++++++++++++++++++++
 5 files changed, 452 insertions(+), 13 deletions(-)
```

**Confirmed:** All changes were confined to `reports/` and `.agents/`. Pushed to `origin main`; the remote hash was confirmed as **`00a2e55efff8f751c28556a9e65916ef43b88e9e`**. No unpushed commits remained at the end of the check.

## Step 2 — CORS rejection in production

**Confirmed — PASS:** Exactly one GET was sent to `https://usmnt-tracker.replit.app/api/schedule` with `Origin: https://not-allowed.example`.

- HTTP status: **403**
- Body shape: **JSON object with an `error` field of type string**

## Step 3 — Kickoff label in production

**Confirmed:** The production schedule response stores the USA vs Haiti return-leg kickoff as:

```text
2026-11-18T00:00:00.000Z
```

**Confirmed — PASS:** Running the formatter from HEAD with `America/New_York` produces:

- `formatTime`: **`7:00 PM EST`**
- `formatKickoff`: **`Nov 17, 7:00 PM EST`**

**Confirmed:** The deployed frontend contains the `abe9999` formatter change. The live chunk `/assets/formatTime-DPOtGdJu.js` formats the timezone abbreviation using the fixture's instant (`formatToParts(t)`), and the deployed FixtureCard imports that formatter. This confirms the deployed code, without claiming a visual browser check.

Export note: The subsequent user-requested Markdown export created only `reports/post-publish-check.md`. It did not rerun requests, commit, push, publish, or restart anything.

No database writes were performed.
