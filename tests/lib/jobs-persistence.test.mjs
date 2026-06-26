import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
const { createJob, readJobResult, reconcileStatus, resolveRealSessionId } = await import("../../scripts/lib/jobs.mjs");
const { findJob, upsertJob } = await import("../../scripts/lib/state.mjs");
const { transcriptPathFor } = await import("../../scripts/lib/transcript.mjs");
const { ERROR_CODES } = await import("../../scripts/lib/errors.mjs");

const cwd = mkdtempSync(path.join(os.tmpdir(), "cc-ws-"));

test("createJob 返回正确的 job 对象", () => {
  const job = createJob({
    cwd,
    kind: "task",
    shortId: "abc",
    sessionId: "sess-1",
    request: { prompt: "x" }
  });
  assert.equal(job.id, "task-abc");
  assert.equal(job.status, "running");
  assert.equal(typeof job.transcriptPath, "string");
  assert.ok(job.transcriptPath.length > 0);
});

test("createJob 持久化后可通过 findJob 找到", () => {
  const job = createJob({
    cwd,
    kind: "task",
    shortId: "xyz",
    sessionId: "sess-2",
    request: { prompt: "y" }
  });
  const found = findJob(cwd, job.id);
  assert.ok(found);
  assert.equal(found.id, "task-xyz");
  assert.equal(found.status, "running");
});

test("readJobResult 找不到作业时返回 job_not_found 错误", () => {
  const result = readJobResult(cwd, "task-does-not-exist");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ERROR_CODES.JOB_NOT_FOUND);
});

test("upsertJob 持久化 cancelled 后 reconcileStatus 返回 cancelled（粘滞）", () => {
  const job = createJob({
    cwd,
    kind: "task",
    shortId: "cancel-test",
    sessionId: "sess-cancel",
    request: { prompt: "cancel me" }
  });
  upsertJob(cwd, { id: job.id, status: "cancelled", updatedAt: Date.now() });
  const found = findJob(cwd, job.id);
  assert.equal(found.status, "cancelled");
  // agentsMap does NOT contain this job — simulates post-stop state
  const status = reconcileStatus(found, new Map(), null);
  assert.equal(status, "cancelled");
});

test("readJobResult 使用 agentsMap 解析真实 sessionId 定位 transcript", () => {
  const realSid = "6bf4ab97-real-0000-0000-000000000001";
  const fakeSid = "fake-0000-0000-0000-000000000001";

  // 创建作业时使用假 sessionId（模拟 --background 被 claude 忽略的场景）
  const job = createJob({
    cwd,
    kind: "task",
    shortId: "6bf4ab97",
    sessionId: fakeSid,
    request: { prompt: "real sid test" },
  });

  // transcript 文件按真实 sessionId 命名，写入一条有效的 result 行
  const realTranscriptPath = transcriptPathFor(cwd, realSid);
  mkdirSync(path.dirname(realTranscriptPath), { recursive: true });
  writeFileSync(realTranscriptPath, JSON.stringify({ type: "result", result: "hello from real transcript" }) + "\n");

  // agentsMap 将 shortId 映射到真实 sessionId
  const agentsMap = new Map([
    ["6bf4ab97", { state: "done", sessionId: realSid }],
  ]);

  const result = readJobResult(cwd, job.id, agentsMap);
  assert.ok(result.ok, `期望 ok 但得到错误: ${JSON.stringify(result)}`);
  assert.equal(result.result, "hello from real transcript");
});
