# RAG Ingestion Layer

A JavaScript (ESM) ingestion pipeline that pulls source code and documentation
from GitLab repositories and turns them into structured `KnowledgeChunk`s ready
to be embedded and stored in a vector database.

This package covers **phases 1–8** of the original task: repository
adapters, file discovery and classification, markdown & code parsing,
documentation and code chunking, the canonical `KnowledgeChunk` model,
revision-aware ingestion state, and an orchestrator that supports both
**full** and **incremental** ingestion.

Security scanning, embedding, and the vector store are intentionally out of
scope — the architecture leaves clean extension points for those phases.

Type information is documented inline via JSDoc (`@typedef`, `@param`,
`@returns`); no separate build step is required.

---

## Features

- **GitLab Repository Adapter** with retries, 401/403/404/429 handling,
  archive download (`tar.gz`) and incremental compare via the GitLab API.
- **File Discovery & Classification** that ignores build outputs, binary
  files, lock files, and over-sized files, and dispatches the rest as
  `CODE`, `DOCUMENTATION`, or `CONFIG`.
- **Markdown parser** built on `unified` + `remark-parse` (no LLMs) with
  heading hierarchy, code blocks, links, and full MDAST preservation.
- **Documentation chunker** that splits on heading structure, preserves the
  heading hierarchy, and falls back to size-based splitting with overlap.
- **Tree-sitter code parser** for TypeScript / JavaScript (TS/TSX/JS/JSX/MJS/CJS)
  producing typed AST nodes with positions and names.
- **Code chunker** producing one chunk per class / interface / type alias /
  enum / function / method / lexical declaration.
- **Canonical `KnowledgeChunk` model** with deterministic ids and full
  revision metadata (`repositoryId`, `repository`, `service`, `branch`,
  `commit`, `version`, `file`, `language`, `symbol`, `symbolType`,
  `section`, `startLine`, `endLine`, `changeType`, `split`).
- **Replaceable ingestion state** (file-backed JSON or in-memory) that
  records the latest successful revision per branch and the history of
  ingestion jobs.
- **Ingestion orchestrator** that wires every layer together and supports
  full ingestion, incremental ingestion (via GitLab compare), and a
  smart `run()` that picks the right mode automatically.
- **Chunk JSON export** — the BullMQ worker can persist each job's
  `KnowledgeChunk[]` to a pretty-printed JSON file (`INGESTION_OUTPUT_DIR`),
  reusing the same atomic writer as the CLI's `--output` flag.
- **BullMQ job queue** (Redis-backed) that decouples the GitLab webhook HTTP
  request from the ingestion pipeline: the webhook enqueues a job and returns
  `202 Accepted` immediately, and a separate worker process runs the pipeline
  with bounded concurrency, retries with exponential backoff, and retention
  policies for completed/failed jobs.
- **CLI entry point** under `npm run ingestion` / `npm run ingestion:incremental`.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure GitLab access
cp .env.example .env
# edit .env and fill GITLAB_TOKEN

# 3. Run the tests
npm test

# 4. Run a full ingestion against the configured repository
npm run ingestion

# 5. Run an incremental ingestion
npm run ingestion:incremental
```

Sample output:

```
Repository:
  partServiceFileStorage (infrastructure%2Fservices%2Fpublic%2Fservices%2FpartServiceFileStorage)
Branch:
  develop
Revision:
  08c2c33347c26221ea5fcc0c2ca7e95cc9daf04f
Mode:
  full

Stats:
  Files discovered:   153
  Files ignored:      15
  Files processed:    138
  Files failed:       0
  Code chunks:        983
  Documentation:      535
  Config chunks:      3
  Delete chunks:      0
  Total chunks:       1521
  Duration:           1585 ms
