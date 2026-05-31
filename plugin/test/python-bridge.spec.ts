import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { PluginConfig } from "../api.ts";
import {
  PythonBridge,
  PythonBridgeError,
  type SpawnFn
} from "../src/python-bridge.ts";
import { StructuredLogger, type ApiLogger } from "../src/logger.ts";

/**
 * Minimal fake child process. Emits stdout lines on demand, captures stdin
 * writes, and supports `kill`. EventEmitter for the exit/error wire.
 */
class FakeChild extends EventEmitter {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  killed = false;
  lastSignal: NodeJS.Signals | null = null;
  writes: string[] = [];

  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    const writes = this.writes;
    this.stdin = new Writable({
      write(chunk, _enc, cb) {
        writes.push(chunk.toString("utf8"));
        cb();
      }
    });
  }

  emitStdoutLine(line: string): void {
    this.stdout.write(line + "\n");
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.lastSignal = signal ?? "SIGTERM";
    setImmediate(() => this.emit("exit", null, signal ?? "SIGTERM"));
    return true;
  }
}

function silentLogger(): StructuredLogger {
  const sink: ApiLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  };
  return new StructuredLogger(sink);
}

const baseConfig: PluginConfig = {
  policyPath: "/tmp/policy.yaml",
  pythonBin: "python3",
  scoringTimeoutMs: 200,
  onError: "block"
};

/**
 * Helper: build a bridge with a controllable fake spawn. Returns the bridge
 * plus a function the test calls to surface the spawned child.
 */
function makeBridge(): {
  bridge: PythonBridge;
  spawned: FakeChild[];
} {
  const spawned: FakeChild[] = [];
  const spawnFn: SpawnFn = () => {
    const child = new FakeChild();
    spawned.push(child);
    // Send the ready handshake on the next tick so start() resolves.
    setImmediate(() => child.emitStdoutLine(JSON.stringify({ ready: true })));
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  const bridge = new PythonBridge({
    config: baseConfig,
    logger: silentLogger(),
    spawn: spawnFn
  });
  return { bridge, spawned };
}

describe("python-bridge", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("start() spawns a subprocess and resolves on first stdout line", async () => {
    const { bridge, spawned } = makeBridge();
    await bridge.start();
    expect(spawned.length).toBe(1);
    expect(bridge.isAlive()).toBe(true);
    await bridge.stop();
  });

  it("score() round-trip: writes JSON envelope, resolves with decision", async () => {
    const { bridge, spawned } = makeBridge();
    await bridge.start();
    const child = spawned[0]!;

    const pending = bridge.score({
      toolName: "shell.exec",
      toolArgs: { cmd: "ls" },
      traceId: "trace-1",
      runId: "run-1",
      sessionId: "sess-1"
    });

    // Wait one tick so the bridge has flushed stdin.
    await new Promise((r) => setImmediate(r));
    expect(child.writes.length).toBe(1);
    const sent = JSON.parse(child.writes[0]!.trim()) as {
      id: string;
      request: { toolName: string; traceId: string };
    };
    expect(sent.request.toolName).toBe("shell.exec");
    expect(sent.request.traceId).toBe("trace-1");

    // Reply on stdout.
    child.emitStdoutLine(
      JSON.stringify({
        id: sent.id,
        decision: {
          band: "GREEN",
          decision_id: "dec-1"
        }
      })
    );

    const decision = await pending;
    expect(decision.band).toBe("GREEN");
    expect(decision.decision_id).toBe("dec-1");

    await bridge.stop();
  });

  it("restart() kills the old subprocess and spawns a fresh one", async () => {
    const { bridge, spawned } = makeBridge();
    await bridge.start();
    expect(spawned.length).toBe(1);

    await bridge.restart();
    expect(spawned.length).toBe(2);
    expect(spawned[0]!.killed).toBe(true);
    expect(bridge.isAlive()).toBe(true);

    await bridge.stop();
  });

  it("score() rejects with PythonBridgeError on subprocess crash", async () => {
    const { bridge, spawned } = makeBridge();
    await bridge.start();
    const child = spawned[0]!;

    const pending = bridge.score({
      toolName: "shell.exec",
      toolArgs: {}
    });
    await new Promise((r) => setImmediate(r));

    // Simulate crash.
    child.emit("exit", 1, null);

    await expect(pending).rejects.toBeInstanceOf(PythonBridgeError);
    await bridge.stop();
  });

  it("score() times out and kills the subprocess when the core hangs", async () => {
    const { bridge, spawned } = makeBridge();
    await bridge.start();
    const child = spawned[0]!;

    const pending = bridge.score({
      toolName: "shell.exec",
      toolArgs: {}
    });

    let caught: unknown;
    try {
      await pending;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PythonBridgeError);
    expect((caught as PythonBridgeError).code).toBe("timeout");
    expect(child.killed).toBe(true);
    expect(child.lastSignal).toBe("SIGKILL");

    await bridge.stop();
  });

  it("score() before start() throws not_started", async () => {
    const spawnFn: SpawnFn = () => {
      throw new Error("should not spawn");
    };
    const bridge = new PythonBridge({
      config: baseConfig,
      logger: silentLogger(),
      spawn: spawnFn
    });

    await expect(
      bridge.score({ toolName: "t", toolArgs: {} })
    ).rejects.toBeInstanceOf(PythonBridgeError);
  });

  it("stop() is idempotent", async () => {
    const { bridge } = makeBridge();
    await bridge.start();
    await bridge.stop();
    await bridge.stop();
    expect(bridge.isAlive()).toBe(false);
  });
});
