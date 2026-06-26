---
name: claude-prompting
description: Internal guidance for composing high-quality prompts for Claude Code review and delegate runs. Not for direct user invocation.
metadata:
  short-description: Prompt templates for Claude Code runs
  allow_implicit_invocation: false
---

# Claude Prompting (internal)

- Put stable, long context first; variable controls last (better prompt caching).
- Review prompts: state the goal, the risk focus, and require concrete file:line findings grouped by severity.
- Delegate prompts: state the task, acceptance criteria, what to preserve, and the allowed scope.
- Keep prompts minimal and on-task; send only the context needed for the request.
