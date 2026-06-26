import { spawnSync } from "node:child_process";

export function resolveRepoRoot(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim();
  return cwd;
}

export function buildDiffArgs({ scope, base } = {}) {
  if (scope === "branch") return ["diff", `${base ?? "HEAD"}...HEAD`];
  return ["diff", "HEAD"];
}

export function collectDiff(cwd, opts = {}) {
  const args = buildDiffArgs(opts);
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  return {
    text: ok ? r.stdout : "",
    args,
    ok,
    stderr: ok ? "" : (r.stderr ?? "").slice(0, 500),
  };
}
