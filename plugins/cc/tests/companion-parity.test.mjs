import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "scripts", "claude-companion.mjs");

// --- Part 1: adversarial-review 子命令 ---

test("adversarial-review 是已知子命令（不返回 invalid_args）", () => {
  // 在无 git 仓库的临时目录运行：应进入 review 管线并因 git/claude 失败而报错，
  // 但绝不应是"未知子命令"。
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-adv-ws-"));
  const r = spawnSync("node", [entry, "adversarial-review", "--json"], {
    encoding: "utf8", cwd: ws, env: { ...process.env, HOME: ws },
  });
  const out = JSON.parse(r.stdout);
  // 无论成功与否，都不应是未知子命令错误
  if (!out.ok) {
    assert.notEqual(out.error.code, "invalid_args", "adversarial-review 不应被当作未知子命令");
    assert.ok(!String(out.error.message).includes("未知子命令"));
  }
});

// --- Part 2: resume-candidate 子命令 ---

test("resume-candidate --json 返回 available 字段", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-rc-ws-"));
  const r = spawnSync("node", [entry, "resume-candidate", "--json"], {
    encoding: "utf8", cwd: ws, env: { ...process.env, HOME: ws },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(typeof out.available, "boolean");
  // 全新工作区无任何后台作业 → 无可续候选
  assert.equal(out.available, false);
  assert.equal(out.candidate, null);
});

// --- Part 2: delegate --fresh 被接受为合法 flag ---

test("task 接受 --fresh 而不报 invalid_args", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-fresh-ws-"));
  // task 需要任务文本；带文本 + --fresh，应进入执行路径（可能因 claude 缺失失败），
  // 但不应因 --fresh 这个 flag 本身报参数错误。
  const r = spawnSync("node", [entry, "task", "--fresh", "do something", "--json"], {
    encoding: "utf8", cwd: ws, env: { ...process.env, HOME: ws, PATH: path.dirname(process.execPath) },
  });
  const out = JSON.parse(r.stdout);
  if (!out.ok) {
    assert.notEqual(out.error.code, "invalid_args");
  }
});

test("task --fresh 与 --resume 互斥 → invalid_args", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-fr-ws-"));
  const r = spawnSync("node", [entry, "task", "--fresh", "--resume", "abc", "go", "--json"], {
    encoding: "utf8", cwd: ws, env: { ...process.env, HOME: ws, PATH: path.dirname(process.execPath) },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "invalid_args");
});

test("resume-candidate：有 task 作业但 claude agents 不可用 → 降级 available:false（不回退到自生成 sessionId）", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-rc2-ws-"));
  const env = { ...process.env, HOME: ws, PATH: path.dirname(process.execPath) };
  const stateLib = path.join(here, "..", "scripts", "lib", "state.mjs");
  // 用状态库写入一条后台 task 作业（sessionId 为插件自生成 UUID，claude 会忽略，不可作可续 id）。
  // state 目录由 os.homedir() 派生，必须与 companion 共用同一 HOME=ws，故经子进程写入。
  const seed = `import { upsertJob } from ${JSON.stringify(stateLib)};
upsertJob(${JSON.stringify(ws)}, { id: "task-deadbeef", kind: "task", shortId: "deadbeef",
  sessionId: "11111111-1111-1111-1111-111111111111", request: { prompt: "x" },
  status: "completed", cwd: ${JSON.stringify(ws)}, startedAt: 1, updatedAt: 1 });`;
  const seeded = spawnSync(process.execPath, ["--input-type=module", "-e", seed], { encoding: "utf8", cwd: ws, env });
  assert.equal(seeded.status, 0, `seed 失败: ${seeded.stderr}`);
  // PATH 仅含 node → claude agents 不可解析 → agentsMap 为空。
  // 修复后：不应回退到 job.sessionId 把自生成 UUID 当真实候选，应降级 available:false。
  const r = spawnSync("node", [entry, "resume-candidate", "--json"], { encoding: "utf8", cwd: ws, env });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.available, false);
  assert.equal(out.candidate, null);
});
