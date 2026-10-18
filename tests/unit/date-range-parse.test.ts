import { describe, expect, it } from "vitest";

import { parsePolishDateRange } from "@/lib/date-range-parse";

// All non-DST cases are anchored at a single fixed instant per describe block, picked so the
// Poland wall clock lands well inside the day (never near midnight), so the date key under test
// is unambiguous. The DST-transition block below is the one that pins instants either side of
// the real 2026 transitions -- see its own comment for why those two days were chosen.

describe("parsePolishDateRange — dzisiaj / wczoraj", () => {
  // 2026-07-15T12:00:00Z is 14:00 local (CEST, +02:00) -- midsummer, well clear of midnight.
  const now = new Date("2026-07-15T12:00:00Z");

  it("dzisiaj resolves to today's bounds", () => {
    expect(parsePolishDateRange("Co się działo dzisiaj?", now)).toEqual({
      start: "2026-07-15T00:00",
      end: "2026-07-16T00:00",
    });
  });

  it("wczoraj resolves to yesterday's bounds", () => {
    expect(parsePolishDateRange("Co jadła wczoraj", now)).toEqual({
      start: "2026-07-14T00:00",
      end: "2026-07-15T00:00",
    });
  });

  it("matches case-insensitively", () => {
    expect(parsePolishDateRange("DZISIAJ coś się stało", now)).toEqual({
      start: "2026-07-15T00:00",
      end: "2026-07-16T00:00",
    });
  });
});

describe("parsePolishDateRange — week phrases (ISO week, Monday-start)", () => {
  // 2026-07-15 is a Wednesday; its week runs Monday 2026-07-13 to Sunday 2026-07-19.
  const now = new Date("2026-07-15T12:00:00Z");

  it("w tym tygodniu resolves to the current ISO week", () => {
    expect(parsePolishDateRange("Co było w tym tygodniu", now)).toEqual({
      start: "2026-07-13T00:00",
      end: "2026-07-20T00:00",
    });
  });

  it("w zeszłym tygodniu resolves to the previous ISO week", () => {
    expect(parsePolishDateRange("Co było w zeszłym tygodniu", now)).toEqual({
      start: "2026-07-06T00:00",
      end: "2026-07-13T00:00",
    });
  });

  it("w ostatnim tygodniu is a synonym for w zeszłym tygodniu", () => {
    expect(parsePolishDateRange("Co było w ostatnim tygodniu", now)).toEqual({
      start: "2026-07-06T00:00",
      end: "2026-07-13T00:00",
    });
  });
});

describe("parsePolishDateRange — month phrases", () => {
  // 2026-07-15 -- mid-July, no month-boundary edge case.
  const now = new Date("2026-07-15T12:00:00Z");

  it("w tym miesiącu resolves to the current calendar month", () => {
    expect(parsePolishDateRange("Co było w tym miesiącu", now)).toEqual({
      start: "2026-07-01T00:00",
      end: "2026-08-01T00:00",
    });
  });

  it("w zeszłym miesiącu resolves to the previous calendar month", () => {
    expect(parsePolishDateRange("Co było w zeszłym miesiącu", now)).toEqual({
      start: "2026-06-01T00:00",
      end: "2026-07-01T00:00",
    });
  });

  it("w zeszłym miesiącu carries the year backwards in January", () => {
    // 2026-01-15T12:00:00Z is 13:00 local (CET, +01:00) -- the year-rollover edge of shiftMonth.
    const january = new Date("2026-01-15T12:00:00Z");
    expect(parsePolishDateRange("Co było w zeszłym miesiącu", january)).toEqual({
      start: "2025-12-01T00:00",
      end: "2026-01-01T00:00",
    });
  });
});

describe("parsePolishDateRange — year phrases", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("w tym roku resolves to the current calendar year", () => {
    expect(parsePolishDateRange("Co było w tym roku", now)).toEqual({
      start: "2026-01-01T00:00",
      end: "2027-01-01T00:00",
    });
  });

  it("w zeszłym roku resolves to the previous calendar year", () => {
    expect(parsePolishDateRange("Co było w zeszłym roku", now)).toEqual({
      start: "2025-01-01T00:00",
      end: "2026-01-01T00:00",
    });
  });
});

