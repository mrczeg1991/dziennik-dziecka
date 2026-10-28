import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseServerClient } from "@/lib/children";
import { embedText } from "@/lib/embeddings";

export interface Note {
  id: string;
  content: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export interface NewNote {
  childId: string;
  content: string;
  occurredAt: string;
}

/**
 * Lists one child's live notes, newest occurrence first, tiebroken by the more
 * recently written row. The `child_id` filter is not optional and RLS does not
 * supply it: policies scope rows to the account, not to one child. Throws on a
 * query failure rather than returning an empty list.
 */
export async function listNotes(supabase: SupabaseServerClient, childId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, content, occurred_at, created_at, updated_at")
    .eq("child_id", childId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .overrideTypes<Note[], { merge: false }>();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Lists one child's live notes whose `occurred_at` falls in `[start, end)` -- the same half-open
 * window `parsePolishDateRange` produces, and the same bound arithmetic `search_notes`'s date
 * branch applies, so the two cannot disagree about which day belongs to a month.
 *
 * Oldest occurrence first, matching that branch's own ordering rather than `listNotes`'s
 * newest-first: a parent reading a period's notes is reading a sequence of events, and the date
 * branch already established that direction for every date-bound search. Exists for the one
 * question that leaves no search terms behind at all -- a question that was nothing but a period
 * phrase -- where a ranked search has nothing to rank and the window is the whole answer.
 */
export async function listNotesInRange(
  supabase: SupabaseServerClient,
  childId: string,
  range: { start: string; end: string },
): Promise<Note[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, content, occurred_at, created_at, updated_at")
    .eq("child_id", childId)
    .is("deleted_at", null)
    .gte("occurred_at", range.start)
    .lt("occurred_at", range.end)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .overrideTypes<Note[], { merge: false }>();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Inserts one note owned by `userId` on one of that user's children. The policy's
 * `with check` rejects a `childId` belonging to another account. Returns the query
 * error, if any.
 *
 * Computes the embedding before the insert so it lands in the same row, no second
 * round trip. `embedText` degrades to `null` on any failure (missing config, a
 * non-OK response, a thrown error) rather than throwing, so a note's save never
 * depends on, or is blocked by, the external AI call succeeding.
 */
export async function createNote(
  supabase: SupabaseServerClient,
  userId: string,
  { childId, content, occurredAt }: NewNote,
): Promise<PostgrestError | null> {
  const embedding = await embedText(content);
  const { error } = await supabase
    .from("notes")
    .insert({ user_id: userId, child_id: childId, content, occurred_at: occurredAt, embedding });
  return error;
}

/**
 * Rewrites one note's text. Matches only rows where `deleted_at` is null, so a
 * soft-deleted note cannot be edited back into view. Scoping is RLS's job, hence no
 * `userId`. `found` reports whether a row matched, so a foreign, missing or already
 * deleted id is distinguishable from a database failure.
 *
 * Recomputes the embedding on every edit: a stale embedding describing the old text
 * would silently mis-rank future questions, so it is never left as-is alongside new
 * `content`.
 */
export async function updateNoteContent(
  supabase: SupabaseServerClient,
  noteId: string,
  content: string,
): Promise<{ error: PostgrestError | null; found: boolean }> {
  const embedding = await embedText(content);
  const { data, error } = await supabase
    .from("notes")
    .update({ content, embedding, updated_at: new Date().toISOString() })
    .eq("id", noteId)
    .is("deleted_at", null)
    .select("id");

  return { error, found: (data?.length ?? 0) > 0 };
}

/**
 * Soft-deletes one note by stamping `deleted_at`. Matches only rows where
 * `deleted_at` is currently null, so a repeated delete is idempotent rather than
 * re-stamping. Scoping is RLS's job, hence no `userId`.
 */
export async function softDeleteNote(
  supabase: SupabaseServerClient,
  noteId: string,
): Promise<{ error: PostgrestError | null; found: boolean }> {
  const { data, error } = await supabase
    .from("notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", noteId)
    .is("deleted_at", null)
    .select("id");

  return { error, found: (data?.length ?? 0) > 0 };
}
