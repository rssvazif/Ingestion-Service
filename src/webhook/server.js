import { createServer } from 'node:http';

import { IngestionOrchestrator } from '../orchestrator/ingestion-orchestrator.js';

import {
  GitLabPayloadError,
  parseGitLabMergeRequestWebhook,
} from './gitlab-payload-parser.js';

const MAX_BODY_BYTES = 1_048_576;

/**
 * @typedef {object} WebhookServerOptions
 * @property {string} host
 * @property {number} port
 * @property {string} path
 * @property {string} [secret]
 * @property {import('../config/index.js').IngestionConfig} config
 * @property {import('../logger/index.js').Logger} log
 * @property {(gitlab: import('../config/index.js').GitLabConfig, trigger: NormalizedTrigger) => IngestionOrchestrator | Promise<IngestionOrchestrator>} buildOrchestrator
 */

/**
 * @typedef {object} RunningWebhookServer
 * @property {number} port
 * @property {string} host
 * @property {string} path
 * @property {() => Promise<void>} close
 */

/**
 * @param {WebhookServerOptions} options
 * @returns {Promise<RunningWebhookServer>}
 */
export async function startWebhookServer(options) {
  const log = options.log.child({ component: 'webhook' });

  const server = createServer((req, res) => {
    void handleRequest(req, res, options, log);
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.host);
  });

  const address = server.address();
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
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {WebhookServerOptions} options
 * @param {import('../logger/index.js').Logger} log
 */
async function handleRequest(req, res, options, log) {
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

  let raw;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Webhook rejected: failed to read body', { error: message });
    sendJson(res, 413, { error: 'body_too_large' });
    return;
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    log.warn('Webhook rejected: invalid JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

  let trigger;
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

/**
 * @param {WebhookServerOptions} options
 * @param {NormalizedTrigger} trigger
 * @param {import('../logger/index.js').Logger} log
 */
async function runIngestion(options, trigger, log) {
  const jobLog = log.child({
    projectId: trigger.projectId,
    projectName: trigger.projectName,
  });

  try {
    const gitlab = {
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
      code: err.code,
    });
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, unknown>} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

/** @param {string | string[] | undefined} value */
function headerValue(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk) => {
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