# RAG Ingestion Layer

A TypeScript ingestion pipeline that pulls source code and documentation from
GitLab repositories and turns them into structured `KnowledgeChunk`s ready to be
embedded and stored in a vector database.

This package covers **phases 1–8** of the original task: repository
adapters, file discovery and classification, markdown & code parsing,
documentation and code chunking, the canonical `KnowledgeChunk` model,
revision-aware ingestion state, and an orchestrator that supports both
**full** and **incremental** ingestion.

Security scanning, embedding, and the vector store are intentionally out of
scope — the architecture leaves clean extension points for those phases.

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
| `GITLAB_PROJECT_ID`         | Yes      | URL-encoded project path (e.g. `group%2Fproject`).                       |
| `GITLAB_BRANCH`             | No       | Defaults to `develop`.                                                    |
| `INGESTION_MAX_FILE_SIZE_BYTES` | No   | Defaults to `2000000`. Files larger than this are ignored.              |
| `INGESTION_CHUNK_SIZE`      | No       | Reserved for future use (defaults to `1500`).                            |
| `INGESTION_CHUNK_OVERLAP`   | No       | Reserved for future use (defaults to `150`).                             |
| `INGESTION_STATE_FILE`      | No       | Defaults to `./.ingestion-state.json`.                                   |
| `LOG_LEVEL`                 | No       | `debug` \| `info` \| `warn` \| `error` \| `silent`. Defaults to `info`. |

The token is **never** logged or serialized to the state file. The logger
redacts any value whose key matches `token`, `authorization`, `password`,
`secret`, or `private[_-]?key`.

---

## CLI

```
npm run ingestion [-- --incremental] [-- --full] [-- --branch=<name>]
```

| Flag                | Effect                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `--incremental`     | Force incremental ingestion (requires prior state).                     |
| `--full`            | Force a full ingestion even when state already exists.                  |
| `--branch=<name>`   | Override the configured branch for this run.                            |
| `--help`, `-h`      | Print the help text.                                                    |

Exit code: `0` on success, `1` on fatal errors, `2` when at least one file
failed to process.

---

## Repository layout

```
src/
├── cli/                       # CLI entry point (`npm run ingestion`)
├── chunkers/                  # Documentation + code chunkers
├── config/                    # Zod-validated env loader
├── discovery/                 # File discovery + classifier
├── errors/                    # Typed error hierarchy
├── knowledge/                 # KnowledgeChunk model + Context Injector
├── logger/                    # Pino-free logger with sensitive-key redaction
├── orchestrator/              # Ingestion orchestrator (full + incremental)
├── parsers/
│   ├── code/                  # Tree-sitter TS/JS parser
│   └── documentation/         # Markdown parser (unified + remark-parse)
├── repository/                # RepositoryAdapter interface + GitLab impl
├── security/                  # Placeholder for SecurityScanner
└── state/                     # IngestionState + JSON file-backed store
tests/                         # Vitest suite (175 tests)
```

---

## Tests

```bash
npm test                 # run once
npm run test:watch       # watch mode
```

- 175 unit tests across parsers, chunkers, classifier, GitLab adapter
  (with mocked fetch), context injector, ingestion state, and end-to-end
  orchestrator scenarios (full / incremental / skipped / delete).
- All tests are hermetic — no network calls.

---

## Output: `KnowledgeChunk`

```ts
interface KnowledgeChunk {
  id: string;                                  // deterministic sha1
  type: 'code' | 'documentation' | 'config' | 'delete';
  content: string;                             // actual source / docs
  metadata: {
    repositoryId: string;
    repository: string;                        // derived short name
    service: string;                           // derived service name
    branch: string;
    commit: string;
    version?: string;
    file: string;
    language?: string;
    symbol?: string;
    symbolType?: string;
    section?: string[];                        // heading hierarchy (docs)
    startLine?: number;
    endLine?: number;
    changeType?: 'added' | 'modified' | 'deleted';
    split?: boolean;
  };
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
  safe for a single process. A SQLite- or Postgres-backed implementation
  can be added behind the same `IngestionStateStore` interface.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for a deeper description of the
modules, the data flow, and the extension points.
