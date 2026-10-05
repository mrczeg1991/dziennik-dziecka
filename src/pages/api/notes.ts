import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getChild, type Child } from "@/lib/children";
import { createNote } from "@/lib/notes";
import { WALL_CLOCK_RE, warsawWallClock } from "@/lib/wall-clock";

const CONTENT_MAX_LENGTH = 2000;
// Not cosmetic: a Worker's `Date.now()` reports the time of the last I/O and does not advance
// during execution, and a device clock can run a minute or two fast. Without slack a note saved
// at the current minute would be rejected as being in the future.
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  // An unresolvable child never redirects to a child-specific URL, so a probe learns nothing
  // about whether that child exists.
  const toDashboard = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return toDashboard("Aplikacja nie jest poprawnie skonfigurowana");
  }

  const form = await context.request.formData();
  const rawChildId = form.get("child_id");
  const childId = typeof rawChildId === "string" ? rawChildId.trim() : "";
  if (!UUID_RE.test(childId)) {
    return toDashboard("Nie znaleziono dziecka");
  }

  let child: Child | null;
  try {
    child = await getChild(supabase, childId);
  } catch {
    return toDashboard("Nie udało się dodać notatki. Spróbuj ponownie.");
  }
  if (!child) {
    return toDashboard("Nie znaleziono dziecka");
  }

  const fail = (message: string) => context.redirect(`/children/${childId}?error=${encodeURIComponent(message)}`);

  const rawContent = form.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!content) {
    return fail("Treść notatki jest wymagana");
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    return fail(`Notatka może mieć maksymalnie ${CONTENT_MAX_LENGTH} znaków`);
  }

  // An empty value means the form was submitted without JavaScript, where the island's
  // browser-local default never rendered: the save moment is then the note's moment.
  const rawOccurredAt = form.get("occurred_at");
  const submitted = typeof rawOccurredAt === "string" ? rawOccurredAt.trim() : "";
  const occurredAt = submitted || warsawWallClock();
  if (!WALL_CLOCK_RE.test(occurredAt)) {
    return fail("Nieprawidłowa data i godzina");
  }
  if (occurredAt > warsawWallClock(new Date(Date.now() + FUTURE_TOLERANCE_MS))) {
    return fail("Data i godzina nie mogą być w przyszłości");
  }

  const error = await createNote(supabase, user.id, { childId, content, occurredAt });
  if (error) {
    return fail("Nie udało się dodać notatki. Spróbuj ponownie.");
  }

  return context.redirect(`/children/${childId}`);
};
