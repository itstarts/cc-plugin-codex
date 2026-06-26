---
name: claude-cli-runtime
description: Internal contract for invoking the claude-companion runtime. Not for direct user invocation.
metadata:
  short-description: Internal companion invocation contract
  allow_implicit_invocation: false
---

# Claude CLI Runtime (internal)

Rules for calling the companion script from review/delegate flows.

- Invoke exactly once per request: `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" <review|task> <ARGS>` (or, if Codex sets no plugin-root variable, the skill-root-relative `node "../../scripts/claude-companion.mjs" ...`).
- Strip routing flags (`--background`, `--wait`, `--fresh`, `--resume`, `--model`, `--effort`, `--json`) out of the natural-language task/focus text; pass them as flags, not as prompt text.
- Default review to read-only (`review`), tasks to write-capable (`task`).
- Do not inspect the repo, call other commands, or do independent work beyond the single companion call.