```

---

## Environment variables

| Variable                    | Required | Description                                                              |
| --------------------------- | -------- | ------------------------------------------------------------------------ |
| `GITLAB_HOST`               | Yes      | e.g. `https://gitlab.partcorp.ir`                                        |
| `GITLAB_TOKEN`              | Yes      | Private token (read scope). **Never commit this.**                       |
| `INGESTION_MAX_FILE_SIZE_BYTES` | No   | Defaults to `2000000`. Files larger than this are ignored.              |
| `INGESTION_CHUNK_SIZE`      | No       | Reserved for future use (defaults to `1500`).                            |
| `INGESTION_CHUNK_OVERLAP`   | No       | Reserved for future use (defaults to `150`).                             |
| `INGESTION_STATE_FILE`      | No       | Defaults to `./.ingestion-state.json`.                                   |
| `INGESTION_OUTPUT_DIR`      | No       | When set, the worker persists each job's `KnowledgeChunk[]` as pretty-printed JSON into this directory (one `<jobId>.json` per job). Disabled unless set. |
| `INGESTION_OUTPUT_FILE`     | No       | Optional fixed file name used for every job inside `INGESTION_OUTPUT_DIR`. Defaults to per-job `<jobId>.json`. |
| `LOG_LEVEL`                 | No       | `debug` \| `info` \| `warn` \| `error` \| `silent`. Defaults to `info`. |
| `INGESTION_WEBHOOK_PORT`    | No       | HTTP port for the webhook receiver (defaults to `3000`).              |
| `INGESTION_WEBHOOK_PATH`    | No       | URL path the receiver listens on (defaults to `/ingest`).              |
| `INGESTION_WEBHOOK_SECRET`  | No       | When set, validates the `ingestion-token` header on every request.     |
| `REDIS_URL`                 | No       | Redis connection string for the BullMQ queue (defaults to `redis://127.0.0.1:6379`). |
| `REDIS_DB`                  | No       | Redis logical database index (`0..15`) for the queue keys (defaults to `0`).  |
| `INGESTION_QUEUE_NAME`      | No       | Queue name (defaults to `ingestion`).                                 |
| `INGESTION_WORKER_CONCURRENCY` | No    | Jobs processed concurrently per worker process (defaults to `3`).     |
| `INGESTION_JOB_ATTEMPTS`    | No       | Max processing attempts per job before it is marked failed (defaults to `5`). |
| `INGESTION_JOB_BACKOFF_DELAY` | No     | Exponential backoff base delay in ms (defaults to `5000`).             |
| `INGESTION_JOB_BACKOFF_JITTER` | No    | Backoff jitter `0..1` to spread retry bursts (defaults to `0.2`).      |
| `INGESTION_JOB_REMOVE_ON_COMPLETE` | No | Completed jobs kept in Redis (defaults to `1000`).                  |
| `INGESTION_JOB_REMOVE_ON_FAIL` | No     | Failed jobs kept in Redis (defaults to `5000`).                      |

The token is **never** logged or serialized to the state file. The logger
redacts any value whose key matches `token`, `authorization`, `password`,
`secret`, or `private[_-]?key`.

---

## CLI

```
npm run ingestion -- --project-id=<id> [-- --incremental] [-- --full] [-- --branch=<name>]
```

| Flag                  | Effect                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| `--project-id=<id>`   | Required. Numeric project id or URL-encoded path (`group%2Fproject`).   |
| `--branch=<name>`     | Branch to ingest. If omitted, the project's default branch is resolved via the GitLab API. |
| `--incremental`       | Force incremental ingestion (requires prior state).                     |
| `--full`              | Force a full ingestion even when state already exists.                  |
| `--help`, `-h`        | Print the help text.                                                    |

Exit code: `0` on success, `1` on fatal errors, `2` when at least one file
failed to process.

---

## Webhook receiver & worker

```bash
# Process A: webhook receiver (enqueues jobs)
npm run ingestion:server

# Process B (usually separate): job worker (runs the ingestion pipeline)
npm run ingestion:worker
```

`npm run ingestion:server` boots a Node `http` server that listens for GitLab
Merge Request webhooks. For each accepted event it **enqueues a BullMQ job**
into Redis and returns `202 Accepted` immediately - it never waits for the
ingestion pipeline. A worker process (`npm run ingestion:worker`) pulls jobs
from the queue and runs the existing ingestion pipeline with bounded
concurrency (`INGESTION_WORKER_CONCURRENCY`, default `3`).

| Header                 | Required | Purpose                                                                     |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `ingestion-token`         | If secret configured | Shared secret (`INGESTION_WEBHOOK_SECRET`).                        |
| `ingestion-event-uuid`    | No       | Caller-supplied delivery id. Used as the deterministic job id for deduplication. |

Accepted values: any payload with `object_kind: "merge_request"` and a
non-empty `project.id`. The job payload carries the parsed `projectId` /
`projectName`; the worker constructs a per-job `GitLabConfig{host, token,
projectId}` from the environment and the payload, then runs the orchestrator,
which resolves the project's default branch via the GitLab API and ingests the
current HEAD of that branch (no commit pinning).

### Job lifecycle

- **Retries** – transient failures (timeouts, GitLab 429, GitLab 5xx, archive
  download failures) are retried up to `INGESTION_JOB_ATTEMPTS` times with
  exponential backoff (`delay * 2^attempt`) and optional jitter.
- **Permanent failures** – auth/config/validation errors, 4xx GitLab responses,
  and parse errors are failed immediately without retries.
- **Failed jobs** remain in Redis (up to `INGESTION_JOB_REMOVE_ON_FAIL`, default
  `5000`) for investigation/reprocessing. Completed jobs are also bounded
  (`INGESTION_JOB_REMOVE_ON_COMPLETE`, default `1000`).
- **Deduplication** – when the caller supplies `ingestion-event-uuid`, the delivery id
  is used as the BullMQ job id, so re-delivering the same event does not create a
  duplicate job. When the header is absent, no event identity exists (the
  normalized payload only carries project id/name), so exact-once enqueue cannot
  be guaranteed; the pipeline's per-branch revision tracking still prevents
  redundant re-ingestion of an unchanged repository.
