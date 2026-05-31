/**
 * Persistent stdio bridge to the fivedrisk Python core.
 *
 * Per spec §8.1: one long-lived Python subprocess per plugin activation,
 * JSON-lines over stdin/stdout. Subprocess startup overhead (~50 to 150 ms)
 * is amortised to zero after the first call, preserving the fivedrisk
 * 0.2 to 2.9 ms scoring latency claim.
 *
 * Per spec §8.2.1: the bridge owns its own recovery. Crashes restart the
 * subprocess. Per-call timeouts kill and restart. The hook handler in
 * index.ts does try -> catch -> restart -> retry once -> fall back to onError.
 * The user is never prompted about a subprocess failure.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import type {
  PluginConfig,
  ScoreRequest,
  ScoreResponse,
  BandDecision
} from "../api.ts";
import type { StructuredLogger } from "./logger.ts";

/**
 * Minimal child_process surface we depend on. Defined here so tests can
 * inject a mock without pulling in node:child_process internals.
 */
export interface SpawnFn {
  (
    command: string,
    args: ReadonlyArray<string>,
    options: { stdio: "pipe" }
  ): ChildProcessWithoutNullStreams;
}

export class PythonBridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PythonBridgeError";
    this.code = code;
  }
}

interface PendingCall {
  readonly id: string;
  readonly resolve: (decision: BandDecision) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface PythonBridgeOptions {
  readonly config: PluginConfig;
  readonly logger: StructuredLogger;
  /** Override for tests. Defaults to node:child_process spawn. */
  readonly spawn?: SpawnFn;
}

/**
 * Owns the lifecycle of one long-lived Python subprocess. Not reentrant
 * across instances; one bridge per plugin activation.
 */
export class PythonBridge {
  private readonly config: PluginConfig;
  private readonly logger: StructuredLogger;
  private readonly spawnFn: SpawnFn;

  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadlineInterface | null = null;
  private readonly pending: Map<string, PendingCall> = new Map();
  private starting: Promise<void> | null = null;
  private stopped = false;

  constructor(opts: PythonBridgeOptions) {
    this.config = opts.config;
    this.logger = opts.logger;
    this.spawnFn = opts.spawn ?? (spawn as SpawnFn);
  }

  /**
   * Spawn the Python subprocess and pre-warm it. Idempotent: a second
   * concurrent call awaits the first. Throws if the subprocess exits before
   * the first stdout line.
   */
  async start(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;

    this.starting = this.spawnAndWire();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private spawnAndWire(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        "-m",
        "fivedrisk.gateway",
        "stdio",
        "--policy",
        this.config.policyPath
      ];
      this.logger.info("spawning fivedrisk gateway", {
        pythonBin: this.config.pythonBin,
        policyPath: this.config.policyPath
      });

      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnFn(this.config.pythonBin, args, { stdio: "pipe" });
      } catch (err) {
        reject(
          new PythonBridgeError(
            "spawn_failed",
            `failed to spawn ${this.config.pythonBin}: ${(err as Error).message}`
          )
        );
        return;
      }

      this.child = child;
      this.stopped = false;

      const reader = createInterface({ input: child.stdout });
      this.stdoutReader = reader;

      let started = false;

      reader.on("line", (line) => {
        if (!started) {
          // First emitted line is treated as the ready handshake. The Python
          // core writes a single JSON line such as {"ready": true, "version": "..."}
          // on start. Anything malformed still counts as a sign of life;
          // subsequent lines will surface real protocol errors per call.
          started = true;
          this.logger.debug("fivedrisk gateway ready", { firstLine: line });
          resolve();
          return;
        }
        this.handleLine(line);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        // Python stderr is forwarded to the structured logger at warn level.
        // The Python core uses stderr only for diagnostics; protocol traffic
        // is on stdout.
        const text = chunk.toString("utf8").trimEnd();
        if (text.length > 0) {
          this.logger.warn("fivedrisk gateway stderr", { stderr: text });
        }
      });

