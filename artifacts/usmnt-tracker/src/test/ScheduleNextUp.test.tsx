/**
 * The Schedule page's NEXT UP chip follows the server's choice, which uses
 * the dashboard hero's rule. It used to pick the first event starting today
 * or later (UTC), so the chip jumped to December on 13 Nov while the Nations
 * League quarterfinals (13–17 Nov) were still being played.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import Schedule from "@/pages/Schedule";

const mockUseListScheduleEvents = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListScheduleEvents: (...args: unknown[]) => mockUseListScheduleEvents(...args),
}));

function event(id: number, slug: string, name: string, startDate: string, endDate: string) {
  return {
    id, slug, name, kind: id === 1 ? "nations-league" : "friendly", status: "confirmed",
    startDate, endDate, dateLabel: name, description: name, sortOrder: id,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", fixtures: [],
  };
}
const EVENTS = [
  event(1, "cnl-qf-nov-2026", "Nations League Quarterfinals", "2026-11-13", "2026-11-17"),
  event(2, "dec-friendly-2026", "December Friendly", "2026-12-12", "2026-12-16"),
];

function cardOf(name: string) {
  return screen.getByRole("heading", { name }).closest("div.relative") as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T16:00:00Z")); // between the two Haiti legs
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Schedule — NEXT UP", () => {
  it("marks the event the server chose, even when it started before today", () => {
    mockUseListScheduleEvents.mockReturnValue({
      data: { events: EVENTS, nextEventSlug: "cnl-qf-nov-2026" },
      isLoading: false,
      error: null,
    });
    render(<Router><Schedule /></Router>);
    expect(screen.getAllByText("NEXT UP")).toHaveLength(1);
    expect(cardOf("Nations League Quarterfinals")).toHaveTextContent("NEXT UP");
    expect(cardOf("December Friendly")).not.toHaveTextContent("NEXT UP");
  });

  it("shows no chip when the server names no event", () => {
    mockUseListScheduleEvents.mockReturnValue({
      data: { events: EVENTS, nextEventSlug: null },
      isLoading: false,
      error: null,
    });
    render(<Router><Schedule /></Router>);
    expect(screen.queryByText("NEXT UP")).not.toBeInTheDocument();
  });
});
