// Gate: no secret reaches what Cloudflare serves, and the served asset root stays the one that
// was audited. Risk #6 of context/foundation/test-plan.md.
//
// Two corrections to what §2 assumed, both established by research:
//
//  1. The secret scan is pure regression protection. Secrets cannot reach the client bundle by
//     construction -- `astro:env/server` is a virtual module Astro refuses to resolve in a client
//     bundle, so a client-reachable import is a build failure, not a leak. Measured against the
//     build on disk, the secret values appear nowhere under dist/client. This gate keeps it that
//     way; it is not closing an open hole.
//  2. §2 pairs the secret scan with "no note body in the build output". That half is vacuous
//     here: astro.config.mjs sets output: "server", nothing exports `prerender`, and the build
//     emits zero .html files, so no note content can be baked in. Scanning for it would be
//     ceremony. This gate is scoped to secrets only.
//
// The real hole was a config contradiction: wrangler.jsonc declared "./dist" as the asset root
// while the generated dist/server/wrangler.json declared "../client". dist/server holds .dev.vars
// with both secret values in plaintext, and .assetsignore exists only under dist/client -- so if
// "./dist" ever governed, both secrets were fetchable at /server/.dev.vars. The asset-root
// assertions below are what keep that settled.
//
// Runs after `npm run build`, which is why it sits in the post-build half of `npm run gates`.
//
// Zero dependencies, same as scripts/smoke.mjs. Run it with: npm run gate:build-output

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CHECKED_IN_CONFIG = "wrangler.jsonc";
const GENERATED_CONFIG = "dist/server/wrangler.json";
const EXPECTED_ASSET_ROOT = "dist/client";
const ASSETS_IGNORE = `${EXPECTED_ASSET_ROOT}/.assetsignore`;
// Server-side build artifacts that must never be served. .assetsignore has to exclude each one,
// and none of them may carry a secret into the asset root.
const MUST_BE_IGNORED = ["_worker.js", "_routes.json", "wrangler.json", ".dev.vars"];
const SECRET_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_KEY"];
// A Supabase anon key is a JWT, so its shape is recognisable without knowing the value.
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]{10,}/;

const failures = [];
const notes = [];

// wrangler.jsonc is JSONC: comments and trailing commas are legal and this project uses trailing
// commas. Stripping them with a regex would corrupt any string containing "//" or a comma before a
// brace, so the scan is string-aware instead.
function parseJsonc(source) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += char;
  }
  // Trailing commas, now that every comma inside a string is accounted for.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// An asset directory is relative to the config file that declares it, so "../client" in
// dist/server/wrangler.json and "./dist/client" in wrangler.jsonc must resolve to the same place.
function resolveAssetRoot(configPath) {
  if (!existsSync(configPath)) return { error: `${configPath} does not exist` };
  let config;
  try {
    config = parseJsonc(readFileSync(configPath, "utf8"));
  } catch (error) {
    return { error: `${configPath} is not parseable (${error.message})` };
  }
  const directory = config.assets?.directory;
  if (typeof directory !== "string") return { error: `${configPath} declares no assets.directory` };
  const absolute = path.resolve(path.dirname(path.resolve(configPath)), directory);
  return { root: path.relative(process.cwd(), absolute).split(path.sep).join("/") };
}

function walk(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(`${dir}/${entry.name}`, relative));
    else found.push(relative);
  }
  return found;
}

// ---- Asset-root invariant -------------------------------------------------------------------

// Both configs are checked, not just one. Research could not establish which governs at deploy
// time, so the gate requires them to agree -- which makes the question moot rather than answered.
for (const configPath of [CHECKED_IN_CONFIG, GENERATED_CONFIG]) {
  const { root, error } = resolveAssetRoot(configPath);
  if (error) {
    failures.push(`asset root: ${error}`);
  } else if (root !== EXPECTED_ASSET_ROOT) {
    failures.push(
      `asset root: ${configPath} resolves assets.directory to "${root}", expected "${EXPECTED_ASSET_ROOT}" -- a root above dist/client would serve dist/server/.dev.vars`,
    );
  }
}

if (!existsSync(EXPECTED_ASSET_ROOT)) {
  failures.push(`asset root: ${EXPECTED_ASSET_ROOT} does not exist -- run npm run build first`);
}

// A missing or unreadable .assetsignore is a failure, not a skip: without it every server-side
// artifact under the root becomes servable.
let ignoreEntries = null;
if (!existsSync(ASSETS_IGNORE)) {
  failures.push(`${ASSETS_IGNORE} does not exist -- without it the server build artifacts are servable`);
} else {
  try {
    ignoreEntries = readFileSync(ASSETS_IGNORE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  } catch (error) {
    failures.push(`${ASSETS_IGNORE} is unreadable (${error.message})`);
  }
}

if (ignoreEntries !== null) {
  for (const name of MUST_BE_IGNORED) {
    if (!ignoreEntries.includes(name)) {
      failures.push(`${ASSETS_IGNORE} does not list "${name}" -- it would be served from the asset root`);
    }
  }
}

// ---- Secret scan over the resolved asset root ------------------------------------------------

// Deliberately NOT filtered through .assetsignore. A secret file physically sitting in the served
// directory is a finding even when an ignore line currently excludes it, because that line is one
// edit away from removal. The invariant above is what asserts the line is present; this is the
// second layer.
const configuredSecrets = SECRET_ENV_KEYS.map((key) => ({ key, value: process.env[key] })).filter(
  ({ value }) => typeof value === "string" && value !== "",
);

if (configuredSecrets.length === 0) {
  notes.push(
    `no ${SECRET_ENV_KEYS.join("/")} in the environment, so the exact-value scan did not run; the JWT-shape and identifier scans did`,
  );
} else if (configuredSecrets.length < SECRET_ENV_KEYS.length) {
  notes.push(
    `only ${configuredSecrets.map(({ key }) => key).join(", ")} was in the environment for the exact-value scan`,
  );
}

if (existsSync(EXPECTED_ASSET_ROOT)) {
  for (const relative of walk(EXPECTED_ASSET_ROOT)) {
    const file = `${EXPECTED_ASSET_ROOT}/${relative}`;
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch (error) {
      failures.push(`secret scan: could not read ${file} (${error.message})`);
      continue;
    }
    for (const { key, value } of configuredSecrets) {
      if (contents.includes(value)) failures.push(`secret scan: ${file} contains the ${key} value`);
    }
    if (JWT_SHAPED.test(contents)) failures.push(`secret scan: ${file} contains a JWT-shaped string (eyJ...)`);
    for (const key of SECRET_ENV_KEYS) {
      if (contents.includes(key)) failures.push(`secret scan: ${file} mentions the ${key} identifier`);
    }
  }
}

// ---- Report -----------------------------------------------------------------------------------

for (const note of notes) console.log(`NOTE  ${note}`);
if (failures.length === 0) {
  const served = existsSync(EXPECTED_ASSET_ROOT) ? walk(EXPECTED_ASSET_ROOT).length : 0;
  console.log(
    `PASS  asset root is ${EXPECTED_ASSET_ROOT} in both configs, with ${MUST_BE_IGNORED.length} artifact(s) ignored`,
  );
  console.log(
    `PASS  no secret value, JWT-shaped string or secret identifier under ${EXPECTED_ASSET_ROOT} (${served} file(s) scanned)`,
  );
  console.log("\nBuild output is clean");
  process.exit(0);
}

for (const failure of failures) console.log(`FAIL  ${failure}`);
console.log(`\n${failures.length} build-output problem(s)`);
process.exit(1);
