import { createServer } from 'node:http';

import {
  INGESTION_JOB_NAME,
  buildEnqueueOptions,
  buildJobPayload,
  deriveJobId,
  eventIdFromHeaders,
} from '../jobs/index.js';

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
 * @property {import('bullmq').Queue} queue
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
    const provided = headerValue(headers['ingestion-token']);
    if (provided !== options.secret) {
      log.warn('Webhook rejected: invalid or missing ingestion-token');
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
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

  const eventId = eventIdFromHeaders(headers);
  const payload = buildJobPayload(trigger, { eventId });
  const opts = buildEnqueueOptions(options.config, deriveJobId(payload));

  let job;
  try {
    job = await options.queue.add(INGESTION_JOB_NAME, payload, opts);
  } catch (err) {
    log.error('Webhook accepted but failed to enqueue ingestion job', {
      projectId: trigger.projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(res, 503, { error: 'queue_unavailable' });
    return;
  }

  const jobId = job?.id ?? opts.jobId ?? null;

  log.info('Webhook accepted; ingestion job enqueued', {
    projectId: trigger.projectId,
    projectName: trigger.projectName ?? null,
    jobId,
  });

  sendJson(res, 202, {
    status: 'accepted',
    projectId: trigger.projectId,
    projectName: trigger.projectName ?? null,
  });
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