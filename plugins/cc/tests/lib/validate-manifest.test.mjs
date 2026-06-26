import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));

test("manifest 顶层必填字段", () => {
  assert.equal(manifest.name, "cc");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description?.length > 0);
  assert.ok(manifest.author?.name?.length > 0);
});

test("interface 必填字段齐全", () => {
  const i = manifest.interface;
  for (const f of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    assert.equal(typeof i[f], "string");
    assert.ok(i[f].trim().length > 0, `${f} 非空`);
  }
  assert.ok(Array.isArray(i.capabilities) && i.capabilities.every(c => typeof c === "string" && c.trim()));
  const prompts = i.defaultPrompt ?? i.default_prompt;
  assert.ok(Array.isArray(prompts) && prompts.length >= 1 && prompts.length <= 3);
  assert.ok(prompts.every(p => p.length <= 128));
});

test("禁止出现 hooks 字段（Codex 校验器拒绝）", () => {
  assert.equal("hooks" in manifest, false);
});
