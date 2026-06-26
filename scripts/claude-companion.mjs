import { parseArgs } from "./lib/args.mjs";
import { resolveRepoRoot, collectDiff } from "./lib/git.mjs";
import { buildClaudeArgs, runClaudeForeground, startClaudeBackground } from "./lib/claude.mjs";
import { createJob } from "./lib/jobs.mjs";
import { renderResult } from "./lib/render.mjs";
import { ERROR_CODES, makeError, makeOk } from "./lib/errors.mjs";
import { randomUUID } from "node:crypto";

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
    // status/result/cancel/setup 在 Task 11 接入
    default: {
      const json = rest.includes("--json");
      res = { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未知子命令: ${sub}`), json };
    }
  }
  process.stdout.write(renderResult(res.out, { json: res.json }) + "\n");
  process.exit(res.out.ok ? 0 : 1);
}

main();
