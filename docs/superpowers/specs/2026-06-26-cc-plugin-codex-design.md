# `cc` 插件设计文档：让 Codex 调用 Claude Code

- 状态：草案，待用户评审
- 日期：2026-06-26
- 仓库目录：`cc-plugin-codex`
- 插件名（Codex 内）：`cc`

## 1. 目标与范围

### 1.1 目标

做一个 **Codex 插件**，让 Codex 主控流程能把工作委派给本机的 Claude Code（`claude` CLI）。它是 `openai/codex-plugin-cc`（让 Claude Code 调用 Codex）的镜像方向。

两个核心能力：

- **评审（review）**：让 Claude Code 以只读方式评审当前改动或指定范围，把结构化结果交回 Codex。
- **委派任务（delegate）**：把编码任务（调查 bug、修复、实现功能）交给 Claude Code 执行，默认允许写文件。

### 1.2 非目标（v1 明确不做）

- 不做会话导入/迁移（参考插件的 `transfer`）。超出"评审+委派"，v1 砍掉。
- 不复用、不依赖、不参考同目录的 `claude-reviewer` skill。本插件完全独立实现。
- 不自建 broker 或 JSON-RPC 多路复用层。Claude Code 自带后台作业原语，直接复用。
- 不做 Codex 作为 MCP server / Claude 作为 MCP server 的双向 MCP 桥接。v1 只走 headless CLI 调用。

### 1.3 关键决策（已与用户确认）

| 项 | 决策 |
|---|---|
| 能力范围 | 评审 + 任务委派 |
| 打包形式 | 完整 Codex plugin（`.codex-plugin/plugin.json` + `marketplace.json`） |
| 与 claude-reviewer 关系 | 完全独立，不参考 |
| 调用架构 | 完整后台作业系统（status / result / cancel） |
| 运行时语言 | Node.js（`.mjs`，零依赖） |
| 任务写权限 | 评审只读 / 任务可写 |
| 插件名 | `cc`（skill 为 `cc:review`、`cc:delegate`） |
| Stop hook 评审门禁 | 做，但作为可选组件由 `setup` 安装到 `~/.codex` 级别 |
| 语言 | skill 用英文 / 文档（README、spec）用中文 |

## 2. 背景调研结论

### 2.1 参考插件 `codex-plugin-cc`（CC → Codex）的架构

- 形态：Claude Code plugin（`.claude-plugin/plugin.json` + `commands/` + `skills/` + `agents/` + `hooks/` + Node.js 运行时）。
- 机制：spawn `codex app-server`，走 JSON-RPC over stdio；自建 broker 复用连接并管理后台任务。
- 命令面：`setup` / `review` / `adversarial-review` / `rescue`（委派）/ `status` / `result` / `cancel` / `transfer`。
- 运行时是零依赖 `.mjs`，无 `package.json`，无构建步骤。

### 2.2 Codex 的扩展模型（本插件落地的宿主侧）

- **skill** 是可移植、跨版本稳定的扩展单元：`SKILL.md`（YAML frontmatter `name` + `description`）+ 可选 `scripts/` / `references/`。Codex 原生加载，靠 `description` 隐式触发，或 `$name` / `/skills` 显式触发。
- **plugin** 形态：`.codex-plugin/plugin.json` 清单 + marketplace 分发。`plugin.json` 可声明 `skills`、`mcpServers`、`apps` 等。
- **重要约束**：部分 Codex 构建会**拒绝 plugin manifest 里的 `hooks` 字段**（`plugin_hooks = removed`，`plugin-creator` 校验器拒绝该字段）。因此 hooks 不能进 plugin manifest，只能装到用户/项目级 `~/.codex/hooks.json` 或 `config.toml [hooks]`。
- Codex 无 slash command 形态的稳定扩展点（custom prompts 已 deprecated）。所以用户入口用 skill。

### 2.3 Claude Code 的 headless 能力（被调用侧，已实测验证）

