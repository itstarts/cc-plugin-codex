import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPromptTemplate, interpolateTemplate } from "../../scripts/lib/prompts.mjs";

test("loadPromptTemplate reads prompts by name", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-prompts-"));
  mkdirSync(path.join(dir, "prompts"));
  writeFileSync(path.join(dir, "prompts", "sample.md"), "Hello {{NAME}}\n");
  assert.equal(loadPromptTemplate(dir, "sample"), "Hello {{NAME}}\n");
});

test("interpolateTemplate replaces known variables and leaves no marker", () => {
  const out = interpolateTemplate("A={{A}}\nB={{B}}\n", { A: "one", B: "two" });
  assert.equal(out, "A=one\nB=two\n");
  assert.ok(!out.includes("{{"));
});

test("interpolateTemplate throws when a variable is missing", () => {
  assert.throws(() => interpolateTemplate("A={{A}} B={{B}}", { A: "one" }), /Missing template value: B/);
});
