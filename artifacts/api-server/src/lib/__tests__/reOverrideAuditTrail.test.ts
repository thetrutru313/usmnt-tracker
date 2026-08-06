/**
 * Regression guard: confirms that calling override-status twice on the same
 * candidate correctly updates usmnt_status to the latest value while
 * preserving the full audit trail in status_notes.
 *
 * ## Why this matters
 * Each override call appends a timestamped note to status_notes.  If the
 * second call were to overwrite (rather than append) status_notes, the
 * original override reason would be silently lost.  Without this guard, a
 * future change to the append logic could clobber earlier audit entries.
 *
 * ## What is tested
 * 1. A first call sets usmnt_status = DUAL_NATIONAL and writes one note entry.
 * 2. A second call sets usmnt_status = DECLARED_OTHER and appends a second
 *    note — the DB update payload contains BOTH note entries.
 * 3. usmnt_status in the second update reflects the new value (DECLARED_OTHER).
 * 4. is_manual_override remains true in both update calls.
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
  capturedUpdateSetCalls,
  candidateState,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tPlayers   = { _table: "players" };
  const tClubs     = { _table: "clubs" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  // Mutable state that simulates what the DB holds for our candidate between
  // the two override calls.
  const candidateState: { id: number; statusNotes: string | null } = {
    id: 42,
    statusNotes: null,
  };

  // Every payload passed to .set({...}) on db.update(playerCandidatesTable)
  const capturedUpdateSetCalls: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((payload: unknown) => {
        capturedUpdateSetCalls.push(payload);
        // Simulate the DB write so the next SELECT sees the updated notes
        if (
          payload !== null &&
          typeof payload === "object" &&
          "statusNotes" in payload
        ) {
          candidateState.statusNotes = (payload as { statusNotes: string }).statusNotes;
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    transaction: vi.fn(),
  };

  return {
    mockDb,
    tCandidates,
    tPlayers,
    tClubs,
    tEligibilitySignals,
    capturedUpdateSetCalls,
    candidateState,
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
  // requireAdminSession queries this table; the mock DB's select chain returns
  // a truthy result for any query so the middleware passes through.
  adminSessionsTable: { _table: "admin_sessions" },
}));

vi.mock("drizzle-orm", () => ({
  eq:        (_col: unknown, val: unknown)            => ({ _eq: val }),
  and:       (...args: unknown[])                     => ({ _and: args }),
  or:        (...args: unknown[])                     => ({ _or: args }),
  isNull:    (_col: unknown)                          => ({ _isNull: _col }),
  isNotNull: (_col: unknown)                          => ({ _isNotNull: _col }),
  asc:       (_col: unknown)                          => ({ _asc: _col }),
  desc:      (_col: unknown)                          => ({ _desc: _col }),
  gt:        (_col: unknown, _val: unknown)           => ({ _gt:  [_col, _val] }),
  gte:       (_col: unknown, _val: unknown)           => ({ _gte: [_col, _val] }),
  lte:       (_col: unknown, _val: unknown)           => ({ _lte: [_col, _val] }),
  lt:        (_col: unknown, _val: unknown)           => ({ _lt:  [_col, _val] }),
  inArray:   (_col: unknown, _vals: unknown)          => ({ _inArray: [_col, _vals] }),
  count:     ()                                       => ({ _count: true }),
  sql:       Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ _sql: true }),
    { raw: (_val: string) => ({ _sqlRaw: _val }) },
  ),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: vi.fn().mockResolvedValue([]),
  apiKey: vi.fn().mockReturnValue("test-key"),
  syncApiFootballFixtures: vi.fn().mockResolvedValue(undefined),
  syncNationalTeamFixtures: vi.fn().mockResolvedValue(undefined),
  syncYouthNtFixtures: vi.fn().mockResolvedValue(undefined),
  isFriendlyLeague: vi.fn().mockReturnValue(false),
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: vi.fn().mockReturnValue(false),
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../playerDiscovery.js", () => ({
  rescoreAllCandidates: vi.fn().mockResolvedValue({ processed: 0, updated: 0, failed: 0 }),
  runDiscoveryPass: vi.fn().mockResolvedValue(undefined),
  backfillCandidateBirthplaces: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../playerClubSync.js", () => ({
  ageFromBirthDate: vi.fn().mockReturnValue(null),
  syncPlayerClubs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../anonUserCleanup.js", () => ({
  cleanupOrphanedAnonUsers: vi.fn().mockResolvedValue(0),
}));

vi.mock("../commitmentTracker.js", () => ({
  runCommitmentSweep: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import route under test (after mocks)
// ---------------------------------------------------------------------------

import adminRouter from "../../routes/admin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/", adminRouter);
  return app;
}

/** Wire mockDb.select to return the current candidateState snapshot. */
function setupSelectMock() {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() =>
          Promise.resolve([{ id: candidateState.id, statusNotes: candidateState.statusNotes }]),
        ),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("override-status — re-override audit trail", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdateSetCalls.length = 0;
    candidateState.statusNotes = null;

    // Restore update mock after clearAllMocks
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockImplementation((payload: unknown) => {
        capturedUpdateSetCalls.push(payload);
        if (
          payload !== null &&
          typeof payload === "object" &&
          "statusNotes" in payload
        ) {
          candidateState.statusNotes = (payload as { statusNotes: string }).statusNotes;
        }
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));

    // Provide the admin password so the auth middleware passes
    process.env["ADMIN_PASSWORD"] = "test-secret";

    app = buildApp();
    setupSelectMock();
  });

  it("updates usmnt_status to the latest value on the second override", async () => {
    // First override: set DUAL_NATIONAL
    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DUAL_NATIONAL", reason: "holds dual citizenship" })
      .expect(200);

    // Re-wire select to return the state after the first update
    setupSelectMock();

    // Second override: correct to DECLARED_OTHER
    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DECLARED_OTHER", reason: "declared for Mexico" })
      .expect(200);

    expect(capturedUpdateSetCalls).toHaveLength(2);

    const secondUpdate = capturedUpdateSetCalls[1] as { usmntStatus: string };
    expect(secondUpdate.usmntStatus).toBe("DECLARED_OTHER");
  });

  it("keeps is_manual_override = true after the second override", async () => {
    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DUAL_NATIONAL", reason: "holds dual citizenship" })
      .expect(200);

    setupSelectMock();

    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DECLARED_OTHER", reason: "declared for Mexico" })
      .expect(200);

    for (const call of capturedUpdateSetCalls) {
      expect((call as { isManualOverride: boolean }).isManualOverride).toBe(true);
    }
  });

  it("preserves the first override note when a second override is applied", async () => {
    // First override
    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DUAL_NATIONAL", reason: "holds dual citizenship" })
      .expect(200);

    // The state now has the first note; re-wire select to reflect this
    setupSelectMock();

    // Second override
    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DECLARED_OTHER", reason: "declared for Mexico" })
      .expect(200);

    expect(capturedUpdateSetCalls).toHaveLength(2);

    const secondUpdateNotes = (capturedUpdateSetCalls[1] as { statusNotes: string }).statusNotes;

    // Both note entries must appear in the final status_notes string
    expect(secondUpdateNotes).toContain("Override: DUAL_NATIONAL");
    expect(secondUpdateNotes).toContain("holds dual citizenship");
    expect(secondUpdateNotes).toContain("Override: DECLARED_OTHER");
    expect(secondUpdateNotes).toContain("declared for Mexico");
  });

  it("status_notes contains exactly two entries after two overrides", async () => {
    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DUAL_NATIONAL", reason: "holds dual citizenship" })
      .expect(200);

    setupSelectMock();

    await request(app)
      .post("/admin/review-queue/42/override-status")
      .set("Authorization", "Bearer test-secret")
      .send({ usmnt_status: "DECLARED_OTHER", reason: "declared for Mexico" })
      .expect(200);

    const secondUpdateNotes = (capturedUpdateSetCalls[1] as { statusNotes: string }).statusNotes;

    // Notes are newline-separated; two overrides → two lines
    const lines = secondUpdateNotes.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});
