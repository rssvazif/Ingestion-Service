import type { SyntaxNode } from 'tree-sitter';

/** Lightweight code node representation extracted from a Tree-sitter AST. */
export interface CodeNode {
  /** Tree-sitter node type, e.g. "class_declaration", "method_definition". */
  type: string;
  /** Optional symbol name when extractable (class name, method name, ...). */
  name?: string;
  /** Source text of this node. */
  text: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  /** Direct children useful for further inspection (functions, nested types). */
  children: CodeNode[];
}

/** Result of parsing a source file. */
export interface ParsedCode {
  filePath: string;
  language: string;
  source: string;
  /** All top-level code constructs that should become chunks. */
  topLevel: CodeNode[];
  /** All named declarations anywhere in the file, used for symbol lookups. */
  declarations: CodeNode[];
  /** Optional error from the underlying parser (does not throw). */
  parseError?: string;
}

export interface CodeParser {
  readonly language: string;
  /** Detect if this parser can handle the given path. */
  supports(filePath: string): boolean;
  /** Parse source content into a structured AST representation. */
  parse(source: string, filePath: string): ParsedCode;
}

/**
 * Walk a Tree-sitter subtree, producing CodeNode objects.
 *
 * Stops descending into nodes we consider "leaf chunks" so we don't double
 * count nested symbols. The chunker decides what counts as a chunk.
 */
export function treeSitterToCodeNode(node: SyntaxNode, source: string): CodeNode {
  const text = source.slice(node.startIndex, node.endIndex);
  const children: CodeNode[] = [];
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (!c) continue;
    if (isStructuralNode(c.type)) {
      children.push(treeSitterToCodeNode(c, source));
    }
  }
  return {
    type: node.type,
    name: extractName(node),
    text,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
    children,
  };
}

export function isStructuralNode(type: string): boolean {
  return [
    'class_declaration',
    'abstract_class_declaration',
    'class',
    'function_declaration',
    'function',
    'generator_function_declaration',
    'method_definition',
    'method_signature',
    'arrow_function',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'lexical_declaration',
    'variable_declaration',
    'export_statement',
    'export_specifier',
    'namespace_declaration',
    'module',
    'struct_item',
    'impl_item',
    'trait_item',
    'enum_item',
    'function_item',
  ].includes(type);
}

export function extractName(node: SyntaxNode): string | undefined {
  switch (node.type) {
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'class':
    case 'interface_declaration':
    case 'type_alias_declaration':
    case 'enum_declaration':
    case 'function_declaration':
    case 'generator_function_declaration':
    case 'function':
    case 'struct_item':
    case 'impl_item':
    case 'trait_item':
    case 'enum_item':
    case 'function_item':
    case 'namespace_declaration':
    case 'module':
      return findNameChild(node);
    case 'method_definition':
    case 'method_signature': {
      const nameNode = node.childForFieldName('name');
      return nameNode?.text;
    }
    case 'lexical_declaration':
    case 'variable_declaration':
    case 'export_statement': {
      const declarator = findFirstChildOfType(node, [
        'variable_declarator',
        'lexical_declaration',
      ]);
      if (!declarator) return undefined;
      return nameOfNode(declarator);
    }
    default:
      return undefined;
  }
}

function findNameChild(node: SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (c && (c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'property_identifier')) {
      return c.text;
    }
  }
  return undefined;
}

function nameOfNode(node: SyntaxNode): string | undefined {
  const field = node.childForFieldName('name');
  if (field) return field.text;
  return findNameChild(node);
}

function findFirstChildOfType(node: SyntaxNode, types: string[]): SyntaxNode | undefined {
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return undefined;
}
