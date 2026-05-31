/**
 * Structured logger wrapper. All plugin logs flow through api.logger
 * (the OpenClaw-supplied logger) with a fixed component tag and any
 * caller-supplied structured fields. No console.log.
 *
 * The OpenClaw logger interface is duck-typed here so the plugin does not
 * import an SDK type for it; tests can pass a stub conforming to ApiLogger.
 */

export interface ApiLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Structured fields commonly attached to plugin log lines. */
export interface PluginLogFields {
  readonly sessionId?: string;
  readonly runId?: string;
  readonly traceId?: string;
  readonly toolName?: string;
  readonly band?: string;
  readonly decision_id?: string;
  readonly [key: string]: unknown;
}

const COMPONENT = "5d-claw-security";

export class StructuredLogger {
  private readonly inner: ApiLogger;
  private readonly base: Readonly<Record<string, unknown>>;

  constructor(inner: ApiLogger, base: Record<string, unknown> = {}) {
    this.inner = inner;
    this.base = { component: COMPONENT, ...base };
  }

  private merge(fields?: PluginLogFields): Record<string, unknown> {
    if (!fields) return { ...this.base };
    return { ...this.base, ...fields };
  }

  debug(message: string, fields?: PluginLogFields): void {
    this.inner.debug(message, this.merge(fields));
  }

  info(message: string, fields?: PluginLogFields): void {
    this.inner.info(message, this.merge(fields));
  }

  warn(message: string, fields?: PluginLogFields): void {
    this.inner.warn(message, this.merge(fields));
  }

  error(message: string, fields?: PluginLogFields): void {
    this.inner.error(message, this.merge(fields));
  }

  /** Return a child logger with additional base fields merged in. */
  child(extra: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger(this.inner, { ...this.base, ...extra });
  }
}
