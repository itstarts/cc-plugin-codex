import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

/**
 * 解析 Codex Stop hook 从 stdin 传入的 JSON 契约。
 * 契约字段见 Codex 0.142 stop.command.input schema：
 *   cwd, hook_event_name:"Stop", last_assistant_message, model,
 *   permission_mode, session_id, stop_hook_active, transcript_path, turn_id。
 * 解析失败或非 Stop 事件返回结构化错误，调用方据此放行（fail-open）。
 */
export function parseStopInput(stdin) {
  if (typeof stdin !== "string" || !stdin.trim()) {
    return makeError(ERROR_CODES.INVALID_JSON, "Stop hook 未收到输入");
  }
  let obj;
  try {
    obj = JSON.parse(stdin);
  } catch {
    return makeError(ERROR_CODES.INVALID_JSON, "Stop hook 输入不是合法 JSON");
  }
  if (!obj || obj.hook_event_name !== "Stop") {
    return makeError(ERROR_CODES.INVALID_ARGS, "非 Stop 事件");
  }
  return makeOk({
    cwd: typeof obj.cwd === "string" ? obj.cwd : null,
    stopHookActive: obj.stop_hook_active === true,
    sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
  });
}

/**
 * 放行输出：Codex Stop hook 省略 decision（或 continue:true）即放行收尾。
 * 可选附带 systemMessage 给用户提示。
 */
export function allowDecision(systemMessage) {
  const out = { continue: true };
  if (systemMessage) out.systemMessage = systemMessage;
  return out;
}

/**
 * 拦截输出：decision:"block" 阻止收尾，reason 必填（Codex 在解析时强制该语义）。
 */
export function blockDecision(reason) {
  return { decision: "block", reason };
}

/**
 * 把评审 findings 映射为门禁决策。
 * 仅当存在 P0/P1 阻断级问题时拦截，其余放行（附带提示）。
 * findings 为结构化数组（见 parseReviewFindings）；无结构化或空则放行。
 */
export function decideFromFindings(findings, summary) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return allowDecision();
  }
  const blockers = findings.filter((f) => f.severity === "P0" || f.severity === "P1");
  if (blockers.length === 0) {
    return allowDecision(`Claude 评审发现 ${findings.length} 个非阻断问题，已放行。`);
  }
  const lines = blockers.map((f) => {
    const loc = f.file ? ` (${f.file}${f.line != null ? `:${f.line}` : ""})` : "";
    return `[${f.severity}] ${f.title}${loc}`;
  });
  const reason = [
    `Claude 评审发现 ${blockers.length} 个阻断级问题，收尾被拦截：`,
    ...lines,
    summary ? `\n小结: ${summary}` : "",
  ].filter(Boolean).join("\n");
  return blockDecision(reason);
}
