import type { ParsedDocumentation } from '../parsers/documentation/types.js';

/**
 * Role of a chunk within the documentation hierarchy.
 *
 * - `parent` — a meaningful top-level section that represents the full
 *   extent of one heading (and all of its subsections, optionally split
 *   into children).
 * - `child` — a sub-section (or split fragment) that references a
 *   `parentId`. The child is independently retrievable; the parent is
 *   used to restore context after retrieval.
 */
export type DocumentationChunkKind = 'parent' | 'child';

/**
 * A documentation chunk produced by the chunker. It is *almost* a
 * KnowledgeChunk but kept distinct so the chunker has no dependency on
 * the embedding / metadata layer. The context injector converts this into
 * the canonical KnowledgeChunk later.
 */
export interface DocumentationChunk {
  /** Role within the parent-child hierarchy. */
  kind: DocumentationChunkKind;
  /**
   * Index into the chunker's output list pointing at this chunk's parent
   * chunk. Only meaningful for `child` chunks. The context injector
   * resolves this to the parent's deterministic chunk id.
   */
  parentIndex?: number;
  /**
   * Explicit parent chunk id, set by the injector after id resolution.
   * Not populated by the chunker.
   */
  parentId?: string;
  /** Heading hierarchy (e.g. ["Authentication", "Login"]). */
  section: string[];
  /** Explicit heading hierarchy (same data as `section`, kept for clarity). */
  sectionPath: string[];
  /** Most specific heading text, used as a symbol-like identifier. */
  title: string;
  /** Heading depth at the top of the section. */
  depth: number;
  /** 1-based start line of the section (inclusive of heading line). */
  startLine: number;
  /** 1-based end line of the section (inclusive of last content line). */
  endLine: number;
  /** Concatenated text content of the section. */
  content: string;
  /** True when this chunk was produced by a fallback size-based split. */
  split: boolean;
}

export interface DocumentationChunkerOptions {
  /** Maximum chars per chunk before secondary split kicks in. */
  maxChars?: number;
  /** Overlap characters to preserve when splitting large sections. */
  overlapChars?: number;
  /**
   * Optional override for the chunk-id generator. Allows the injector to
   * pre-register parent ids before children are emitted.
   */
  idFactory?: () => string;
}