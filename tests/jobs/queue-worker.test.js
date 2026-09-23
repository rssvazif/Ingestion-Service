import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import {
  FileParseError,
  GitLabTimeoutError,
} from '../../src/errors/index.js';
import {
  INGESTION_JOB_NAME,
  buildEnqueueOptions,
  closeQueue,
  closeWorker,
  createIngestionQueue,
  createIngestionWorker,
} from '../../src/jobs/index.js';

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};

/**
 * @param {Partial<typeof makeConfig>} [overrides]
 */
function makeConfig(overrides = {}) {
  return {
    gitlab: { host: 'https://gitlab.example.com', token: 'secret' },
    maxFileSizeBytes: 2_000_000,
    chunkSize: 1500,
    chunkOverlap: 150,
    stateFile: './.ingestion-state.json',
    logLevel: 'silent',
    redisUrl: '',
    redisDb: 0,
    jobs: {
      queueName: 'ingestion',
      attempts: 3,
      backoffDelay: 100,
      backoffJitter: 0,
      removeOnComplete: 10,
      removeOnFail: 10,
    },
    worker: { concurrency: 2 },
    ...overrides,
    jobs: {
      attempts: 3,
      backoffDelay: 100,
      backoffJitter: 0,
      removeOnComplete: 10,
      removeOnFail: 10,
      ...(overrides.jobs ?? {}),
    },
    worker: { concurrency: 2, ...(overrides.worker ?? {}) },
  };
}

