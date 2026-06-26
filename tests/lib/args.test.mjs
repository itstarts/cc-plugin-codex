import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../../scripts/lib/args.mjs";

const spec = { boolean: ["background", "wait", "fresh"], string: ["base", "scope", "model", "effort", "resume"] };

test("分离布尔标志与自由文本", () => {
  const r = parseArgs(["--background", "fix", "the", "bug"], spec);
  assert.equal(r.flags.background, true);
  assert.equal(r.positional.join(" "), "fix the bug");
});

test("string 标志支持空格与等号两种写法", () => {
  const a = parseArgs(["--base", "main", "--scope=branch", "review"], spec);
  assert.equal(a.values.base, "main");
  assert.equal(a.values.scope, "branch");
  assert.equal(a.positional.join(" "), "review");
});

test("未声明标志保留在 positional", () => {
  const r = parseArgs(["--unknown", "x"], spec);
  assert.ok(r.positional.includes("--unknown"));
});

test("缺省安全：空 argv", () => {
  const r = parseArgs([], spec);
  assert.deepEqual(r.flags, {});
  assert.deepEqual(r.values, {});
  assert.deepEqual(r.positional, []);
});
