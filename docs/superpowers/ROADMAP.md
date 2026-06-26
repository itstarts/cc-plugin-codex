# cc 插件后续优化清单（Roadmap / TODO）

> 本文件记录 v0.1.0 之后可做的优化项,供后续会话直接接续。当前状态:插件已实现、评审、真实 Codex 验证可安装,75 个测试通过,已发布到 GitHub。

## 新会话起步上下文

- 仓库:`/Users/sd/WorkSpace/codex-skills/cc-plugin-codex`,远程 `git@github.com:itstarts/cc-plugin-codex.git`。
- 设计:`docs/superpowers/specs/2026-06-26-cc-plugin-codex-design.md`;实现计划:`docs/superpowers/plans/2026-06-26-cc-plugin-codex.md`;端到端验证记录:`plugins/cc/tests/SMOKE.md`。
- 硬约束:零依赖纯 Node.js ESM;`.agents/plugins/marketplace.json` + `plugins/cc/` 布局是 Codex 安装强制要求,不能改回参考项目的 `.claude-plugin/` 布局;测试用 `cd plugins/cc && node --test`(根目录可用 `npm test`)。
- git 规矩:默认不直接推 main,每次 push 需用户明确授权。

## A. 功能完善（价值最高）

### A1. Stop hook 评审门禁（v1.1）✅ 已完成
Codex 收尾前自动调用 Claude 做一次只读评审,P0/P1 拦截(`decision:block`)并说明原因,否则放行(`continue:true`)。
- **改走 manifest 声明路线**:实测 Codex 0.142 的 PluginManifest 接受 `hooks` 字段(参考插件 superpowers 亦然),推翻 spec §8 旧假设。插件不写用户全局/项目级配置,trust 由 Codex UI 处理。
- `plugin.json` 声明 `"hooks": "./hooks/hooks-codex.json"`(Stop 事件);`hooks/stop-review-gate` wrapper 经 `$0` 自定位 companion,透传 stdin Stop 契约给 `gate` 子命令。
- 门禁默认关闭,`setup --enable-review-gate` 显式开启,状态存 per-workspace state.json。
- fail-open:开关关闭/输入非法/claude 不可用/`stop_hook_active` 一律放行,始终退出码 0。
- 实测确认:manifest 含 hooks 可正常安装启用、hook 文件落入缓存、wrapper 端到端自定位运行;hook 需用户在 Codex 信任后才触发(trust 机制,符合预期)。测试 98 通过。

### A2. `--json-schema` 强约束评审输出 ✅ 已完成
`plugins/cc/schemas/review-output.schema.json` 已接入运行时。
- `claude.mjs` 新增 `loadReviewSchema()`(读取并压缩 schema)与 `parseReviewFindings()`(解析结构化结果);`buildClaudeArgs` 支持 `schema` 参数透传 `--json-schema`。
- `cmdReview`(前台/后台)与 `cmdResult`(review 作业)解析出 `findings`/`summary`;render 层按 severity 排序展示,`--json` 暴露原始字段。
- 解析失败时回退自由文本,保证健壮性。测试 82 通过。

### A3. 写边界 env-gated 集成测试 ✅ 已完成
见 spec §9.3。实测 `--permission-mode acceptEdits + --add-dir <repo>` 把写限制在仓库内。
- 测试 `plugins/cc/tests/e2e/write-boundary.e2e.test.mjs`:在受控临时仓库真实委派可写任务,覆盖仓库内写、仓库外绝对路径、符号链接逃逸到 sibling 目录。
- 由 `CC_PLUGIN_E2E=1` 开启,默认跳过,不进 CI。实测通过(真实 claude,约 39s):仓库内写成功,仓库外写被拒。
- 据此 spec §7.2 与 README 措辞已从"请求 Claude 限制"升级为"已验证限制在仓库内"。

## B. 健壮性（Codex 评审记录的延后项）✅ 已完成

- **B1** `--effort`/`--model` 透传校验:`buildClaudeArgs` 原样透传 alias 与全名(model 传给 `claude` CLI,由其自校验,本插件不做二次枚举兜底);修正 review 入口漏传 effort 的缺陷,使 review/task 行为一致;补单测固定行为。
- **B2** 后台 `lost` 态用户提示:render 层新增 jobs 文本展示,含 lost 时给出"运行 `claude agents` 手动查看或重新委派"引导。
- **B3** transcript 终结事件防御:支持纯字符串 content 的终结消息(无 result 行也能取结果);写工具集扩展到 MultiEdit/NotebookEdit。(经核实 Claude 终结事件仅 `result`/`assistant`,未臆造 `stop`/`end` 等未证实类型。)
- **B4** status 性能:parseTranscript 按文件 mtime+size 指纹缓存解析结果,文件未变时复用,变更/删除自动失效;加 256 条 LRU 上限防长跑增长。

## C. 工程/发布完善

- **C1** 确认 CI 跑绿:`gh run list --repo itstarts/cc-plugin-codex --limit 3`,不绿要修。极小。
- **C2** CHANGELOG.md:正式发版时补(当前按 YAGNI 跳过)。小。
- **C3** 版本号策略:plugin.json 现为 `0.1.0`,定个 bump 流程(参考项目有 `bump-version.mjs`,可简化)。小。
- **C4** README 示例输出/配图:加一段真实评审输出示例,更直观。小。

## 推荐优先级

先做 ~~A2（json-schema,小而高价值）~~（已完成）→ ~~C1（确认 CI）~~（已完成）→ ~~A1（Stop hook,v1.1 核心特性）~~（已完成）→ ~~A3（写边界验证）~~（已完成）。
B 类按需,锦上添花。
