// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const runId = Date.now();
const email = `smoke-${runId}@example.com`;
const emailB = `smoke-b-${runId}@example.com`;
const password = "Smoke-Test-Passw0rd!";
// Unique per run so the isolation check cannot match a child left over from an earlier run.
const childName = `Smoke-Dziecko-${runId}`;
// Same reason, per note: no assertion may pass on a note written by an earlier run.
const noteNow = `Smoke-Notatka-${runId}`;
const noteBackdated = `Smoke-Notatka-wczesniej-${runId}`;
const noteEdited = `Smoke-Notatka-zmieniona-${runId}`;
const noteRejected = `Smoke-Notatka-odrzucona-${runId}`;
const noteHijacked = `Smoke-Notatka-przejeta-${runId}`;
const noteTooLong = "x".repeat(2001);
// Any syntactically valid uuid will do: the anonymous guard lives in middleware and fires before
// either handler resolves the id, so no real child has to exist yet.
const placeholderId = "00000000-0000-0000-0000-000000000000";
const jar = new Map();
// Ids the walk discovers along the way. A POST answers 302 with an empty body, so both the child
// id and the note ids are read out of the markup of a following GET.
const ids = {};

const DAY_MS = 86_400_000;

// `YYYY-MM-DDTHH:mm` in Poland — the shape `occurred_at` stores. Mirrors src/lib/wall-clock.ts
// rather than importing it, since this script stays dependency- and build-free.
function warsawWallClock(at = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" })
    .format(at)
    .replace(" ", "T");
}

const occurredNow = warsawWallClock();
const occurredBackdated = warsawWallClock(new Date(Date.now() - 3 * DAY_MS));
const occurredFuture = warsawWallClock(new Date(Date.now() + 365 * DAY_MS));

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

// True when both strings are present and `first` comes first — the rendered order of the note list.
function orderedIn(body, [first, second]) {
  const at = body.indexOf(first);
  return at > -1 && at < body.indexOf(second);
}

async function request(path, { method = "GET", form } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text() };
}

