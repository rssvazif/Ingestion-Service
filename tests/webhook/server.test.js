import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request as httpRequest } from 'node:http';

import { startWebhookServer } from '../../src/webhook/server.js';

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
  setLevel() {},
};

const config = {
  gitlab: {
    host: 'https://gitlab.example.com',
    token: 'secret',
  },
  maxFileSizeBytes: 2_000_000,
  chunkSize: 1500,
  chunkOverlap: 150,
  stateFile: './.ingestion-state.json',
  logLevel: 'silent',
  redisUrl: 'redis://127.0.0.1:6379',
  jobs: {
    queueName: 'ingestion',
    attempts: 2,
    backoffDelay: 100,
    backoffJitter: 0,
    removeOnComplete: 10,
    removeOnFail: 10,
  },
  worker: {
    concurrency: 2,
  },
};

/**
 * @param {Record<string, unknown>} [overrides]
 */
function makePayload(overrides = {}) {
  return {
    object_kind: 'merge_request',
    project: { id: 449, name: 'partServiceFileStorage' },
    ...overrides,
  };
}

/**
 * @param {number} port
 * @param {{ method: string, path: string, headers?: Record<string, string>, body?: string }} opts
 */
function send(port, opts) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Fake queue recording every enqueue. `add` returns the passed jobId when a
 * deterministic jobId is supplied, mirroring BullMQ's deduplication (adding a
 * job with an existing jobId returns the existing job instead of a duplicate).
 */
function makeQueue() {
  const add = vi.fn(async (name, data, opts) => ({
    id: opts?.jobId ?? `job-${Math.random().toString(36).slice(2)}`,
  }));
  return { add };
}

/**
 * @param {Partial<Parameters<typeof startWebhookServer>[0]>} [overrides]
 */
async function startWith(overrides = {}) {
  return startWebhookServer({
    host: '127.0.0.1',
    port: 0,
    path: '/ingest',
    config,
    log: silentLogger,
    queue: makeQueue(),
    ...overrides,
  });
}

describe('webhook server', () => {
  let server;

  beforeEach(async () => {
    server = null;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  it('rejects requests on the wrong path with 404', async () => {
    server = await startWith();
    const res = await send(server.port, { method: 'POST', path: '/wrong' });
    expect(res.status).toBe(404);
  });

  it('rejects non-POST requests with 404', async () => {
    server = await startWith();
    const res = await send(server.port, { method: 'GET', path: '/ingest' });
    expect(res.status).toBe(404);
  });

  it('rejects requests with the wrong X-Gitlab-Event with 400', async () => {
    server = await startWith();
    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Push Hook',
      },
      body: JSON.stringify(makePayload()),
    });
    expect(res.status).toBe(400);
  });

  it('rejects requests with an invalid shared secret with 401', async () => {
    server = await startWith({ secret: 'topsecret' });
    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify(makePayload()),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a minimal payload with 202 and enqueues a job', async () => {
    const queue = makeQueue();
    server = await startWith({ queue });

    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify(makePayload()),
    });

    expect(res.status).toBe(202);
    const json = JSON.parse(res.body);
    expect(json).toMatchObject({
      status: 'accepted',
      projectId: '449',
      projectName: 'partServiceFileStorage',
    });
    expect(typeof json.jobId).toBe('string');

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = queue.add.mock.calls[0];
    expect(name).toBe('process-ingestion');
    expect(payload).toEqual({
      projectId: '449',
      projectName: 'partServiceFileStorage',
    });
    expect(opts.jobId).toBeUndefined();
    expect(opts.attempts).toBe(2);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 100 });
    expect(opts.removeOnComplete).toEqual({ count: 10 });
    expect(opts.removeOnFail).toEqual({ count: 10 });

    // The pipeline must not run inside the HTTP handler.
    expect(payload).not.toHaveProperty('request');
  });

  it('routes per-project when different project ids arrive in payloads', async () => {
    const queue = makeQueue();
    server = await startWith({ queue });

    await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify(makePayload({ project: { id: 999 } })),
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toMatchObject({ projectId: '999' });
  });

  it('accepts payloads with extra fields (e.g. object_attributes) and ignores them', async () => {
    server = await startWith();
    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify(
        makePayload({
          object_attributes: { target_branch: 'develop', action: 'open' },
        }),
      ),
    });
    expect(res.status).toBe(202);
  });

  it('uses the X-Gitlab-Event-UUID as a deterministic jobId for deduplication', async () => {
    const queue = makeQueue();
    server = await startWith({ queue });

    const headers = {
      'content-type': 'application/json',
      'x-gitlab-event': 'Merge Request Hook',
      'x-gitlab-event-uuid': '5f6d3c2a-0000-4a00-8000-000000000001',
    };
    const body = () => JSON.stringify(makePayload());

    const first = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers,
      body: body(),
    });
    const second = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers,
      body: body(),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    expect(queue.add).toHaveBeenCalledTimes(2);
    const firstOpts = queue.add.mock.calls[0][2];
    const secondOpts = queue.add.mock.calls[1][2];
    expect(firstOpts.jobId).toBe('gitlab-5f6d3c2a-0000-4a00-8000-000000000001');
    expect(secondOpts.jobId).toBe(firstOpts.jobId);
  });

  it('rejects invalid JSON with 400', async () => {
    server = await startWith();
    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects payloads that fail schema validation with 400', async () => {
    server = await startWith();
    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify({ object_kind: 'push' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when the queue cannot accept the job', async () => {
    const queue = {
      add: vi.fn(async () => {
        throw new Error('Redis is down');
      }),
    };
    server = await startWith({ queue });

    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify(makePayload()),
    });

    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'queue_unavailable' });
  });

  it('serves a health endpoint at /health', async () => {
    server = await startWith();
    const res = await send(server.port, { method: 'GET', path: '/health' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });
});