/**
 * @typedef {('debug' | 'info' | 'warn' | 'error' | 'silent')} LogLevel
 */

/**
 * @typedef {object} Logger
 * @property {(msg: string, meta?: Record<string, unknown>) => void} debug
 * @property {(msg: string, meta?: Record<string, unknown>) => void} info
 * @property {(msg: string, meta?: Record<string, unknown>) => void} warn
 * @property {(msg: string, meta?: Record<string, unknown>) => void} error
 * @property {(bindings: Record<string, unknown>) => Logger} child
 * @property {(level: LogLevel) => void} setLevel
 */

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /authorization/i,
  /password/i,
  /secret/i,
  /private[_-]?key/i,
];

/**
 * @param {Record<string, unknown>} [meta]
 * @returns {Record<string, unknown> | undefined}
 */
function redact(meta) {
  if (!meta) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(k))) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class ConsoleLogger {
  /** @type {LogLevel} */
  currentLevel;
  /** @type {Record<LogLevel, number>} */
  order = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100,
  };
  /** @type {Record<string, unknown>} */
  bindings;

  /**
   * @param {LogLevel} [level]
   * @param {Record<string, unknown>} [bindings]
   */
  constructor(level = 'info', bindings = {}) {
    this.currentLevel = level;
    this.bindings = bindings;
  }

  /** @param {LogLevel} level */
  shouldLog(level) {
    return this.order[level] >= this.order[this.currentLevel];
  }

  /**
   * @param {LogLevel} level
   * @param {string} msg
   * @param {Record<string, unknown>} [meta]
   * @returns {string}
   */
  format(level, msg, meta) {
    const ts = new Date().toISOString();
    const safeMeta = redact({ ...this.bindings, ...(meta ?? {}) });
    const metaStr = safeMeta && Object.keys(safeMeta).length > 0 ? ' ' + JSON.stringify(safeMeta) : '';
    const upper = level.toUpperCase();
    return `${ts} ${upper} ${msg}${metaStr}`;
  }

  /**
   * @param {LogLevel} level
   * @param {string} msg
   * @param {Record<string, unknown>} [meta]
   */
  emit(level, msg, meta) {
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

  /** @param {string} msg @param {Record<string, unknown>} [meta] */
  debug(msg, meta) {
    this.emit('debug', msg, meta);
  }

  /** @param {string} msg @param {Record<string, unknown>} [meta] */
  info(msg, meta) {
    this.emit('info', msg, meta);
  }

  /** @param {string} msg @param {Record<string, unknown>} [meta] */
  warn(msg, meta) {
    this.emit('warn', msg, meta);
  }

  /** @param {string} msg @param {Record<string, unknown>} [meta] */
  error(msg, meta) {
    this.emit('error', msg, meta);
  }

  /** @param {Record<string, unknown>} bindings */
  child(bindings) {
    return new ConsoleLogger(this.currentLevel, { ...this.bindings, ...bindings });
  }

  /** @param {LogLevel} level */
  setLevel(level) {
    this.currentLevel = level;
  }
}

/** @type {Logger | null} */
let globalLogger = null;

/**
 * @param {LogLevel} [level]
 * @returns {Logger}
 */
export function getLogger(level = 'info') {
  if (!globalLogger) {
    globalLogger = new ConsoleLogger(level);
  }
  return globalLogger;
}

export function resetLogger() {
  globalLogger = null;
}

/** @param {Logger} logger */
export function setLogger(logger) {
  globalLogger = logger;
}