      child.on("exit", (code, signal) => {
        this.logger.warn("fivedrisk gateway exited", {
          code,
          signal,
          stopped: this.stopped
        });
        this.failAllPending(
          new PythonBridgeError(
            "subprocess_exited",
            `fivedrisk gateway exited (code=${code}, signal=${signal})`
          )
        );
        this.child = null;
        this.stdoutReader?.close();
        this.stdoutReader = null;
        if (!started) {
          reject(
            new PythonBridgeError(
              "subprocess_exited_before_ready",
              `fivedrisk gateway exited before sending ready (code=${code}, signal=${signal})`
            )
          );
        }
      });

      child.on("error", (err) => {
        this.logger.error("fivedrisk gateway error event", {
          err: err.message
        });
        if (!started) {
          reject(
            new PythonBridgeError("subprocess_error", err.message)
          );
        }
      });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: ScoreResponse;
    try {
      parsed = JSON.parse(trimmed) as ScoreResponse;
    } catch (err) {
      this.logger.error("fivedrisk gateway emitted unparseable line", {
        line: trimmed,
        err: (err as Error).message
      });
      return;
    }

    const pendingCall = this.pending.get(parsed.id);
    if (!pendingCall) {
      this.logger.warn("fivedrisk gateway reply has no matching call id", {
        id: parsed.id
      });
      return;
    }

    this.pending.delete(parsed.id);
    clearTimeout(pendingCall.timer);

    if (parsed.error) {
      pendingCall.reject(
        new PythonBridgeError(parsed.error.code, parsed.error.message)
      );
      return;
    }
    if (!parsed.decision) {
      pendingCall.reject(
        new PythonBridgeError(
          "missing_decision",
          "fivedrisk gateway reply has neither decision nor error"
        )
      );
      return;
    }
    pendingCall.resolve(parsed.decision);
  }

  private failAllPending(err: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(err);
    }
    this.pending.clear();
  }

  /**
   * Send a scoring request and await the decision. Throws on timeout,
   * subprocess crash, or protocol error.
   */
  async score(request: ScoreRequest): Promise<BandDecision> {
    if (!this.child || this.child.killed) {
      throw new PythonBridgeError(
        "not_started",
        "python bridge is not started; call start() first"
      );
    }

    const id = randomUUID();
    const envelope = JSON.stringify({ id, request });

    return new Promise<BandDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.logger.warn("fivedrisk gateway call timed out", {
          id,
          scoringTimeoutMs: this.config.scoringTimeoutMs,
          toolName: request.toolName
        });
        // Per spec §8.2.1: on timeout kill the subprocess so the caller can
        // restart and retry once. We do NOT restart from inside score(); the
        // hook handler owns that loop.
        try {
          this.child?.kill("SIGKILL");
        } catch (killErr) {
          this.logger.error("failed to kill hung fivedrisk gateway", {
            err: (killErr as Error).message
          });
        }
        reject(
          new PythonBridgeError(
            "timeout",
            `fivedrisk gateway did not respond within ${this.config.scoringTimeoutMs}ms`
          )
        );
      }, this.config.scoringTimeoutMs);

      this.pending.set(id, { id, resolve, reject, timer });

      try {
        const stdin = this.child!.stdin;
        const ok = stdin.write(envelope + "\n");
        if (!ok) {
          stdin.once("drain", () => {
            /* backpressure relieved; nothing else to do */
          });
        }
      } catch (writeErr) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new PythonBridgeError(
            "stdin_write_failed",
            (writeErr as Error).message
          )
        );
      }
    });
  }

  /**
   * Stop the subprocess. Idempotent. Fails all pending calls.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.failAllPending(
      new PythonBridgeError("stopped", "python bridge stopped")
    );
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.stdoutReader?.close();
    this.stdoutReader = null;
    try {
      child.stdin.end();
    } catch {
      /* stdin may already be closed */
    }
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /**
   * Restart the subprocess. Used by the hook handler on transient failure
   * before its single retry. Per spec §8.2.1 the user sees only a warn log,
   * never a prompt.
   */
  async restart(): Promise<void> {
    this.logger.warn("restarting fivedrisk gateway");
    await this.stop();
    this.stopped = false;
    await this.start();
  }

  /** Test-only: whether the bridge currently has a live child. */
  isAlive(): boolean {
    return this.child !== null && !this.child.killed;
  }
}
