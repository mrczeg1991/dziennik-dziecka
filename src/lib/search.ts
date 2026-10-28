import type { SupabaseServerClient } from "@/lib/children";
import { parsePolishDateRange, stripPeriodPhrase } from "@/lib/date-range-parse";
import { embedText } from "@/lib/embeddings";
import { listNotesInRange, type Note } from "@/lib/notes";

export interface SearchResult {
  results: Note[];
  degraded: boolean;
  dateRange: { start: string; end: string } | null;
}

/**
 * Whether anything a parent could be searching FOR survives in `text`. `stripPeriodPhrase` removes
 * the phrase and tidies whitespace, but it does not invent an empty string out of punctuation: a
 * question that was only a period phrase plus a question mark leaves `"?"`. Emptiness for the
 * search arms therefore has to mean "no letters and no digits left", never `=== ""`.
 *
 * Gating on the stricter test is what shipped the bug this replaced: `w lipcu?` skipped the
 * window-only branch below and went to the RPC, where `websearch_to_tsquery('simple', '?')` is an
 * empty tsquery and the embedding of `"?"` reaches 0.163 against the very notes it should have
 * returned -- under any floor. So the punctuated form of the question answered "Brak notatek
 * pasujących do pytania." while the bare form returned the month, and the parent paid for an
 * embedding call to find that out.
 */
function hasSearchableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Answers one free-text question about a child's notes. Parses a recognized Polish period
 * phrase into a hard date window (or `null`, falling through to ranked search), removes that
 * phrase from the text the search arms see, embeds what is left, and lets `search_notes` do the
 * ranking in one round trip. `p_child_id` is passed as a function parameter rather than chained
 * with `.eq()` after `.rpc()`, because the latter would only filter the function's output after
 * its own ranking/limit already ran.
 *
 * A question that is nothing but a period phrase takes a different path and never reaches
 * `search_notes` -- see the branch below for why the RPC cannot answer it.
 *
 * `degraded` is `true` whenever `embedText` could not produce a vector (missing configuration or
 * a failed call) — the RPC still runs with a null embedding, and `search_notes`'s own ranking
 * naturally falls back to text-only scoring, but the caller renders the degradation explicitly
 * rather than silently returning a worse-ranked result. It stays `false` when there was nothing
 * to embed, which is a different thing from a failed embedding. Throws on a genuine query failure
 * rather than returning an empty list, matching `listNotes`'s contract.
 */
export async function searchNotes(
  supabase: SupabaseServerClient,
  childId: string,
  question: string,
): Promise<SearchResult> {
  const dateRange = parsePolishDateRange(question);
  // The parser reads the raw question; the search arms read it with the period phrase removed.
  // Those words have already been spent on the date window, and leaving them in costs twice: the
  // text query asks for tokens no note contains ("lipcu" never appears in a note), and the
  // embedding is pulled toward the phrase instead of the subject the parent asked about.
  const queryText = stripPeriodPhrase(question);

  if (!hasSearchableText(queryText) && dateRange !== null) {
    // A question that was nothing but a period phrase leaves no search terms at all, and the date
    // branch of `search_notes` still requires one of its two arms to match: a blank text query
    // matches no row and a null embedding switches the vector arm off, so routing `w lipcu` through
    // the RPC would answer it with nothing. The window alone decides instead -- the completeness
    // the date branch already promises for date-bound searches, just with no predicate left to
    // narrow it. `degraded` stays false: an embedding was never needed, so none failed.
    return { results: await listNotesInRange(supabase, childId, dateRange), degraded: false, dateRange };
  }

  // Never called without searchable text: a question with no words left is the branch above, and a
  // question that was empty to begin with is answered by an empty result rather than by a billed
  // call for the zero vector.
  const embedding = hasSearchableText(queryText) ? await embedText(queryText) : null;

  const response = await supabase.rpc("search_notes", {
    p_child_id: childId,
    p_query_text: queryText,
    p_query_embedding: embedding,
    p_date_start: dateRange?.start ?? null,
    p_date_end: dateRange?.end ?? null,
  });

  if (response.error) {
    throw response.error;
  }

  // `.overrideTypes()` is not used here: without a generated Database schema, `.rpc()` cannot
  // resolve `search_notes`'s own return shape, and forcing it to `Note[]` through that method
  // hits postgrest-js's array-mismatch guard (it sees the unresolved call as a single-row
  // result instead). `response.data` is `any` on an unconfigured client -- the same looseness
  // `src/lib/notes.ts`'s hand-written row types already accept instead of `supabase gen types` --
  // so an explicit assertion stands in for `.overrideTypes()` here.
  const results = (response.data as Note[] | null) ?? [];
  return { results, degraded: hasSearchableText(queryText) && embedding === null, dateRange };
}
