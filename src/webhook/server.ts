import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Logger } from '../logger/index.js';
import type { GitLabConfig, IngestionConfig } from '../config/index.js';
import { IngestionOrchestrator } from '../orchestrator/ingestion-orchestrator.js';

import {
  GitLabPayloadError,
  parseGitLabMergeRequestWebhook,
} from './gitlab-payload-parser.js';
import type { NormalizedTrigger } from './types.js';

const MAX_BODY_BYTES = 1_048_576;

export interface WebhookServerOptions {
  host: string;
  port: number;
  path: string;
  secret?: string;
  config: IngestionConfig;
  log: Logger;
  buildOrchestrator: (
    gitlab: GitLabConfig,
    trigger: NormalizedTrigger,
  ) => IngestionOrchestrator | Promise<IngestionOrchestrator>;
}

export interface RunningWebhookServer {
  port: number;
  host: string;
  path: string;
  close: () => Promise<void>;
}

export async function startWebhookServer(
  options: WebhookServerOptions,
): Promise<RunningWebhookServer> {
  const log = options.log.child({ component: 'webhook' });

  const server = createServer((req, res) => {
    void handleRequest(req, res, options, log);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address() as AddressInfo | null;
  const boundPort = address?.port ?? options.port;

  log.info('Webhook server listening', {
    host: options.host,
    port: boundPort,
    path: options.path,
  });

  return {
    host: options.host,
    port: boundPort,
    path: options.path,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: WebhookServerOptions,
  log: Logger,
): Promise<void> {
  const { method, url, headers } = req;

  if (method === 'GET' && (url === '/health' || url === `${options.path}/health`)) {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (method !== 'POST' || url !== options.path) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (options.secret) {
    const provided = headerValue(headers['x-gitlab-token']);
    if (provided !== options.secret) {
      log.warn('Webhook rejected: invalid or missing X-Gitlab-Token');
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
  }

  const eventHeader = headerValue(headers['x-gitlab-event']);
  if (eventHeader !== 'Merge Request Hook') {
    log.warn('Webhook rejected: wrong X-Gitlab-Event', { event: eventHeader });
    sendJson(res, 400, { error: 'unsupported_event', event: eventHeader ?? null });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Webhook rejected: failed to read body', { error: message });
    sendJson(res, 413, { error: 'body_too_large' });
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    log.warn('Webhook rejected: invalid JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

  let trigger: NormalizedTrigger;
  try {
    trigger = parseGitLabMergeRequestWebhook(parsedJson);
  } catch (err) {
    if (err instanceof GitLabPayloadError) {
      log.warn('Webhook rejected: payload validation failed', {
        reason: err.reason,
        issues: err.issues,
      });
      sendJson(res, 400, { error: 'invalid_payload', reason: err.reason });
      return;
    }
    throw err;
  }

  log.info('Webhook accepted; scheduling ingestion', {
    projectId: trigger.projectId,
    projectName: trigger.projectName,
  });

  sendJson(res, 202, {
    status: 'accepted',
    projectId: trigger.projectId,
    projectName: trigger.projectName ?? null,
  });

  void runIngestion(options, trigger, log);
}

async function runIngestion(
  options: WebhookServerOptions,
  trigger: NormalizedTrigger,
  log: Logger,
): Promise<void> {
  const jobLog = log.child({
    projectId: trigger.projectId,
    projectName: trigger.projectName,
  });

  try {
    const gitlab: GitLabConfig = {
      ...options.config.gitlab,
      projectId: trigger.projectId,
    };
    const orchestrator = await options.buildOrchestrator(gitlab, trigger);
    const result = await orchestrator.run({
      repositoryId: trigger.projectId,
    });

    jobLog.info('Ingestion finished', {
      mode: result.mode,
      branch: result.branch,
      filesProcessed: result.stats.filesProcessed,
      filesFailed: result.stats.filesFailed,
      totalChunks: result.stats.totalChunks,
      durationMs: result.durationMs,
    });
  } catch (err) {
    jobLog.error('Ingestion failed', {
      error: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string }).code,
    });
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error(`payload exceeded ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}
