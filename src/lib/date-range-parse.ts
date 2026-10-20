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
 * Recognizes a bounded set of common Polish period phrases and converts one into a
 * `{ start, end }` pair of bare wall-clock strings (exclusive upper bound) in the same string
 * space `occurred_at` stores. Checked by plain substring, never a `\b` word-boundary regex:
 * Polish letters like `ł`/`ń`/`ą`/`ś`/`ę`/`ć`/`ź`/`ż` are not `\w` in JS's ASCII-only definition,
 * so a trailing `\b` after one of them silently fails to match. Returns `null` for an
 * unrecognized phrase (or none), letting the caller fall through to the ranked,
 * non-date-bound search mode.
 *
 * "Today" is anchored exactly once, via `warsawWallClock(now)` -- the only place real-world
 * time zone matters. Every other computation is pure calendar-field arithmetic on that date
 * key, so it cannot silently drift by an hour across a DST transition the way a UTC `Date`
 * comparison against a stored wall clock would.
 */
export function parsePolishDateRange(question: string, now: Date = new Date()): { start: string; end: string } | null {
  const lower = question.toLowerCase();
  const today = warsawWallClock(now).slice(0, 10);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  if (lower.includes("dzisiaj")) {
    return { start: dayBound(today), end: dayBound(addDays(today, 1)) };
  }
  if (lower.includes("wczoraj")) {
    return { start: dayBound(addDays(today, -1)), end: dayBound(today) };
  }

  if (lower.includes("w zeszłym tygodniu") || lower.includes("w ostatnim tygodniu")) {
    const thisWeekStart = addDays(today, -(isoWeekday(today) - 1));
    return { start: dayBound(addDays(thisWeekStart, -7)), end: dayBound(thisWeekStart) };
  }
  if (lower.includes("w tym tygodniu")) {
    const thisWeekStart = addDays(today, -(isoWeekday(today) - 1));
    return { start: dayBound(thisWeekStart), end: dayBound(addDays(thisWeekStart, 7)) };
  }

  if (lower.includes("w zeszłym miesiącu")) {
    const last = shiftMonth(year, month, -1);
    return { start: dayBound(monthKey(last.year, last.month)), end: dayBound(monthKey(year, month)) };
  }
  if (lower.includes("w tym miesiącu")) {
    const next = shiftMonth(year, month, 1);
    return { start: dayBound(monthKey(year, month)), end: dayBound(monthKey(next.year, next.month)) };
  }

  if (lower.includes("w zeszłym roku")) {
    return { start: dayBound(`${year - 1}-01-01`), end: dayBound(`${year}-01-01`) };
  }
  if (lower.includes("w tym roku")) {
    return { start: dayBound(`${year}-01-01`), end: dayBound(`${year + 1}-01-01`) };
  }

  for (const [locative, monthNum] of Object.entries(MONTH_LOCATIVES)) {
    if (lower.includes(`w ${locative}`)) {
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
  }

  return null;
}
