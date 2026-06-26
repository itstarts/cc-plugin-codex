export function renderResult(payload, { json } = {}) {
  if (json) return JSON.stringify(payload, null, 2);
  if (payload.ok) {
    const lines = [payload.result ?? ""];
    if (payload.touchedFiles?.length) {
      lines.push("", "改动文件:");
      for (const f of payload.touchedFiles) lines.push(`  - ${f}`);
    }
    if (payload.jobId) lines.push("", `后台作业: ${payload.jobId}`);
    return lines.join("\n");
  }
  return `[错误 ${payload.error?.code ?? "unknown"}] ${payload.error?.message ?? ""}`;
}
