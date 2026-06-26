import { parseArgs } from "./lib/args.mjs";
import { resolveRepoRoot, collectDiff } from "./lib/git.mjs";
import { buildClaudeArgs, runClaudeForeground, startClaudeBackground } from "./lib/claude.mjs";
import { createJob, adaptAgentsList, reconcileStatus, readJobResult } from "./lib/jobs.mjs";
import { loadState, upsertJob } from "./lib/state.mjs";
import { renderResult } from "./lib/render.mjs";
import { ERROR_CODES, makeError, makeOk } from "./lib/errors.mjs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const SPEC = { boolean: ["background", "wait", "fresh", "json"], string: ["base", "scope", "model", "effort", "resume"] };

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
  const { text } = collectDiff(cwd, { scope: values.scope ?? "working-tree", base: values.base });
  const prompt = buildReviewPrompt(text, positional.join(" "));
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
  const agents = spawnSync("claude", ["agents", "--json", "--all"], { cwd, encoding: "utf8" });
  const agentsMap = agents.status === 0 ? adaptAgentsList(agents.stdout) : new Map();
  const jobs = loadState(cwd).jobs.map((j) => {
    const tr = j.transcriptPath ? readJobResult(cwd, j.id) : null;
    return { id: j.id, kind: j.kind, status: reconcileStatus(j, agentsMap, tr), startedAt: j.startedAt };
  });
  return { out: makeOk({ jobs }), json };
}

function cmdResult(rest, cwd) {
  const { flags, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobId = positional[0];
  if (!jobId) return { out: makeError(ERROR_CODES.JOB_NOT_FOUND, "result 需要 jobId"), json };
  return { out: readJobResult(cwd, jobId), json };
}

function cmdCancel(rest, cwd) {
  const { flags, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobId = positional[0];
  const state = loadState(cwd);
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`), json };
  const r = spawnSync("claude", ["stop", job.shortId], { cwd, encoding: "utf8" });
  if (r.status === 0) {
    upsertJob(cwd, { id: jobId, status: "cancelled", updatedAt: Date.now() });
  }
  return { out: makeOk({ jobId, cancelled: r.status === 0 }), json };
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
      res = { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未知子命令: ${sub}`), json };
    }
  }
  process.stdout.write(renderResult(res.out, { json: res.json }) + "\n");
  process.exit(res.out.ok ? 0 : 1);
}

main();
