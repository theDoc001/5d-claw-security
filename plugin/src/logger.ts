/**
 * Structured logger wrapper. All plugin logs flow through api.logger
 * (the OpenClaw-supplied logger) with a fixed component tag and any
 * caller-supplied structured fields. No console.log.
 *
 * The real OpenClaw `PluginLogger` (see plugin-sdk types) takes only a
 * single `message: string`; any second argument is silently dropped at
 * runtime. To preserve structured fields for audit-log correlation we
 * serialize them into the message string before calling the real logger,
 * using a greppable `<message> | k=v k=v` format that survives log pipes
 * and is parseable by simple grep / awk (not just full JSON parsers).
 *
 * The OpenClaw logger interface is duck-typed here so the plugin does not
 * import an SDK type for it; tests pass a stub conforming to ApiLogger.
 * The `ApiLogger.*` signatures still accept an optional `fields` arg so
 * test sinks written before this change continue to type-check; the real
 * runtime SDK simply ignores that arg, which is exactly why we serialize.
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

/**
 * Render one field value into a single-line, grep-friendly token. Strings
 * containing whitespace or `=` are JSON-quoted so `k=v` parsing stays
 * unambiguous; other primitives are stringified directly; objects/arrays
 * fall back to compact JSON.
 */
function renderValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    if (/[\s="]/.test(value)) return JSON.stringify(value);
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  // Objects, arrays, etc. Force single-line JSON, strip embedded newlines
  // defensively in case JSON.stringify ever sees a string with one.
  try {
    return JSON.stringify(value).replace(/\n/g, "\\n");
  } catch {
    return String(value).replace(/\n/g, "\\n");
  }
}

/**
 * Format a structured log line as `<message> | k=v k=v ...`. Keys are
 * emitted in insertion order so component/base fields land first.
 */
function formatLine(
  message: string,
  fields: Record<string, unknown>
): string {
  const safeMessage = message.replace(/\n/g, " ");
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    parts.push(`${k}=${renderValue(v)}`);
  }
  if (parts.length === 0) return safeMessage;
  return `${safeMessage} | ${parts.join(" ")}`;
}

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
    this.inner.debug(formatLine(message, this.merge(fields)));
  }

  info(message: string, fields?: PluginLogFields): void {
    this.inner.info(formatLine(message, this.merge(fields)));
  }

  warn(message: string, fields?: PluginLogFields): void {
    this.inner.warn(formatLine(message, this.merge(fields)));
  }

  error(message: string, fields?: PluginLogFields): void {
    this.inner.error(formatLine(message, this.merge(fields)));
  }

  /** Return a child logger with additional base fields merged in. */
  child(extra: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger(this.inner, { ...this.base, ...extra });
  }
}
