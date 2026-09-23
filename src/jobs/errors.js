import {
  ConfigurationError,
  FileParseError,
  GitLabApiError,
  GitLabArchiveError,
  GitLabAuthError,
  GitLabNotFoundError,
  GitLabRateLimitError,
  GitLabTimeoutError,
  IngestionError,
  UnsupportedFileError,
} from '../errors/index.js';

/**
 * Classifies ingestion failures for BullMQ retry decisions.
 *
 * Transient failures (network timeouts, 429 rate-limit responses, temporary
 * GitLab API 5xx responses, archive download failures) are retryable.
 * Deterministic failures (validation, auth/config problems, parse errors,
 * unsupported files, 4xx GitLab responses) are permanent and must not be
 * retried.
 *
 * Errors that are not known domain errors are treated as retryable: during a
 * webhook-triggered pull-and-parse job they most likely indicate a transient
 * downstream/network problem, and retrying is safer than silently dropping an
 * ingestion request. Permanent problems surface through the domain error
 * hierarchy instead.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableError(err) {
  if (err instanceof GitLabTimeoutError) return true;
  if (err instanceof GitLabRateLimitError) return true;
  if (err instanceof GitLabArchiveError) return true;
  if (err instanceof GitLabApiError) return isRetryableHttpStatus(err.status);
  if (err instanceof GitLabAuthError) return false;
  if (err instanceof GitLabNotFoundError) return false;
  if (err instanceof ConfigurationError) return false;
  if (err instanceof FileParseError) return false;
  if (err instanceof UnsupportedFileError) return false;
  if (err instanceof IngestionError) return false;
  if (err && typeof err === 'object' && err.name === 'UnrecoverableError') return false;
  return true;
}

/**
 * GitLab API errors are only retryable on upstream (5xx) failures. 4xx
 * responses are deterministic and should fail the job immediately.
 *
 * @param {unknown} status
 * @returns {boolean}
 */
function isRetryableHttpStatus(status) {
  return typeof status === 'number' && status >= 500 && status <= 599;
}