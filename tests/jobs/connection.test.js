import { describe, it, expect } from 'vitest';

import { redisConnection } from '../../src/jobs/connection.js';

describe('redisConnection', () => {
  it('uses maxRetriesPerRequest null as required by BullMQ', () => {
    expect(redisConnection({ redisUrl: 'redis://127.0.0.1:6379' })).toMatchObject({
      url: 'redis://127.0.0.1:6379',
      maxRetriesPerRequest: null,
    });
  });

  it('uses the configured database index', () => {
    expect(redisConnection({ redisUrl: 'redis://127.0.0.1:6379', redisDb: 4 })).toMatchObject({
      url: 'redis://127.0.0.1:6379',
      db: 4,
    });
  });

  it('defaults to database 0 when no index is configured', () => {
    expect(redisConnection({ redisUrl: 'redis://127.0.0.1:6379' })).toMatchObject({
      db: 0,
    });
  });
});