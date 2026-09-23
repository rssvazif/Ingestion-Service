# Task: Implement RAG Code & Documentation Ingestion Pipeline — Phase 1 to 8

You are implementing the first complete version of an ingestion pipeline for a RAG system.

The goal is to ingest source code and documentation from GitLab repositories and transform them into structured knowledge chunks that will later be embedded and stored in a vector database.

IMPORTANT:
- Implement phases 1 through 8 completely.
- DO NOT implement Security Scan in this task.
- DO NOT implement Embedding.
- DO NOT implement Vector DB / Chroma integration.
- The output of Phase 8 must be a clean, well-defined KnowledgeChunk model that is ready for the future embedding phase.
- Do not stop at interfaces or placeholders unless an external dependency genuinely cannot be implemented.
- Follow the existing project's architecture, conventions, package manager, TypeScript configuration, linting, testing style, and directory structure.
- Before implementing anything, inspect the repository thoroughly.

==================================================
0. FIRST: UNDERSTAND THE EXISTING PROJECT
==================================================

Before writing code:

1. Read the root README.md if it exists.
2. Inspect the project structure.
3. Inspect package.json / package manager configuration.
4. Inspect TypeScript configuration.
5. Inspect existing source code and architectural conventions.
6. Inspect existing tests and testing conventions.
7. Inspect configuration/environment handling.
8. Identify reusable utilities, HTTP clients, logging, error handling, filesystem utilities, and configuration modules.
9. Do NOT introduce a new framework or architecture if the repository already has an established pattern.
10. Reuse existing project abstractions whenever appropriate.

Do not start implementation until you understand the current repository structure.

==================================================
1. ENVIRONMENT CONFIGURATION
==================================================

Create/update an environment configuration for GitLab access.

The implementation MUST NOT hard-code GitLab hostnames, tokens, project IDs, or credentials.

Create an environment file/template such as:

.env.example

with at least:

GITLAB_HOST=https://gitlab.partcorp.ir
GITLAB_TOKEN=
GITLAB_PROJECT_ID=infrastructure%2Fservices%2Fpublic%2Fservices%2FpartServiceFileStorage
GITLAB_BRANCH=develop

Use the project's existing configuration mechanism if one already exists.

IMPORTANT:
- Never commit a real GitLab token.
- If a .env file is created for local development, make sure it is ignored by git.
- .env.example must contain placeholders only.
- GitLab token must be read from environment/configuration.
- GitLab host must be configurable.
- GitLab project ID/path must be configurable.
- Branch must be configurable.

The user will fill the actual GITLAB_TOKEN before running the ingestion.

Use a configuration object/service instead of reading process.env throughout the codebase.

For example:

GitLabConfig:
- host
- token
- projectId
- branch

Validate required configuration at application startup or when the GitLab adapter is initialized.

If GITLAB_TOKEN is missing, fail with a clear configuration error.

==================================================
2. TARGET ARCHITECTURE
==================================================

Implement the following logical architecture:

GitLab
  |
  v
Repository Adapter
  |
  v
File Discovery
  |
  v
File Classification
  |
  +----------------------+
  |                      |
  v                      v
Documentation           Code
  |                      |
  v                      v
Markdown Parser       Code Parser
  |                      |
  v                      v
Documentation         Code
Chunker               Chunker
  |                      |
  +----------+-----------+
             |
             v
      Context Injection
             |
             v
       KnowledgeChunk

Do not couple:
- GitLab API to parsers
- parsers to chunkers
- chunkers to embedding
- chunkers to Chroma

Each layer must have a clear responsibility.

==================================================
3. PHASE 1 — REPOSITORY ADAPTER
==================================================

Implement a repository abstraction.

Create an interface similar to:

RepositoryAdapter

with capabilities required by the ingestion workflow.

At minimum support:

1. Get repository/revision information.
2. Get the current revision for a branch.
3. List repository files.
4. Get file content.
5. Get changed files between two revisions.
6. Download the complete repository snapshot for first ingestion.

The exact interface should follow the project's conventions.

The implementation should provide:

GitLabRepositoryAdapter

The GitLab adapter must use GitLab APIs rather than embedding GitLab-specific logic into the ingestion pipeline.

