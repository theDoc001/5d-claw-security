# Changelog

All notable changes to `@theDoc001/5d-claw-security` are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

Initial scaffold. Not yet published to ClawHub or npm; no integration smoke test has been run against a live OpenClaw gateway (per spec §6 P-7, required before tagging).

### Added

- `before_tool_call` hook handler at priority 70 (`index.ts`).
- Persistent stdio bridge to the fivedrisk Python core, `python -m fivedrisk.gateway stdio --policy <path>` (`src/python-bridge.ts`).
- Pure decision-mapper from band to `BeforeToolCallResult` (`src/decision-mapper.ts`).
- Structured logger wrapper around `api.logger` with `component=5d-claw-security` (`src/logger.ts`).
- Internal type contracts for the stdio wire format (`api.ts`).
- Plugin manifest with configSchema (policyPath, pythonBin, scoringTimeoutMs, onError) and `additionalProperties: false` (`openclaw.plugin.json`).
- Self-recovery loop: hook handler does score, on failure restart + retry once, on second failure return per `onError` (default `block`). No user prompts.
- Pre-warm of Python subprocess at activation so the first hook call does not pay the cold-start cost.
- Trace propagation: `ctx.traceId`, `ctx.runId`, `ctx.sessionId` flow into the scoring request envelope.
- Vitest suite: snapshot tests for each band, mocked-subprocess tests for the bridge lifecycle (start/stop/score/restart/timeout/not-started/idempotent-stop).
- TypeScript strict-mode config (`tsconfig.json`), Vitest config (`vitest.config.ts`).
- README.md, AGENTS.md, CLAUDE.md at plugin root.

### Fixed

- Added `LICENSE` (Apache-2.0) at plugin root so the published bundle carries the license text alongside the `license` field in `package.json`.
- Renamed config key `approvalTimeoutMs` to `scoringTimeoutMs` (manifest, types, code, tests, docs). The value is the per-call scoring round-trip timeout, not a human-approval timeout; the old name was misleading.
- Rewrote hook-priority documentation. OpenClaw runs handlers in descending priority order (higher number runs first), so priority 70 sits above the OpenClaw docs-example default of 50, not below a default of 90. Updated README, AGENTS, CLAUDE, index.ts comments.

### Notes

- `onError` defaults to `block` (fail-closed). Throws from a hook handler are pass-through in OpenClaw, so the safer default must be explicit.
- Hook priority is 70. OpenClaw runs handlers in descending priority order, so 70 runs above the docs-example default of 50 and stays friendly to deliberate priority-90+ overrides above us.
- Source ships as TypeScript. No bundling, no minification. Auditability requirement.

### Pending before tagging

- Integration smoke test against a live OpenClaw gateway (per spec §6 P-7).
- `clawhub package publish --dry-run` clean.
- `npm publish --dry-run` clean.
- COMPATIBILITY.md updated at repo root with the verified OpenClaw version range and fivedrisk Python version range.

[0.1.0]: https://github.com/theDoc001/5d-claw-security/releases/tag/plugin-v0.1.0
