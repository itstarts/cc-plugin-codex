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

### A3. 写边界 env-gated 集成测试
见 spec §9.3。实测 `--permission-mode acceptEdits + --add-dir <repo>` 是否真把写限制在仓库内。
- 覆盖:符号链接、嵌套仓库、cwd 外的生成文件、工具权限组合。
- 由环境变量(如 `CC_PLUGIN_E2E=1`)开启,默认跳过,不进 CI。
- 验证通过后,才可把文档措辞从"请求 Claude 限制"升级为"已验证限制在仓库内"。
- 工作量:中。对外宣称安全性时再做。

## B. 健壮性（Codex 评审记录的延后项）

- **B1** `--effort`/`--model` 透传校验:确认 alias 与全名都正确传给 claude。小。
- **B2** 后台 `lost` 态的用户提示:状态机已有 `lost`,render 层可给更明确的"无法确认结果,请手动 `claude agents` 查看"引导。小。
- **B3** transcript 解析支持更多终结事件类型:目前认 `result`/`assistant`,Claude 若新增类型可能漏,可加防御。小。
- **B4** status 性能:目前对每个 job 都重新解析整个 transcript(Codex 评审提出),job 多时可加缓存或轻量检查。小,非紧急。

## C. 工程/发布完善

- **C1** 确认 CI 跑绿:`gh run list --repo itstarts/cc-plugin-codex --limit 3`,不绿要修。极小。
- **C2** CHANGELOG.md:正式发版时补(当前按 YAGNI 跳过)。小。
- **C3** 版本号策略:plugin.json 现为 `0.1.0`,定个 bump 流程(参考项目有 `bump-version.mjs`,可简化)。小。
- **C4** README 示例输出/配图:加一段真实评审输出示例,更直观。小。

## 推荐优先级

先做 ~~A2（json-schema,小而高价值）~~（已完成）→ ~~C1（确认 CI）~~（已完成）→ ~~A1（Stop hook,v1.1 核心特性）~~（已完成）。
A3 写边界测试在需要对外宣称安全性时再做。B 类按需,锦上添花。
