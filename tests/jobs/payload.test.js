import { describe, it, expect } from 'vitest';

import {
  INGESTION_DELIVERY_UUID_HEADER,
  INGESTION_EVENT_UUID_HEADER,
  buildEnqueueOptions,
  buildJobPayload,
  deriveJobId,
  eventIdFromHeaders,
} from '../../src/jobs/index.js';

const config = {
  gitlab: { host: 'https://gitlab.example.com', token: 't' },
  maxFileSizeBytes: 1,
  chunkSize: 1,
  chunkOverlap: 1,
  stateFile: './x.json',
  logLevel: 'silent',
  redisUrl: 'redis://127.0.0.1:6379',
  redisDb: 0,
  jobs: {
    queueName: 'ingestion',
    attempts: 5,
    backoffDelay: 5000,
    backoffJitter: 0.2,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  worker: { concurrency: 3 },
};

describe('buildJobPayload', () => {
  it('carries the normalized trigger and no request state', () => {
    const payload = buildJobPayload(
      { projectId: '449', projectName: 'partServiceFileStorage' },
      { eventId: 'uuid-1' },
    );
    expect(payload).toEqual({
      projectId: '449',
      projectName: 'partServiceFileStorage',
      eventId: 'uuid-1',
    });
    expect(JSON.stringify(payload)).not.toContain('request');
    expect(JSON.stringify(payload)).not.toContain('socket');
  });

  it('omits eventId and nulls the projectName when not available', () => {
    const payload = buildJobPayload({ projectId: '449' });
    expect(payload).toEqual({ projectId: '449', projectName: null });
    expect(payload).not.toHaveProperty('eventId');
  });
});

describe('deriveJobId', () => {
  it('returns a deterministic job id when the delivery uuid is present', () => {
    expect(deriveJobId({ eventId: 'abc-123' })).toBe('gitlab-abc-123');
    expect(deriveJobId({ eventId: 'abc-123' })).toBe(deriveJobId({ eventId: 'abc-123' }));
  });

  it('returns undefined when no event id is available', () => {
    expect(deriveJobId({})).toBeUndefined();
    expect(deriveJobId()).toBeUndefined();
  });

  it('derives distinct ids for distinct deliveries', () => {
    expect(deriveJobId({ eventId: 'a' })).not.toBe(deriveJobId({ eventId: 'b' }));
  });
});

describe('eventIdFromHeaders', () => {
  it('reads the ingestion-event-uuid header', () => {
    expect(eventIdFromHeaders({ [INGESTION_EVENT_UUID_HEADER]: 'uuid-1' })).toBe('uuid-1');
  });

  it('falls back to ingestion-delivery-uuid', () => {
    expect(
      eventIdFromHeaders({
        'ingestion-delivery-uuid': 'uuid-2',
      }),
    ).toBe('uuid-2');
  });

  it('prefers the event uuid header over the delivery header', () => {
    expect(
      eventIdFromHeaders({
        [INGESTION_EVENT_UUID_HEADER]: 'event-uuid',
        [INGESTION_DELIVERY_UUID_HEADER]: 'delivery-uuid',
      }),
    ).toBe('event-uuid');
  });

  it('handles array header values and missing headers', () => {
    expect(eventIdFromHeaders({ [INGESTION_EVENT_UUID_HEADER]: ['a', 'b'] })).toBe('a');
    expect(eventIdFromHeaders({})).toBeUndefined();
  });
});

describe('buildEnqueueOptions', () => {
  it('applies attempts, exponential backoff with jitter and retention', () => {
    const opts = buildEnqueueOptions(config);
    expect(opts).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000, jitter: 0.2 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
  });

  it('sets the deterministic jobId only when provided', () => {
    expect(buildEnqueueOptions(config, 'gitlab:u').jobId).toBe('gitlab:u');
    expect(buildEnqueueOptions(config)).not.toHaveProperty('jobId');
  });
});