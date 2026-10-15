// Gate: the migrations committed to this repository are the migrations applied to the hosted
// project. Risk #3 of context/foundation/test-plan.md.
//
// The failure mode this catches is HTTP 200, which is why nothing noticed it before. With `notes`
// missing, src/lib/notes.ts throws, src/pages/children/[id].astro catches into `listFailed`, and
// the page returns 200 with a Polish "could not load" banner -- which scripts/smoke.mjs accepts.
// A green CI run says nothing about the hosted schema: the smoke job's `supabase start` applies
// every file in supabase/migrations/ to a fresh container, so repo-vs-database agreement there is
// true by construction. It describes a database built from the repo seconds earlier, not the
// hosted one.
//
// Both migrations were pushed by hand, ticked as a manual checkbox in two archived plans. This is
// the mechanism that replaces the checkbox.
//
// Zero dependencies, same as scripts/smoke.mjs. Run it with: npm run gate:drift

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
// Supabase names migrations <14-digit timestamp>_<label>.sql and keys schema_migrations on that
// timestamp, so the prefix is the version.
const VERSION_PREFIX = /^(\d{14})_.*\.sql$/;
const REF_ENV = "SUPABASE_PROJECT_REF";
const PASSWORD_ENV = "SUPABASE_DB_PASSWORD";
// The ref and the password address the project and open its database; neither authenticates the
// CLI to the platform API that `migration list` actually calls. Observed 2026-10-15 in the
// scheduled CI sweep: with the first two set and this one absent, the CLI exits having printed
// {"_tag":"Error","error":{"code":"LegacyPlatformAuthRequiredError",...}} -- caught by the shape
// check far below, but reported there as an unreadable verdict rather than as a missing secret.
// It is a credential, so it belongs in the precheck with the other two.
const ACCESS_TOKEN_ENV = "SUPABASE_ACCESS_TOKEN";

function fail(lines) {
  for (const line of lines) console.log(line);
  process.exit(1);
}

// Absent credentials are a FAILURE, not a skip. A drift gate that silently no-ops when a secret is
// missing is Risk #7 wearing Risk #3's clothes -- it would report green from the deploy path while
// checking nothing at all.
const projectRef = process.env[REF_ENV];
const dbPassword = process.env[PASSWORD_ENV];
const accessToken = process.env[ACCESS_TOKEN_ENV];
const missing = [
  ...(projectRef ? [] : [REF_ENV]),
  ...(dbPassword ? [] : [PASSWORD_ENV]),
  ...(accessToken ? [] : [ACCESS_TOKEN_ENV]),
];
if (missing.length > 0) {
  fail([
    `FAIL  migration drift: ${missing.length === 1 ? `${missing[0]} is` : `${missing.join(", ")} are`} not set`,
    `      this is a failure, not a skip: a drift gate that no-ops on a missing secret reports`,
    `      green from the deploy path while checking nothing.`,
    `      set all three and re-run, or remove this gate from the deploy path deliberately.`,
    `      ${ACCESS_TOKEN_ENV} is a personal access token from the Supabase dashboard; the CLI`,
    `      reads it from the environment, so nothing is passed on the command line.`,
    `\n1 migration-drift problem(s)`,
  ]);
}

// Local versions come from the filesystem rather than the CLI's own "local" column -- it is the
// authoritative answer and it keeps this gate dependent on the CLI for one thing only: what the
// hosted project has applied.
let localVersions;
try {
  localVersions = readdirSync(MIGRATIONS_DIR)
    .map((name) => VERSION_PREFIX.exec(name)?.[1])
    .filter((version) => version !== undefined)
    .sort();
} catch (error) {
  fail([
    `FAIL  migration drift: could not read ${MIGRATIONS_DIR} (${error.message})`,
    `\n1 migration-drift problem(s)`,
  ]);
}

if (localVersions.length === 0) {
  fail([
    `FAIL  migration drift: no migration files under ${MIGRATIONS_DIR}`,
    `      an empty local set would make every comparison below vacuously true.`,
    `\n1 migration-drift problem(s)`,
  ]);
}

// No shell: the password goes straight into argv rather than through a shell string, so nothing
// can interpolate or log it. (It is still visible to `ps` on the same host for the duration of the
// call -- accepted, since the alternative the CLI offers is a prompt, and a prompt hangs a build.)
// --yes for the same reason.
//
// The CLI is invoked as a Node script rather than through `npx`. On Windows `npx` is a .cmd shim,
// and since Node 18.20 (CVE-2024-27980) spawning a .cmd without `shell: true` throws EINVAL -- so
// `npx` here would mean either a shell string carrying the password, or a gate that only runs on
// Linux. The bin path comes from the installed package's own manifest, so it survives the package
// reorganising its dist layout, and the version is pinned by package-lock.json.
let supabaseBin;
try {
  const resolve = createRequire(import.meta.url);
  const manifestPath = resolve.resolve("supabase/package.json");
  supabaseBin = path.join(path.dirname(manifestPath), resolve(manifestPath).bin.supabase);
} catch (error) {
  fail([
    `FAIL  migration drift: could not locate the Supabase CLI (${error.message})`,
    `      it is a devDependency -- run npm ci`,
    `\n1 migration-drift problem(s)`,
  ]);
}

const args = [
  supabaseBin,
  "migration",
  "list",
  "--project-ref",
  projectRef,
  "--password",
  dbPassword,
  "--output-format",
  "json",
  "--yes",
];
const redactedCommand = `supabase migration list --project-ref ${projectRef} --password *** --output-format json --yes`;

const result = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (result.error) {
  fail([
    `FAIL  migration drift: could not run the Supabase CLI (${result.error.message})`,
    `      command: ${redactedCommand}`,
    `\n1 migration-drift problem(s)`,
  ]);
}

