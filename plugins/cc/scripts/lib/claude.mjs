import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "review-output.schema.json",
);

/**
 * 读取评审输出 schema 的紧凑 JSON 字符串，用于传给 claude --json-schema。
 * schema 是仓库内置静态资源，加载失败属于打包/安装缺陷：直接抛出而非静默降级为自由文本评审，
 * 避免"强结构化评审"在无声中退化。调用方捕获后返回 invalid_json 错误。
 */
export function loadReviewSchema() {
  return JSON.stringify(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
}

export function scrubSecrets(text) {
  if (!text) return text;
  return text
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .replace(/(ghp_[A-Za-z0-9]{8,})/g, "[redacted]")
    .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,})/g, "[redacted-jwt]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password)\b(\s*[:=]\s*)(\S+)/gi, "$1$2[redacted]");
}

export function buildClaudeArgs({ mode, repoRoot, model, effort, background, sessionId, resume, schema } = {}) {
  const args = ["-p"];
  if (!background) args.push("--output-format", "json");
  if (mode === "review") args.push("--permission-mode", "plan");
  if (mode === "task") args.push("--permission-mode", "acceptEdits", "--add-dir", repoRoot);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (resume) args.push("--resume", resume);
  // 结构化评审输出：让 Claude 按 schema 返回 findings，便于稳定解析与展示
  if (schema) args.push("--json-schema", schema);
  if (background) {
    args.push("--background");
    if (sessionId) args.push("--session-id", sessionId);
  }
  return args;
}

/**
 * 解析 --json-schema 约束下的评审结果。
 * Claude 返回的 result 文本是符合 review-output schema 的 JSON 字符串。
 * 解析成功返回 {findings, summary}；非结构化或缺 findings 时返回 null，由调用方回退到原始文本。
 */
export function parseReviewFindings(resultText) {
  if (typeof resultText !== "string" || !resultText.trim()) return null;
  let obj;
  try {
    obj = JSON.parse(resultText);
  } catch {
    return null;
  }
  if (!obj || !Array.isArray(obj.findings)) return null;
  // 校验每条 finding 形状：与 review-output schema 对齐，防止 schema 被绕过时
  // 残缺输出仍被当作结构化 findings 渲染。任一条不合规则整体回退到自由文本。
  for (const f of obj.findings) {
    if (!isValidFinding(f)) return null;
  }
  const out = { findings: obj.findings };
  if (typeof obj.summary === "string") out.summary = obj.summary;
  return out;
}

const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);

function isValidFinding(f) {
  if (!f || typeof f !== "object") return false;
  if (!SEVERITIES.has(f.severity)) return false;
  if (typeof f.title !== "string") return false;
  if (typeof f.detail !== "string") return false;
  if (!(f.file === null || typeof f.file === "string")) return false;
  if (!(f.line === null || Number.isInteger(f.line))) return false;
  return true;
}

export function parseClaudeJson(stdout) {
  let obj;
  try {
    obj = JSON.parse(stdout);
  } catch {
    return makeError(ERROR_CODES.INVALID_JSON, "claude 输出不是合法 JSON", { raw: scrubSecrets(stdout.slice(0, 500)) });
  }
  if (obj.type === "result" && obj.subtype === "success" && obj.is_error === false) {
    return makeOk({ result: obj.result ?? "", sessionId: obj.session_id ?? null });
  }
  return makeError(ERROR_CODES.NONZERO_EXIT, `claude 返回非成功结果: ${obj.subtype ?? "unknown"}`, {
    sessionId: obj.session_id ?? null,
  });
}

export function classifyFailure({ status, stderr = "" }) {
  const s = stderr.toLowerCase();
  if (status === 127 || s.includes("command not found") || s.includes("enoent")) return ERROR_CODES.MISSING_CLI;
  if (s.includes("log in") || s.includes("authenticate") || s.includes("invalid api key") || s.includes("unauthorized")) {
    return ERROR_CODES.AUTH_REQUIRED;
  }
  return ERROR_CODES.NONZERO_EXIT;
}

export function runClaudeForeground({ prompt, args, cwd, timeoutMs = 0 }) {
  const r = spawnSync("claude", args, {
    cwd,
    input: prompt,
    encoding: "utf8",
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error && r.error.code === "ETIMEDOUT") return makeError(ERROR_CODES.TIMEOUT, "claude 调用超时");
  if (r.error && r.error.code === "ENOENT") return makeError(ERROR_CODES.MISSING_CLI, "未找到 claude 命令");
  if (r.status !== 0) {
    const code = classifyFailure({ status: r.status, stderr: r.stderr ?? "" });
    return makeError(code, `claude 退出码 ${r.status}`, { stderr: scrubSecrets((r.stderr ?? "").slice(0, 500)) });
  }
  return parseClaudeJson(r.stdout ?? "");
}

export function startClaudeBackground({ prompt, args, cwd }) {
  const r = spawnSync("claude", args, { cwd, input: prompt, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.error && r.error.code === "ENOENT") return makeError(ERROR_CODES.MISSING_CLI, "未找到 claude 命令");
  if (r.status !== 0) {
    const code = classifyFailure({ status: r.status, stderr: r.stderr ?? "" });
    return makeError(code, `claude 后台启动失败，退出码 ${r.status}`, { stderr: scrubSecrets((r.stderr ?? "").slice(0, 500)) });
  }
  const m = (r.stdout ?? "").match(/backgrounded\s+·\s+([0-9a-f]+)/i);
  if (!m) return makeError(ERROR_CODES.INVALID_JSON, "未能从后台启动输出解析 job id", { raw: scrubSecrets((r.stdout ?? "").slice(0, 300)) });
  return makeOk({ shortId: m[1], raw: r.stdout });
}