Required conceptual operations:

getCurrentRevision()
listFiles()
getFile()
getChangedFiles()
downloadArchive()

For first/full ingestion:

Repository
  ->
Current Revision
  ->
Repository Archive
  ->
Extract Files

For incremental ingestion:

Previous Revision
  +
Target Revision
  ->
GitLab Compare API
  ->
Changed Files
  ->
Fetch required file contents

The adapter should support:
- URL-encoded GitLab project paths
- branch
- commit SHA
- authentication
- HTTP errors
- timeout
- clear error messages

Do not assume the repository is public.

The adapter must work with:

GITLAB_HOST=https://gitlab.partcorp.ir

and the configurable project:

infrastructure/services/public/services/partServiceFileStorage

Do not hard-code this repository in the implementation.

==================================================
4. PHASE 2 — FILE DISCOVERY AND CLASSIFICATION
==================================================

Implement a File Discovery layer.

Define a normalized file representation.

For example:

RepositoryFile:

{
  path,
  name,
  type,
  size?,
  hash?,
  commit?,
  language?
}

Then implement:

FileClassifier

Classification must be deterministic.

At minimum support:

PROCESS
IGNORE

And processing types:

CODE
DOCUMENTATION
CONFIG

Do NOT implement SENSITIVE/security classification in this task.

Example:

README.md
-> PROCESS / DOCUMENTATION

docs/authentication.md
-> PROCESS / DOCUMENTATION

src/user.service.ts
-> PROCESS / CODE

package.json
-> PROCESS / CONFIG

node_modules/...
-> IGNORE

.git/...
-> IGNORE

binary files
-> IGNORE

lock files
-> IGNORE when appropriate

The classifier should support:
- extension rules
- directory exclusion rules
- known documentation filenames
- known source-code extensions
- binary detection where practical
- configurable ignore patterns
- maximum file size policy

Avoid blindly processing every file.

Make the classification rules easy to extend.

The output should contain a reason for classification.

Example:

{
  "path": "node_modules/foo/index.js",
  "classification": "IGNORE",
  "reason": "ignored_directory"
}

==================================================
5. PHASE 3 — SECURITY SCAN
==================================================

DO NOT IMPLEMENT THIS PHASE.

Do not create fake security scanning.

Do not add secret detection logic.

Leave a clear extension point so a future SecurityScanner can be inserted before parsing/chunking.

The architecture should make it possible to add:

SecurityScanner
  ->
ALLOW / BLOCK / REDACT

later without changing the parsers.

==================================================
6. PHASE 4 — DOCUMENTATION PARSER
==================================================

Implement Markdown parsing.

Primary target:

Markdown files.

Use a proper Markdown AST parser.

Preferred technology if compatible with the project:

unified
remark-parse
MDAST

Do not use an LLM for Markdown parsing.

The parser should transform raw Markdown into a structured representation.

It must preserve enough information for:
- headings
- heading hierarchy
- paragraphs
- code blocks
- lists
- tables where supported
- links
- source positions / line numbers

Create a project-level abstraction such as:

DocumentationParser

with:

parse(content, metadata)

The parser must not know about:
- GitLab
- embeddings
- Chroma

Its only responsibility is converting Markdown into structured document data.

==================================================
7. PHASE 5 — DOCUMENTATION CHUNKING
==================================================

Implement a structural Markdown chunker.

Do NOT start with naive character splitting.

Use document structure.

Example:

# Authentication

## Login

content...

## Refresh Token

content...

should produce logical chunks such as:

Authentication > Login
Authentication > Refresh Token

Each documentation chunk should preserve:

- heading hierarchy
- section title
- source file
- start line
- end line
- content

If a section becomes too large, implement a secondary token/size-based splitting strategy.

Do not arbitrarily destroy semantic boundaries.

Create:

DocumentationChunker

Input:
ParsedDocumentation

Output:
DocumentationChunk[]

The chunker must be deterministic.

==================================================
8. PHASE 6 — CODE PARSER
==================================================

Implement source-code parsing using Tree-sitter.

The initial implementation should focus on the languages actually used by this repository.

First inspect the repository and determine the actual languages used.

At minimum, support TypeScript/JavaScript if present.

