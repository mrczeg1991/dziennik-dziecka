// Gate: a floor on how much each scope-reporting tool says it examined. Risk #7 of
// context/foundation/test-plan.md.
//
// What this does NOT catch is the case that sounds scariest: a tool that crashes. An ESLint
// internal rule throw already exits 2 with an "Oops! Something went wrong!" banner, and every
// total-empty-scope condition also exits 2 -- CI fails on those unaided. The silent case is
// *partial* shrinkage. `npx eslint . --ignore-pattern "src/**" -f json` examines 3 files instead
// of 38, exits 0, and prints zero bytes of human-visible output; one extra .gitignore line would
// take the lint gate green over most of the codebase. So the instrument here is a floor on
// reported scope, not an abort detector.
//
// The same instrument, applied to the test runner: a suite that ran 3 assertions instead of 35
// also exits 0 and also looks exactly like a green run, so the third counter floors the number of
// passing unit tests. context/foundation/lessons.md records the ESLint-scope ancestor of this
// reasoning -- floor the reported quantity, because the enforcing layer cannot be asked whether it
// really checked.
//
// Zero dependencies, same as scripts/smoke.mjs. Run it with: npm run gate:scope

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const EXPECTED = {
  // npx eslint . -f json  -> array length. Exact: ESLint's scope is .gitignore-driven and
  // deterministic, so any movement is a deliberate change to what is linted. Adding a linted
  // file must bump this in the same commit -- re-derive the number, never guess the delta.
  eslintFiles: { mode: "exact", value: 57 },
  // npx astro check -> "Result (N files):". Floor, not exact: @astrojs/check applies its own
  // ignore list rather than the raw tsconfig file set, so N can move without a code change. A
  // floor confines that to the one direction that matters -- shrinkage. It sits one above the
  // ESLint count rather than level with it: tsconfig.json includes .astro/types.d.ts, which astro
  // check counts and ESLint skips because .gitignore ignores .astro/.
  astroCheckFiles: { mode: "floor", value: 48 },
  // npx vitest run tests/unit --reporter=json -> numPassedTests. Floor, not exact: tests are added
  // far more often than removed, and an exact count would make every new test a two-file commit
  // for no gain -- the direction that matters is a suite quietly getting smaller. Re-derive this
  // whenever a unit-test file is added: left at its old value it stops catching the one thing it
  // is for. 97 passing tests across wall-clock.test.ts, date-range-parse.test.ts and
  // graded-vector.test.ts.
  unitTestsPassed: { mode: "floor", value: 97 },
};

function run(command) {
  // shell: true so the same string works for the npx shim on Windows and on the CI runner.
  const result = spawnSync(command, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { spawned: false, detail: `could not run: ${result.error.message}` };
  return { spawned: true, stdout: result.stdout ?? "", status: result.status };
}

// Only the JSON formatter reports ESLint's examined-file count: one object per examined file, so
// the array length is the number. Neither --debug nor --stats gives it. The exit code is
// deliberately not consulted -- exit 1 means "found lint problems", which `npm run lint` owns,
// and the count is still reported. Unparseable output is the failure, because that is what an
// aborted run looks like.
function countEslintFiles() {
  const command = "npx eslint . -f json";
  const { spawned, detail, stdout, status } = run(command);
  if (!spawned) return { command, count: null, detail };
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { command, count: null, detail: `stdout carried no parseable JSON (exit ${status})` };
  }
  if (!Array.isArray(parsed)) return { command, count: null, detail: `expected a JSON array (exit ${status})` };
  return { command, count: parsed.length, detail: null };
}

// astro check prints its own count as "Result (N files):". Exit code ignored for the same reason
// as above: a non-zero exit means it found diagnostics, which `npx astro check` owns as its own
// CI step, and the count is still on stdout. That line is emitted without ANSI colouring (every
// other line of the output is coloured), so it is matched raw; if a future version colours it the
// match fails and this gate reports "no count", which fails -- the safe direction.
function countAstroCheckFiles() {
  const command = "npx astro check";
  const { spawned, detail, stdout, status } = run(command);
  if (!spawned) return { command, count: null, detail };
  const match = stdout.match(/Result \((\d+) files?\):/);
  if (!match) return { command, count: null, detail: `stdout carried no "Result (N files):" line (exit ${status})` };
  return { command, count: Number(match[1]), detail: null };
}

