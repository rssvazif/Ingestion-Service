import type { CodeNode, ParsedCode } from '../parsers/code/types.js';

export type CodeSymbolKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'variable';

export interface CodeChunk {
  /** Fully-qualified symbol name (e.g. "UserService.findUser"). */
  symbol: string;
  /** Kind of the symbol the chunk represents. */
  symbolType: CodeSymbolKind;
  /** Programming language of the source chunk. */
  language: string;
  /** 1-based start line (inclusive of JSDoc when attached). */
  startLine: number;
  /** 1-based end line. */
  endLine: number;
  /** Raw source content of the chunk (used later as RAG context). */
  content: string;
  /** Original code node the chunk was produced from. */
  nodeType: string;
  /** Optional parent symbol for nested members (e.g. class name for methods). */
  parentSymbol?: string;
  /** Deterministic signature extracted from the source. */
  signature?: string;
  /** JSDoc comment directly attached to this symbol, when present. */
  jsdoc?: string;
  /** Whether this declaration is exported from its module. */
  exported?: boolean;
}

export interface CodeChunkerOptions {
  /** Include class methods as separate chunks. */
  splitMethods?: boolean;
  /** Include top-level lexical declarations (const/let) as chunks. */
  includeLexicalDeclarations?: boolean;
  /** Include interface / type-alias members as separate chunks. */
  includeInterfaceMembers?: boolean;
  /**
   * When true (default) the chunker drops trivial lexical declarations
   * (require() calls, plain local values, simple assignments). Only
   * semantic declarations (exported, object/array literals, config-style
   * factory calls) are kept.
   */
  includeSemanticDeclarationsOnly?: boolean;
  /**
   * When true (default) the chunker prepends a compact context block to
   * the chunk content: parent symbol, signature, JSDoc. This improves the
   * signal sent to the embedding model.
   */
  includeSemanticContextInContent?: boolean;
}
