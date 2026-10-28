// Risk #1 (isolation) is already covered at the SQL layer by
// `supabase/tests/04_notes_search.sql`. This suite covers the three things that file structurally
// cannot: date-boundary completeness and the degraded (null-embedding) fallback both need a real
// JavaScript runner to control embeddings and dates precisely, and the semantic arm needs a real
// vector to prove it ever runs at all. See `context/foundation/test-plan.md` §6.7 for why this
// suite calls `search_notes` directly through `.rpc()` instead of through `@/lib/search` -- in
// short, `src/lib/embeddings.ts` imports `astro:env/server`, which does not resolve under plain
// Vitest, and importing it here would crash the whole suite at import time.
//
// No real OpenAI call, ever, and no `vi.mock` (this codebase has none): every embedding here is a
// precomputed, synthetic vector seeded straight into the `embedding` column. `SEARCH_ONE_HOT_EMBEDDING`
// is reused as both the seeded value and the `p_query_embedding` argument, so cosine similarity of
// a vector with itself (1.0) trivially clears `search_notes`'s default 0.434 similarity threshold --
// proving the *date* boundary is what includes/excludes a row, not an accidental threshold miss.
//
// The no-date-range branch gained a `p_similarity_threshold` floor in
// 20261020200647_tune_search_notes_rrf_relevance.sql, so an unrelated note is no longer guaranteed
// to come back with every query. This suite used to refuse to assert absence on that branch,
// because the floor's then-default 0.5 was explicitly unvalidated against real Polish note text
// and an absence assertion would have pinned a number nobody had measured. That reason has expired:
// 20261027140907_recalibrate_search_notes_similarity_floor.sql carries 0.434, derived from the
// 26-note Polish corpus in `supabase/seed.sql` over 18 frozen questions, with the full
// question x note table, the bands, the sweep and the admitted-negative count recorded in
// `context/changes/note-search-similarity-floor/change.md` (`## Pomiar`). So the floor is now
// asserted from BOTH sides, in the last describe block below -- two notes on a child of their own
// at 0.434 +/- 0.02, one returned and one not, which is what makes a move of the constant in
// either direction turn this suite red instead of silently following it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SupabaseServerClient } from "@/lib/children";
import type { Note } from "@/lib/notes";

import { GRADED_QUERY_VECTOR } from "../support/graded-vector";
import {
  SEARCH_FIXTURE,
  SEARCH_IDS,
  SEARCH_ONE_HOT_EMBEDDING,
  seedFixture,
  signInAsFixtureUser,
  teardownFixture,
} from "./fixtures";

let authenticated: SupabaseServerClient;

beforeAll(async () => {
  // Teardown first: a dirty local database or a previously failed run must not be able to decide
  // this suite's outcome.
  await teardownFixture(SEARCH_FIXTURE);
  await seedFixture(SEARCH_FIXTURE);
  authenticated = await signInAsFixtureUser(SEARCH_FIXTURE);
});

afterAll(async () => {
  await teardownFixture(SEARCH_FIXTURE);
});

// Set comparison, never counts -- the oracle-problem anti-pattern `notes-read-boundaries.test.ts`
// already avoids: a count passes while the wrong row is returned.
function idsOf(notes: { id: string }[]): string[] {
  return notes.map((note) => note.id).sort();
}

