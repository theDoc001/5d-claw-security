# 5D Claw Security skill

ClawHub skill bundle that installs and configures the 5D Claw Security
OpenClaw plugin and the fivedrisk Python core. Apache 2.0.

## What it does

When an operator runs `openclaw skills install clawhub:5d-claw-security`,
their agent reads this bundle and executes the playbook in `SKILL.md`:

1. Scans the operator's PUBLIC OpenClaw config (no secrets).
2. Generates a personalized `~/.fivedrisk/policy.yaml` from the bundled
   `openclaw_agent` preset plus scan-driven overrides.
3. Installs the plugin: `openclaw plugins install clawhub:5d-claw-security`.
4. Installs the Python core: `pip install fivedrisk`.
5. Configures the plugin (policy path, python bin, approval timeout,
   `onError: block`).
6. Verifies the install and runs an example to confirm gating works.

After the playbook finishes, the plugin gates every `before_tool_call`
the agent makes. Deterministic, sub-millisecond, append-only audit.

## Why a skill, not just docs

OpenClaw agents read skills and act on them. By shipping the install
flow as a skill, the operator gets a one-line install
(`openclaw skills install clawhub:5d-claw-security`) instead of a
multi-step copy-paste. The skill is the installer.

## Layout

| File | Purpose |
|---|---|
| `SKILL.md` | The playbook the agent executes |
| `AGENTS.md` | Machine-readable contract: scan schema, decision contract, error semantics |
| `CLAUDE.md` | Claude-specific install guidance |
| `scripts/scan-setup.py` | Reads PUBLIC OpenClaw config, emits JSON summary |
| `scripts/generate-policy.py` | Writes personalized policy.yaml from preset + scan |
| `scripts/example_gate.py` | Demonstrates GREEN + RED + audit log |
| `scripts/verify-install.sh` | Post-install smoke check |
| `references/openclaw_agent.yaml` | Bundled preset (until the fivedrisk library ships its own copy) |
| `references/installation.md` | Human-narrative version of the playbook |
| `references/policy-yaml-primer.md` | What each policy field means |
| `references/hitl-patterns.md` | Three concrete HITL integration shapes |

## Hard rules

- All install targets in `SKILL.md` and the scripts are HARDCODED literals.
  The skill does not interpolate `pip install <var>` or
  `openclaw plugins install <var>` from operator data. This prevents
  prompt-injection-style typosquat attacks (see spec section 8.2.2 and
  the AGENTS.md anti-typosquat rule).
- The scanner reads PUBLIC config only. No tokens, no shell history, no
  .env files. Rationale in the top-of-file comment of
  `scripts/scan-setup.py`.
- Documentation is readable to BOTH humans and agents (spec section 16.5).

## Requires

- `python3` (3.10+), `pip`, `openclaw` CLI on PATH for the agent to use.

## Versions

This skill v0.1.0 ships with a bundled copy of the `openclaw_agent`
preset in `references/openclaw_agent.yaml`. When the fivedrisk Python
library lands the L-2 work and ships the preset natively, a future
version of this skill will load from there instead and drop the
bundled copy.

See `CHANGELOG.md`.

## Source

`github.com/theDoc001/5d-claw-security/skill/` (after migration; see the
parent `dev/README.md`).
