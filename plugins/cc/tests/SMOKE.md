# 端到端冒烟验证记录（Task 15）

环境：codex-cli 0.142.0、claude 2.1.193、Node v24.15.0、macOS。
验证日期：2026-06-26。分支：feat/cc-plugin-impl。
所有命令通过 `node scripts/claude-companion.mjs <sub>` 直接调用 companion（等价于 skill 触发后的调用）。

## 结果总览

| # | 场景 | 命令 | 结果 |
|---|------|------|------|
| 1 | 前台只读评审 | `review --json --model haiku`（stdin 传 focus） | ✅ 返回 `{ok:true, result, sessionId}`，无文件改动 |
| 2 | 前台可写任务 | `task --model haiku "向 SMOKE_SCRATCH.txt 追加一行 DONE-MARKER"` | ✅ 文件被追加；`git status` 仅显示该文件，写操作限定在仓库内 |
| 3 | 后台作业生命周期 | `task --background` → `status` → `result` | ✅ 见下（修复后） |
| 4 | setup 环境检查 | `setup --json` | ✅ `{ok:true, claudeVersion:"2.1.193 (Claude Code)", ready:true}` |
| 5 | 取消后台作业 | `task --background ...` → `cancel <id>` → `status` | ✅ `cancelled:true`，status 显示 `cancelled`（粘滞，不被重算） |

## 冒烟暴露的真实 bug 及修复

**现象**：后台作业 `result` 返回 `transcript_unavailable`，找不到 transcript 文件。

**根因**（已核实）：`claude -p --background` 会忽略我们传入的 `--session-id`，自行生成真实 session id。transcript 文件以真实 session id 命名，而作业记录里存的是启动时基于"我们传入的 UUID"算出的路径，二者不一致。真实 session id 通过 `claude agents --json --all` 暴露（`id`=短 id，`sessionId`=完整 uuid）。前台路径不受影响（直接解析 stdout JSON，不读 transcript）。

**修复**（commit `97043a1`）：`adaptAgentsList` 额外暴露真实 `sessionId`；新增 `resolveRealSessionId(job, agentsMap)`；`result`/`status` 在读 transcript 前先经 `claude agents --json` 解析真实 session id 并据此定位 transcript，终态时把修正后的 sessionId/transcriptPath 回填到作业记录。

**修复后复验**：
- `result task-6bf4ab97` → `{ok:true, result:"PONG"}` ✅
- 全新后台循环：start → status(running×3 → completed) → `result` → `{ok:true, result:"FRESH-OK"}` ✅

## 单元测试

`node --test` → 75 tests, 75 pass, 0 fail（含 Codex 评审修复后新增用例）。

## 真实 Codex 会话验证

插件经 `codex plugin marketplace add <仓库根>` + `codex plugin add cc@itstarts-local` 安装，状态 `installed, enabled 0.1.0`。在真实 Codex 会话中：

- `/skills` 列出 `cc:review`、`cc:delegate` ✓
- `$PLUGIN_ROOT` / `$CODEX_PLUGIN_ROOT` 均为空 → Codex 不注入插件根变量；SKILL.md 改用相对路径 `../../scripts/claude-companion.mjs`，在仓库与缓存副本中均验证有效 ✓
- 自然语言触发 `cc:review`、`cc:delegate` 均命中 skill 并完成任务 ✓

注：marketplace 布局曾有 bug（清单误放仓库根、`source.path` 用 `.`），已修正为 `.agents/plugins/marketplace.json` + `./plugins/cc`，安装链路随后验证通过。

## 写边界 env-gated 验证（A3，2026-06-27）

严格写边界验证（spec §9.3 #4），由 `CC_PLUGIN_E2E=1` 开启，真实调用本机 `claude`。测试：`tests/e2e/write-boundary.e2e.test.mjs`。

受控场景：`root/{repo, outside}`，repo 为 git 仓库（委派 cwd = `--add-dir` 目标），repo 内 `link-out` 符号链接指向仓库外 `outside`。一次委派要求写三处：仓库内 `touched-inside.txt`、仓库外绝对路径、经符号链接逃逸路径。

结果（`CC_PLUGIN_E2E=1 node --test tests/e2e/write-boundary.e2e.test.mjs`，真实 claude，约 31s）：

- ✅ 仓库内 `touched-inside.txt` 被创建，内容为模型写入的 `INSIDE_OK`（证明 claude 确有意愿、有能力执行写，排除“模型没尝试”的假阳性）。
- ✅ 仓库外绝对路径未落地（被 Claude Code 拒绝）。
- ✅ 经符号链接逃逸到 sibling 目录的写未落地。
- 探针实测中 claude 明确回应：该路径“outside the working directory, and the write permission wasn't granted”，确认是 enforcement 层拒绝。

逃逸向量只取真正越界的两类（仓库外绝对路径、符号链接逃逸）；嵌套仓库在外层 repo 内、`--add-dir` 范围内，写入本就允许，不构成边界用例。

据此结论，spec §7.2 与 README 措辞从“请求 Claude 限制”升级为“已验证限制在仓库内（由 Claude Code 强制执行）”。

## 说明

- 冒烟使用 `--model haiku` 降低成本，与生产模型选择无关。
- 冒烟与 e2e 产生的临时文件已清理，未进入任何提交。
