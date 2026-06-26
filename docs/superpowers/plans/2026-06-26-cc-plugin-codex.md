# `cc` 插件实现计划（Codex 调用 Claude Code）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Codex 插件 `cc`，让 Codex 通过 headless `claude` CLI 把代码评审（只读）和编码任务（可写）委派给本机 Claude Code，支持前台与后台作业。

**Architecture:** 一个零依赖 Node.js 运行时 `claude-companion.mjs` 作为子命令分发入口，调用 `lib/*.mjs` 各专职模块；Codex 侧以 skills 作为用户入口触发 companion；后台作业复用 Claude Code 原生 `--background`/`agents`/`stop`，companion 只维护本地作业索引 + 防御式 transcript 读取。

**Tech Stack:** Node.js（ESM `.mjs`，仅用内置模块 `node:child_process`/`node:fs`/`node:path`/`node:crypto`/`node:os`/`node:test`/`node:assert`）；Codex 插件清单 `.codex-plugin/plugin.json` + `marketplace.json`；被调用方 `claude` CLI（headless `-p`）。

## Global Constraints

- 运行时零第三方依赖，无 `package.json`，无构建步骤；只用 Node 内置模块。
- 所有脚本为 ESM（`.mjs`），文件首行不需 shebang（统一用 `node <file>` 调用）。
- skill 文档（SKILL.md 正文与 frontmatter）用英文；README、计划、spec 用中文。
- 插件名 `cc`；用户 skill 的目录名与 frontmatter `name` 用 `review` / `delegate`，最终调用名 `cc:review` / `cc:delegate`。
- `plugin.json` 必须含 `interface` 块，且 `interface` 必填字段齐全：`displayName`、`shortDescription`、`longDescription`、`developerName`、`category`、`capabilities`（字符串数组）、`defaultPrompt`（≤3 条，每条 ≤128 字符）。`version` 用严格 semver。**不得**出现 `hooks` 字段（Codex 校验器拒绝）。不得残留 `[TODO: ...]` 占位符。
- 评审走 `--permission-mode plan`（只读）；任务走 `--permission-mode acceptEdits` + `--add-dir <repoRoot>`（请求 Claude 限制写范围，非保证）。
- `claude -p --output-format json` 的成功结果形如 `{"type":"result","subtype":"success","is_error":false,"result":"<text>","session_id":"<uuid>",...}`；失败时 `is_error:true` 或 `subtype` 非 `success`。
- 错误一律返回结构化 JSON，不静默吞错、不返回降级结果。错误码集合：`missing_cli`、`auth_required`、`invalid_json`、`job_not_found`、`transcript_unavailable`、`nonzero_exit`、`timeout`。
- 状态目录：优先 `~/.codex/.cc-plugin/state/<workspace-slug>-<hash>/`，不可用时回退 `os.tmpdir()/cc-plugin/...`。
- **脚本路径解析（未完全确认，需在 Task 12 Step 0 实测）**：Codex 是否像 Claude Code 暴露 `${CLAUDE_PLUGIN_ROOT}` 那样提供 `${CODEX_PLUGIN_ROOT}` 未经官方文档证实。本地证据显示 Codex 侧惯例是 `${PLUGIN_ROOT}`（见 `~/.codex/superpowers/hooks/hooks-codex.json`）+「从 skill 根运行」。因此 SKILL.md 统一用：优先 `${PLUGIN_ROOT}`，未设置时按 skill 自身目录相对定位（`../../scripts/claude-companion.mjs`）。Codex 会把每个 skill 的路径注入上下文，故相对定位可靠。
- 提交信息用 `<type>: 中文描述`（conventional type）。频繁提交，每个 Task 末尾提交一次。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `.codex-plugin/plugin.json` | Codex 插件清单（含 interface 块） |
| `marketplace.json` | 本地 marketplace 描述，指向本插件 |
| `scripts/claude-companion.mjs` | 子命令分发入口：`setup`/`review`/`task`/`status`/`result`/`cancel` |
| `scripts/lib/args.mjs` | CLI 参数解析：路由标志 vs 自由文本 |
| `scripts/lib/errors.mjs` | 错误码常量 + 结构化错误构造 |
| `scripts/lib/state.mjs` | 状态目录解析、作业索引与配置读写 |
| `scripts/lib/git.mjs` | 解析评审目标（working-tree / branch vs base）、定位 repo root |
| `scripts/lib/claude.mjs` | 构建并 spawn `claude`，解析输出（唯一与 claude 交互处） |
| `scripts/lib/transcript.mjs` | 定位实际 transcript 路径、防御式解析最终消息/改动文件 |
| `scripts/lib/jobs.mjs` | 后台作业状态机：创建/查询/取消/读结果，融合 agents 信号 |
| `scripts/lib/render.mjs` | 把结果渲染成给 Codex 看的文本/JSON |
| `skills/review/SKILL.md` | 用户入口：只读评审 |
| `skills/delegate/SKILL.md` | 用户入口：可写任务委派 |
| `skills/claude-cli-runtime/SKILL.md` | 内部：运行时调用契约 |
| `skills/claude-result-handling/SKILL.md` | 内部：结果处理纪律 |
| `skills/claude-prompting/SKILL.md` | 内部：写 prompt 指引 |
| `schemas/review-output.schema.json` | 评审结构化输出 schema |
| `tests/*.test.mjs` | node:test 单测 + fixture 契约测试 |
| `tests/fixtures/` | 真实 agents/transcript/result 样本 |
| `README.md` | 中文使用文档 |

> 与 spec §3.3 的两点有意偏差：(1) 去掉独立的 `fs.mjs`——文件工具量小，并入各使用方更内聚（YAGNI）；(2) 新增 `errors.mjs`——结构化错误是全模块共享的骨架，独立成模块比散落各处更 DRY。其余模块与 spec 一一对应。

---

## Task 1: 插件骨架与清单

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `marketplace.json`
- Test: `tests/lib/validate-manifest.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 合法的 `.codex-plugin/plugin.json`（name=`cc`），供 Codex 加载与 `validate_plugin.py` 通过。

- [ ] **Step 1: 写失败测试，断言 manifest 满足 Codex 校验契约**

`tests/lib/validate-manifest.test.mjs`（注意从 tests 目录回到根：用相对路径读清单）：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));

test("manifest 顶层必填字段", () => {
  assert.equal(manifest.name, "cc");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description?.length > 0);
  assert.ok(manifest.author?.name?.length > 0);
});

test("interface 必填字段齐全", () => {
  const i = manifest.interface;
  for (const f of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    assert.equal(typeof i[f], "string");
    assert.ok(i[f].trim().length > 0, `${f} 非空`);
  }
  assert.ok(Array.isArray(i.capabilities) && i.capabilities.every(c => typeof c === "string" && c.trim()));
  const prompts = i.defaultPrompt ?? i.default_prompt;
  assert.ok(Array.isArray(prompts) && prompts.length >= 1 && prompts.length <= 3);
  assert.ok(prompts.every(p => p.length <= 128));
});

test("禁止出现 hooks 字段（Codex 校验器拒绝）", () => {
  assert.equal("hooks" in manifest, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/lib/validate-manifest.test.mjs`
Expected: FAIL（`.codex-plugin/plugin.json` 不存在 → 读文件抛错）

- [ ] **Step 3: 写 `.codex-plugin/plugin.json`**

