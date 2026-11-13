/**
 * Schedule event windows and the dashboard hero rules (review D7, D8).
 *
 * D8: the +30 h match window is computed once (lib/scheduleWindow.ts) and
 * shared by the Schedule page and the dashboard.
 * D7: a block with only a start date stays the hero until the next block
 * starts, and `tbd` blocks ("Possible Friendlies") never take the hero.
 */

import { describe, expect, it } from "vitest";
import { matchWindowEnd, matchWindowStart, pickHeroEvent } from "../scheduleWindow";

type Ev = { slug: string; status: string; startDate: string | null; endDate: string | null };
const ev = (slug: string, status: string, startDate: string | null, endDate: string | null): Ev =>
  ({ slug, status, startDate, endDate });

describe("match window", () => {
  it("starts at UTC midnight on the start date", () => {
    expect(matchWindowStart("2026-09-26").toISOString()).toBe("2026-09-26T00:00:00.000Z");
  });
  it("ends 30 h after UTC midnight on the end date (keeps an 8 PM ET final)", () => {
    const end = matchWindowEnd("2026-09-29");
    expect(end.toISOString()).toBe("2026-09-30T06:00:00.000Z");
    expect(new Date("2026-09-30T00:00:00Z") < end).toBe(true);
  });
});

describe("pickHeroEvent", () => {
  // In display order, as the dashboard reads them (sortOrder, startDate).
  const events = [
    ev("cnl-finals", "confirmed", "2099-03-25", "2099-03-28"),
    ev("possible-june", "tbd", "2099-06-07", null),
    ev("gold-cup", "approximate", "2099-06-18", "2099-07-11"),
    ev("possible-sept", "tbd", "2099-09-20", null),
    ev("wcq-r2", "approximate", "2099-09-28", null),
    ev("wcq-final", "approximate", "2100-05-29", null),
  ];
  const at = (iso: string, today: string) => pickHeroEvent(events, new Date(iso), today)?.slug;

  it("keeps a windowed event until 30 h after its end date", () => {
    expect(at("2099-03-29T05:59:00Z", "2099-03-29")).toBe("cnl-finals");
    expect(at("2099-03-29T06:00:00Z", "2099-03-29")).not.toBe("cnl-finals");
  });

  it("skips a tbd block: after the March finals the hero is the Gold Cup, not Possible Friendlies", () => {
    expect(at("2099-04-01T12:00:00Z", "2099-04-01")).toBe("gold-cup");
  });

  it("skips a tbd block that has a lower sort order than a confirmed one", () => {
    const list = [ev("possible", "tbd", "2099-05-01", null), ev("real", "confirmed", "2099-05-10", "2099-05-12")];
    expect(pickHeroEvent(list, new Date("2099-04-20T12:00:00Z"), "2099-04-20")?.slug).toBe("real");
  });

  it("skips an undated tbd block", () => {
    const list = [ev("undated-tbd", "tbd", null, null), ev("real", "confirmed", "2099-05-10", "2099-05-12")];
    expect(pickHeroEvent(list, new Date("2099-04-20T12:00:00Z"), "2099-04-20")?.slug).toBe("real");
  });

  it("keeps a start-only block on its start day", () => {
    expect(at("2099-09-28T15:00:00Z", "2099-09-28")).toBe("wcq-r2");
  });

  it("keeps a start-only block after its start day while it is being played", () => {
    expect(at("2099-11-15T12:00:00Z", "2099-11-15")).toBe("wcq-r2");
    expect(at("2100-05-28T12:00:00Z", "2100-05-28")).toBe("wcq-r2");
  });

  it("drops a start-only block once the next block starts", () => {
    expect(at("2100-05-29T12:00:00Z", "2100-05-29")).toBe("wcq-final");
  });

  it("a later tbd block starting does not end a start-only block", () => {
    const list = [ev("wcq", "approximate", "2099-09-01", null), ev("maybe", "tbd", "2099-10-01", null)];
    expect(pickHeroEvent(list, new Date("2099-10-05T12:00:00Z"), "2099-10-05")?.slug).toBe("wcq");
  });

  it("a later windowed block starting ends a start-only block", () => {
    const list = [ev("wcq", "approximate", "2099-09-01", null), ev("oct", "confirmed", "2099-10-05", "2099-10-10")];
    expect(pickHeroEvent(list, new Date("2099-10-05T12:00:00Z"), "2099-10-05")?.slug).toBe("oct");
  });

  it("returns undefined when only tbd blocks remain", () => {
    expect(pickHeroEvent([ev("maybe", "tbd", "2099-10-01", null)], new Date("2099-09-01T00:00:00Z"), "2099-09-01")).toBeUndefined();
  });
});
