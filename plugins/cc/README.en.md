# cc — Use Claude Code from Codex

**English** | [简体中文](README.md)

A Codex plugin that lets Codex delegate code review (read-only) and coding tasks (write-enabled) to the local Claude Code (`claude` CLI). It is the mirror direction of `openai/codex-plugin-cc` (which lets Claude Code call Codex).

## Capabilities

- `cc:review`: have Claude Code review the current changes / a given branch / a PR (read-only) and hand structured results back to Codex.
- `cc:adversarial-review`: have Claude Code run an adversarial review — question the implementation direction, design tradeoffs, and failure modes rather than only surface-level defects. Read-only.
- `cc:delegate`: hand a coding task (investigate, fix, implement) to Claude Code, allowing in-repo file edits, with foreground/background support.
- Background jobs: managed via the companion's `status` / `result <jobId>` / `cancel <jobId>` (reusing Claude Code's native background mechanism).

## Prerequisites

- Codex (codex-cli 0.142.0+) and the Claude Code CLI (command name `claude`) installed, with `claude` logged in locally.
- Node.js (>=18.18.0) installed.
- Check: both `claude --version` and `node --version` produce output.

## Installation

This repo is itself a Codex marketplace: the marketplace manifest is at `.agents/plugins/marketplace.json` and the plugin lives in `plugins/cc/`. Codex requires the marketplace manifest at `<root>/.agents/plugins/marketplace.json`, with the plugin directory referenced via `source.path` (e.g. `./plugins/cc`, relative to the marketplace root).

Recommended: install directly from GitHub (no clone needed):

```bash
codex plugin marketplace add itstarts/cc-plugin-codex   # pull this repo as a marketplace
codex plugin add cc@itstarts                             # install and enable
codex plugin list | grep cc                              # confirm: cc@itstarts  installed, enabled  0.4.0
```

The marketplace name is `itstarts` (from the `name` in `marketplace.json`), so the plugin id is always `cc@itstarts`.

Install from a local copy (development/offline): replace `itstarts/cc-plugin-codex` above with the **absolute path to the cloned repo root** (not `plugins/cc`), e.g. `codex plugin marketplace add /path/to/cc-plugin-codex`. Or configure `~/.codex/config.toml` manually:

```toml
[marketplaces.itstarts]
path = "<absolute path to the cloned repo root>"

[plugins."cc@itstarts"]
enabled = true
```

After installing, restart Codex to activate the plugin.

> Updating the plugin: a remote install is a Git marketplace — use `codex plugin marketplace upgrade itstarts` to pull the latest. A local-path install does not support `upgrade`; use `codex plugin remove cc@itstarts && codex plugin add cc@itstarts` to refresh the cached copy.

## Usage

Trigger with natural language in a Codex session (skills match implicitly by description), or pick explicitly with `/skills`:

- Review current changes: say "have Claude Code review the current changes" to hit `cc:review`. You can add `--base main --scope branch` to select the diff range, or append focus text.
- Adversarial review: say "have Claude Code challenge this design" to hit `cc:adversarial-review`. It questions the implementation direction, design tradeoffs, and failure modes rather than only surface defects; target selection matches `cc:review`, you can append focus text, read-only.
- Delegate a task: say "delegate this task to Claude Code: …" to hit `cc:delegate`. You can add `--background` to run in the background, `--model <alias>`, `--effort <level>`. When neither `--resume` nor `--fresh` is given, if a resumable thread from this repo's last background delegation is detected, it asks whether to resume or start fresh.

> Strict argument validation: a misspelled flag, a missing value for `--base`/`--model`/etc., or a switch given a value (e.g. `--fresh=false`) returns `invalid_args` and names the offending flag, rather than being silently ignored. Each subcommand only accepts flags meaningful to it (e.g. `--scope` is valid only for the review commands).

## Review output example

`cc:review` constrains Claude Code's output with `--json-schema` to structured results (findings graded P0–P3 + summary). The companion renders text by default, sorted by severity:

```text
Review found 3 issues:

[P0] Unvalidated user input concatenated into SQL (src/db/query.js:42)
  buildQuery concatenates req.query.name directly into the SQL string, risking injection. Use parameterized queries.
[P1] Uncaught async exception crashes the process (src/jobs/worker.js:88)
  The awaited call is not wrapped in try/catch; a reject bubbles up as unhandledRejection.
[P2] Magic number lacks a named constant (src/config.js:15)
  The timeout 30000 should be a named constant with a comment on its unit.

Summary: 1 P0 injection risk needs priority fixing, plus 1 P1 stability issue and several readability suggestions.
```

Add `--json` to get the companion JSON envelope (with `ok`/`sessionId` and the schema-parsed `findings`/`summary`), for programmatic consumption:

```json
{
  "ok": true,
  "findings": [
    {
      "severity": "P0",
      "title": "Unvalidated user input concatenated into SQL",
      "file": "src/db/query.js",
      "line": 42,
      "detail": "buildQuery concatenates req.query.name directly into the SQL string, risking injection. Use parameterized queries."
    },
    {
      "severity": "P1",
      "title": "Uncaught async exception crashes the process",
      "file": "src/jobs/worker.js",
      "line": 88,
      "detail": "The awaited call is not wrapped in try/catch; a reject bubbles up as unhandledRejection."
    },
    {
      "severity": "P2",
      "title": "Magic number lacks a named constant",
      "file": "src/config.js",
      "line": 15,
      "detail": "The timeout 30000 should be a named constant with a comment on its unit."
    }
  ],
  "summary": "1 P0 injection risk needs priority fixing, plus 1 P1 stability issue and several readability suggestions.",
  "sessionId": "…"
}
```