- 前台：`claude -p --output-format json` 返回单一干净 JSON 结果；`--output-format stream-json --verbose` 返回逐事件 JSONL。
- 后台：`claude -p --background` 返回短 job id；`claude agents --json --all` 查 `state`（`done` / 运行中等）；`claude stop <id>` 取消；`claude logs <id>` 在任务存活时可读，**任务结束后日志消失**。
- 最终结果可从 transcript 读取：`~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`（已实测文件存在）。`<cwd-slug>` 是 cwd 路径把 `/` 替换为 `-`。
- `--session-id <uuid>`：指定会话 ID，使 transcript 路径可确定性定位。
- `--resume <id>` / `--continue`：续接会话。
- 权限：`--permission-mode plan`（只读）、`acceptEdits`（可写）、`bypassPermissions` 等；`--add-dir <dir>` 扩大可访问目录；`--tools ""` 禁用工具。
- 模型：`--model opus|sonnet|haiku|<full-name>`；`--effort low|medium|high|xhigh|max`。

> 这点与参考插件不同：参考插件因 Codex headless 无原生后台而自建 broker；本插件因 Claude Code **原生**提供后台作业管理，后台层显著更薄。

## 3. 总体架构

### 3.1 与参考插件的对称关系

| 维度 | codex-plugin-cc（参考） | cc 插件（本设计） |
|---|---|---|
| 宿主 | Claude Code | Codex |
| 被调用方 | `codex app-server`（JSON-RPC） | `claude` CLI（headless） |
| 用户入口 | slash commands `/codex:*` | skills `cc:review` / `cc:delegate` |
| 后台机制 | 自建 broker + app-server 多路复用 | 复用 Claude 原生 `--background`/`agents`/`stop` |
| 运行时 | `codex-companion.mjs` | `claude-companion.mjs` |
| 结果纪律 | `codex-result-handling` skill | `claude-result-handling` skill |

### 3.2 调用链（以委派任务为例）

```
Codex 主控
  → 命中 cc:delegate skill（按 description 触发）
  → 读 SKILL.md，按其规则拼命令
  → shell: node ${CODEX_PLUGIN_ROOT}/scripts/claude-companion.mjs task "<args>"
      → companion 解析参数、构建 prompt
      → spawn: claude -p --permission-mode acceptEdits --add-dir <repo> [--background] "<prompt>"
      → 前台：等待并解析 JSON 结果；后台：记录作业，立即返回 job id
  → companion 输出结构化 JSON 结果
  → Codex 主控按 claude-result-handling 纪律渲染给用户
```

与参考插件中 agent 运行 `node codex-companion.mjs task` 的链路完全对称。

### 3.3 模块边界

运行时拆成小而专的模块，便于独立测试：

- `claude-companion.mjs`：子命令分发入口（`setup`/`review`/`task`/`status`/`result`/`cancel`/`task-worker`）。
- `lib/args.mjs`：CLI 参数解析（路由标志 vs prompt 文本）。
- `lib/claude.mjs`：构建并 spawn `claude` 命令，解析输出。**唯一**与 `claude` 二进制交互的模块。
- `lib/jobs.mjs`：后台作业生命周期（创建、查询、取消、读结果）。
- `lib/state.mjs`：作业索引与配置的持久化（按 workspace hash 分目录）。
- `lib/transcript.mjs`：定位并解析 Claude transcript JSONL，取最终消息与改动文件。
- `lib/render.mjs`：把结果渲染成给 Codex 主控看的文本/JSON。
- `lib/git.mjs`：解析评审目标（working-tree / branch vs base）。
- `lib/fs.mjs`：路径与文件工具。

## 4. 用户入口 skills

### 4.1 用户可调用 skills（2 个）

> 命名空间规则：Codex 以插件名 `cc` 给 skill 加前缀。skill 目录名与 frontmatter `name` 用 `review` / `delegate`，最终调用名即 `cc:review` / `cc:delegate`，避免出现 `cc:cc-review` 这种冗余。

#### `cc:review`（评审，只读）

