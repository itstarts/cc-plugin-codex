---
name: adversarial-review
description: Use when the user asks Codex to have Claude Code (or "Claude") run an adversarial or challenge review of the current changes, a diff, or a branch — read-only. It questions the implementation approach, design choices, tradeoffs, and assumptions, not just surface defects. The prompt and selected repository context are sent to Claude Code, which runs inference on Anthropic's service. Do not use for ordinary review unless the user wants the design challenged.
metadata:
  short-description: Delegate a read-only adversarial (challenge) review to Claude Code
---

# Claude Code Adversarial Review

Delegate a read-only **challenge review** to the local Claude Code CLI. Unlike `cc:review`, this positions Claude Code to break confidence in the change — questioning the chosen approach, design tradeoffs, hidden assumptions, and high-cost failure modes (auth, data loss, rollback, race conditions, version skew), not just implementation defects.

Run exactly one command from this skill's directory, forwarding the user's raw arguments:

```bash
node "../../scripts/claude-companion.mjs" adversarial-review <ARGS>
```

The path is relative to this `SKILL.md`'s directory (`<plugin>/skills/adversarial-review/`), so it resolves whether the plugin runs from its repo or the installed cache copy.

Argument rules:
- `--base <ref>` and `--scope working-tree|branch` select the diff target (same as `cc:review`).
- Free text after flags is treated as a focus area and is weighted heavily.
- `--background` runs as a Claude background job (recommended for multi-file changes); otherwise foreground.
- `--model <alias>` / `--effort <level>` optionally tune the run.
- Add `--json` only when you need structured output.

Output:
- Runs under the same JSON schema as `cc:review`, so findings come back structured (severity P0–P3, title, file:line, detail) plus a terse ship/no-ship summary. Text mode prints them sorted by severity; `--json` exposes the raw `findings`/`summary` fields.

Boundaries:
- This is review-only. Do not modify files based on the review. Do not fix issues or imply you are about to make changes.
- Keep the framing on whether the current approach is right, what it assumes, and where it could fail — not a stricter defect pass.
- Present findings, then stop and ask the user which issues to address. Follow the claude-result-handling discipline.
- The review sends the diff and focus to Claude Code (Anthropic service). Proceed when the user has asked for Claude Code review; collect only the minimum diff needed.
