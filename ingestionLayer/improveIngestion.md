# Task: Improve the Existing Ingestion Pipeline — Filtering, Code Chunking and Hierarchical Documentation

We already have an implemented ingestion pipeline for a RAG system.

DO NOT rebuild the ingestion pipeline from scratch.

Your task is to inspect the current implementation and improve the existing pipeline in four specific areas:

1. File filtering / ignore rules
2. Code chunking quality
3. Parent–Child hierarchical documentation chunks
4. Documentation context propagation

IMPORTANT:
- Preserve the existing architecture unless there is a strong technical reason to change it.
- Reuse existing abstractions and utilities.
- Do not introduce LLM-based chunking or contextualization.
- Do not implement embeddings.
- Do not implement vector DB changes.
- Do not implement security scanning.
- Do not change the Repository Adapter unless required by the changes below.
- Do not remove existing useful functionality.
- Add/update tests for every behavior introduced or changed.

Before changing anything, inspect the existing implementation thoroughly.

==================================================
0. FIRST — INSPECT THE CURRENT IMPLEMENTATION
==================================================

Before writing code:

1. Read README.md.
2. Inspect the complete project structure.
3. Locate:
   - File Discovery
   - File Classification
   - Code Parser
   - Code Chunker
   - Markdown Parser
   - Documentation Chunker
   - KnowledgeChunk model
   - Ingestion Orchestrator
4. Read the current tests.
5. Identify the current chunk schemas.
6. Identify how metadata is currently propagated.
7. Identify how full and incremental ingestion currently work.
8. Determine which Markdown parser and Tree-sitter packages are currently installed.
9. Determine the actual supported programming languages.
10. Run the existing test suite before making changes.

Record the current behavior before modifying it.

Do not assume the current implementation matches previous design descriptions.
Inspect the actual code.

==================================================
1. FILE FILTERING / IGNORE RULES
==================================================

Problem:

The current ingestion pipeline is processing files that should not become knowledge chunks.

For example:

tests/
coverage/
test-results/
test-output/
snapshots/
build/
dist/
node_modules/

may contain generated artifacts, test results, snapshots, or build output.

These files create retrieval noise and unnecessary chunks.

--------------------------------------------------
1.1 Classification model
--------------------------------------------------

Preserve the distinction between:

PROCESS
IGNORE

and processing types such as:

CODE
DOCUMENTATION
CONFIG

Do not solve this problem inside parsers or chunkers.

The File Classification stage must decide whether a file should enter the processing pipeline.

--------------------------------------------------
1.2 Default ignore rules
--------------------------------------------------

Add appropriate ignore rules for generated/non-source artifacts.

At minimum evaluate:

.git/
node_modules/
coverage/
.nyc_output/
dist/
build/
tmp/
temp/
logs/
.cache/
test-results/
test-output/
tests/output/
tests/results/
snapshots/

Also inspect the actual repository being used for ingestion and identify additional generated directories that clearly should not be indexed.

IMPORTANT:

Do NOT automatically ignore the entire tests/ directory.

Test source code such as:

tests/payment.test.ts

may contain valuable behavioral information for RAG.

The desired behavior is:

tests/payment.test.ts
→ PROCESS / CODE

tests/output/result.json
→ IGNORE

coverage/...
→ IGNORE

snapshot/generated-output
→ IGNORE

Use path-based rules rather than simply ignoring all files under tests/.

--------------------------------------------------
1.3 File-level ignore reasons
--------------------------------------------------

Every ignored file should contain a reason.

Example:

{
  "path": "coverage/index.html",
  "classification": "IGNORE",
  "reason": "generated_directory"
}

or:

{
  "path": "tests/output/result.json",
  "classification": "IGNORE",
  "reason": "test_artifact"
}

Make the reason deterministic.

--------------------------------------------------
1.4 Configurability
--------------------------------------------------

If the current project already supports configurable ignore patterns, reuse that mechanism.

Otherwise introduce a clean configuration mechanism.

Avoid hard-coding dozens of unrelated rules directly inside the classifier.

Prefer something conceptually like:

DEFAULT_IGNORE_DIRECTORIES
DEFAULT_IGNORE_PATTERNS
DEFAULT_IGNORE_EXTENSIONS

The exact implementation should follow the existing project's conventions.

--------------------------------------------------
1.5 Tests
--------------------------------------------------

Add tests for:

PROCESS:
- src/service.ts
- tests/service.test.ts
- docs/example.md

