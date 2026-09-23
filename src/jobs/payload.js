/**
 * HTTP header carrying a unique webhook delivery id supplied by the caller.
 * Retries of the same logical event from the same delivery carry a new id (or
 * none), so it is the strongest per-delivery deduplication key available from
 * the wire without extending the normalized trigger.
 */
export const INGESTION_EVENT_UUID_HEADER = 'ingestion-event-uuid';
export const INGESTION_DELIVERY_UUID_HEADER = 'ingestion-delivery-uuid';

/** @typedef {import('../webhook/types.js').NormalizedTrigger} NormalizedTrigger */

/**
 * Build the serializable BullMQ job payload from a normalized webhook trigger
 * and request context. Only data needed to re-run ingestion independently of
 * the HTTP request lifecycle is included - never request/response objects.
 *
 * @param {NormalizedTrigger} trigger
 * @param {{ eventId?: string }} [requestContext]
 * @returns {{ projectId: string, projectName: string | null, eventId?: string }}
 */
export function buildJobPayload(trigger, requestContext) {
  const payload = {
    projectId: trigger.projectId,
    projectName: trigger.projectName ?? null,
  };
  if (requestContext?.eventId) {
    payload.eventId = requestContext.eventId;
  }
  return payload;
}

/**
 * Derive a deterministic BullMQ job id for deduplication.
 *
 * When the caller supplies a delivery UUID the delivery maps to exactly one
 * job: enqueueing the same delivery twice (e.g. a doubled HTTP request) returns
 * the existing job instead of creating a duplicate. BullMQ enforces this
 * natively via the `jobId` option - no custom dedup storage is needed.
 *
 * When no UUID is present there is no reliable event identity available (the
 * normalized trigger only carries project id/name), so no deterministic
 * id is produced. In that case exact-once delivery cannot be guaranteed; the
 * ingestion pipeline's own per-branch revision tracking still prevents
 * redundant re-ingestion of an unchanged repository.
 *
 * @param {{ eventId?: string }} [payload]
 * @returns {string | undefined}
 */
export function deriveJobId(payload) {
  if (!payload?.eventId) return undefined;
  return `gitlab-${payload.eventId}`;
}

/**
 * Resolve the webhook delivery id from the incoming request headers.
 *
 * @param {{ [k: string]: string | string[] | undefined }} headers
 * @returns {string | undefined}
 */
export function eventIdFromHeaders(headers) {
  const value =
    headers[INGESTION_EVENT_UUID_HEADER] ?? headers[INGESTION_DELIVERY_UUID_HEADER];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}