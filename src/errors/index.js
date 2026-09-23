/**
 * Domain-level error hierarchy for the ingestion pipeline.
 *
 * Errors are categorized so the orchestrator and CLI can:
 *  - distinguish configuration / authentication / network failures (fatal)
 *  - distinguish per-file parse failures (recoverable, logged)
 *  - provide stable error codes for downstream consumers (future vector store)
 */

/**
 * @typedef {(
 *   'CONFIG_MISSING' | 'CONFIG_INVALID' | 'GITLAB_AUTH_FAILED' |
 *   'GITLAB_NOT_FOUND' | 'GITLAB_RATE_LIMITED' | 'GITLAB_API_ERROR' |
 *   'GITLAB_TIMEOUT' | 'GITLAB_ARCHIVE_ERROR' | 'PARSE_ERROR' |
 *   'UNSUPPORTED_FILE' | 'IO_ERROR'
 * )} ErrorCode
 */

export class IngestionError extends Error {
  /** @type {ErrorCode} */
  code;
  /** @type {unknown} */
  cause;
  /** @type {Record<string, unknown> | undefined} */
  context;

  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{ cause?: unknown, context?: Record<string, unknown> }} [options]
   */
  constructor(code, message, options) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context ?? {},
    };
  }
}

export class ConfigurationError extends IngestionError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, context) {
    super('CONFIG_MISSING', message, { context });
    this.name = 'ConfigurationError';
  }
}

export class GitLabAuthError extends IngestionError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, context) {
    super('GITLAB_AUTH_FAILED', message, { context });
    this.name = 'GitLabAuthError';
  }
}

export class GitLabNotFoundError extends IngestionError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, context) {
    super('GITLAB_NOT_FOUND', message, { context });
    this.name = 'GitLabNotFoundError';
  }
}

export class GitLabRateLimitError extends IngestionError {
  /** @type {number | undefined} */
  retryAfterSeconds;

  /**
   * @param {string} message
   * @param {number} [retryAfterSeconds]
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, retryAfterSeconds, context) {
    super('GITLAB_RATE_LIMITED', message, { context });
    this.name = 'GitLabRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GitLabApiError extends IngestionError {
  /** @type {number | undefined} */
  status;

  /**
   * @param {string} message
   * @param {number} [status]
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, status, context) {
    super('GITLAB_API_ERROR', message, { context });
    this.name = 'GitLabApiError';
    this.status = status;
  }
}

export class GitLabTimeoutError extends IngestionError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, context) {
    super('GITLAB_TIMEOUT', message, { context });
    this.name = 'GitLabTimeoutError';
  }
}

export class GitLabArchiveError extends IngestionError {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, context) {
    super('GITLAB_ARCHIVE_ERROR', message, { context });
    this.name = 'GitLabArchiveError';
  }
}

export class FileParseError extends IngestionError {
  /** @type {string} */
  filePath;

  /**
   * @param {string} message
   * @param {string} filePath
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, filePath, context) {
    super('PARSE_ERROR', message, { context: { ...context, filePath } });
    this.name = 'FileParseError';
    this.filePath = filePath;
  }
}

export class UnsupportedFileError extends IngestionError {
  /** @type {string} */
  filePath;

  /**
   * @param {string} message
   * @param {string} filePath
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, filePath, context) {
    super('UNSUPPORTED_FILE', message, { context: { ...context, filePath } });
    this.name = 'UnsupportedFileError';
    this.filePath = filePath;
  }
}