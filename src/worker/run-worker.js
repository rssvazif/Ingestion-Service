import { loadConfig } from '../config/index.js';
import { getLogger } from '../logger/index.js';
import { createOrchestratorFactory } from '../orchestrator/index.js';
import { closeWorker, createIngestionWorker } from '../jobs/index.js';

const HELP = [
  'RAG Ingestion BullMQ Worker',
  '',
  'Usage:',
  '  npm run ingestion:worker',
  '',
  'Environment:',
  '  REDIS_URL                       Redis used by the BullMQ ingestion queue.',
  '  INGESTION_QUEUE_NAME            Queue name (default ingestion).',
  '  INGESTION_WORKER_CONCURRENCY    Jobs processed concurrently (default 3).',
  '  INGESTION_JOB_ATTEMPTS          Max processing attempts per job (default 5).',
  '  INGESTION_JOB_BACKOFF_DELAY     Exponential backoff base delay ms (default 5000).',
  '  INGESTION_JOB_BACKOFF_JITTER    Backoff jitter 0..1 (default 0.2).',
  '  INGESTION_JOB_REMOVE_ON_COMPLETE  Completed jobs kept (default 1000).',
  '  INGESTION_JOB_REMOVE_ON_FAIL     Failed jobs kept (default 5000).',
  '',
].join('\n');

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function runWorker(argv = process.argv) {
  for (const raw of argv.slice(2)) {
    if (raw === '--help' || raw === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
  }

  const config = loadConfig();
  const log = getLogger(config.logLevel);
  const buildOrchestrator = createOrchestratorFactory({ config, log });

  const worker = createIngestionWorker({ config, log, buildOrchestrator });

  log.info('Ingestion worker started', {
    queue: config.jobs.queueName,
    concurrency: config.worker.concurrency,
    attempts: config.jobs.attempts,
    backoff: {
      type: 'exponential',
      delay: config.jobs.backoffDelay,
      jitter: config.jobs.backoffJitter,
    },
  });

  /**
   * @param {string} signal
   */
  const shutdown = async (signal) => {
    log.info('Shutting down ingestion worker', { signal });
    try {
      await closeWorker(worker);
    } catch (err) {
      log.error('Failed to close ingestion worker', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return new Promise(() => {
    /* long-lived worker; shutdown handlers exit the process */
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorker().then(
    () => {
      /* worker keeps the process alive; shutdown handler exits */
    },
    (err) => {
      process.stderr.write(`Fatal: ${err.message}\n`);
      process.exit(1);
    },
  );
}