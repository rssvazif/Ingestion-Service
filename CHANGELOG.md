# Changelog

All notable changes to this repository are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are versioned and grouped by change type (`feat` / `refactor` / `fix`).

## [Unreleased]

### fix

- change runner server, cli and woker and add postman collection 

### feat

- Chunk JSON export for the BullMQ worker: when `INGESTION_OUTPUT_DIR` is
  set, the worker writes each job's `KnowledgeChunk[]` to a pretty-printed
  JSON file (one `<jobId>.json` per job, or a single `INGESTION_OUTPUT_FILE`).
  The write is atomic (temp file + rename) and skipped runs do not overwrite
  an existing export. The shared writer (`src/output/chunk-output.js`) is
  also used by the CLI's `--output` flag.

### refactor

- Webhook receiver no longer checks the `X-Gitlab-Event` header: any POST to
  the configured path with a valid `object_kind: "merge_request"` payload is
  accepted. The shared-secret header was renamed from `X-Gitlab-Token` to
  `ingestion-token` (still optional, validated only when
  `INGESTION_WEBHOOK_SECRET` is set), and the dedup headers were renamed from
  `X-Gitlab-Event-UUID` / `X-Gitlab-Delivery-UUID` to `ingestion-event-uuid` /
  `ingestion-delivery-uuid`.

## [0.1.0] - 2026-09-23

First release of the RAG ingestion layer. The project grew from an initial
ingestion pipeline (Aug 2026) through webhook-driven ingestion with a BullMQ
queue and dedicated worker, and a TypeScript-to-JavaScript migration.

### feat

- RAG ingestion layer foundation: config loader, logger with secret
  redaction, typed errors, GitLab repository adapter, file discovery and
  classification, Markdown parser, documentation chunker, tree-sitter
  TS/JS code parser, code chunker, and the `KnowledgeChunk` model with
  context injector.
- First ingestion pipeline release: ingestion state + revision tracking,
  orchestrator with full and incremental modes, CLI entry
  (`npm run ingestion`), README and architecture documentation, and the
  Vitest suite.
- Parent/child chunking logic and chunk fixes.
- Webhook-driven ingestion server with multi-project support:
  - New `src/webhook/` module: GitLab Merge Request payload parser, `node:http`
    receiver with optional `X-Gitlab-Token` shared secret, `GET /health`, and a
    `npm run ingestion:server` entry point.
  - Multi-project within one GitLab host: project id arrives per request
    (`--project-id` on the CLI, `object.project.id` on the webhook), so
    `GITLAB_PROJECT_ID` / `GITLAB_BRANCH` were removed from env.
- BullMQ ingestion queue with a dedicated worker process:
  - New `src/jobs/` module: queue creation, worker, Redis connection options,
    job payload/`jobId` derivation, and retryable-error classification.
  - The webhook receiver enqueues a job and returns `202` immediately instead
    of running the pipeline inline; a separate worker
    (`npm run ingestion:worker`) processes jobs with bounded concurrency,
    exponential backoff + jitter, job retention limits, and graceful
    `SIGINT`/`SIGTERM` shutdown.
  - Deterministic `jobId` from `X-Gitlab-Event-UUID` deduplicates re-delivered
    events at the queue level.
  - New env vars: `REDIS_URL`, `INGESTION_QUEUE_NAME`,
    `INGESTION_WORKER_CONCURRENCY`, `INGESTION_JOB_ATTEMPTS`,
    `INGESTION_JOB_BACKOFF_DELAY`, `INGESTION_JOB_BACKOFF_JITTER`,
    `INGESTION_JOB_REMOVE_ON_COMPLETE`, `INGESTION_JOB_REMOVE_ON_FAIL`.
- `REDIS_DB` environment variable (default `0`) selecting the Redis logical
  database (`0..15`) for all BullMQ queue/worker connections; documented in
  `.env.example`, the README environment table, and the `ingestion:server` /
  `ingestion:worker` help output.

### refactor

- Webhook trigger payload simplified to `{object_kind, project}`: only
  `object_kind: "merge_request"` and `project.id` (optional `project.name`)
  are required; `object_attributes` and the action whitelist are dropped and
  extra GitLab fields are ignored. The orchestrator resolves the project's
  default branch via the GitLab API.
- Stack migrated from TypeScript to plain ESM JavaScript with JSDoc typedefs:
  `tsc`/`tsx`/`@types/*` removed, CLI and server run directly under `node`;
  all tests converted.
- Repository layout flattened: `src/`, `tests/`, and top-level configs moved
  from `ingestionLayer/` to the repository root; project docs relocated to
  `documents/`.

### fix

- The webhook `202 Accepted` response no longer includes `jobId`; the job id
  is only written to the server logs.