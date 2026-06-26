import { upsertJob, findJob } from "./state.mjs";
import { transcriptPathFor, parseTranscript } from "./transcript.mjs";
import { ERROR_CODES, makeError } from "./errors.mjs";

export const STATUSES = ["queued", "running", "completed", "failed", "cancelled", "unknown", "lost"];

export function adaptAgentsList(rawJson) {
  const map = new Map();
  let arr;
  try {
    arr = JSON.parse(rawJson);
  } catch {
    return map;
  }
  if (!Array.isArray(arr)) return map;
  for (const item of arr) {
    const key = item.id ?? item.sessionId ?? null;
    if (!key) continue;
    const state = typeof item.state === "string" ? item.state : "unknown";
    map.set(key, { state });
    if (item.sessionId && item.sessionId !== key) map.set(item.sessionId, { state });
  }
  return map;
}

export function reconcileStatus(job, agentsMap, transcriptResult) {
  if (job.status === "cancelled") return "cancelled";
  const hit = agentsMap.get(job.shortId) ?? (job.sessionId ? agentsMap.get(job.sessionId) : null);
  if (hit) {
    if (hit.state === "done" || hit.state === "completed") return "completed";
    if (hit.state === "failed") return "failed";
    if (hit.state === "stopped") return "cancelled";
    if (hit.state === "unknown") return transcriptResult?.ok ? "completed" : "unknown";
    return "running";
  }
  if (transcriptResult?.ok) return "completed";
  return "lost";
}

export function createJob({ cwd, kind, shortId, sessionId, request }) {
  const id = `${kind}-${shortId}`;
  const now = Date.now();
  const job = { id, kind, shortId, sessionId, request, status: "running", cwd,
    transcriptPath: transcriptPathFor(cwd, sessionId), startedAt: now, updatedAt: now };
  return upsertJob(cwd, job);
}

export function readJobResult(cwd, jobId) {
  const job = findJob(cwd, jobId);
  if (!job) return makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`);
  return parseTranscript(job.transcriptPath ?? transcriptPathFor(cwd, job.sessionId));
}
