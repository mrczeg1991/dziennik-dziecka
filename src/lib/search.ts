import type { SupabaseServerClient } from "@/lib/children";
import { parsePolishDateRange } from "@/lib/date-range-parse";
import { embedText } from "@/lib/embeddings";
import type { Note } from "@/lib/notes";

export interface SearchResult {
  results: Note[];
  degraded: boolean;
  dateRange: { start: string; end: string } | null;
}

/**
 * Answers one free-text question about a child's notes. Parses a recognized Polish period
 * phrase into a hard date window (or `null`, falling through to ranked search), embeds the
 * question, and lets `search_notes` do the ranking in one round trip. `p_child_id` is passed as
 * a function parameter rather than chained with `.eq()` after `.rpc()`, because the latter would
 * only filter the function's output after its own ranking/limit already ran.
 *
 * `degraded` is `true` whenever `embedText` could not produce a vector (missing configuration or
 * a failed call) — the RPC still runs with a null embedding, and `search_notes`'s own ranking
 * naturally falls back to text-only scoring, but the caller renders the degradation explicitly
 * rather than silently returning a worse-ranked result. Throws on a genuine query failure rather
 * than returning an empty list, matching `listNotes`'s contract.
 */
export async function searchNotes(
  supabase: SupabaseServerClient,
  childId: string,
  question: string,
): Promise<SearchResult> {
  const dateRange = parsePolishDateRange(question);
  const embedding = await embedText(question);

  const response = await supabase.rpc("search_notes", {
    p_child_id: childId,
    p_query_text: question,
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
  return { results, degraded: embedding === null, dateRange };
}
