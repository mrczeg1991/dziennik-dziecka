// The date branch's filter is not one predicate but two, ANDed: the window
// (`occurred_at >= p_date_start and occurred_at < p_date_end`) and a relevance gate (full-text OR
// an above-floor vector), at
// `supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:147-157`.
// Its siblings each pin one of those and hold the other constant: `notes-search.test.ts`'s
// date-boundary assertion gives every one of its five notes the one-hot embedding, so the gate is
// satisfied by construction and only the window decides, and its floor assertion passes no date
// range at all, so the gate is read on the RRF branch where a different CTE applies it. Neither
// shows that the date branch's own copy of the gate still runs. Drop that `and ( ... )` block and
// every suite in this directory stays green while a question naming a period starts returning
// every note in that period regardless of relevance.
//
// So this suite is the floor technique pointed at a window: one query, one window, four notes on a
// child of their own, each failing or clearing the two conjuncts in a different combination.
//
//   inWindowAboveFloorNote       in window, clears the gate on the vector arm (0.454)  -> returned
//   inWindowFullTextOnlyNote     in window, clears the gate on the full-text arm       -> returned
//   inWindowBelowFloorNote       in window, clears neither arm (0.414, no word shared) -> omitted
//   outsideWindowAboveFloorNote  clears the gate (0.454), but outside the window       -> omitted
//
// Each omission has exactly one cause, which is the point: remove the gate and the below-floor note
// appears, remove the window and the outside note appears, and move the floor outside the measured
// 0.430 -> 0.438 gap and one of the two floor notes flips. A failure here names the regression
// rather than printing a set diff.
//
// This file uses both entry points, each where it is the right one for its subject. The
// gate-inside-the-window assertion calls `.rpc()` directly, as `notes-search.test.ts` does: its
// subject is one `and ( ... )` block inside `search_notes`, and reaching it through `searchNotes`
// would mean smuggling four synthetic vectors and an explicit window past a date parser and an
// embedding call that have nothing to do with that predicate. The end-to-end assertion below calls
// `searchNotes` from `@/lib/search`, as `notes-search-window.test.ts` does: its subject is the
// whole path a parent's question takes -- the period phrase turned into a window and removed from
// the text the search arms see -- and that path exists only above the RPC. The import resolves for
// the same reason it does there: `vitest.config.ts` aliases `astro:env/server` to a stub. §6.7 of
// `context/foundation/test-plan.md` records why that alias had to exist at all.
//
// No real OpenAI call on either path. The `.rpc()` assertion passes synthetic vectors built by
// `tests/support/graded-vector.ts`, whose own math is pinned in `tests/unit/`, and the end-to-end
// notes carry no `embedding` at all, so nothing there depends on whether a key is exported.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SupabaseServerClient } from "@/lib/children";
import type { Note } from "@/lib/notes";
import { searchNotes } from "@/lib/search";

import { GRADED_QUERY_VECTOR } from "../support/graded-vector";
import { SEARCH_FIXTURE, SEARCH_IDS, seedFixture, signInAsFixtureUser, teardownFixture } from "./fixtures";

// The window the four notes above were seeded around. March 2026 carries no other note in
// `SEARCH_FIXTURE`, so nothing but `completenessChild`'s own notes can fall inside it.
const WINDOW_START = "2026-03-01T00:00:00";
const WINDOW_END = "2026-04-01T00:00:00";

// Drawn literally from `inWindowFullTextOnlyNote`'s content, and from no other note's. A sentinel
// rather than a real word for the same reason `notes-search.test.ts`'s degraded-mode query is one:
// it makes the full-text arm the only thing that can match that note, and makes "shares no word
// with the query" a property anyone can check by reading the three other contents.
const QUERY_TEXT = "KOMPLXYZB";

// The end-to-end question, carrying a period phrase and a search word at once -- and that pairing
// is load-bearing twice over. `dzisiaj` becomes the window; `gorączka` is what is left for the
// text query. `websearch_to_tsquery('simple', ...)` ANDs the tokens it is handed, so if
// `stripPeriodPhrase` ever stopped removing the phrase the query would become
// `'goraczka' & 'dzisiaj'`, no seeded note carries the second token, and this assertion goes red:
// it is a stripping regression guard as much as a window one. Accented as a parent would type it,
// against unaccented fixture content -- `notes.fts` is built over `immutable_unaccent` and the
// query side applies it too.
const E2E_QUESTION = "gorączka dzisiaj";

