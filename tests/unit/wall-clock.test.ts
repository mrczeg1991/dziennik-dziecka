// The helpers are imported explicitly rather than relying on Vitest globals, so eslint.config.js
// needs no globals entry for this directory and strictTypeChecked keeps its type information.
import { describe, expect, it } from "vitest";

import { formatWallClock, WALL_CLOCK_RE } from "@/lib/wall-clock";

describe("formatWallClock", () => {
  it("renders a datetime-local value as dd.mm.rrrr, HH:mm", () => {
    expect(formatWallClock("2026-09-27T21:05")).toBe("27.09.2026, 21:05");
  });

  it("drops the seconds a stored value may carry", () => {
    // The docstring at src/lib/wall-clock.ts:27 promises `YYYY-MM-DDTHH:mm[:ss]`; a value read
    // back from the database can carry seconds, and the minute output must not shift.
    expect(formatWallClock("2026-09-27T21:05:43")).toBe("27.09.2026, 21:05");
  });

  it("keeps the day and month in the right order for a single-digit day", () => {
    expect(formatWallClock("2026-07-03T08:00")).toBe("03.07.2026, 08:00");
  });
});

describe("WALL_CLOCK_RE", () => {
  it("accepts the shape a datetime-local field submits", () => {
    expect(WALL_CLOCK_RE.test("2026-09-27T21:05")).toBe(true);
  });

  it("rejects a seconds-bearing value", () => {
    expect(WALL_CLOCK_RE.test("2026-09-27T21:05:43")).toBe(false);
  });

  it("rejects an offset-bearing value", () => {
    // An offset would mean a zone was applied somewhere; stored notes carry none.
    expect(WALL_CLOCK_RE.test("2026-09-27T21:05+02:00")).toBe(false);
    expect(WALL_CLOCK_RE.test("2026-09-27T19:05Z")).toBe(false);
  });

  it("rejects a date-only value", () => {
    expect(WALL_CLOCK_RE.test("2026-09-27")).toBe(false);
  });
});
