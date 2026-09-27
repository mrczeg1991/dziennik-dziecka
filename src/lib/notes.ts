import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseServerClient } from "@/lib/children";

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
 * Inserts one note owned by `userId` on one of that user's children. The policy's
 * `with check` rejects a `childId` belonging to another account. Returns the query
 * error, if any.
 */
export async function createNote(
  supabase: SupabaseServerClient,
  userId: string,
  { childId, content, occurredAt }: NewNote,
): Promise<PostgrestError | null> {
  const { error } = await supabase
    .from("notes")
    .insert({ user_id: userId, child_id: childId, content, occurred_at: occurredAt });
  return error;
}

/**
 * Rewrites one note's text. Matches only rows where `deleted_at` is null, so a
 * soft-deleted note cannot be edited back into view. Scoping is RLS's job, hence no
 * `userId`. `found` reports whether a row matched, so a foreign, missing or already
 * deleted id is distinguishable from a database failure.
 */
export async function updateNoteContent(
  supabase: SupabaseServerClient,
  noteId: string,
  content: string,
): Promise<{ error: PostgrestError | null; found: boolean }> {
  const { data, error } = await supabase
    .from("notes")
    .update({ content, updated_at: new Date().toISOString() })
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
