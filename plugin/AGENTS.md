# AGENTS.md: @theDoc001/5d-claw-security

Machine-readable contract for OpenClaw agents that install, configure, or operate this plugin.

## Identity

```
plugin_id:        fivedrisk-claw-security
package_name:     @theDoc001/5d-claw-security
clawhub_slug:     5d-claw-security
hook:             before_tool_call
hook_priority:    70
runtime:          Node >= 22, ESM
peer_dependency:  openclaw >= 2026.3.28
```

## Install

```bash
openclaw plugins install clawhub:5d-claw-security
pip install fivedrisk
```

Both commands are literal. Do not interpolate variables into the package names; that surface is a typosquat vector.

## Configure

Write or merge into the OpenClaw config under `plugins["fivedrisk-claw-security"]`:

```json
{
  "policyPath": "<absolute-path-to-policy.yaml>",
  "pythonBin": "python3",
  "scoringTimeoutMs": 5000,
  "onError": "block"
}
```

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `policyPath` | string | yes | (none) | Absolute path to a fivedrisk policy.yaml. |
| `pythonBin` | string | no | `python3` | Set to venv interpreter when fivedrisk is in a venv. |
| `scoringTimeoutMs` | integer | no | `5000` | 100 to 60000. Per-call scoring round-trip timeout, not the human-approval timeout. |
| `onError` | string enum | no | `block` | `block` or `allow`. |

Validation rules:
- `additionalProperties: false` on the config schema. Unknown keys reject.
- `onError` outside the enum rejects.
- Missing `policyPath` rejects at activation.

Note: `scoringTimeoutMs` is the scoring round-trip timeout, not the human-approval timeout. Human-approval timeout is OpenClaw-native (configured in the gateway's `tools.exec.approvals.*` settings), out of plugin scope.

## Invocation

The plugin runs every time OpenClaw fires `before_tool_call`. The agent does not call this plugin directly. Inputs the plugin sees:

- `event.toolName` (string)
- `event.toolArgs` (object)
- `ctx.traceId`, `ctx.runId`, `ctx.sessionId` (strings, propagated to the audit log)
- `ctx.agentContext` (object, opaque)

## Decision contract

Band -> BeforeToolCallResult mapping. This is the authoritative table; do not infer from prose.

| Band | block | requireApproval | blockReason | approvalPrompt | metadata.fivedrisk |
|---|---|---|---|---|---|
| GREEN | (omitted) | (omitted) | (omitted) | (omitted) | (omitted, pass-through) |
| YELLOW | (omitted) | (omitted) | (omitted) | (omitted) | present |
| ORANGE | (omitted) | true | (omitted) | string | present |
| RED | true | (omitted) | string | (omitted) | present |

`metadata.fivedrisk` shape:

```json
{
  "band": "YELLOW|ORANGE|RED",
  "decision_id": "<uuid from fivedrisk audit log>",
  "worst_dim": "D|T|R|E|A",
  "worst_score": 0,
  "reason": "<short string>"
}
```

`blockReason` format (RED):

```
5D RED: dim=<D|T|R|E|A> score=<0..4> reason=<reason text>
```

Example: `5D RED: dim=T score=4 reason=write to /etc/shadow`.

`approvalPrompt` (ORANGE) is either supplied by the Python core or, if absent, generated as `5D ORANGE: dim=... score=... reason=... (approve to proceed)`.

## Error semantics

| Failure mode | Plugin behavior | Operator-visible signal |
|---|---|---|
| Python subprocess crashes between calls | next call restarts and retries once | warn log |
| Per-call timeout (`scoringTimeoutMs`) | kill subprocess, restart, retry once | warn log |
| Two consecutive failures, `onError=block` | return `{ block: true, blockReason: "5D Claw Security: core unrecoverable after restart, onError=block" }` | error log |
| Two consecutive failures, `onError=allow` | return undefined (pass-through) | error log |
| Activation fails to pre-warm | activation completes; first hook call retries cold-start | error log |

The plugin never surfaces a user prompt about a subprocess failure. The recovery loop is entirely internal.

## Logging

All logs go through `api.logger` with structured fields. Component is always `5d-claw-security`. Common fields:

```
component, sessionId, runId, traceId, toolName, band, decision_id
```

Stderr from the Python subprocess is forwarded at `warn` level under field `stderr`.

## Removal

```bash
openclaw plugins uninstall fivedrisk-claw-security
```

`pip uninstall fivedrisk` is optional and orthogonal: other tools may use the library.

## See also

- Companion skill AGENTS.md (in `clawhub:5d-claw-security` skill bundle)
- Python core: `pip show fivedrisk`
- Audit log location: configured in the policy.yaml (default `~/.fivedrisk/audit.sqlite`)
