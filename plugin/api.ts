/**
 * Internal type contracts for the 5D Claw Security plugin.
 *
 * The plugin talks to the fivedrisk Python core via persistent JSON-lines stdio.
 * These types describe the request/response shapes on that wire, the band
 * decision that the Python core emits, and the plugin configuration as
 * supplied by the OpenClaw config layer (validated against openclaw.plugin.json
 * configSchema before reaching the hook).
 *
 * No OpenClaw SDK types are re-exported here. They live in the openclaw
 * peer dependency and are imported only by index.ts.
 */

/** Band as emitted by the fivedrisk Python core. */
export type Band = "GREEN" | "YELLOW" | "ORANGE" | "RED";

/** Dimension scored by fivedrisk (Data, Tool, Reversibility, External, Autonomy). */
export type Dimension = "D" | "T" | "R" | "E" | "A";

/**
 * onError policy. `block` fails closed (default), `allow` fails open.
 * Throws from the hook handler are pass-through in OpenClaw, so the
 * fail-closed behavior must be explicit.
 */
export type OnError = "block" | "allow";

/** Plugin configuration after validation against openclaw.plugin.json. */
export interface PluginConfig {
  readonly policyPath: string;
  readonly pythonBin: string;
  readonly scoringTimeoutMs: number;
  readonly onError: OnError;
}

/**
 * Per-dimension score, 0 to 4 inclusive. Carried in the decision payload so
 * the plugin can surface dimension/score detail in blockReason and audit logs.
 */
export interface DimensionScore {
  readonly dim: Dimension;
  readonly score: number;
}

/**
 * Scoring decision as returned by the Python core over stdio. Field names are
 * the wire contract and must not be renamed without a coordinated change in
 * fivedrisk.gateway. Optional fields are omitted (not null) when the Python
 * side has nothing to report.
 */
export interface BandDecision {
  readonly band: Band;
  /** Stable UUID assigned by the Python core; ties this decision to the audit row. */
  readonly decision_id: string;
  /** Per-dimension scores, present on YELLOW/ORANGE/RED, omitted on GREEN. */
  readonly scores?: ReadonlyArray<DimensionScore>;
  /** Worst dimension (drove the band). Present whenever scores is. */
  readonly worst_dim?: Dimension;
  /** Worst dimension score. Present whenever scores is. */
  readonly worst_score?: number;
  /** Human-readable rationale. Present on YELLOW/ORANGE/RED. */
  readonly reason?: string;
  /** Approval prompt text, surfaced by OpenClaw on ORANGE. */
  readonly approval_prompt?: string;
}

/**
 * One scoring request sent over stdio. Mirrors fivedrisk.gateway expected schema.
 * traceId/runId/sessionId propagate from OpenClaw into the audit log for SIEM
 * correlation.
 */
export interface ScoreRequest {
  readonly traceId?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly agentContext?: Readonly<Record<string, unknown>>;
}

/**
 * Envelope written to the Python subprocess. Each line on stdin is one
 * JSON-encoded envelope; each line on stdout is one JSON-encoded response.
 * `id` is a plugin-local correlation id (not the audit decision_id; the
 * Python core supplies that in the response).
 */
export interface ScoreEnvelope {
  readonly id: string;
  readonly request: ScoreRequest;
}

/** Response envelope. `error` is set when the Python core declined to score. */
export interface ScoreResponse {
  readonly id: string;
  readonly decision?: BandDecision;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}
