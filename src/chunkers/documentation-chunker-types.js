/**
 * Role of a chunk within the documentation hierarchy.
 *
 * - `parent` — a meaningful top-level section that represents the full
 *   extent of one heading (and all of its subsections, optionally split
 *   into children).
 * - `child` — a sub-section (or split fragment) that references a
 *   `parentId`. The child is independently retrievable; the parent is
 *   used to restore context after retrieval.
 *
 * @typedef {('parent' | 'child')} DocumentationChunkKind
 */

/**
 * A documentation chunk produced by the chunker. It is *almost* a
 * KnowledgeChunk but kept distinct so the chunker has no dependency on
 * the embedding / metadata layer. The context injector converts this into
 * the canonical KnowledgeChunk later.
 *
 * @typedef {object} DocumentationChunk
 * @property {DocumentationChunkKind} kind       Role within the parent-child hierarchy.
 * @property {number} [parentIndex]              Index into the chunker's output list pointing at this chunk's parent chunk.
 *                                                Only meaningful for `child` chunks.
 * @property {string} [parentId]                 Explicit parent chunk id, set by the injector after id resolution.
 *                                                Not populated by the chunker.
 * @property {string[]} section                  Heading hierarchy (e.g. ["Authentication", "Login"]).
 * @property {string[]} sectionPath              Explicit heading hierarchy (same data as `section`, kept for clarity).
 * @property {string} title                      Most specific heading text, used as a symbol-like identifier.
 * @property {number} depth                      Heading depth at the top of the section.
 * @property {number} startLine                  1-based start line of the section (inclusive of heading line).
 * @property {number} endLine                    1-based end line of the section (inclusive of last content line).
 * @property {string} content                    Concatenated text content of the section.
 * @property {boolean} split                     True when this chunk was produced by a fallback size-based split.
 */

/**
 * @typedef {object} DocumentationChunkerOptions
 * @property {number} [maxChars]        Maximum chars per chunk before secondary split kicks in.
 * @property {number} [overlapChars]    Overlap characters to preserve when splitting large sections.
 * @property {() => string} [idFactory] Optional override for the chunk-id generator.
 */