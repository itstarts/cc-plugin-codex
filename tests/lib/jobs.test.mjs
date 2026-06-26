import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptAgentsList, reconcileStatus } from "../../scripts/lib/jobs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentsRaw = readFileSync(path.join(here, "..", "fixtures", "agents-list.json"), "utf8");

test("adaptAgentsList 解析后台 state", () => {
  const m = adaptAgentsList(agentsRaw);
  assert.equal(m.get("ee603293")?.state, "done");
});

test("前台项无 state 标 unknown", () => {
  const m = adaptAgentsList(agentsRaw);
  assert.equal(m.get("ea540887-591f-4b09-8e60-3cf5b6a1f78f")?.state, "unknown");
});

test("agents 报 done → completed", () => {
  const m = adaptAgentsList(agentsRaw);
  const s = reconcileStatus({ shortId: "ee603293" }, m, null);
  assert.equal(s, "completed");
});

test("agents 查不到但 transcript 有结果 → completed", () => {
  const s = reconcileStatus({ shortId: "zzz" }, new Map(), { ok: true, result: "x" });
  assert.equal(s, "completed");
});

test("agents 查不到且无 transcript → lost", () => {
  const s = reconcileStatus({ shortId: "zzz" }, new Map(), { ok: false });
  assert.equal(s, "lost");
});
