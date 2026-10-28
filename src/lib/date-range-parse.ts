import { warsawWallClock } from "@/lib/wall-clock";

/** A bare wall-clock boundary at midnight -- the shape every start/end below is built from. */
function dayBound(dateKey: string): string {
  return `${dateKey}T00:00`;
}

/**
 * Adds `deltaDays` calendar days to a `YYYY-MM-DD` key. Routed through `Date.UTC` pinned at
 * noon so the result is pure calendar-field rollover (year/month/day carry correctly across a
 * month or year boundary) rather than a real elapsed duration -- noon keeps the instant away
 * from any DST edge, so this is safe across either of Poland's 2026 transitions without
 * drifting an hour. The only place real-world time zone matters is the caller supplying
 * `dateKey` from `warsawWallClock()` in the first place.
 */
function addDays(dateKey: string, deltaDays: number): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays, 12));
  const y = String(shifted.getUTCFullYear()).padStart(4, "0");
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO weekday (Monday = 1 .. Sunday = 7) of a `YYYY-MM-DD` key, read off the same noon-pinned instant as `addDays`. */
function isoWeekday(dateKey: string): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * The first day of `deltaMonths` months from `(year, month)`, carrying the year on overflow in
 * either direction. Plain integer arithmetic, deliberately not routed through `Date` at all: a
 * month boundary has no DST edge to drift across, only calendar-field rollover.
 */
