/**
 * 5D Claw Security: OpenClaw plugin entry point.
 *
 * Registers `before_tool_call` at priority 70. OpenClaw runs handlers in
 * descending priority order (higher number runs first), so 70 sits above
 * the OpenClaw docs-example default of 50 while leaving room above us for
 * deliberate priority-90+ overrides if a deployment chooses to insert a
 * layer above us.
 *
 * Per spec §8.2.1, the hook handler owns the recovery loop:
 *   1. score
 *   2. on failure: warn, restart subprocess, retry once
 *   3. on second failure: return per onError (block by default)
 * No user prompt is ever surfaced for a subprocess issue.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import type {
  PluginConfig,
  ScoreRequest
} from "./api.ts";
import {
  mapToResult,
  type BeforeToolCallResult
} from "./src/decision-mapper.ts";
import { PythonBridge } from "./src/python-bridge.ts";
import {
  StructuredLogger,
  type ApiLogger
} from "./src/logger.ts";

/**
 * Hook priority. OpenClaw runs handlers in descending priority order, so 70
 * sits above the OpenClaw docs-example default of 50 (we run before a hook
 * at priority 50) while staying friendly to deliberate priority-90+ overrides
 * a deployment may insert above us. Layered governance friendly.
 */
const HOOK_PRIORITY = 70;

/**
 * Defensive default. The configSchema in openclaw.plugin.json supplies these
 * values, but if the OpenClaw config layer ever delivers a partial object we
 * still want to fail closed.
 */
function normaliseConfig(raw: unknown): PluginConfig {
  const obj = (raw ?? {}) as Partial<PluginConfig>;
  if (typeof obj.policyPath !== "string" || obj.policyPath.length === 0) {
    throw new Error(
      "5D Claw Security: configSchema validation should have ensured policyPath; missing at runtime"
    );
  }
  return {
    policyPath: obj.policyPath,
    pythonBin:
      typeof obj.pythonBin === "string" && obj.pythonBin.length > 0
        ? obj.pythonBin
        : "python3",
    scoringTimeoutMs:
      typeof obj.scoringTimeoutMs === "number" && obj.scoringTimeoutMs > 0
        ? obj.scoringTimeoutMs
        : 5000,
    onError: obj.onError === "allow" ? "allow" : "block"
  };
}

/**
 * Hook-event shape we depend on. OpenClaw supplies more fields; we only use
 * these. Duck-typed so the plugin compiles against any minor version of the
 * SDK that preserves these names.
 */
interface BeforeToolCallEvent {
  readonly toolName: string;
  readonly toolArgs?: Record<string, unknown>;
}

interface BeforeToolCallContext {
  readonly traceId?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly agentContext?: Record<string, unknown>;
}

/**
 * Build the score request from the OpenClaw event + context. Trace fields are
 * propagated so the fivedrisk audit log can join with OpenClaw runs.
 */
function buildRequest(
  event: BeforeToolCallEvent,
  ctx: BeforeToolCallContext
): ScoreRequest {
  return {
    traceId: ctx.traceId,
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    toolName: event.toolName,
    toolArgs: event.toolArgs ?? {},
    agentContext: ctx.agentContext
  };
}

/**
 * Per spec §8.2.1, this is the canonical self-recovery loop. Kept small,
 * exported for testing in unit suites that exercise the restart path.
 */
export async function handleBeforeToolCall(
  bridge: PythonBridge,
  logger: StructuredLogger,
  cfg: PluginConfig,
  event: BeforeToolCallEvent,
  ctx: BeforeToolCallContext
): Promise<BeforeToolCallResult | undefined> {
  const request = buildRequest(event, ctx);
  const childLog = logger.child({
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    traceId: ctx.traceId,
    toolName: event.toolName
  });

  try {
    const decision = await bridge.score(request);
    childLog.debug("fivedrisk decision", {
      band: decision.band,
      decision_id: decision.decision_id,
      worst_dim: decision.worst_dim,
      worst_score: decision.worst_score
    });
    return mapToResult(decision, cfg);
  } catch (err) {
    childLog.warn("fivedrisk core unreachable, attempting auto-restart", {
      err: (err as Error).message
    });
    try {
      await bridge.restart();
      const decision = await bridge.score(request);
      childLog.info("fivedrisk recovered after restart", {
        band: decision.band,
        decision_id: decision.decision_id
      });
      return mapToResult(decision, cfg);
    } catch (retryErr) {
      childLog.error("fivedrisk core unrecoverable after restart", {
        err: (retryErr as Error).message,
        onError: cfg.onError
      });
      if (cfg.onError === "block") {
        return {
          block: true,
          blockReason:
            "5D Claw Security: core unrecoverable after restart, onError=block"
        };
      }
      // onError=allow: explicit pass-through. Return undefined so OpenClaw
      // treats this as no opinion from us.
      return undefined;
    }
  }
}

export default definePluginEntry((api: {
  readonly logger: ApiLogger;
  readonly config: unknown;
  on(
    hook: "before_tool_call",
    handler: (
      event: BeforeToolCallEvent,
      ctx: BeforeToolCallContext
    ) => Promise<BeforeToolCallResult | undefined>,
    options: { priority: number }
  ): void;
  onActivate(handler: () => Promise<void>): void;
  onDeactivate(handler: () => Promise<void>): void;
}) => {
  const cfg = normaliseConfig(api.config);
  const logger = new StructuredLogger(api.logger);
  const bridge = new PythonBridge({ config: cfg, logger });

  // Pre-warm the subprocess on activation per spec §8.1, so the first hook
  // call does not pay the Python startup cost.
  api.onActivate(async () => {
    logger.info("5D Claw Security activating", {
      policyPath: cfg.policyPath,
      pythonBin: cfg.pythonBin,
      onError: cfg.onError,
      scoringTimeoutMs: cfg.scoringTimeoutMs,
      hookPriority: HOOK_PRIORITY
    });
    try {
      await bridge.start();
      logger.info("5D Claw Security ready");
    } catch (err) {
      // Per spec §8.2.1 we never block activation on a Python failure; the
      // hook handler will retry on first call. Log and continue.
      logger.error("5D Claw Security failed to pre-warm fivedrisk core", {
        err: (err as Error).message
      });
    }
  });

  api.onDeactivate(async () => {
    logger.info("5D Claw Security deactivating");
    await bridge.stop();
  });

  api.on(
    "before_tool_call",
    (event, ctx) => handleBeforeToolCall(bridge, logger, cfg, event, ctx),
    { priority: HOOK_PRIORITY }
  );
});
