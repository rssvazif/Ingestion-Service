import { describe, it, expect } from 'vitest';
import { UnrecoverableError } from 'bullmq';

import {
  ConfigurationError,
  FileParseError,
  GitLabApiError,
  GitLabArchiveError,
  GitLabAuthError,
  GitLabNotFoundError,
  GitLabRateLimitError,
  GitLabTimeoutError,
  UnsupportedFileError,
} from '../../src/errors/index.js';
import { isRetryableError } from '../../src/jobs/index.js';

describe('isRetryableError', () => {
  it('retries transient GitLab failures', () => {
    expect(isRetryableError(new GitLabTimeoutError('timeout'))).toBe(true);
    expect(isRetryableError(new GitLabRateLimitError('rate limit', 60))).toBe(true);
    expect(isRetryableError(new GitLabArchiveError('archive'))).toBe(true);
  });

  it('retries GitLab API 5xx but not 4xx', () => {
    expect(isRetryableError(new GitLabApiError('boom', 502))).toBe(true);
    expect(isRetryableError(new GitLabApiError('boom', 503))).toBe(true);
    expect(isRetryableError(new GitLabApiError('boom', 400))).toBe(false);
    expect(isRetryableError(new GitLabApiError('boom', 404))).toBe(false);
    expect(isRetryableError(new GitLabApiError('boom'))).toBe(false);
  });

  it('does not retry permanent error classes', () => {
    expect(isRetryableError(new GitLabAuthError('unauthorized'))).toBe(false);
    expect(isRetryableError(new GitLabNotFoundError('not found'))).toBe(false);
    expect(isRetryableError(new ConfigurationError('bad config'))).toBe(false);
    expect(isRetryableError(new FileParseError('bad file', 'a.md'))).toBe(false);
    expect(isRetryableError(new UnsupportedFileError('nope', 'x.bin'))).toBe(false);
  });

  it('does not retry UnrecoverableError', () => {
    expect(isRetryableError(new UnrecoverableError('permanent'))).toBe(false);
  });

  it('treats unknown errors as retryable by default', () => {
    expect(isRetryableError(new Error('connection reset'))).toBe(true);
    expect(isRetryableError('string error')).toBe(true);
    expect(isRetryableError(undefined)).toBe(true);
  });
});