function shiftMonth(year: number, month: number, deltaMonths: number): { year: number; month: number } {
  const total = month - 1 + deltaMonths;
  const y = year + Math.floor(total / 12);
  const m = (((total % 12) + 12) % 12) + 1;
  return { year: y, month: m };
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** `YYYY-MM-DD` to `dd.mm.rrrr` by slicing, matching `formatWallClock`'s date half. */
function dayLabel(dateKey: string): string {
  return `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}.${dateKey.slice(0, 4)}`;
}

/**
 * The window as a parent reads it: `dd.mm.rrrr – dd.mm.rrrr`, both ends inclusive.
 *
 * `end` is exclusive everywhere else in this module -- it is the next period's first midnight --
 * so the displayed upper bound is the day before it. Showing the raw value would name a day whose
 * notes are deliberately absent from the result.
 */
export function formatDateRange(range: { start: string; end: string }): string {
  return `${dayLabel(range.start.slice(0, 10))} – ${dayLabel(addDays(range.end.slice(0, 10), -1))}`;
}

/** The 12 Polish month names in their locative form ("w lipcu"), mapped to a 1-indexed month number. */
const MONTH_LOCATIVES: Record<string, number> = {
  styczniu: 1,
  lutym: 2,
  marcu: 3,
  kwietniu: 4,
  maju: 5,
  czerwcu: 6,
  lipcu: 7,
  sierpniu: 8,
  wrześniu: 9,
  październiku: 10,
  listopadzie: 11,
  grudniu: 12,
};

/**
 * Every period phrase this module recognizes, in the order `parsePolishDateRange` resolves them --
 * first match wins, so a question carrying two of them is answered by whichever stands earlier
 * here. One list, read by both the parser and `stripPeriodPhrase`, is what keeps those two from
 * ever disagreeing about which words the date filter already consumed: a phrase added to the
 * parser alone would be stripped by nothing, and one added here alone would be stripped with no
 * window to show for it.
 */
const MONTH_PHRASES: ReadonlyMap<string, number> = new Map(
  Object.entries(MONTH_LOCATIVES).map(([locative, monthNum]) => [`w ${locative}`, monthNum]),
);

const PERIOD_PHRASES: readonly string[] = [
  "dzisiaj",
  "wczoraj",
  "w zeszłym tygodniu",
  "w ostatnim tygodniu",
  "w tym tygodniu",
  "w zeszłym miesiącu",
  "w tym miesiącu",
  "w zeszłym roku",
  "w tym roku",
  ...MONTH_PHRASES.keys(),
];

/**
 * The first phrase from `PERIOD_PHRASES` occurring in `question`, or `null` for a question naming
 * no recognized period. Checked by plain substring, never a `\b` word-boundary regex: Polish
 * letters like `ł`/`ń`/`ą`/`ś`/`ę`/`ć`/`ź`/`ż` are not `\w` in JS's ASCII-only definition, so a
 * trailing `\b` after one of them silently fails to match. A month name therefore has to carry
 * its preposition (`w lipcu`) to be recognized, and a bare `lipcu` is not a period phrase.
 */
function findPeriodPhrase(question: string): string | null {
  const lower = question.toLowerCase();
  return PERIOD_PHRASES.find((phrase) => lower.includes(phrase)) ?? null;
}

/**
 * Converts a recognized Polish period phrase into a `{ start, end }` pair of bare wall-clock
 * strings (exclusive upper bound) in the same string space `occurred_at` stores. Returns `null`
 * for an unrecognized phrase (or none), letting the caller fall through to the ranked,
 * non-date-bound search mode. Which phrases count, and in what order, is `findPeriodPhrase`'s.
 *
 * "Today" is anchored exactly once, via `warsawWallClock(now)` -- the only place real-world
 * time zone matters. Every other computation is pure calendar-field arithmetic on that date
 * key, so it cannot silently drift by an hour across a DST transition the way a UTC `Date`
 * comparison against a stored wall clock would.
 */
export function parsePolishDateRange(question: string, now: Date = new Date()): { start: string; end: string } | null {
  const phrase = findPeriodPhrase(question);
  if (phrase === null) {
    return null;
  }

  const today = warsawWallClock(now).slice(0, 10);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  switch (phrase) {
    case "dzisiaj":
      return { start: dayBound(today), end: dayBound(addDays(today, 1)) };
    case "wczoraj":
      return { start: dayBound(addDays(today, -1)), end: dayBound(today) };
    case "w zeszłym tygodniu":
    case "w ostatnim tygodniu": {
      const thisWeekStart = addDays(today, -(isoWeekday(today) - 1));
      return { start: dayBound(addDays(thisWeekStart, -7)), end: dayBound(thisWeekStart) };
    }
    case "w tym tygodniu": {
      const thisWeekStart = addDays(today, -(isoWeekday(today) - 1));
      return { start: dayBound(thisWeekStart), end: dayBound(addDays(thisWeekStart, 7)) };
    }
    case "w zeszłym miesiącu": {
      const last = shiftMonth(year, month, -1);
      return { start: dayBound(monthKey(last.year, last.month)), end: dayBound(monthKey(year, month)) };
    }
    case "w tym miesiącu": {
      const next = shiftMonth(year, month, 1);
      return { start: dayBound(monthKey(year, month)), end: dayBound(monthKey(next.year, next.month)) };
    }
    case "w zeszłym roku":
      return { start: dayBound(`${year - 1}-01-01`), end: dayBound(`${year}-01-01`) };
    case "w tym roku":
      return { start: dayBound(`${year}-01-01`), end: dayBound(`${year + 1}-01-01`) };
    default:
      break;
  }

  const monthNum = MONTH_PHRASES.get(phrase);
  if (monthNum === undefined) {
    // Unreachable while this switch covers every non-month entry of PERIOD_PHRASES. Returning
    // null rather than asserting keeps a future drift between the two a missed date window --
    // the caller falls through to ranked search -- instead of a thrown error on a parent's
    // question. The strip/parse parity tests are what catch the drift itself.
    return null;
  }

  // A bare month name carries no year, so it means the most recent occurrence of that month:
  // one later in the calendar than today's can only be last year's. Pinning it to the current
  // year instead would answer "w lipcu" asked in March with a window months in the future,
  // which matches no note and gives the parent no hint that a year was assumed at all.
  const resolvedYear = monthNum > month ? year - 1 : year;
  const next = shiftMonth(resolvedYear, monthNum, 1);
  return {
    start: dayBound(monthKey(resolvedYear, monthNum)),
    end: dayBound(monthKey(next.year, next.month)),
  };
}

/**
 * The question with the period phrase the date filter already consumed taken out, so those words
 * stop reaching the text query and the embedding as if a parent had typed them as search terms.
 * `parsePolishDateRange` keeps seeing the raw question; only the search arms see this.
 *
 * Returns the question unchanged when no phrase is recognized, and `""` when the question was
 * nothing but a period phrase. That empty string is a real answer, not a failure: it means the
 * window alone decides the result, and a caller that treats it as an empty question would answer
 * `w lipcu` with nothing. Only the one phrase `findPeriodPhrase` matched is removed, matching
 * exactly what the date filter consumed -- a question repeating it keeps the second copy.
 */
export function stripPeriodPhrase(question: string): string {
  const phrase = findPeriodPhrase(question);
  if (phrase === null) {
    return question;
  }

  // Removed from the original by a case-insensitive regex rather than by an index into the
  // lowercased copy: a case fold can change a string's length (`İ` folds to two code points),
  // which would shift every index after it and cut the wrong characters. Every entry of
  // PERIOD_PHRASES is letters and a space, so none of it is regex syntax needing an escape.
  return question
    .replace(new RegExp(phrase, "i"), " ")
    .replace(/\s+/g, " ")
    .replace(/ ([?!.,;:])/g, "$1")
    .trim();
}