// A step is [name, runner, expectations]. Both the runner and the expectations may be thunks, so a
// step that needs an id captured by an earlier step resolves after that capture, not at load time.
const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "add child rejects anonymous user",
    () => request("/api/children", { method: "POST", form: { name: childName } }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "add note rejects anonymous user",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { child_id: placeholderId, content: noteNow, occurred_at: occurredNow },
      }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "child page rejects anonymous user",
    () => request(`/children/${placeholderId}`),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  [
    "add child accepts a name",
    () => request("/api/children", { method: "POST", form: { name: childName } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "dashboard lists the new child",
    () => request("/dashboard"),
    { status: 200, bodyIncludes: childName, extract: [/\/children\/([0-9a-f-]{36})/, "child"] },
  ],
  [
    "add child rejects an empty name",
    () => request("/api/children", { method: "POST", form: { name: "" } }),
    { status: 302, location: "/dashboard?error=" },
  ],
  [
    "add note accepts content",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { child_id: ids.child, content: noteNow, occurred_at: occurredNow },
      }),
    () => ({ status: 302, location: `/children/${ids.child}` }),
  ],
  [
    "child page lists the new note",
    () => request(`/children/${ids.child}`),
    { status: 200, bodyIncludes: noteNow, extract: [/\/api\/notes\/([0-9a-f-]{36})/, "note"] },
  ],
  [
    "add note rejects empty content",
    () =>
      request("/api/notes", { method: "POST", form: { child_id: ids.child, content: "", occurred_at: occurredNow } }),
    () => ({ status: 302, location: `/children/${ids.child}?error=` }),
  ],
  [
    "add note rejects content over 2000 characters",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { child_id: ids.child, content: noteTooLong, occurred_at: occurredNow },
      }),
    () => ({ status: 302, location: `/children/${ids.child}?error=` }),
  ],
  [
    "add note rejects a moment in the future",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { child_id: ids.child, content: noteRejected, occurred_at: occurredFuture },
      }),
    () => ({ status: 302, location: `/children/${ids.child}?error=` }),
  ],
  [
    "add note accepts a backdated moment",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { child_id: ids.child, content: noteBackdated, occurred_at: occurredBackdated },
      }),
    () => ({ status: 302, location: `/children/${ids.child}` }),
  ],
  [
    "child page lists notes newest occurrence first",
    () => request(`/children/${ids.child}`),
    { status: 200, bodyOrder: [noteNow, noteBackdated] },
  ],
  [
    "edit note saves new content",
    () =>
      request(`/api/notes/${ids.note}`, {
        method: "POST",
        form: { child_id: ids.child, intent: "save", content: noteEdited },
      }),
    () => ({ status: 302, location: `/children/${ids.child}` }),
  ],
  [
    "child page shows the edited note and not the old text",
    () => request(`/children/${ids.child}`),
    { status: 200, bodyIncludes: noteEdited, bodyExcludes: noteNow },
  ],
  [
    "note endpoint rejects an unrecognised intent",
    () =>
      request(`/api/notes/${ids.note}`, {
        method: "POST",
        form: { child_id: ids.child, intent: "nonsense", content: noteEdited },
      }),
    { status: 302, location: "/dashboard?error=" },
  ],
  [
    "delete note accepts the confirmed delete",
    () => request(`/api/notes/${ids.note}`, { method: "POST", form: { child_id: ids.child, intent: "delete" } }),
    () => ({ status: 302, location: `/children/${ids.child}` }),
  ],
  [
    "child page no longer lists the deleted note",
    () => request(`/children/${ids.child}`),
    {
      status: 200,
      bodyIncludes: noteBackdated,
      bodyExcludes: noteEdited,
      // Only the backdated note is left, so the first form action on the page is its id.
      extract: [/\/api\/notes\/([0-9a-f-]{36})/, "survivor"],
    },
  ],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  // User B must be a fresh account signed in after A signed out, or the cookie jar still holds A's session.
  [
    "second user signs up",
    () => request("/api/auth/signup", { method: "POST", form: { email: emailB, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "second user signs in",
    () => request("/api/auth/signin", { method: "POST", form: { email: emailB, password } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "second user does not see first user's child",
    () => request("/dashboard"),
    { status: 200, bodyIncludes: "Moje dzieci", bodyExcludes: childName },
  ],
  ["second user gets a 404 on first user's child page", () => request(`/children/${ids.child}`), { status: 404 }],
  [
    "second user cannot add a note to first user's child",
    () =>
      request("/api/notes", {
        method: "POST",
        form: { child_id: ids.child, content: noteHijacked, occurred_at: occurredNow },
      }),
    { status: 302, location: "/dashboard?error=" },
  ],
  [
    "second user cannot edit first user's note",
    () =>
      request(`/api/notes/${ids.survivor}`, {
        method: "POST",
        form: { child_id: ids.child, intent: "save", content: noteHijacked },
      }),
    { status: 302, location: "/dashboard?error=" },
  ],
  [
    "second user cannot delete first user's note",
    () => request(`/api/notes/${ids.survivor}`, { method: "POST", form: { child_id: ids.child, intent: "delete" } }),
    { status: 302, location: "/dashboard?error=" },
  ],
  ["second user signs out", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  [
    "first user signs back in",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "first user's surviving note is unchanged",
    () => request(`/children/${ids.child}`),
    { status: 200, bodyIncludes: noteBackdated, bodyExcludes: noteHijacked },
  ],
];

let failed = 0;
for (const [name, run, define] of steps) {
  const actual = await run();
  const expected = typeof define === "function" ? define() : define;
  let extracted = true;
  if (expected.extract !== undefined) {
    const [pattern, key] = expected.extract;
    const match = actual.body.match(pattern);
    extracted = match !== null;
    if (match) ids[key] = match[1];
  }
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location)) &&
    (expected.bodyIncludes === undefined || actual.body.includes(expected.bodyIncludes)) &&
    (expected.bodyExcludes === undefined || !actual.body.includes(expected.bodyExcludes)) &&
    (expected.bodyOrder === undefined || orderedIn(actual.body, expected.bodyOrder)) &&
    extracted;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
    if (expected.bodyIncludes !== undefined) console.log(`      expected body to include "${expected.bodyIncludes}"`);
    if (expected.bodyExcludes !== undefined) console.log(`      expected body to exclude "${expected.bodyExcludes}"`);
    if (expected.bodyOrder !== undefined)
      console.log(`      expected body to list "${expected.bodyOrder[0]}" before "${expected.bodyOrder[1]}"`);
    if (expected.extract !== undefined) console.log(`      expected body to carry the ${expected.extract[1]} id`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
