# Upstream Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本项目对标 `openai/codex-plugin-cc` v1.0.5 后确认的低风险治理项和中等风险运行时增强项分阶段落地，同时保留本项目“Codex 调 Claude Code”的反向镜像边界。

**Architecture:** 先落地独立且可验证的发布治理与 prompt 模板化，再增强 review 目标解析和上下文采集。schema 升级、job 状态系统和 hook 生命周期属于跨契约变更，先形成设计结论，再作为独立计划执行。

**Tech Stack:** Node.js ESM `.mjs`；Node 内置模块；`node:test`；Codex plugin manifest；GitHub Actions；Claude Code CLI runtime。

## Global Constraints

- 默认中文文档与中文交付说明；skill frontmatter 与现有英文 skill 正文保持英文。
- 运行时继续零第三方依赖；不得为本计划新增生产依赖。
- 当前实际版本承载点只有 `package.json` 与 `plugins/cc/.codex-plugin/plugin.json`；没有 `package-lock.json`，`.agents/plugins/marketplace.json` 没有 `version` 字段。
- NOTICE 文案表达本项目参考上游设计和产品方向，不声称上游代码直接派生，除非后续确认具体代码复制关系。
- `cc:review` 与 `cc:adversarial-review` 仍调用 Claude Code；不得引入上游 Codex app-server/broker 体系。
- `commands/*.md`、`agents/codex-rescue.md`、`/codex:transfer` 不进入本计划实现范围。
- 自动化验证优先运行最相关的 `node --test` 子集；计划完成前至少运行 `npm test`。
- 本计划不要求直接提交；执行时如用户要求 commit，提交信息使用 `<type>: 中文描述`。

---

## Files To Create Or Modify

| Path | Action | Responsibility |
|---|---|---|
| `scripts/check-version.mjs` | Create | 校验和可选更新当前实际存在的版本字段。 |
| `tests/check-version.test.mjs` | Create | 覆盖版本校验脚本的成功、失败、写入路径。 |
| `package.json` | Modify | 新增 `check-version` script。 |
| `.github/workflows/ci.yml` | Modify | 在测试前运行版本一致性检查。 |
| `NOTICE` | Create | 根级 attribution 与项目归属说明。 |
| `plugins/cc/NOTICE` | Create | 插件级 attribution 与项目归属说明。 |
| `plugins/cc/prompts/adversarial-review.md` | Create | 挑战式评审 prompt 模板。 |
| `plugins/cc/scripts/lib/prompts.mjs` | Create | 读取并替换 prompt 模板变量。 |
| `plugins/cc/scripts/claude-companion.mjs` | Modify | 使用模板构造 adversarial prompt；使用新的 review context。 |
| `plugins/cc/tests/lib/prompts.test.mjs` | Create | 验证 prompt 模板加载与变量替换。 |
| `plugins/cc/scripts/lib/fs.mjs` | Create | 文本文件探测工具，供 untracked 文件采集复用。 |
| `plugins/cc/scripts/lib/git.mjs` | Modify | 增强 review target 解析、默认分支检测、working tree/branch context 采集。 |
| `plugins/cc/scripts/lib/args.mjs` | Modify | `SCOPE_VALUES` 增加 `auto`。 |
| `plugins/cc/tests/lib/fs.test.mjs` | Create | 覆盖文本/二进制启发式检测。 |
| `plugins/cc/tests/lib/git.test.mjs` | Modify | 增加真实临时 git 仓库测试。 |
| `plugins/cc/tests/lib/args.test.mjs` | Modify | 更新 `scope` 枚举测试。 |
| `plugins/cc/tests/companion.test.mjs` | Modify | 更新 `--scope` 错误提示断言。 |
| `plugins/cc/skills/review/SKILL.md` | Modify | 文档同步 `--scope auto|working-tree|branch`。 |
| `plugins/cc/skills/adversarial-review/SKILL.md` | Modify | 文档同步 `--scope auto|working-tree|branch`。 |
| `README.md` | Modify | 说明本轮新增的 review target 行为与 NOTICE。 |
| `README.en.md` | Modify | 同步英文根 README。 |
| `plugins/cc/README.md` | Modify | 同步插件中文 README。 |
| `plugins/cc/README.en.md` | Modify | 同步插件英文 README。 |
| `docs/superpowers/specs/2026-07-02-schema-and-jobs-design.md` | Create | 记录 schema/job 后续设计决策，不在本计划实现。 |

