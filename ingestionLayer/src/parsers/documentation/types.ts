/**
 * Strongly-typed view of a parsed Markdown document. We keep the raw MDAST
 * tree alongside our derived structure so downstream chunkers can pick what
 * they need.
 */
import type { Root, RootContent } from 'mdast';

export interface MarkdownHeading {
  /** 1-based heading level (1 == "#", 2 == "##", ...). */
  depth: number;
  /** Plain text of the heading, code spans stripped. */
  text: string;
  /** Raw heading line as it appeared in source, including trailing newlines. */
  raw: string;
  /** 1-based start line of the heading marker. */
  startLine: number;
  /** 1-based end line of the heading line itself. */
  endLine: number;
}

export interface MarkdownCodeBlock {
  /** Language fence, e.g. ```ts — undefined if unspecified. */
  language?: string;
  /** Raw inner content of the code block, without the fences. */
  value: string;
  startLine: number;
  endLine: number;
}

export interface MarkdownLink {
  text: string;
  url: string;
  startLine: number;
}

export interface ParsedDocumentation {
  source: string;
  headings: MarkdownHeading[];
  codeBlocks: MarkdownCodeBlock[];
  links: MarkdownLink[];
  /** Full MDAST tree preserved for advanced consumers. */
  ast: Root;
  /** Flat list of MDAST top-level nodes with positions. */
  topLevel: Array<{ node: RootContent; startLine: number; endLine: number }>;
}

export interface MarkdownParserOptions {
  /** Maximum source size in bytes; oversized documents return an error. */
  maxBytes?: number;
}
