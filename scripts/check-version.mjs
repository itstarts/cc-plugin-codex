#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const TARGETS = [
  {
    file: "package.json",
    label: "version",
    get: (json) => json.version,
    set: (json, version) => { json.version = version; },
  },
  {
    file: "plugins/cc/.codex-plugin/plugin.json",
    label: "version",
    get: (json) => json.version,
    set: (json, version) => { json.version = version; },
  },
];

function usage() {
  return [
    "Usage:",
    "  node scripts/check-version.mjs --check [version]",
    "  node scripts/check-version.mjs <version>",
    "  node scripts/check-version.mjs --help",
    "",
    "Options:",
    "  --check       Verify version metadata. Uses package.json when version is omitted.",
    "  --root <dir>  Run against another repository root.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { check: false, root: process.cwd(), version: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--root") {
      const root = argv[i + 1];
      if (!root) throw new Error("--root requires a directory.");
      options.root = root;
      i += 1;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.version) throw new Error(`Unexpected extra argument: ${arg}`);
    else options.version = arg;
  }
  options.root = path.resolve(options.root);
  return options;
}

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function writeJson(root, file, json) {
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(json, null, 2)}\n`);
}

function validateVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Expected a semver-like version such as 1.0.3, got: ${version}`);
  }
}

function packageVersion(root) {
  const version = readJson(root, "package.json").version;
  if (typeof version !== "string") throw new Error("package.json version must be a string.");
  validateVersion(version);
  return version;
}

function checkVersions(root, expectedVersion) {
  const mismatches = [];
  for (const target of TARGETS) {
    const actual = target.get(readJson(root, target.file));
    if (actual !== expectedVersion) {
      mismatches.push(`${target.file} ${target.label}: expected ${expectedVersion}, found ${actual ?? "<missing>"}`);
    }
  }
  return mismatches;
}

function setVersions(root, version) {
  const changed = [];
  for (const target of TARGETS) {
    const json = readJson(root, target.file);
    const before = JSON.stringify(json);
    target.set(json, version);
    if (JSON.stringify(json) !== before) {
      writeJson(root, target.file, json);
      changed.push(target.file);
    }
  }
  return changed;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const version = options.version ?? (options.check ? packageVersion(options.root) : null);
  if (!version) throw new Error(`Missing version.\n\n${usage()}`);
  validateVersion(version);
  if (options.check) {
    const mismatches = checkVersions(options.root, version);
    if (mismatches.length) throw new Error(`Version metadata is out of sync:\n${mismatches.join("\n")}`);
    console.log(`All version metadata matches ${version}.`);
    return;
  }
  const changed = setVersions(options.root, version);
  console.log(`Set version metadata to ${version}: ${changed.length ? changed.join(", ") : "no files changed"}.`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
