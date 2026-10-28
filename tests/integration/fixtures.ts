// The fixture harness for tests/integration. Every expected set in this directory is derived from a
// fixture declared here and never from re-running the query under test -- §2 of
// context/foundation/test-plan.md names that substitution as the anti-pattern for these risks: a
// test that asks the subject what the answer is agrees with it by construction.
//
// Three things about this file are deliberate and load-bearing:
//
//   * The service-role key is read here and nowhere under `src/`. Seeding has to bypass RLS (the
//     pgTAP fixtures do the same one layer down, as `postgres`), and reading back has to NOT bypass
//     it -- so the harness hands out two different clients and names which is which.
//   * Absent credentials FAIL, they do not skip (§6.6). A suite that silently no-ops when the local
//     stack is down reports green having asserted nothing: Risk #7 wearing Risk #1's clothes.
//   * Teardown deletes BY ID, never by truncation, and runs before the seed as well as after it. A
//     dirty local database or a previously failed run would otherwise make a suite pass or fail for
//     a reason that has nothing to do with the code -- and because every id is checked against the
//     reserved prefix below, no row a human created is reachable by a delete issued from here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseServerClient } from "@/lib/children";
import { warsawWallClock } from "@/lib/wall-clock";

// A vector at a chosen cosine similarity -- the one thing this file could not express on its own.
// The dependency runs one way only: that module reads no credentials and touches no database, so
// `tests/unit/` can import it too, which is where its math is pinned.
import { gradedVector } from "../support/graded-vector";

const URL_ENV = "SUPABASE_URL";
const ANON_KEY_ENV = "SUPABASE_ANON_KEY";
const SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      [
        `${name} is not set, so this suite has no database to run against.`,
        "Absent credentials fail, they do not skip -- a suite that no-ops here would report green",
        "having asserted nothing. Start the local stack and export all three values:",
        "",
        "  supabase start",
        "  supabase status -o env",
        "",
        `  ${URL_ENV}              <- API_URL`,
        `  ${ANON_KEY_ENV}         <- ANON_KEY`,
        `  ${SERVICE_ROLE_KEY_ENV} <- SERVICE_ROLE_KEY`,
        "",
        "Then: npm run test:int",
      ].join("\n"),
    );
  }
  return value;
}

// No session storage and no refresh timer on either client: these processes are short-lived, and a
// background refresh interval keeps the Vitest worker alive past the last assertion.
const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };

let cachedServiceClient: SupabaseClient | null = null;

/**
 * The service-role client. It bypasses RLS, so it is used for exactly three things -- seeding a
 * fixture, deleting it again, and reading a complete row back in the one test whose subject is
 * which columns an update wrote. It is never the client a query under test runs on: that would
 * exercise the query with every policy switched off.
 */
export function serviceClient(): SupabaseClient {
  cachedServiceClient ??= createClient(requireEnv(URL_ENV), requireEnv(SERVICE_ROLE_KEY_ENV), CLIENT_OPTIONS);
  return cachedServiceClient;
}

// Every id this directory touches starts here. The shape mirrors the readable-id style of
// supabase/tests/02_notes_characterization.sql:29-59 -- a fixed, reserved space rather than
// generated uuids, so a row is identifiable as a fixture by looking at it, a failed run leaves
// nothing a later run cannot find, and the delete surface is auditable from this file alone.
// `f1c7` reads as "fixture"; the digit after the zeros gives each suite its own id space, which is
// what lets the two suites in this directory run in parallel without deleting each other's rows.
export const FIXTURE_ID_PREFIX = "f1c70000-0000-0000-0000-";

const FIXTURE_PASSWORD = "integration-fixture-password";

export const READ_BOUNDARY_IDS = {
  user: `${FIXTURE_ID_PREFIX}000010000001`,
  firstChild: `${FIXTURE_ID_PREFIX}0000100000c1`,
  secondChild: `${FIXTURE_ID_PREFIX}0000100000c2`,
  firstChildLiveNote: `${FIXTURE_ID_PREFIX}00001000c101`,
  firstChildSecondLiveNote: `${FIXTURE_ID_PREFIX}00001000c102`,
  firstChildDeletedNote: `${FIXTURE_ID_PREFIX}00001000c1d1`,
  secondChildLiveNote: `${FIXTURE_ID_PREFIX}00001000c201`,
};

