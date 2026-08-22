import type { CodeNode, ParsedCode } from '../parsers/code/types.js';
import type {
  CodeChunk,
  CodeChunkerOptions,
  CodeSymbolKind,
} from './code-chunker-types.js';

export type { CodeChunk, CodeChunkerOptions, CodeSymbolKind } from './code-chunker-types.js';

const DEFAULT_OPTIONS: Required<CodeChunkerOptions> = {
  splitMethods: true,
  includeLexicalDeclarations: true,
  includeInterfaceMembers: false,
};

const KIND_BY_NODE_TYPE: Record<string, CodeSymbolKind> = {
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  function_declaration: 'function',
  generator_function_declaration: 'function',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  method_definition: 'method',
  method_signature: 'method',
  lexical_declaration: 'variable',
};

/**
 * Splits a ParsedCode representation into semantic chunks. Each class,
 * method, function, interface, type alias, enum, or top-level const becomes
 * a chunk with source content embedded.
 */
export class CodeChunker {
  private readonly opts: Required<CodeChunkerOptions>;

  constructor(options: CodeChunkerOptions = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  chunk(parsed: ParsedCode): CodeChunk[] {
    const out: CodeChunk[] = [];

    for (const node of parsed.topLevel) {
      const kind = KIND_BY_NODE_TYPE[node.type];
      if (!kind) continue;
      if (!this.opts.includeLexicalDeclarations && kind === 'variable') continue;
      const name = node.name ?? '<anonymous>';
      const fqn = name;
      out.push({
        symbol: fqn,
        symbolType: kind,
        language: parsed.language,
        startLine: node.startLine,
        endLine: node.endLine,
        content: node.text,
        nodeType: node.type,
      });

      if (kind === 'class' && this.opts.splitMethods) {
        for (const child of node.children) {
          if (child.type === 'method_definition' || child.type === 'method_signature') {
            const methodName = child.name ?? '<anonymous>';
            out.push({
              symbol: `${fqn}.${methodName}`,
              symbolType: 'method',
              language: parsed.language,
              startLine: child.startLine,
              endLine: child.endLine,
              content: child.text,
              nodeType: child.type,
              parentSymbol: fqn,
            });
          }
        }
      }
    }

    return out;
  }
}

export const _internal = { KIND_BY_NODE_TYPE };
