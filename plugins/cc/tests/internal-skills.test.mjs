import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["claude-cli-runtime", "claude-result-handling", "claude-prompting"]) {
  test(`${name} 存在且有 frontmatter name`, () => {
    const p = path.join(root, "skills", name, "SKILL.md");
    assert.ok(existsSync(p));
    const txt = readFileSync(p, "utf8");
    assert.match(txt, new RegExp(`name:\\s*${name}`));
  });
}

test("result-handling 含停下询问纪律", () => {
  const txt = readFileSync(path.join(root, "skills", "claude-result-handling", "SKILL.md"), "utf8");
  assert.match(txt.toLowerCase(), /stop|ask the user|do not (fix|modify)/);
});