export const EDIT_SCOPE_IDS = {
  user: `${FIXTURE_ID_PREFIX}000020000001`,
  child: `${FIXTURE_ID_PREFIX}0000200000c1`,
  note: `${FIXTURE_ID_PREFIX}00002000c101`,
};

export interface ChildSeed {
  id: string;
  name: string;
}

export interface NoteSeed {
  id: string;
  childId: string;
  /** A bare wall clock, `YYYY-MM-DDTHH:mm`: `notes.occurred_at` is `timestamp` without a zone. */
  occurredAt: string;
  content: string;
  /** Soft-deleted on seed. The owner is unchanged -- that is the point of the exclusion test. */
  deleted?: boolean;
  /**
   * Precomputed, synthetic `notes.embedding` value -- never a real OpenAI call. Optional and
   * additive: a fixture that omits it keeps seeding `null`, unchanged from before this field
   * existed.
   */
  embedding?: number[];
}

export interface Fixture {
  email: string;
  password: string;
  userId: string;
  children: ChildSeed[];
  notes: NoteSeed[];
}

// A fixed instant rather than `now()`, so nothing in a seeded row depends on when the suite ran.
const SEEDED_DELETED_AT = "2026-01-01T00:00:00.000Z";

/**
 * One account, two children, three notes on the first child -- two live and one soft-deleted -- and
 * one note on the second child. The soft-deleted note and the second child's note carry the two
 * LATEST `occurred_at` values of the set, so a query missing either filter does not merely return an
 * extra row: it returns it at the head of a list ordered by occurrence.
 */
export const READ_BOUNDARY_FIXTURE: Fixture = {
  email: "read-boundaries.fixture@example.com",
  password: FIXTURE_PASSWORD,
  userId: READ_BOUNDARY_IDS.user,
  children: [
    { id: READ_BOUNDARY_IDS.firstChild, name: "First fixture child" },
    { id: READ_BOUNDARY_IDS.secondChild, name: "Second fixture child" },
  ],
  notes: [
    {
      id: READ_BOUNDARY_IDS.firstChildLiveNote,
      childId: READ_BOUNDARY_IDS.firstChild,
      occurredAt: "2026-07-15T10:30",
      content: "live note on the first child",
    },
    {
      id: READ_BOUNDARY_IDS.firstChildSecondLiveNote,
      childId: READ_BOUNDARY_IDS.firstChild,
      occurredAt: "2026-07-16T08:00",
      content: "second live note on the first child",
    },
    {
      id: READ_BOUNDARY_IDS.firstChildDeletedNote,
      childId: READ_BOUNDARY_IDS.firstChild,
      occurredAt: "2026-07-17T09:00",
      content: "soft-deleted note on the first child",
      deleted: true,
    },
    {
      id: READ_BOUNDARY_IDS.secondChildLiveNote,
      childId: READ_BOUNDARY_IDS.secondChild,
      occurredAt: "2026-07-18T11:00",
      content: "live note on the second child",
    },
  ],
};

/** One account, one child, one live note -- the row whose columns an edit must leave alone. */
export const EDIT_SCOPE_FIXTURE: Fixture = {
  email: "edit-scope.fixture@example.com",
  password: FIXTURE_PASSWORD,
  userId: EDIT_SCOPE_IDS.user,
  children: [{ id: EDIT_SCOPE_IDS.child, name: "Edit-scope fixture child" }],
  notes: [
    {
      id: EDIT_SCOPE_IDS.note,
      childId: EDIT_SCOPE_IDS.child,
      occurredAt: "2026-07-15T10:30",
      content: "the text this note carried before the edit",
    },
  ],
};

