/**
 * Pure mapping from BandDecision -> BeforeToolCallResult.
 *
 * The shapes mirror the real OpenClaw SDK types
 * (`PluginHookBeforeToolCallEvent`, `PluginHookBeforeToolCallResult`,
 * `PluginHookToolContext`) but are declared locally because OpenClaw does
 * not re-export those names from `openclaw/plugin-sdk` directly; the typed
 * `api.on("before_tool_call", handler, ...)` registration site checks
 * assignability against the SDK's internal `PluginHookHandlerMap`.
 *
 * Keeping these as exported local type aliases lets the mapper be unit
 * tested in isolation and lets index.ts narrow the handler signature
 * without reaching into deep SDK internals.
 *
 * Band contract (per spec §6 P-1):
 *   GREEN  -> pass (undefined)
 *   YELLOW -> pass (undefined); band detail recorded via logger
 *   ORANGE -> requireApproval object with title + description + severity
 *   RED    -> block with formatted blockReason
 */

import type { BandDecision, PluginConfig } from "../api.js";

/**
 * Mirror of OpenClaw `PluginHookBeforeToolCallEvent`. The host populates more
 * fields than we need; we only depend on these.
 */
export interface BeforeToolCallEvent {
  readonly toolName: string;
  readonly params: Record<string, unknown>;
  readonly toolKind?: string;
  readonly toolInputKind?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly derivedPaths?: readonly string[];
}

/**
 * Mirror of OpenClaw `PluginHookToolContext`. The trace context exposes
 * `traceId` (W3C trace id) which we propagate into the fivedrisk audit log.
 */
export interface BeforeToolCallContext {
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly trace?: { readonly traceId: string };
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly channelId?: string;
}

/**
 * Mirror of OpenClaw `PluginHookBeforeToolCallResult`. We use the subset of
 * fields the band contract needs: `params` (unused here), `block`,
 * `blockReason`, and `requireApproval` (the structured object form).
 */
export interface BeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
  requireApproval?: {
    title: string;
    description: string;
    severity?: "info" | "warning" | "critical";
  };
}

/**
 * Format a blockReason or approval description prefix. Includes dim+score so
 * the operator sees, in one line, which dimension drove the decision.
 *
 * Example: "5D RED: dim=T score=4 reason=write to /etc/shadow"
 */
export function formatBandPrefix(decision: BandDecision): string {
  const dim = decision.worst_dim ?? "?";
  const score = decision.worst_score ?? "?";
  const reason = decision.reason ?? "(no reason supplied)";
  return `5D ${decision.band}: dim=${dim} score=${score} reason=${reason}`;
}

/**
 * Map a BandDecision (from the Python core) to the BeforeToolCallResult
 * that OpenClaw expects from the hook. Pure function, no I/O.
 */
export function mapToResult(
  decision: BandDecision,
  _cfg: PluginConfig
): BeforeToolCallResult | undefined {
  switch (decision.band) {
    case "GREEN": {
      // Pass through. Smallest possible footprint on the hot path.
      return undefined;
    }
    case "YELLOW": {
      // Pass through. The OpenClaw result envelope has no metadata slot, so
      // band/decision_id detail rides the audit log emitted by the structured
      // logger upstream of this mapper. Per spec §6 P-1 this is still a
      // "pass with metadata" outcome because the metadata is captured in the
      // audit trail; we just don't redirect it through the host result.
      return undefined;
    }
    case "ORANGE": {
      const description =
        decision.approval_prompt ??
        formatBandPrefix(decision) + " (approve to proceed)";
      return {
        requireApproval: {
          title: `5D ORANGE: ${decision.worst_dim ?? "?"} score=${
            decision.worst_score ?? "?"
          }`,
          description,
          severity: "warning"
        }
      };
    }
    case "RED": {
      return {
        block: true,
        blockReason: formatBandPrefix(decision)
      };
    }
    default: {
      // Exhaustiveness check: a band we do not recognise is treated as RED.
      // Returning pass on an unknown band would be the wrong default for a
      // security gate.
      const _exhaustive: never = decision.band;
      void _exhaustive;
      return {
        block: true,
        blockReason: `5D unknown band: ${String(
          (decision as { band: unknown }).band
        )}`
      };
    }
  }
}