// Three things differ from the two counters above, all three load-bearing:
//
//  1. The JSON reporter does not write to stdout. It needs --outputFile, and the file is read back;
//     a missing or unparseable file is a null count, i.e. a failure, which is also what a crashed
//     run looks like. The previous run's report is deleted first, so a crash can never be scored
//     against a stale file.
//  2. numPassedTests, not numTotalTests. A test converted to .todo or .skip still counts in the
//     total, so flooring the total would let a deletion hide behind a skip. numTotalTestSuites is
//     deliberately not floored as well: it counts describe blocks (6 for one file), so it would
//     fail on a harmless regrouping, and a whole file dropping out already takes its passing tests
//     with it.
//  3. The exit code is NOT ignored here. For ESLint and astro check a non-zero exit means "found
//     problems" and another gate owns those findings. Nothing else inside `npm run gates` runs the
//     unit suite, so a gate that shrugged at a failing run would let a red suite deploy. A run
//     reporting failures therefore reports no count at all.
//
// Unit only, deliberately: gate:scope runs inside `npm run gates`, which Cloudflare's build command
// calls, and that environment has no database. The integration suite is CI-only -- see the `smoke`
// job in .github/workflows/ci.yml. The cost is that gate:scope is now as slow as the unit suite,
// because --reporter=json still runs every test; that is accepted.
function countUnitTestsPassed() {
  // Inside .vitest/, which .gitignore already excludes -- an untracked, unignored report file would
  // move the eslintFiles count above between runs.
  const report = ".vitest/json/gate-scope.json";
  const command = `npx vitest run tests/unit --reporter=json --outputFile=${report}`;
  rmSync(report, { force: true });
  const { spawned, detail, status } = run(command);
  if (!spawned) return { command, count: null, detail };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(report, "utf8"));
  } catch (error) {
    return { command, count: null, detail: `${report} is missing or unparseable (exit ${status}): ${error.message}` };
  }
  if (typeof parsed.numPassedTests !== "number") {
    return { command, count: null, detail: `${report} carried no numPassedTests (exit ${status})` };
  }
  if (parsed.success !== true || parsed.numFailedTests > 0) {
    return {
      command,
      count: null,
      detail: `the suite itself failed -- ${parsed.numFailedTests} of ${parsed.numTotalTests} test(s) (exit ${status}); a failing run has no scope worth flooring`,
    };
  }
  return { command, count: parsed.numPassedTests, detail: null };
}

const SCOPE_HINT = "check .gitignore, eslint.config.js ignores and tsconfig includes for a newly excluded path.";

const GATES = [
  { key: "eslintFiles", label: "eslint examined files", measure: countEslintFiles, shrinkHint: SCOPE_HINT },
  {
    key: "astroCheckFiles",
    label: "astro check examined files",
    measure: countAstroCheckFiles,
    shrinkHint: SCOPE_HINT,
  },
  {
    key: "unitTestsPassed",
    label: "unit tests passed",
    measure: countUnitTestsPassed,
    shrinkHint:
      "check for a deleted or renamed test file, a test turned into .skip or .todo, and vitest.config.ts include/exclude changes.",
  },
];

let failed = 0;
for (const { key, label, measure, shrinkHint } of GATES) {
  const { mode, value } = EXPECTED[key];
  const { command, count, detail } = measure();

  // A run that reports no count is a failure, not a pass. Treating it as a pass would reproduce
  // the exact blindness this gate exists to remove.
  if (count === null) {
    failed++;
    console.log(`FAIL  ${label}  -> no count reported`);
    console.log(`      ${detail}`);
    console.log(`      a run that reports no count is a failure, not a pass; re-run: ${command}`);
    continue;
  }

  const ok = mode === "exact" ? count === value : count >= value;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}  -> ${count} (expected ${mode === "exact" ? "exactly" : "at least"} ${value})`,
  );
  if (!ok) {
    failed++;
    if (count < value) {
      console.log(
        `      scope shrank by ${value - count}: the gate ran, but over less of the repository than expected.`,
      );
      console.log(`      ${shrinkHint}`);
    } else {
      console.log(`      scope grew by ${count - value}, and EXPECTED.${key} is exact.`);
      console.log(`      if the new files are meant to be in scope, bump EXPECTED.${key} to ${count} in this commit.`);
    }
    console.log(`      re-derive with: ${command}`);
  }
}

console.log(
  failed ? `\n${failed} of ${GATES.length} scope gate(s) failed` : `\nAll ${GATES.length} scope gates passed`,
);
process.exit(failed ? 1 : 0);
