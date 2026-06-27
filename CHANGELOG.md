# Changelog

本项目的所有显著变更都记录在本文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0] - 2026-06-27

### Added

- **companion 参数严格校验**：未知 flag、`string` flag 缺值、开关误带取值一律返回 `invalid_args` 并指明问题 flag，不再被静默吞掉。此前 `--scop`（拼错）会被当成自由文本塞进 prompt、`--base` 缺值会变空字符串、`--fresh=false` 会被当真。
- **按命令拆分参数声明**：`SPEC` 拆为 `review`/`task`/`job`/`setup` 四套，各命令只接受对其有意义的 flag；误用 flag（如对 `task` 传 `--scope`）判为未知参数而非静默忽略。`review` 的 `--scope` 做 `working-tree|branch` 枚举校验。
- **`CONTRIBUTING.md` 与 `SECURITY.md`**：补齐贡献流程（测试命令、本地安装验证、PR 约定）与安全策略（私有漏洞报告、安全边界说明）。

### Changed

- 统一 README 的 Node 版本要求为 `>=18.18.0`，与 `package.json` 的 `engines` 对齐。
- `plugins/cc/README.md` 能力列表补上 `cc:adversarial-review`；测试说明去掉硬编码数量，避免随用例增长过时。

## [0.3.0] - 2026-06-27

向参考项 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) 看齐的功能对齐。

### Added

- **`cc:adversarial-review`（挑战式评审）**：让 Claude Code 做只读的挑战式评审,质疑实现方向、设计取舍与隐藏假设,重点打高代价/难发现的失败面(auth、数据丢失、回滚、竞态、版本漂移),而非只挑实现缺陷。复用 `cc:review` 的 target 选择、前台/后台作业与 P0–P3 结构化输出。
- **`cc:delegate` 续线程体验**：新增 `--fresh`(强制新开会话)与 `resume-candidate` 探测;未指定 `--resume`/`--fresh` 时,若检测到本仓库上一次后台委派的可续线程,会询问续接还是新开。

### Notes

- 参考项的 `transfer`(把会话导成对方可 resume 的线程)未镜像:其依赖对方运行时的「外部 agent 会话导入」能力,而 Claude Code 当前无导入外部会话的能力(`--resume` 只认自身 session)。README 已注明该差异。

## [0.2.0] - 2026-06-27

### Added

- **Stop hook 评审门禁**：会话结束时可自动触发 Claude Code 评审，走 plugin manifest `hooks` 字段声明路线（实测 Codex 0.142 接受）。默认关闭、需用户显式开启、fail-open，开关状态存于 per-workspace state。
- **评审结构化输出**：`cc:review` 接入 `--json-schema`，对评审结果做强约束结构化输出。
- **写边界集成测试**：新增 env-gated（`CC_PLUGIN_E2E=1`）端到端测试，实测 `acceptEdits + --add-dir` 将写操作限制在仓库内。

### Changed

- model/effort 参数透传修正（此前 review 漏传 effort）。
- 作业状态渲染补充 `lost` 态提示。
- 据写边界实测结果，将 spec §7.2 与 README 中相关措辞由“预期”升级为“已验证限制”。

### Fixed

- transcript 防御式解析：兼容纯字符串 content 与 MultiEdit/NotebookEdit 条目。
- `cc:result` 先校验 job 存在再查 agents，避免误判。
- CI 测试发现修正，改用 `node --test` 默认递归。

### Performance

- `parseTranscript` 增加 mtime+size 指纹缓存与 256 条 LRU 上限。

## [0.1.0] - 2026-06-26

### Added

- 首个可用版本：`cc` 插件本体与 Codex 本地 marketplace 骨架。
- `cc:review` —— 让 Claude Code 只读评审当前改动 / 分支 / PR。
- `cc:delegate` —— 把编码任务委派给 Claude Code 执行（可写，限定在仓库内），支持前台/后台作业。
- 零依赖 Node.js 运行时：companion 入口、CLI 参数解析、作业状态机、状态目录与作业索引、git 评审目标解析、claude 调用与输出解析、结果渲染、防御式 transcript 解析。
- `status` / `result` / `cancel` / `setup` 子命令。
- 中文 README、评审 schema、端到端冒烟验证记录、LICENSE、CI。

[0.4.0]: https://github.com/itstarts/cc-plugin-codex/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/itstarts/cc-plugin-codex/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/itstarts/cc-plugin-codex/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/itstarts/cc-plugin-codex/releases/tag/v0.1.0
