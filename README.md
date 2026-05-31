# 5D Claw Security

**Status**: bootstrap. v0.1.0 in development.

The deterministic per-action policy gate for OpenClaw agents. Sub-millisecond decisions, no LLM in the decision path, append-only audit log. Composes with OpenClaw auto mode; does not substitute for it.

Two artifacts in this repo, both Apache 2.0:

- **plugin/** — TypeScript OpenClaw plugin (`@theDoc001/5d-claw-security` on npm, `5d-claw-security` on ClawHub packages). Registers `before_tool_call` hook at priority 70. Persistent stdio bridge to Python core.
- **skill/** — OpenClaw skill bundle (`5d-claw-security` on ClawHub skills). Installation playbook that the agent reads and executes: scans operator's OpenClaw setup, generates a personalized policy.yaml, runs the pip install and the plugin install, configures both.

The scoring engine is the [fivedrisk](https://github.com/theDoc001/fivedrisk) Python library on PyPI. Operator runs `pip install fivedrisk` once during skill-driven setup; plugin subprocesses to it via long-lived stdio. Same trust model as any installer skill: ClawHub vetting + operator opt-in at install time.

## Quickstart for operators

After the skill is published to ClawHub:

```bash
openclaw skills install clawhub:5d-claw-security
```

The skill walks your agent through the rest: scanning your setup, picking a starting policy from `openclaw_agent`, `code_execution`, `human_approval_required`, `customer_data`, `financial_operations`, `read_only`, installing the plugin and Python core, configuring both.

## Architecture

```
operator installs the skill
    │
    ▼
[skill: 5D Claw Security]
    │  agent reads SKILL.md + AGENTS.md
    │  agent: scans openclaw.json, .mcp.json, skills/
    │  agent: generates personalized policy.yaml
    │  agent: openclaw plugins install clawhub:5d-claw-security
    │  agent: pip install fivedrisk
    │  agent: configures plugin
    │
    ▼
[plugin: @theDoc001/5d-claw-security]   ← TS shim in OpenClaw process
    │  registers before_tool_call at priority 70
    │  persistent stdio to long-lived Python subprocess
    │
    ▼
[fivedrisk Python core]   ← long-lived process
    │  0.2 to 2.9 ms deterministic 5D scoring
    │  16-state Markov drift tracking
    │  append-only SQLite audit log
    │
    ▼
plugin returns BeforeToolCallResult
    │
    ├── GREEN  ────► execute, audit
    ├── YELLOW ─► escalate to configured LLM reviewer (auto-mode default)
    ├── ORANGE ─► requireApproval → OpenClaw native channel flow
    └── RED    ────► block, audit, alert
```

## Repo location

This `dev/` folder is the public git repo for 5D Claw Security. It lives at `fivedrisk-oss/5d-claw-security/dev/` as a co-product of fivedrisk-oss (Loren's decision 2026-05-31; the two are intentionally co-located).

- This git repo: `github.com/theDoc001/5d-claw-security` (TypeScript plugin + skill bundle)
- Sibling project git repo: `github.com/theDoc001/fivedrisk` (Python library at `fivedrisk-oss/dev/`)

The two repos do not interact. The parent `fivedrisk-oss/.gitignore` excludes `/5d-claw-security/` so the Python library repo never commits this work. This folder's own `.gitignore` is Node/TS tuned.

## See also

- Integration spec: `~/Library/Mobile Documents/.../fivedrisk-oss/systems/notes/openclaw-integration-spec.md`
- fivedrisk Python library: https://github.com/theDoc001/fivedrisk
- OpenClaw plugin SDK: https://docs.openclaw.ai/plugins/sdk-overview
- OpenClaw auto-mode launch (May 31, 2026): https://openclaw.ai/blog/safer-than-yolo-auto-mode-exec-approvals

## License

Apache 2.0. See LICENSE.
