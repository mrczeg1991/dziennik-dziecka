// Measurement, not a gate: reports the cosine similarity of every question in a fixed set against
// every live note, so the value of `p_similarity_threshold` can be read off a table instead of
// guessed from the UI. Run manually, never as part of `npm run gates`:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... node scripts/measure-similarity.mjs
//
// READ-ONLY. It issues one GET against PostgREST and one POST per question against OpenAI, and
// writes nothing to the database or the repository. Nothing here may ever become a write: the
// whole point is that the corpus it measures stays exactly as `supabase/seed.sql` left it, so a
// re-run reproduces the same numbers.
//
// Zero added dependencies, same convention as scripts/backfill-embeddings.mjs: plain ESM,
// process.env read directly with no process.argv, explicit console.log reporting, explicit exit
// codes. PostgREST is called over plain `fetch` rather than through @supabase/supabase-js because
// one select needs no client.
//
// Service-role key, deliberately, for the same reason backfill-embeddings.mjs uses one: this is an
// offline measurement run by the sole account owner, and it must see the whole seeded corpus
// across both children in one pass, which a session-scoped client's RLS would never allow.
//
// REPRODUCIBILITY is the contract. The question set, each question's expected note and the
// threshold under test are constants in this file; the corpus is `supabase/seed.sql`. Change
// either and the measurement is a different measurement -- so change them in a commit that says so.

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
// Identical to src/lib/embeddings.ts:3-4 -- same endpoint, same model, no `dimensions` parameter,
// so the question vectors measured here are the ones production would compute. 1536 dimensions
// native, matching `notes.embedding extensions.vector(1536)`.
const EMBEDDING_MODEL = "text-embedding-3-small";
// Same reason as backfill-embeddings.mjs's timeout rather than src/lib/embeddings.ts's 5s: a stall
// never rejects, and nobody is waiting on this run.
const REQUEST_TIMEOUT_MS = 30_000;

// The live default of `p_similarity_threshold`, from
// supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql. No caller
// overrides it (src/lib/search.ts:33-39 sends five of eight parameters), so this constant is the
// whole of what the vector arm gates on today. When a later migration changes the default, change
// it here in the same commit -- otherwise this script keeps marking a threshold nothing enforces.
//
// It was 0.5 while this script was being written and while the measurement that chose 0.434 ran:
// the two runs recorded in change.md `## Pomiar` were taken against 0.5, with no constant touched
// mid-measurement, and 0.434 is what came out of them.
const CURRENT_THRESHOLD = 0.434;
// Half-width of the "too close to call" band reported at the end. A value inside
// CURRENT_THRESHOLD +/- this is one that a small change to either the question or the note would
// push across the boundary, so a threshold with many of them in it is a threshold chosen on noise.
const BAND_HALF_WIDTH = 0.06;

// `supabase/config.toml` sets `[api] max_rows = 1000`, and PostgREST truncates at it without
// saying so. The seeded corpus is 26 notes, so this is purely a tripwire: receiving exactly this
// many rows means the select may have been cut short and the "every note" claim is false.
const POSTGREST_MAX_ROWS = 1000;

const URL_ENV = "SUPABASE_URL";
const SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";
const OPENAI_KEY_ENV = "OPENAI_API_KEY";

// How many note columns one printed block carries. 26 seeded notes in blocks of 13 keeps each row
// inside a readable width; the whole matrix is still printed, just stacked.
const NOTES_PER_BLOCK = 13;
const QUESTION_COLUMN_WIDTH = 40;
const CELL_WIDTH = 6;

