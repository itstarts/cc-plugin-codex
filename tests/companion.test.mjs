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
