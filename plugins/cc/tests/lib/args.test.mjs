import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateArgs, SCOPE_VALUES } from "../../scripts/lib/args.mjs";

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

test("未声明标志归入 unknown，不污染 positional", () => {
  const r = parseArgs(["--unknown", "x"], spec);
  assert.deepEqual(r.unknown, ["unknown"]);
  assert.equal(r.positional.join(" "), "x");
  assert.ok(!r.positional.includes("--unknown"));
});

test("string 标志缺值归入 missing，不产生空字符串", () => {
  const r = parseArgs(["--base"], spec);
  assert.deepEqual(r.missing, ["base"]);
  assert.equal(r.values.base, undefined);
});

test("string 标志后接另一个 flag 视为缺值", () => {
  const r = parseArgs(["--base", "--scope=branch"], spec);
  assert.deepEqual(r.missing, ["base"]);
  assert.equal(r.values.scope, "branch");
});

test("等号写法空值视为缺值", () => {
  const r = parseArgs(["--base="], spec);
  assert.deepEqual(r.missing, ["base"]);
});

test("缺省安全：空 argv", () => {
  const r = parseArgs([], spec);
  assert.deepEqual(r.flags, {});
  assert.deepEqual(r.values, {});
  assert.deepEqual(r.positional, []);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.boolWithValue, []);
});

test("布尔标志误带取值归入 boolWithValue", () => {
  const r = parseArgs(["--fresh=false"], spec);
  assert.deepEqual(r.boolWithValue, ["fresh"]);
  assert.equal(r.flags.fresh, undefined);
});

test("validateArgs：布尔标志带取值报错", () => {
  const r = parseArgs(["--fresh=false"], spec);
  assert.match(validateArgs(r), /开关参数不接受取值.*--fresh/);
});

test("validateArgs：合法参数返回 null", () => {
  const r = parseArgs(["--scope=branch", "--base", "main", "focus"], spec);
  assert.equal(validateArgs(r, { enums: { scope: SCOPE_VALUES } }), null);
});

test("validateArgs：未知 flag 报错", () => {
  const r = parseArgs(["--scop", "branch"], spec);
  const msg = validateArgs(r, { enums: { scope: SCOPE_VALUES } });
  assert.match(msg, /未知参数.*--scop/);
});

test("validateArgs：缺值报错", () => {
  const r = parseArgs(["--base"], spec);
  assert.match(validateArgs(r), /缺少取值.*--base/);
});

test("validateArgs：非法枚举报错并列出可选值", () => {
  const r = parseArgs(["--scope=bogus"], spec);
  const msg = validateArgs(r, { enums: { scope: SCOPE_VALUES } });
  assert.match(msg, /--scope 取值非法: bogus/);
  assert.match(msg, /auto\|working-tree\|branch/);
});

test("SCOPE_VALUES 包含 auto、working-tree 与 branch", () => {
  assert.deepEqual([...SCOPE_VALUES], ["auto", "working-tree", "branch"]);
});