IGNORE:
- node_modules/package/index.js
- coverage/lcov.info
- dist/index.js
- build/index.js
- tests/output/result.json
- tests/results/result.xml
- snapshots/example.snap
- .git/config

Also verify that test source files are NOT ignored simply because they are under tests/.

==================================================
2. IMPROVE CODE CHUNKING
==================================================

Problem:

The current implementation creates chunks for trivial AST nodes such as:

- require()
- import
- local variables
- simple assignments

Example:

const express = require("express");

should NOT become an independent code chunk.

Likewise:

const timeout = 5000;

should normally not become a standalone chunk.

These small chunks increase vector-store noise and reduce retrieval quality.

--------------------------------------------------
2.1 Core principle
--------------------------------------------------

Do NOT convert every AST node into a chunk.

Only semantically meaningful code constructs should become independent chunks.

The parser may still detect all AST nodes.

The chunker decides which nodes become KnowledgeChunks.

--------------------------------------------------
2.2 Primary code symbols
--------------------------------------------------

Prioritize semantic constructs such as:

- class
- method
- function
- interface
- type alias
- enum

Support the constructs that are actually present in the repository.

Verify Tree-sitter node types against the installed grammar.

Do not guess AST node names.

--------------------------------------------------
2.3 Trivial constructs
--------------------------------------------------

Do NOT create standalone chunks for:

- import declarations
- require calls
- local variables
- temporary variables
- simple assignments
- loop variables
- destructuring statements
- trivial expressions

unless there is a strong semantic reason.

--------------------------------------------------
2.4 Important exported declarations
--------------------------------------------------

Do not blindly discard every variable declaration.

Some declarations can be semantically important.

For example:

export const PAYMENT_STATUS = {
  PENDING: "pending",
  SETTLED: "settled",
  REVERTED: "reverted"
};

may be valuable to retrieve independently.

Therefore implement a distinction between:

TRIVIAL_VARIABLE

and

SEMANTIC_DECLARATION

Potential criteria:

- exported
- object/array with meaningful structure
- enum-like constants
- configuration definitions
- public API declarations

The exact rules should be based on the actual codebase and existing architecture.

Do not use an LLM for this classification.

It should remain deterministic.

--------------------------------------------------
2.5 Parent symbol metadata
--------------------------------------------------

Code chunks should preserve parent context.

For example:

class PaymentService {
    async pay() {
        ...
    }
}

The method chunk should contain:

{
  "symbol": "PaymentService.pay",
  "symbolType": "method",
  "parentSymbol": "PaymentService"
}

Do not necessarily duplicate the entire class source into every method chunk.

Use metadata to preserve hierarchy.

--------------------------------------------------
2.6 Code chunk content
--------------------------------------------------

The content field must contain the actual source code represented by the chunk.

Example:

{
  "type": "code",
  "content": "async pay() { ... }",
  "metadata": {
    "symbol": "PaymentService.pay",
    "symbolType": "method",
    "parentSymbol": "PaymentService"
  }
}

Do not replace source code with a generated summary.

--------------------------------------------------


--------------------------------------------------
2.6 JSDoc / Documentation Attachment
--------------------------------------------------

The current implementation incorrectly ignores JSDoc comments attached to
classes, methods, and functions.

JSDoc must NOT become a standalone chunk.

Instead, when a JSDoc comment belongs to a semantic code symbol, attach it
to that symbol's code chunk.

For example:

/**
 * Creates a new user.
 * @param username User username
 * @returns Created user
 */
async createUser(username) {
    ...
}

must produce ONE semantic code chunk containing:

- JSDoc
- method signature
- method implementation

Do not create:

JSDoc chunk
+
Method chunk

as two independent chunks.

The JSDoc should be preserved exactly as source content where possible.

The code chunk's startLine should include the JSDoc when JSDoc is directly
associated with the symbol.

Do not attach unrelated comments to the symbol.

--------------------------------------------------
2.7 Method / Function Signature
--------------------------------------------------

Add an explicit "signature" field to code chunk metadata.

Example:

{
  "symbol": "PaymentService.pay",
  "symbolType": "method",
  "parentSymbol": "PaymentService",
  "signature": "async pay(request: PaymentRequest): Promise<PaymentResponse>"
}

The signature must be extracted deterministically from the AST/source.

Do NOT ask an LLM to generate signatures.

The signature should represent the callable/declaration interface without
including the implementation body.

For example:

class:

class PaymentService

method:

async pay(request: PaymentRequest): Promise<PaymentResponse>

