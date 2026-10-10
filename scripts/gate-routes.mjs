// Gate: every route that exists is classified in the shared guard list. Risk #2 of
// context/foundation/test-plan.md.
//
// The assertion is INVERTED on purpose. A positive check-list -- "these paths must redirect" --
// keeps passing the moment someone adds a route and forgets to add it to the list, which is the
// exact failure being guarded against. So instead: enumerate the routes that exist, then require
// every one of them to be either covered by a `protected` prefix or named in the small `public`
// allowlist. Forgetting to classify a new route fails; forgetting to extend a check-list would
// not. The allowlist is the one surface that must be edited deliberately.
//
// Runs without a server and without a build, which is what lets it sit in the pre-build half of
// `npm run gates`.
//
// Zero dependencies, same as scripts/smoke.mjs. Run it with: npm run gate:routes

import { readdirSync, readFileSync } from "node:fs";

const PAGES_ROOT = "src/pages";
const LIST_PATH = "src/lib/protected-routes.json";
const ROUTE_EXTENSIONS = /\.(astro|ts)$/;

// Rooted at src/pages rather than walking the repository: .claude/worktrees/isolation-boundary-p2
// holds a second full checkout of the application, including src/pages/ files that do not exist on
// master. A repo-wide walk would enumerate those as phantom routes.
function enumerateRoutes(dir = PAGES_ROOT, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Posix separators are built by hand rather than with path.join, so the route strings are
    // identical on Windows and on the CI runner.
    const childPrefix = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...enumerateRoutes(`${dir}/${entry.name}`, childPrefix));
    } else if (ROUTE_EXTENSIONS.test(entry.name)) {
      // Astro's convention: drop the extension, and an `index` file is its directory's route.
      // Dynamic segments stay literal ("/api/notes/[id]"); prefix matching does not need them
      // resolved.
      const route = childPrefix.replace(ROUTE_EXTENSIONS, "").replace(/\/index$/, "");
      found.push({ route: route === "" ? "/" : route, file: `${dir}/${entry.name}` });
    }
  }
  return found;
}

const classification = JSON.parse(readFileSync(LIST_PATH, "utf8"));
for (const key of ["protected", "public"]) {
  if (!Array.isArray(classification[key])) {
    console.log(
      `FAIL  ${LIST_PATH} has no "${key}" array -- the guard list is unreadable, which is a failure, not a skip`,
    );
    process.exit(1);
  }
}

const protectedPrefixes = classification.protected;
const publicRoutes = classification.public;
const routes = enumerateRoutes();
const existingRoutes = new Set(routes.map(({ route }) => route));

// Mirrors the matcher in src/middleware.ts exactly:
// PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))
function matchingPrefixes(route) {
  return protectedPrefixes.filter((prefix) => route.startsWith(prefix));
}

// The drift detector. An enumerated route covered by neither half is the case this gate exists for.
function unclassifiedRoutes() {
  return routes
    .filter(({ route }) => matchingPrefixes(route).length === 0 && !publicRoutes.includes(route))
    .map(
      ({ route, file }) =>
        `${route} (${file}) is classified neither way -- cover it with a "protected" prefix or list it in "public" in ${LIST_PATH}`,
    );
}

// A public route that a protected prefix also matches cannot be reached anonymously at all.
function shadowedPublicRoutes() {
  return publicRoutes
    .map((route) => ({ route, shadows: matchingPrefixes(route) }))
    .filter(({ shadows }) => shadows.length > 0)
    .map(
      ({ route, shadows }) =>
        `${route} is listed public but matched by protected prefix ${shadows.join(", ")} -- it cannot be reached anonymously`,
    );
}

// A prefix matching nothing is stale, and `startsWith` over-matches, so a stale prefix silently
// widens over whatever is added later: a left-behind "/children" would also protect a future
// "/children-export". This assertion is also what makes an empty enumeration fail rather than pass
// vacuously -- with no routes found, every prefix matches nothing.
function stalePrefixes() {
  return protectedPrefixes
    .filter((prefix) => !routes.some(({ route }) => route.startsWith(prefix)))
    .map(
      (prefix) =>
        `${prefix} matches no route under ${PAGES_ROOT} -- remove it, or it will silently widen over a route added later`,
    );
}

// A public entry with no file behind it is stale in the other direction.
function phantomPublicRoutes() {
  return publicRoutes
    .filter((route) => !existingRoutes.has(route))
    .map((route) => `${route} has no file under ${PAGES_ROOT} -- remove it from "public" in ${LIST_PATH}`);
}

const ASSERTIONS = [
  ["every route under src/pages is classified", unclassifiedRoutes],
  ["no public route is shadowed by a protected prefix", shadowedPublicRoutes],
  ["every protected prefix matches a route that exists", stalePrefixes],
  ["every public route has a file behind it", phantomPublicRoutes],
];

let failed = 0;
for (const [name, check] of ASSERTIONS) {
  const problems = check();
  console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${name}`);
  for (const problem of problems) {
    failed++;
    console.log(`      ${problem}`);
  }
}

console.log(
  failed
    ? `\n${failed} route-coverage problem(s) over ${routes.length} enumerated route(s)`
    : `\nAll ${ASSERTIONS.length} route-coverage assertions passed over ${routes.length} enumerated route(s)`,
);
process.exit(failed ? 1 : 0);
