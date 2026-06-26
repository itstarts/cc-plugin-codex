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

`node --test` → 68 tests, 68 pass, 0 fail。

## 说明

- 冒烟使用 `--model haiku` 降低成本，与生产模型选择无关。
- 冒烟产生的临时文件 `SMOKE_SCRATCH.txt` 已清理，未进入任何提交。
- 写边界（spec §9.3 的 env-gated 严格验证：符号链接、嵌套仓库、cwd 外文件）仍按计划留待后续；本次仅验证了常规仓库内写入被正确限定。