export const SEARCH_IDS = {
  user: `${FIXTURE_ID_PREFIX}000030000001`,
  child: `${FIXTURE_ID_PREFIX}0000300000c1`,
  nearNote: `${FIXTURE_ID_PREFIX}00003000c101`,
  beforeWindowNote: `${FIXTURE_ID_PREFIX}00003000c102`,
  atWindowStartNote: `${FIXTURE_ID_PREFIX}00003000c103`,
  atWindowEndNote: `${FIXTURE_ID_PREFIX}00003000c104`,
  afterWindowNote: `${FIXTURE_ID_PREFIX}00003000c105`,
  fullTextOnlyNote: `${FIXTURE_ID_PREFIX}00003000c106`,
  // The threshold notes get a child of their own (see SEARCH_FIXTURE's docstring): every
  // `search_notes` call is scoped by `p_child_id`, so notes seeded here are invisible to -- and
  // cannot change the outcome of -- the date-window and degraded-mode assertions on `child`.
  thresholdChild: `${FIXTURE_ID_PREFIX}0000300000c2`,
  aboveFloorNote: `${FIXTURE_ID_PREFIX}00003000c201`,
  belowFloorNote: `${FIXTURE_ID_PREFIX}00003000c202`,
  // The window-only notes get a child of their own for the same reason the threshold notes do.
  windowChild: `${FIXTURE_ID_PREFIX}0000300000c3`,
  todayEarlyNote: `${FIXTURE_ID_PREFIX}00003000c301`,
  todayLateNote: `${FIXTURE_ID_PREFIX}00003000c302`,
  outsideTodayNote: `${FIXTURE_ID_PREFIX}00003000c303`,
};

/**
 * Today's Warsaw date key, so the window-only assertions do not expire. A fixture pinned to a
 * literal month would stop exercising anything the moment the calendar passed it: `dzisiaj`
 * resolves against the clock at call time, and a window with no seeded note in it makes the
 * assertion vacuous rather than red. Read through `warsawWallClock` -- the same helper the parser
 * anchors on, whose own correctness is pinned by tests/unit/wall-clock.test.ts -- rather than
 * recomputing a Warsaw date here.
 *
 * Both seeded times sit at midday so neither lands near a day boundary; a run that straddles
 * Warsaw midnight is the one case this cannot cover, and it would fail loudly rather than pass
 * wrongly.
 */
const TODAY_WALL_CLOCK_DATE = warsawWallClock(new Date()).slice(0, 10);

// A one-hot synthetic vector, never a real OpenAI embedding: cosine similarity of a vector with
// itself is 1.0, comfortably over `search_notes`'s default `p_similarity_threshold` (0.434)
// regardless of how that default is later tuned. Reused as both the seeded `embedding` column
// value on every "should be in the date window" note and as `p_query_embedding` in the RPC calls
// below, so the date filter -- not an accidental threshold miss -- is what proves inclusion/
// exclusion.
export const SEARCH_ONE_HOT_EMBEDDING: number[] = new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));

/**
 * The measured default of `search_notes`'s `p_similarity_threshold`, from
 * `supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql`. Its
 * provenance -- a 26-note Polish corpus in `supabase/seed.sql`, 18 frozen questions, overlapping
 * bands and the 0.430 -> 0.438 gap this value is the midpoint of -- is recorded in that migration's
 * header and in `context/changes/note-search-similarity-floor/change.md`.
 */
export const SEARCH_SIMILARITY_FLOOR = 0.434;

// How far either side of the floor the two threshold notes sit. 0.02 is far outside float4's ~1e-7
// (what `vector(1536)` costs in storage) and twenty times the +/-0.001 run-to-run spread of the
// embeddings endpoint -- but the load-bearing property is that it is wider than the measured
// 0.430 -> 0.438 gap in both directions. Moving the default anywhere outside that gap therefore
// puts one of these two notes on the wrong side of it, and the threshold assertions in
// notes-search.test.ts go red rather than silently following the constant.
const SEARCH_FLOOR_MARGIN = 0.02;

export const SEARCH_ABOVE_FLOOR_SIMILARITY = SEARCH_SIMILARITY_FLOOR + SEARCH_FLOOR_MARGIN;
export const SEARCH_BELOW_FLOOR_SIMILARITY = SEARCH_SIMILARITY_FLOOR - SEARCH_FLOOR_MARGIN;

/**
 * One account, two children, eight notes -- for `tests/integration/notes-search.test.ts`.
 *
 * On `child`, six notes about dates and text. `nearNote` sits mid-window and carries the one-hot
 * embedding, serving double duty as both the no-date-range semantic match and the date-window's
 * "included" case. `beforeWindowNote`/`atWindowEndNote`/`afterWindowNote` also carry the one-hot
 * embedding, so the date filter alone is what excludes them. `atWindowStartNote` proves the
 * inclusive lower bound. `fullTextOnlyNote` carries no embedding at all, for the degraded
 * (`p_query_embedding: null`) full-text-only assertion.
 *
 * On `thresholdChild`, two notes about nothing but the similarity floor: one at
 * `SEARCH_ABOVE_FLOOR_SIMILARITY` and one at `SEARCH_BELOW_FLOOR_SIMILARITY`. They need their own
 * child because the six notes above are counted as a complete set by the date-window assertion --
 * a seventh and eighth note on `child` would break it. Their content is chosen to share no word
 * with the query text that reads them, so the full-text arm cannot smuggle the below-floor note
 * back in and the floor is the only thing deciding.
 */
