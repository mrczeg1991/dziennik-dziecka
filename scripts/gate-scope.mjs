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
// Zero dependencies, same as scripts/smoke.mjs. Run it with: npm run gate:scope

import { spawnSync } from "node:child_process";

const EXPECTED = {
  // npx eslint . -f json  -> array length. Exact: ESLint's scope is .gitignore-driven and
  // deterministic, so any movement is a deliberate change to what is linted. Adding a linted
  // file must bump this in the same commit -- re-derive the number, never guess the delta.
  eslintFiles: { mode: "exact", value: 40 },
  // npx astro check -> "Result (N files):". Floor, not exact: @astrojs/check applies its own
  // ignore list rather than the raw tsconfig file set, so N can move without a code change. A
  // floor confines that to the one direction that matters -- shrinkage. The 38-vs-38 agreement
  // with ESLint is coincidental: tsconfig.json includes .astro/types.d.ts, which astro check
  // counts and ESLint skips because .gitignore ignores .astro/.
  astroCheckFiles: { mode: "floor", value: 38 },
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

const GATES = [
  { key: "eslintFiles", label: "eslint examined files", measure: countEslintFiles },
  { key: "astroCheckFiles", label: "astro check examined files", measure: countAstroCheckFiles },
];

let failed = 0;
for (const { key, label, measure } of GATES) {
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
      console.log(`      check .gitignore, eslint.config.js ignores and tsconfig includes for a newly excluded path.`);
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
