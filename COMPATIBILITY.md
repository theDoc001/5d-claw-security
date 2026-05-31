# Compatibility matrix

Tracks the cross-version compatibility between this repo's plugin and skill, the fivedrisk Python library, and OpenClaw.

## Plugin compatibility

| Plugin version | Min fivedrisk Python | Tested fivedrisk Python | OpenClaw min version | OpenClaw tested versions |
|---|---|---|---|---|
| 0.1.0 (planned) | 0.5.3 | 0.5.3 | 2026.3.28 | 2026.3.28, 2026.5.31 |

## Skill compatibility

| Skill version | Min plugin | Tested plugin | Min fivedrisk Python | OpenClaw min version |
|---|---|---|---|---|
| 0.1.0 (planned) | 0.1.0 | 0.1.0 | 0.5.3 | 2026.3.28 |

## Release protocol

When the fivedrisk Python library ships a new version:

1. Run the plugin Vitest suite against the new library version
2. Run the integration smoke test (see `INTEGRATION.md`, to be written)
3. If passing: bump plugin patch (e.g., 0.1.0 → 0.1.1), add a CHANGELOG entry "verified compatible with fivedrisk v0.X.Y"
4. If failing: document the break in plugin CHANGELOG, bump plugin minor (e.g., 0.1.0 → 0.2.0), ship a fix

When OpenClaw ships a new version:

1. Run the integration smoke test against the new gateway
2. If passing: add to "OpenClaw tested versions" column above; no plugin bump needed
3. If failing: document the break, file an upstream issue if OpenClaw side, ship a plugin patch if our side

## How to read this file

Operators reading this file: pin to the plugin version in the "Plugin version" column whose row matches your fivedrisk Python version and OpenClaw version. If your combination is not listed, use the latest plugin version that meets the "Min" requirements; expect to file an issue if you hit problems.
