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
- `--resume <id>` continues a prior Claude session.
- Add `--json` only when you need structured output.

Boundaries and authorization:
- Only delegate when the user clearly intends to hand the task to Claude Code.
- Two risks are in play: Claude Code may edit files in the repo, and the task + repo context are sent to Anthropic's service. Make sure the user intends both.
- After Claude Code returns, present the outcome and changed files; follow the claude-result-handling discipline before making further changes yourself.
