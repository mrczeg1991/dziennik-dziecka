import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createChild } from "@/lib/children";

const NAME_MAX_LENGTH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

// Returns the error message for an invalid birth date, or null if it is acceptable.
// Allows up to one day past the server's UTC date: Workers run in UTC while the
// parent is in Poland, where "today" can already be "tomorrow" in UTC.
function validateBirthDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "Nieprawidłowa data urodzenia";
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Nieprawidłowa data urodzenia";
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > todayUtc + DAY_MS) {
    return "Data urodzenia nie może być w przyszłości";
  }
  return null;
}

export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const rawName = form.get("name");
  const rawBirthDate = form.get("birth_date");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const birthDate = typeof rawBirthDate === "string" && rawBirthDate.trim() ? rawBirthDate.trim() : null;

  if (!name) {
    return fail("Imię jest wymagane");
  }
  if (name.length > NAME_MAX_LENGTH) {
    return fail(`Imię może mieć maksymalnie ${NAME_MAX_LENGTH} znaków`);
  }
  if (birthDate) {
    const birthDateError = validateBirthDate(birthDate);
    if (birthDateError) {
      return fail(birthDateError);
    }
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail("Supabase is not configured");
  }

  const error = await createChild(supabase, user.id, { name, birthDate });
  if (error) {
    return fail("Nie udało się dodać dziecka. Spróbuj ponownie.");
  }

  return context.redirect("/dashboard");
};
