# Changelog

All notable changes to the 5D Claw Security skill bundle are recorded
here. The skill versions independently of the plugin and of the
fivedrisk Python library; cross-version compatibility lives in
`../COMPATIBILITY.md`.

## [Unreleased] - 0.1.0

Initial skill bundle. Ships the installer playbook, scripts, and
references for getting 5D Claw Security gating an OpenClaw agent.

### Added

- `SKILL.md`: numbered installer playbook the agent reads and executes.
- `AGENTS.md`: machine-readable contract (scan schema, decision contract,
  blockReason format, error semantics, anti-typosquat rule).
- `CLAUDE.md`: Claude-specific install guidance.
- `scripts/scan-setup.py`: stdlib-only scanner over public OpenClaw
  config. JSON output to stdout. Reads `openclaw.json`, `.mcp.json`, and
  the `skills/` directory; never reads tokens or shell history.
- `scripts/generate-policy.py`: stdlib-only policy generator. Takes
  scan JSON on stdin, the bundled `openclaw_agent` preset, and writes a
  personalized `~/.fivedrisk/policy.yaml`. Refuses to overwrite existing
  policies without `--force`.
- `scripts/example_gate.py`: GREEN benign + RED rm -rf + audit-log
  readback. Adapted from the archived fivedrisk-runtime-gate example.
- `scripts/verify-install.sh`: post-install smoke check.
- `references/openclaw_agent.yaml`: bundled preset (interim until the
  fivedrisk library ships L-2).
- `references/installation.md`: human-narrative version of the playbook.
- `references/policy-yaml-primer.md`: field-by-field policy.yaml guide.
- `references/hitl-patterns.md`: three concrete HITL integration shapes
  (stdin, Slack, blocked-with-pending).

### Hard rules enforced

- All install targets (`pip install fivedrisk`,
  `openclaw plugins install clawhub:5d-claw-security`) are hardcoded
  literals. No interpolation from operator-supplied data.
- Scanner reads PUBLIC config only.
- All Python scripts are stdlib-only (Python 3.10+).

### Notes

- This is a pre-publish bootstrap. Not yet published to ClawHub.
- The bundled `openclaw_agent.yaml` will be retired once the fivedrisk
  Python library ships its own copy via L-2 (next library release).
