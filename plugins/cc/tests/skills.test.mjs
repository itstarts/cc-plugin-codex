import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function frontmatter(p) {
  const txt = readFileSync(p, "utf8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${p} 缺少 frontmatter`);
  return { raw: txt, fm: m[1] };
}

for (const name of ["review", "delegate", "adversarial-review"]) {
  test(`${name} skill 存在且 frontmatter 含 name/description`, () => {
    const p = path.join(root, "skills", name, "SKILL.md");
    assert.ok(existsSync(p), `${p} 不存在`);
    const { fm } = frontmatter(p);
    assert.match(fm, new RegExp(`name:\\s*${name}`));
    assert.match(fm, /description:/);
  });
}

test("review skill 引用 companion review 子命令", () => {
  const txt = readFileSync(path.join(root, "skills", "review", "SKILL.md"), "utf8");
  assert.ok(txt.includes("claude-companion.mjs") && txt.includes("review"));
});

test("adversarial-review skill 引用 companion adversarial-review 子命令且为只读", () => {
  const txt = readFileSync(path.join(root, "skills", "adversarial-review", "SKILL.md"), "utf8");
  assert.ok(txt.includes("claude-companion.mjs") && txt.includes("adversarial-review"));
  // 只读语义：应明确不修改文件
  assert.match(txt.toLowerCase(), /read-only|只读|do not modify|不修改/);
});

test("delegate skill 引用 companion task 子命令并含外发知情", () => {
  const txt = readFileSync(path.join(root, "skills", "delegate", "SKILL.md"), "utf8");
  assert.ok(txt.includes("claude-companion.mjs") && txt.includes("task"));
  assert.match(txt.toLowerCase(), /anthropic|external|send/);
});

test("delegate skill 含 --fresh 与自动续线程提示", () => {
  const txt = readFileSync(path.join(root, "skills", "delegate", "SKILL.md"), "utf8");
  assert.ok(txt.includes("--fresh"), "应说明 --fresh");
  assert.ok(txt.includes("resume-candidate"), "应说明 resume-candidate 检测");
});
