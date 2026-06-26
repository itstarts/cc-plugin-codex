import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
const { createJob, readJobResult } = await import("../../scripts/lib/jobs.mjs");
const { findJob } = await import("../../scripts/lib/state.mjs");
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