- **Graceful shutdown** – `SIGINT`/`SIGTERM` stop the worker from picking up new
  jobs, let running jobs finish, then close BullMQ/Redis connections.

### Triggering manually

Simulate a GitLab Merge Request webhook with `curl`. The server only
needs `object_kind` and `project.id`; the rest of GitLab's payload
(branch, action, MR metadata, ...) is ignored. The orchestrator resolves
the project's default branch via the GitLab API on its own.

```bash
curl -i -X POST http://localhost:3000/ingest \
  -H 'Content-Type: application/json' \
  -H 'ingestion-token: <your-shared-secret-if-configured>' \
  -d '{
    "object_kind": "merge_request",
    "project": {
      "id": 449,
      "name": "partServiceFileStorage"
    }
  }'
```

Expected response: `HTTP/1.1 202 Accepted` with a JSON body like:

```json
{
  "status": "accepted",
  "projectId": "449",
  "projectName": "partServiceFileStorage"
}
```

The `jobId` used for deduplication is intentionally **not** part of the
response; it is only written to the server logs.

The `202` means the job was enqueued, not that ingestion has completed. If the
queue cannot be reached the server returns `503 queue_unavailable`.

Any extra fields GitLab includes (e.g. `object_attributes`) are accepted
but ignored.

Health check:

```bash
curl -i http://localhost:3000/health
```

---

## Repository layout

```
src/
├── cli/                       # CLI entry point (`npm run ingestion`)
├── chunkers/                  # Documentation + code chunkers
├── config/                    # Zod-validated env loader
├── discovery/                 # File discovery + classifier
├── errors/                    # Typed error hierarchy
├── jobs/                      # BullMQ queue, worker, payload + retry classification
├── knowledge/                 # KnowledgeChunk model + Context Injector
├── logger/                    # Pino-free logger with sensitive-key redaction
├── orchestrator/              # Ingestion orchestrator (full + incremental)
├── output/                    # KnowledgeChunk JSON export (CLI --output + worker)
├── parsers/
│   ├── code/                  # Tree-sitter TS/JS parser
│   └── documentation/         # Markdown parser (unified + remark-parse)
├── repository/                # RepositoryAdapter interface + GitLab impl
├── security/                  # Placeholder for SecurityScanner
├── state/                     # IngestionState + JSON file-backed store
├── webhook/                   # Webhook HTTP server (enqueues BullMQ jobs)
└── worker/                    # Worker process entry (`npm run ingestion:worker`)
tests/                         # Vitest suite (.js)
```

---

## Tests

```bash
npm test                 # run once
npm run test:watch       # watch mode
```

- 217 tests across parsers, chunkers, classifier, GitLab adapter
  (with mocked fetch), context injector, ingestion state, end-to-end
  orchestrator scenarios (full / incremental / skipped / delete), webhook
  server, and queue/worker job lifecycle.
- All tests are hermetic where possible. Queue/worker integration tests run
  against an ephemeral `redis-server` and are skipped automatically when one
  is not available on the machine.

---

## Output: `KnowledgeChunk`

```js
// JSDoc typedef — the canonical chunk shape produced by the pipeline.
{
  id: string,                                 // deterministic sha1
  type: 'code' | 'documentation' | 'config' | 'delete',
  content: string,                            // actual source / docs
  metadata: {
    repositoryId: string,
    repository: string,                       // derived short name
    service: string,                          // derived service name
    branch: string,
    commit: string,
    version?: string,
    file: string,
    language?: string,
    symbol?: string,
    symbolType?: string,
    section?: string[],                       // heading hierarchy (docs)
    startLine?: number,
    endLine?: number,
    changeType?: 'added' | 'modified' | 'deleted',
    split?: boolean,
  },
}
```

The **content** field always carries the actual source code or
documentation text — the RAG retrieval layer can serve it directly without
re-fetching from GitLab.

---

## Limitations / future phases

- **Security scanner** — only the `SecurityScanner` interface is in place
  (`AllowAllSecurityScanner` is the default). Plug a real implementation
  into the orchestrator to enable BLOCK / REDACT decisions.
- **Embedding** — out of scope. The pipeline ends with `KnowledgeChunk[]`,
  ready to be embedded by a downstream service.
- **Vector store / Chroma** — out of scope. The orchestrator emits a
  `delete` chunk for every deleted file so a future vector layer can
  reconcile without re-walking the whole repository.
- **Security classification** — the classifier is intentionally limited to
  PROCESS / IGNORE + processing kind. SENSITIVE classification lives in the
  future Security Scanner phase.
- **Multi-process state coordination** — the file-backed state store is
  safe for a single writer. The worker is the only process that writes
  state, but running more than one worker process (e.g. PM2 cluster mode)
  against the same state file is not yet safe. A SQLite- or Postgres-backed
  implementation can be added behind the same `IngestionStateStore` interface.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for a deeper description of the
modules, the data flow, and the extension points.
