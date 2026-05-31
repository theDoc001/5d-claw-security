#!/usr/bin/env python3
"""scan-setup.py: read PUBLIC OpenClaw config and emit a JSON summary.

Why public-config-only:

    The skill is opt-in installer software. Its scan informs policy
    generation. To do that well it does NOT need to read tokens, OAuth
    secrets, full URLs with credentials baked in, shell history, or
    private skill manifest fields. Reading any of those would widen the
    trust boundary of the skill beyond what the operator opted into when
    they installed it. The fivedrisk integration spec (section 6, L-3,
    and the section 8.2.2 security analysis) makes this a hard
    boundary: public config only.

What this script reads:

    1. ~/.openclaw/openclaw.json (or $OPENCLAW_HOME/openclaw.json):
       only the top-level keys describing tool surface and skill list.
    2. ~/.openclaw/.mcp.json: only `name` and `tools_declared` per MCP
       server. NEVER `env`, `args`, `cwd`, or URL/auth fields.
    3. ~/.openclaw/skills/*/manifest.json (or skill.json):
       only `name`, `version`, `permissions`.

What this script does NOT read:

    - Anything under ~/.openclaw/credentials/ or ~/.openclaw/auth/
    - .env files, .secret files, anything with `token` or `key` in the name
    - Shell history, command logs, audit data
    - File contents beyond the manifests above

Stdlib only. Runs on Python 3.10+. No external dependencies.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

# Top-level config keys we will surface to the agent. Anything outside
# this allowlist is dropped before the scan output is written.
_OPENCLAW_PUBLIC_KEYS = {
    "tools",
    "tool_surface",
    "enabled_tools",
    "skills",
    "auto_mode",
}

# Per-MCP-server keys we will surface. Note the absence of `env`, `args`,
# `command`, `url`, `headers`, etc.
_MCP_SERVER_PUBLIC_KEYS = {
    "name",
    "tools_declared",
    "tools",
}

# Per-skill-manifest keys we will surface.
_SKILL_MANIFEST_PUBLIC_KEYS = {
    "name",
    "version",
    "permissions",
}


def _utc_now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _openclaw_home() -> Path:
    env = os.environ.get("OPENCLAW_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".openclaw"


def _safe_load_json(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    if not path.exists():
        warnings.append(f"missing: {path}")
        return None
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        warnings.append(f"malformed JSON at {path}: {exc.msg}")
        return None
    except PermissionError:
        warnings.append(f"permission denied: {path}")
        return None
    except OSError as exc:
        warnings.append(f"read error at {path}: {exc.strerror or exc}")
        return None


def _filter_keys(obj: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    return {k: v for k, v in obj.items() if k in allowed}


def _scan_openclaw_json(home: Path, warnings: list[str]) -> dict[str, Any]:
    path = home / "openclaw.json"
    data = _safe_load_json(path, warnings)
    if data is None:
        return {}
    if not isinstance(data, dict):
        warnings.append(f"openclaw.json is not a JSON object: {path}")
        return {}
    return _filter_keys(data, _OPENCLAW_PUBLIC_KEYS)


def _scan_mcp_json(home: Path, warnings: list[str]) -> list[dict[str, Any]]:
    path = home / ".mcp.json"
    data = _safe_load_json(path, warnings)
    if data is None:
        return []
    servers_raw: Any = None
    if isinstance(data, dict):
        servers_raw = data.get("servers") or data.get("mcpServers") or data
    elif isinstance(data, list):
        servers_raw = data
    if not isinstance(servers_raw, (dict, list)):
        return []
    results: list[dict[str, Any]] = []
    items = servers_raw.items() if isinstance(servers_raw, dict) else enumerate(servers_raw)
    for key, server in items:
        if not isinstance(server, dict):
            continue
        filtered = _filter_keys(server, _MCP_SERVER_PUBLIC_KEYS)
        # If the dict-key form was used (e.g. "filesystem": {...}), use
        # the key as the name when the inner dict did not declare one.
        if "name" not in filtered and isinstance(key, str):
            filtered["name"] = key
        tools = filtered.get("tools_declared") or filtered.get("tools") or []
        if isinstance(tools, list):
            filtered["tools_declared"] = [str(t) for t in tools]
        filtered.pop("tools", None)
        if any(_looks_privileged(t) for t in filtered.get("tools_declared", [])):
            warnings.append(
                f"MCP server '{filtered.get('name', '?')}' declares privileged tools"
            )
        results.append(filtered)
    return results


def _looks_privileged(tool_name: str) -> bool:
    name = tool_name.lower()
    return any(
        marker in name
        for marker in ("shell", "exec", "spawn", "write", "delete", "kill")
    )


def _scan_skills_dir(home: Path, warnings: list[str]) -> list[dict[str, Any]]:
    skills_dir = home / "skills"
    if not skills_dir.exists():
        warnings.append(f"no skills directory at {skills_dir}")
        return []
    if not skills_dir.is_dir():
        warnings.append(f"skills path is not a directory: {skills_dir}")
        return []
    results: list[dict[str, Any]] = []
    for entry in sorted(skills_dir.iterdir()):
        if not entry.is_dir():
            continue
        manifest = _find_skill_manifest(entry)
        if manifest is None:
            results.append({"name": entry.name, "version": None, "permissions": []})
            continue
        data = _safe_load_json(manifest, warnings)
        if not isinstance(data, dict):
            results.append({"name": entry.name, "version": None, "permissions": []})
            continue
        filtered = _filter_keys(data, _SKILL_MANIFEST_PUBLIC_KEYS)
        filtered.setdefault("name", entry.name)
        filtered.setdefault("version", None)
        filtered.setdefault("permissions", [])
        if not isinstance(filtered["permissions"], list):
            filtered["permissions"] = []
        results.append(filtered)
    return results


def _find_skill_manifest(skill_dir: Path) -> Path | None:
    for candidate in ("manifest.json", "skill.json", "skill.yaml", "SKILL.md"):
        p = skill_dir / candidate
        if p.exists():
            # We only parse JSON manifests safely. YAML/markdown manifests
            # are common but we do not pull in a YAML parser here; the
            # directory name still gives us the skill slug.
            if p.suffix == ".json":
                return p
            return None
    return None


def _derive_tool_surface(openclaw_data: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    for key in ("tool_surface", "enabled_tools", "tools"):
        val = openclaw_data.get(key)
        if isinstance(val, list):
            candidates.extend(str(v) for v in val if isinstance(v, (str, int)))
    if not candidates:
        # Reasonable default: the OpenClaw built-ins fivedrisk has
        # tool_defaults coverage for. The generator can still tighten
        # based on scanned MCP servers.
        candidates = ["Bash", "Edit", "Write", "Read", "WebFetch"]
    # Preserve order, dedupe.
    seen: set[str] = set()
    out: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _build_scan(home: Path) -> dict[str, Any]:
    warnings: list[str] = []
    openclaw_data = _scan_openclaw_json(home, warnings)
    mcp_servers = _scan_mcp_json(home, warnings)
    skills = _scan_skills_dir(home, warnings)
    tool_surface = _derive_tool_surface(openclaw_data)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _utc_now_iso(),
        "openclaw_home": str(home),
        "config_found": (home / "openclaw.json").exists(),
        "skills": skills,
        "mcp_servers": mcp_servers,
        "tool_surface": tool_surface,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Scan the operator's public OpenClaw config and emit a JSON "
            "summary on stdout. Reads no secret paths."
        )
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=None,
        help="Override OpenClaw home (defaults to $OPENCLAW_HOME or ~/.openclaw)",
    )
    args = parser.parse_args(argv)

    home = args.home.expanduser() if args.home else _openclaw_home()
    scan = _build_scan(home)
    json.dump(scan, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
