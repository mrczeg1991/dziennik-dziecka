import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { softDeleteNote, updateNoteContent } from "@/lib/notes";

const CONTENT_MAX_LENGTH = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Both mutations on one note behind a single POST, because an HTML form cannot issue PUT or
 * DELETE. `intent` picks the operation; `child_id` only names the page to return to. A note id
 * that matches nothing the caller owns is reported as nothing at all — the redirect goes to the
 * dashboard and says only that the note was not found.
 */
export const POST: APIRoute = async (context) => {
  const toDashboard = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return toDashboard("Supabase is not configured");
  }

  const noteId = context.params.id ?? "";
  if (!UUID_RE.test(noteId)) {
    return toDashboard("Nie znaleziono notatki");
  }

  const form = await context.request.formData();
  const rawChildId = form.get("child_id");
  const childId = typeof rawChildId === "string" ? rawChildId.trim() : "";
  if (!UUID_RE.test(childId)) {
    return toDashboard("Nieprawidłowe żądanie");
  }

  const fail = (message: string) => context.redirect(`/children/${childId}?error=${encodeURIComponent(message)}`);
  const done = () => context.redirect(`/children/${childId}`);

  const intent = form.get("intent");

  if (intent === "save") {
    const rawContent = form.get("content");
    const content = typeof rawContent === "string" ? rawContent.trim() : "";
    if (!content) {
      return fail("Treść notatki jest wymagana");
    }
    if (content.length > CONTENT_MAX_LENGTH) {
      return fail(`Notatka może mieć maksymalnie ${CONTENT_MAX_LENGTH} znaków`);
    }

    // `occurred_at` is deliberately ignored: an edit changes the text, never the moment.
    const { error, found } = await updateNoteContent(supabase, noteId, content);
    if (error) {
      return fail("Nie udało się zapisać notatki. Spróbuj ponownie.");
    }
    if (!found) {
      return toDashboard("Nie znaleziono notatki");
    }
    return done();
  }

  if (intent === "delete") {
    const { error, found } = await softDeleteNote(supabase, noteId);
    if (error) {
      return fail("Nie udało się usunąć notatki. Spróbuj ponownie.");
    }
    if (!found) {
      return toDashboard("Nie znaleziono notatki");
    }
    return done();
  }

  return toDashboard("Nieprawidłowe żądanie");
};
