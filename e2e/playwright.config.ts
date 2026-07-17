import { defineConfig, devices } from "@playwright/test";
import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";

// ─── Port discovery ───────────────────────────────────────────────────────────
// The usmnt-tracker Vite dev server is assigned a dynamic PORT by the Replit
// workflow runner.  Discover it at config time by scanning /proc environ files
// for the process that has BASE_PATH=/ (the usmnt-tracker artifact) and is NOT
// the mockup sandbox (which uses BASE_PATH=/__mockup).
// Falls back to the hardcoded default when running outside Replit.
function discoverVitePort(defaultPort = 5173): number {
  if (process.env.E2E_PORT) return parseInt(process.env.E2E_PORT, 10);
  try {
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
        const vars: Record<string, string> = {};
        for (const entry of raw.split("\0")) {
          const idx = entry.indexOf("=");
          if (idx > 0) vars[entry.slice(0, idx)] = entry.slice(idx + 1);
        }
        // usmnt-tracker: BASE_PATH=/ and has a PORT, not the mockup sandbox
        if (vars.BASE_PATH === "/" && vars.PORT && vars.BASE_PATH !== "/__mockup") {
          const port = parseInt(vars.PORT, 10);
          if (!isNaN(port)) return port;
        }
      } catch {
        // proc entry vanished or unreadable — skip
      }
    }
  } catch {
    // /proc not available (non-Linux)
  }
  return defaultPort;
}

// ─── Base URL ─────────────────────────────────────────────────────────────────
// The Vite dev server runs with BASE_PATH=/ so all routes are at the root of
// its port (e.g. http://localhost:24983/players).  Hit it directly rather than
// going through the port-80 proxy, which adds a path prefix that breaks wouter.
const port = discoverVitePort();
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}/`;

// ─── Browser executable ──────────────────────────────────────────────────────
// In the Replit / NixOS environment, Playwright's downloaded headless shell
// cannot resolve shared libraries from the Nix store.  Use the system
// Chromium binary instead.
function resolveChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    return execSync("which chromium", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const executablePath = resolveChromium();

export default defineConfig({
  testDir: "./tests",

  // Start the Vite dev server when no running instance is detected.
  // reuseExistingServer: true means the workflow-managed dev server is reused
  // when tests run interactively; the server is started fresh in CI / validation
  // runs where no workflow is active.
  webServer: [
    {
      // Vite dev server for the usmnt-tracker frontend.
      // cwd is resolved relative to this config file (e2e/playwright.config.ts).
      // reuseExistingServer: true means the Replit workflow's already-running
      // server is reused when tests run interactively; a new server is started in
      // validation / CI runs where no workflow process is active.
      command: "BASE_PATH=/ PORT=5173 pnpm run dev",
      cwd: "../artifacts/usmnt-tracker",
      port: 5173,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Express API server. The smoke tests need it so the React app can load
      // real data (players, fixtures) — without it several tests hit a silent
      // loading state and time out.  dist/ is pre-built by the api-server
      // workflow; `pnpm run start` skips the rebuild and boots in seconds.
      command: "PORT=8080 pnpm run start",
      cwd: "../artifacts/api-server",
      port: 8080,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],

  // 60 s per test — accommodates cold-start lazy-chunk loading + first API fetch.
  timeout: 60_000,

  // Expect calls get 30 s before failing (React.lazy() chunks + React Query
  // fetches can be slow on first navigation after a fresh dev-server boot).
  expect: { timeout: 30_000 },

  // One retry on unexpected flakiness.
  retries: 1,

  // Serial — avoid hammering the single dev-server instance.
  workers: 1,

  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Point at the system Chromium when available; let Playwright fall
          // back to its own binary otherwise.
          ...(executablePath ? { executablePath } : {}),
          // Required in sandbox-less container environments.
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },
  ],
});
