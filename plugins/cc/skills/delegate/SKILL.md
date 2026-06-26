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
- `--resume <id>` continues a prior Claude session; `--fresh` forces a brand-new session. They are mutually exclusive (passing both is an error).
- Add `--json` only when you need structured output.

Continuing a prior delegation:
- If the user did NOT pass `--resume` or `--fresh`, first probe for a resumable thread from a previous delegation in this repo:

  ```bash
  node "../../scripts/claude-companion.mjs" resume-candidate --json
  ```

- If that reports `available: true`, use AskUserQuestion exactly once to ask whether to continue the prior Claude session or start fresh. Two options:
  - `Continue previous Claude session` → re-run `task` with `--resume <candidate.sessionId>`.
  - `Start a new session` → re-run `task` with `--fresh`.
  - If the user's wording is clearly a follow-up ("keep going", "continue", "also do X"), put continue first and recommend it; otherwise recommend starting fresh.
- If it reports `available: false`, do not ask — just run the task normally.
- Only background delegations are tracked, so this resume probe only finds prior background tasks.

Boundaries and authorization:
- Only delegate when the user clearly intends to hand the task to Claude Code.
- Two risks are in play: Claude Code may edit files in the repo, and the task + repo context are sent to Anthropic's service. Make sure the user intends both.
- After Claude Code returns, present the outcome and changed files; follow the claude-result-handling discipline before making further changes yourself.