function:

function createPayment(request: PaymentRequest): PaymentResponse

interface:

interface PaymentRequest

type:

type PaymentStatus = ...

enum:

enum PaymentStatus

The exact syntax must preserve the actual source language and syntax used
by the repository.

--------------------------------------------------
2.8 Signature in Content
--------------------------------------------------

For semantic code chunks, include the signature in the chunk content as
part of the semantic context.

Example:

Class: PaymentService

Method: pay

Signature:
async pay(request: PaymentRequest): Promise<PaymentResponse>

/**
 * Creates a payment...
 */

async pay(request: PaymentRequest): Promise<PaymentResponse> {
    ...
}

Do not generate a summary.

Do not modify the source implementation.

The additional context should be deterministic.

--------------------------------------------------
2.9 Code Symbol Semantic Unit
--------------------------------------------------

The semantic unit for a method/function should therefore be:

Parent Context
+
Symbol Name
+
Signature
+
JSDoc (if present)
+
Implementation

For example:

Class: UserService

Method: createUser

Signature:
async createUser(username: string): Promise<User>

/**
 * Creates a new user.
 */

async createUser(username: string): Promise<User> {
    ...
}

This entire unit should remain retrievable as one code chunk unless the
implementation is too large and requires deterministic splitting.

--------------------------------------------------
2.10 Tests
--------------------------------------------------

Add tests for:

1. Method without JSDoc

async createUser(username) {
    ...
}

Expected:
- one method chunk
- signature exists
- no JSDoc field/content added

2. Method with JSDoc

/**
 * Creates a user.
 * @param username User username
 */
async createUser(username) {
    ...
}

Expected:
- one method chunk
- JSDoc preserved
- signature exists
- startLine includes JSDoc

3. Class with JSDoc

/**
 * Handles user operations.
 */
class UserService {
    ...
}

Expected:
- class chunk contains the associated JSDoc

4. Function with JSDoc

/**
 * Creates a payment.
 */
function createPayment() {
    ...
}

Expected:
- function chunk contains JSDoc
- signature exists

5. Unrelated comments

Verify that comments not associated with a semantic symbol are not
incorrectly attached to the next symbol.

6. Parent context

Verify:

parentSymbol = "PaymentService"

for:

PaymentService.pay

7. Signature accuracy

Verify that signatures are extracted from the actual source and are not
LLM-generated.



2.7 Tests
--------------------------------------------------

Add tests verifying that:

Input:

const express = require("express");

does NOT create a standalone chunk.

Input:

import { UserService } from "./user.service";

does NOT create a standalone chunk.

Input:

const localValue = foo();

does NOT create a standalone chunk.

Input:

class UserService {
    ...
}

creates a class chunk if classes are currently configured as chunkable.

Input:

class UserService {
    async createUser() {
        ...
    }
}

creates an appropriate method chunk.

Input:

export const PAYMENT_STATUS = {
    PENDING: "pending"
};

may create a semantic declaration chunk.

Verify parentSymbol metadata.

==================================================
3. IMPLEMENT PARENT–CHILD DOCUMENTATION CHUNKING
==================================================

Problem:

The current Markdown chunker is primarily splitting on headers.

This loses hierarchical context.

Example:

# Environment

## ai-embedding

### ⚠️ توجه مهم

هرگونه تغییر در متغیرهای محیطی...

The current chunk may contain only:

"⚠️ توجه مهم"

and its body.

That is insufficient context.

The chunk should know that it belongs to:

Environment
  >
ai-embedding
  >
⚠️ توجه مهم

--------------------------------------------------
3.1 Build a section hierarchy
--------------------------------------------------

The Markdown parser already produces a structured representation.

Use it to build a hierarchical section tree.

Conceptually:

Document
│
├── Environment
│   │
│   ├── ai-embedding
│   │   │
│   │   └── ⚠️ توجه مهم
│   │
│   └── service
│
└── Other section

Each section should have:

- section ID
- title
- level
- parentId
- children
- startLine
- endLine
- content

Do not use an LLM to construct this hierarchy.

Heading hierarchy is deterministic and should be derived from the Markdown AST.

--------------------------------------------------
3.2 Parent–Child model
--------------------------------------------------

Introduce a clean relationship between documentation chunks.

Example:

Parent:

{
  "id": "section-42",
  "type": "documentation",
  "content": "...",
  "metadata": {
    "sectionPath": [
      "Environment",
      "ai-embedding"
    ]
  }
}