Do not implement dozens of languages unnecessarily.

Create:

CodeParser

The parser must produce a structured AST representation.

It must preserve:

- node type
- start line
- end line
- start column
- end column
- source content
- child relationships where useful

Do not embed the code at this stage.

Do not chunk the code inside the parser.

Parser responsibility:

Source Code
  ->
AST

==================================================
9. PHASE 7 — CODE CHUNKING
==================================================

Implement AST-based code chunking.

The objective is to create semantically meaningful chunks rather than arbitrary line/character chunks.

Extract constructs such as applicable to the language:

- classes
- methods
- functions
- interfaces
- type aliases
- enums
- exported declarations
- relevant top-level declarations

Use Tree-sitter queries where appropriate.

For TypeScript/JavaScript, support constructs such as:

class_declaration
method_definition
function_declaration
interface_declaration
type_alias_declaration
enum_declaration
lexical_declaration
export declarations where relevant

The exact AST node types must be verified against the installed Tree-sitter grammar rather than guessed.

Each code chunk must preserve:

- repository
- file
- symbol
- symbol type
- language
- start line
- end line
- source code content
- commit/revision metadata

IMPORTANT:

The chunk's `content` MUST contain the actual source code string represented by the chunk.

Example:

{
  "type": "code",
  "symbol": "UserService.addUser",
  "symbolType": "method",
  "startLine": 42,
  "endLine": 81,
  "content": "async addUser(...) { ... }"
}

This content will later be passed directly into the RAG context after retrieval.

Do not design the system such that the LLM must fetch the source code from GitLab after retrieval.

GitLab remains the source of truth for ingestion, but retrieved chunks should already contain the source content.

==================================================
10. PHASE 8 — CONTEXT INJECTION / METADATA
==================================================

Create a canonical KnowledgeChunk model.

Code and documentation chunks must eventually conform to the same model.

For example:

KnowledgeChunk:

{
  id,
  type,
  content,
  metadata
}

Metadata should include, where applicable:

repositoryId
repository
service
branch
commit
version
file
language
symbol
symbolType
section
startLine
endLine

Do not duplicate metadata unnecessarily.

The exact schema should follow existing project conventions where possible.

The important requirement is that every chunk is self-describing enough for retrieval.

Example code chunk:

{
  "id": "...",
  "type": "code",
  "content": "...actual source code...",
  "metadata": {
    "repository": "partServiceFileStorage",
    "service": "file-storage",
    "branch": "develop",
    "commit": "a82c9d1",
    "file": "src/services/file.service.ts",
    "language": "typescript",
    "symbol": "FileService.upload",
    "symbolType": "method",
    "startLine": 42,
    "endLine": 81
  }
}

Example documentation chunk:

{
  "id": "...",
  "type": "documentation",
  "content": "...",
  "metadata": {
    "repository": "partServiceFileStorage",
    "service": "file-storage",
    "branch": "develop",
    "commit": "a82c9d1",
    "file": "docs/upload.md",
    "section": "Upload File",
    "startLine": 10,
    "endLine": 40
  }
}

The output of Phase 8 must be:

KnowledgeChunk[]

This is the final output of this task.

==================================================
11. INGESTION ORCHESTRATOR
==================================================

After implementing the individual phases, connect them into an executable ingestion pipeline.

The orchestration must support:

A. Full ingestion

When a repository has not been ingested before:

Repository
  ->
Current Revision
  ->
Download Full Snapshot
  ->
Discover Files
  ->
Classify
  ->
Parse
  ->
Chunk
  ->
Context Injection
  ->
KnowledgeChunk[]

B. Incremental ingestion

When a previous revision exists:

Repository
  ->
Previous Revision
  ->
Current Revision
  ->
Git Diff / Compare
  ->
Changed Files
  ->
Process only required files
  ->
KnowledgeChunk[]

Handle:

ADDED
MODIFIED
DELETED

For deleted files, the pipeline must expose enough information for the future vector-store layer to remove corresponding chunks.

Do NOT implement the vector deletion yet.

==================================================
12. REVISION MODEL
==================================================

Implement Revision explicitly.

A revision should contain at least:

{
  repositoryId,
  commit,
  branch,
  version?
}