> The above is a format example (illustrating the output shape), not the verbatim result of any real run; actual finding count, wording, and locations vary with the changes under review. When no issues are found, the text is "No issues found." When the Stop gate is enabled, P0/P1 block finalization (see below).

## Typical flows

Review the current changes before a release:

> have Claude Code review the current changes

Hand a specific issue to Claude Code to fix:

> delegate this task to Claude Code: fix the null-pointer crash in src/foo.js

Start a long-running task in the background, then check on it:

> have Claude Code implement this feature in the background: …

Then say "check the background job status" / "fetch that job's result" in the session, or via the companion:

```bash
node "<plugin>/scripts/claude-companion.mjs" status --json
node "<plugin>/scripts/claude-companion.mjs" result <jobId> --json
node "<plugin>/scripts/claude-companion.mjs" cancel <jobId>
```

## FAQ

- **Do I need a Claude account?** Yes. The plugin calls the local `claude` CLI, which must be installed and logged in (`claude --version` works).
- **Is data sent out?** Yes. `claude` runs locally, but inference happens on Anthropic's servers; the prompt and selected context are sent there (see "Data egress" below).
- **How do I update the plugin?** Remote install: `codex plugin marketplace upgrade itstarts` for the latest. Local-path install: `codex plugin remove cc@itstarts && codex plugin add cc@itstarts` to refresh.
- **Will review modify my code?** No. `cc:review` uses read-only permissions; only `cc:delegate` lets Claude write files, and that is scoped to the repo.
- **What if a skill isn't triggered?** Pick `cc:review` / `cc:delegate` explicitly with `/skills`, or name "Claude Code" explicitly in your request.

## Review gate (Stop hook, optional)

Optional feature: have Codex automatically run a read-only Claude Code review of the current changes before each finalization. If P0/P1 blocking issues are found, it blocks finalization and explains why; otherwise it lets it through.

Off by default; enabling requires two explicit steps:

1. Turn on the switch (recorded per workspace, stored in plugin state):

   ```bash
   node "<plugin>/scripts/claude-companion.mjs" setup --enable-review-gate
   # disable: setup --disable-review-gate
   ```

2. Trust the hook: the plugin declares a Stop hook via the manifest, and Codex by default does not run untrusted hooks for safety. It triggers only after you trust this plugin's hook in Codex (you'll be prompted on first use; until trusted, the hook is silently skipped).

Behavior:

- When the gate is off, input parsing fails, `claude` is unavailable, or already inside a stop-hook loop (`stop_hook_active`), it always lets through (`continue:true`) and won't trap you at finalization (fail-open).
- It blocks (`decision:block`) only when the review returns P0/P1; P2/P3 pass through with a note.
- The review uses a read-only path (`--permission-mode plan`), modifies no files, and writes no user config.

`claude` runs locally, but inference happens on Anthropic's servers: the prompt and the selected repo context are sent to an external service. "Local CLI" does not mean "no data egress." Use it knowingly and send only the necessary context.

## Security boundaries

- Review uses read-only permissions (`--permission-mode plan`).
- Tasks use `acceptEdits` + `--add-dir <repo>` to scope writes to the repo. Verified by an env-gated integration test: in-repo writes succeed, out-of-repo writes (absolute paths, symlink escapes) are rejected by Claude Code (see `tests/e2e/write-boundary.e2e.test.mjs`). This boundary is enforced by Claude Code itself; the plugin does not add a second sandbox layer.

## Implementation notes

- The runtime is zero-dependency Node.js (ESM `.mjs`); the entry `scripts/claude-companion.mjs` dispatches `setup/review/adversarial-review/task/resume-candidate/status/result/cancel/gate`, with each `scripts/lib/*.mjs` module handling argument parsing, claude invocation, the state machine, transcript parsing, gate decisions, etc.
- Skills call the companion via the relative path `../../scripts/claude-companion.mjs` (Codex does not inject a plugin-root env var; the relative path works in both the repo and the cached copy).
- Background job results are read from the Claude transcript JSONL; in background mode Claude generates its own real sessionId, and the companion resolves the real id via `claude agents --json` to locate the transcript.
- The Stop gate is declared via the manifest `hooks` field (Codex 0.142's PluginManifest accepts this field); the hook wrapper script `hooks/stop-review-gate` self-locates the companion via `$0` and forwards the Codex Stop contract from stdin to the `gate` subcommand.

## Tests

```bash
cd plugins/cc && node --test     # unit/contract/fixture tests (e2e skipped by default)
```

The write-boundary env-gated integration test is skipped by default and needs a real (logged-in) `claude` to run:

```bash
cd plugins/cc && CC_PLUGIN_E2E=1 node --test tests/e2e/write-boundary.e2e.test.mjs
```

It delegates a real write-enabled task in a controlled temp repo and asserts writes are scoped to the repo (not run in CI). The end-to-end smoke and real-Codex-session verification log is in `tests/SMOKE.md`.
