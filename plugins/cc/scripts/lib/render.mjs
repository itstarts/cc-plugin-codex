export function renderResult(payload, { json } = {}) {
  if (json) return JSON.stringify(payload, null, 2);
  if (payload.ok) {
    const lines = [];
    // 结构化评审 findings 优先按 severity 展示；无 findings 时回退到原始 result 文本
    if (Array.isArray(payload.findings)) {
      lines.push(...renderFindings(payload.findings));
      if (payload.summary) lines.push("", `小结: ${payload.summary}`);
    } else {
      lines.push(payload.result ?? "");
    }
    if (payload.touchedFiles?.length) {
      lines.push("", "改动文件:");
      for (const f of payload.touchedFiles) lines.push(`  - ${f}`);
    }
    if (payload.jobId) lines.push("", `后台作业: ${payload.jobId}`);
    return lines.join("\n");
  }
  return `[错误 ${payload.error?.code ?? "unknown"}] ${payload.error?.message ?? ""}`;
}

function renderFindings(findings) {
  if (!findings.length) return ["未发现问题。"];
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  const lines = [`评审发现 ${findings.length} 个问题:`, ""];
  for (const f of sorted) {
    const loc = f.file ? ` (${f.file}${f.line != null ? `:${f.line}` : ""})` : "";
    lines.push(`[${f.severity ?? "?"}] ${f.title ?? ""}${loc}`);
    if (f.detail) lines.push(`  ${f.detail}`);
  }
  return lines;
}