Do not confuse:
- repository
- branch
- revision
- file
- chunk

The ingestion pipeline must always know which revision produced a chunk.

Every KnowledgeChunk must be traceable to:

repository
+
branch
+
commit

==================================================
13. INGESTION STATE
==================================================

If the repository already contains an ingestion-state/database architecture, reuse it.

If it does not, implement a minimal state abstraction that allows the pipeline to distinguish:

FIRST INGESTION

from:

INCREMENTAL INGESTION

The state must be able to answer:

1. Has this repository been ingested?
2. What is the latest successfully ingested revision?
3. What ingestion job is currently processing it?

Do not implement a complete production job scheduler unless the project already requires it.

Keep the state abstraction replaceable.

==================================================
14. TESTING
==================================================

Tests are REQUIRED.

Do not consider a phase complete just because the code compiles.

At minimum create tests for:

Repository Adapter:
- current revision
- repository file listing
- file retrieval
- changed files
- authentication/configuration errors

File Classification:
- TypeScript
- JavaScript
- Markdown
- README
- ignored directories
- binary files
- unsupported files

Markdown Parser:
- headings
- nested headings
- paragraphs
- code blocks
- line positions

Markdown Chunker:
- section boundaries
- heading hierarchy
- large-section splitting

Code Parser:
- class
- method
- function
- interface
- type alias
- line positions

Code Chunker:
- class extraction
- method extraction
- function extraction
- symbol names
- source content preservation

Context Injection:
- code metadata
- documentation metadata
- commit/revision propagation

End-to-end ingestion:
- full repository ingestion
- incremental ingestion
- added file
- modified file
- deleted file

Use the existing test framework in the project.

==================================================
15. LOCAL TEST WITH THE REAL GITLAB REPOSITORY
==================================================

After implementation, create a simple executable test/example/CLI according to the existing project conventions.

It should allow running something conceptually like:

npm run ingestion

or the project's appropriate command.

The command should:

1. Read GitLab configuration from .env.
2. Connect to GitLab.
3. Resolve the configured repository.
4. Resolve the configured branch.
5. Determine the current revision.
6. Run full ingestion if no previous state exists.
7. Otherwise run incremental ingestion.
8. Print useful ingestion statistics.

Example output:

Repository:
partServiceFileStorage

Branch:
develop

Revision:
a82c9d1

Files discovered:
143

Files ignored:
72

Code files:
51

Documentation files:
20

Code chunks:
312

Documentation chunks:
48

Total Knowledge Chunks:
360

Do not print the GitLab token.

==================================================
16. ERROR HANDLING
==================================================

Implement meaningful errors.

At minimum handle:

- missing GITLAB_HOST
- missing GITLAB_TOKEN
- invalid GitLab credentials
- repository not found
- branch not found
- commit not found
- GitLab rate limiting
- GitLab API errors
- empty repository
- unsupported file type
- parser errors
- malformed Markdown
- Tree-sitter parsing failures

A parsing failure for one file should not necessarily terminate the entire repository ingestion.

Prefer per-file error reporting and continue processing where safe.

The final result should expose:

processed
ignored
failed
chunks

and file-level failures.

==================================================
17. OBSERVABILITY
==================================================

Use the project's existing logger.

Log at appropriate levels:

INFO:
- ingestion started
- repository
- revision
- full/incremental mode
- ingestion completed

DEBUG:
- file classification
- parser decisions
- chunk counts

WARN:
- unsupported file
- parser failure for one file
- skipped file

ERROR:
- GitLab failure
- fatal ingestion failure

Never log:
- GitLab token
- credentials
- secrets

==================================================
18. PERFORMANCE
==================================================

Do not over-engineer.

But avoid obviously inefficient implementations.

For full ingestion:
- do not make one GitLab API request per file if an archive can be used efficiently.

For incremental ingestion:
- first get changed files.
- fetch content only for added/modified files.
- do not fetch deleted files.

Avoid loading unnecessarily large files into memory.

Use streaming/extraction where practical.

Do not introduce a queue system unless required by the existing project.

==================================================
19. DOCUMENTATION
==================================================

Create/update documentation explaining:

