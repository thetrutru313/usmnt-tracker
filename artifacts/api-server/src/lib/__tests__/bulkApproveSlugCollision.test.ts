/**
 * Regression guard: confirms that bulk-approve never silently skips a
 * high-confidence candidate when a duplicate slug already exists in the
 * players table.
 *
 * ## Why this matters
 * The bulk-approve endpoint catches unique-constraint violations and logs
 * a skip rather than aborting the entire batch.  Without a test, a slug
 * collision (e.g. two "John Smith" candidates) would silently leave one
 * candidate un-promoted — the response count just decrements and no
 * visible error surfaces in the UI.
 *
 * ## What is tested
 * - Two pending candidates share the same slugified name ("john-smith")
 * - Calling POST /admin/review-queue/bulk-approve promotes the first and
 *   skips the second (unique-constraint error on the second insert)
 * - The response body contains { promoted: 1, skipped: 1 }
 * - The second candidate's status update (status → "promoted") is never
 *   called, confirming the row stays in "pending"
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories execute before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockDb,
  tCandidates,
  tPlayers,
  tClubs,
  tEligibilitySignals,
  capturedCandidateUpdateSetCalls,
  mockTx,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tPlayers = { _table: "players" };
  const tClubs = { _table: "clubs" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  // Track every .set({...}) call on tx.update(playerCandidatesTable)
  const capturedCandidateUpdateSetCalls: unknown[] = [];

  let insertCallCount = 0;

  const mockTx = {
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation(() => {
        if (table === tPlayers) {
          insertCallCount++;
          if (insertCallCount >= 2) {
            // Simulate a unique-constraint violation for the second insert
            return Promise.reject(
              new Error("unique constraint violated: players_slug_key"),
            );
          }
        }
        return Promise.resolve(undefined);
      }),
    })),
    update: vi.fn().mockImplementation((table: unknown) => ({
      set: vi.fn().mockImplementation((data: unknown) => {
        if (table === tCandidates) {
          capturedCandidateUpdateSetCalls.push(data);
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  };

  const mockDb = {
    select: vi.fn(),
    transaction: vi.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => {
      // Reset insert counter for each transaction run
      insertCallCount = 0;
      return fn(mockTx);
    }),
    // Unused by bulk-approve but required so other routes in the module load
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return {
    mockDb,
    tCandidates,
    tPlayers,
    tClubs,
    tEligibilitySignals,
    capturedCandidateUpdateSetCalls,
    mockTx,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playerCandidatesTable: tCandidates,
  playersTable: tPlayers,
  clubsTable: tClubs,
  eligibilitySignalsTable: tEligibilitySignals,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
  desc: (_col: unknown) => ({ _desc: _col }),
  isNull: (_col: unknown) => ({ _isNull: _col }),
  isNotNull: (_col: unknown) => ({ _isNotNull: _col }),
  or: (...args: unknown[]) => ({ _or: args }),
  and: (...args: unknown[]) => ({ _and: args }),
  gte: (_col: unknown, _val: unknown) => ({ _gte: [_col, _val] }),
  inArray: (_col: unknown, _vals: unknown) => ({ _inArray: [_col, _vals] }),
}));

vi.mock("../playerDiscovery.js", () => ({
  rescoreAllCandidates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: vi.fn().mockResolvedValue([]),
  apiKey: vi.fn().mockReturnValue("test-key"),
  syncApiFootballFixtures: vi.fn().mockResolvedValue(undefined),
  syncNationalTeamFixtures: vi.fn().mockResolvedValue(undefined),
  syncYouthNtFixtures: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../playerClubSync.js", () => ({
  ageFromBirthDate: vi.fn().mockReturnValue(null),
  syncPlayerClubs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../playerStatsSync.js", () => ({
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../anonUserCleanup.js", () => ({
  cleanupOrphanedAnonUsers: vi.fn().mockResolvedValue(0),
}));

vi.mock("../commitmentTracker.js", () => ({
  runCommitmentSweep: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks are registered
import adminRouter from "../../routes/admin.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Both candidates have the same name → same slug "john-smith" */
const CANDIDATE_1 = {
  id: 1,
  name: "John Smith",
  position: "MF",
  age: 22,
  clubId: 10,
  apiFootballPlayerId: 1001,
  nationality: "American",
  birthCountry: "USA",
  currentSeasonStarts: 20,
  currentSeasonMinutes: 1800,
  currentSeasonRating: "7.2",
  priorNationalTeamCaps: 0,
  eligibilityBasis: "birth_country",
  status: "pending",
  eligibilityConfidence: 85,
  needsReview: false,
  isManualOverride: false,
  statusNotes: null,
  usmntStatus: "US_ELIGIBLE_PROSPECT",
  dataSources: null,
  discoveredAt: new Date("2026-01-01"),
};