export const SEARCH_FIXTURE: Fixture = {
  email: "search.fixture@example.com",
  password: FIXTURE_PASSWORD,
  userId: SEARCH_IDS.user,
  children: [
    { id: SEARCH_IDS.child, name: "Search fixture child" },
    { id: SEARCH_IDS.thresholdChild, name: "Search threshold fixture child" },
    { id: SEARCH_IDS.windowChild, name: "Search window-only fixture child" },
  ],
  notes: [
    {
      id: SEARCH_IDS.nearNote,
      childId: SEARCH_IDS.child,
      occurredAt: "2026-07-04T12:00",
      content: "notatka o spacerze w parku",
      embedding: SEARCH_ONE_HOT_EMBEDDING,
    },
    {
      id: SEARCH_IDS.beforeWindowNote,
      childId: SEARCH_IDS.child,
      occurredAt: "2026-06-30T23:59",
      content: "notatka sprzed okna czasowego",
      embedding: SEARCH_ONE_HOT_EMBEDDING,
    },
    {
      id: SEARCH_IDS.atWindowStartNote,
      childId: SEARCH_IDS.child,
      occurredAt: "2026-07-01T00:00",
      content: "notatka na poczatku okna czasowego",
      embedding: SEARCH_ONE_HOT_EMBEDDING,
    },
    {
      id: SEARCH_IDS.atWindowEndNote,
      childId: SEARCH_IDS.child,
      occurredAt: "2026-07-08T00:00",
      content: "notatka dokladnie na koncu okna czasowego",
      embedding: SEARCH_ONE_HOT_EMBEDDING,
    },
    {
      id: SEARCH_IDS.afterWindowNote,
      childId: SEARCH_IDS.child,
      occurredAt: "2026-07-08T00:01",
      content: "notatka po oknie czasowym",
      embedding: SEARCH_ONE_HOT_EMBEDDING,
    },
    {
      id: SEARCH_IDS.fullTextOnlyNote,
      childId: SEARCH_IDS.child,
      occurredAt: "2026-05-01T09:00",
      content: "dzisiaj byl kaszel KASZELXYZ",
    },
    {
      id: SEARCH_IDS.aboveFloorNote,
      childId: SEARCH_IDS.thresholdChild,
      occurredAt: "2026-07-04T12:00",
      content: "pierwsza notatka progowa PROGXYZA",
      embedding: gradedVector(SEARCH_ABOVE_FLOOR_SIMILARITY),
    },
    {
      id: SEARCH_IDS.belowFloorNote,
      childId: SEARCH_IDS.thresholdChild,
      occurredAt: "2026-07-05T12:00",
      content: "druga notatka progowa PROGXYZB",
      embedding: gradedVector(SEARCH_BELOW_FLOOR_SIMILARITY),
    },
    // The window-only notes. No `embedding` on purpose: the path they exercise never embeds
    // anything, and seeding a vector here would hide a regression that started calling the
    // embeddings endpoint for a question that has no words left in it.
    {
      id: SEARCH_IDS.todayEarlyNote,
      childId: SEARCH_IDS.windowChild,
      occurredAt: `${TODAY_WALL_CLOCK_DATE}T09:00`,
      content: "poranna notatka okienkowa OKNOXYZA",
    },
    {
      id: SEARCH_IDS.todayLateNote,
      childId: SEARCH_IDS.windowChild,
      occurredAt: `${TODAY_WALL_CLOCK_DATE}T15:00`,
      content: "popoludniowa notatka okienkowa OKNOXYZB",
    },
    {
      id: SEARCH_IDS.outsideTodayNote,
      childId: SEARCH_IDS.windowChild,
      occurredAt: "2026-01-02T12:00",
      content: "notatka poza okienkiem dzisiejszym OKNOXYZC",
    },
  ],
};

