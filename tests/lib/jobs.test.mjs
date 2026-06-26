import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptAgentsList, reconcileStatus, resolveRealSessionId } from "../../scripts/lib/jobs.mjs";

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

test("agent state unknown + transcript ok → completed", () => {
  const m = new Map([["sid", { state: "unknown" }]]);
  const s = reconcileStatus({ shortId: "sid" }, m, { ok: true, result: "data" });
  assert.equal(s, "completed");
});

test("agent state unknown + transcript fail → unknown", () => {
  const m = new Map([["sid", { state: "unknown" }]]);
  const s = reconcileStatus({ shortId: "sid" }, m, { ok: false });
  assert.equal(s, "unknown");
});

test("agent state unknown + no transcript → unknown", () => {
  const m = new Map([["sid", { state: "unknown" }]]);
  const s = reconcileStatus({ shortId: "sid" }, m, null);
  assert.equal(s, "unknown");
});

test("agent state failed → failed", () => {
  const m = new Map([["sid", { state: "failed" }]]);
  const s = reconcileStatus({ shortId: "sid" }, m, null);
  assert.equal(s, "failed");
});

test("agent state stopped → cancelled", () => {
  const m = new Map([["sid", { state: "stopped" }]]);
  const s = reconcileStatus({ shortId: "sid" }, m, null);
  assert.equal(s, "cancelled");
});

test("agent state working → running", () => {
  const m = new Map([["sid", { state: "working" }]]);
  const s = reconcileStatus({ shortId: "sid" }, m, null);
  assert.equal(s, "running");
});

test("status cancelled → reconcileStatus 返回 cancelled（忽略 agents/transcript）", () => {
  const m = new Map([["x", { state: "done" }]]);
  const s = reconcileStatus({ status: "cancelled", shortId: "x" }, m, { ok: true });
  assert.equal(s, "cancelled");
});

test("adaptAgentsList 在 value 中暴露真实 sessionId", () => {
  const m = adaptAgentsList(agentsRaw);
  // 后台条目：id="ee603293", sessionId="ee603293-22dc-4767-aa2d-78204e0bdb45"
  assert.equal(m.get("ee603293")?.sessionId, "ee603293-22dc-4767-aa2d-78204e0bdb45");
  // 通过完整 sessionId 查也能取到
  assert.equal(m.get("ee603293-22dc-4767-aa2d-78204e0bdb45")?.sessionId, "ee603293-22dc-4767-aa2d-78204e0bdb45");
});

test("resolveRealSessionId：agentsMap 命中时返回真实 sessionId", () => {
  const m = new Map([
    ["6bf4ab97", { state: "done", sessionId: "6bf4ab97-real-uuid" }],
  ]);
  const job = { shortId: "6bf4ab97", sessionId: "fake-uuid" };
  assert.equal(resolveRealSessionId(job, m), "6bf4ab97-real-uuid");
});

test("resolveRealSessionId：agentsMap 无匹配时返回 job.sessionId", () => {
  const job = { shortId: "6bf4ab97", sessionId: "fake-uuid" };
  assert.equal(resolveRealSessionId(job, new Map()), "fake-uuid");
});

test("status completed → reconcileStatus 返回 completed（终态粘滞）", () => {
  const m = new Map([["x", { state: "failed" }]]);
  const s = reconcileStatus({ status: "completed", shortId: "x" }, m, { ok: false });
  assert.equal(s, "completed");
});

test("status completed → agentsMap 为空也返回 completed（终态粘滞）", () => {
  const s = reconcileStatus({ status: "completed", shortId: "x" }, new Map(), { ok: false });
  assert.equal(s, "completed");
});

test("status failed → reconcileStatus 返回 failed（终态粘滞）", () => {
  const m = new Map([["x", { state: "done" }]]);
  const s = reconcileStatus({ status: "failed", shortId: "x" }, m, { ok: true });
  assert.equal(s, "failed");
});

test("status failed → agentsMap 为空也返回 failed（终态粘滞）", () => {
  const s = reconcileStatus({ status: "failed", shortId: "x" }, new Map(), null);
  assert.equal(s, "failed");
});
