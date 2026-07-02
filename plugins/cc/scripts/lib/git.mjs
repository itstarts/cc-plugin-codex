import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isProbablyText } from "./fs.mjs";

const MAX_UNTRACKED_BYTES = 24 * 1024;
const WORKING_TREE_CONTEXT_ARGS = Object.freeze([
  "git status --short --untracked-files=all",
  "git diff --cached --no-ext-diff --submodule=diff",
  "git diff --no-ext-diff --submodule=diff",
  "git ls-files --others --exclude-standard",
]);

function git(cwd, args, options = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}

function gitChecked(cwd, args) {
  const r = git(cwd, args);
  if (r.status !== 0) throw new Error((r.stderr ?? "").trim() || `git ${args.join(" ")} failed`);
  return r.stdout.trimEnd();
}

export function resolveRepoRoot(cwd) {
  const r = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (r.status === 0) return r.stdout.trim();
  return cwd;
}

export function buildDiffArgs({ scope, base } = {}) {
  if (scope === "branch") return ["diff", `${base ?? "HEAD"}...HEAD`];
  return ["diff", "HEAD"];
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/", "");
    }
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]).status === 0) return `origin/${candidate}`;
    if (git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0) return candidate;
  }
  throw new Error("Unable to detect default branch. Pass --base <ref> or use --scope working-tree.");
}

export function getWorkingTreeState(cwd) {
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const unstaged = gitChecked(cwd, ["diff", "--name-only"]).split("\n").filter(Boolean);
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  return { staged, unstaged, untracked, isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0 };
}

export function resolveReviewTarget(cwd, { scope = "auto", base } = {}) {
  const repoRoot = resolveRepoRoot(cwd);
  if (base) return { mode: "branch", label: `branch diff against ${base}`, baseRef: base, explicit: true };
  if (scope === "working-tree") return { mode: "working-tree", label: "working tree diff", explicit: true };
  if (scope === "branch") {
    const baseRef = detectDefaultBranch(repoRoot);
    return { mode: "branch", label: `branch diff against ${baseRef}`, baseRef, explicit: true };
  }
  if (scope !== "auto") throw new Error(`Unsupported review scope: ${scope}`);
  const state = getWorkingTreeState(repoRoot);
  if (state.isDirty) return { mode: "working-tree", label: "working tree diff", explicit: false };
  const baseRef = detectDefaultBranch(repoRoot);
  return { mode: "branch", label: `branch diff against ${baseRef}`, baseRef, explicit: false };
}

function section(title, body) {
  return [`## ${title}`, "", body && body.trim() ? body.trimEnd() : "(none)", ""].join("\n");
}

function formatUntrackedFile(cwd, relativePath) {
  const fullPath = path.join(cwd, relativePath);
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable file)`;
  }
  if (stat.isDirectory()) return `### ${relativePath}\n(skipped: directory)`;
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }
  let data;
  try {
    data = fs.readFileSync(fullPath);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable file)`;
  }
  if (!isProbablyText(data)) return `### ${relativePath}\n(skipped: binary file)`;
  return [`### ${relativePath}`, "```", data.toString("utf8").trimEnd(), "```"].join("\n");
}

function collectWorkingTreeInput(repoRoot) {
  const state = getWorkingTreeState(repoRoot);
  const status = gitChecked(repoRoot, ["status", "--short", "--untracked-files=all"]);
  const staged = gitChecked(repoRoot, ["diff", "--cached", "--no-ext-diff", "--submodule=diff"]);
  const unstaged = gitChecked(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff"]);
  const untracked = state.untracked.map((file) => formatUntrackedFile(repoRoot, file)).join("\n\n");
  return [
    section("Git Status", status),
    section("Staged Diff", staged),
    section("Unstaged Diff", unstaged),
    section("Untracked Files", untracked),
  ].join("\n");
}

function collectBranchInput(repoRoot, baseRef) {
  const range = `${baseRef}...HEAD`;
  return [
    section("Commit Log", gitChecked(repoRoot, ["log", "--oneline", "--decorate", range])),
    section("Diff Stat", gitChecked(repoRoot, ["diff", "--stat", range])),
    section("Branch Diff", gitChecked(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff", range])),
  ].join("\n");
}

function contextArgsForTarget(target) {
  if (target.mode === "working-tree") return [...WORKING_TREE_CONTEXT_ARGS];
  const range = `${target.baseRef}...HEAD`;
  return [
    `git log --oneline --decorate ${range}`,
    `git diff --stat ${range}`,
    `git diff --no-ext-diff --submodule=diff ${range}`,
  ];
}

export function collectReviewInput(cwd, opts = {}) {
  try {
    const repoRoot = resolveRepoRoot(cwd);
    const target = resolveReviewTarget(repoRoot, opts);
    const text = target.mode === "branch" ? collectBranchInput(repoRoot, target.baseRef) : collectWorkingTreeInput(repoRoot);
    return { ok: true, text, args: contextArgsForTarget(target), target, stderr: "" };
  } catch (error) {
    return { ok: false, text: "", args: [], target: null, stderr: String(error?.message ?? error).slice(0, 500) };
  }
}

export function collectDiff(cwd, opts = {}) {
  const out = collectReviewInput(cwd, opts);
  return { ...out, args: buildDiffArgs(opts) };
}