function stubResult() {
  return {
    mode: 'full',
    repository: { id: '1', name: 'p' },
    branch: 'develop',
    revision: { repositoryId: '1', commit: 'abc', branch: 'develop' },
    previousRevision: { repositoryId: '1', commit: 'prev', branch: 'develop' },
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
 * @param {() => boolean | Promise<boolean>} predicate
 * @param {{ timeoutMs?: number, intervalMs?: number, label?: string }} [opts]
 */
async function waitFor(predicate, opts = {}) {
  const { timeoutMs = 10000, intervalMs = 25, label = 'condition' } = opts;
  const start = Date.now();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out: ${label}`);
    }
    await delay(intervalMs);
  }
}

/**
 * Resolve once `count` jobs have completed on the worker.
 *
 * @param {import('bullmq').Worker} worker
 * @param {number} count
 */
function onCompletions(worker, count) {
  return new Promise((resolve, reject) => {
    let seen = 0;
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${count} completions (got ${seen})`)),
      10000,
    );
    worker.on('completed', () => {
      seen += 1;
      if (seen >= count) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/**
 * Resolve once `count` jobs have failed on the worker.
 *
 * @param {import('bullmq').Worker} worker
 * @param {number} count
 */
function onFailures(worker, count) {
  return new Promise((resolve, reject) => {
    let seen = 0;
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${count} failures (got ${seen})`)),
      10000,
    );
    worker.on('failed', () => {
      seen += 1;
      if (seen >= count) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

/**
 * Boot an ephemeral redis-server and return its handle, or null when
 * `redis-server` is not available (tests are skipped in that case).
 */
async function startEphemeralRedis() {
  try {
    const port = await freePort();
    const proc = spawn('redis-server', [
      '--port',
      String(port),
      '--save',
      '',
      '--appendonly',
      'no',
    ]);
    proc.on('error', () => {});
    const base = `redis://127.0.0.1:${port}`;
    let connected = false;
    for (let i = 0; i < 50 && !connected; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await import('ioredis').then((m) => {
          const client = new m.default(base, { maxRetriesPerRequest: 1 });
          return client.ping().finally(() => client.disconnect());
        });
        connected = res === 'PONG';
      } catch {
        await delay(100);
      }
    }
    if (!connected) {
      proc.kill('SIGKILL');
      return null;
    }
    return {
      url: base,
      stop: () => {
        proc.kill('SIGKILL');
      },
    };
  } catch {
    return null;
  }
}

const redisInfo = await startEphemeralRedis();
const hasRedis = redisInfo !== null;

let queueSeq = 0;
function uniqueQueueName() {
  queueSeq += 1;
  return `ingestion-test-${process.pid}-${Date.now()}-${queueSeq}`;
}

if (redisInfo) {
  afterAll(() => {
    redisInfo.stop();
  });
}

describe.skipIf(!hasRedis)('BullMQ ingestion queue + worker', () => {
  it('worker processes a job and feeds the pipeline the expected payload', async () => {
    const config = makeConfig();
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;
    const log = silentLogger;

    const run = vi.fn(async () => stubResult());
    const buildOrchestrator = vi.fn(async () => ({ run }));

    const queue = createIngestionQueue(config);
    const worker = createIngestionWorker({ config, log, buildOrchestrator });
    try {
      const completed = onCompletions(worker, 1);
      const job = await queue.add(
        INGESTION_JOB_NAME,
        { projectId: '449', projectName: 'partServiceFileStorage' },
        buildEnqueueOptions(config),
      );

      await completed;

      expect(buildOrchestrator).toHaveBeenCalledTimes(1);
      const [gitlab, trigger] = buildOrchestrator.mock.calls[0];
      expect(gitlab).toMatchObject({
        host: 'https://gitlab.example.com',
        projectId: '449',
      });
      expect(trigger).toMatchObject({ projectId: '449' });

      expect(run).toHaveBeenCalledWith({ repositoryId: '449' });
      expect(job.id).toBeTypeOf('string');
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });

  it('deduplicates identical deliveries via a deterministic jobId', async () => {
    const config = makeConfig();
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;

    const run = vi.fn(async () => stubResult());
    const worker = createIngestionWorker({
      config,
      log: silentLogger,
      buildOrchestrator: async () => ({ run }),
    });
    const queue = createIngestionQueue(config);
    try {
      const completed = onCompletions(worker, 1);
      const opts = buildEnqueueOptions(config, 'gitlab-dup-delivery');
      const first = await queue.add(INGESTION_JOB_NAME, { projectId: '1' }, opts);
      const second = await queue.add(INGESTION_JOB_NAME, { projectId: '1' }, opts);
      expect(second.id).toBe(first.id);

      await completed;
      await waitFor(async () => (await queue.getCompletedCount()) === 1, {
        label: 'exactly one job completed',
      });
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });

  it('respects the configured worker concurrency', async () => {
    const config = makeConfig({ worker: { concurrency: 3 } });
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;

    let inFlight = 0;
    let maxInFlight = 0;
    const run = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(80);
      inFlight -= 1;
      return stubResult();
    });

    const queue = createIngestionQueue(config);
    const worker = createIngestionWorker({
      config,
      log: silentLogger,
      buildOrchestrator: async () => ({ run }),
    });
    try {
      const completed = onCompletions(worker, 6);
      for (let i = 0; i < 6; i += 1) {
        await queue.add(INGESTION_JOB_NAME, { projectId: String(i) }, buildEnqueueOptions(config));
      }
      await completed;

      expect(run).toHaveBeenCalledTimes(6);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
      expect(maxInFlight).toBeLessThanOrEqual(3);
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });

  it('retries retryable errors up to the configured attempts, then fails', async () => {
    const config = makeConfig({ jobs: { attempts: 3, backoffDelay: 100 } });
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;

    const run = vi.fn(async () => {
      throw new GitLabTimeoutError('socket timeout');
    });

    const queue = createIngestionQueue(config);
    const worker = createIngestionWorker({
      config,
      log: silentLogger,
      buildOrchestrator: async () => ({ run }),
    });
    try {
      const failed = onFailures(worker, 1);
      const job = await queue.add(
        INGESTION_JOB_NAME,
        { projectId: '1', eventId: 'retry-me' },
        buildEnqueueOptions(config),
      );

      expect(job.opts.attempts).toBe(3);
      expect(job.opts.backoff).toMatchObject({ type: 'exponential', delay: 100 });

      await failed;
      await waitFor(async () => (await queue.getFailedCount()) === 1, {
        label: 'job becomes failed',
      });

      expect(run).toHaveBeenCalledTimes(3);
      const [failedJob] = await queue.getFailed();
      expect(failedJob).toBeDefined();
      expect(failedJob.failedReason).toContain('socket timeout');
      // Exponential backoff was scheduled between attempts.
      await waitFor(async () => (await queue.getDelayedCount()) === 0, {
        label: 'no delayed jobs remain',
      });
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });

  it('fails non-retryable errors immediately without retries', async () => {
    const config = makeConfig({ jobs: { attempts: 5 } });
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;

    const run = vi.fn(async () => {
      throw new FileParseError('malformed markdown', 'docs/a.md');
    });

    const queue = createIngestionQueue(config);
    const worker = createIngestionWorker({
      config,
      log: silentLogger,
      buildOrchestrator: async () => ({ run }),
    });
    try {
      const failed = onFailures(worker, 1);
      await queue.add(
        INGESTION_JOB_NAME,
        { projectId: '1', eventId: 'permanent' },
        buildEnqueueOptions(config),
      );

      await failed;
      await waitFor(async () => (await queue.getFailedCount()) === 1, {
        label: 'job becomes failed',
      });

      expect(run).toHaveBeenCalledTimes(1);
      const [failedJob] = await queue.getFailed();
      expect(failedJob.failedReason).toContain('Non-retryable');
      expect(failedJob.failedReason).toContain('malformed markdown');
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });

  it('records failure lifecycle logs with job/event context for debugging', async () => {
    const config = makeConfig({ jobs: { attempts: 1 } });
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;

    const shared = [];
    const recording = {
      debug: (...a) => shared.push(['debug', ...a]),
      info: (...a) => shared.push(['info', ...a]),
      warn: (...a) => shared.push(['warn', ...a]),
      error: (...a) => shared.push(['error', ...a]),
      child: () => recording,
    };

    const run = vi.fn(async () => {
      throw new GitLabTimeoutError('boom');
    });

    const queue = createIngestionQueue(config);
    const worker = createIngestionWorker({
      config,
      log: recording,
      buildOrchestrator: async () => ({ run }),
    });
    try {
      const failed = onFailures(worker, 1);
      await queue.add(
        INGESTION_JOB_NAME,
        { projectId: '900', eventId: 'lifecycle-event' },
        buildEnqueueOptions(config),
      );
      await failed;
      await waitFor(async () => (await queue.getFailedCount()) === 1, {
        label: 'job becomes failed',
      });

      const lines = shared.map(([, msg]) => msg).join('\n');
      expect(lines).toContain('[IngestionJob] started');
      expect(lines).toContain('[IngestionJob] failed');
      const jobLine = shared.find(([level, msg]) => level === 'error' && msg.includes('[IngestionJob] failed'));
      expect(jobLine).toBeDefined();
      const meta = jobLine[2];
      expect(meta.jobId).toBeTypeOf('string');
      expect(meta.eventId).toBe('lifecycle-event');
      expect(meta.projectId).toBe('900');
      expect(meta.stack).toBeTypeOf('string');
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });

  it('shuts down gracefully, letting running jobs finish', async () => {
    const config = makeConfig({ jobs: { attempts: 1 } });
    config.jobs.queueName = uniqueQueueName();
    config.redisUrl = redisInfo.url;

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await gate;
      return stubResult();
    });

    const queue = createIngestionQueue(config);
    const worker = createIngestionWorker({
      config,
      log: silentLogger,
      buildOrchestrator: async () => ({ run }),
    });

    try {
      const completed = onCompletions(worker, 1);
      let activeSeen = false;
      const active = new Promise((resolve) => {
        worker.on('active', () => {
          activeSeen = true;
          resolve();
        });
      });
      await queue.add(INGESTION_JOB_NAME, { projectId: '1' }, buildEnqueueOptions(config));
      await active;
      expect(activeSeen).toBe(true);

      let closed = false;
      const closing = closeWorker(worker).then(() => {
        closed = true;
      });

      await delay(150);
      expect(closed).toBe(false);

      release();
      await closing;
      await completed;

      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await closeWorker(worker);
      await closeQueue(queue);
    }
  });
});