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
    // 保存真实 sessionId（完整 uuid），供 resolveRealSessionId 使用
    const sessionId = typeof item.sessionId === "string" ? item.sessionId : undefined;
    map.set(key, { state, sessionId });
    if (item.sessionId && item.sessionId !== key) map.set(item.sessionId, { state, sessionId });
  }
  return map;
}

export function reconcileStatus(job, agentsMap, transcriptResult) {
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "completed") return "completed";
  if (job.status === "failed") return "failed";
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

/**
 * 从 agentsMap 中解析后台作业的真实 sessionId（完整 uuid）。
 * claude --background 启动时忽略我们传入的 --session-id，会自行生成一个真实 sessionId；
 * transcript 文件按真实 sessionId 命名，因此必须通过 claude agents --json --all 获取真实值。
 * 若无匹配条目则返回 job.sessionId（兜底/前台路径）。
 */
export function resolveRealSessionId(job, agentsMap) {
  const hit = agentsMap.get(job.shortId) ?? (job.sessionId ? agentsMap.get(job.sessionId) : null);
  if (hit?.sessionId) return hit.sessionId;
  return job.sessionId;
}

export function createJob({ cwd, kind, shortId, sessionId, request }) {
  const id = `${kind}-${shortId}`;
  const now = Date.now();
  const job = { id, kind, shortId, sessionId, request, status: "running", cwd,
    transcriptPath: transcriptPathFor(cwd, sessionId), startedAt: now, updatedAt: now };
  return upsertJob(cwd, job);
}

/**
 * 读取作业结果。agentsMap 可选；若提供，则先解析真实 sessionId 以定位正确的 transcript 文件。
 * 后台作业的 transcript 以 claude 自生成的真实 sessionId 命名，与启动时传入的 uuid 不同。
 * 解析优先级：
 *   1. agentsMap 命中且真实 sessionId 与存储值不同 → 用新计算的真实路径（后台作业必须走此路径）
 *   2. job.transcriptPath 已存储 → 直接使用（避免重复计算）
 *   3. 否则按 job.sessionId 计算路径（兜底）
 */
export function readJobResult(cwd, jobId, agentsMap) {
  const job = findJob(cwd, jobId);
  if (!job) return makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`);
  const realSid = agentsMap ? resolveRealSessionId(job, agentsMap) : job.sessionId;
  // 若 agents 解析出的真实 sessionId 与存储值不同，必须用真实 sessionId 重新计算路径
  if (realSid && realSid !== job.sessionId) {
    return parseTranscript(transcriptPathFor(cwd, realSid));
  }
  // 否则优先使用持久化存储的路径，回退到按 sessionId 计算
  const filePath = job.transcriptPath ?? transcriptPathFor(cwd, job.sessionId);
  return parseTranscript(filePath);
}