Child:

{
  "id": "chunk-123",
  "parentId": "section-42",
  "type": "documentation",
  "content": "...",
  "metadata": {
    "sectionPath": [
      "Environment",
      "ai-embedding",
      "⚠️ توجه مهم"
    ]
  }
}

The exact schema may differ depending on the existing implementation.

Preserve compatibility with the current KnowledgeChunk model where possible.

--------------------------------------------------
3.3 Important design requirement
--------------------------------------------------

The child must remain independently retrievable.

The parent relationship exists to restore context after retrieval.

The intended flow is:

Vector Search
    ↓
Child Chunk
    ↓
parentId
    ↓
Parent Context
    ↓
Context Assembly
    ↓
LLM

Do not require a vector search against the parent.

Do not make the parent itself mandatory as a vector-search result.

--------------------------------------------------
3.4 Parent size
--------------------------------------------------

Do not blindly make the entire Markdown document the parent.

Parents should represent meaningful semantic sections.

For example:

# Authentication

can be a parent.

Its child sections may be:

## Login
## Refresh Token
## Logout

Avoid creating enormous parent chunks that contain the entire document.

--------------------------------------------------
3.5 Large sections
--------------------------------------------------

If a semantic section is too large, split it into multiple children.

Preserve:

parentId

and:

sectionPath

for every child.

Do not lose hierarchy when splitting large sections.

==================================================
4. ADD SECTION PATH / CONTEXT PROPAGATION
==================================================

Replace the current ambiguous documentation metadata:

"section": [...]

with an explicit hierarchy representation.

Prefer:

"sectionPath": [
  "Environment",
  "ai-embedding",
  "⚠️ توجه مهم"
]

and optionally:

"sectionTitle": "⚠️ توجه مهم"

Do not store arbitrary body text inside sectionPath.

sectionPath must contain section titles only.

--------------------------------------------------
4.1 Context in metadata
--------------------------------------------------

Every documentation child should contain:

repository
service
branch
commit
file
sectionPath
sectionTitle
startLine
endLine

Example:

{
  "type": "documentation",
  "content": "...",
  "metadata": {
    "repositoryId": "...",
    "repository": "partServiceFileStorage",
    "service": "FileStorage",
    "branch": "develop",
    "commit": "...",
    "file": "document/readme/env.md",
    "language": "markdown",
    "sectionPath": [
      "Environment",
      "ai-embedding",
      "⚠️ توجه مهم"
    ],
    "sectionTitle": "⚠️ توجه مهم",
    "startLine": 13,
    "endLine": 26
  }
}

--------------------------------------------------
4.2 Context in content
--------------------------------------------------

Do not rely only on metadata.

For documentation chunks, include a compact semantic context in the content when appropriate.

Example:

Document: Environment

Section:
Environment > ai-embedding > ⚠️ توجه مهم

Content:

هرگونه تغییر در متغیرهای محیطی ...

This is important because embeddings are generated from chunk content.

Do not repeat huge parent documents.

Only inject compact hierarchical context.

--------------------------------------------------
4.3 Preserve original content
--------------------------------------------------

Do not modify the actual semantic content of the documentation.

Context injection should be clearly distinguishable from the original content.

Prefer a deterministic format such as:

Document: Environment
Section: Environment > ai-embedding > ⚠️ توجه مهم

<original content>

Do not generate summaries.

Do not use an LLM.

==================================================
5. HTML INSIDE MARKDOWN
==================================================

The existing repository contains Markdown with embedded HTML.

For example:

<details id=service>
<summary>service</summary>

...

</details>

The parser/chunker must not destroy this content.

Inspect the current Markdown parser behavior.

Ensure embedded HTML does not break:

- section extraction
- line positions
- content preservation
- chunk boundaries

Do not attempt to fully interpret arbitrary HTML unless required.

The primary requirement is preservation of meaningful content.

==================================================
6. KNOWLEDGE CHUNK SCHEMA
==================================================

Review the existing KnowledgeChunk schema.

Make the minimum changes required to support:

Documentation:

- parentId
- sectionPath
- sectionTitle

Code:

- parentSymbol

Do not unnecessarily redesign the complete schema.

Maintain backwards compatibility where practical.

If schema changes are necessary, update:

- types
- validators
- serializers
- tests
- documentation

==================================================
7. RETRIEVAL READINESS
==================================================

Do not implement the retrieval system in this task.

However, the produced chunks must support this future flow:

Query
  ↓