```json
{
  "name": "cc",
  "version": "0.1.0",
  "description": "Use Claude Code from Codex to review code or delegate coding tasks.",
  "author": {
    "name": "itstarts"
  },
  "repository": "https://github.com/itstarts/cc-plugin-codex",
  "license": "Apache-2.0",
  "keywords": ["claude-code", "code-review", "delegate", "headless"],
  "skills": "./skills/",
  "interface": {
    "displayName": "Claude Code",
    "shortDescription": "Delegate review and coding tasks to Claude Code",
    "longDescription": "Lets Codex call the local Claude Code CLI to review changes (read-only) or delegate coding tasks (write-capable), with foreground and background jobs.",
    "developerName": "itstarts",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": [
      "Have Claude Code review my current diff.",
      "Delegate this bug fix to Claude Code.",
      "Ask Claude Code to implement this in the background."
    ]
  }
}
```

- [ ] **Step 4: 写 `marketplace.json`**

```json
{
  "name": "itstarts-local",
  "interface": {
    "displayName": "itstarts Local Plugins"
  },
  "plugins": [
    {
      "name": "cc",
      "source": {
        "source": "local",
        "path": "."
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_USE"
      },
      "category": "Productivity"
    }
  ]
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/lib/validate-manifest.test.mjs`
Expected: PASS（3 个 test 全绿）

可选加测（若本机有 Codex 的 plugin-creator 校验器）：
Run: `python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .`
Expected: `Plugin validation passed`（这是 Codex 的权威清单契约校验，能提前发现字段缺失）

- [ ] **Step 6: 提交**

```bash
git add .codex-plugin/plugin.json marketplace.json tests/lib/validate-manifest.test.mjs
git commit -m "feat: 添加 cc 插件清单与 marketplace 骨架"
```

---

## Task 2: 错误码模块

**Files:**
- Create: `scripts/lib/errors.mjs`
- Test: `tests/lib/errors.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `ERROR_CODES`：`{ MISSING_CLI:"missing_cli", AUTH_REQUIRED:"auth_required", INVALID_JSON:"invalid_json", JOB_NOT_FOUND:"job_not_found", TRANSCRIPT_UNAVAILABLE:"transcript_unavailable", NONZERO_EXIT:"nonzero_exit", TIMEOUT:"timeout" }`
  - `makeError(code, message, extra = {}) -> { ok:false, error:{ code, message, ...extra } }`
  - `makeOk(payload) -> { ok:true, ...payload }`

- [ ] **Step 1: 写失败测试**

`tests/lib/errors.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, makeError, makeOk } from "../../scripts/lib/errors.mjs";

test("错误码集合完整", () => {
  assert.deepEqual(Object.values(ERROR_CODES).sort(), [
    "auth_required", "invalid_json", "job_not_found",
    "missing_cli", "nonzero_exit", "timeout", "transcript_unavailable"
  ]);
});

test("makeError 结构", () => {
  const e = makeError(ERROR_CODES.MISSING_CLI, "no claude", { hint: "install" });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, "missing_cli");
  assert.equal(e.error.message, "no claude");
  assert.equal(e.error.hint, "install");
});

