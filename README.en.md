# cc-plugin-codex

**English** | [简体中文](README.md)

A Codex **marketplace repository** (installable remotely from GitHub or from a local path) that provides the `cc` plugin — letting OpenAI Codex delegate code review (read-only) and coding tasks (write-enabled) to the local Claude Code (`claude` CLI).

It is the mirror direction of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (which lets Claude Code call Codex).

## Repository layout

```
.agents/plugins/marketplace.json   # Codex marketplace manifest (points to plugins/cc)
plugins/cc/                        # the cc plugin itself
  .codex-plugin/plugin.json        #   plugin manifest
  skills/                          #   cc:review / cc:adversarial-review / cc:delegate + internal skills
  scripts/                         #   zero-dependency Node.js runtime (companion + lib)
  schemas/ · tests/ · README.md
docs/superpowers/                  # design specs and implementation plans
```

## Quick start

Requires Codex and the Claude Code (`claude`) CLI installed and logged in locally, plus Node.js >=18.18.0.

Install directly from GitHub (no clone needed):

```bash
codex plugin marketplace add itstarts/cc-plugin-codex   # pull this repo as a marketplace
codex plugin add cc@itstarts                              # install and enable the cc plugin
codex plugin list | grep cc                              # expect: installed, enabled
```

After installing, restart Codex and say "have Claude Code review the current changes" to trigger it.

> The marketplace name is `itstarts` (from `marketplace.json` in this repo), so the plugin id is `cc@itstarts` — the same for remote or local installs.
> To install from a local copy (development/offline), replace `itstarts/cc-plugin-codex` with the absolute path to the cloned repo root, e.g. `codex plugin marketplace add /path/to/cc-plugin-codex`.

Full install, usage, security boundaries, and data-egress notes are in **[plugins/cc/README.en.md](plugins/cc/README.en.md)**.

Version history is in **[CHANGELOG.md](CHANGELOG.md)**.

## Capabilities

- `cc:review` — have Claude Code review the current changes / a branch / a PR, read-only.
- `cc:adversarial-review` — have Claude Code run a read-only "adversarial" review: question the implementation direction, design tradeoffs, and hidden assumptions, focusing on high-cost failure modes (auth / data loss / rollback / race conditions).
- `cc:delegate` — delegate a coding task to Claude Code (write-enabled, scoped to the repo), with foreground/background jobs and the ability to resume the previous delegation thread.

> Difference from the reference project [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc): its `transfer` (exporting a session into a thread the other side can resume) relies on the other runtime's "import external agent session" capability. The mirror direction would need Claude Code to import an external session, which Claude Code currently cannot do (`--resume` only recognizes its own sessions), so this plugin does not mirror that command.

## Development

```bash
cd plugins/cc && node --test       # unit / contract / fixture tests
```

Design docs: [docs/superpowers/specs/](docs/superpowers/specs/)　Implementation plans: [docs/superpowers/plans/](docs/superpowers/plans/)　Verification log: [plugins/cc/tests/SMOKE.md](plugins/cc/tests/SMOKE.md)

Contribution workflow: see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

> Files under `docs/superpowers/` are development-time design specs and implementation plans recording the design rationale — they are **not** install/usage docs. For installation and usage, refer to this file and [plugins/cc/README.en.md](plugins/cc/README.en.md).
