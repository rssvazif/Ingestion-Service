import { loadConfig } from '../config/index.js';
import { getLogger } from '../logger/index.js';
import { GitLabRepositoryAdapter } from '../repository/gitlab-adapter.js';
import { FileClassifier } from '../discovery/file-classifier.js';
import { FileDiscovery } from '../discovery/file-discovery.js';
import { MarkdownParser } from '../parsers/documentation/markdown-parser.js';
import { TreeSitterCodeParser } from '../parsers/code/code-parser.js';
import { CodeChunker } from '../chunkers/code-chunker.js';
import { DocumentationChunker } from '../chunkers/documentation-chunker.js';
import { ContextInjector } from '../knowledge/index.js';
import { FileIngestionStateStore, IngestionStateImpl } from '../state/index.js';
import { IngestionOrchestrator } from '../orchestrator/ingestion-orchestrator.js';

import { startWebhookServer } from './server.js';
import type { GitLabConfig } from '../config/index.js';

function envInt(key: string, def: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Environment variable ${key} must be a non-negative integer, got '${raw}'`);
  }
  return n;
}

function envString(key: string, def?: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  return raw;
}

export async function runServer(argv: string[] = process.argv): Promise<number> {
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

  const buildOrchestrator = (gitlab: GitLabConfig): IngestionOrchestrator => {
    const adapter = new GitLabRepositoryAdapter(gitlab, log);
    const classifier = new FileClassifier({ maxFileSizeBytes: config.maxFileSizeBytes });
    const discovery = new FileDiscovery(adapter, log, { classifier });
    const state = new IngestionStateImpl(new FileIngestionStateStore(config.stateFile));
    const injector = new ContextInjector();
    return new IngestionOrchestrator({
      adapter,
      discovery,
      state,
      markdownParser: new MarkdownParser(),
      codeParser: new TreeSitterCodeParser(),
      documentationChunker: new DocumentationChunker(),
      codeChunker: new CodeChunker(),
      contextInjector: injector,
      log,
    });
  };

  const server = await startWebhookServer({
    host,
    port,
    path,
    secret,
    config,
    log,
    buildOrchestrator,
  });

  log.info('Webhook receiver ready', {
    url: `http://${server.host}:${server.port}${server.path}`,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info('Shutting down webhook server', { signal });
    try {
      await server.close();
    } catch (err) {
      log.error('Failed to close webhook server', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return new Promise<number>(() => {
    /* long-lived server; shutdown handlers exit the process */
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runServer().then(
    () => {
      /* server keeps the process alive; shutdown handler exits */
    },
    (err) => {
      process.stderr.write(`Fatal: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
