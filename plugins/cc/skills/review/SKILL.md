---
name: review
description: Use when the user asks Codex to have Claude Code (or "Claude") review the current changes, a diff, a branch, or a PR — read-only. The prompt and selected repository context are sent to Claude Code, which runs inference on Anthropic's service. Do not use for ordinary in-Codex review unless the user names Claude Code.
metadata:
  short-description: Delegate a read-only review to Claude Code
---

# Claude Code Review

Delegate a read-only code review to the local Claude Code CLI.

Run exactly one command from this skill's directory, forwarding the user's raw arguments:

```bash
node "../../scripts/claude-companion.mjs" review <ARGS>
```

The path is relative to this `SKILL.md`'s directory (`<plugin>/skills/review/`), so it resolves whether the plugin runs from its repo or the installed cache copy.

Argument rules:
- `--base <ref>` and `--scope auto|working-tree|branch` select the review target. `auto` is the default: dirty workspaces use working-tree context; clean workspaces use a branch diff against the detected default branch.
- Free text after flags is treated as an optional review focus.
- `--background` runs as a Claude background job (use for large reviews); otherwise foreground.
- `--model <alias>` optionally selects the Claude model.
- Add `--json` only when you need structured output.

Output:
- Review runs under a JSON schema, so findings come back structured (severity P0–P3, title, file:line, detail) plus an overall summary. Text mode prints them sorted by severity; `--json` exposes the raw `findings`/`summary` fields.

Boundaries:
- This is review-only. Do not modify files based on the review.
- Present findings, then stop and ask the user which issues to fix. Follow the claude-result-handling discipline.
- The review sends the diff and focus to Claude Code (Anthropic service). Proceed when the user has asked for Claude Code review; collect only the minimum diff needed.
