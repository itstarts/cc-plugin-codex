# `cc` 插件设计文档：让 Codex 调用 Claude Code

- 状态：草案 v2，已纳入 Codex 外部评审意见
- 日期：2026-06-26
- 仓库目录：`cc-plugin-codex`
- 插件名（Codex 内）：`cc`

> 评审修订记录（v2）：本版根据一次 Codex 外部设计评审更新，逐条处理了 8 条意见：
> 后台状态当 best-effort 并叠加插件自有状态机（#1）、transcript 改为启动时解析并存实际路径 +
> setup 探测 + 防御解析 + 版本不符报错（#2）、修正安全模型的外发措辞并加入外发知情（#3）、
> 写边界改为"请求 Claude 限制"并补边界测试（#4）、hook 安装幂等/备份/冲突检测（#5）、
> 删除与"复用原生后台"矛盾的 `task-worker`（#6）、测试补 fixture + env-gated 集成测试（#7）、
> Stop hook 降到 v1.1（#8）。
> 说明：#1 经本地实测部分修正——后台任务的 `claude agents --json` 记录**确实带 `state` 字段**
> （前台 interactive 记录才没有），故仍用 agents 状态，但叠加插件自有持久化与 `unknown/lost` 兜底。

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
| Stop hook 评审门禁 | **降到 v1.1**；v1 先把 review/delegate 跑稳，再加 hook 门禁 |
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
- 后台：`claude -p --background` 返回短 job id；`claude agents --json --all` 可查作业 `state`（实测后台作业记录带 `state`，如 `done`；但前台 interactive 记录无 `state`，故按 best-effort 对待）；`claude stop <id>` 取消；`claude logs <id>` 在任务存活时可读，**任务结束后日志消失**。
- 最终结果可从 transcript 读取：实测路径形如 `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`，`<cwd-slug>` 约定为 cwd 把 `/` 替换为 `-`。**此路径与 JSONL 事件结构是 Claude Code 私有实现细节，仅一次实测验证**，不能当稳定 API；落地时以"启动时探测 + 存实际路径 + 防御解析"处理（见 §6.2、§6.4）。
- `--session-id <uuid>`：指定会话 ID，使 transcript 路径可确定性定位。
- `--resume <id>` / `--continue`：续接会话。
- 权限：`--permission-mode plan`（只读）、`acceptEdits`（可写）、`bypassPermissions` 等；`--add-dir <dir>` 扩大可访问目录；`--tools ""` 禁用工具。**注意**：这些是"请求 Claude 限制访问"的开关，实际写边界由 Claude Code 自身强制执行，本插件不替它兜底（见 §7）。
- 模型：`--model opus|sonnet|haiku|<full-name>`；`--effort low|medium|high|xhigh|max`。
- **数据流**：`claude` 是本机进程，但它会把 prompt 与所选仓库上下文发送到 Anthropic 服务完成推理。"本机 CLI"不等于"数据不外发"（见 §7 安全模型）。

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

- `claude-companion.mjs`：子命令分发入口（`setup`/`review`/`task`/`status`/`result`/`cancel`）。
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
- 行为：companion 以 `--permission-mode acceptEdits` + `--add-dir <repo>` 调 Claude，**请求** Claude 把改动限制在仓库内（实际边界由 Claude Code 强制，见 §7）。
- 授权门禁（轻量）：skill 要求用户已明确表达"交给 Claude Code 去做"的委派意图才下发可写任务。这里有两类风险：一是"误写工作区"（Claude 自动改文件），二是"上下文外发到 Anthropic 服务"（prompt 与仓库上下文用于推理）。门禁同时覆盖这两点——既确认用户要 Claude 动手，也确认用户知道内容会发往外部服务。
- 命令：`node ${CODEX_PLUGIN_ROOT}/scripts/claude-companion.mjs task "<args>"`。

### 4.2 内部 skills（3 个，不可被用户直接调用）

- `claude-cli-runtime`：运行时调用契约。如何拼 companion 命令、参数边界、路由标志剥离规则。约束主控"一次请求一次调用，不要自己额外操作"。
- `claude-result-handling`：**结果处理纪律**。镜像参考插件同名 skill 的核心规则——评审结果呈现后停下，先问用户要不要改，未经允许不擅自动手改代码。
- `claude-prompting`：给 Claude 写高质量 prompt 的指引。评审/任务的结构化模板，配合 JSON schema 约束输出。