- 触发：用户要求让 Claude Code / Claude 评审改动、diff、PR、分支变更。
- 参数：`--base <ref>`、`--scope working-tree|branch`、可选 focus 文本（自由文本聚焦点，把"对抗式评审"折叠成 focus，不单开命令）、`--background`、`--model`。
- 行为：companion 以 `--permission-mode plan` 调 Claude，只读评审，返回结构化 finding。
- 命令：`node ${CODEX_PLUGIN_ROOT}/scripts/claude-companion.mjs review "<args>"`。

#### `cc:delegate`（委派任务，可写）

- 触发：用户要求把编码任务（调查、修复、实现）交给 Claude Code 做。
- 参数：`--background`、`--model`、`--effort`、`--resume`、`--fresh`。
- 行为：companion 以 `--permission-mode acceptEdits` + `--add-dir <repo>` 调 Claude，允许在仓库内改文件。
- 授权门禁（轻量）：skill 要求用户已明确表达"交给 Claude Code 去做"的委派意图才下发可写任务。风险点是"误写工作区"而非"外发泄露"（Claude 本机本地运行、用户已登录），因此不照搬重外发授权仪式。
- 命令：`node ${CODEX_PLUGIN_ROOT}/scripts/claude-companion.mjs task "<args>"`。

### 4.2 内部 skills（3 个，不可被用户直接调用）

- `claude-cli-runtime`：运行时调用契约。如何拼 companion 命令、参数边界、路由标志剥离规则。约束主控"一次请求一次调用，不要自己额外操作"。
- `claude-result-handling`：**结果处理纪律**。镜像参考插件同名 skill 的核心规则——评审结果呈现后停下，先问用户要不要改，未经允许不擅自动手改代码。
- `claude-prompting`：给 Claude 写高质量 prompt 的指引。评审/任务的结构化模板，配合 JSON schema 约束输出。

## 5. 运行时命令面

`claude-companion.mjs <subcommand> [args]`，镜像 `codex-companion.mjs`：

| 子命令 | 作用 |
|---|---|
| `setup` | 检查 `claude` 安装/登录状态；可选开关评审门禁、安装 Stop hook。支持 `--json`。 |
| `review` | 运行只读评审。支持 `--base`、`--scope`、focus 文本、`--background`、`--wait`。 |
| `task` | 运行可写任务委派。支持 `--background`、`--model`、`--effort`、`--resume`、`--fresh`。 |
| `status` | 查后台作业状态（读 `claude agents --json --all` + 本地作业索引）。 |
| `result` | 取某作业最终结果（读 transcript）。支持 `--json`。 |
| `cancel` | 取消后台作业（`claude stop <id>`）。 |
| `task-worker` | 内部子命令，后台 worker 进程入口。 |

不做 `transfer`。

## 6. 后台作业与状态

### 6.1 前台调用

```
claude -p --output-format json \
  --permission-mode <plan|acceptEdits> \
  --add-dir <repo> \
  "<prompt>"
```

取单一 JSON 结果后渲染。长等待时 companion 每约 30 秒打 status-only 心跳（不输出 prompt、diff、未验证 finding）。

### 6.2 后台调用

```
uuid = 生成 UUID
claude -p --session-id <uuid> --background \
  --permission-mode <mode> --add-dir <repo> \
  "<prompt>"
→ 返回短 job id
→ 记录作业 { jobId, claudeShortId, claudeSessionId(uuid), cwd, request, status, startedAt }
```

- `status`：读 `claude agents --json --all`，按 short id / sessionId 匹配 `state`，结合本地作业索引展示。
- `result`：读 transcript `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`，取最终 assistant/result 消息 + 改动文件，渲染。
- `cancel`：`claude stop <shortId>`，更新本地作业状态。

### 6.3 状态持久化

- 按 workspace 根路径 hash 分目录（镜像参考插件 `state.mjs` 思路）。
- 存：作业列表 + 配置（评审门禁开关、Stop hook 状态）。
- 位置：优先 `~/.codex/.cc-plugin/state/<workspace-slug>-<hash>/`，回退 `os.tmpdir()`。
- 保留最近 N 条作业（如 50），自动清理过旧记录。

## 7. 安全模型

