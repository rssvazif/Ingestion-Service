import { Queue } from 'bullmq';

import { redisConnection } from './connection.js';

/** Name of the single ingestion job type. */
export const INGESTION_JOB_NAME = 'process-ingestion';

/**
 * Create the ingestion BullMQ Queue backed by Redis.
 *
 * @param {import('../config/index.js').IngestionConfig} config
 * @returns {Queue}
 */
export function createIngestionQueue(config) {
  return new Queue(config.jobs.queueName, { connection: redisConnection(config) });
}

/**
 * Build the job options passed to `queue.add()`.
 *
 * - `jobId`        deterministic id enabling native BullMQ deduplication
 * - `attempts`     maximum processing attempts before the job is marked failed
 * - `backoff`      exponential delay (`delay * 2^attempt`) with optional jitter
 * - `removeOn*`    retention limits for completed/failed jobs (BullMQ evicts
 *                  the oldest beyond the configured count)
 *
 * @param {import('../config/index.js').IngestionConfig} config
 * @param {string} [jobId]
 * @returns {Record<string, unknown>}
 */
export function buildEnqueueOptions(config, jobId) {
  const backoff = {
    type: 'exponential',
    delay: config.jobs.backoffDelay,
  };
  if (config.jobs.backoffJitter > 0) {
    backoff.jitter = config.jobs.backoffJitter;
  }
  return {
    ...(jobId ? { jobId } : {}),
    attempts: config.jobs.attempts,
    backoff,
    removeOnComplete: { count: config.jobs.removeOnComplete },
    removeOnFail: { count: config.jobs.removeOnFail },
  };
}

/**
 * Close the queue and its Redis connections. Safe to call more than once.
 *
 * @param {Queue | null | undefined} queue
 * @returns {Promise<void>}
 */
export async function closeQueue(queue) {
  if (queue) {
    await queue.close();
  }
}