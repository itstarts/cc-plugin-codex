---
name: delegate
description: Use when the user asks Codex to hand a coding task (investigate a bug, fix, implement a feature) to Claude Code, allowing Claude Code to edit files. The task description and repository context are sent to Claude Code, which runs inference on Anthropic's service and may write files in the repo. Requires the user to clearly intend delegation to Claude Code.
metadata:
  short-description: Delegate a write-capable coding task to Claude Code
---

# Claude Code Delegate

Hand a coding task to the local Claude Code CLI with write access scoped to the repo.

Run exactly one command from this skill's directory, forwarding the user's raw arguments as the task text:

```bash
node "../../scripts/claude-companion.mjs" task <ARGS>
```

The path is relative to this `SKILL.md`'s directory (`<plugin>/skills/delegate/`), so it resolves whether the plugin runs from its repo or the installed cache copy.

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