// Mirrors `searchNotes`'s own call shape (src/lib/search.ts:33-39) and its typing approach:
// `.overrideTypes()` cannot resolve `.rpc()`'s return shape without a generated Database schema, so
// an explicit assertion stands in for it here too.
async function callSearchNotes(args: {
  childId: string;
  queryText: string;
  queryEmbedding: number[] | null;
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<Note[]> {
  const response = await authenticated.rpc("search_notes", {
    p_child_id: args.childId,
    p_query_text: args.queryText,
    p_query_embedding: args.queryEmbedding,
    p_date_start: args.dateStart ?? null,
    p_date_end: args.dateEnd ?? null,
  });

  if (response.error) {
    throw response.error;
  }
  return (response.data as Note[] | null) ?? [];
}

describe("search_notes semantic arm (no date range)", () => {
  it("returns a note via the vector arm when the query text shares no words with it", async () => {
    // `p_query_text` deliberately has no literal overlap with `nearNote.content`
    // ("notatka o spacerze w parku"), so a match here can only come from the vector arm, not an
    // accidental full-text hit -- and `p_query_embedding` is the exact same one-hot vector seeded
    // onto `nearNote`, so cosine similarity is 1.0.
    const results = await callSearchNotes({
      childId: SEARCH_IDS.child,
      queryText: "karmienie nocne",
      queryEmbedding: SEARCH_ONE_HOT_EMBEDDING,
    });

    expect(results.map((note) => note.id)).toContain(SEARCH_IDS.nearNote);
  });
});

describe("search_notes date-boundary completeness", () => {
  it("returns every note in the window and none outside it, on both edges", async () => {
    // beforeWindowNote (2026-06-30T23:59) is just before start -> excluded.
    // atWindowStartNote (2026-07-01T00:00) is exactly the inclusive start -> included.
    // nearNote (2026-07-04T12:00) is mid-window -> included.
    // atWindowEndNote (2026-07-08T00:00) is exactly the exclusive end -> excluded.
    // afterWindowNote (2026-07-08T00:01) is just after end -> excluded.
    // Every one of the five carries the same one-hot embedding, so only the date filter --
    // never an accidental threshold miss -- decides inclusion.
    const results = await callSearchNotes({
      childId: SEARCH_IDS.child,
      queryText: "nieistniejace slowo kluczowe",
      queryEmbedding: SEARCH_ONE_HOT_EMBEDDING,
      dateStart: "2026-07-01T00:00:00",
      dateEnd: "2026-07-08T00:00:00",
    });

    const expectedIds = [SEARCH_IDS.atWindowStartNote, SEARCH_IDS.nearNote].sort();
    expect(idsOf(results)).toStrictEqual(expectedIds);

    // Stated separately so a failure reads as what it is: these three exist, carry a matching
    // embedding, and belong to the same child -- only the window's own bounds keep them out.
    const returnedIds = results.map((note) => note.id);
    expect(returnedIds).not.toContain(SEARCH_IDS.beforeWindowNote);
    expect(returnedIds).not.toContain(SEARCH_IDS.atWindowEndNote);
    expect(returnedIds).not.toContain(SEARCH_IDS.afterWindowNote);
  });
});

describe("search_notes degraded mode (null embedding)", () => {
  it("still finds a note through the full-text arm alone", async () => {
    // Simulates what searchNotes() passes when embedText() returned null: p_query_embedding is
    // null, and a query term drawn literally from fullTextOnlyNote's own content.
    const results = await callSearchNotes({
      childId: SEARCH_IDS.child,
      queryText: "KASZELXYZ",
      queryEmbedding: null,
    });

    expect(idsOf(results)).toStrictEqual([SEARCH_IDS.fullTextOnlyNote]);
  });
});

describe("search_notes degraded mode inside a date window", () => {
  it("still finds an in-window note through the full-text arm when the embedding is null", async () => {
    // The two modes above are each covered in isolation; their intersection was not, and that is
    // where a regression hid: the date-bound branch gated its text arm on the same threshold the
    // vector arm uses, so with `p_query_embedding: null` it matched nothing at all and a question
    // naming a period returned zero rows while the UI announced "wyniki tylko tekstowe".
    //
    // "spacerze" appears only in nearNote (2026-07-04, mid-window). The vector arm cannot
    // contribute here, so a returned row can only have come from the full-text arm.
    const results = await callSearchNotes({
      childId: SEARCH_IDS.child,
      queryText: "spacerze",
      queryEmbedding: null,
      dateStart: "2026-07-01T00:00:00",
      dateEnd: "2026-07-08T00:00:00",
    });

    expect(idsOf(results)).toStrictEqual([SEARCH_IDS.nearNote]);

    // Stated separately: atWindowStartNote is inside the same window and carries an embedding, so
    // its absence proves the text arm still discriminates rather than the window becoming a
    // catch-all once the threshold was removed.
    expect(results.map((note) => note.id)).not.toContain(SEARCH_IDS.atWindowStartNote);
  });
});

describe("search_notes similarity floor on the RRF branch", () => {
  it("returns the note above the measured floor and not the one below it", async () => {
    // The two notes on `thresholdChild` carry vectors from `tests/support/graded-vector.ts` at
    // 0.434 + 0.02 and 0.434 - 0.02, and `GRADED_QUERY_VECTOR` is the vector those similarities are
    // expressed against -- so the cosine the function computes is the number the fixture asked for,
    // to within float4.
    //
    // Three things are deliberately absent from this call, and each one is what makes the floor the
    // only thing deciding:
    //   * no date range, so the RRF branch runs and its `semantic` CTE is where the gate sits;
    //   * `p_query_text` shares no word with either note's content, so the full-text arm matches
    //     neither and cannot carry the below-floor note in through the full outer join;
    //   * the two notes live on their own child, so the six notes of the date-window assertions
    //     above are out of scope and cannot contribute a row here either.
    const results = await callSearchNotes({
      childId: SEARCH_IDS.thresholdChild,
      queryText: "pytanie bez wspolnych slow",
      queryEmbedding: GRADED_QUERY_VECTOR,
    });

    expect(idsOf(results)).toStrictEqual([SEARCH_IDS.aboveFloorNote]);

    // Stated separately so a failure reads as what it is. These two assertions fail in opposite
    // directions: raise the default past 0.454 and the first goes red, lower it below 0.414 and the
    // second does. A default anywhere outside the measured 0.430 -> 0.438 gap trips one of them.
    const returnedIds = results.map((note) => note.id);
    expect(returnedIds).toContain(SEARCH_IDS.aboveFloorNote);
    expect(returnedIds).not.toContain(SEARCH_IDS.belowFloorNote);
  });
});
