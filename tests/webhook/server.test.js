import { describe, it, expect, beforeEach, vi } from 'vitest';
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

function stubOrchestrator() {
  const run = vi.fn(async () => stubResult());
  return { run, runFull: run, runIncremental: run };
}

function stubResult() {
  return {
    mode: 'full',
    repository: { id: '449', name: 'p' },
    branch: 'develop',
    revision: { repositoryId: '449', commit: 'abc', branch: 'develop' },
    previousRevision: { repositoryId: '449', commit: 'prev', branch: 'develop' },
    jobId: 'job',
    stats: {
      filesDiscovered: 0,
      filesIgnored: 0,
      filesProcessed: 0,
      filesFailed: 0,
      codeChunks: 0,
      documentationChunks: 0,
      configChunks: 0,
      deleteChunks: 0,
      totalChunks: 0,
    },
    failures: [],
    chunks: [],
    durationMs: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
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
    buildOrchestrator: () => stubOrchestrator(),
    ...overrides,
  });
}

describe('webhook server', () => {
  let server;
  let receivedGitlab = null;
  let receivedTriggerProjectId = null;
  let receivedRunOptions = null;

  beforeEach(async () => {
    receivedGitlab = null;
    receivedTriggerProjectId = null;
    receivedRunOptions = null;
    const orchestrator = stubOrchestrator();
    const originalRun = orchestrator.run;
    orchestrator.run = vi.fn(async (opts) => {
      receivedRunOptions = opts;
      return stubResult();
    });

    server = await startWith({
      buildOrchestrator: (gitlab, trigger) => {
        receivedGitlab = gitlab;
        receivedTriggerProjectId = trigger.projectId;
        return orchestrator;
      },
    });
    void originalRun;
  });

  it('rejects requests on the wrong path with 404', async () => {
    const res = await send(server.port, { method: 'POST', path: '/wrong' });
    expect(res.status).toBe(404);
  });

  it('rejects non-POST requests with 404', async () => {
    const res = await send(server.port, { method: 'GET', path: '/ingest' });
    expect(res.status).toBe(404);
  });

  it('rejects requests with the wrong X-Gitlab-Event with 400', async () => {
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
    const guarded = await startWith({ secret: 'topsecret' });
    try {
      const res = await send(guarded.port, {
        method: 'POST',
        path: '/ingest',
        headers: {
          'content-type': 'application/json',
          'x-gitlab-event': 'Merge Request Hook',
        },
        body: JSON.stringify(makePayload()),
      });
      expect(res.status).toBe(401);
    } finally {
      await guarded.close();
    }
  });

  it('accepts a minimal payload with 202 and triggers ingestion', async () => {
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

    await waitFor(() => receivedGitlab !== null);
    expect(receivedGitlab?.projectId).toBe('449');
    expect(receivedGitlab?.host).toBe('https://gitlab.example.com');
    expect(receivedGitlab?.token).toBe('secret');
    expect(receivedTriggerProjectId).toBe('449');
    expect(receivedRunOptions).toEqual({ repositoryId: '449' });
  });

  it('routes per-project when different project ids arrive in payloads', async () => {
    const res = await send(server.port, {
      method: 'POST',
      path: '/ingest',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Merge Request Hook',
      },
      body: JSON.stringify(makePayload({ project: { id: 999 } })),
    });
    expect(res.status).toBe(202);
    await waitFor(() => receivedGitlab !== null);
    expect(receivedGitlab?.projectId).toBe('999');
    expect(receivedRunOptions).toEqual({ repositoryId: '999' });
  });

  it('accepts payloads with extra fields (e.g. object_attributes) and ignores them', async () => {
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

  it('rejects invalid JSON with 400', async () => {
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

  it('serves a health endpoint at /health', async () => {
    const res = await send(server.port, { method: 'GET', path: '/health' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });
});

/**
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 */
async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}