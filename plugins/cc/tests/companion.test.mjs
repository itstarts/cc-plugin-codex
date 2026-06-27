import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "scripts", "claude-companion.mjs");

test("未知子命令返回结构化错误 JSON", () => {
  const r = spawnSync("node", [entry, "bogus", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.error.message.includes("bogus"));
  assert.equal(out.error.code, "invalid_args");
});

test("无子命令打印用法且非零退出", () => {
  const r = spawnSync("node", [entry], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
});

test("review 未知 flag 返回 invalid_args 且不调用 claude", () => {
  const r = spawnSync("node", [entry, "review", "--scop", "branch", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "invalid_args");
  assert.match(out.error.message, /未知参数.*--scop/);
});

test("review --scope 非法枚举返回 invalid_args 并列出可选值", () => {
  const r = spawnSync("node", [entry, "review", "--scope=bogus", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, "invalid_args");
  assert.match(out.error.message, /working-tree\|branch/);
});

test("task --model 缺值返回 invalid_args", () => {
  const r = spawnSync("node", [entry, "task", "--model", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, "invalid_args");
  assert.match(out.error.message, /缺少取值.*--model/);
});

test("task 不接受 review 专属的 --scope，判为未知参数", () => {
  const r = spawnSync("node", [entry, "task", "--scope", "branch", "做点事", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, "invalid_args");
  assert.match(out.error.message, /未知参数.*--scope/);
});

test("布尔开关误带取值返回 invalid_args", () => {
  const r = spawnSync("node", [entry, "task", "--fresh=false", "做点事", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, "invalid_args");
  assert.match(out.error.message, /开关参数不接受取值.*--fresh/);
});
