import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ConfigurationError } from '../errors/index.js';

const GitLabConfigSchema = z.object({
  host: z
    .string()
    .min(1, 'GITLAB_HOST must not be empty')
    .url('GITLAB_HOST must be a valid URL')
    .refine((u) => /^https?:\/\//.test(u), 'GITLAB_HOST must use http(s)'),
  token: z.string().min(1, 'GITLAB_TOKEN must not be empty'),
  projectId: z.string().min(1, 'GITLAB_PROJECT_ID must not be empty'),
  branch: z.string().min(1, 'GITLAB_BRANCH must not be empty').default('develop'),
});

const IngestionConfigSchema = z.object({
  gitlab: GitLabConfigSchema,
  maxFileSizeBytes: z.number().int().positive().default(2_000_000),
  chunkSize: z.number().int().positive().default(1500),
  chunkOverlap: z.number().int().nonnegative().default(150),
  stateFile: z.string().min(1).default('./.ingestion-state.json'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export type GitLabConfig = z.infer<typeof GitLabConfigSchema>;
export type IngestionConfig = z.infer<typeof IngestionConfigSchema>;

let cached: IngestionConfig | null = null;

function loadDotEnv(): void {
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

function readNumber(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ConfigurationError(`Environment variable ${key} must be a number, got '${v}'`);
  }
  return n;
}

export function loadConfig(overrides?: { env?: NodeJS.ProcessEnv }): IngestionConfig {
  if (cached) return cached;

  loadDotEnv();
  const env = overrides?.env ?? process.env;

  const gitlabRaw = {
    host: env.GITLAB_HOST ?? '',
    token: env.GITLAB_TOKEN ?? '',
    projectId: env.GITLAB_PROJECT_ID ?? '',
    branch: env.GITLAB_BRANCH ?? 'develop',
  };

  const missing: string[] = [];
  if (!gitlabRaw.host) missing.push('GITLAB_HOST');
  if (!gitlabRaw.token) missing.push('GITLAB_TOKEN');
  if (!gitlabRaw.projectId) missing.push('GITLAB_PROJECT_ID');
  if (!gitlabRaw.branch) missing.push('GITLAB_BRANCH');

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
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigurationError(`Invalid configuration: ${issues}`, { issues });
  }

  cached = parsed.data;
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

export function redactToken(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return value.slice(0, 2) + '***' + value.slice(-2);
}
