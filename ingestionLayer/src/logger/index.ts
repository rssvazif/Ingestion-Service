export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  setLevel(level: LogLevel): void;
}

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /token/i,
  /authorization/i,
  /password/i,
  /secret/i,
  /private[_-]?key/i,
];

function redact(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(k))) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class ConsoleLogger implements Logger {
  private currentLevel: LogLevel;
  private readonly order: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100,
  };
  private bindings: Record<string, unknown>;

  constructor(level: LogLevel = 'info', bindings: Record<string, unknown> = {}) {
    this.currentLevel = level;
    this.bindings = bindings;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.order[level] >= this.order[this.currentLevel];
  }

  private format(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const safeMeta = redact({ ...this.bindings, ...(meta ?? {}) });
    const metaStr = safeMeta && Object.keys(safeMeta).length > 0 ? ' ' + JSON.stringify(safeMeta) : '';
    const upper = level.toUpperCase();
    return `${ts} ${upper} ${msg}${metaStr}`;
  }

  private emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const line = this.format(level, msg, meta);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.emit('debug', msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    this.emit('info', msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.emit('warn', msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.emit('error', msg, meta);
  }
  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.currentLevel, { ...this.bindings, ...bindings });
  }
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }
}

let globalLogger: Logger | null = null;

export function getLogger(level: LogLevel = 'info'): Logger {
  if (!globalLogger) {
    globalLogger = new ConsoleLogger(level);
  }
  return globalLogger;
}

export function resetLogger(): void {
  globalLogger = null;
}

export function setLogger(logger: Logger): void {
  globalLogger = logger;
}