## 5. 运行时命令面

`claude-companion.mjs <subcommand> [args]`，镜像 `codex-companion.mjs`：

| 子命令 | 作用 |
|---|---|
| `setup` | 检查 `claude` 安装/登录状态；探测 transcript 契约并记入配置。支持 `--json`。（v1.1 起追加：安装/卸载可选 hook） |
| `review` | 运行只读评审。支持 `--base`、`--scope`、focus 文本、`--background`、`--wait`。 |
| `task` | 运行可写任务委派。支持 `--background`、`--model`、`--effort`、`--resume`、`--fresh`。 |
| `status` | 查后台作业状态（读 `claude agents --json --all` + 本地作业索引）。 |
| `result` | 取某作业最终结果（读 transcript）。支持 `--json`。 |
| `cancel` | 取消后台作业（`claude stop <id>`）。 |

不做 `transfer`。

> **为何没有 `task-worker`**：参考插件的 `task-worker` 是它自建 broker 架构下的 detached worker 进程，负责后台任务的真正执行与生命周期。本插件**复用 Claude Code 原生后台**（`claude --background` 自己 detach 并由 `claude agents`/`stop` 管理），所以 companion 不持有后台进程——`task --background` 调用后即返回，由 Claude Code 拥有执行、取消、日志。没有需要 companion 自己托管的 worker，因此删去 `task-worker`，与"不自建 broker、复用原生后台"的非目标保持一致。

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
→ 记录作业 { jobId, claudeShortId, claudeSessionId(uuid), cwd, transcriptPath, request, status, startedAt, updatedAt }
```

- **启动时即解析并存储 transcript 实际路径**（`transcriptPath`），不在 `result` 时才按规则现推。这样即便后续 slug 规则或路径约定变化，已存的路径仍可用。
- `status`、`result`、`cancel` 的状态判定见 §6.3 的状态机，transcript 读取契约见 §6.4。

### 6.3 作业状态机（agents 当 best-effort + 插件自有状态）

不把 `claude agents --json` 当唯一真相源，而是插件维护自己的状态机，agents 输出作为信号之一：

- 插件自有状态：`queued` → `running` → `completed` / `failed` / `cancelled`，加兜底态 `unknown`、`lost`。
- 状态来源融合：
  - 启动成功 → `running`，持久化作业记录。
  - `status` 时读 `claude agents --json --all`：实测**后台作业记录带 `state`**（如 `done`），据此推进到 `completed`；按 `claudeShortId` / `claudeSessionId` 匹配。
  - agents 列表里查不到该作业，且 transcript 已有终结消息 → `completed`（结果可取）。
  - agents 列表查不到、transcript 也无终结消息、进程不存在 → `lost`（无法确认结果，明确报告而非假装完成）。
  - agents 输出结构与预期不符（字段缺失/格式变化）→ 标 `unknown`，降级为"请用户手动 `claude agents` 查看"，不静默当成功。
- 为 agents 输出定义一个**适配层**：集中解析已知字段（`state`/`sessionId`/`pid` 等），结构变化时只改适配层。
- `cancel`：`claude stop <shortId>`，成功后置 `cancelled`；stop 失败按 `unknown` 处理并提示。

### 6.4 transcript 读取契约（防御式）

transcript 路径与 JSONL 结构是 Claude Code 私有细节，按以下方式降低耦合：

- **路径**：优先用作业记录里启动时存下的 `transcriptPath`；缺失时才按 `~/.claude/projects/<cwd-slug>/<uuid>.jsonl` 规则现推，并对 cwd 做 realpath 归一（处理符号链接、worktree 移动）。
- **探测**：`setup` 阶段用一次极小的真实/dry 调用确认"当前 `claude` 版本下 transcript 路径与最终消息结构成立"，把契约状态记入配置。契约不成立时，后台 `result` 明确返回 `transcript_unavailable` 并提示用户用 `claude agents`/`logs` 手动查看，而不是吐空结果。
- **解析**：逐行容错解析 JSONL，跳过损坏行；只认已知的终结事件类型（最终 assistant/result 消息）与文件改动记录；拿不到就报 `transcript_unavailable`，不猜测、不拼接半成品。
- **版本不符**：结构与预期契约偏离时返回明确的"不支持的 Claude 版本/格式"错误，引导用户升级插件或反馈，不做静默降级。

### 6.5 状态持久化

- 按 workspace 根路径 hash 分目录（镜像参考插件 `state.mjs` 思路）。
- 存：作业列表（含 `transcriptPath`、状态机当前态）+ 配置（transcript 契约探测结果；v1.1 起含 hook 状态）。
- 位置：优先 `~/.codex/.cc-plugin/state/<workspace-slug>-<hash>/`，回退 `os.tmpdir()`。
- 保留最近 N 条作业（如 50），自动清理过旧记录。

## 7. 安全模型

### 7.1 数据外发知情

`claude` 虽是本机进程，但推理在 Anthropic 服务端完成：prompt 与所选仓库上下文会**发送到外部服务**。因此本插件不能声称"数据不外发"。

- review 与 delegate 都需要用户对"把内容发给 Claude Code（经 Anthropic 服务）"知情。skill 文档需明确说明可能外发的内容范围（diff、指定文件、任务描述）。
- 只收集最小必要上下文：评审用 diff/指定文件，任务用任务描述 + 必要范围，不做全仓库无差别外发。
- 不打印、不写日志、不提交凭据；prompt 通过参数/stdin 传给本机 `claude` 进程，不再转发给 Anthropic 以外的第三方。

### 7.2 写边界（已实测验证）

- **评审**：`--permission-mode plan`，请求 Claude 只读不写。
- **委派任务**：`--permission-mode acceptEdits` + `--add-dir <repo>`，把写操作限制在仓库内。
- **关键认知**：这些标志由 **Claude Code 自身强制执行**，本插件不做二次沙箱兜底。
- **验证结果（2026-06-27，A3）**：env-gated 集成测试 `tests/e2e/write-boundary.e2e.test.mjs` 真实调用本机 `claude` 实测：仓库内写成功；仓库外写（绝对路径、符号链接逃逸到 sibling 目录）被 Claude Code 拒绝。据此文档措辞从“请求 Claude 限制”升级为“已验证限制在仓库内”。该测试默认跳过、不进 CI（依赖登录态与真实推理）。

### 7.3 setup 与失败处理

- **`setup`**：检查 `claude` 是否安装、是否已登录（未登录时提示用户本机登录，不请求沙箱/网络升级来做 auth）；并探测 transcript 契约是否成立（见 §6.4）。
- **不引入兜底降级**：调用失败、未登录、解析失败都返回结构化错误码，不静默吞掉、不返回降级结果。

错误码（初版）：`missing_cli`（无 `claude`）、`auth_required`（需登录）、`invalid_json`（结果解析失败）、`job_not_found`、`transcript_unavailable`（transcript 路径/结构不符合预期契约）、`nonzero_exit`、`timeout`（仅显式有限等待时）。

## 8. Hooks（v1.1，可选组件）

**v1 不实现 hooks**。先把 review/delegate 的前台+后台生命周期跑稳，再在 v1.1 加入 hook 门禁，降低初版风险面。

> 实现修订（2026-06-27，基于 Codex 0.142 实测）：下面"不放进 manifest、由 setup 写入 ~/.codex"的原预案已被推翻。Codex 0.142 的 `PluginManifest` 接受 `hooks` 字段，参考插件 superpowers v6.0.2 即声明 `"hooks": "./hooks/hooks-codex.json"` 并与 cc 共存正常。故 A1 改走 **manifest 声明路线**：hook 随插件安装由 Codex 注册，用户在 Codex UI 信任（trust 机制，带 `trusted_hash`）后生效，插件**不写用户全局/项目级配置**，规避了原预案最大的安全面。

- Stop hook 实测契约（从 codex 原生二进制 JSON schema 提取）：
  - 输入（stdin JSON）：`cwd`、`hook_event_name:"Stop"`、`last_assistant_message`、`model`、`permission_mode`、`session_id`、`stop_hook_active`、`transcript_path`、`turn_id`。
  - 输出（stdout JSON）：`decision` 枚举仅 `"block"`，`block` 时 `reason` 必填；省略 `decision`（或 `continue:true`）放行；`systemMessage` 给用户提示；`stopReason`/`suppressOutput` 可选。
  - `stop_hook_active` 为真表示已在 stop-hook 循环内，必须短路放行以防死循环。
- 内容：`stop-review-gate` hook——Codex 收尾前调用本插件，由插件按门禁开关决定是否对当前改动做一次（只读）评审，并据评审结果放行或拦截。
- **门禁开关**：默认关闭，存在 per-workspace `state.json` 的 `config.reviewGate`；用户通过 `setup --enable-review-gate` 显式开启。hook 脚本读不到开关或开关关闭时直接放行（`continue:true`），等价于 no-op。
- **安全**：hook 仅读取 stdin 契约字段与本插件 state，不改用户配置；评审走既有只读 `review` 路径（`--permission-mode plan`），不写文件。


## 9. 测试策略

分三层。重点是：最脆弱的契约（CLI 输出、后台状态、transcript 结构、写边界）恰恰不能只靠手动 smoke，要用 fixture 固定下来。

### 9.1 纯逻辑单测（`node:test`，零依赖，默认运行）

- 参数解析：路由标志 vs prompt 文本的切分。
- claude 命令拼装：评审走 `plan`、任务走 `acceptEdits`、`--add-dir`、`--model`、`--background` 等组合正确。
- 作业状态机：`queued/running/completed/failed/cancelled/unknown/lost` 各转换；agents 信号 + transcript 信号融合判定。
- 错误分类：各错误码（含 `transcript_unavailable`）触发条件。
- skill 文档契约：SKILL.md frontmatter 完整、关键段落未截断、引用的脚本存在。

### 9.2 Fixture 契约测试（用真实样本固定外部契约，默认运行）

- 用真实采集的 `claude agents --json --all` 输出做 fixture，喂给适配层，断言能正确解析后台/前台记录、缺字段时降级为 `unknown`。
- 用真实 transcript JSONL 样本（含正常、空文件、损坏行、无终结消息）做 fixture，断言解析取到最终消息/改动文件，异常时报 `transcript_unavailable`。
- 这些 fixture 即是"契约快照"：将来 Claude 改了格式，这层测试先红，提示更新适配层。

### 9.3 可选集成测试（env-gated，默认跳过）

- 由环境变量（如 `CC_PLUGIN_E2E=1`）开启，真实调用本机 `claude`：前台只读评审、后台任务起停、transcript 落地路径与结构。
- **写边界用例（#4，已实测）**：在受控临时仓库里委派可写任务，断言写操作被 `acceptEdits + --add-dir` 限制在仓库内。逃逸向量取“真正越界”的两类：仓库外绝对路径、经符号链接逃逸到 sibling 目录。用仓库内写成功且内容正确作对照，排除“模型没尝试”的假阳性。（嵌套仓库不构成越界——它在外层 repo 内、`--add-dir` 范围内，写入本就允许，故不作为边界用例。）已通过，文档措辞升级为“已验证限制在仓库内”。
- 不进 CI 默认流水线（依赖登录态与网络）；作为本地/手动验证手段。

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
      session-lifecycle.mjs      # v1.1，可选安装
      stop-review-gate.mjs       # v1.1，可选安装
  schemas/
    review-output.schema.json
  tests/
    *.test.mjs
    fixtures/                    # 真实 agents --json / transcript JSONL 样本
  README.md
  LICENSE
```