---

## Task 1: Version Metadata Guardrail

**Files:**
- Create: `scripts/check-version.mjs`
- Create: `tests/check-version.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `node scripts/check-version.mjs --check`，读取 `package.json` 的 `version`，确认 `plugins/cc/.codex-plugin/plugin.json` 的 `version` 一致。
- Produces: `node scripts/check-version.mjs <semver>`，同步写入两个当前实际存在的版本字段。

- [ ] **Step 1: Write failing tests**

Create `tests/check-version.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "check-version.mjs");

function makeFixture({ pkgVersion = "1.2.3", pluginVersion = "1.2.3" } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-version-"));
  mkdirSync(path.join(dir, "plugins", "cc", ".codex-plugin"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: pkgVersion }, null, 2) + "\n");
  writeFileSync(
    path.join(dir, "plugins", "cc", ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "cc", version: pluginVersion }, null, 2) + "\n",
  );
  return dir;
}

test("--check succeeds when package and plugin versions match", () => {
  const dir = makeFixture();
  const r = spawnSync("node", [script, "--check", "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All version metadata matches 1\.2\.3/);
});

test("--check fails when package and plugin versions differ", () => {
  const dir = makeFixture({ pkgVersion: "1.2.3", pluginVersion: "1.2.4" });
  const r = spawnSync("node", [script, "--check", "--root", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /plugins\/cc\/\.codex-plugin\/plugin\.json version: expected 1\.2\.3, found 1\.2\.4/);
});

test("setting a version writes both current version locations", () => {
  const dir = makeFixture({ pkgVersion: "1.2.3", pluginVersion: "1.2.3" });
  const r = spawnSync("node", [script, "2.0.0", "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(path.join(dir, "plugins", "cc", ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(pkg.version, "2.0.0");
  assert.equal(plugin.version, "2.0.0");
});

test("invalid semver exits non-zero", () => {
  const dir = makeFixture();
  const r = spawnSync("node", [script, "v2", "--root", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Expected a semver-like version/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test tests/check-version.test.mjs
```

Expected: FAIL with module not found for `scripts/check-version.mjs`.

- [ ] **Step 3: Implement `scripts/check-version.mjs`**

Create `scripts/check-version.mjs`:

```javascript
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const TARGETS = [
  {
    file: "package.json",
    label: "version",
    get: (json) => json.version,
    set: (json, version) => { json.version = version; },
  },
  {
    file: "plugins/cc/.codex-plugin/plugin.json",
    label: "version",
    get: (json) => json.version,
    set: (json, version) => { json.version = version; },
  },
];

function usage() {
  return [
    "Usage:",
    "  node scripts/check-version.mjs --check [version]",
    "  node scripts/check-version.mjs <version>",
    "  node scripts/check-version.mjs --help",
    "",
    "Options:",
    "  --check       Verify version metadata. Uses package.json when version is omitted.",
    "  --root <dir>  Run against another repository root.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { check: false, root: process.cwd(), version: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--root") {
      const root = argv[i + 1];
      if (!root) throw new Error("--root requires a directory.");
      options.root = root;
      i += 1;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (options.version) throw new Error(`Unexpected extra argument: ${arg}`);
    else options.version = arg;
  }
  options.root = path.resolve(options.root);
  return options;
}

function readJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function writeJson(root, file, json) {
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(json, null, 2)}\n`);
}

function validateVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Expected a semver-like version such as 1.0.3, got: ${version}`);
  }
}

function packageVersion(root) {
  const version = readJson(root, "package.json").version;
  if (typeof version !== "string") throw new Error("package.json version must be a string.");
  validateVersion(version);
  return version;
}

function checkVersions(root, expectedVersion) {
  const mismatches = [];
  for (const target of TARGETS) {
    const actual = target.get(readJson(root, target.file));
    if (actual !== expectedVersion) {
      mismatches.push(`${target.file} ${target.label}: expected ${expectedVersion}, found ${actual ?? "<missing>"}`);
    }
  }
  return mismatches;
}

function setVersions(root, version) {
  const changed = [];
  for (const target of TARGETS) {
    const json = readJson(root, target.file);
    const before = JSON.stringify(json);
    target.set(json, version);
    if (JSON.stringify(json) !== before) {
      writeJson(root, target.file, json);
      changed.push(target.file);
    }
  }
  return changed;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const version = options.version ?? (options.check ? packageVersion(options.root) : null);
  if (!version) throw new Error(`Missing version.\n\n${usage()}`);
  validateVersion(version);
  if (options.check) {
    const mismatches = checkVersions(options.root, version);
    if (mismatches.length) throw new Error(`Version metadata is out of sync:\n${mismatches.join("\n")}`);
    console.log(`All version metadata matches ${version}.`);
    return;
  }
  const changed = setVersions(options.root, version);
  console.log(`Set version metadata to ${version}: ${changed.length ? changed.join(", ") : "no files changed"}.`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
```

- [ ] **Step 4: Add npm script**

Modify `package.json`:

```json
"scripts": {
  "check-version": "node scripts/check-version.mjs --check",
  "test": "node --test"
}
```

- [ ] **Step 5: Add CI step**

Modify `.github/workflows/ci.yml` so the job runs version validation before tests:

```yaml
      - name: Check version metadata
        run: npm run check-version

      - name: Run tests
        run: npm test
```

- [ ] **Step 6: Verify**

Run:

```bash
node --test tests/check-version.test.mjs
npm run check-version
npm test
```

Expected: all commands pass.

---

## Task 2: NOTICE Attribution

**Files:**
- Create: `NOTICE`
- Create: `plugins/cc/NOTICE`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `plugins/cc/README.md`
- Modify: `plugins/cc/README.en.md`

**Interfaces:**
- Produces: explicit attribution text that describes upstream as a reference project while preserving this project's independent implementation boundary.

- [ ] **Step 1: Create root NOTICE**

Create `NOTICE`:

```text
cc-plugin-codex
Copyright 2026 itstarts

This project is an independent Codex plugin implementation that lets Codex
delegate review and coding tasks to the local Claude Code CLI.

The project is inspired by and designed as the reverse-direction counterpart
to OpenAI's codex-plugin-cc project, which lets Claude Code invoke Codex.
This NOTICE does not claim that this repository is published by OpenAI or
that its implementation files are copied from OpenAI's repository.
```

- [ ] **Step 2: Create plugin NOTICE**

Create `plugins/cc/NOTICE` with the same content as root `NOTICE`.

- [ ] **Step 3: Update README references**

In `README.md`, add a short sentence near the existing mirror-direction paragraph:

```markdown
归属与参考来源说明见 [NOTICE](NOTICE)。
```

In `README.en.md`, add the matching sentence:

```markdown
Attribution and reference-project notes are recorded in [NOTICE](NOTICE).
```

In `plugins/cc/README.md`, add:

```markdown
归属与参考来源说明见 [NOTICE](NOTICE)。
```

In `plugins/cc/README.en.md`, add:

```markdown
Attribution and reference-project notes are recorded in [NOTICE](NOTICE).
```

- [ ] **Step 4: Verify**

Run:

```bash
test -f NOTICE
test -f plugins/cc/NOTICE
node -e 'const fs=require("fs"); for (const f of ["README.md","README.en.md","plugins/cc/README.md","plugins/cc/README.en.md"]) { const s=fs.readFileSync(f,"utf8"); if (!/NOTICE|归属|Attribution/.test(s)) throw new Error(`${f} missing NOTICE reference`); }'
npm test
```

Expected: both NOTICE files exist, README references are present, tests pass.

---

## Task 3: Adversarial Prompt Template

**Files:**
- Create: `plugins/cc/prompts/adversarial-review.md`
- Create: `plugins/cc/scripts/lib/prompts.mjs`
- Create: `plugins/cc/tests/lib/prompts.test.mjs`
- Modify: `plugins/cc/scripts/claude-companion.mjs`

**Interfaces:**
- Produces: `loadPromptTemplate(rootDir, name) -> string`
- Produces: `interpolateTemplate(template, values) -> string`
- Consumes: existing `cmdReview(..., { promptBuilder })` pathway.
- Preserves: if the template is missing or unreadable, `cmdReview` returns structured `invalid_json` instead of a raw stack trace.

- [ ] **Step 1: Write prompt helper tests**

Create `plugins/cc/tests/lib/prompts.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPromptTemplate, interpolateTemplate } from "../../scripts/lib/prompts.mjs";

test("loadPromptTemplate reads prompts by name", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-prompts-"));
  mkdirSync(path.join(dir, "prompts"));
  writeFileSync(path.join(dir, "prompts", "sample.md"), "Hello {{NAME}}\n");
  assert.equal(loadPromptTemplate(dir, "sample"), "Hello {{NAME}}\n");
});

test("interpolateTemplate replaces known variables and leaves no marker", () => {
  const out = interpolateTemplate("A={{A}}\nB={{B}}\n", { A: "one", B: "two" });
  assert.equal(out, "A=one\nB=two\n");
  assert.ok(!out.includes("{{"));
});

test("interpolateTemplate throws when a variable is missing", () => {
  assert.throws(() => interpolateTemplate("A={{A}} B={{B}}", { A: "one" }), /Missing template value: B/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test plugins/cc/tests/lib/prompts.test.mjs
```

Expected: FAIL because `scripts/lib/prompts.mjs` does not exist.

- [ ] **Step 3: Implement prompt helpers**

Create `plugins/cc/scripts/lib/prompts.mjs`:

```javascript
import { readFileSync } from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  return readFileSync(path.join(rootDir, "prompts", `${name}.md`), "utf8");
}

export function interpolateTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return String(values[key]);
  });
}
```

- [ ] **Step 4: Add adversarial template**

Create the directory first:

```bash
mkdir -p plugins/cc/prompts
```

Create `plugins/cc/prompts/adversarial-review.md`:

```markdown
You are performing an ADVERSARIAL code review. Read-only: do not modify files.
Your job is to break confidence in this change, not to validate it.

Question the chosen implementation, design choices, tradeoffs, and hidden assumptions.
Default to skepticism; if something only works on the happy path, treat that as a real weakness.

Focus:
{{USER_FOCUS}}

Prioritize expensive, dangerous, or hard-to-detect failures:
- auth, permission, and trust boundaries
- data loss, corruption, and irreversible state
- rollback, retry, and idempotency gaps
- race conditions and ordering assumptions
- empty-state, null, timeout, and degraded-dependency behavior
- version skew and migration hazards

Report only material findings. Skip style and naming nits.
Use the configured JSON schema exactly: each finding has severity P0, P1, P2, or P3; title; file; line; and detail.
Write the summary as a terse ship/no-ship assessment. If the change is genuinely safe, say so and report no findings.

Review context:
{{REVIEW_INPUT}}
```

- [ ] **Step 5: Wire template into companion**

Modify `plugins/cc/scripts/claude-companion.mjs`:

```javascript
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES, makeError } from "./lib/errors.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function buildAdversarialPrompt(reviewInput, focus) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    USER_FOCUS: focus || "No extra focus provided.",
    REVIEW_INPUT: reviewInput || "(empty review context)",
  });
}
```

Keep the existing function name `buildAdversarialPrompt` so `cmdReview(..., { promptBuilder })` remains unchanged.

Wrap the prompt-builder call inside `cmdReview`:

```javascript
let prompt;
try {
  prompt = promptBuilder(diff.text, positional.join(" "));
} catch (e) {
  return { out: makeError(ERROR_CODES.INVALID_JSON, "评审 prompt 模板加载失败，请检查插件安装完整性", { detail: String(e?.message ?? e) }), json };
}
```

- [ ] **Step 6: Verify**

Run:

```bash
node --test plugins/cc/tests/lib/prompts.test.mjs
node --test plugins/cc/tests/lib/claude.test.mjs plugins/cc/tests/companion.test.mjs
npm test
```

Expected: all commands pass.

---

## Task 4: Review Target And Context Collection

**Files:**
- Create: `plugins/cc/scripts/lib/fs.mjs`
- Modify: `plugins/cc/scripts/lib/git.mjs`
- Modify: `plugins/cc/scripts/lib/args.mjs`
- Modify: `plugins/cc/scripts/claude-companion.mjs`
- Modify: `plugins/cc/tests/lib/git.test.mjs`
- Modify: `plugins/cc/tests/lib/args.test.mjs`
- Modify: `plugins/cc/tests/companion.test.mjs`
- Modify: `plugins/cc/skills/review/SKILL.md`
- Modify: `plugins/cc/skills/adversarial-review/SKILL.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `plugins/cc/README.md`
- Modify: `plugins/cc/README.en.md`

**Interfaces:**
- Produces: `SCOPE_VALUES = ["auto", "working-tree", "branch"]`
- Produces: `resolveReviewTarget(cwd, { scope, base }) -> { mode, label, baseRef?, explicit }`
- Produces: `collectReviewInput(cwd, { scope, base }) -> { ok, text, args, target, stderr }`
- Keeps: `collectDiff(cwd, opts)` as a compatibility wrapper around `collectReviewInput`.

- [ ] **Step 1: Write text detection tests and implementation**

Create `plugins/cc/scripts/lib/fs.mjs`:

```javascript
export function isProbablyText(buffer) {
  if (!buffer || buffer.length === 0) return true;
  const limit = Math.min(buffer.length, 4096);
  let controlBytes = 0;
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return false;
    if (buffer[i] < 7 || (buffer[i] > 13 && buffer[i] < 32)) controlBytes += 1;
  }
  return controlBytes / limit <= 0.3;
}
```

Create `plugins/cc/tests/lib/fs.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { isProbablyText } from "../../scripts/lib/fs.mjs";

test("isProbablyText rejects buffers containing null bytes", () => {
  assert.equal(isProbablyText(Buffer.from([65, 0, 66])), false);
});

test("isProbablyText accepts UTF-8 text buffers", () => {
  assert.equal(isProbablyText(Buffer.from("hello\nworld", "utf8")), true);
});

test("isProbablyText rejects buffers with many control bytes", () => {
  assert.equal(isProbablyText(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 65, 66])), false);
});
```

- [ ] **Step 2: Add git context tests**

Extend `plugins/cc/tests/lib/git.test.mjs` with real temporary repositories:

```javascript
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildDiffArgs,
  detectDefaultBranch,
  getWorkingTreeState,
  resolveReviewTarget,
  collectReviewInput,
} from "../../scripts/lib/git.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-plugin-git-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

test("SCOPE_VALUES auto uses working-tree when repo is dirty", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "tracked.txt"), "base\nchanged\n");
  writeFileSync(path.join(dir, "new.txt"), "new file\n");
  const target = resolveReviewTarget(dir, { scope: "auto" });
  assert.equal(target.mode, "working-tree");
  const input = collectReviewInput(dir, { scope: "auto" });
  assert.equal(input.ok, true);
  assert.match(input.text, /Git Status/);
  assert.match(input.text, /Untracked Files/);
  assert.match(input.text, /new file/);
});

test("auto uses detected branch target when working tree is clean", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "feature"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nfeature\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "feature"]);
  const target = resolveReviewTarget(dir, { scope: "auto" });
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("branch scope without base detects default branch", () => {
  const dir = makeRepo();
  assert.equal(detectDefaultBranch(dir), "main");
  const target = resolveReviewTarget(dir, { scope: "branch" });
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("detectDefaultBranch prefers origin branch over local branch when both exist", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "origin-main"]);
  writeFileSync(path.join(dir, "tracked.txt"), "base\nremote\n");
  git(dir, ["add", "tracked.txt"]);
  git(dir, ["commit", "-m", "remote main"]);
  const remoteCommit = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["update-ref", "refs/remotes/origin/main", remoteCommit]);
  git(dir, ["checkout", "main"]);
  assert.equal(detectDefaultBranch(dir), "origin/main");
});

test("collectReviewInput omits binary patch payloads from branch diffs", () => {
  const dir = makeRepo();
  git(dir, ["checkout", "-b", "feature"]);
  writeFileSync(path.join(dir, "asset.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
  git(dir, ["add", "asset.bin"]);
  git(dir, ["commit", "-m", "add binary"]);
  const input = collectReviewInput(dir, { scope: "branch", base: "main" });
  assert.equal(input.ok, true);
  assert.doesNotMatch(input.text, /GIT binary patch/);
  assert.match(input.text, /asset\.bin/);
});
```

- [ ] **Step 3: Run git tests to verify failure**

Run:

```bash
node --test plugins/cc/tests/lib/git.test.mjs
```

Expected: FAIL because new exports do not exist and `auto` is not supported.

- [ ] **Step 4: Implement context collection in `git.mjs`**

Modify `plugins/cc/scripts/lib/git.mjs`:

```javascript
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isProbablyText } from "./fs.mjs";

const MAX_UNTRACKED_BYTES = 24 * 1024;

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
    if (remoteHead.startsWith("refs/remotes/origin/")) return remoteHead.replace("refs/remotes/origin/", "");
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
  try { stat = fs.statSync(fullPath); } catch { return `### ${relativePath}\n(skipped: unreadable file)`; }
  if (stat.isDirectory()) return `### ${relativePath}\n(skipped: directory)`;
  if (stat.size > MAX_UNTRACKED_BYTES) return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  const data = fs.readFileSync(fullPath);
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

export function collectReviewInput(cwd, opts = {}) {
  try {
    const repoRoot = resolveRepoRoot(cwd);
    const target = resolveReviewTarget(repoRoot, opts);
    const text = target.mode === "branch" ? collectBranchInput(repoRoot, target.baseRef) : collectWorkingTreeInput(repoRoot);
    return { ok: true, text, args: buildDiffArgs({ scope: target.mode, base: target.baseRef }), target, stderr: "" };
  } catch (error) {
    return { ok: false, text: "", args: [], target: null, stderr: String(error?.message ?? error).slice(0, 500) };
  }
}

export function collectDiff(cwd, opts = {}) {
  return collectReviewInput(cwd, opts);
}
```

- [ ] **Step 5: Update args scope enum**

Modify `plugins/cc/scripts/lib/args.mjs`:

```javascript
export const SCOPE_VALUES = Object.freeze(["auto", "working-tree", "branch"]);
```

- [ ] **Step 6: Update review prompt label**

Modify `buildReviewPrompt` in `plugins/cc/scripts/claude-companion.mjs` so the context label matches richer content:

```javascript
"=== REVIEW CONTEXT ===",
diffText || "(empty review context)",
```

Keep `cmdReview` using `collectDiff`; the compatibility wrapper makes the behavior richer without changing the public result shape.

Also change the default in `runForegroundReview` from `scope ?? "working-tree"` to `scope ?? "auto"`:

```javascript
const diff = collectDiff(cwd, { scope: scope ?? "auto", base });
```

The Stop gate remains explicit with `scope: "working-tree"`, so it continues to review only pending workspace changes before session stop.

- [ ] **Step 7: Update tests and docs for `auto`**

Update tests:

```javascript
assert.deepEqual([...SCOPE_VALUES], ["auto", "working-tree", "branch"]);
assert.match(msg, /auto\|working-tree\|branch/);
```

Update skill docs:

```markdown
--scope auto|working-tree|branch
```

Update README docs to state:

```markdown
`--scope auto` is the default: dirty workspaces are reviewed as working-tree changes; clean workspaces fall back to a branch diff against the detected default branch.
```

- [ ] **Step 8: Verify**

Run:

```bash
node --test plugins/cc/tests/lib/git.test.mjs
node --test plugins/cc/tests/lib/fs.test.mjs
node --test plugins/cc/tests/lib/args.test.mjs plugins/cc/tests/companion.test.mjs
npm test
```

Expected: all commands pass.

---

## Task 5: Schema And Job Design Record

**Files:**
- Create: `docs/superpowers/specs/2026-07-02-schema-and-jobs-design.md`

**Interfaces:**
- Produces: a decision document for future schema/job work; no runtime behavior changes in this task.

- [ ] **Step 1: Write design record**

Create `docs/superpowers/specs/2026-07-02-schema-and-jobs-design.md`:

```markdown
# Review Schema And Job State Design

## Scope

This document records decisions for future changes. It does not change runtime behavior.

## Review Schema Direction

The current schema remains active: findings use `P0|P1|P2|P3`, `title`, `file`, `line`, `detail`, and `summary`.

A future schema may add `verdict`, `next_steps`, `recommendation`, `confidence`, and line ranges. That migration must define:

- severity mapping: `P0 -> critical`, `P1 -> high`, `P2 -> medium`, `P3 -> low`
- Stop gate blocking rule: block on `P0` and `P1` equivalents
- renderer compatibility: accept old and new shapes during a transition period
- background result compatibility: parse old transcripts without data loss

## Job State Direction

The current job system remains active: state stores job metadata and uses `claude agents --json --all` plus transcript parsing to reconcile results.

A future job redesign must choose one of two strategies:

- additive: keep transcript parsing as the source of final output and add job log/phase metadata for observability
- replacement: make companion-owned job files the source of truth and use Claude transcript only as an import source

The additive path is preferred until Claude background jobs expose stable final output and cancellation metadata without transcript parsing.
```

- [ ] **Step 2: Verify**

Run:

```bash
node -e 'const fs=require("fs"); const s=fs.readFileSync("docs/superpowers/specs/2026-07-02-schema-and-jobs-design.md","utf8"); for (const p of ["severity mapping","additive","replacement","Stop gate"]) if (!s.includes(p)) throw new Error(`missing ${p}`);'
npm test
```

Expected: design markers are present, tests pass.

---

## Implementation Order

1. Task 1 first: it is low risk and strengthens release hygiene.
2. Task 2 can run after Task 1; it is documentation-only once attribution wording is accepted.
3. Task 3 can run independently after Task 1; it has focused tests and does not change review target behavior.
4. Task 4 should run after Task 3 because it changes prompt input semantics and has the highest test burden.
5. Task 5 can run at any time after Task 1, but must complete before implementing schema or job redesign.

## Deferred Work

- Review schema migration implementation.
- Job state/log/phase redesign implementation.
- Codex lifecycle hook support for SessionStart/SessionEnd.
- Reverse transfer from Codex session to Claude Code.
- Claude Code slash commands and Codex app-server/broker integration.

## Self-Review

- Spec coverage: includes governance, attribution, prompt template, review target enhancement, and deferred schema/job design.
- Placeholder scan: no placeholder markers or unspecified “handle edge cases” steps remain.
- Type consistency: `collectReviewInput` and `collectDiff` return the same core shape consumed by current companion code.
- Risk check: Task 4 is the only runtime behavior change with broad impact; it includes consumer, docs, and tests in one task.
