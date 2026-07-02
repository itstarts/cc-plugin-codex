import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "check-version.mjs");

function makeFixture({ pkgVersion = "1.2.3", pluginVersion = "1.2.3" } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-version-"));
  mkdirSync(path.join(dir, "plugins", "cc", ".codex-plugin"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: pkgVersion }, null, 2) + "\n");
  writeFileSync(
    path.join(dir, "plugins", "cc", ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "cc", version: pluginVersion }, null, 2) + "\n",
  );
  return dir;
}

test("--check succeeds when package and plugin versions match", () => {
  const dir = makeFixture();
  const r = spawnSync("node", [script, "--check", "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All version metadata matches 1\.2\.3/);
});

test("--check fails when package and plugin versions differ", () => {
  const dir = makeFixture({ pkgVersion: "1.2.3", pluginVersion: "1.2.4" });
  const r = spawnSync("node", [script, "--check", "--root", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /plugins\/cc\/\.codex-plugin\/plugin\.json version: expected 1\.2\.3, found 1\.2\.4/);
});

test("setting a version writes both current version locations", () => {
  const dir = makeFixture({ pkgVersion: "1.2.3", pluginVersion: "1.2.3" });
  const r = spawnSync("node", [script, "2.0.0", "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(path.join(dir, "plugins", "cc", ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(pkg.version, "2.0.0");
  assert.equal(plugin.version, "2.0.0");
});

test("invalid semver exits non-zero", () => {
  const dir = makeFixture();
  const r = spawnSync("node", [script, "v2", "--root", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Expected a semver-like version/);
});
