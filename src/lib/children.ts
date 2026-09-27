import type { PostgrestError } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase";

export type SupabaseServerClient = NonNullable<ReturnType<typeof createClient>>;

export interface Child {
  id: string;
  name: string;
  birth_date: string | null;
  created_at: string;
}

export interface NewChild {
  name: string;
  birthDate: string | null;
}

/**
 * Lists the current user's children, oldest first. Ownership is enforced by RLS,
 * so no user filter is applied here. Throws on a query failure rather than
 * returning an empty list.
 */
export async function listChildren(supabase: SupabaseServerClient): Promise<Child[]> {
  const { data, error } = await supabase
    .from("children")
    .select("id, name, birth_date, created_at")
    .order("created_at", { ascending: true })
    .overrideTypes<Child[], { merge: false }>();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Resolves one child by id. Ownership is enforced by RLS, so a child belonging to
 * another account is indistinguishable from one that does not exist: both return
 * `null`. Throws on a query failure.
 */
export async function getChild(supabase: SupabaseServerClient, childId: string): Promise<Child | null> {
  const { data, error } = await supabase
    .from("children")
    .select("id, name, birth_date, created_at")
    .eq("id", childId)
    .maybeSingle()
    .overrideTypes<Child, { merge: false }>();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Inserts one child owned by `userId`. Returns the query error, if any.
 */
export async function createChild(
  supabase: SupabaseServerClient,
  userId: string,
  { name, birthDate }: NewChild,
): Promise<PostgrestError | null> {
  const { error } = await supabase.from("children").insert({ user_id: userId, name, birth_date: birthDate });
  return error;
}