// The question set. `expect` names the note (the last four characters of its seeded uuid, which is
// also the N-label's suffix below) that a parent would call the right answer, or null when the
// corpus deliberately answers the question with nothing.
//
// What each row is isolating:
//   * inflected vs. base form of the same noun ("Nurofenu" / "Nurofen"), which is the failure that
//     started this change -- `to_tsvector('simple', ...)` does no Polish stemming, so the vector
//     arm is the only arm that can match an inflected form, and the threshold decides whether it
//     is allowed to;
//   * a bare keyword vs. a full sentence, which changes the question vector far more than it
//     changes a human's reading of it;
//   * with and without a period phrase `src/lib/date-range-parse.ts` recognizes ("w lipcu",
//     "dzisiaj", "w zeszłym tygodniu", "w zeszłym miesiącu"), because the phrase is embedded along
//     with the rest of the question today and dilutes it;
//   * medication names and numbers, the tokens a parent actually searches for;
//   * questions nothing answers, without which the table shows only a true-positive band and the
//     threshold has no upper constraint at all.
//
// `expect` is a semantic expectation, not a prediction of the UI. This script measures cosine
// similarity only -- it applies no date window and no `p_child_id` filter -- so a question with a
// period phrase is expected to match the note that answers it even when that note falls outside
// the phrase's own window. Where the two differ, the comment says so.
const QUESTIONS = [
  { text: "Czy dostawał Nurofenu w lipcu?", expect: "a010", note: "odmiana + fraza okresu" },
  { text: "Czy dostawał Nurofen w lipcu?", expect: "a010", note: "forma podstawowa + fraza okresu" },
  { text: "Czy dostawał Nurofenu?", expect: "a010", note: "odmiana, bez frazy" },
  { text: "Czy dostawał Nurofen?", expect: "a010", note: "forma podstawowa, bez frazy" },
  { text: "Nurofenu", expect: "a010", note: "samo słowo, odmiana" },
  { text: "Nurofen", expect: "a010", note: "samo słowo, forma podstawowa" },
  { text: "Jaka była najwyższa gorączka?", expect: "a010", note: "pełne zdanie, liczba w notatce" },
  { text: "gorączka", expect: "a010", note: "samo słowo, kontrola dla zdania wyżej" },
  { text: "Czy brała antybiotyk?", expect: "a008", note: "kategoria leku, nie nazwa" },
  { text: "Augmentin", expect: "a008", note: "dokładna nazwa leku" },
  { text: "Kiedy było szczepienie w marcu?", expect: "a005", note: "fraza okresu + szczepienie" },
  { text: "Co z uchem?", expect: "b008", note: "krótkie, eliptyczne pytanie" },
  { text: "Czy uderzył się w głowę?", expect: "b012", note: "inne słowa niż w notatce" },
  { text: "Ile waży?", expect: "b002", note: "liczba, jednostka w notatce" },
  // Recognized period phrases whose own window holds nothing. Semantically the corpus still has a
  // best answer for the dentist question (06.10, outside "w zeszłym tygodniu"); "dzisiaj" has
  // none at all, because no seeded note carries today's date.
  { text: "Czy dzisiaj coś się działo?", expect: null, note: "fraza okresu, brak notatki z dzisiaj" },
  { text: "Czy był u dentysty w zeszłym tygodniu?", expect: "a014", note: "fraza okresu poza okresem notatki" },
  // True negatives: nothing in the corpus answers either one, so every value in these rows is a
  // ceiling the threshold must sit above.
  { text: "Czy ma uczulenie na orzeszki?", expect: null, note: "brak odpowiedzi w korpusie" },
  { text: "Kiedy był pierwszy raz w kinie?", expect: null, note: "brak odpowiedzi w korpusie" },
];

// Absent credentials fail, they do not skip -- mirrors backfill-embeddings.mjs's requireEnv. A run
// that silently no-opped here would print an empty table and exit 0, and nothing on screen would
// say the measurement never happened.
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      [
        `${name} is not set, so this script has no credentials to run with.`,
        "Absent credentials fail, they do not skip -- a run that silently no-ops here would exit 0",
        "having measured nothing. Set all three required variables:",
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

// PostgREST renders a `vector` column as a JSON string ("[0.1,0.2,...]") on some versions and as a
// real array on others, so both shapes are accepted rather than assumed.
function toVector(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

// Ordered by occurrence then id, never by the database's own row order: the N-labels have to mean
// the same note between two runs for "the same numbers" to be checkable at all.
async function fetchNotes(baseUrl, serviceRoleKey) {
  const query = new URLSearchParams({
    select: "id,child_id,content,occurred_at,embedding",
    deleted_at: "is.null",
    order: "occurred_at.asc,id.asc",
    limit: String(POSTGREST_MAX_ROWS),
  });

  const response = await fetch(`${baseUrl}/rest/v1/notes?${query.toString()}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`PostgREST returned ${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("PostgREST did not return an array of notes.");
  }
  if (rows.length === POSTGREST_MAX_ROWS) {
    throw new Error(
      `PostgREST returned exactly ${POSTGREST_MAX_ROWS} rows, which is its max_rows cap -- the select may have been` +
        " truncated, so this run cannot claim to have measured every note.",
    );
  }
  return rows;
}

// Single-input form of backfill-embeddings.mjs's embedBatch, and the same request shape as
// src/lib/embeddings.ts. Unlike either, a failure here is fatal: a question silently dropped from
// the table would leave a gap a reader would mistake for a low score.
async function embedQuestion(text) {
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env[OPENAI_KEY_ENV]}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const body = await response.json();
  const embedding = body.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`OpenAI returned no embedding for ${JSON.stringify(text)}.`);
  }
  return embedding;
}

