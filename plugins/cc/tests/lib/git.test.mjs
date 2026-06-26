import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiffArgs } from "../../scripts/lib/git.mjs";

test("working-tree 默认 diff HEAD", () => {
  assert.deepEqual(buildDiffArgs({ scope: "working-tree" }), ["diff", "HEAD"]);
});

test("branch scope 用三点 diff", () => {
  assert.deepEqual(buildDiffArgs({ scope: "branch", base: "main" }), ["diff", "main...HEAD"]);
});

test("branch scope 缺 base 回退 HEAD", () => {
  assert.deepEqual(buildDiffArgs({ scope: "branch" }), ["diff", "HEAD...HEAD"]);
});
