/**
 * Wall-clock times, deliberately without a time zone. A `datetime-local` input submits
 * `YYYY-MM-DDTHH:mm` with no offset; notes store that string verbatim, so every read of
 * one is string slicing and never a `Date` construction.
 */

/** Matches `YYYY-MM-DDTHH:mm` — the shape a `datetime-local` field submits. */
export const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The wall clock in Poland for a given instant, as `YYYY-MM-DDTHH:mm`, comparable
 * lexicographically against a submitted value. The instant is a parameter so a caller
 * can offset it — e.g. to allow a few minutes of tolerance on a "not in the future"
 * check, since a Worker's `Date.now()` reports the time of the last I/O.
 */
export function warsawWallClock(at: Date = new Date()): string {
  // "2026-09-27 21:05" -> "2026-09-27T21:05". `sv-SE` yields ISO-ordered parts directly.
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    dateStyle: "short",
    timeStyle: "short",
  }).format(at);
  return parts.replace(" ", "T");
}

/**
 * Slack allowed on a "not in the future" check. Not cosmetic: a Worker's `Date.now()` reports the
 * time of the last I/O and does not advance during execution, and a device clock can run a minute
 * or two fast. Without slack a note saved at the current minute would be rejected as being in the
 * future.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Whether a submitted wall clock is in the future, beyond the tolerance above. The comparison is
 * lexicographic between two `YYYY-MM-DDTHH:mm` strings — the submitted one, and the Poland wall
 * clock at `now` plus the tolerance. `now` is a parameter so the boundary can be tested against a
 * fixed instant rather than the real clock.
 */
export function isFutureWallClock(submitted: string, now: Date = new Date()): boolean {
  return submitted > warsawWallClock(new Date(now.getTime() + FUTURE_TOLERANCE_MS));
}

/**
 * `"YYYY-MM-DDTHH:mm[:ss]"` to `"dd.mm.rrrr, HH:mm"` by slicing. Never constructs a
 * `Date`, so no time zone is ever applied to a stored wall clock.
 */
export function formatWallClock(value: string): string {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}, ${time}`;
}
