import { parseArgs } from "./lib/args.mjs";
import { resolveRepoRoot, collectDiff } from "./lib/git.mjs";
import { buildClaudeArgs, runClaudeForeground, startClaudeBackground, classifyFailure } from "./lib/claude.mjs";
import { createJob, adaptAgentsList, reconcileStatus, readJobResult, resolveRealSessionId } from "./lib/jobs.mjs";
import { loadState, upsertJob } from "./lib/state.mjs";
import { transcriptPathFor } from "./lib/transcript.mjs";
import { renderResult } from "./lib/render.mjs";
import { ERROR_CODES, makeError, makeOk } from "./lib/errors.mjs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

/**
 * 运行 claude agents --json --all 并返回结构化结果。
 * 成功时返回 {ok:true, map}；失败时返回 {ok:false, error} 含分类错误码。
 */
function fetchAgentsMap(cwd) {
  const r = spawnSync("claude", ["agents", "--json", "--all"], { cwd, encoding: "utf8" });
  if (r.error && r.error.code === "ENOENT") {
    return makeError(ERROR_CODES.MISSING_CLI, "未找到 claude 命令");
  }
  if (r.status !== 0) {
    const code = classifyFailure({ status: r.status, stderr: r.stderr ?? "" });
    return makeError(code, "claude agents 调用失败", { stderr: (r.stderr ?? "").slice(0, 500) });
  }
  return makeOk({ map: adaptAgentsList(r.stdout) });
}

const SPEC = { boolean: ["background", "json"], string: ["base", "scope", "model", "effort", "resume"] };

function buildReviewPrompt(diffText, focus) {
  const parts = [
    "You are reviewing code changes. Read-only: do not modify files.",
    focus ? `Focus: ${focus}` : "",
    "Report findings grouped by severity. Be concrete (file:line).",
    "",
    "=== DIFF ===",
    diffText || "(empty diff)",
  ];
  return parts.filter(Boolean).join("\n");
}

function cmdReview(rest, cwd) {
  const { flags, values, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const repoRoot = resolveRepoRoot(cwd);
  const diff = collectDiff(cwd, { scope: values.scope ?? "working-tree", base: values.base });
  if (!diff.ok) return { out: makeError(ERROR_CODES.NONZERO_EXIT, "git diff 失败", { stderr: diff.stderr }), json };
  const prompt = buildReviewPrompt(diff.text, positional.join(" "));
  if (flags.background) {
    const sessionId = randomUUID();
    const args = buildClaudeArgs({ mode: "review", repoRoot, model: values.model, background: true, sessionId });
    const started = startClaudeBackground({ prompt, args, cwd });
    if (!started.ok) return { out: started, json };
    const job = createJob({ cwd, kind: "review", shortId: started.shortId, sessionId, request: { scope: values.scope, base: values.base } });
    return { out: makeOk({ jobId: job.id, shortId: started.shortId, status: "running" }), json };
  }
  const args = buildClaudeArgs({ mode: "review", repoRoot, model: values.model });
  return { out: runClaudeForeground({ prompt, args, cwd, timeoutMs: 0 }), json };
}

function cmdTask(rest, cwd) {
  const { flags, values, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const repoRoot = resolveRepoRoot(cwd);
  const prompt = positional.join(" ").trim();
  if (!prompt) return { out: makeError(ERROR_CODES.INVALID_ARGS, "task 需要任务描述文本"), json };
  if (flags.background) {
    const sessionId = randomUUID();
    const args = buildClaudeArgs({ mode: "task", repoRoot, model: values.model, effort: values.effort, background: true, sessionId, resume: values.resume });
    const started = startClaudeBackground({ prompt, args, cwd });
    if (!started.ok) return { out: started, json };
    const job = createJob({ cwd, kind: "task", shortId: started.shortId, sessionId, request: { prompt } });
    return { out: makeOk({ jobId: job.id, shortId: started.shortId, status: "running" }), json };
  }
  const args = buildClaudeArgs({ mode: "task", repoRoot, model: values.model, effort: values.effort, resume: values.resume });
  return { out: runClaudeForeground({ prompt, args, cwd, timeoutMs: 0 }), json };
}

function cmdStatus(rest, cwd) {
  const { flags } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const agentsResult = fetchAgentsMap(cwd);
  if (!agentsResult.ok) return { out: agentsResult, json };
  const agentsMap = agentsResult.map;
  const jobs = loadState(cwd).jobs.map((j) => {
    // 解析真实 sessionId，确保 transcript 路径指向后台作业实际生成的文件
    const realSid = resolveRealSessionId(j, agentsMap);
    const tr = readJobResult(cwd, j.id, agentsMap);
    const status = reconcileStatus(j, agentsMap, tr);
    // 终态持久化：一旦到达终态就写入存储，避免后续 agents 数据丢失时降级为 lost
    if (status === "completed" || status === "failed" || status === "cancelled") {
      const update = { id: j.id, status, updatedAt: Date.now() };
      if (realSid && realSid !== j.sessionId) {
        update.sessionId = realSid;
        update.transcriptPath = transcriptPathFor(cwd, realSid);
      }
      upsertJob(cwd, update);
    }
    return { id: j.id, kind: j.kind, status, startedAt: j.startedAt };
  });
  return { out: makeOk({ jobs }), json };
}

function cmdResult(rest, cwd) {
  const { flags, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobId = positional[0];
  if (!jobId) return { out: makeError(ERROR_CODES.INVALID_ARGS, "result 需要 jobId"), json };
  // 获取真实 sessionId 以定位后台作业的 transcript 文件
  const agentsResult = fetchAgentsMap(cwd);
  if (!agentsResult.ok) return { out: agentsResult, json };
  const agentsMap = agentsResult.map;
  return { out: readJobResult(cwd, jobId, agentsMap), json };
}

function cmdCancel(rest, cwd) {
  const { flags, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobId = positional[0];
  const state = loadState(cwd);
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`), json };
  const r = spawnSync("claude", ["stop", job.shortId], { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    return { out: makeError(ERROR_CODES.NONZERO_EXIT, `claude stop 失败，退出码 ${r.status}`, { jobId }), json };
  }
  upsertJob(cwd, { id: jobId, status: "cancelled", updatedAt: Date.now() });
  return { out: makeOk({ jobId, cancelled: true }), json };
}

function cmdSetup(rest, cwd) {
  const { flags } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const ver = spawnSync("claude", ["--version"], { cwd, encoding: "utf8" });
  if (ver.status !== 0) return { out: makeError(ERROR_CODES.MISSING_CLI, "未检测到 claude，请安装 Claude Code CLI"), json };
  return { out: makeOk({ claudeVersion: ver.stdout.trim(), ready: true }), json };
}

function usage() {
  return "用法: claude-companion <setup|review|task|status|result|cancel> [args] [--json]";
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  if (!sub) {
    process.stderr.write(usage() + "\n");
    process.exit(2);
  }
  let res;
  switch (sub) {
    case "review": res = cmdReview(rest, cwd); break;
    case "task": res = cmdTask(rest, cwd); break;
    case "status": res = cmdStatus(rest, cwd); break;
    case "result": res = cmdResult(rest, cwd); break;
    case "cancel": res = cmdCancel(rest, cwd); break;
    case "setup": res = cmdSetup(rest, cwd); break;
    default: {
      const json = rest.includes("--json");
      res = { out: makeError(ERROR_CODES.INVALID_ARGS, `未知子命令: ${sub}`), json };
    }
  }
  process.stdout.write(renderResult(res.out, { json: res.json }) + "\n");
  process.exit(res.out.ok ? 0 : 1);
}

main();
