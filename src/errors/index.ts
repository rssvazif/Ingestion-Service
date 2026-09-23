/**
 * Domain-level error hierarchy for the ingestion pipeline.
 *
 * Errors are categorized so the orchestrator and CLI can:
 *  - distinguish configuration / authentication / network failures (fatal)
 *  - distinguish per-file parse failures (recoverable, logged)
 *  - provide stable error codes for downstream consumers (future vector store)
 */

export type ErrorCode =
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'GITLAB_AUTH_FAILED'
  | 'GITLAB_NOT_FOUND'
  | 'GITLAB_RATE_LIMITED'
  | 'GITLAB_API_ERROR'
  | 'GITLAB_TIMEOUT'
  | 'GITLAB_ARCHIVE_ERROR'
  | 'PARSE_ERROR'
  | 'UNSUPPORTED_FILE'
  | 'IO_ERROR';

export class IngestionError extends Error {
  public readonly code: ErrorCode;
  public readonly cause?: unknown;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context ?? {},
    };
  }
}

export class ConfigurationError extends IngestionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFIG_MISSING', message, { context });
    this.name = 'ConfigurationError';
  }
}

export class GitLabAuthError extends IngestionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('GITLAB_AUTH_FAILED', message, { context });
    this.name = 'GitLabAuthError';
  }
}

export class GitLabNotFoundError extends IngestionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('GITLAB_NOT_FOUND', message, { context });
    this.name = 'GitLabNotFoundError';
  }
}

export class GitLabRateLimitError extends IngestionError {
  public readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number, context?: Record<string, unknown>) {
    super('GITLAB_RATE_LIMITED', message, { context });
    this.name = 'GitLabRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GitLabApiError extends IngestionError {
  public readonly status?: number;

  constructor(message: string, status?: number, context?: Record<string, unknown>) {
    super('GITLAB_API_ERROR', message, { context });
    this.name = 'GitLabApiError';
    this.status = status;
  }
}

export class GitLabTimeoutError extends IngestionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('GITLAB_TIMEOUT', message, { context });
    this.name = 'GitLabTimeoutError';
  }
}

export class GitLabArchiveError extends IngestionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('GITLAB_ARCHIVE_ERROR', message, { context });
    this.name = 'GitLabArchiveError';
  }
}

export class FileParseError extends IngestionError {
  public readonly filePath: string;

  constructor(message: string, filePath: string, context?: Record<string, unknown>) {
    super('PARSE_ERROR', message, { context: { ...context, filePath } });
    this.name = 'FileParseError';
    this.filePath = filePath;
  }
}

export class UnsupportedFileError extends IngestionError {
  public readonly filePath: string;

  constructor(message: string, filePath: string, context?: Record<string, unknown>) {
    super('UNSUPPORTED_FILE', message, { context: { ...context, filePath } });
    this.name = 'UnsupportedFileError';
    this.filePath = filePath;
  }
}
