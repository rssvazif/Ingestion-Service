import { UnrecoverableError, Worker } from 'bullmq';

import { redisConnection } from './connection.js';
import { isRetryableError } from './errors.js';

/**
 * @typedef {import('../config/index.js').IngestionConfig} IngestionConfig
 * @typedef {import('../logger/index.js').Logger} Logger
 * @typedef {import('../orchestrator/ingestion-orchestrator.js').IngestionOrchestrator} IngestionOrchestrator
 */

/**
 * @typedef {object} IngestionWorkerDeps
 * @property {IngestionConfig} config
 * @property {Logger} log
 * @property {(gitlab: import('../config/index.js').GitLabConfig, trigger: import('../webhook/types.js').NormalizedTrigger) => IngestionOrchestrator | Promise<IngestionOrchestrator>} buildOrchestrator
 */

/** @typedef {{ projectId: string, projectName?: string | null, eventId?: string }} IngestionJobData */

/**
 * Create the BullMQ Worker for the ingestion queue.
 *
 * The worker pulls jobs from the ingestion queue, resolves each job's project
 * through the configured pipeline and runs the existing ingestion orchestrator
 * (unchanged). Concurrency is bounded by `config.worker.concurrency`.
 *
 * Retry policy: transient failures are rethrown so BullMQ schedules the next
 * attempt with exponential backoff; permanent failures are wrapped in an
 * `UnrecoverableError` so the job is failed without unnecessary retries.
 *
 * @param {IngestionWorkerDeps} deps
 * @returns {Worker}
 */
export function createIngestionWorker({ config, log, buildOrchestrator }) {
  const workerLog = log.child({ component: 'ingestion-worker' });

  const worker = new Worker(
    config.jobs.queueName,
    async (job) => {
      const jobData = normalizeJobData(job.data);
      const jobLog = workerLog.child({
        jobId: job.id,
        projectId: jobData.projectId,
        ...(jobData.eventId ? { eventId: jobData.eventId } : {}),
      });

      try {
        const gitlab = {
          ...config.gitlab,
          projectId: jobData.projectId,
        };
        const orchestrator = await buildOrchestrator(gitlab, jobData);
        return await orchestrator.run({
          repositoryId: jobData.projectId,
        });
      } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err));
        const retryable = isRetryableError(cause);
        jobLog[retryable ? 'warn' : 'error'](
          retryable ? '[IngestionJob] processing failed; retry scheduled' : '[IngestionJob] processing failed; permanent',
          {
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            errorType: cause.name,
            error: cause.message,
            code: cause.code ?? undefined,
            stack: cause.stack,
          },
        );
        if (retryable) {
          throw cause;
        }
        const unrecoverable = new UnrecoverableError(
          `Non-retryable ingestion failure: ${cause.name}: ${cause.message}`,
        );
        unrecoverable.cause = cause;
        throw unrecoverable;
      }
    },
    {
      connection: redisConnection(config),
      concurrency: config.worker.concurrency,
    },
  );

  worker.on('active', (job, prev) => {
    const jobData = normalizeJobData(job.data);
    workerLog.info('[IngestionJob] started', {
      jobId: job.id,
      prev,
      projectId: jobData.projectId,
      ...(jobData.eventId ? { eventId: jobData.eventId } : {}),
    });
  });

  worker.on('completed', (job, result) => {
    const jobData = normalizeJobData(job.data);
    workerLog.info('[IngestionJob] completed', {
      jobId: job.id,
      projectId: jobData.projectId,
      ...(jobData.eventId ? { eventId: jobData.eventId } : {}),
      mode: result?.mode,
      branch: result?.branch,
      stats: result?.stats,
      durationMs: result?.durationMs,
    });
  });

  worker.on('failed', (job, error, prev) => {
    if (!job) {
      workerLog.error('[IngestionJob] failed (job unavailable)', {
        error: error.message,
      });
      return;
    }
    const jobData = normalizeJobData(job.data);
    const cause = error.cause && typeof error.cause === 'object'
      ? /** @type {Error} */ (error.cause)
      : error;
    const willRetry = isRetryableError(cause) && job.attemptsMade < job.opts.attempts;
    const meta = {
      jobId: job.id,
      prev,
      attempt: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      projectId: jobData.projectId,
      ...(jobData.eventId ? { eventId: jobData.eventId } : {}),
      errorType: cause.name,
      error: cause.message,
      code: cause.code ?? undefined,
      stack: cause.stack,
    };
    if (willRetry) {
      workerLog.warn('[IngestionJob] retry scheduled', meta);
    } else {
      workerLog.error('[IngestionJob] failed', meta);
    }
  });

  worker.on('error', (err) => {
    workerLog.error('[IngestionJob] worker error', {
      error: err.message,
      stack: err.stack,
    });
  });

  return worker;
}

/**
 * Gracefully stop the worker: stops picking up new jobs and waits for the jobs
 * currently being processed to finish before closing Redis connections.
 *
 * @param {Worker | null | undefined} worker
 * @returns {Promise<void>}
 */
export async function closeWorker(worker) {
  if (worker) {
    await worker.close();
  }
}

/**
 * @param {unknown} data
 * @returns {IngestionJobData}
 */
function normalizeJobData(data) {
  if (!data || typeof data !== 'object') {
    throw new UnrecoverableError('Ingestion job data is missing');
  }
  const { projectId, projectName, eventId } = /** @type {Record<string, unknown>} */ (data);
  const payload = {
    projectName: typeof projectName === 'string' ? projectName : undefined,
    eventId: typeof eventId === 'string' ? eventId : undefined,
  };
  if (typeof projectId === 'string' && projectId.length > 0) {
    payload.projectId = projectId;
    return payload;
  }
  throw new UnrecoverableError('Ingestion job data is missing a valid projectId');
}