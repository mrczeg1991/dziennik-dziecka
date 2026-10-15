// Risk #4's column half: an edit changes the note's text and nothing else.
//
// There is no layer below this one. `notes_update_own`
// (supabase/migrations/20260927205447_create_notes.sql:47-66) constrains WHO may update a row and
// which account and child it may end up on -- it says nothing about WHICH COLUMNS an update is
// allowed to write. A handler that put `user_id`, `child_id`, `occurred_at` or `deleted_at` into its
// update payload would satisfy every policy on the table. So this is a handler-level guarantee, and
// the only place it can be asserted is here.
//
// The comparison is built by enumerating the keys the row actually returned and subtracting a
// two-name allowlist -- §6.6's enumerate-then-invert pattern, the one credited for the route-guard
// gate, applied to columns instead of routes. The direction matters: a column added to `notes` later
// is covered the moment it exists, with no edit to this file, and widening the allowlist becomes the
// deliberate review moment. Listing the columns to check instead would silently skip every column
// added after today.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { updateNoteContent } from "@/lib/notes";

import {
  EDIT_SCOPE_FIXTURE,
  EDIT_SCOPE_IDS,
  seedFixture,
  serviceClient,
  signInAsFixtureUser,
  teardownFixture,
} from "./fixtures";

// The two columns an edit is permitted to move, and the only hand-maintained list in this file.
// `content` must change to the new text; `updated_at` is allowed to differ because
// `updateNoteContent` stamps it (src/lib/notes.ts:69).
const EDITABLE_COLUMNS = new Set(["content", "updated_at"]);

const EDITED_CONTENT = "the text this note carries after the edit";

// Deliberately typed as an open record rather than as a column list: this test must not know the
// schema. Whatever columns `select("*")` hands back are the columns under assertion.
type CompleteRow = Record<string, unknown>;

// Read through the service-role client, which bypasses RLS. `listNotes`' projection
// (src/lib/notes.ts:27) names five columns, so reading the row back through the app's own query
// would hide the three that matter most here -- `user_id`, `child_id` and `deleted_at`.
async function readCompleteRow(noteId: string): Promise<CompleteRow> {
  const { data, error } = await serviceClient()
    .from("notes")
    .select("*")
    .eq("id", noteId)
    // The array form rather than `.single()`: PostgREST's single-object result is branded against a
    // row type it cannot prove is one object, and `Record<string, unknown>` is deliberately that
    // unprovable. Asserting the row count here instead costs nothing and says the same thing.
    .overrideTypes<CompleteRow[], { merge: false }>();

  if (error) {
    throw error;
  }
  if (data.length !== 1) {
    throw new Error(`expected exactly one note ${noteId} in the fixture, found ${data.length}`);
  }
  return data[0];
}

function withoutEditableColumns(row: CompleteRow): CompleteRow {
  return Object.fromEntries(Object.entries(row).filter(([column]) => !EDITABLE_COLUMNS.has(column)));
}

let before: CompleteRow;
let after: CompleteRow;
let update: Awaited<ReturnType<typeof updateNoteContent>>;

beforeAll(async () => {
  await teardownFixture(EDIT_SCOPE_FIXTURE);
  await seedFixture(EDIT_SCOPE_FIXTURE);
  const authenticated = await signInAsFixtureUser(EDIT_SCOPE_FIXTURE);

  before = await readCompleteRow(EDIT_SCOPE_IDS.note);
  update = await updateNoteContent(authenticated, EDIT_SCOPE_IDS.note, EDITED_CONTENT);
  after = await readCompleteRow(EDIT_SCOPE_IDS.note);
});

afterAll(async () => {
  await teardownFixture(EDIT_SCOPE_FIXTURE);
});

describe("updateNoteContent column scope", () => {
  it("matches the row and reports no error", () => {
    // Without this the diff below would pass on an update that matched nothing at all.
    expect(update.error).toBeNull();
    expect(update.found).toBe(true);
  });

  it("enumerates a row that really carries the allowlisted columns", () => {
    // The guard that keeps the subtraction honest. If `content` were ever renamed, an allowlist
    // naming a column that does not exist would quietly stop excluding anything -- and the diff
    // would start passing for the wrong reason rather than failing.
    const columns = Object.keys(before);

    for (const editable of EDITABLE_COLUMNS) {
      expect(columns).toContain(editable);
    }
    expect(columns.length).toBeGreaterThan(EDITABLE_COLUMNS.size);
  });

  it("rewrites content to the submitted text", () => {
    expect(before.content).toBe(EDIT_SCOPE_FIXTURE.notes[0].content);
    expect(after.content).toBe(EDITED_CONTENT);
  });

  it("leaves every column outside the allowlist byte-identical", () => {
    // Enumerate, then invert. `id`, `user_id`, `child_id`, `occurred_at`, `created_at` and
    // `deleted_at` are compared today because the row carried them, not because this file names
    // them -- and so is whatever column is added to `notes` next.
    expect(withoutEditableColumns(after)).toStrictEqual(withoutEditableColumns(before));
    expect(Object.keys(after).sort()).toStrictEqual(Object.keys(before).sort());
  });
});
