// The two read protections supabase/tests/02_notes_characterization.sql recorded as ABSENT from the
// policy layer and handed to this rollout phase by name.
//
// Both assertions there are characterizations, not guarantees: `notes_select_own` carries no child
// predicate (`:63-78`) and `deleted_at` appears in no policy predicate (`:80-94`), so the policy
// layer returns both children's rows and the owner's own soft-deleted row. The protections are real
// -- they just live one layer up, in `listNotes`' query (src/lib/notes.ts:28-29). Nothing could
// assert them before this phase, because asserting them needs a real Postgres with RLS live and a
// JavaScript runner to call the query from.
//
// Each expected set is the fixture's own ids. Ids, not counts: a count passes while the wrong row is
// returned, which is precisely the failure a missing `child_id` filter produces.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SupabaseServerClient } from "@/lib/children";
import { listNotes } from "@/lib/notes";

import {
  READ_BOUNDARY_FIXTURE,
  READ_BOUNDARY_IDS,
  seedFixture,
  signInAsFixtureUser,
  teardownFixture,
} from "./fixtures";

let authenticated: SupabaseServerClient;

beforeAll(async () => {
  // Teardown first: a dirty local database or a previously failed run must not be able to decide
  // this suite's outcome.
  await teardownFixture(READ_BOUNDARY_FIXTURE);
  await seedFixture(READ_BOUNDARY_FIXTURE);
  authenticated = await signInAsFixtureUser(READ_BOUNDARY_FIXTURE);
});

afterAll(async () => {
  await teardownFixture(READ_BOUNDARY_FIXTURE);
});

// Set comparison rather than sequence comparison: ordering is already asserted one layer up, over
// HTTP, by scripts/smoke.mjs, and the plan keeps a second assertion of it out of this file.
function idsOf(notes: { id: string }[]): string[] {
  return notes.map((note) => note.id).sort();
}

const FIRST_CHILD_LIVE_NOTES = [
  READ_BOUNDARY_IDS.firstChildLiveNote,
  READ_BOUNDARY_IDS.firstChildSecondLiveNote,
].sort();

describe("listNotes soft-delete exclusion", () => {
  it("omits the owner's own soft-deleted note", async () => {
    const notes = await listNotes(authenticated, READ_BOUNDARY_IDS.firstChild);

    expect(idsOf(notes)).toStrictEqual(FIRST_CHILD_LIVE_NOTES);
    // Stated separately from the set above so a failure reads as what it is. The row exists, the
    // signed-in user owns it, and the policy layer hands it over -- 02_notes_characterization.sql
    // asserts exactly that. `.is("deleted_at", null)` at src/lib/notes.ts:29 is the only thing
    // keeping it out of a parent's list.
    expect(notes.map((note) => note.id)).not.toContain(READ_BOUNDARY_IDS.firstChildDeletedNote);
  });
});

describe("listNotes cross-child scoping", () => {
  it("returns the requested child's notes and none of the sibling's", async () => {
    const firstChildNotes = await listNotes(authenticated, READ_BOUNDARY_IDS.firstChild);
    const secondChildNotes = await listNotes(authenticated, READ_BOUNDARY_IDS.secondChild);

    expect(idsOf(firstChildNotes)).toStrictEqual(FIRST_CHILD_LIVE_NOTES);
    expect(idsOf(secondChildNotes)).toStrictEqual([READ_BOUNDARY_IDS.secondChildLiveNote]);

    // The same account owns both children, so RLS matches every one of these rows. Only
    // `.eq("child_id", childId)` at src/lib/notes.ts:28 separates the two lists -- and the docstring
    // at `:20-21` says so deliberately.
    expect(firstChildNotes.map((note) => note.id)).not.toContain(READ_BOUNDARY_IDS.secondChildLiveNote);
    expect(secondChildNotes.map((note) => note.id)).not.toContain(READ_BOUNDARY_IDS.firstChildLiveNote);
  });
});