let authenticated: SupabaseServerClient;

beforeAll(async () => {
  // Teardown first, as in every suite here: a dirty local database or a previously failed run must
  // not be able to decide this suite's outcome.
  await teardownFixture(SEARCH_FIXTURE);
  await seedFixture(SEARCH_FIXTURE);
  authenticated = await signInAsFixtureUser(SEARCH_FIXTURE);
});

afterAll(async () => {
  await teardownFixture(SEARCH_FIXTURE);
});

// Set comparison, never counts -- the oracle-problem anti-pattern the rest of this directory
// avoids: a count passes while the wrong row is returned. The date branch orders by `occurred_at`
// ascending, but ordering is not this suite's subject, so both sides are sorted.
function idsOf(notes: { id: string }[]): string[] {
  return notes.map((note) => note.id).sort();
}

// Mirrors `notes-search.test.ts`'s helper, and through it `searchNotes`'s own call shape
// (src/lib/search.ts:33-39): `.overrideTypes()` cannot resolve `.rpc()`'s return shape without a
// generated Database schema, so an explicit assertion stands in for it. `p_match_count`,
// `p_rrf_k` and `p_similarity_threshold` are left at their defaults on purpose -- the floor this
// suite reads is the one production runs with.
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

describe("search_notes relevance gate inside a date window", () => {
  it("returns the in-window notes that clear either gate arm, and only those", async () => {
    const results = await callSearchNotes({
      childId: SEARCH_IDS.completenessChild,
      queryText: QUERY_TEXT,
      queryEmbedding: GRADED_QUERY_VECTOR,
      dateStart: WINDOW_START,
      dateEnd: WINDOW_END,
    });

    const expectedIds = [SEARCH_IDS.inWindowAboveFloorNote, SEARCH_IDS.inWindowFullTextOnlyNote].sort();
    expect(idsOf(results)).toStrictEqual(expectedIds);

    // Each reason restated on its own, so a failure names which conjunct stopped holding instead of
    // printing a set diff over four ids. The two inclusions fail in opposite directions from the
    // two omissions, and all four fail independently.
    const returnedIds = results.map((note) => note.id);
    // In the window and 0.454 against the query -- the vector arm of the gate carries it.
    expect(returnedIds).toContain(SEARCH_IDS.inWindowAboveFloorNote);
    // In the window with no embedding at all -- only the full-text arm can carry it, and the
    // query text is a sentinel drawn from its content.
    expect(returnedIds).toContain(SEARCH_IDS.inWindowFullTextOnlyNote);
    // In the same window, on the same child, carrying a vector: 0.414 is the only thing keeping it
    // out, because its content shares no word with the query text.
    expect(returnedIds).not.toContain(SEARCH_IDS.inWindowBelowFloorNote);
    // Clears the gate at 0.454 exactly as the first note does; April is the only difference.
    expect(returnedIds).not.toContain(SEARCH_IDS.outsideWindowAboveFloorNote);
  });
});

describe("searchNotes on a question carrying both a period phrase and a search word", () => {
  it("reaches the database with the window applied and the phrase stripped", async () => {
    const result = await searchNotes(authenticated, SEARCH_IDS.completenessE2eChild, E2E_QUESTION);

    // Ids derived from the fixture, never from a second run of the query, and never a count. The
    // unrelated note sits in the same window on the same child and carries no embedding either, so
    // the one thing keeping it out is the word that survived the strip.
    expect(result.results.map((note) => note.id)).toStrictEqual([SEARCH_IDS.e2eTodayMatchingNote]);
    // The window was parsed rather than the question falling through to ranked search -- the
    // difference between this assertion exercising the date branch and it exercising the RRF one.
    expect(result.dateRange).not.toBeNull();

    // `degraded` is deliberately not asserted: it is `true` with no OPENAI_API_KEY exported and
    // `false` with one, while the ids above are identical either way. Asserting it would put back
    // exactly the environment dependence the no-embedding fixture removes, and degraded mode has
    // its own coverage at notes-search.test.ts:133-171.
  });
});
