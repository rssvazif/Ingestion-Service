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
  /** 1-based start line. */
  startLine: number;
  /** 1-based end line. */
  endLine: number;
  /** Raw source content of the chunk (used later as RAG context). */
  content: string;
  /** Original code node the chunk was produced from. */
  nodeType: string;
  /** Optional parent symbol for nested members (e.g. class name for methods). */
  parentSymbol?: string;
}

export interface CodeChunkerOptions {
  /** Include class methods as separate chunks. */
  splitMethods?: boolean;
  /** Include top-level lexical declarations (const/let) as chunks. */
  includeLexicalDeclarations?: boolean;
  /** Include interface / type-alias members as separate chunks. */
  includeInterfaceMembers?: boolean;
}
