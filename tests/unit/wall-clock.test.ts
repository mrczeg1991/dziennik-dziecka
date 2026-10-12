// The helpers are imported explicitly rather than relying on Vitest globals, so eslint.config.js
// needs no globals entry for this directory and strictTypeChecked keeps its type information.
import { describe, expect, it } from "vitest";

import {
  FUTURE_TOLERANCE_MS,
  formatWallClock,
  isFutureWallClock,
  WALL_CLOCK_RE,
  warsawWallClock,
} from "@/lib/wall-clock";
// The second implementation of the same function, the one scripts/smoke.mjs runs. Imported here so
// the parity block below can hold the two to the same output; that assertion is the only thing
// keeping the duplication honest.
import { warsawWallClock as warsawWallClockMjs } from "../../scripts/lib/wall-clock.mjs";

// Fixed UTC instants, each paired with the Poland wall clock it must produce. Every expectation is
// derived from the zone's UTC offset at that instant, not from running the function:
//
//   Poland observes the EU rule -- CET (+01:00) in winter, CEST (+02:00) in summer, switching at
//   01:00 UTC on the last Sunday of March and of October. For 2026 those Sundays are 29 March and
//   25 October (verified by calendar: 1 March 2026 is a Sunday, so 29 March is the last one;
//   1 October is a Thursday, so 25 October is).
//
// So the wall clock is the UTC instant plus the offset in force at it, and nothing here reads the
// real clock -- a test that called `new Date()` unpinned would pass or fail by the day it ran.
const INSTANTS: [instant: string, wallClock: string, why: string][] = [
  ["2026-01-15T12:00:00Z", "2026-01-15T13:00", "midwinter, +01:00"],
  ["2026-03-29T00:59:00Z", "2026-03-29T01:59", "one minute before spring-forward, still +01:00"],
  ["2026-03-29T01:00:00Z", "2026-03-29T03:00", "the spring-forward instant: +02:00, so 02:00 local never happens"],
  ["2026-03-29T01:01:00Z", "2026-03-29T03:01", "one minute after spring-forward, +02:00"],
  ["2026-07-15T12:00:00Z", "2026-07-15T14:00", "midsummer, +02:00"],
  ["2026-10-25T00:59:00Z", "2026-10-25T02:59", "one minute before fall-back, still +02:00"],
  ["2026-10-25T01:00:00Z", "2026-10-25T02:00", "the fall-back instant: +01:00, so 02:00 local starts over"],
  ["2026-10-25T01:59:00Z", "2026-10-25T02:59", "the repeated hour's last minute, +01:00 -- 02:59 local a second time"],
  ["2026-12-31T23:30:00Z", "2027-01-01T00:30", "+01:00 carries the local date into the next year"],
];

describe("formatWallClock", () => {
  it("renders a datetime-local value as dd.mm.rrrr, HH:mm", () => {
    expect(formatWallClock("2026-09-27T21:05")).toBe("27.09.2026, 21:05");
  });

  it("drops the seconds a stored value may carry", () => {
    // `formatWallClock`'s docstring promises `YYYY-MM-DDTHH:mm[:ss]`; a value read
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

describe("warsawWallClock", () => {
  // The string this returns is what reaches `occurred_at` when a note is submitted without a
  // moment, so these are the strings a parent would see on their own note.
  for (const [instant, wallClock, why] of INSTANTS) {
    it(`reads ${wallClock} at ${instant} — ${why}`, () => {
      expect(warsawWallClock(new Date(instant))).toBe(wallClock);
    });
  }

  it("maps two distinct instants in the repeated hour to the same wall clock", () => {
    // Fall-back makes 02:59 local happen twice, an hour apart. A stored wall clock cannot tell
    // them apart, and that is the documented trade-off of storing one — asserted so a future
    // change that starts storing an offset fails here rather than silently changing the contract.
    expect(warsawWallClock(new Date("2026-10-25T00:59:00Z"))).toBe(warsawWallClock(new Date("2026-10-25T01:59:00Z")));
  });

  it("returns a value the stored-shape regex accepts", () => {
    expect(WALL_CLOCK_RE.test(warsawWallClock(new Date("2026-03-29T01:00:00Z")))).toBe(true);
  });
});

describe("warsawWallClock parity between src/lib and scripts/lib", () => {
  // scripts/smoke.mjs cannot import the TypeScript module, so a second copy lives at
  // scripts/lib/wall-clock.mjs. This is the test that makes that duplication safe: if either copy
  // drifts, including across a DST transition, the pair stops agreeing here.
  for (const [instant, wallClock, why] of INSTANTS) {
    it(`agrees at ${instant} — ${why}`, () => {
      const at = new Date(instant);
      expect(warsawWallClockMjs(at)).toBe(warsawWallClock(at));
      expect(warsawWallClockMjs(at)).toBe(wallClock);
    });
  }
});

describe("isFutureWallClock", () => {
  // Every case injects its instant. The tolerance exists because a Worker's `Date.now()` reports
  // the time of the last I/O, so the edges below are expressed relative to it rather than guessed.
  const now = new Date("2026-07-15T12:00:00Z");
  // Poland is on +02:00 in July, so `now` is 14:00 local and the tolerated edge is 14:05.
  const edge = "2026-07-15T14:05";

  it("pins the tolerance the edges below are derived from", () => {
    expect(FUTURE_TOLERANCE_MS).toBe(5 * 60_000);
  });

  it("accepts the current minute", () => {
    expect(isFutureWallClock("2026-07-15T14:00", now)).toBe(false);
  });

  it("accepts a moment at the far edge of the tolerance", () => {
    expect(isFutureWallClock(edge, now)).toBe(false);
  });

  it("rejects the first minute beyond the tolerance", () => {
    expect(isFutureWallClock("2026-07-15T14:06", now)).toBe(true);
  });

  it("accepts a backdated moment", () => {
    expect(isFutureWallClock("2026-07-12T09:30", now)).toBe(false);
  });

  it("rejects a moment a year ahead", () => {
    // The pair scripts/smoke.mjs walks: a year-ahead note rejected, a backdated one accepted.
    expect(isFutureWallClock("2027-07-15T14:00", now)).toBe(true);
  });

  it("resolves the tolerance in Poland's zone, not UTC", () => {
    // A UTC-based comparison would put the edge at 12:05 and wrongly reject 14:05.
    expect(isFutureWallClock("2026-07-15T12:05", now)).toBe(false);
    expect(isFutureWallClock(edge, now)).toBe(false);
  });

  it("applies the tolerance across spring-forward, where the next minute is two hours on", () => {
    // 00:59 UTC is 01:59 local on +01:00; five minutes later the zone is on +02:00, so the edge is
    // 03:04 local and not 02:04 -- an hour of wall clock that does not exist is skipped.
    const atTransition = new Date("2026-03-29T00:59:00Z");
    expect(isFutureWallClock("2026-03-29T03:04", atTransition)).toBe(false);
    expect(isFutureWallClock("2026-03-29T03:05", atTransition)).toBe(true);
  });
});
