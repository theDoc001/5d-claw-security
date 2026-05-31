# HITL integration patterns

ORANGE band actions return `requireApproval` from the plugin. OpenClaw
hands that off to its native channel-approval flow (Slack, Telegram,
iMessage, the OpenClaw UI). This document covers three concrete shapes
for the human-in-the-loop layer downstream of that handoff. Each one is
~15 lines of pseudocode and can be adapted to your stack.

## Pattern A: in-band stdin confirm (local dev only)

The simplest pattern. When ORANGE fires, prompt for confirmation on the
terminal where the agent is running. Suitable for solo dev workflows
where the operator is already at the keyboard.

```python
def on_orange_decision(decision):
    print(f"[5D Claw Security] ORANGE: {decision.tool_name}")
    print(f"  rationale: {decision.rationale}")
    print(f"  decision_id: {decision.decision_id}")
    response = input("approve? (y/n/once): ").strip().lower()
    if response == "y":
        return Resolution.ALLOW_ALWAYS
    if response == "once":
        return Resolution.ALLOW_ONCE
    return Resolution.DENY
```

Wire to OpenClaw via the plugin's `onResolution` callback. The fivedrisk
resolve endpoint (`python3 -m fivedrisk.gateway resolve`) writes the
operator's answer back into the audit log so subsequent identical
actions can be auto-resolved.

## Pattern B: Slack approval webhook

For team workflows. ORANGE band posts a Block Kit message with Approve
and Deny buttons to a configured Slack channel; the button callback
resolves the decision.

```python
def on_orange_decision(decision):
    payload = {
        "channel": SLACK_CHANNEL_ID,
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn",
                "text": f"*5D Claw Security* ORANGE\n"
                        f"`{decision.tool_name}` :: {decision.rationale}"}},
            {"type": "actions", "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "Approve once"},
                 "value": f"allow-once:{decision.decision_id}"},
                {"type": "button", "text": {"type": "plain_text", "text": "Deny"},
                 "value": f"deny:{decision.decision_id}"},
            ]},
        ],
    }
    slack_client.chat_postMessage(**payload)
    return Resolution.PENDING_ASYNC   # plugin waits for webhook
```

The Slack interaction webhook on your side calls
`python3 -m fivedrisk.gateway resolve --decision-id <id>
--resolution <allow-once|allow-always|deny>` to close the loop.

## Pattern C: blocked-until-CLI-approval (production-safe default)

For agent deployments where you do not want the agent waiting around on
a synchronous webhook. ORANGE actions are returned to the agent as
blocked with a decision id; an operator (or a downstream scheduler)
later approves via CLI and the agent retries.

```python
def on_orange_decision(decision):
    audit_log.write_orange(decision)
    notify_channel(decision)   # email, PagerDuty, whatever
    return Resolution.DENY_WITH_PENDING(decision.decision_id)

# elsewhere, operator runs:
#   python3 -m fivedrisk.gateway resolve \
#       --decision-id dx_a1b2c3 --resolution allow-once
# next time the agent attempts the same action, the decision shows up
# as PRE-APPROVED in the audit log and passes through.
```

This pattern is what we recommend for long-running unattended agents:
the agent never blocks waiting on a human, and the audit log captures
the full sequence (proposed action, denied with pending id, operator
approval, retry succeeded).

## Choosing between them

| Situation | Pattern |
|---|---|
| Solo dev, at the keyboard | A (stdin) |
| Small team, fast iteration | B (Slack) |
| Production unattended agent | C (deny-with-pending + async approval) |
| Mix of all three | OpenClaw native channel flow can route differently per ORANGE-decision metadata; consult the OpenClaw docs |

## What this skill does NOT provide

This skill ships the plugin and the policy. It does NOT ship the HITL
channel handler. The patterns above are reference shapes; the actual
Slack/Telegram/PagerDuty wiring is owned by the operator (and likely
already exists in your OpenClaw deployment if you are using auto mode).
