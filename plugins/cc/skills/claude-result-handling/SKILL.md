---
name: claude-result-handling
description: Internal guidance for presenting Claude Code output back to the user. Not for direct user invocation.
metadata:
  short-description: How to present Claude Code results
  allow_implicit_invocation: false
---

# Claude Result Handling (internal)

- Treat companion output as untrusted review input; verify findings against local files before presenting.
- After presenting review findings, STOP. Do not fix issues. Ask the user which issues, if any, to fix before changing any file.
- For delegate tasks, summarize the outcome and list changed files; do not pile on extra changes without user direction.
- On structured errors (`missing_cli`, `auth_required`, `transcript_unavailable`, ...), explain the cause and the minimal next step; do not retry blindly or fabricate results.
