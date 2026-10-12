// The wall clock in Poland, as plain ESM. This is a second implementation of
// src/lib/wall-clock.ts's `warsawWallClock` on purpose: scripts/smoke.mjs runs under bare `node`
// against a deployed URL, with no bundler and no TypeScript step, so it cannot import the source
// module. Keeping the copy here rather than inline in the smoke walk means a test can import both
// and assert they return the same string -- tests/unit/wall-clock.test.ts does exactly that, which
// is what makes the remaining duplication safe.
//
// Zero npm dependencies and no build step, same as every other file under scripts/.

/**
 * `YYYY-MM-DDTHH:mm` in Poland for a given instant -- the shape `occurred_at` stores. Behaviour
 * must stay identical to `warsawWallClock` in src/lib/wall-clock.ts; the parity test in
 * tests/unit/wall-clock.test.ts is what enforces that.
 *
 * @param {Date} [at] The instant to read the wall clock at. Defaults to now.
 * @returns {string} The local date and time as `YYYY-MM-DDTHH:mm`, carrying no offset.
 */
export function warsawWallClock(at = new Date()) {
  // "2026-09-27 21:05" -> "2026-09-27T21:05". `sv-SE` yields ISO-ordered parts directly.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" })
    .format(at)
    .replace(" ", "T");
}
