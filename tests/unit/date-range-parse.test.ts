import { describe, expect, it } from "vitest";

import { formatDateRange, parsePolishDateRange, stripPeriodPhrase } from "@/lib/date-range-parse";

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

describe("parsePolishDateRange — month names (the most recent occurrence of that month)", () => {
  // 2026-06-15T12:00:00Z is 14:00 local (CEST). A midyear anchor is what makes this table carry
  // its weight: months at or before June resolve to 2026, months after it can only mean 2025, so
  // one table covers both directions of the year resolution.
  const now = new Date("2026-06-15T12:00:00Z");

  const MONTHS: [phrase: string, start: string, end: string][] = [
    ["w styczniu", "2026-01-01T00:00", "2026-02-01T00:00"],
    ["w lutym", "2026-02-01T00:00", "2026-03-01T00:00"],
    ["w marcu", "2026-03-01T00:00", "2026-04-01T00:00"],
    ["w kwietniu", "2026-04-01T00:00", "2026-05-01T00:00"],
    ["w maju", "2026-05-01T00:00", "2026-06-01T00:00"],
    // June is the anchor's own month: the current month stays in the current year.
    ["w czerwcu", "2026-06-01T00:00", "2026-07-01T00:00"],
    // July onward is still ahead of a June anchor, so each one means 2025's month.
    ["w lipcu", "2025-07-01T00:00", "2025-08-01T00:00"],
    ["w sierpniu", "2025-08-01T00:00", "2025-09-01T00:00"],
    ["w wrześniu", "2025-09-01T00:00", "2025-10-01T00:00"],
    ["w październiku", "2025-10-01T00:00", "2025-11-01T00:00"],
    ["w listopadzie", "2025-11-01T00:00", "2025-12-01T00:00"],
    // December carries the year forward off 2025 -- the mirror of January's backward carry above.
    ["w grudniu", "2025-12-01T00:00", "2026-01-01T00:00"],
  ];

  for (const [phrase, start, end] of MONTHS) {
    it(`"${phrase}" resolves to that month's bounds`, () => {
      expect(parsePolishDateRange(`Co było ${phrase}?`, now)).toEqual({ start, end });
    });
  }

  it("never resolves a bare month into the future", () => {
    // The case this rule exists for: pinned to the current year, a March question about July
    // produced a window four months ahead, which matches no note and says so silently.
    const march = new Date("2026-03-10T12:00:00Z");

    expect(parsePolishDateRange("Co jadła w lipcu?", march)).toEqual({
      start: "2025-07-01T00:00",
      end: "2025-08-01T00:00",
    });
  });
});

