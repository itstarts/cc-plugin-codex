import { spawnSync } from "node:child_process";
import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

export function scrubSecrets(text) {
  if (!text) return text;
  return text
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .replace(/(ghp_[A-Za-z0-9]{8,})/g, "[redacted]")
    .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,})/g, "[redacted-jwt]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password)\b(\s*[:=]\s*)(\S+)/gi, "$1$2[redacted]");
}

export function buildClaudeArgs({ mode, repoRoot, model, effort, background, sessionId, resume } = {}) {
  const args = ["-p"];
  if (!background) args.push("--output-format", "json");
  if (mode === "review") args.push("--permission-mode", "plan");
  if (mode === "task") args.push("--permission-mode", "acceptEdits", "--add-dir", repoRoot);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (resume) args.push("--resume", resume);
  if (background) {
    args.push("--background");
    if (sessionId) args.push("--session-id", sessionId);
  }
  return args;
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