// The exit code is deliberately NOT consulted. Whether the CLI exits non-zero on divergence was
// never established, so trusting it could read a reported divergence as success. The verdict comes
// from the parsed payload; a payload we cannot parse is itself a failure.
const stdout = result.stdout ?? "";
const jsonStart = stdout.search(/[[{]/);
let payload;
try {
  if (jsonStart === -1) throw new Error("no JSON found on stdout");
  payload = JSON.parse(stdout.slice(jsonStart));
} catch (error) {
  fail([
    `FAIL  migration drift: could not parse the CLI's JSON output (${error.message})`,
    `      exit code was ${result.status}, which this gate does not trust either way.`,
    `      command: ${redactedCommand}`,
    `      stdout: ${JSON.stringify(stdout.slice(0, 400))}`,
    `      stderr: ${JSON.stringify((result.stderr ?? "").slice(0, 400))}`,
    `\n1 migration-drift problem(s)`,
  ]);
}

// The CLI reports its own failures as {"_tag":"Error","error":{"code","message"}} on stdout. That
// is a well-formed answer to a question the gate never got to ask, not an unrecognised shape, and
// saying so is the difference between "fix the secret" and "the CLI's JSON changed".
if (payload !== null && typeof payload === "object" && payload._tag === "Error") {
  fail([
    `FAIL  migration drift: the Supabase CLI refused the request`,
    `      code: ${payload.error?.code ?? "(none reported)"}`,
    `      message: ${payload.error?.message ?? "(none reported)"}`,
    `      command: ${redactedCommand}`,
    `      no verdict was obtained, so this gate fails rather than reporting agreement.`,
    `\n1 migration-drift problem(s)`,
  ]);
}

// Measured against the hosted project on 2026-10-11 with CLI 2.117.0, the payload is an OBJECT:
//   {"migrations":[{"local":"...","remote":"...","time":"..."}],"message":"Migrations listed"}
// Not the bare array the text table's columns suggest. The array form is still accepted because
// this shape is undocumented and may change; an unrecognised one fails closed below.
const rows = Array.isArray(payload) ? payload : Array.isArray(payload.migrations) ? payload.migrations : null;
if (rows === null) {
  fail([
    `FAIL  migration drift: the CLI's JSON is not a recognised shape (expected an array of rows)`,
    `      refusing to guess: an unrecognised shape read as "no drift" is exactly the silent pass`,
    `      this gate exists to prevent.`,
    `      command: ${redactedCommand}`,
    `      parsed: ${JSON.stringify(payload).slice(0, 400)}`,
    `\n1 migration-drift problem(s)`,
  ]);
}

// Each row carries the remote-applied version under a "remote" key when the CLI has one for it.
// Confirmed 2026-10-11: rows are {local, remote, time}, so "remote" is the live key name.
// If not a single row exposes that key the shape has changed, and a set built from it would be
// empty -- which would read as "the hosted project has nothing", a false repo-ahead alarm rather
// than a false pass. Fail on the shape instead of reporting a drift that may not exist.
const REMOTE_KEYS = ["remote", "remote_version", "remoteVersion"];
const remoteKey = REMOTE_KEYS.find((key) => rows.some((row) => row !== null && typeof row === "object" && key in row));
if (remoteKey === undefined && rows.length > 0) {
  fail([
    `FAIL  migration drift: no row exposes a remote version key (tried ${REMOTE_KEYS.join(", ")})`,
    `      the CLI's JSON shape has changed; this gate will not infer a verdict from it.`,
    `      command: ${redactedCommand}`,
    `      first row: ${JSON.stringify(rows[0]).slice(0, 400)}`,
    `\n1 migration-drift problem(s)`,
  ]);
}

const remoteVersions = [
  ...new Set(
    rows
      .map((row) => (row !== null && typeof row === "object" ? row[remoteKey] : undefined))
      .filter((version) => typeof version === "string" && version.trim() !== "")
      .map((version) => version.trim()),
  ),
].sort();

const repoAhead = localVersions.filter((version) => !remoteVersions.includes(version));
const remoteAhead = remoteVersions.filter((version) => !localVersions.includes(version));

const problems = [];

// Repo-ahead is the direction that breaks a deploy: the code being shipped expects a table the
// hosted database does not have.
if (repoAhead.length > 0) {
  problems.push(
    `FAIL  repo is ahead of the hosted project: ${repoAhead.join(", ")}`,
    `      the deployed code would expect schema that is not there, and the symptom is HTTP 200`,
    `      with a "could not load" banner, which the smoke walk accepts.`,
    `      fix: npx supabase db push  (apply the migration before the code that needs it)`,
  );
}

// Remote-ahead is the direction a laptop `supabase db push` creates: the hosted project moved and
// the migration was never committed. Also a failure, but the fix is the opposite one.
if (remoteAhead.length > 0) {
  problems.push(
    `FAIL  hosted project is ahead of the repo: ${remoteAhead.join(", ")}`,
    `      someone applied a migration that was never committed, so the repo no longer describes`,
    `      the live schema and a fresh environment cannot be rebuilt from it.`,
    `      fix: commit the missing migration file -- do NOT push.`,
  );
}

console.log(`local  (${MIGRATIONS_DIR}): ${localVersions.join(", ")}`);
console.log(`remote (project ${projectRef}): ${remoteVersions.join(", ") || "(none applied)"}`);

if (problems.length === 0) {
  console.log(`\nPASS  migrations agree: ${localVersions.length} version(s) applied both sides`);
  process.exit(0);
}

for (const line of problems) console.log(line);
console.log(`\n${repoAhead.length + remoteAhead.length} diverging migration version(s)`);
process.exit(1);