describe("formatDateRange", () => {
  // The upper bound is exclusive everywhere in this module, so every case here checks that the
  // label names the last day actually IN the window -- never the midnight that bounds it.
  it("renders a whole month as its first and last day", () => {
    expect(formatDateRange({ start: "2026-07-01T00:00", end: "2026-08-01T00:00" })).toBe("01.07.2026 – 31.07.2026");
  });

  it("renders a single day as that day twice", () => {
    expect(formatDateRange({ start: "2026-07-15T00:00", end: "2026-07-16T00:00" })).toBe("15.07.2026 – 15.07.2026");
  });

  it("steps back across a year boundary", () => {
    expect(formatDateRange({ start: "2025-01-01T00:00", end: "2026-01-01T00:00" })).toBe("01.01.2025 – 31.12.2025");
  });

  it("steps back into February in a non-leap year", () => {
    expect(formatDateRange({ start: "2026-02-01T00:00", end: "2026-03-01T00:00" })).toBe("01.02.2026 – 28.02.2026");
  });
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

describe("stripPeriodPhrase", () => {
  // Same instant as the blocks above, for the parity assertions that call the parser.
  const now = new Date("2026-07-15T12:00:00Z");

  it("removes a month phrase and closes the gap before the question mark", () => {
    expect(stripPeriodPhrase("Czy dostawał Nurofenu w lipcu?")).toBe("Czy dostawał Nurofenu?");
  });

  it("removes a phrase from mid-sentence", () => {
    expect(stripPeriodPhrase("Czy dzisiaj coś się działo?")).toBe("Czy coś się działo?");
  });

  it("removes a phrase ending the sentence with no punctuation", () => {
    expect(stripPeriodPhrase("Co jadła wczoraj")).toBe("Co jadła");
  });

  it("removes a multi-word phrase", () => {
    expect(stripPeriodPhrase("Czy był u dentysty w zeszłym tygodniu?")).toBe("Czy był u dentysty?");
  });

  it("matches case-insensitively, like the parser", () => {
    expect(stripPeriodPhrase("W LIPCU coś było")).toBe("coś było");
  });

  it("returns an empty string for a question that is only a period phrase", () => {
    expect(stripPeriodPhrase("w lipcu")).toBe("");
    expect(stripPeriodPhrase("dzisiaj")).toBe("");
    expect(stripPeriodPhrase("  w tym tygodniu  ")).toBe("");
  });

  it("leaves a question with no recognized phrase exactly as it came", () => {
    expect(stripPeriodPhrase("Czy dostawał Nurofenu?")).toBe("Czy dostawał Nurofenu?");
    expect(stripPeriodPhrase("")).toBe("");
  });

  it("removes only the phrase the date filter consumed, not a second copy of it", () => {
    expect(stripPeriodPhrase("w lipcu czy w lipcu?")).toBe("czy w lipcu?");
  });

  it("strips a month name reached by bare substring, because the parser recognizes it that way too", () => {
    // `w lipcu` occurs inside "Nurofenów lipcu" across the word boundary, and the module matches
    // period phrases by plain substring on purpose (a trailing `` after `ł`/`ó` never matches in
    // JS). So the parser answers this with July's window, and the strip has to agree -- an ugly
    // result is the correct one here, and a `` guard that "fixed" it would break the phrases
    // this module exists to recognize.
    expect(parsePolishDateRange("Nurofenów lipcu", now)).toEqual({
      start: "2026-07-01T00:00",
      end: "2026-08-01T00:00",
    });
    expect(stripPeriodPhrase("Nurofenów lipcu")).toBe("Nurofenó");
  });

  it("leaves a month name with no preposition alone, exactly as the parser ignores it", () => {
    expect(parsePolishDateRange("lipcu bez przyimka", now)).toBeNull();
    expect(stripPeriodPhrase("lipcu bez przyimka")).toBe("lipcu bez przyimka");
  });

  // The central assertion: the strip changes the question if and only if the parser found a
  // window in it. Anything else means the date filter consumed words the search arms still see,
  // or the search arms lost words no date filter ever used.
  const WITH_PHRASE = [
    "Co się działo dzisiaj?",
    "Co jadła wczoraj",
    "Czy był chory w zeszłym tygodniu?",
    "Czy był chory w ostatnim tygodniu?",
    "Czy był chory w tym tygodniu?",
    "Co było w zeszłym miesiącu?",
    "Co było w tym miesiącu?",
    "Co było w zeszłym roku?",
    "Co było w tym roku?",
    "Czy chorował w styczniu?",
    "Czy chorował w lutym?",
    "Czy chorował w marcu?",
    "Czy chorował w kwietniu?",
    "Czy chorował w maju?",
    "Czy chorował w czerwcu?",
    "Czy chorował w lipcu?",
    "Czy chorował w sierpniu?",
    "Czy chorował w wrześniu?",
    "Czy chorował w październiku?",
    "Czy chorował w listopadzie?",
    "Czy chorował w grudniu?",
  ];

  const WITHOUT_PHRASE = [
    "Czy dostawał Nurofenu?",
    "Nurofen",
    "Co z uchem?",
    "Ile waży?",
    "lipcu bez przyimka",
    // The parser knows "w wrześniu" and not the form a Pole actually writes, "we wrześniu": its
    // month table is keyed on `w ` + locative, and `we` is a different string. Pinned here as
    // current behaviour rather than fixed, because widening the recognized set is a change to what
    // the date filter consumes, not to the strip -- and the two have to keep agreeing.
    "Czy chorował we wrześniu?",
    "",
  ];

  it.each(WITH_PHRASE)("strips %s, which the parser recognizes", (question) => {
    expect(parsePolishDateRange(question, now)).not.toBeNull();
    expect(stripPeriodPhrase(question)).not.toBe(question);
  });

  it.each(WITHOUT_PHRASE)("leaves %s untouched, which the parser does not recognize", (question) => {
    expect(parsePolishDateRange(question, now)).toBeNull();
    expect(stripPeriodPhrase(question)).toBe(question);
  });
});
