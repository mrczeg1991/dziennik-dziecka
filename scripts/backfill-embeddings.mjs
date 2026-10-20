// One-time, idempotent backfill: computes an embedding for every note that doesn't have one yet
// (pre-existing notes written before this feature shipped, plus any note whose write-time
// embedding call failed in src/lib/embeddings.ts). Run manually, never as part of `npm run gates`:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... node scripts/backfill-embeddings.mjs
//
// Zero added dependencies, same convention as scripts/smoke.mjs: plain ESM, process.env read
// directly, explicit console.log progress/result lines, explicit exit codes.
//
// Service-role key, deliberately: this is an offline admin script run by the sole account owner,
// not a request path, so BYPASSRLS is the right tool here, not a bug -- it needs to see and update
// every account's notes in one run, which the session-scoped client's RLS would never allow.
//
// Re-running this script after a partial failure, or after Phase 2 shipped, just works: a failed
// row is left `embedding is null` and is picked up again next run. No separate "retry" mode exists
// because none is needed.

import { createClient } from "@supabase/supabase-js";

const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
// OpenAI's embeddings endpoint caps a single call's `input` array at 100 items. Chunking is cheap
// insurance against ever approaching it, even though this project's scale is nowhere near that today.
const BATCH_SIZE = 100;
// Same reason as src/lib/embeddings.ts's timeout: a stall never rejects, so without this a
// hung connection would park the whole backfill indefinitely. Far longer than the request
// path's 5s because one call here embeds up to BATCH_SIZE notes, and nobody is waiting on it.
const REQUEST_TIMEOUT_MS = 30_000;
// Rows requested per select page. Independent of BATCH_SIZE (which caps an OpenAI call) and of
// PostgREST's own `max_rows`; see selectAllPending for why a smaller cap stays correct.
const PAGE_SIZE = 1000;

const URL_ENV = "SUPABASE_URL";
const SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";
const OPENAI_KEY_ENV = "OPENAI_API_KEY";

// Absent credentials fail, they do not skip -- mirrors tests/integration/fixtures.ts's
// requireEnv: a script that silently no-ops here would report a clean exit having backfilled
// nothing, and nothing on screen would say why.
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      [
        `${name} is not set, so this script has no credentials to run with.`,
        "Absent credentials fail, they do not skip -- a run that silently no-ops here would exit 0",
        "having backfilled nothing. Set all three required variables:",
        "",
        `  ${URL_ENV}`,
        `  ${SERVICE_ROLE_KEY_ENV}`,
        `  ${OPENAI_KEY_ENV}`,
        "",
        "For the local stack: supabase start && supabase status -o env",
      ].join("\n"),
    );
  }
  return value;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Batched version of src/lib/embeddings.ts's embedText: same model, same endpoint, same response
// shape, but `input` is an array of strings and `response.data` carries one entry per input, each
// with its own `index` -- sorted defensively before zipping back to the chunk's rows, since the
// API does not document that the response preserves input order.
//
// Unlike embedText, this does not swallow a failure into `null` per row: a chunk-level failure
// (network error, non-OK response) is reported to the caller as `null` for the whole chunk, which
// the caller logs and skips -- never fatal to the overall run, matching embedText's "never block
// or fail the caller over this" contract applied at the chunk level instead of the row level.
async function embedBatch(texts) {
  try {
    const response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env[OPENAI_KEY_ENV]}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.log(`  OpenAI call failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const body = await response.json();
    const data = body.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      console.log(`  OpenAI response carried ${data?.length ?? 0} embedding(s), expected ${texts.length}`);
      return null;
    }

    return [...data].sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
  } catch (error) {
    console.log(`  OpenAI call threw: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// PostgREST truncates any response at its `max_rows` setting (supabase/config.toml sets 1000)
// without signalling that it did, so one unbounded select would report a partial backlog as the
// whole of it: "Found 1000 note(s)", exit 0, and an operator reasonably concluding the backfill is
// complete when thousands of notes are still null.
//
// The whole backlog is read before anything is written, rather than paging as we go: `embedding` is
// both the column this select filters on and the column the run mutates, so an interleaved pager
// would shift its own offsets out from under itself and skip rows. The offset advances by the rows
// actually received, never by the requested page size, so a `max_rows` lower than PAGE_SIZE
// narrows the pages instead of punching holes in them.
async function selectAllPending(supabase) {
  const pending = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("notes")
      .select("id, content")
      .is("embedding", null)
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    // Only a failure to reach the database at all is fatal -- a per-chunk OpenAI failure is not.
    if (error) {
      throw new Error(`Could not select notes needing an embedding: ${error.message}`);
    }
    if (data.length === 0) {
      return pending;
    }

    pending.push(...data);
    offset += data.length;
  }
}

async function main() {
  const supabase = createClient(requireEnv(URL_ENV), requireEnv(SERVICE_ROLE_KEY_ENV), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  requireEnv(OPENAI_KEY_ENV);

  console.log("Selecting notes with no embedding yet...");
  const rows = await selectAllPending(supabase);

  console.log(`Found ${rows.length} note(s) with embedding is null.`);
  if (rows.length === 0) {
    console.log("\nNothing to backfill. 0 found, 0 embedded, 0 skipped.");
    return;
  }

  const chunks = chunk(rows, BATCH_SIZE);
  let embedded = 0;
  let skipped = 0;

  for (const [chunkIndex, rowsInChunk] of chunks.entries()) {
    console.log(`Processing chunk ${chunkIndex + 1} of ${chunks.length} (${rowsInChunk.length} note(s))...`);

    const embeddings = await embedBatch(rowsInChunk.map((row) => row.content));
    if (embeddings === null) {
      console.log(`  Skipping chunk ${chunkIndex + 1}: ${rowsInChunk.map((row) => row.id).join(", ")}`);
      skipped += rowsInChunk.length;
      continue;
    }

    for (const [rowIndex, row] of rowsInChunk.entries()) {
      const { error: updateError } = await supabase
        .from("notes")
        .update({ embedding: embeddings[rowIndex] })
        .eq("id", row.id);

      // A failure to reach the database at all is fatal for this operation; a single row's update
      // failing this way is surfaced the same way a chunk-level OpenAI failure is -- logged and
      // skipped, never crashing the whole run.
      if (updateError) {
        console.log(`  Failed to write embedding for note ${row.id}: ${updateError.message}`);
        skipped++;
        continue;
      }
      embedded++;
    }
  }

  console.log(`\n${rows.length} found, ${embedded} embedded, ${skipped} skipped/left null.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(`\nBackfill failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
