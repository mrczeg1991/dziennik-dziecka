// The one path `notes-search.test.ts` cannot cover, and the reason it cannot: a question that is
// nothing but a recognized period phrase never reaches `search_notes` at all. The date branch needs
// one of its two arms to match -- a blank text query matches no row and a null embedding switches
// the vector arm off -- so `src/lib/search.ts` answers that question from the date window alone,
// through `listNotesInRange`. Asserting that means calling `searchNotes` itself rather than the RPC,
// which is why this file imports `@/lib/search` where its sibling deliberately does not.
//
// That import works for the same reason `notes-read-boundaries.test.ts` can import `@/lib/notes`:
// `vitest.config.ts` aliases `astro:env/server` to a stub. No OpenAI call happens here -- the path
// under test never embeds anything, and the fixture notes carry no `embedding` so a regression that
// started embedding an empty question would surface rather than hide.
//
// `dzisiaj`, not a literal month: the fixture's window notes are seeded at today's Warsaw date
// (see `TODAY_WALL_CLOCK_DATE` in fixtures.ts), so these assertions keep exercising a non-empty
// window no matter when the suite runs.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SupabaseServerClient } from "@/lib/children";
import { searchNotes } from "@/lib/search";

import { SEARCH_FIXTURE, SEARCH_IDS, seedFixture, signInAsFixtureUser, teardownFixture } from "./fixtures";

let authenticated: SupabaseServerClient;

beforeAll(async () => {
  await teardownFixture(SEARCH_FIXTURE);
  await seedFixture(SEARCH_FIXTURE);
  authenticated = await signInAsFixtureUser(SEARCH_FIXTURE);
});

afterAll(async () => {
  await teardownFixture(SEARCH_FIXTURE);
});

describe("searchNotes on a question that is only a period phrase", () => {
  it("answers from the date window, oldest first, without degrading", async () => {
    const result = await searchNotes(authenticated, SEARCH_IDS.windowChild, "dzisiaj");

    // Ids and their order, not a count: a count passes while the wrong row comes back, and the
    // ascending order is this path's contract -- it mirrors how `search_notes`'s own date branch
    // orders, so the two cannot disagree about what a window looks like.
    expect(result.results.map((note) => note.id)).toStrictEqual([SEARCH_IDS.todayEarlyNote, SEARCH_IDS.todayLateNote]);
    expect(result.dateRange).not.toBeNull();
    // No embedding was needed, so none failed. `degraded` must not be repurposed to mean
    // "nothing was asked".
    expect(result.degraded).toBe(false);
  });

  it("excludes a note outside the window", async () => {
    const result = await searchNotes(authenticated, SEARCH_IDS.windowChild, "dzisiaj");

    expect(result.results.map((note) => note.id)).not.toContain(SEARCH_IDS.outsideTodayNote);
  });

  it("answers the punctuated form identically", async () => {
    // The regression this pins: emptiness for the search arms means "no letters or digits left",
    // not `=== ""`. `stripPeriodPhrase` tidies whitespace but does not invent an empty string out
    // of punctuation, so `dzisiaj?` leaves `?`. Gating the window-only path on `=== ""` sent the
    // punctuated question to the RPC, where an empty tsquery and the embedding of `?` (0.163
    // against the notes it should have returned) produced exactly the empty result this change
    // exists to remove -- while the bare form returned the window. A parent types the question
    // mark, so that was the common form failing.
    const bare = await searchNotes(authenticated, SEARCH_IDS.windowChild, "dzisiaj");
    const punctuated = await searchNotes(authenticated, SEARCH_IDS.windowChild, "dzisiaj?");

    expect(punctuated.results.map((note) => note.id)).toStrictEqual(bare.results.map((note) => note.id));
    expect(punctuated.results).not.toHaveLength(0);
    expect(punctuated.degraded).toBe(false);
  });
});
