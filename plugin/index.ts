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
 *
 * Lifecycle is wired via the typed `gateway_start` and `gateway_stop` hooks
 * so the Python subprocess is pre-warmed at Gateway startup and shut down
 * cleanly on Gateway stop.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import type {
  PluginConfig,
  ScoreRequest
} from "./api.js";
import {
  mapToResult,
  type BeforeToolCallResult,
  type BeforeToolCallEvent,
  type BeforeToolCallContext
} from "./src/decision-mapper.js";
import { PythonBridge } from "./src/python-bridge.js";
import {
  StructuredLogger,
  type ApiLogger
} from "./src/logger.js";

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
 * Build the score request from the OpenClaw event + context. Trace fields are
 * propagated so the fivedrisk audit log can join with OpenClaw runs.
 *
 * The OpenClaw `before_tool_call` event surfaces tool arguments under
 * `event.params`; the fivedrisk wire contract uses `toolArgs`, so we adapt
 * field names at this boundary.
 */
function buildRequest(
  event: BeforeToolCallEvent,
  ctx: BeforeToolCallContext
): ScoreRequest {
  // exactOptionalPropertyTypes: omit undefined-valued optional props rather
  // than assigning `undefined` to a `string`-typed optional.
  const traceId = ctx.trace?.traceId;
  return {
    toolName: event.toolName,
    toolArgs: event.params ?? {},
    ...(traceId !== undefined && { traceId }),
    ...(ctx.runId !== undefined && { runId: ctx.runId }),
    ...(ctx.sessionId !== undefined && { sessionId: ctx.sessionId })
  };
}

/**
 * Per spec §8.2.1, this is the canonical self-recovery loop. Kept small,
 * exported for testing in unit suites that exercise the restart path.
 *
 * Calls `bridge.start()` first as a backstop for non-gateway runs (e.g.
 * `openclaw run <prompt>` one-shot CLI) where `gateway_start` never fires
 * and the pre-warm in register() never ran. `PythonBridge.start()` is
 * idempotent: it returns early if a child is already alive, and concurrent
 * callers await the in-progress startup promise.
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
    traceId: ctx.trace?.traceId,
    toolName: event.toolName
  });

  try {
    await bridge.start();
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

export default definePluginEntry({
  id: "fivedrisk-claw-security",
  name: "5D Claw Security",
  description:
    "Deterministic per-action policy gate. Scores every tool call on five dimensions (Data, Tool, Reversibility, External, Autonomy), bands GREEN/YELLOW/ORANGE/RED, blocks RED, requests approval on ORANGE, passes GREEN/YELLOW. Bridges to the fivedrisk Python core via persistent stdio.",
  register: (api: OpenClawPluginApi) => {
    // `api.pluginConfig` is the OpenClaw SDK's contract for per-plugin
    // configuration; see `OpenClawPluginApi.pluginConfig?: Record<string, unknown>`
    // in node_modules/openclaw/dist/plugin-sdk/src/plugins/types.d.ts. The
    // sibling `api.config` is the full OpenClawConfig and is not the right
    // surface for plugin-scoped settings.
    const cfg = normaliseConfig(api.pluginConfig);
    const logger = new StructuredLogger(api.logger as ApiLogger);
    const bridge = new PythonBridge({ config: cfg, logger });

    // Pre-warm the subprocess at Gateway start per spec §8.1, so the first
    // hook call does not pay the Python startup cost.
    api.on("gateway_start", async () => {
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

    api.on("gateway_stop", async () => {
      logger.info("5D Claw Security deactivating");
      await bridge.stop();
    });

    api.on(
      "before_tool_call",
      (event, ctx) =>
        handleBeforeToolCall(
          bridge,
          logger,
          cfg,
          event as BeforeToolCallEvent,
          ctx as BeforeToolCallContext
        ),
      { priority: HOOK_PRIORITY }
    );
  }
});
