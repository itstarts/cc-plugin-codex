import { parseArgs } from "./lib/args.mjs";
import { resolveRepoRoot, collectDiff } from "./lib/git.mjs";
import { buildClaudeArgs, runClaudeForeground, startClaudeBackground, classifyFailure, loadReviewSchema, parseReviewFindings } from "./lib/claude.mjs";
import { createJob, adaptAgentsList, reconcileStatus, readJobResult, resolveRealSessionId } from "./lib/jobs.mjs";
import { loadState, upsertJob, isReviewGateEnabled, setReviewGate } from "./lib/state.mjs";
import { transcriptPathFor } from "./lib/transcript.mjs";
import { renderResult } from "./lib/render.mjs";
import { parseStopInput, allowDecision, decideFromFindings } from "./lib/gate.mjs";
import { ERROR_CODES, makeError, makeOk } from "./lib/errors.mjs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

const SPEC = {
  boolean: ["background", "json", "enable-review-gate", "disable-review-gate", "fresh"],
  string: ["base", "scope", "model", "effort", "resume"],
};

// Stop 门禁评审的有界超时：claude 挂起时不让 Stop hook 永久阻塞收尾。
const GATE_REVIEW_TIMEOUT_MS = 120000;

function buildReviewPrompt(diffText, focus) {
  const parts = [
    "You are reviewing code changes. Read-only: do not modify files.",
    focus ? `Focus: ${focus}` : "",
    "Report each issue as a finding with a severity (P0 critical, P1 high, P2 medium, P3 low),",
    "a short title, the file and line when known, and a concrete detail. Add a brief overall summary.",
    "",
    "=== DIFF ===",
    diffText || "(empty diff)",
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * 挑战式（adversarial）评审 prompt：换评审立场，默认怀疑、试图证明改动不该上线，
 * 重点打高代价/难发现的失败面（auth、数据丢失、回滚、竞态、版本漂移等）。
 * 复用与普通 review 相同的 P0–P3 结构化输出契约，立场差异完全体现在 prompt。
 */
function buildAdversarialPrompt(diffText, focus) {
  const parts = [
    "You are performing an ADVERSARIAL code review. Read-only: do not modify files.",
    "Your job is to break confidence in this change, not to validate it.",
    "Question the chosen implementation, design choices, tradeoffs, and hidden assumptions —",
    "not just surface-level defects. Default to skepticism; if something only works on the happy path, treat that as a real weakness.",
    focus ? `Weight this focus heavily: ${focus}` : "",
    "Prioritize expensive, dangerous, or hard-to-detect failures:",
    "auth/permission/trust boundaries; data loss, corruption, irreversible state; rollback/retry/idempotency gaps;",
    "race conditions and ordering assumptions; empty-state/null/timeout/degraded-dependency behavior; version skew and migration hazards.",
    "Report only material findings (skip style/naming nits). Use severity P0 critical, P1 high, P2 medium, P3 low,",
    "a short title, the file and line when known, and a concrete detail with the likely impact and a concrete fix.",
    "Write the summary as a terse ship/no-ship assessment. If the change is genuinely safe, say so and report no findings.",
    "",
    "=== DIFF ===",
    diffText || "(empty diff)",
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * 若评审结果文本是 schema 约束下的结构化 JSON，则附加解析出的 findings/summary。
 * 解析失败时原样返回，保证自由文本评审仍可用。
 */
function attachReviewFindings(out) {
  if (!out.ok) return out;
  const parsed = parseReviewFindings(out.result);
  if (parsed) {
    out.findings = parsed.findings;
    if (parsed.summary !== undefined) out.summary = parsed.summary;
  }
  return out;
}

/**
 * 跑一次前台只读评审并附加结构化 findings。供 review 子命令与 Stop 门禁共用。
 * timeoutMs 为 0 表示不限时（交互式 review 默认）；门禁场景传入有界超时，
 * 避免 claude 挂起时把 Stop hook 永久阻塞。
 * 返回 attachReviewFindings 处理后的结构化结果（含 ok/findings/summary 或错误）。
 */
function runForegroundReview(cwd, { scope, base, focus, model, timeoutMs = 0 } = {}) {
  const repoRoot = resolveRepoRoot(cwd);
  const diff = collectDiff(cwd, { scope: scope ?? "working-tree", base });
  if (!diff.ok) return makeError(ERROR_CODES.NONZERO_EXIT, "git diff 失败", { stderr: diff.stderr });
  const prompt = buildReviewPrompt(diff.text, focus);
  // schema 是内置静态资源；加载失败属于打包缺陷，明确报错而非静默降级为自由文本评审
  let schema;
  try {
    schema = loadReviewSchema();
  } catch (e) {
    return makeError(ERROR_CODES.INVALID_JSON, "评审 schema 加载失败，请检查插件安装完整性", { detail: String(e?.message ?? e) });
  }
  const args = buildClaudeArgs({ mode: "review", repoRoot, model, schema });
  return attachReviewFindings(runClaudeForeground({ prompt, args, cwd, timeoutMs }));
}

function cmdReview(rest, cwd, { kind = "review", promptBuilder = buildReviewPrompt } = {}) {
  const { flags, values, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const repoRoot = resolveRepoRoot(cwd);
  const diff = collectDiff(cwd, { scope: values.scope ?? "working-tree", base: values.base });
  if (!diff.ok) return { out: makeError(ERROR_CODES.NONZERO_EXIT, "git diff 失败", { stderr: diff.stderr }), json };
  const prompt = promptBuilder(diff.text, positional.join(" "));
  // schema 是内置静态资源；加载失败属于打包缺陷，明确报错而非静默降级为自由文本评审
  let schema;
  try {
    schema = loadReviewSchema();
  } catch (e) {
    return { out: makeError(ERROR_CODES.INVALID_JSON, "评审 schema 加载失败，请检查插件安装完整性", { detail: String(e?.message ?? e) }), json };
  }
  if (flags.background) {
    const sessionId = randomUUID();
    const args = buildClaudeArgs({ mode: "review", repoRoot, model: values.model, effort: values.effort, background: true, sessionId, schema });
    const started = startClaudeBackground({ prompt, args, cwd });
    if (!started.ok) return { out: started, json };
    const job = createJob({ cwd, kind, shortId: started.shortId, sessionId, request: { scope: values.scope, base: values.base } });
    return { out: makeOk({ jobId: job.id, shortId: started.shortId, status: "running" }), json };
  }
  const args = buildClaudeArgs({ mode: "review", repoRoot, model: values.model, effort: values.effort, schema });
  return { out: attachReviewFindings(runClaudeForeground({ prompt, args, cwd, timeoutMs: 0 })), json };
}

function cmdTask(rest, cwd) {
  const { flags, values, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const repoRoot = resolveRepoRoot(cwd);
  const prompt = positional.join(" ").trim();
  if (!prompt) return { out: makeError(ERROR_CODES.INVALID_ARGS, "task 需要任务描述文本"), json };
  // --fresh 与 --resume 语义冲突（强制新开 vs 续接指定会话），同传视为参数错误，
  // 避免 skill 透传时出现"既要新开又要续接"的未定义行为。
  if (flags.fresh && values.resume) {
    return { out: makeError(ERROR_CODES.INVALID_ARGS, "--fresh 与 --resume 互斥"), json };
  }
  // --fresh 强制新开：companion 层不向 claude 传任何 resume id（即便上游误带）。
  const resume = flags.fresh ? undefined : values.resume;
  if (flags.background) {
    const sessionId = randomUUID();
    const args = buildClaudeArgs({ mode: "task", repoRoot, model: values.model, effort: values.effort, background: true, sessionId, resume });
    const started = startClaudeBackground({ prompt, args, cwd });
    if (!started.ok) return { out: started, json };
    const job = createJob({ cwd, kind: "task", shortId: started.shortId, sessionId, request: { prompt } });
    return { out: makeOk({ jobId: job.id, shortId: started.shortId, status: "running" }), json };
  }
  const args = buildClaudeArgs({ mode: "task", repoRoot, model: values.model, effort: values.effort, resume });
  return { out: runClaudeForeground({ prompt, args, cwd, timeoutMs: 0 }), json };
}

/**
 * 探测当前工作区是否存在可续的上一次委派线程，供 delegate skill 在用户未显式
 * 指定 --resume/--fresh 时询问"续接还是新开"。
 * 候选取最近一个能从 claude agents 解析出**真实** sessionId 的 task 作业
 * （jobs 已按 updatedAt 倒序持久化）。后台启动时存的是插件自生成 UUID，会被
 * claude 忽略，不能作为可续 id；因此这里只信任 agents 暴露的真实 sessionId，
 * 不回退到 job.sessionId。claude 不可用或无命中时返回 available:false，不阻塞委派。
 */
function cmdResumeCandidate(rest, cwd) {
  const { flags } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobs = loadState(cwd).jobs.filter((j) => j.kind === "task");
  if (!jobs.length) return { out: makeOk({ available: false, candidate: null }), json };
  // 解析真实 sessionId 需要 claude agents；不可用时不报错，按"无候选"降级
  const agentsResult = fetchAgentsMap(cwd);
  const agentsMap = agentsResult.ok ? agentsResult.map : new Map();
  for (const j of jobs) {
    const hit = agentsMap.get(j.shortId) ?? (j.sessionId ? agentsMap.get(j.sessionId) : null);
    const sessionId = hit?.sessionId;
    if (sessionId) {
      return { out: makeOk({
        available: true,
        candidate: { id: j.id, status: j.status, sessionId, startedAt: j.startedAt },
      }), json };
    }
  }
  return { out: makeOk({ available: false, candidate: null }), json };
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
  // 先校验 job 是否存在，避免在 claude CLI 缺失时把 job_not_found 误判成 missing_cli
  const job = loadState(cwd).jobs.find((j) => j.id === jobId);
  if (!job) return { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`), json };
  // 获取真实 sessionId 以定位后台作业的 transcript 文件
  const agentsResult = fetchAgentsMap(cwd);
  if (!agentsResult.ok) return { out: agentsResult, json };
  const agentsMap = agentsResult.map;
  const out = readJobResult(cwd, jobId, agentsMap);
  // review / adversarial-review 作业的 transcript 终结文本同样是 schema 约束的结构化 JSON，附加 findings
  if (job.kind === "review" || job.kind === "adversarial-review") return { out: attachReviewFindings(out), json };
  return { out, json };
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
  // 互斥开关：同时给出 enable/disable 视为参数错误
  if (flags["enable-review-gate"] && flags["disable-review-gate"]) {
    return { out: makeError(ERROR_CODES.INVALID_ARGS, "--enable-review-gate 与 --disable-review-gate 互斥"), json };
  }
  let reviewGate;
  if (flags["enable-review-gate"]) reviewGate = setReviewGate(cwd, true);
  else if (flags["disable-review-gate"]) reviewGate = setReviewGate(cwd, false);
  else reviewGate = isReviewGateEnabled(cwd);

  const ver = spawnSync("claude", ["--version"], { cwd, encoding: "utf8" });
  // 门禁开关已持久化（gate 本身 fail-open，claude 暂不可用也不影响开关语义）；
  // 即便就绪检查失败也带回 reviewGate，避免状态对用户不透明。
  if (ver.status !== 0) {
    return { out: makeError(ERROR_CODES.MISSING_CLI, "未检测到 claude，请安装 Claude Code CLI", { reviewGate }), json };
  }
  return { out: makeOk({ claudeVersion: ver.stdout.trim(), ready: true, reviewGate }), json };
}

/**
 * Stop 评审门禁 hook 入口。读 stdin 的 Codex Stop 契约，按开关决定是否评审。
 * 输出 Codex Stop hook decision JSON（裸 JSON，非 renderResult 包络）。
 * fail-open 原则：任何异常、开关关闭、已在 stop 循环内，一律放行（continue:true），
 * 始终退出码 0，避免 hook 自身故障把用户卡在收尾环节。
 */
function cmdGate(stdin) {
  try {
    const parsed = parseStopInput(stdin);
    // 解析失败或非 Stop 事件：放行
    if (!parsed.ok) return allowDecision();
    // 已在 stop-hook 循环内：放行，防止门禁递归触发
    if (parsed.stopHookActive) return allowDecision();
    const cwd = parsed.cwd || process.cwd();
    // 门禁默认关闭，未显式开启则放行（等价 no-op）
    if (!isReviewGateEnabled(cwd)) return allowDecision();

    const review = runForegroundReview(cwd, { scope: "working-tree", focus: "收尾前门禁评审，聚焦阻断级缺陷", timeoutMs: GATE_REVIEW_TIMEOUT_MS });
    // 评审本身失败（claude 缺失/鉴权/超时等）：放行并提示，不因门禁故障阻塞用户
    if (!review.ok) {
      return allowDecision(`Claude 评审门禁未能完成（${review.error?.code ?? "unknown"}），已放行。`);
    }
    return decideFromFindings(review.findings, review.summary);
  } catch {
    // 任何非预期运行时异常都必须 fail-open，避免门禁自身故障把用户卡在收尾环节
    return allowDecision();
  }
}

function usage() {
  return "用法: claude-companion <setup|review|adversarial-review|task|resume-candidate|status|result|cancel|gate> [args] [--json]";
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  if (!sub) {
    process.stderr.write(usage() + "\n");
    process.exit(2);
  }
  // gate 是 hook 入口，输出裸 decision JSON 且始终放行式退出（fail-open）
  if (sub === "gate") {
    let decision;
    try {
      decision = cmdGate(readStdin());
    } catch {
      decision = { continue: true };
    }
    process.stdout.write(JSON.stringify(decision) + "\n");
    process.exit(0);
  }
  let res;
  switch (sub) {
    case "review": res = cmdReview(rest, cwd); break;
    case "adversarial-review": res = cmdReview(rest, cwd, { kind: "adversarial-review", promptBuilder: buildAdversarialPrompt }); break;
    case "task": res = cmdTask(rest, cwd); break;
    case "resume-candidate": res = cmdResumeCandidate(rest, cwd); break;
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
