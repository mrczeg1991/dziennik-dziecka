import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { authErrorMessage } from "@/lib/auth-errors";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Aplikacja nie jest poprawnie skonfigurowana")}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    const message = authErrorMessage(error, "Nie udało się założyć konta. Spróbuj ponownie.");
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