const CANDIDATE_2 = {
  ...CANDIDATE_1,
  id: 2,
  apiFootballPlayerId: 1002,
  eligibilityConfidence: 90,
};

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /admin/review-queue/bulk-approve — slug collision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCandidateUpdateSetCalls.length = 0;

    // Set the admin password env var so the auth middleware passes
    process.env["ADMIN_PASSWORD"] = "test-secret";

    // Restore transaction mock after clearAllMocks
    mockDb.transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<void>) => {
        let insertCallCount = 0;
        const txWithCounter = {
          ...mockTx,
          insert: vi.fn().mockImplementation((table: unknown) => ({
            values: vi.fn().mockImplementation(() => {
              if (table === tPlayers) {
                insertCallCount++;
                if (insertCallCount >= 2) {
                  return Promise.reject(
                    new Error("unique constraint violated: players_slug_key"),
                  );
                }
              }
              return Promise.resolve(undefined);
            }),
          })),
          update: vi.fn().mockImplementation((table: unknown) => ({
            set: vi.fn().mockImplementation((data: unknown) => {
              if (table === tCandidates) {
                capturedCandidateUpdateSetCalls.push(data);
              }
              return { where: vi.fn().mockResolvedValue(undefined) };
            }),
          })),
        };
        return fn(txWithCounter);
      },
    );

    // db.select returns both candidates from the .where() call
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([CANDIDATE_1, CANDIDATE_2]),
      }),
    });
  });

  it("returns promoted: 1 and skipped: 1 when the second insert hits a unique constraint", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/admin/review-queue/bulk-approve")
      .set("Authorization", "Bearer test-secret")
      .send({ minConfidence: 80 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promoted: 1, skipped: 1 });
  });

  it("includes skippedDetails with the colliding candidate's id, name, and reason", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/admin/review-queue/bulk-approve")
      .set("Authorization", "Bearer test-secret")
      .send({ minConfidence: 80 });

    expect(res.status).toBe(200);
    expect(res.body.skippedDetails).toBeDefined();
    expect(Array.isArray(res.body.skippedDetails)).toBe(true);
    expect(res.body.skippedDetails).toHaveLength(1);
    expect(res.body.skippedDetails[0]).toMatchObject({
      id: CANDIDATE_2.id,
      name: CANDIDATE_2.name,
      reason: "slug_collision",
    });
  });

  it("marks only the first candidate as promoted (status update called once with promoted)", async () => {
    const app = makeApp();
    await request(app)
      .post("/admin/review-queue/bulk-approve")
      .set("Authorization", "Bearer test-secret")
      .send({ minConfidence: 80 });

    const promotedUpdates = capturedCandidateUpdateSetCalls.filter((call) => {
      const update = call as Record<string, unknown>;
      return update["status"] === "promoted";
    });

    expect(
      promotedUpdates.length,
      "status should be set to 'promoted' exactly once — the colliding candidate must stay pending",
    ).toBe(1);
  });

  it("never sets the second candidate's status to promoted (it stays pending)", async () => {
    const app = makeApp();
    await request(app)
      .post("/admin/review-queue/bulk-approve")
      .set("Authorization", "Bearer test-secret")
      .send({ minConfidence: 80 });

    // Total update calls should be 1 (only the successful candidate)
    const allStatusUpdates = capturedCandidateUpdateSetCalls.filter((call) => {
      const update = call as Record<string, unknown>;
      return "status" in update;
    });

    expect(
      allStatusUpdates.length,
      "only one candidate should have its status updated — the skipped candidate must remain untouched",
    ).toBe(1);
  });
});