## 11. 实现阶段建议

1. **骨架**：`plugin.json` + `marketplace.json` + 目录结构 + `args.mjs` + companion 分发入口。
2. **setup 与契约探测**：`setup` 子命令——检查 `claude` 安装/登录 + 探测 transcript 契约并记入配置。先把"契约成立与否"摸清，后续后台层才有依据。
3. **前台评审**：`claude.mjs`（构建/spawn/解析）+ `git.mjs` + `cc:review` skill + `review` 子命令，跑通只读评审。
4. **前台任务**：`cc:delegate` skill + `task` 子命令，跑通可写委派。
5. **后台作业**：`jobs.mjs`（状态机）+ `state.mjs` + `transcript.mjs`（防御解析）+ `status`/`result`/`cancel`，含 agents 适配层与 `unknown/lost` 兜底。
6. **内部 skills**：`claude-cli-runtime` / `claude-result-handling` / `claude-prompting`。
7. **测试与文档**：§9 三层测试（含 fixture 契约测试）+ README。写边界用例（env-gated）跑通后，再决定文档措辞。
8. **（v1.1）hooks**：`session-lifecycle` + `stop-review-gate` + `setup` 的幂等/备份/冲突检测安装。

每阶段交付后做最小验证（dry-run / smoke / fixture），有验证证据才标记完成。
