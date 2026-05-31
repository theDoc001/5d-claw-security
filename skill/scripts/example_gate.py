"""example_gate.py: fivedrisk @gate demo for OpenClaw agents.

A drop-in example any OpenClaw agent can run, read, or copy from.
Demonstrates the four-band outcome in roughly forty lines.

Run (after the skill's install playbook has finished):

    python3 scripts/example_gate.py

What you see:

    1. A GREEN benign call (echo) that executes and prints its output.
    2. A RED destructive call (rm -rf) that is blocked before it runs.
    3. The fivedrisk rationale for each decision.
    4. The last five rows of the append-only audit log.

Nothing in this file requires an LLM, an API key, or network access.

Why this matters for OpenClaw:

    The OpenClaw agent reads a ClawHub skill, interprets it via LLM,
    composes a tool call. fivedrisk's @gate runs at that exact moment,
    between LLM composition and tool execution. VirusTotal Code Insight
    catches signatures in the skill bundle; @gate catches the resolved
    tool call. Both layers are needed.

Why Bash for the demo:

    The bundled openclaw_agent preset covers Bash well, so the
    rationale strings are concrete. To gate other OpenClaw tools
    (WebFetch, MCP tool names, custom tools), extend `tool_defaults`
    in `~/.fivedrisk/policy.yaml` (the skill already added entries for
    detected MCP tools, if any).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from fivedrisk.hooks import gate, configure
from fivedrisk.logger import DecisionLog


def _policy_path() -> Path:
    env = os.environ.get("FIVEDRISK_POLICY_PATH")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".fivedrisk" / "policy.yaml"


# Load the policy the skill wrote during install. Fall back to shipped
# defaults if for some reason the file is missing.
try:
    from fivedrisk import load_policy

    policy_file = _policy_path()
    if policy_file.exists():
        configure(policy=load_policy(str(policy_file)))
    else:
        configure(policy_path=None)
except Exception:
    configure(policy_path=None)


@gate(tool_name="Bash", autonomy_context=2)
def run_shell(command: str) -> str:
    """Execute a shell command. Gated by fivedrisk before it runs."""
    result = subprocess.run(
        command, shell=True, capture_output=True, text=True, check=False
    )
    return result.stdout.strip() or result.stderr.strip()


def main() -> None:
    print("--- benign call (expect GREEN, executes) ---")
    print(run_shell(command="echo hello-from-5d-claw-security"))

    print("\n--- ClickFix-style destructive call (expect RED, blocked) ---")
    try:
        run_shell(command="rm -rf /tmp/some/important/path")
    except ValueError as exc:
        print(f"blocked: {exc}")

    print("\n--- audit log (last 5 decisions) ---")
    log = DecisionLog()
    for row in log.query_recent(limit=5):
        print(f"  {row['band']:6}  {row['tool_name']:8}  {row['rationale']}")

    print(
        "\nWeekly summary of agent decisions:"
        "\n    python3 -m fivedrisk report --since 7d"
    )


if __name__ == "__main__":
    main()
