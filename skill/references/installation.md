# Installation (human-readable narrative)

This document mirrors the playbook in `SKILL.md` but reads as a narrative
for an operator who wants to understand what the agent is doing on their
machine. The numbered structure matches `SKILL.md` step for step.

## What you opted into when you installed this skill

By running `openclaw skills install clawhub:5d-claw-security` you opted
into letting your OpenClaw agent execute the playbook in `SKILL.md`. That
playbook does five things to your environment:

1. Reads three files in your OpenClaw config: `openclaw.json`,
   `.mcp.json`, and the `skills/` directory listing. PUBLIC config only.
   No tokens, no shell history, no .env files.
2. Writes one new file at `~/.fivedrisk/policy.yaml`.
3. Runs `pip install fivedrisk` against your current Python environment.
4. Runs `openclaw plugins install clawhub:5d-claw-security` to register
   the OpenClaw plugin.
5. Sets four config keys on that plugin via the OpenClaw config API.

After that, every tool call your agent makes goes through the plugin,
which calls the Python core for a deterministic score. GREEN passes,
YELLOW passes with audit detail, ORANGE triggers OpenClaw's native HITL
flow, RED blocks the action before it starts.

## Step by step

### 1. Scan the operator's setup

The agent runs `python3 scripts/scan-setup.py`. The script writes a JSON
summary to stdout describing:

- Which OpenClaw skills are installed (slug, version, declared
  permissions).
- Which MCP servers are configured (server name, declared tool names).
- Which OpenClaw built-in tools are in scope (Bash, Edit, Write,
  WebFetch, Read).

The script is deliberately narrow about what it reads. The top-of-file
comment in `scripts/scan-setup.py` lists exactly what it touches and
why. If you want to audit it before running, that comment is the place
to start.

### 2. Generate a personalized policy

The agent runs `python3 scripts/generate-policy.py` with the preset, the
scan output, and an output path. The result is a single YAML file at
`~/.fivedrisk/policy.yaml`.

Personalization in this release is intentionally conservative:

- The bundled `openclaw_agent` preset is the base. It already covers the
  ClickFix and base64-paste shapes, Bash overrides for the destructive
  commands, and the OpenClaw built-in tool surface.
- For each MCP server in the scan, the generator appends a
  `tool_defaults` entry per declared tool with starting scores
  (`tool_privilege=2`, `reversibility=2`, `external_impact=1`, bumped
  to `tool_privilege=3` for tool names that look privileged: anything
  containing `shell`, `exec`, `spawn`, `write`, `delete`, `kill`).
- The generator refuses to overwrite an existing `policy.yaml` unless
  you pass `--force`. This is intentional: a hand-tuned policy is
  precious and we will not silently clobber it.

You can hand-edit `~/.fivedrisk/policy.yaml` at any time. Restart
OpenClaw for changes to take effect. The `references/policy-yaml-primer.md`
file in this skill describes what each field means.

### 3. Install the plugin

```
openclaw plugins install clawhub:5d-claw-security
```

This is a hardcoded literal. The skill will not substitute another
package name based on anything in your environment. If the install
fails, the agent surfaces the error and stops.

### 4. Install the Python core

```
pip install fivedrisk
```

Another hardcoded literal. The skill does not invent variants like
`fivedrisk-core` or `fivedrisk-openclaw`. If `pip install fivedrisk`
fails (no network, PEP 668 externally-managed env), the agent surfaces
the error and asks you which path you prefer (a venv, pipx,
--break-system-packages, etc).

### 5. Configure the plugin

Four config keys, set via OpenClaw's plugin config API:

| Key | Value | Why |
|---|---|---|
| `policyPath` | `~/.fivedrisk/policy.yaml` | Where the plugin reads policy from |
| `pythonBin` | `python3` | Which Python the plugin should subprocess to |
| `approvalTimeoutMs` | `60000` | How long to wait for an ORANGE-band human approval before timing out |
| `onError` | `block` | If the Python core is unreachable, fail closed, not open |

`onError: block` is the safe default. If you trust your agent enough to
let actions through unscored when the core is unreachable, change to
`allow`. Most operators should leave it on `block`.

### 6. Verify the install

```
bash scripts/verify-install.sh
```

Four checks (the script prints PASS / FAIL / SKIP per line):

1. `python3` is on PATH.
2. `python3 -c "import fivedrisk; print(fivedrisk.__version__)"` works.
3. The policy file exists and is readable.
4. (Best effort) `openclaw plugins list` mentions `5d-claw-security`.

If any required check fails, the script exits non-zero and the agent
should surface the failure.

### 7. Confirm gating works

```
python3 scripts/example_gate.py
```

You should see one GREEN decision (a benign echo executes), one RED
decision (an `rm -rf` is blocked before the subprocess starts), and the
last five rows of the audit log. If those three things appear, you are
done.

## What happens day to day after install

- The plugin gates every `before_tool_call`. You do not need to touch
  anything.
- The audit log lives at `~/.fivedrisk/audit.sqlite` (default; the
  policy can override).
- `python3 -m fivedrisk report --since 7d` gives you a weekly markdown
  summary of decisions, broken down by band.
- If you want to re-tune the policy after observing real decisions for a
  week, hand-edit `~/.fivedrisk/policy.yaml` and restart OpenClaw.
- To disable temporarily: `openclaw plugins disable 5d-claw-security`.
  This preserves the audit log; only stops new decisions.