// Cosine, not the inner product: `search_notes` ranks with pgvector's `<=>` (cosine distance) and
// compares `1 - distance` against the threshold, so cosine similarity is exactly the quantity the
// threshold gates on. Both vectors are normalized here rather than assumed to be unit length.
function cosine(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Cannot compare vectors of ${a.length} and ${b.length} dimensions.`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ".812" rather than "0.812": three decimals are the resolution that matters, and dropping the
// leading zero is what lets 13 columns fit on one line.
function formatSimilarity(value) {
  return value.toFixed(3).replace(/^(-?)0\./, "$1.");
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function truncate(text, width) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

function printNoteLegend(notes) {
  console.log(`\nNotes measured (${notes.length}), ordered by occurrence:`);
  for (const note of notes) {
    console.log(`  ${pad(note.label, 6)} ${note.date}  ${pad(note.child, 4)} ${truncate(note.content, 66)}`);
  }
}

// One block per NOTES_PER_BLOCK notes. The matrix is printed whole; it is the columns that are
// stacked, so no value is omitted.
function printMatrix(notes, measurements) {
  for (let start = 0; start < notes.length; start += NOTES_PER_BLOCK) {
    const block = notes.slice(start, start + NOTES_PER_BLOCK);
    const header = pad(`question  (${block[0].label}..${block[block.length - 1].label})`, QUESTION_COLUMN_WIDTH);
    const columns = block.map((note) => pad(note.label, CELL_WIDTH)).join("");
    console.log(`\n${header}${columns}`);
    console.log("-".repeat(QUESTION_COLUMN_WIDTH + block.length * CELL_WIDTH));

    for (const measurement of measurements) {
      const cells = block
        .map((note) => {
          const value = measurement.similarityByLabel[note.label];
          const marked = `${formatSimilarity(value)}${value >= CURRENT_THRESHOLD ? "*" : " "}`;
          return pad(marked, CELL_WIDTH);
        })
        .join("");
      console.log(
        `${pad(truncate(measurement.question.text, QUESTION_COLUMN_WIDTH - 1), QUESTION_COLUMN_WIDTH)}${cells}`,
      );
    }
  }
  console.log(`\n* = at or above the current threshold ${CURRENT_THRESHOLD}`);
  // The flag is computed from the full-precision value, the cell is rounded to three decimals, so
  // an unflagged ".500" is a value just below the threshold rather than a bug in the marking.
  console.log("  (the flag reads the full-precision value; an unflagged .500 sits just under it)");
}

// The band summary, which is what the threshold is actually chosen from: for each question, how
// the note that should answer it scored against the best-scoring note in the whole corpus. A
// question whose expected note sits below the threshold while something irrelevant sits above it
// is the failure this change exists to remove.
function printBands(measurements) {
  console.log("\nPer-question bands:");
  console.log(
    `${pad("question", QUESTION_COLUMN_WIDTH)}${pad("expected", 10)}${pad("sim", 8)}${pad("best", 10)}${pad("sim", 8)}${pad(`>=${CURRENT_THRESHOLD}`, 7)}what it isolates`,
  );
  console.log("-".repeat(QUESTION_COLUMN_WIDTH + 43 + 24));

  for (const measurement of measurements) {
    const { question, similarityByLabel, best, expectedSimilarity, clearing } = measurement;
    const expectedCell = question.expect ?? "(none)";
    const expectedSim = expectedSimilarity === null ? "  -  " : formatSimilarity(expectedSimilarity);
    const flag = question.expect !== null && expectedSimilarity < CURRENT_THRESHOLD ? " <- below" : "";
    console.log(
      [
        pad(truncate(question.text, QUESTION_COLUMN_WIDTH - 1), QUESTION_COLUMN_WIDTH),
        pad(expectedCell, 10),
        pad(expectedSim, 8),
        pad(best.label, 10),
        pad(formatSimilarity(best.similarity), 8),
        pad(`${clearing}/${Object.keys(similarityByLabel).length}`, 7),
        question.note,
        flag,
      ].join(""),
    );
  }
  console.log("\n'expected' is the note a parent would call the right answer; '(none)' means the corpus has none.");
  console.log("'<- below' marks an expected note the current threshold would drop -- a false negative.");
}

async function main() {
  const baseUrl = requireEnv(URL_ENV);
  const serviceRoleKey = requireEnv(SERVICE_ROLE_KEY_ENV);
  requireEnv(OPENAI_KEY_ENV);

  console.log(`Reading live notes from ${baseUrl}/rest/v1/notes ...`);
  const rows = await fetchNotes(baseUrl, serviceRoleKey);

  const notes = rows
    .filter((row) => row.embedding !== null && row.embedding !== undefined)
    .map((row) => ({
      // Last four characters of the seeded uuid: "a010" reads back to
      // `5eed0000-0000-0000-0000-00000000a010` in supabase/seed.sql without a lookup table.
      label: String(row.id).slice(-4),
      child: String(row.child_id).slice(-2),
      date: String(row.occurred_at).slice(0, 10),
      content: String(row.content),
      vector: toVector(row.embedding),
    }));

  console.log(`${rows.length} live note(s), ${notes.length} with an embedding.`);
  if (notes.length === 0) {
    throw new Error(
      "No live note carries an embedding, so there is nothing to measure. Run `npm run backfill:embeddings`" +
        " after `npx supabase db reset` and try again.",
    );
  }
  if (notes.length < rows.length) {
    console.log(
      `WARNING: ${rows.length - notes.length} note(s) have no embedding and are excluded from the table below.` +
        " Run `npm run backfill:embeddings` for a complete measurement.",
    );
  }

  const measurements = [];
  const everyValue = [];

  for (const question of QUESTIONS) {
    const questionVector = await embedQuestion(question.text);

    const similarityByLabel = {};
    let best = { label: notes[0].label, similarity: -Infinity };
    let clearing = 0;

    for (const note of notes) {
      const similarity = cosine(questionVector, note.vector);
      similarityByLabel[note.label] = similarity;
      everyValue.push(similarity);
      if (similarity >= CURRENT_THRESHOLD) {
        clearing++;
      }
      if (similarity > best.similarity) {
        best = { label: note.label, similarity };
      }
    }

    if (question.expect !== null && !(question.expect in similarityByLabel)) {
      throw new Error(
        `Question ${JSON.stringify(question.text)} expects note ${question.expect}, which is not among the live` +
          " notes. Either the corpus changed or the question set is stale -- fix one of them, do not ignore this.",
      );
    }

    measurements.push({
      question,
      similarityByLabel,
      best,
      expectedSimilarity: question.expect === null ? null : similarityByLabel[question.expect],
      clearing,
    });
  }

  printNoteLegend(notes);
  console.log(
    `\nMeasuring ${QUESTIONS.length} question(s) x ${notes.length} note(s) against the live threshold ${CURRENT_THRESHOLD}.`,
  );
  printMatrix(notes, measurements);
  printBands(measurements);

  const min = Math.min(...everyValue);
  const max = Math.max(...everyValue);
  const bandLow = CURRENT_THRESHOLD - BAND_HALF_WIDTH;
  const bandHigh = CURRENT_THRESHOLD + BAND_HALF_WIDTH;
  const inBand = everyValue.filter((value) => value > bandLow && value < bandHigh).length;

  console.log(
    `\nObserved range across all ${everyValue.length} value(s): ${formatSimilarity(min)} .. ${formatSimilarity(max)}` +
      ` (spread ${formatSimilarity(max - min)}).`,
  );
  console.log(
    `Values inside ${bandLow.toFixed(2)}..${bandHigh.toFixed(2)} (the current threshold +/-${BAND_HALF_WIDTH}):` +
      ` ${inBand} of ${everyValue.length}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(`\nMeasurement failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
