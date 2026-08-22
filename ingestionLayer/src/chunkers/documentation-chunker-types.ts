import type { ParsedDocumentation } from '../parsers/documentation/types.js';

/**
 * A documentation chunk produced by the chunker. It is *almost* a
 * KnowledgeChunk but kept distinct so the chunker has no dependency on
 * the embedding / metadata layer. The context injector converts this into
 * the canonical KnowledgeChunk later.
 */
export interface DocumentationChunk {
  /** Heading hierarchy (e.g. ["Authentication", "Login"]). */
  section: string[];
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
}