1. Architecture
2. Repository Adapter
3. File Discovery
4. Classification
5. Markdown Parsing
6. Documentation Chunking
7. Tree-sitter Code Parsing
8. Code Chunking
9. KnowledgeChunk model
10. Full ingestion
11. Incremental ingestion
12. Environment variables
13. How to run locally
14. How to run tests
15. Current limitations
16. Future phases:
   - Security Scanner
   - Embedding
   - Vector Store

Include an architecture diagram if the project documentation convention supports it.

==================================================
20. IMPORTANT DESIGN CONSTRAINTS
==================================================

DO NOT implement:

- Security Scanner
- Embedding
- Chroma
- Vector database
- RAG retrieval
- LLM integration
- MCP integration

Those belong to later phases.

DO implement:

- Repository Adapter
- GitLab integration
- Full repository ingestion
- Incremental file discovery
- File classification
- Markdown parsing
- Documentation chunking
- Tree-sitter parsing
- Code chunking
- Metadata/context injection
- KnowledgeChunk model
- tests
- local execution
- configuration
- documentation

==================================================
21. IMPLEMENTATION STRATEGY
==================================================

Do not implement everything blindly in one pass.

Work incrementally:

STEP 1:
Inspect the repository and existing architecture.

STEP 2:
Create/update .env.example and configuration.

STEP 3:
Implement Repository Adapter.

STEP 4:
Write and pass Repository Adapter tests.

STEP 5:
Implement File Discovery and Classification.

STEP 6:
Write and pass classification tests.

STEP 7:
Implement Markdown Parser.

STEP 8:
Implement Documentation Chunker.

STEP 9:
Write documentation tests.

STEP 10:
Implement Tree-sitter Code Parser.

STEP 11:
Implement Code Chunker.

STEP 12:
Write code parsing/chunking tests.

STEP 13:
Implement KnowledgeChunk and Context Injection.

STEP 14:
Connect all phases through the ingestion orchestrator.

STEP 15:
Implement full and incremental ingestion behavior.

STEP 16:
Run the complete test suite.

STEP 17:
Run the real GitLab repository ingestion using the configured .env.

STEP 18:
Fix all errors found during real execution.

STEP 19:
Review the implementation for:
- unnecessary coupling
- duplicated code
- missing error handling
- incorrect metadata
- incorrect revision propagation
- incorrect incremental behavior
- inefficient GitLab API usage

STEP 20:
Update documentation.

==================================================
22. FINAL ACCEPTANCE CRITERIA
==================================================

The implementation is NOT COMPLETE until all of the following are true:

[ ] Project structure has been inspected and existing conventions are followed.

[ ] GitLab host is configurable.

[ ] GitLab token is configurable through environment variables.

[ ] No credentials are hard-coded.

[ ] .env is ignored by git.

[ ] .env.example exists.

[ ] Repository Adapter is implemented.

[ ] Full repository download works.

[ ] Current revision resolution works.

[ ] Incremental compare works.

[ ] Changed files are detected.

[ ] Added files are processed.

[ ] Modified files are processed.

[ ] Deleted files are identified.

[ ] File classification works.

[ ] Markdown parser works.

[ ] Documentation chunker works.

[ ] Tree-sitter parser works for the repository's actual supported languages.

[ ] Code chunker produces semantic chunks.

[ ] Code chunk content contains the actual source code.

[ ] Documentation chunk content contains the actual documentation.

[ ] Revision metadata propagates into every chunk.

[ ] Repository metadata propagates into every chunk.

[ ] KnowledgeChunk is the unified output.

[ ] Full ingestion works.

[ ] Incremental ingestion works.

[ ] Tests pass.

[ ] Real ingestion against the configured GitLab repository succeeds.

[ ] Documentation is updated.

==================================================
23. FINAL REPORT
==================================================

At the end, provide a concise implementation report containing:

1. Files created
2. Files modified
3. Dependencies added
4. Architecture implemented
5. Supported languages
6. Full ingestion behavior
7. Incremental ingestion behavior
8. Number of tests
9. Test result
10. Real GitLab ingestion result
11. Known limitations
12. Recommended next phase

Do not claim a feature is implemented unless it actually works.

If a decision cannot be made from the existing project, inspect the code first and then choose the simplest implementation consistent with the existing architecture.