describe("parsePolishDateRange — month names (assume the current year)", () => {
  // 2026-06-15T12:00:00Z is 14:00 local (CEST) -- any fixed midyear instant works, since the
  // behavior under test is the locative-name lookup and the year carried from `now`, not a
  // boundary condition in the anchor itself (the January year-rollover is covered above).
  const now = new Date("2026-06-15T12:00:00Z");

  const MONTHS: [phrase: string, start: string, end: string][] = [
    ["w styczniu", "2026-01-01T00:00", "2026-02-01T00:00"],
    ["w lutym", "2026-02-01T00:00", "2026-03-01T00:00"],
    ["w marcu", "2026-03-01T00:00", "2026-04-01T00:00"],
    ["w kwietniu", "2026-04-01T00:00", "2026-05-01T00:00"],
    ["w maju", "2026-05-01T00:00", "2026-06-01T00:00"],
    ["w czerwcu", "2026-06-01T00:00", "2026-07-01T00:00"],
    ["w lipcu", "2026-07-01T00:00", "2026-08-01T00:00"],
    ["w sierpniu", "2026-08-01T00:00", "2026-09-01T00:00"],
    ["w wrześniu", "2026-09-01T00:00", "2026-10-01T00:00"],
    ["w październiku", "2026-10-01T00:00", "2026-11-01T00:00"],
    ["w listopadzie", "2026-11-01T00:00", "2026-12-01T00:00"],
    // December is the one that carries the year forward -- the mirror of January's backward carry above.
    ["w grudniu", "2026-12-01T00:00", "2027-01-01T00:00"],
  ];

  for (const [phrase, start, end] of MONTHS) {
    it(`"${phrase}" resolves to that month's bounds`, () => {
      expect(parsePolishDateRange(`Co było ${phrase}?`, now)).toEqual({ start, end });
    });
  }
});

describe("parsePolishDateRange — across Poland's 2026 DST transitions", () => {
  // Poland observes the EU rule -- CET (+01:00) in winter, CEST (+02:00) in summer, switching at
  // 01:00 UTC on the last Sunday of March and of October. For 2026 those Sundays are 29 March and
  // 25 October (see tests/unit/wall-clock.test.ts, which verifies this same pair of days). Both
  // 2026-03-29 and 2026-10-25 are themselves Sundays, so this block doubles as the ISO-week-start
  // computation's DST check: if `today` or the week/month math it feeds ever routed through a real
  // elapsed-time `Date` comparison instead of pure calendar-field arithmetic, the instant either
  // side of the transition would resolve to a different calendar day or a boundary an hour off.
  const SPRING_BEFORE = new Date("2026-03-29T00:59:00Z"); // 01:59 local, still +01:00
  const SPRING_AFTER = new Date("2026-03-29T01:01:00Z"); // 03:01 local, +02:00 -- the jump
  const FALL_BEFORE = new Date("2026-10-25T00:59:00Z"); // 02:59 local, still +02:00
  const FALL_AFTER = new Date("2026-10-25T01:59:00Z"); // 02:59 local again, the repeated hour's last minute, +01:00

  it("dzisiaj agrees on both sides of spring-forward", () => {
    const expected = { start: "2026-03-29T00:00", end: "2026-03-30T00:00" };
    expect(parsePolishDateRange("dzisiaj", SPRING_BEFORE)).toEqual(expected);
    expect(parsePolishDateRange("dzisiaj", SPRING_AFTER)).toEqual(expected);
  });

  it("dzisiaj agrees on both sides of fall-back", () => {
    const expected = { start: "2026-10-25T00:00", end: "2026-10-26T00:00" };
    expect(parsePolishDateRange("dzisiaj", FALL_BEFORE)).toEqual(expected);
    expect(parsePolishDateRange("dzisiaj", FALL_AFTER)).toEqual(expected);
  });

  it("w tym tygodniu agrees on both sides of spring-forward", () => {
    // 2026-03-29 is a Sunday, so its ISO week started Monday 2026-03-23.
    const expected = { start: "2026-03-23T00:00", end: "2026-03-30T00:00" };
    expect(parsePolishDateRange("w tym tygodniu", SPRING_BEFORE)).toEqual(expected);
    expect(parsePolishDateRange("w tym tygodniu", SPRING_AFTER)).toEqual(expected);
  });

  it("w tym tygodniu agrees on both sides of fall-back", () => {
    // 2026-10-25 is a Sunday, so its ISO week started Monday 2026-10-19.
    const expected = { start: "2026-10-19T00:00", end: "2026-10-26T00:00" };
    expect(parsePolishDateRange("w tym tygodniu", FALL_BEFORE)).toEqual(expected);
    expect(parsePolishDateRange("w tym tygodniu", FALL_AFTER)).toEqual(expected);
  });

  it("w tym miesiącu agrees on both sides of spring-forward", () => {
    const expected = { start: "2026-03-01T00:00", end: "2026-04-01T00:00" };
    expect(parsePolishDateRange("w tym miesiącu", SPRING_BEFORE)).toEqual(expected);
    expect(parsePolishDateRange("w tym miesiącu", SPRING_AFTER)).toEqual(expected);
  });

  it("w tym miesiącu agrees on both sides of fall-back", () => {
    const expected = { start: "2026-10-01T00:00", end: "2026-11-01T00:00" };
    expect(parsePolishDateRange("w tym miesiącu", FALL_BEFORE)).toEqual(expected);
    expect(parsePolishDateRange("w tym miesiącu", FALL_AFTER)).toEqual(expected);
  });
});

describe("parsePolishDateRange — unrecognized input", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("returns null for a phrase naming no recognized period", () => {
    expect(parsePolishDateRange("Czy jadła obiad", now)).toBeNull();
  });

  it("returns null for an empty question", () => {
    expect(parsePolishDateRange("", now)).toBeNull();
  });

  it("returns null for an unrecognized period phrase", () => {
    expect(parsePolishDateRange("w przyszłym tygodniu", now)).toBeNull();
  });
});
