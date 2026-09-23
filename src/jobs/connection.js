/**
 * Build BullMQ connection options from the service configuration.
 *
 * A single URL/options object is passed to every BullMQ Queue/Worker so they
 * each open their own connection to the same Redis instance. `maxRetriesPerRequest:
 * null` is required by BullMQ so a Redis-backed command never trips ioredis'
 * default retry cap and blocks the queue.
 *
 * @param {{ redisUrl: string, redisDb?: number }} config
 * @returns {{ url: string, db: number, maxRetriesPerRequest: null }}
 */
export function redisConnection(config) {
  return {
    url: config.redisUrl,
    db: config.redisDb ?? 0,
    maxRetriesPerRequest: null,
  };
}