// The reserved prefix is what makes the deletes below safe to run against a developer's own local
// database, so it is asserted rather than assumed. A typo in one id would otherwise widen the delete
// surface silently -- and §6.6 records the silent direction as the dangerous one.
function assertReserved(fixture: Fixture): void {
  const ids = [fixture.userId, ...fixture.children.map((child) => child.id), ...fixture.notes.map((note) => note.id)];
  const strays = ids.filter((id) => !id.startsWith(FIXTURE_ID_PREFIX));
  if (strays.length > 0) {
    throw new Error(
      `fixture ids must start with the reserved prefix ${FIXTURE_ID_PREFIX}; refusing to touch: ${strays.join(", ")}`,
    );
  }
}

/** Seeds the fixture with the service-role client. Call `teardownFixture` first, always. */
export async function seedFixture(fixture: Fixture): Promise<void> {
  assertReserved(fixture);
  const service = serviceClient();

  // A fixed id, through the admin API rather than a direct insert into `auth.users`: the pgTAP
  // fixtures insert that row themselves because they switch role inside one transaction, but a row
  // inserted that way carries no password, and this harness has to be able to sign in.
  const createdUser = await service.auth.admin.createUser({
    id: fixture.userId,
    email: fixture.email,
    password: fixture.password,
    email_confirm: true,
  });
  if (createdUser.error) {
    throw createdUser.error;
  }

  const insertedChildren = await service.from("children").insert(
    fixture.children.map((child) => ({
      id: child.id,
      user_id: fixture.userId,
      name: child.name,
    })),
  );
  if (insertedChildren.error) {
    throw insertedChildren.error;
  }

  const insertedNotes = await service.from("notes").insert(
    fixture.notes.map((note) => ({
      id: note.id,
      user_id: fixture.userId,
      child_id: note.childId,
      content: note.content,
      occurred_at: note.occurredAt,
      deleted_at: note.deleted === true ? SEEDED_DELETED_AT : null,
      embedding: note.embedding ?? null,
    })),
  );
  if (insertedNotes.error) {
    throw insertedNotes.error;
  }
}

/**
 * Removes the fixture. Idempotent in both directions: already-absent rows and an already-absent user
 * are the expected state on a clean database, which is what lets this run before the seed as well as
 * after it. Deletes name ids explicitly -- no truncate, and no predicate wide enough to reach a row
 * this file did not create.
 */
export async function teardownFixture(fixture: Fixture): Promise<void> {
  assertReserved(fixture);
  const service = serviceClient();

  const deletedNotes = await service
    .from("notes")
    .delete()
    .in(
      "id",
      fixture.notes.map((note) => note.id),
    );
  if (deletedNotes.error) {
    throw deletedNotes.error;
  }

  const deletedChildren = await service
    .from("children")
    .delete()
    .in(
      "id",
      fixture.children.map((child) => child.id),
    );
  if (deletedChildren.error) {
    throw deletedChildren.error;
  }

  const deletedUser = await service.auth.admin.deleteUser(fixture.userId);
  // 404 is "there was no such user", which is a completed teardown, not a failure.
  if (deletedUser.error && deletedUser.error.status !== 404) {
    throw deletedUser.error;
  }
}

/**
 * An anon client signed in as the fixture user -- RLS live, exactly as a request from the browser
 * sees it. A fresh client per call, never a cached one: signing in mutates the client's auth state,
 * so two fixtures sharing one client would each end up holding the other's session.
 *
 * No cast is needed, and that is worth recording: `SupabaseServerClient` is the return type of
 * `@supabase/ssr`'s `createServerClient` (src/lib/children.ts:4), and `@supabase/ssr` declares
 * `@supabase/supabase-js` as a peer rather than bundling its own copy, so both factories return the
 * same `SupabaseClient` class. The two differ only in where the session is kept -- cookies rather
 * than memory. What a test cannot do is build the real thing: `src/lib/supabase.ts` imports
 * `astro:env/server`, which does not resolve outside an Astro build.
 */
export async function signInAsFixtureUser(fixture: Fixture): Promise<SupabaseServerClient> {
  const anon = createClient(requireEnv(URL_ENV), requireEnv(ANON_KEY_ENV), CLIENT_OPTIONS);
  const { error } = await anon.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  if (error) {
    throw error;
  }
  return anon;
}