Vector Search
  ↓
Child Chunk
  ↓
parentId
  ↓
Parent Context Expansion
  ↓
Context Assembly
  ↓
LLM

Make sure the metadata is sufficient to implement this later.

==================================================
8. TESTING REQUIREMENTS
==================================================

Run existing tests before changes.

Then add/update tests.

Required test groups:

### File filtering

- generated directories ignored
- test source preserved
- test artifacts ignored
- build output ignored
- coverage ignored

### Code chunking

- imports ignored
- require ignored
- trivial variables ignored
- simple assignments ignored
- class preserved
- method preserved
- function preserved
- interface preserved
- type alias preserved
- enum preserved
- meaningful exported declaration handled
- parentSymbol populated

### Markdown hierarchy

Given:

# Environment

## ai-embedding

### ⚠️ توجه مهم

content

Verify:

sectionPath =
[
  "Environment",
  "ai-embedding",
  "⚠️ توجه مهم"
]

Verify parentId exists.

Verify child content contains compact context.

Verify original content is preserved.

### Nested sections

Test:

# A
## B
### C
## D
# E

Expected hierarchy:

A
├── B
│   └── C
└── D

E

### Large sections

Verify large sections are split without losing:

- parentId
- sectionPath
- line numbers
- source content

### HTML Markdown

Verify embedded <details>/<summary> content survives chunking.

==================================================
9. REAL REPOSITORY VALIDATION
==================================================

After unit tests pass, run ingestion against the configured GitLab repository:

partServiceFileStorage

Use the existing .env configuration.

Do not print credentials.

Inspect the produced chunks.

Specifically verify:

1. test artifacts are absent
2. coverage/build artifacts are absent
3. imports/requires are not standalone chunks
4. trivial variables are not standalone chunks
5. classes/methods/functions remain available
6. Markdown chunks contain sectionPath
7. Markdown chunks have parent relationships
8. Markdown content retains original text
9. embedded HTML is preserved
10. commit metadata is correct

Produce ingestion statistics such as:

Files discovered
Files ignored
Files processed
Code chunks
Documentation parents
Documentation children
Total chunks
Failed files

==================================================
10. QUALITY CHECK
==================================================

Before finishing, inspect the implementation for:

- duplicate chunks
- empty chunks
- extremely small useless chunks
- extremely large chunks
- incorrect line ranges
- incorrect parent-child relationships
- incorrect section paths
- lost Markdown content
- lost HTML content
- incorrect repository metadata
- incorrect commit metadata
- accidental processing of generated files

Do not optimize prematurely.

Prefer deterministic and explainable rules.

==================================================
11. DO NOT IMPLEMENT THESE FEATURES
==================================================

Do NOT add:

- LLM-based chunk classification
- LLM-based contextualization
- embeddings
- Chroma integration
- vector search
- BM25
- reranking
- security scanning
- MCP
- RAG query pipeline

Those will be evaluated later.

==================================================
12. FINAL ACCEPTANCE CRITERIA
==================================================

The task is complete only when:

[ ] Generated artifacts are ignored.

[ ] Test source files can still be processed.

[ ] Imports/requires do not become standalone chunks.

[ ] Trivial variables do not become standalone chunks.

[ ] Meaningful exported declarations can remain searchable.

[ ] Code parent relationships are represented.

[ ] Markdown headings form a real hierarchy.

[ ] Documentation chunks have parentId.

[ ] Documentation chunks have sectionPath.

[ ] sectionPath contains only section titles.

[ ] Documentation content contains compact hierarchical context.

[ ] Original Markdown content is preserved.

[ ] Embedded HTML is preserved.

[ ] Large sections can be split without losing hierarchy.

[ ] Existing revision/repository metadata is preserved.

[ ] Existing tests continue to pass.

[ ] New tests cover all changes.

[ ] Real ingestion against the configured GitLab repository succeeds.

[ ] Generated chunks have been manually inspected.

==================================================
13. FINAL REPORT
==================================================

At the end provide:

1. Files changed
2. Files created
3. Important implementation decisions
4. New ignore rules
5. New code chunking rules
6. Parent–Child documentation design
7. KnowledgeChunk schema changes
8. Tests added/updated
9. Test results
10. Real repository ingestion statistics
11. Examples of improved code chunks
12. Examples of improved documentation chunks
13. Known limitations
14. Recommendations for the next phase

IMPORTANT:

Do not claim success based only on compilation.

The implementation must pass tests and must be validated against the real configured repository.