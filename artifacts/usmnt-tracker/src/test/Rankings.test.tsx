/**
 * Test 3 — Rankings page does not render a Transfer Buzz section.
 *
 * Q4 confirmed the transferBuzz query has always returned an empty array
 * (no rumour rows exist; the only writer hardcodes status='confirmed').
 * Task D removes the query and panel entirely.
 *
 * This test serves as a permanent regression guard: if a "Transfer Buzz"
 * heading is ever re-added to the Rankings page, this test will fail and
 * force an explicit discussion about the missing data source.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Rankings from "@/pages/Rankings";

// ─── Mock wouter ──────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// ─── Mock rankings hook ───────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useGetRankings: () => ({
    data: {
      mostInForm: [],
      bestWeekendPerformances: [],
      mostMinutes: [],
      mostGoalContributions: [],
      returningFromInjury: [],
      risingFast: [],
      // transferBuzz was in the schema before Task D removed it.
      // Providing it here keeps the mock valid across both code states.
      transferBuzz: [],
      seasonYear: "2026",
    },
    isLoading: false,
  }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Rankings page — no Transfer Buzz section", () => {
  it("does not render a 'Transfer Buzz' heading or section", () => {
    render(<Rankings />);
    // Confirm no heading or label contains "Transfer Buzz" or "transfer buzz"
    const buzzElements = screen.queryAllByText(/transfer buzz/i);
    expect(buzzElements).toHaveLength(0);
  });

  it("does render the standard leaderboard sections that do have data", () => {
    render(<Rankings />);
    // Smoke-check that the page renders its established sections
    expect(screen.getByText(/smart rankings/i)).toBeInTheDocument();
  });
});
