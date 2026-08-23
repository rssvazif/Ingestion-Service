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
  includeSemanticDeclarationsOnly: true,
  includeSemanticContextInContent: true,
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
 *
 * The parser may report every AST node; the chunker is responsible for
 * deciding which ones become independent chunks. Trivial lexical
 * declarations (require() calls, plain local values, simple assignments)
 * are filtered out unless {@link CodeChunkerOptions.includeSemanticDeclarationsOnly}
 * is false.
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

      if (kind === 'variable') {
        if (!this.opts.includeLexicalDeclarations) continue;
        if (this.opts.includeSemanticDeclarationsOnly && isTrivialDeclaration(node)) {
          continue;
        }
      }

      const name = node.name ?? '<anonymous>';
      const fqn = name;
      const signature = extractSignature(node, parsed.source);

      const chunk: CodeChunk = {
        symbol: fqn,
        symbolType: kind,
        language: parsed.language,
        startLine: node.startLine,
        endLine: node.endLine,
        content: node.text,
        nodeType: node.type,
        parentSymbol: undefined,
        signature,
        jsdoc: node.jsdoc,
        exported: node.exported ?? false,
      };
      this.composeContent(chunk);
      out.push(chunk);

      if (kind === 'class' && this.opts.splitMethods) {
        for (const child of node.children) {
          if (child.type !== 'method_definition' && child.type !== 'method_signature') continue;
          const methodName = child.name ?? '<anonymous>';
          const methodSig = extractSignature(child, parsed.source);
          const methodChunk: CodeChunk = {
            symbol: `${fqn}.${methodName}`,
            symbolType: 'method',
            language: parsed.language,
            startLine: child.startLine,
            endLine: child.endLine,
            content: child.text,
            nodeType: child.type,
            parentSymbol: fqn,
            signature: methodSig,
            jsdoc: child.jsdoc,
            exported: node.exported ?? false,
          };
          this.composeContent(methodChunk);
          out.push(methodChunk);
        }
      }
    }

    return out;
  }

  /**
   * Build the chunk's `content` field. For semantic chunks we inject a
   * compact deterministic context block (parent symbol, signature, JSDoc)
   * so the embedding layer can rely on the text directly. The original
   * source body is preserved verbatim.
   */
  private composeContent(chunk: CodeChunk): void {
    if (!this.opts.includeSemanticContextInContent) return;
    const headerLines: string[] = [];
    if (chunk.parentSymbol) headerLines.push(`Parent: ${chunk.parentSymbol}`);
    if (chunk.symbolType && chunk.symbol) {
      const kindLabel = chunk.symbolType.charAt(0).toUpperCase() + chunk.symbolType.slice(1);
      headerLines.push(`${kindLabel}: ${chunk.symbol}`);
    }
    if (chunk.signature) headerLines.push(`Signature: ${chunk.signature}`);
    if (chunk.jsdoc) headerLines.push(chunk.jsdoc);
    if (headerLines.length === 0) return;
    chunk.content = headerLines.join('\n') + '\n\n' + chunk.content;
  }
}

/**
 * A lexical declaration is considered trivial when it is not exported and
 * does not define a meaningful object / array literal. require() calls,
 * single-value assignments, and short local helpers are skipped.
 */
function isTrivialDeclaration(node: CodeNode): boolean {
  if (node.type !== 'lexical_declaration') return false;
  if (node.exported) return false;
  const declarators = findChildrenByType(node, ['variable_declarator']);
  if (declarators.length === 0) return true;
  for (const d of declarators) {
    if (isMeaningfulInitializer(d)) return false;
  }
  return true;
}

/**
 * Inspect a `variable_declarator` and decide whether its initializer is
 * semantically meaningful (object/array literals with payload,
 * factory calls of public configuration helpers). Per the spec, plain
 * arrow functions, temporary helpers, and require() calls remain trivial
 * even when they happen to carry a function body.
 */
