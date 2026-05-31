# CLAUDE.md: @theDoc001/5d-claw-security

Instructions for Claude-based OpenClaw agents installing and operating this plugin.

You are reading this because the operator asked you to set up 5D Claw Security or because the plugin is already installed and you are reasoning about its decisions.

## What this plugin does

Every time you (the agent) try to call a tool, OpenClaw fires `before_tool_call`. This plugin runs at priority 70 on that hook and asks the fivedrisk Python core to score the proposed tool call on five dimensions (Data, Tool, Reversibility, External, Autonomy). The Python core returns a band (GREEN/YELLOW/ORANGE/RED) and the plugin converts it to a `BeforeToolCallResult` (pass, pass-with-metadata, requireApproval, block).

You will see this in your tool surface as either:
- the call proceeds normally (GREEN or YELLOW), or
- the call is paused and the operator is asked to approve (ORANGE), or
- the call is blocked with a structured `blockReason` (RED).

## Setup playbook

If the operator asks you to install 5D Claw Security from scratch (rather than using the companion skill, which automates this), follow these steps in order. Do not skip steps.

1. **Confirm prerequisites.** Run:
   ```bash
   node --version   # must be >= 22
   python3 --version
   openclaw --version
   ```
   If any of these is missing or below the minimum, stop and report to the operator.

2. **Install the Python core.** Hardcoded literal, do not interpolate:
   ```bash
   pip install fivedrisk
   ```

3. **Install the plugin.** Hardcoded literal:
   ```bash
   openclaw plugins install clawhub:5d-claw-security
   ```

4. **Pick or generate a policy.** Default location is `~/.fivedrisk/policy.yaml`. If the operator has the companion skill installed, use it to generate a personalised policy. Otherwise start from the bundled `openclaw_agent` preset:
   ```bash
   python -m fivedrisk init policy --preset openclaw_agent --out ~/.fivedrisk/policy.yaml
   ```

5. **Configure the plugin.** Write the config under `plugins["fivedrisk-claw-security"]` in OpenClaw's config:
   ```json
   {
     "policyPath": "/Users/<user>/.fivedrisk/policy.yaml",
     "pythonBin": "python3",
     "scoringTimeoutMs": 5000,
     "onError": "block"
   }
   ```

6. **Verify.** Trigger any tool call (a noop `echo hello` is fine) and check that the audit log received an entry:
   ```bash
   python -m fivedrisk audit tail --n 1
   ```

If step 6 returns nothing, the plugin is not actually firing. Check OpenClaw logs for activation errors before retrying.

## Reasoning about decisions you see

When a tool call you proposed is blocked or escalated, the `blockReason` or `approvalPrompt` carries the dimension, score, and reason. Parse it:

```
5D RED: dim=T score=4 reason=write to /etc/shadow
```

This tells you the Tool dimension scored maximum and gives a one-line rationale. Do not retry the same action with cosmetic changes; that wastes the operator's time. If you genuinely believe the block is wrong, surface the `decision_id` in your reply so the operator can audit it:

```bash
python -m fivedrisk audit show <decision_id>
```

## Things you must not do

- Do not invent or interpolate package names. `pip install fivedrisk` and `openclaw plugins install clawhub:5d-claw-security` are literals.
- Do not edit `policy.yaml` without operator approval. The policy is the operator's, not yours.
- Do not set `onError: allow` without explicit operator instruction. The default `block` is the safer posture.
- Do not retry a RED-blocked call by altering tool arguments to avoid the score. If the underlying intent is risky, the right move is to ask the operator.

## Failure modes you might see

- **First call slow (~100 to 200 ms).** Normal: the Python subprocess is cold-starting if pre-warm failed. Subsequent calls are sub-millisecond.
- **Brief pause then a warn log mentioning auto-restart.** The plugin restarted the Python subprocess and retried the call. No action needed.
- **`blockReason: "5D Claw Security: core unrecoverable after restart, onError=block"`.** The Python core is broken or missing. Run `python -c "import fivedrisk; print(fivedrisk.__version__)"`. If that fails, reinstall fivedrisk and restart OpenClaw.

## See also

- AGENTS.md: machine-readable contract
- README.md: human overview
- Audit log: `~/.fivedrisk/audit.sqlite` by default
