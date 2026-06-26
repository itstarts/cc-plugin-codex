export function renderResult(payload, { json } = {}) {
  if (json) return JSON.stringify(payload, null, 2);
  if (payload.ok) {
    const lines = [];
    // 结构化评审 findings 优先按 severity 展示；无 findings 时回退到原始 result 文本
    if (Array.isArray(payload.findings)) {
      lines.push(...renderFindings(payload.findings));
      if (payload.summary) lines.push("", `小结: ${payload.summary}`);
    } else if (Array.isArray(payload.jobs)) {
      lines.push(...renderJobs(payload.jobs));
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

// 后台作业列表的文本展示。lost 态给出明确的人工排查引导，
// 避免用户以为作业凭空消失。
function renderJobs(jobs) {
  if (!jobs.length) return ["暂无后台作业。"];
  const lines = [`后台作业（${jobs.length}）:`];
  let hasLost = false;
  for (const j of jobs) {
    lines.push(`  - ${j.id} [${j.status}] (${j.kind})`);
    if (j.status === "lost") hasLost = true;
  }
  if (hasLost) {
    lines.push("", "部分作业状态为 lost：无法从 claude agents 或 transcript 确认结果。可运行 `claude agents` 手动查看，或重新委派任务。");
  }
  return lines;
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
