import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import routeClassification from "@/lib/protected-routes.json";

// `startsWith` matching, so "/children" covers "/children/<id>" and "/api/notes" covers
// "/api/notes/<id>". The prefix list does NOT nest the other way -- "/children" does not match
// "/api/children" -- which is why both appear in the list.
//
// The list lives in a shared .json so that scripts/gate-routes.mjs reads the same data this
// matcher uses rather than a copy of it. That file also carries the `public` allowlist; every
// route under src/pages/ must appear in one or the other, or `npm run gate:routes` fails. Add a
// new route there, not here.
const PROTECTED_ROUTES = routeClassification.protected;

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
