import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ConfigurationError } from '../errors/index.js';

/**
 * @typedef {z.infer<typeof GitLabHostSchema>} GitLabHostConfig
 * @typedef {z.infer<typeof GitLabConfigSchema>} GitLabConfig
 * @typedef {z.infer<typeof IngestionConfigSchema>} IngestionConfig
 * @typedef {z.infer<typeof BullMQJobConfigSchema>} BullMQJobConfig
 * @typedef {z.infer<typeof BullMQWorkerConfigSchema>} BullMQWorkerConfig
 */

const GitLabHostSchema = z.object({
  host: z
    .string()
    .min(1, 'GITLAB_HOST must not be empty')
    .url('GITLAB_HOST must be a valid URL')
    .refine((u) => /^https?:\/\//.test(u), 'GITLAB_HOST must use http(s)'),
  token: z.string().min(1, 'GITLAB_TOKEN must not be empty'),
});

const GitLabConfigSchema = GitLabHostSchema.extend({
  projectId: z.string().min(1),
});

const BullMQJobConfigSchema = z.object({
  queueName: z.string().min(1).default('ingestion'),
  attempts: z.number().int().positive().default(5),
  backoffDelay: z.number().int().nonnegative().default(5000),
  backoffJitter: z.number().nonnegative().max(1).default(0.2),
  removeOnComplete: z.number().int().nonnegative().default(1000),
  removeOnFail: z.number().int().nonnegative().default(5000),
});

const BullMQWorkerConfigSchema = z.object({
  concurrency: z.number().int().positive().default(3),
});

const IngestionConfigSchema = z.object({
  gitlab: GitLabHostSchema,
  maxFileSizeBytes: z.number().int().positive().default(2_000_000),
  chunkSize: z.number().int().positive().default(1500),
  chunkOverlap: z.number().int().nonnegative().default(150),
  stateFile: z.string().min(1).default('./.ingestion-state.json'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  redisUrl: z
    .string()
    .min(1, 'REDIS_URL must not be empty')
    .url('REDIS_URL must be a valid URL')
    .default('redis://127.0.0.1:6379'),
  jobs: BullMQJobConfigSchema,
  worker: BullMQWorkerConfigSchema,
});

/** @type {IngestionConfig | null} */
let cached = null;

function loadDotEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore .env read errors - configuration will fail validation clearly if values are missing
  }
}

/**
 * @param {string} key
 * @param {number} def
 * @returns {number}
 */
function readNumber(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ConfigurationError(`Environment variable ${key} must be a number, got '${v}'`);
  }
  return n;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [overrides]
 * @returns {IngestionConfig}
 */
export function loadConfig(overrides) {
  if (cached) return cached;

  loadDotEnv();
  const env = overrides?.env ?? process.env;

  const gitlabRaw = {
    host: env.GITLAB_HOST ?? '',
    token: env.GITLAB_TOKEN ?? '',
  };

  const missing = [];
  if (!gitlabRaw.host) missing.push('GITLAB_HOST');
  if (!gitlabRaw.token) missing.push('GITLAB_TOKEN');

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill in the values.`,
      { missing }
    );
  }

  const parsed = IngestionConfigSchema.safeParse({
    gitlab: gitlabRaw,
    maxFileSizeBytes: readNumber('INGESTION_MAX_FILE_SIZE_BYTES', 2_000_000),
    chunkSize: readNumber('INGESTION_CHUNK_SIZE', 1500),
    chunkOverlap: readNumber('INGESTION_CHUNK_OVERLAP', 150),
    stateFile: env.INGESTION_STATE_FILE ?? './.ingestion-state.json',
    logLevel: env.LOG_LEVEL ?? 'info',
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    jobs: {
      queueName: env.INGESTION_QUEUE_NAME ?? 'ingestion',
      attempts: readNumber('INGESTION_JOB_ATTEMPTS', 5),
      backoffDelay: readNumber('INGESTION_JOB_BACKOFF_DELAY', 5000),
      backoffJitter: readNumber('INGESTION_JOB_BACKOFF_JITTER', 0.2),
      removeOnComplete: readNumber('INGESTION_JOB_REMOVE_ON_COMPLETE', 1000),
      removeOnFail: readNumber('INGESTION_JOB_REMOVE_ON_FAIL', 5000),
    },
    worker: {
      concurrency: readNumber('INGESTION_WORKER_CONCURRENCY', 3),
    },
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigurationError(`Invalid configuration: ${issues}`, { issues });
  }

  cached = parsed.data;
  return cached;
}

export function resetConfig() {
  cached = null;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function redactToken(value) {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return value.slice(0, 2) + '***' + value.slice(-2);
}