- **评审**：`--permission-mode plan`，可读不可写，活动限定在仓库内。
- **委派任务**：默认可写，用 `--permission-mode acceptEdits` + `--add-dir <repo>` 限定写范围；skill 层要求用户已明确表达委派意图。
- **`setup`**：检查 `claude` 是否安装、是否已登录（未登录时提示用户本机登录，不请求沙箱/网络升级来做 auth）。
- **不引入兜底降级**：调用失败、未登录、解析失败都返回结构化错误码，不静默吞掉、不返回降级结果。
- **敏感信息**：不打印、不写日志、不提交凭据。prompt 内容通过参数/stdin 传给本机 `claude`，不外发第三方。

错误码（初版）：`missing_cli`（无 `claude`）、`auth_required`（需登录）、`invalid_json`（结果解析失败）、`job_not_found`、`nonzero_exit`、`timeout`（仅显式有限等待时）。

## 8. Hooks（可选组件）

- 形态：**不放进 plugin manifest**（规避 Codex 校验器拒绝 `hooks` 字段的问题）。由 `setup` 帮用户安装到 `~/.codex/hooks.json` 或 `config.toml [hooks]`。
- 内容：
  - `session-lifecycle` hook：会话开始/结束时维护作业索引、清理本会话遗留后台作业。
  - `stop-review-gate` hook：镜像参考插件的"收尾前让对方评审"门禁。Codex 收尾前调用 Claude 做一次评审，`ALLOW:` 放行 / `BLOCK:` 拦截并说明原因。
- 默认关闭，用户通过 `setup` 显式开启。

## 9. 测试策略

用 `node:test`（零依赖）覆盖纯逻辑：

- 参数解析：路由标志 vs prompt 文本的切分。
- claude 命令拼装：评审走 `plan`、任务走 `acceptEdits`、`--add-dir`、`--model`、`--background` 等组合正确。
- 作业状态读写：创建、更新、查询、清理。
- transcript 解析：从 JSONL 取最终消息与改动文件；处理空文件/损坏行。
- 错误分类：各错误码触发条件。
- skill 文档契约：SKILL.md frontmatter 完整、关键段落未截断、引用的脚本存在。

不在自动化测试里真实调用 `claude`（避免外部依赖与登录态）；真实调用通过手动 smoke + dry-run 验证。

## 10. 目录结构

```text
cc-plugin-codex/
  .codex-plugin/
    plugin.json
  marketplace.json
  skills/
    review/SKILL.md              # name: review        → 调用为 cc:review
    delegate/SKILL.md            # name: delegate      → 调用为 cc:delegate
    claude-cli-runtime/SKILL.md  # 内部，不可用户直接调用
    claude-result-handling/SKILL.md
    claude-prompting/SKILL.md
  scripts/
    claude-companion.mjs
    lib/
      args.mjs
      claude.mjs
      jobs.mjs
      state.mjs
      transcript.mjs
      render.mjs
      git.mjs
      fs.mjs
    hooks/
      session-lifecycle.mjs      # 可选安装
      stop-review-gate.mjs       # 可选安装
  schemas/
    review-output.schema.json
  tests/
    *.test.mjs
  README.md
  LICENSE
```

## 11. 实现阶段建议

1. **骨架**：`plugin.json` + `marketplace.json` + 目录结构 + `args.mjs` + companion 分发入口。
2. **前台评审**：`claude.mjs`（构建/spawn/解析）+ `git.mjs` + `cc:review` skill + `review` 子命令，跑通只读评审。
3. **前台任务**：`cc:delegate` skill + `task` 子命令，跑通可写委派。
4. **后台作业**：`jobs.mjs` + `state.mjs` + `transcript.mjs` + `status`/`result`/`cancel`/`task-worker`。
5. **内部 skills**：`claude-cli-runtime` / `claude-result-handling` / `claude-prompting`。
6. **setup 与 hooks**：`setup` 子命令 + 可选 hooks 安装。
7. **测试与文档**：`node:test` 套件 + README。

每阶段交付后做最小验证（dry-run / smoke），有验证证据才标记完成。
