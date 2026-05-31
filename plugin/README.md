# @theDoc001/5d-claw-security

The deterministic per-action policy gate for OpenClaw agents.

This plugin registers a `before_tool_call` hook at priority 70 and bridges to the [fivedrisk](https://github.com/theDoc001/fivedrisk) Python core via a persistent stdio subprocess. Every tool call is scored on five dimensions (Data, Tool, Reversibility, External, Autonomy), banded GREEN/YELLOW/ORANGE/RED, and resolved into a `BeforeToolCallResult` for OpenClaw:

| Band | Action | Latency budget |
|---|---|---|
| GREEN | pass | scoring is sub-millisecond after warm-up |
| YELLOW | pass, attach metadata for downstream review | sub-millisecond |
| ORANGE | `requireApproval` via OpenClaw native channel flow | sub-millisecond + human time |
| RED | `block` with `blockReason` | sub-millisecond |

No LLM sits in the decision path. Scoring is deterministic. The Python subprocess is long-lived, so the per-call cost amortises to the fivedrisk core's 0.2 to 2.9 ms latency claim after the first warm-up tick. 🦞

## Install

```bash
openclaw plugins install clawhub:5d-claw-security
```

Once OpenClaw confirms the install, configure the plugin in `openclaw.json` (or the OpenClaw config UI):

```json
{
  "plugins": {
    "fivedrisk-claw-security": {
      "policyPath": "/Users/you/.fivedrisk/policy.yaml",
      "pythonBin": "python3",
      "scoringTimeoutMs": 5000,
      "onError": "block"
    }
  }
}
```

You also need the Python core (one-time):

```bash
pip install fivedrisk
```

The companion skill (`5d-claw-security` on ClawHub skills) automates these steps end-to-end.

## Config

| Key | Type | Default | Notes |
|---|---|---|---|
| `policyPath` | string | (required) | Absolute path to a fivedrisk `policy.yaml`. |
| `pythonBin` | string | `python3` | Use the venv interpreter path when fivedrisk is installed in a venv. |
| `scoringTimeoutMs` | integer | `5000` | Per-call scoring round-trip timeout. On timeout the subprocess is killed, restarted, and the call is retried once. |
| `onError` | `"block"` \| `"allow"` | `"block"` | What to do when the Python core is unreachable after a restart and one retry. `block` fails closed (recommended); `allow` fails open (pass-through, no scoring). |

`onError` defaults to `block` deliberately: throws from an OpenClaw hook handler are treated as pass-through, so any fail-closed posture must be explicit. The default is the safer one for a security gate.

Note: `scoringTimeoutMs` is the scoring round-trip timeout, not the human-approval timeout. Human-approval timeout is OpenClaw-native (configured in the gateway's `tools.exec.approvals.*` settings), out of plugin scope.

## Hook priority

Priority 70 runs above the OpenClaw docs-example default of 50 (OpenClaw runs handlers in descending priority order; higher number runs first). This keeps 5D Claw Security in front of typical community plugins while staying friendly to deliberate priority-90+ overrides if a deployment chooses to insert a layer above us.

## Self-recovery

The plugin owns the Python subprocess lifecycle. On any scoring failure:

1. Warn-log the error.
2. Restart the subprocess.
3. Retry the scoring call once.
4. On a second failure, return per `onError` (block by default).

No user prompts are surfaced for subprocess issues. Operators see only the structured warn/error logs.

## Develop

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```

The package ships as TypeScript source, not bundled or minified. Post-ClawHavoc auditability requires that what gets published matches what is in the source repo line-for-line.

## Compatibility

| Plugin version | OpenClaw range | fivedrisk Python range |
|---|---|---|
| 0.1.x | `>=2026.3.28` | `>=0.5.3` |

The `peerDependencies` block in `package.json` pins the OpenClaw lower bound. The Python core is checked at activation time; the version string emitted in the gateway's ready handshake is logged.

## License

Apache 2.0. See `LICENSE`.

## See also

- Companion skill: `clawhub:5d-claw-security`
- fivedrisk Python library: https://github.com/theDoc001/fivedrisk
- OpenClaw plugin SDK: https://docs.openclaw.ai/plugins/sdk-overview
- Architecture spec: see the integration spec in the project's `systems/notes/` folder
