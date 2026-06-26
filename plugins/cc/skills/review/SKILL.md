---
name: review
description: Use when the user asks Codex to have Claude Code (or "Claude") review the current changes, a diff, a branch, or a PR — read-only. The prompt and selected repository context are sent to Claude Code, which runs inference on Anthropic's service. Do not use for ordinary in-Codex review unless the user names Claude Code.
metadata:
  short-description: Delegate a read-only review to Claude Code
---

# Claude Code Review

Delegate a read-only code review to the local Claude Code CLI.

Run exactly one command, forwarding the user's raw arguments. Use `${PLUGIN_ROOT}` if Codex sets it; otherwise run from the skill root with the relative path:

```bash
# 若 Codex 提供插件根变量：
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" review <ARGS>
# 否则从本 skill 目录运行：
node "../../scripts/claude-companion.mjs" review <ARGS>
```

Argument rules:
- `--base <ref>` and `--scope working-tree|branch` select the diff target.
- Free text after flags is treated as an optional review focus.
- `--background` runs as a Claude background job (use for large reviews); otherwise foreground.
- `--model <alias>` optionally selects the Claude model.
- Add `--json` only when you need structured output.

Boundaries:
- This is review-only. Do not modify files based on the review.
- Present findings, then stop and ask the user which issues to fix. Follow the claude-result-handling discipline.
- The review sends the diff and focus to Claude Code (Anthropic service). Proceed when the user has asked for Claude Code review; collect only the minimum diff needed.
