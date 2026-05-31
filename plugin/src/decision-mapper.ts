/**
 * Pure mapping from BandDecision -> BeforeToolCallResult.
 *
 * Keeps the band-to-action contract isolated and snapshot-testable. The
 * BeforeToolCallResult shape is duck-typed here (not imported from the
 * openclaw peer dependency) so the mapper is unit-testable in isolation.
 * index.ts narrows this to the actual SDK type at the hook boundary.
 *
 * Band contract (per spec §6 P-1):
 *   GREEN  -> pass (undefined)
 *   YELLOW -> pass with metadata
 *   ORANGE -> requireApproval with approval_prompt
 *   RED    -> block with blockReason
 */

import type { BandDecision, PluginConfig } from "../api.ts";

/**
 * BeforeToolCallResult, structurally typed. The OpenClaw SDK type is wider;
 * we only return the subset we use. Returning `undefined` (or omitting the
 * return entirely) is the pass-through signal in OpenClaw.
 */
export interface BeforeToolCallResult {
  block?: boolean;
  blockReason?: string;
  requireApproval?: boolean;
  approvalPrompt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Format a blockReason or approvalPrompt prefix. Includes dim+score so the
 * operator sees, in one line, which dimension drove the decision.
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
      // Pass through with no metadata. Smallest possible footprint on the hot path.
      return undefined;
    }
    case "YELLOW": {
      // Pass, but attach scoring metadata so downstream plugins and audit
      // surfaces can see we ran. Per spec §6 P-1 "pass with metadata".
      return {
        metadata: {
          fivedrisk: {
            band: decision.band,
            decision_id: decision.decision_id,
            worst_dim: decision.worst_dim,
            worst_score: decision.worst_score,
            reason: decision.reason
          }
        }
      };
    }
    case "ORANGE": {
      // Ask OpenClaw's native channel flow to surface an approval prompt.
      return {
        requireApproval: true,
        approvalPrompt:
          decision.approval_prompt ??
          formatBandPrefix(decision) + " (approve to proceed)",
        metadata: {
          fivedrisk: {
            band: decision.band,
            decision_id: decision.decision_id,
            worst_dim: decision.worst_dim,
            worst_score: decision.worst_score,
            reason: decision.reason
          }
        }
      };
    }
    case "RED": {
      return {
        block: true,
        blockReason: formatBandPrefix(decision),
        metadata: {
          fivedrisk: {
            band: decision.band,
            decision_id: decision.decision_id,
            worst_dim: decision.worst_dim,
            worst_score: decision.worst_score,
            reason: decision.reason
          }
        }
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