test("makeOk 结构", () => {
  const r = makeOk({ result: "hi" });
  assert.equal(r.ok, true);
  assert.equal(r.result, "hi");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/errors.test.mjs`
Expected: FAIL（`errors.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/errors.mjs`：

```javascript
export const ERROR_CODES = Object.freeze({
  MISSING_CLI: "missing_cli",
  AUTH_REQUIRED: "auth_required",
  INVALID_JSON: "invalid_json",
  JOB_NOT_FOUND: "job_not_found",
  TRANSCRIPT_UNAVAILABLE: "transcript_unavailable",
  NONZERO_EXIT: "nonzero_exit",
  TIMEOUT: "timeout",
});

export function makeError(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

export function makeOk(payload = {}) {
  return { ok: true, ...payload };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/errors.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/errors.mjs tests/lib/errors.test.mjs
git commit -m "feat: 添加结构化错误码模块"
```

---

## Task 3: 参数解析模块

**Files:**
- Create: `scripts/lib/args.mjs`
- Test: `tests/lib/args.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `parseArgs(argv, spec) -> { flags, values, positional }`，其中 `spec = { boolean: [...], string: [...] }`；`flags` 是 boolean 标志的 `{name:true}`，`values` 是 string 标志的 `{name:value}`，`positional` 是剩余非标志参数拼成的自由文本数组。
  - 支持 `--flag`、`--key value`、`--key=value`；未在 spec 声明的 `--xxx` 视为未知标志放入 `positional` 原样保留（便于错误提示），但布尔/字符串已声明者优先。

- [ ] **Step 1: 写失败测试**

`tests/lib/args.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../../scripts/lib/args.mjs";

const spec = { boolean: ["background", "wait", "fresh"], string: ["base", "scope", "model", "effort", "resume"] };

test("分离布尔标志与自由文本", () => {
  const r = parseArgs(["--background", "fix", "the", "bug"], spec);
  assert.equal(r.flags.background, true);
  assert.equal(r.positional.join(" "), "fix the bug");
});

test("string 标志支持空格与等号两种写法", () => {
  const a = parseArgs(["--base", "main", "--scope=branch", "review"], spec);
  assert.equal(a.values.base, "main");
  assert.equal(a.values.scope, "branch");
  assert.equal(a.positional.join(" "), "review");
});

test("未声明标志保留在 positional", () => {
  const r = parseArgs(["--unknown", "x"], spec);
  assert.ok(r.positional.includes("--unknown"));
});

test("缺省安全：空 argv", () => {
  const r = parseArgs([], spec);
  assert.deepEqual(r.flags, {});
  assert.deepEqual(r.values, {});
  assert.deepEqual(r.positional, []);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/args.test.mjs`
Expected: FAIL（`args.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/args.mjs`：

```javascript
export function parseArgs(argv, spec = {}) {
  const boolSet = new Set(spec.boolean ?? []);
  const strSet = new Set(spec.string ?? []);
  const flags = {};
  const values = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      if (boolSet.has(name)) {
        flags[name] = true;
        continue;
      }
      if (strSet.has(name)) {
        if (eq !== -1) {
          values[name] = tok.slice(eq + 1);
        } else if (i + 1 < argv.length) {
          values[name] = argv[++i];
        } else {
          values[name] = "";
        }
        continue;
      }
      positional.push(tok); // 未声明标志，原样保留
      continue;
    }
    positional.push(tok);
  }
  return { flags, values, positional };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/args.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/args.mjs tests/lib/args.test.mjs
git commit -m "feat: 添加 CLI 参数解析模块"
```

---

## Task 4: 状态目录与作业索引模块

**Files:**
- Create: `scripts/lib/state.mjs`
- Test: `tests/lib/state.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `resolveStateDir(cwd) -> string`（按 realpath 后的 workspace 根 hash 分目录；优先 `~/.codex/.cc-plugin/state/<slug>-<hash>`，否则 `os.tmpdir()/cc-plugin/state/<slug>-<hash>`）
  - `loadState(cwd) -> { version, config, jobs }`（缺省 `{ version:1, config:{}, jobs:[] }`）
  - `saveState(cwd, state) -> void`（最多保留 50 条 jobs，按 `updatedAt` 倒序）
  - `upsertJob(cwd, job) -> job`（按 `id` 插入或合并，写盘）
  - `findJob(cwd, id) -> job | null`

- [ ] **Step 1: 写失败测试**

`tests/lib/state.test.mjs`（用临时目录隔离 HOME，避免污染真实 `~/.codex`）：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
const { loadState, saveState, upsertJob, findJob, resolveStateDir } = await import("../../scripts/lib/state.mjs");

const cwd = mkdtempSync(path.join(os.tmpdir(), "cc-ws-"));

test("缺省 state", () => {
  const s = loadState(cwd);
  assert.equal(s.version, 1);
  assert.deepEqual(s.jobs, []);
});

test("upsert 与 find", () => {
  upsertJob(cwd, { id: "j1", status: "running", updatedAt: 1 });
  upsertJob(cwd, { id: "j1", status: "completed", updatedAt: 2 });
  const j = findJob(cwd, "j1");
  assert.equal(j.status, "completed");
});

test("state 目录在 HOME 下", () => {
  assert.ok(resolveStateDir(cwd).startsWith(process.env.HOME));
});

test("最多保留 50 条", () => {
  for (let i = 0; i < 60; i++) upsertJob(cwd, { id: `k${i}`, updatedAt: i });
  const s = loadState(cwd);
  assert.ok(s.jobs.length <= 50);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/state.test.mjs`
Expected: FAIL（`state.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/state.mjs`：

```javascript
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
  if (idx === -1) state.jobs.push(job);
  else state.jobs[idx] = { ...state.jobs[idx], ...job };
  saveState(cwd, state);
  return job;
}

export function findJob(cwd, id) {
  return loadState(cwd).jobs.find((j) => j.id === id) ?? null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/state.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/state.mjs tests/lib/state.test.mjs
git commit -m "feat: 添加状态目录与作业索引模块"
```

---

## Task 5: git 目标解析模块

**Files:**
- Create: `scripts/lib/git.mjs`
- Test: `tests/lib/git.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `resolveRepoRoot(cwd) -> string`（`git rev-parse --show-toplevel`，失败回退 `cwd`）
  - `buildDiffArgs({ scope, base }) -> string[]`：
    - `scope==="branch"` → `["diff", `${base ?? "HEAD"}...HEAD`]`
    - 否则（working-tree）→ `["diff", "HEAD"]`
  - `collectDiff(cwd, { scope, base }) -> { text, args }`（运行 git，返回 diff 文本；空 diff 返回空串）

- [ ] **Step 1: 写失败测试**

`tests/lib/git.test.mjs`（buildDiffArgs 纯函数可独立测）：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiffArgs } from "../../scripts/lib/git.mjs";

test("working-tree 默认 diff HEAD", () => {
  assert.deepEqual(buildDiffArgs({ scope: "working-tree" }), ["diff", "HEAD"]);
});

test("branch scope 用三点 diff", () => {
  assert.deepEqual(buildDiffArgs({ scope: "branch", base: "main" }), ["diff", "main...HEAD"]);
});

test("branch scope 缺 base 回退 HEAD", () => {
  assert.deepEqual(buildDiffArgs({ scope: "branch" }), ["diff", "HEAD...HEAD"]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/git.test.mjs`
Expected: FAIL（`git.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/git.mjs`：

```javascript
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
  return { text: r.status === 0 ? r.stdout : "", args };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/git.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/git.mjs tests/lib/git.test.mjs
git commit -m "feat: 添加 git 评审目标解析模块"
```

---

## Task 6: claude 调用模块（核心）

**Files:**
- Create: `scripts/lib/claude.mjs`
- Test: `tests/lib/claude.test.mjs`

**Interfaces:**
- Consumes: `ERROR_CODES`, `makeError`, `makeOk`（来自 errors.mjs）
- Produces:
  - `buildClaudeArgs({ mode, repoRoot, model, effort, background, sessionId, resume }) -> string[]`
    - 公共：`["-p", "--output-format", "json"]`
    - `mode==="review"` → 追加 `["--permission-mode", "plan"]`
    - `mode==="task"` → 追加 `["--permission-mode", "acceptEdits", "--add-dir", repoRoot]`
    - `model` → `["--model", model]`；`effort` → `["--effort", effort]`
    - `background` → `["--background"]` 且把 `--output-format json` 省略（后台无单一结果）；并追加 `["--session-id", sessionId]`
    - `resume` → `["--resume", resume]`
  - `parseClaudeJson(stdout) -> { ok, result?, sessionId?, error? }`：解析 `{type:"result",subtype,is_error,result,session_id}`；`subtype!=="success"||is_error` → `makeError(...)`；非 JSON → `INVALID_JSON`
  - `classifyFailure({ status, stderr }) -> errorCode`：stderr 含 "command not found"/ENOENT → `MISSING_CLI`；含 "log in"/"authenticate"/"Invalid API key" → `AUTH_REQUIRED`；否则 `NONZERO_EXIT`
  - `runClaudeForeground({ prompt, args, cwd, timeoutMs }) -> result`（spawn，stdin 传 prompt，解析 stdout）
  - `startClaudeBackground({ prompt, args, cwd }) -> { shortId, raw }`（spawn `--background`，解析 "backgrounded · <id>" 行取 shortId）

- [ ] **Step 1: 写失败测试（纯函数部分）**

`tests/lib/claude.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, parseClaudeJson, classifyFailure } from "../../scripts/lib/claude.mjs";
import { ERROR_CODES } from "../../scripts/lib/errors.mjs";

test("review 模式走 plan 只读", () => {
  const a = buildClaudeArgs({ mode: "review", repoRoot: "/repo" });
  assert.ok(a.includes("--permission-mode") && a.includes("plan"));
  assert.ok(!a.includes("--add-dir"));
});

test("task 模式走 acceptEdits + add-dir", () => {
  const a = buildClaudeArgs({ mode: "task", repoRoot: "/repo" });
  const i = a.indexOf("--permission-mode");
  assert.equal(a[i + 1], "acceptEdits");
  const d = a.indexOf("--add-dir");
  assert.equal(a[d + 1], "/repo");
});

test("background 注入 session-id 且不带 json 单结果", () => {
  const a = buildClaudeArgs({ mode: "task", repoRoot: "/repo", background: true, sessionId: "u-1" });
  assert.ok(a.includes("--background"));
  assert.ok(a.includes("--session-id") && a.includes("u-1"));
  assert.ok(!(a.includes("--output-format") && a.includes("json")));
});

test("解析成功结果", () => {
  const r = parseClaudeJson(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "hi", session_id: "s1" }));
  assert.equal(r.ok, true);
  assert.equal(r.result, "hi");
  assert.equal(r.sessionId, "s1");
});

test("解析失败结果 → 错误", () => {
  const r = parseClaudeJson(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "" }));
  assert.equal(r.ok, false);
});

test("非 JSON → invalid_json", () => {
  const r = parseClaudeJson("not json");
  assert.equal(r.error.code, ERROR_CODES.INVALID_JSON);
});

test("classifyFailure 识别缺失与鉴权", () => {
  assert.equal(classifyFailure({ status: 127, stderr: "command not found: claude" }), ERROR_CODES.MISSING_CLI);
  assert.equal(classifyFailure({ status: 1, stderr: "Please log in to continue" }), ERROR_CODES.AUTH_REQUIRED);
  assert.equal(classifyFailure({ status: 1, stderr: "boom" }), ERROR_CODES.NONZERO_EXIT);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/claude.test.mjs`
Expected: FAIL（`claude.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/claude.mjs`：

```javascript
import { spawnSync } from "node:child_process";
import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

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
    return makeError(ERROR_CODES.INVALID_JSON, "claude 输出不是合法 JSON", { raw: stdout.slice(0, 500) });
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
    return makeError(code, `claude 退出码 ${r.status}`, { stderr: (r.stderr ?? "").slice(0, 500) });
  }
  return parseClaudeJson(r.stdout ?? "");
}

export function startClaudeBackground({ prompt, args, cwd }) {
  const r = spawnSync("claude", args, { cwd, input: prompt, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.error && r.error.code === "ENOENT") return makeError(ERROR_CODES.MISSING_CLI, "未找到 claude 命令");
  if (r.status !== 0) {
    const code = classifyFailure({ status: r.status, stderr: r.stderr ?? "" });
    return makeError(code, `claude 后台启动失败，退出码 ${r.status}`, { stderr: (r.stderr ?? "").slice(0, 500) });
  }
  const m = (r.stdout ?? "").match(/backgrounded\s+·\s+([0-9a-f]+)/i);
  if (!m) return makeError(ERROR_CODES.INVALID_JSON, "未能从后台启动输出解析 job id", { raw: (r.stdout ?? "").slice(0, 300) });
  return makeOk({ shortId: m[1], raw: r.stdout });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/claude.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/claude.mjs tests/lib/claude.test.mjs
git commit -m "feat: 添加 claude 调用与输出解析模块"
```

---

## Task 7: transcript 防御式解析模块

**Files:**
- Create: `scripts/lib/transcript.mjs`
- Test: `tests/lib/transcript.test.mjs`
- Test fixtures: `tests/fixtures/transcript-normal.jsonl`, `tests/fixtures/transcript-corrupt.jsonl`

**Interfaces:**
- Consumes: `ERROR_CODES`, `makeError`, `makeOk`
- Produces:
  - `transcriptPathFor(cwd, sessionId) -> string`：`~/.claude/projects/<slug>/<sessionId>.jsonl`，slug = realpath(cwd) 把 `/` 和 `.` 替换为 `-`（与 Claude 约定一致）
  - `parseTranscript(filePath) -> { ok, result?, touchedFiles?, error? }`：逐行容错解析 JSONL；取最后一条 assistant/result 文本；收集文件改动记录；文件不存在或无终结消息 → `TRANSCRIPT_UNAVAILABLE`

- [ ] **Step 1: 准备 fixtures 与失败测试**

`tests/fixtures/transcript-normal.jsonl`（两行：一条 assistant 文本 + 一条 result）：

```jsonl
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"intermediate"}]}}
{"type":"result","subtype":"success","is_error":false,"result":"final answer","session_id":"s-normal"}
```

`tests/fixtures/transcript-corrupt.jsonl`（一条损坏行 + 一条正常 result）：

```jsonl
{"type":"assistant", THIS IS BROKEN
{"type":"result","subtype":"success","is_error":false,"result":"recovered","session_id":"s-corrupt"}
```

`tests/lib/transcript.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript, transcriptPathFor } from "../../scripts/lib/transcript.mjs";
import { ERROR_CODES } from "../../scripts/lib/errors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, "..", "fixtures", n);

test("正常 transcript 取最终结果", () => {
  const r = parseTranscript(fx("transcript-normal.jsonl"));
  assert.equal(r.ok, true);
  assert.equal(r.result, "final answer");
});

test("损坏行被跳过仍能恢复结果", () => {
  const r = parseTranscript(fx("transcript-corrupt.jsonl"));
  assert.equal(r.ok, true);
  assert.equal(r.result, "recovered");
});

test("文件不存在 → transcript_unavailable", () => {
  const r = parseTranscript(fx("does-not-exist.jsonl"));
  assert.equal(r.error.code, ERROR_CODES.TRANSCRIPT_UNAVAILABLE);
});

test("路径包含 sessionId 与 projects", () => {
  const p = transcriptPathFor("/tmp/x", "abc");
  assert.ok(p.includes("/.claude/projects/"));
  assert.ok(p.endsWith("abc.jsonl"));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/transcript.test.mjs`
Expected: FAIL（`transcript.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/transcript.mjs`：

```javascript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ERROR_CODES, makeError, makeOk } from "./errors.mjs";

export function transcriptPathFor(cwd, sessionId) {
  let root = cwd;
  try {
    root = fs.realpathSync.native(cwd);
  } catch {
    root = path.resolve(cwd);
  }
  const slug = root.replace(/[/.]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}

export function parseTranscript(filePath) {
  if (!fs.existsSync(filePath)) {
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 文件不存在", { filePath });
  }
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf8").split("\n");
  } catch (e) {
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 读取失败", { filePath });
  }
  let finalText = null;
  const touchedFiles = new Set();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue; // 跳过损坏行
    }
    if (obj.type === "result" && typeof obj.result === "string") {
      finalText = obj.result;
    } else if (obj.type === "assistant" && obj.message?.content) {
      const texts = obj.message.content.filter((c) => c.type === "text").map((c) => c.text);
      if (texts.length) finalText = texts.join("\n");
    }
    // 收集文件改动：tool_use 中的 Edit/Write 路径
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      for (const c of obj.message.content) {
        if (c.type === "tool_use" && (c.name === "Edit" || c.name === "Write") && c.input?.file_path) {
          touchedFiles.add(c.input.file_path);
        }
      }
    }
  }
  if (finalText === null) {
    return makeError(ERROR_CODES.TRANSCRIPT_UNAVAILABLE, "transcript 无终结消息", { filePath });
  }
  return makeOk({ result: finalText, touchedFiles: [...touchedFiles] });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/transcript.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/transcript.mjs tests/lib/transcript.test.mjs tests/fixtures/transcript-normal.jsonl tests/fixtures/transcript-corrupt.jsonl
git commit -m "feat: 添加防御式 transcript 解析模块"
```

---

## Task 8: 渲染模块

**Files:**
- Create: `scripts/lib/render.mjs`
- Test: `tests/lib/render.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `renderResult(payload, { json }) -> string`：`json===true` 返回 `JSON.stringify(payload,null,2)`；否则返回人类可读文本（成功印 result + 改动文件列表；失败印 `error.code` + message）

- [ ] **Step 1: 写失败测试**

`tests/lib/render.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderResult } from "../../scripts/lib/render.mjs";

test("json 模式返回结构化", () => {
  const out = renderResult({ ok: true, result: "hi" }, { json: true });
  assert.deepEqual(JSON.parse(out), { ok: true, result: "hi" });
});

test("文本模式成功展示 result", () => {
  const out = renderResult({ ok: true, result: "done", touchedFiles: ["a.js"] }, { json: false });
  assert.ok(out.includes("done"));
  assert.ok(out.includes("a.js"));
});

test("文本模式失败展示错误码", () => {
  const out = renderResult({ ok: false, error: { code: "auth_required", message: "login" } }, { json: false });
  assert.ok(out.includes("auth_required"));
  assert.ok(out.includes("login"));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/render.test.mjs`
Expected: FAIL

- [ ] **Step 3: 写实现**

`scripts/lib/render.mjs`：

```javascript
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
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/render.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/render.mjs tests/lib/render.test.mjs
git commit -m "feat: 添加结果渲染模块"
```

---

## Task 9: 作业状态机模块

**Files:**
- Create: `scripts/lib/jobs.mjs`
- Test: `tests/lib/jobs.test.mjs`
- Test fixtures: `tests/fixtures/agents-list.json`

**Interfaces:**
- Consumes: `state.mjs`（upsertJob/findJob/loadState）、`transcript.mjs`（parseTranscript）、`errors.mjs`
- Produces:
  - `STATUSES = ["queued","running","completed","failed","cancelled","unknown","lost"]`
  - `adaptAgentsList(rawJson) -> Map<sessionId|shortId, { state }>`：解析 `claude agents --json` 数组；缺字段时该项 `state:"unknown"`
  - `reconcileStatus(job, agentsMap, transcriptResult) -> status`：融合逻辑（见 spec §6.3）
  - `createJob({ cwd, kind, shortId, sessionId, request }) -> job`
  - `readJobResult(cwd, jobId) -> result`（取 transcript；无则 `transcript_unavailable`）

- [ ] **Step 1: 准备 fixture 与失败测试**

`tests/fixtures/agents-list.json`（真实形状：后台项带 state，前台项不带）：

```json
[
  {"id":"ee603293","kind":"background","sessionId":"ee603293-22dc-4767-aa2d-78204e0bdb45","state":"done"},
  {"pid":44819,"kind":"interactive","sessionId":"ea540887-591f-4b09-8e60-3cf5b6a1f78f"}
]
```

`tests/lib/jobs.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptAgentsList, reconcileStatus } from "../../scripts/lib/jobs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentsRaw = readFileSync(path.join(here, "..", "fixtures", "agents-list.json"), "utf8");

test("adaptAgentsList 解析后台 state", () => {
  const m = adaptAgentsList(agentsRaw);
  assert.equal(m.get("ee603293")?.state, "done");
});

test("前台项无 state 标 unknown", () => {
  const m = adaptAgentsList(agentsRaw);
  assert.equal(m.get("ea540887-591f-4b09-8e60-3cf5b6a1f78f")?.state, "unknown");
});

test("agents 报 done → completed", () => {
  const m = adaptAgentsList(agentsRaw);
  const s = reconcileStatus({ shortId: "ee603293" }, m, null);
  assert.equal(s, "completed");
});

test("agents 查不到但 transcript 有结果 → completed", () => {
  const s = reconcileStatus({ shortId: "zzz" }, new Map(), { ok: true, result: "x" });
  assert.equal(s, "completed");
});

test("agents 查不到且无 transcript → lost", () => {
  const s = reconcileStatus({ shortId: "zzz" }, new Map(), { ok: false });
  assert.equal(s, "lost");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/lib/jobs.test.mjs`
Expected: FAIL（`jobs.mjs` 不存在）

- [ ] **Step 3: 写实现**

`scripts/lib/jobs.mjs`：

```javascript
import { upsertJob, findJob } from "./state.mjs";
import { transcriptPathFor, parseTranscript } from "./transcript.mjs";
import { ERROR_CODES, makeError } from "./errors.mjs";

export const STATUSES = ["queued", "running", "completed", "failed", "cancelled", "unknown", "lost"];

export function adaptAgentsList(rawJson) {
  const map = new Map();
  let arr;
  try {
    arr = JSON.parse(rawJson);
  } catch {
    return map;
  }
  if (!Array.isArray(arr)) return map;
  for (const item of arr) {
    const key = item.id ?? item.sessionId ?? null;
    if (!key) continue;
    const state = typeof item.state === "string" ? item.state : "unknown";
    map.set(key, { state });
    if (item.sessionId && item.sessionId !== key) map.set(item.sessionId, { state });
  }
  return map;
}

export function reconcileStatus(job, agentsMap, transcriptResult) {
  const hit = agentsMap.get(job.shortId) ?? (job.sessionId ? agentsMap.get(job.sessionId) : null);
  if (hit) {
    if (hit.state === "done" || hit.state === "completed") return "completed";
    if (hit.state === "unknown") return transcriptResult?.ok ? "completed" : "unknown";
    return "running";
  }
  if (transcriptResult?.ok) return "completed";
  return "lost";
}

export function createJob({ cwd, kind, shortId, sessionId, request }) {
  const id = `${kind}-${shortId}`;
  const now = Date.now();
  const job = { id, kind, shortId, sessionId, request, status: "running", cwd,
    transcriptPath: transcriptPathFor(cwd, sessionId), startedAt: now, updatedAt: now };
  return upsertJob(cwd, job);
}

export function readJobResult(cwd, jobId) {
  const job = findJob(cwd, jobId);
  if (!job) return makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`);
  return parseTranscript(job.transcriptPath ?? transcriptPathFor(cwd, job.sessionId));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/lib/jobs.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/jobs.mjs tests/lib/jobs.test.mjs tests/fixtures/agents-list.json
git commit -m "feat: 添加后台作业状态机模块"
```

---

## Task 10: companion 分发入口 + review/task 子命令

**Files:**
- Create: `scripts/claude-companion.mjs`
- Test: `tests/companion.test.mjs`

**Interfaces:**
- Consumes: 全部 lib 模块
- Produces: 可执行入口 `node scripts/claude-companion.mjs <sub> [args]`，子命令 `setup`/`review`/`task`/`status`/`result`/`cancel`，统一输出（默认人类可读，带 `--json` 输出结构化）。本任务实现 `review` 与 `task`（前台+后台），其余子命令在 Task 11。

- [ ] **Step 1: 写失败测试（用 --help/未知子命令的稳定行为 + dry 检查）**

`tests/companion.test.mjs`（调用入口，断言未知子命令返回结构化错误，不依赖真实 claude）：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "scripts", "claude-companion.mjs");

test("未知子命令返回结构化错误 JSON", () => {
  const r = spawnSync("node", [entry, "bogus", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.error.message.includes("bogus"));
});

test("无子命令打印用法且非零退出", () => {
  const r = spawnSync("node", [entry], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/companion.test.mjs`
Expected: FAIL（入口不存在）

- [ ] **Step 3: 写实现**

`scripts/claude-companion.mjs`：

```javascript
import { parseArgs } from "./lib/args.mjs";
import { resolveRepoRoot, collectDiff } from "./lib/git.mjs";
import { buildClaudeArgs, runClaudeForeground, startClaudeBackground } from "./lib/claude.mjs";
import { createJob } from "./lib/jobs.mjs";
import { renderResult } from "./lib/render.mjs";
import { ERROR_CODES, makeError, makeOk } from "./lib/errors.mjs";
import { randomUUID } from "node:crypto";

const SPEC = { boolean: ["background", "wait", "fresh", "json"], string: ["base", "scope", "model", "effort", "resume"] };

function buildReviewPrompt(diffText, focus) {
  const parts = [
    "You are reviewing code changes. Read-only: do not modify files.",
    focus ? `Focus: ${focus}` : "",
    "Report findings grouped by severity. Be concrete (file:line).",
    "",
    "=== DIFF ===",
    diffText || "(empty diff)",
  ];
  return parts.filter(Boolean).join("\n");
}

function cmdReview(rest, cwd) {
  const { flags, values, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const repoRoot = resolveRepoRoot(cwd);
  const { text } = collectDiff(cwd, { scope: values.scope ?? "working-tree", base: values.base });
  const prompt = buildReviewPrompt(text, positional.join(" "));
  if (flags.background) {
    const sessionId = randomUUID();
    const args = buildClaudeArgs({ mode: "review", repoRoot, model: values.model, background: true, sessionId });
    const started = startClaudeBackground({ prompt, args, cwd });
    if (!started.ok) return { out: started, json };
    const job = createJob({ cwd, kind: "review", shortId: started.shortId, sessionId, request: { scope: values.scope, base: values.base } });
    return { out: makeOk({ jobId: job.id, shortId: started.shortId, status: "running" }), json };
  }
  const args = buildClaudeArgs({ mode: "review", repoRoot, model: values.model });
  return { out: runClaudeForeground({ prompt, args, cwd, timeoutMs: 0 }), json };
}

function cmdTask(rest, cwd) {
  const { flags, values, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const repoRoot = resolveRepoRoot(cwd);
  const prompt = positional.join(" ").trim();
  if (!prompt) return { out: makeError(ERROR_CODES.INVALID_JSON, "task 需要任务描述文本"), json };
  if (flags.background) {
    const sessionId = randomUUID();
    const args = buildClaudeArgs({ mode: "task", repoRoot, model: values.model, effort: values.effort, background: true, sessionId, resume: values.resume });
    const started = startClaudeBackground({ prompt, args, cwd });
    if (!started.ok) return { out: started, json };
    const job = createJob({ cwd, kind: "task", shortId: started.shortId, sessionId, request: { prompt } });
    return { out: makeOk({ jobId: job.id, shortId: started.shortId, status: "running" }), json };
  }
  const args = buildClaudeArgs({ mode: "task", repoRoot, model: values.model, effort: values.effort, resume: values.resume });
  return { out: runClaudeForeground({ prompt, args, cwd, timeoutMs: 0 }), json };
}

function usage() {
  return "用法: claude-companion <setup|review|task|status|result|cancel> [args] [--json]";
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  if (!sub) {
    process.stderr.write(usage() + "\n");
    process.exit(2);
  }
  let res;
  switch (sub) {
    case "review": res = cmdReview(rest, cwd); break;
    case "task": res = cmdTask(rest, cwd); break;
    // status/result/cancel/setup 在 Task 11 接入
    default: {
      const json = rest.includes("--json");
      res = { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未知子命令: ${sub}`), json };
    }
  }
  process.stdout.write(renderResult(res.out, { json: res.json }) + "\n");
  process.exit(res.out.ok ? 0 : 1);
}

main();
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/companion.test.mjs`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

Run: `node --test`
Expected: 所有 test 文件 PASS

```bash
git add scripts/claude-companion.mjs tests/companion.test.mjs
git commit -m "feat: 添加 companion 入口与 review/task 子命令"
```

---

## Task 11: status / result / cancel / setup 子命令

**Files:**
- Modify: `scripts/claude-companion.mjs`（接入 4 个子命令）
- Test: `tests/companion-jobs.test.mjs`

**Interfaces:**
- Consumes: `jobs.mjs`（adaptAgentsList/reconcileStatus/readJobResult）、`state.mjs`（loadState）、`claude.mjs`
- Produces: `status`（列作业 + 融合状态）、`result <jobId>`（读 transcript）、`cancel <jobId>`（`claude stop`）、`setup`（检查 claude 安装/登录 + 探测 transcript 契约写入 config）

- [ ] **Step 1: 写失败测试**

`tests/companion-jobs.test.mjs`（用隔离 HOME + 预置 state，断言 result 对未知 job 报 job_not_found）：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "scripts", "claude-companion.mjs");
const home = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));

test("result 未知 job → job_not_found", () => {
  const r = spawnSync("node", [entry, "result", "nope", "--json"], { encoding: "utf8", env: { ...process.env, HOME: home } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "job_not_found");
});

test("status --json 返回作业数组结构", () => {
  const r = spawnSync("node", [entry, "status", "--json"], { encoding: "utf8", env: { ...process.env, HOME: home } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.jobs));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/companion-jobs.test.mjs`
Expected: FAIL（status/result 尚未接入，命中 default 分支返回 job_not_found 但 message 是"未知子命令"，断言 `out.jobs` 失败）

- [ ] **Step 3: 写实现（在 companion 中新增函数并接入 switch）**

在 `scripts/claude-companion.mjs` 顶部 import 增补：

```javascript
import { loadState } from "./lib/state.mjs";
import { adaptAgentsList, reconcileStatus, readJobResult } from "./lib/jobs.mjs";
import { spawnSync } from "node:child_process";
```

新增子命令函数：

```javascript
function cmdStatus(rest, cwd) {
  const { flags } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const agents = spawnSync("claude", ["agents", "--json", "--all"], { cwd, encoding: "utf8" });
  const agentsMap = agents.status === 0 ? adaptAgentsList(agents.stdout) : new Map();
  const jobs = loadState(cwd).jobs.map((j) => {
    const tr = j.transcriptPath ? readJobResult(cwd, j.id) : null;
    return { id: j.id, kind: j.kind, status: reconcileStatus(j, agentsMap, tr), startedAt: j.startedAt };
  });
  return { out: makeOk({ jobs }), json };
}

function cmdResult(rest, cwd) {
  const { flags, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobId = positional[0];
  if (!jobId) return { out: makeError(ERROR_CODES.JOB_NOT_FOUND, "result 需要 jobId"), json };
  return { out: readJobResult(cwd, jobId), json };
}

function cmdCancel(rest, cwd) {
  const { flags, positional } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const jobId = positional[0];
  const state = loadState(cwd);
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return { out: makeError(ERROR_CODES.JOB_NOT_FOUND, `未找到作业 ${jobId}`), json };
  const r = spawnSync("claude", ["stop", job.shortId], { cwd, encoding: "utf8" });
  return { out: makeOk({ jobId, cancelled: r.status === 0 }), json };
}

function cmdSetup(rest, cwd) {
  const { flags } = parseArgs(rest, SPEC);
  const json = !!flags.json;
  const ver = spawnSync("claude", ["--version"], { cwd, encoding: "utf8" });
  if (ver.status !== 0) return { out: makeError(ERROR_CODES.MISSING_CLI, "未检测到 claude，请安装 Claude Code CLI"), json };
  return { out: makeOk({ claudeVersion: ver.stdout.trim(), ready: true }), json };
}
```

在 `main()` 的 switch 中接入：

```javascript
    case "status": res = cmdStatus(rest, cwd); break;
    case "result": res = cmdResult(rest, cwd); break;
    case "cancel": res = cmdCancel(rest, cwd); break;
    case "setup": res = cmdSetup(rest, cwd); break;
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/companion-jobs.test.mjs`
Expected: PASS

- [ ] **Step 5: 全量测试 + 提交**

Run: `node --test`
Expected: 全绿

```bash
git add scripts/claude-companion.mjs tests/companion-jobs.test.mjs
git commit -m "feat: 接入 status/result/cancel/setup 子命令"
```

---

## Task 12: 用户入口 skills（review / delegate）

**Files:**
- Create: `skills/review/SKILL.md`
- Create: `skills/delegate/SKILL.md`
- Test: `tests/skills.test.mjs`

**Interfaces:**
- Consumes: companion 子命令 `review` / `task`
- Produces: 两个用户可触发 skill；frontmatter `name`=`review`/`delegate`，含 `description`（英文，含触发条件与外发知情）。

- [ ] **Step 0: 实测 Codex 的插件根环境变量，确定 SKILL.md 用哪种引用**

安装本插件到 Codex 后，在一个 Codex 会话里触发任意一个本插件 skill 并让它运行 `env | grep -iE 'PLUGIN_ROOT|CODEX'`，或直接查看 Codex 是否设置 `CODEX_PLUGIN_ROOT` / `PLUGIN_ROOT`。
- 若存在某个 `*_PLUGIN_ROOT`，SKILL.md 用 `${该变量}/scripts/claude-companion.mjs`。
- 若都不存在，改用 skill 目录相对路径：SKILL.md 指示从 skill 根运行 `node ../../scripts/claude-companion.mjs ...`（skill 在 `skills/<name>/`，回到插件根是 `../../`）。
- 把确认结果记入 `tests/SMOKE.md`，并据此统一下面两个 SKILL.md 的命令行。下面模板默认写 `${PLUGIN_ROOT}` 兜底为相对路径的形式。

- [ ] **Step 1: 写失败测试（skill 文档契约）**

`tests/skills.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function frontmatter(p) {
  const txt = readFileSync(p, "utf8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${p} 缺少 frontmatter`);
  return { raw: txt, fm: m[1] };
}

for (const name of ["review", "delegate"]) {
  test(`${name} skill 存在且 frontmatter 含 name/description`, () => {
    const p = path.join(root, "skills", name, "SKILL.md");
    assert.ok(existsSync(p), `${p} 不存在`);
    const { fm } = frontmatter(p);
    assert.match(fm, new RegExp(`name:\\s*${name}`));
    assert.match(fm, /description:/);
  });
}

test("review skill 引用 companion review 子命令", () => {
  const txt = readFileSync(path.join(root, "skills", "review", "SKILL.md"), "utf8");
  assert.ok(txt.includes("claude-companion.mjs") && txt.includes("review"));
});

test("delegate skill 引用 companion task 子命令并含外发知情", () => {
  const txt = readFileSync(path.join(root, "skills", "delegate", "SKILL.md"), "utf8");
  assert.ok(txt.includes("claude-companion.mjs") && txt.includes("task"));
  assert.match(txt.toLowerCase(), /anthropic|external|send/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/skills.test.mjs`
Expected: FAIL（skill 文件不存在）

- [ ] **Step 3: 写 `skills/review/SKILL.md`**

```markdown
---
name: review
description: Use when the user asks Codex to have Claude Code (or "Claude") review the current changes, a diff, a branch, or a PR — read-only. The prompt and selected repository context are sent to Claude Code, which runs inference on Anthropic's service. Do not use for ordinary in-Codex review unless the user names Claude Code.
metadata:
  short-description: Delegate a read-only review to Claude Code
---

# Claude Code Review

Delegate a read-only code review to the local Claude Code CLI.

Run exactly one command, forwarding the user's raw arguments. Use `${PLUGIN_ROOT}` if Codex sets it; otherwise run from the skill root with the relative path:

```bash
# 若 Codex 提供插件根变量：
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" review <ARGS>
# 否则从本 skill 目录运行：
node "../../scripts/claude-companion.mjs" review <ARGS>
```

Argument rules:
- `--base <ref>` and `--scope working-tree|branch` select the diff target.
- Free text after flags is treated as an optional review focus.
- `--background` runs as a Claude background job (use for large reviews); otherwise foreground.
- `--model <alias>` optionally selects the Claude model.
- Add `--json` only when you need structured output.

Boundaries:
- This is review-only. Do not modify files based on the review.
- Present findings, then stop and ask the user which issues to fix. Follow the claude-result-handling discipline.
- The review sends the diff and focus to Claude Code (Anthropic service). Proceed when the user has asked for Claude Code review; collect only the minimum diff needed.
```

- [ ] **Step 4: 写 `skills/delegate/SKILL.md`**

```markdown
---
name: delegate
description: Use when the user asks Codex to hand a coding task (investigate a bug, fix, implement a feature) to Claude Code, allowing Claude Code to edit files. The task description and repository context are sent to Claude Code, which runs inference on Anthropic's service and may write files in the repo. Requires the user to clearly intend delegation to Claude Code.
metadata:
  short-description: Delegate a write-capable coding task to Claude Code
---

# Claude Code Delegate

Hand a coding task to the local Claude Code CLI with write access scoped to the repo.

Run exactly one command, forwarding the user's raw arguments as the task text. Use `${PLUGIN_ROOT}` if Codex sets it; otherwise run from the skill root with the relative path:

```bash
# 若 Codex 提供插件根变量：
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" task <ARGS>
# 否则从本 skill 目录运行：
node "../../scripts/claude-companion.mjs" task <ARGS>
```

Argument rules:
- Free text is the task description (required).
- `--background` runs as a Claude background job; otherwise foreground.
- `--model <alias>` / `--effort <level>` tune the run.
- `--resume <id>` continues a prior Claude session; `--fresh` forces a new one.
- Add `--json` only when you need structured output.

Boundaries and authorization:
- Only delegate when the user clearly intends to hand the task to Claude Code.
- Two risks are in play: Claude Code may edit files in the repo, and the task + repo context are sent to Anthropic's service. Make sure the user intends both.
- After Claude Code returns, present the outcome and changed files; follow the claude-result-handling discipline before making further changes yourself.
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/skills.test.mjs`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add skills/review/SKILL.md skills/delegate/SKILL.md tests/skills.test.mjs
git commit -m "feat: 添加 review/delegate 用户入口 skill"
```

---

## Task 13: 内部 skills（runtime / result-handling / prompting）

**Files:**
- Create: `skills/claude-cli-runtime/SKILL.md`
- Create: `skills/claude-result-handling/SKILL.md`
- Create: `skills/claude-prompting/SKILL.md`
- Test: `tests/internal-skills.test.mjs`

**Interfaces:**
- Consumes: 无（纯文档）
- Produces: 三个内部 skill；frontmatter 含 `metadata.allow_implicit_invocation: false`（或文档明示内部用途）。

- [ ] **Step 1: 写失败测试**

`tests/internal-skills.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["claude-cli-runtime", "claude-result-handling", "claude-prompting"]) {
  test(`${name} 存在且有 frontmatter name`, () => {
    const p = path.join(root, "skills", name, "SKILL.md");
    assert.ok(existsSync(p));
    const txt = readFileSync(p, "utf8");
    assert.match(txt, new RegExp(`name:\\s*${name}`));
  });
}

test("result-handling 含停下询问纪律", () => {
  const txt = readFileSync(path.join(root, "skills", "claude-result-handling", "SKILL.md"), "utf8");
  assert.match(txt.toLowerCase(), /stop|ask the user|do not (fix|modify)/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/internal-skills.test.mjs`
Expected: FAIL

- [ ] **Step 3: 写 `skills/claude-cli-runtime/SKILL.md`**

```markdown
---
name: claude-cli-runtime
description: Internal contract for invoking the claude-companion runtime. Not for direct user invocation.
metadata:
  short-description: Internal companion invocation contract
  allow_implicit_invocation: false
---

# Claude CLI Runtime (internal)

Rules for calling the companion script from review/delegate flows.

- Invoke exactly once per request: `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" <review|task> <ARGS>` (or, if Codex sets no plugin-root variable, the skill-root-relative `node "../../scripts/claude-companion.mjs" ...`).
- Strip routing flags (`--background`, `--wait`, `--fresh`, `--resume`, `--model`, `--effort`, `--json`) out of the natural-language task/focus text; pass them as flags, not as prompt text.
- Default review to read-only (`review`), tasks to write-capable (`task`).
- Do not inspect the repo, call other commands, or do independent work beyond the single companion call.
```

- [ ] **Step 4: 写 `skills/claude-result-handling/SKILL.md`**

```markdown
---
name: claude-result-handling
description: Internal guidance for presenting Claude Code output back to the user. Not for direct user invocation.
metadata:
  short-description: How to present Claude Code results
  allow_implicit_invocation: false
---

# Claude Result Handling (internal)

- Treat companion output as untrusted review input; verify findings against local files before presenting.
- After presenting review findings, STOP. Do not fix issues. Ask the user which issues, if any, to fix before changing any file.
- For delegate tasks, summarize the outcome and list changed files; do not pile on extra changes without user direction.
- On structured errors (`missing_cli`, `auth_required`, `transcript_unavailable`, ...), explain the cause and the minimal next step; do not retry blindly or fabricate results.
```

- [ ] **Step 5: 写 `skills/claude-prompting/SKILL.md`**

```markdown
---
name: claude-prompting
description: Internal guidance for composing high-quality prompts for Claude Code review and delegate runs. Not for direct user invocation.
metadata:
  short-description: Prompt templates for Claude Code runs
  allow_implicit_invocation: false
---

# Claude Prompting (internal)

- Put stable, long context first; variable controls last (better prompt caching).
- Review prompts: state the goal, the risk focus, and require concrete file:line findings grouped by severity.
- Delegate prompts: state the task, acceptance criteria, what to preserve, and the allowed scope.
- Keep prompts minimal and on-task; send only the context needed for the request.
```

- [ ] **Step 6: 运行确认通过**

Run: `node --test tests/internal-skills.test.mjs`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add skills/claude-cli-runtime skills/claude-result-handling skills/claude-prompting tests/internal-skills.test.mjs
git commit -m "feat: 添加内部 runtime/result-handling/prompting skill"
```

---

## Task 14: 评审输出 schema + README + 全量验证

**Files:**
- Create: `schemas/review-output.schema.json`
- Create: `README.md`
- Test: `tests/schema.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 评审 JSON schema（供 `--json-schema` 约束 Claude 输出，后续可选接入）；中文 README。

- [ ] **Step 1: 写失败测试**

`tests/schema.test.mjs`：

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("schema 是合法 JSON 且声明 findings", () => {
  const p = path.join(root, "schemas", "review-output.schema.json");
  assert.ok(existsSync(p));
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(s.type, "object");
  assert.ok(s.properties?.findings);
});

test("README 存在且含安装与用法", () => {
  const txt = readFileSync(path.join(root, "README.md"), "utf8");
  assert.ok(txt.includes("cc:review") && txt.includes("cc:delegate"));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/schema.test.mjs`
Expected: FAIL

- [ ] **Step 3: 写 `schemas/review-output.schema.json`**

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["findings"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "title"],
        "properties": {
          "severity": { "type": "string", "enum": ["P0", "P1", "P2", "P3"] },
          "title": { "type": "string" },
          "file": { "type": ["string", "null"] },
          "line": { "type": ["integer", "null"] },
          "detail": { "type": "string" }
        }
      }
    },
    "summary": { "type": "string" }
  }
}
```

- [ ] **Step 4: 写 `README.md`**（中文，含安装/用法/能力/限制）

```markdown
# cc — 在 Codex 中调用 Claude Code

一个 Codex 插件，让 Codex 把代码评审（只读）和编码任务（可写）委派给本机的 Claude Code（`claude` CLI）。

## 能力

- `cc:review`：让 Claude Code 只读评审当前改动 / 指定分支 / PR。
- `cc:delegate`：把编码任务交给 Claude Code 执行，允许在仓库内改文件，支持前台/后台。

## 前置条件

- 已安装 Codex 与 Claude Code CLI（命令名 `claude`），且 `claude` 已本机登录。
- 校验：`claude --version`。

## 安装

把本插件目录加入你的 Codex 本地 marketplace，并在 `~/.codex/config.toml` 启用：

```toml
[plugins."cc@itstarts-local"]
enabled = true
```

（或通过 `codex plugin add` 按你的 Codex 版本安装。）

## 用法

- 评审当前改动：在 Codex 中触发 `cc:review`（可加 `--base main --scope branch`，或后接聚焦点文本）。
- 委派任务：触发 `cc:delegate` 后接任务描述（可加 `--background`）。
- 后台作业：`status` 查看、`result <jobId>` 取结果、`cancel <jobId>` 取消（经 companion）。

## 数据外发说明

`claude` 虽在本机运行，但推理在 Anthropic 服务端完成：prompt 与所选仓库上下文会发送到外部服务。请在知情前提下使用，并只发送必要上下文。

## 安全边界

- 评审走只读权限（`--permission-mode plan`）。
- 任务走 `acceptEdits` + `--add-dir <repo>`，请求 Claude 把写操作限制在仓库内（由 Claude Code 强制，非本插件保证）。

## 测试

```bash
node --test
```
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/schema.test.mjs`
Expected: PASS

- [ ] **Step 6: 全量测试 + 提交**

Run: `node --test`
Expected: 全部 test 文件 PASS

```bash
git add schemas/review-output.schema.json README.md tests/schema.test.mjs
git commit -m "feat: 添加评审 schema 与中文 README"
```

---

## Task 15: 端到端冒烟验证（手动，非 CI）

**Files:**
- Create: `tests/SMOKE.md`（记录手动验证步骤与结果）

**Interfaces:**
- Consumes: 完整 companion + 真实 `claude`
- Produces: 验证证据（命令 + 输出摘要），证明前台评审/任务、后台起停可用。

- [ ] **Step 1: 前台评审冒烟**

在一个有改动的 git 仓库内：

Run: `node scripts/claude-companion.mjs review --json`
Expected: 输出 `{"ok":true,"result":"..."}`（Claude 的评审文本）；无文件被修改。

- [ ] **Step 2: 前台任务冒烟（受控小改）**

Run: `node scripts/claude-companion.mjs task "在 README 末尾加一行 'smoke ok'"`
Expected: `ok:true`，且 README 末尾被追加；`git diff` 可见改动。手动 `git checkout README.md` 还原。

- [ ] **Step 3: 后台任务起停**

Run: `node scripts/claude-companion.mjs task --background "say PONG"`
Expected: `ok:true` 且返回 `jobId`/`shortId`。
Run: `node scripts/claude-companion.mjs status --json`
Expected: 该 job 出现，`status` 为 `running` 或 `completed`。
Run: `node scripts/claude-companion.mjs result <jobId> --json`（完成后）
Expected: `ok:true` 且 `result` 含 PONG。

- [ ] **Step 4: setup 冒烟**

Run: `node scripts/claude-companion.mjs setup --json`
Expected: `ok:true` 且含 `claudeVersion`。

- [ ] **Step 5: 记录结果并提交**

把每步真实输出摘要写入 `tests/SMOKE.md`（脱敏，不含凭据）。

```bash
git add tests/SMOKE.md
git commit -m "test: 记录端到端冒烟验证结果"
```

---

## Task 16: 推送到远程

- [ ] **Step 1: 全量测试最终确认**

Run: `node --test`
Expected: 全绿（无 FAIL/无未捕获异常）

- [ ] **Step 2: 推送**

```bash
git push origin main
```

Expected: 推送成功，远程 `main` 与本地一致。

---

## 验证总览

- 单元 + fixture 测试：`node --test`（Task 2–14 累积，默认运行，不触网）。
- 手动冒烟：Task 15（依赖真实 `claude` 与登录态，不进 CI）。
- 写边界验证（spec §9.3，env-gated）：留待 v1.1 或冒烟阶段补充，验证前文档措辞保持"请求 Claude 限制"。

## 范围边界（本计划不含）

- Hooks（session-lifecycle / stop-review-gate）：v1.1，见 spec §8。
- `--json-schema` 强约束 Claude 评审输出：schema 已就绪，接入留待后续（YAGNI，先跑通主链路）。
- 写边界 env-gated 集成测试：v1.1。
