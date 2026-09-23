import { loadConfig } from '../config/index.js';
import { getLogger } from '../logger/index.js';
import { closeQueue, createIngestionQueue } from '../jobs/index.js';

import { startWebhookServer } from './server.js';

/**
 * @param {string} key
 * @param {number} def
 * @returns {number}
 */
function envInt(key, def) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Environment variable ${key} must be a non-negative integer, got '${raw}'`);
  }
  return n;
}

/**
 * @param {string} key
 * @param {string} [def]
 * @returns {string | undefined}
 */
function envString(key, def) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  return raw;
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function runServer(argv = process.argv) {
  for (const raw of argv.slice(2)) {
    if (raw === '--help' || raw === '-h') {
      process.stdout.write(
        [
          'RAG Ingestion Webhook Receiver',
          '',
          'Usage:',
          '  npm run ingestion:server',
          '',
          'Environment:',
          '  INGESTION_WEBHOOK_PORT     Port to listen on (default 3000).',
          '  INGESTION_WEBHOOK_PATH     URL path (default /ingest).',
          '  INGESTION_WEBHOOK_HOST     Bind host (default 0.0.0.0).',
          '  INGESTION_WEBHOOK_SECRET   Optional shared secret for X-Gitlab-Token.',
          '  REDIS_URL                  Redis used by the BullMQ ingestion queue.',
          '  INGESTION_QUEUE_NAME       Queue name (default ingestion).',
          '  INGESTION_JOB_ATTEMPTS     Max processing attempts per job (default 5).',
          '  INGESTION_JOB_BACKOFF_DELAY    Exponential backoff base delay ms (default 5000).',
          '  INGESTION_JOB_BACKOFF_JITTER   Backoff jitter 0..1 (default 0.2).',
          '  INGESTION_JOB_REMOVE_ON_COMPLETE  Completed jobs kept (default 1000).',
          '  INGESTION_JOB_REMOVE_ON_FAIL     Failed jobs kept (default 5000).',
          '',
        ].join('\n'),
      );
      return 0;
    }
  }

  const config = loadConfig();
  const log = getLogger(config.logLevel);

  const host = envString('INGESTION_WEBHOOK_HOST', '0.0.0.0') ?? '0.0.0.0';
  const port = envInt('INGESTION_WEBHOOK_PORT', 3000);
  const path = envString('INGESTION_WEBHOOK_PATH', '/ingest') ?? '/ingest';
  const secret = envString('INGESTION_WEBHOOK_SECRET');

  const queue = createIngestionQueue(config);
  queue.on('error', (err) => {
    log.error('Ingestion queue error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const server = await startWebhookServer({
    host,
    port,
    path,
    secret,
    config,
    log,
    queue,
  });

  log.info('Webhook receiver ready', {
    url: `http://${server.host}:${server.port}${server.path}`,
    queue: config.jobs.queueName,
    redisUrl: redactedRedisUrl(config.redisUrl),
  });

  /**
   * @param {string} signal
   */
  const shutdown = async (signal) => {
    log.info('Shutting down webhook server', { signal });
    try {
      await server.close();
    } catch (err) {
      log.error('Failed to close webhook server', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await closeQueue(queue);
    } catch (err) {
      log.error('Failed to close ingestion queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return new Promise(() => {
    /* long-lived server; shutdown handlers exit the process */
  });
}

/**
 * @param {string} url
 * @returns {string}
 */
function redactedRedisUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '<invalid> ';
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runServer().then(
    () => {
      /* server keeps the process alive; shutdown handler exits */
    },
    (err) => {
      process.stderr.write(`Fatal: ${err.message}\n`);
      process.exit(1);
    },
  );
}