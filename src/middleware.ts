import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

// `startsWith` matching, so "/children" covers "/children/<id>" and "/api/notes" covers
// "/api/notes/<id>".
const PROTECTED_ROUTES = ["/dashboard", "/children", "/api/children", "/api/notes"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  // A signed-in parent goes straight to their children instead of the landing page.
  if (context.url.pathname === "/" && context.locals.user) {
    return context.redirect("/dashboard");
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
