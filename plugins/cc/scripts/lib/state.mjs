import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_JOBS = 50;
const STATE_VERSION = 1;

function workspaceRoot(cwd) {
  try {
    return fs.realpathSync.native(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

export function resolveStateDir(cwd) {
  const root = workspaceRoot(cwd);
  const slug = (path.basename(root).replace(/[^a-zA-Z0-9._-]+/g, "-") || "workspace").slice(0, 40);
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const dirName = `${slug}-${hash}`;
  const primary = path.join(os.homedir(), ".codex", ".cc-plugin", "state", dirName);
  try {
    fs.mkdirSync(primary, { recursive: true });
    return primary;
  } catch {
    const fallback = path.join(os.tmpdir(), "cc-plugin", "state", dirName);
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function stateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function loadState(cwd) {
  const file = stateFile(cwd);
  if (!fs.existsSync(file)) return { version: STATE_VERSION, config: {}, jobs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { version: STATE_VERSION, config: parsed.config ?? {}, jobs: parsed.jobs ?? [] };
  } catch {
    return { version: STATE_VERSION, config: {}, jobs: [] };
  }
}

export function saveState(cwd, state) {
  const jobs = [...(state.jobs ?? [])]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, MAX_JOBS);
  const out = { version: STATE_VERSION, config: state.config ?? {}, jobs };
  fs.writeFileSync(stateFile(cwd), JSON.stringify(out, null, 2));
}

export function upsertJob(cwd, job) {
  const state = loadState(cwd);
  const idx = state.jobs.findIndex((j) => j.id === job.id);
  let stored;
  if (idx === -1) {
    stored = job;
    state.jobs.push(stored);
  } else {
    stored = { ...state.jobs[idx], ...job };
    state.jobs[idx] = stored;
  }
  saveState(cwd, state);
  return stored;
}

export function findJob(cwd, id) {
  return loadState(cwd).jobs.find((j) => j.id === id) ?? null;
}