function isMeaningfulInitializer(declarator: CodeNode): boolean {
  const value = declarator.children.find((c) => isInitializerLike(c.type));
  if (!value) return false;
  if (value.type === 'object') {
    const inner = value.text.trim();
    return inner.length > 2 && inner !== '{}';
  }
  if (value.type === 'array') {
    const inner = value.text.trim();
    return inner.length > 2 && inner !== '[]';
  }
  if (value.type === 'call_expression') {
    if (looksLikeRequireCall(value)) return false;
    if (isConfigStyleCall(value)) return true;
    return false;
  }
  return false;
}

function isInitializerLike(type: string): boolean {
  return [
    'object',
    'array',
    'arrow_function',
    'function',
    'call_expression',
    'binary_expression',
    'unary_expression',
    'new_expression',
    'template_string',
    'string',
    'number',
    'true',
    'false',
    'null',
    'member_expression',
    'regex',
  ].includes(type);
}

function looksLikeRequireCall(node: CodeNode): boolean {
  if (node.type !== 'call_expression') return false;
  const callee = node.children[0];
  return callee?.type === 'identifier' && callee.text === 'require';
}

function isConfigStyleCall(node: CodeNode): boolean {
  // Heuristic: defineConfig(...) / makeConfig(...) / Schema.object({...})
  const callee = node.children[0];
  if (!callee) return false;
  const calleeText = callee.text;
  return /^(defineConfig|makeConfig|defineSchema|buildConfig|loadConfig|defineTable|defineRoute|defineModule)$/.test(
    calleeText
  );
}

function isValueLike(type: string): boolean {
  return [
    'object',
    'array',
    'arrow_function',
    'function',
    'call_expression',
    'binary_expression',
    'unary_expression',
    'new_expression',
    'template_string',
    'string',
    'number',
    'true',
    'false',
    'null',
    'identifier',
    'member_expression',
    'regex',
  ].includes(type);
}

function findChildrenByType(node: CodeNode, types: string[]): CodeNode[] {
  return node.children.filter((c) => types.includes(c.type));
}

/**
 * Extract a deterministic signature from the AST. The signature represents
 * the callable/declaration header without the implementation body.
 */
export function extractSignature(node: CodeNode, source: string): string {
  const startOffset = sourceOffsetOfNode(source, node);
  const text = source.slice(startOffset, sourceOffsetOfNode(source, node) + node.text.length);
  switch (node.type) {
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const idx = indexOfFirstOpenBrace(text);
      return idx > 0 ? trimSignature(text.slice(0, idx)) : trimSignature(text);
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const idx = indexOfFirstOpenBrace(text);
      return idx > 0 ? trimSignature(text.slice(0, idx)) : trimSignature(text);
    }
    case 'method_definition':
    case 'method_signature': {
      const idx = indexOfFirstOpenBrace(text);
      return idx > 0 ? trimSignature(text.slice(0, idx)) : trimSignature(text);
    }
    case 'interface_declaration': {
      const idx = indexOfFirstOpenBrace(text);
      return idx > 0 ? trimSignature(text.slice(0, idx)) : trimSignature(text);
    }
    case 'type_alias_declaration': {
      const eq = text.indexOf('=');
      if (eq > 0) return trimSignature(text.slice(0, eq));
      return trimSignature(text);
    }
    case 'enum_declaration': {
      const idx = indexOfFirstOpenBrace(text);
      return idx > 0 ? trimSignature(text.slice(0, idx)) : trimSignature(text);
    }
    case 'lexical_declaration': {
      // const NAME = initializer; include up to a small portion of the
      // initializer so callers see the public type literal.
      const eq = text.indexOf('=');
      if (eq < 0) return trimSignature(text);
      return trimSignature(text.slice(0, Math.min(text.length, eq + 80)));
    }
    default:
      return trimSignature(text);
  }
}

function indexOfFirstOpenBrace(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 123 /* { */) return i;
  }
  return -1;
}

function trimSignature(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a CodeNode's absolute source offset by walking the source from
 * `node.startLine / startColumn`. Cheaper than recomputing from the AST.
 */
function sourceOffsetOfNode(source: string, node: CodeNode): number {
  // Approximation: count newlines up to node.startLine - 1, add startColumn.
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < node.startLine - 1 && i < lines.length; i += 1) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + node.startColumn;
}

export const _internal = {
  KIND_BY_NODE_TYPE,
  isTrivialDeclaration,
  isMeaningfulInitializer,
  extractSignature,
};