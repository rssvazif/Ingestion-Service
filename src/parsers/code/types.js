/**
 * Lightweight code node representation extracted from a Tree-sitter AST.
 *
 * @typedef {object} CodeNode
 * @property {string} type             Tree-sitter node type, e.g. "class_declaration", "method_definition".
 * @property {string} [name]           Optional symbol name when extractable (class name, method name, ...).
 * @property {string} text             Source text of this node.
 * @property {number} startLine        Start line (1-based), inclusive of any leading JSDoc.
 * @property {number} endLine          End line (1-based).
 * @property {number} startColumn
 * @property {number} endColumn
 * @property {CodeNode[]} children     Direct children useful for further inspection (functions, nested types).
 * @property {string} [jsdoc]          JSDoc comment directly attached to this declaration, when present.
 * @property {boolean} [exported]      True when this declaration has an `export` modifier.
 */

/** Result of parsing a source file.
 * @typedef {object} ParsedCode
 * @property {string} filePath
 * @property {string} language
 * @property {string} source
 * @property {CodeNode[]} topLevel     All top-level code constructs that should become chunks.
 * @property {CodeNode[]} declarations All named declarations anywhere in the file, used for symbol lookups.
 * @property {string} [parseError]     Optional error from the underlying parser (does not throw).
 */

/**
 * @typedef {object} CodeParser
 * @property {string} language
 * @property {(filePath: string) => boolean} supports
 * @property {(source: string, filePath: string) => ParsedCode} parse
 */

/**
 * Walk a Tree-sitter subtree, producing CodeNode objects.
 *
 * Stops descending into nodes we consider "leaf chunks" so we don't double
 * count nested symbols. The chunker decides what counts as a chunk.
 *
 * @param {import('tree-sitter').SyntaxNode} node
 * @param {string} source
 * @returns {CodeNode}
 */
export function treeSitterToCodeNode(node, source) {
  const text = source.slice(node.startIndex, node.endIndex);
  const children = [];
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

/**
 * @param {string} type
 * @returns {boolean}
 */
export function isStructuralNode(type) {
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
    'variable_declarator',
    'call_expression',
    'arguments',
    'member_expression',
    'subscript_expression',
    'object',
    'array',
    'assignment_expression',
    'binary_expression',
    'unary_expression',
    'identifier',
    'type_identifier',
    'property_identifier',
    'string',
    'number',
    'true',
    'false',
    'null',
    'template_string',
    'regex',
    'new_expression',
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

/**
 * @param {import('tree-sitter').SyntaxNode} node
 * @returns {string | undefined}
 */
export function extractName(node) {
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

/**
 * @param {import('tree-sitter').SyntaxNode} node
 * @returns {string | undefined}
 */
function findNameChild(node) {
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

/**
 * @param {import('tree-sitter').SyntaxNode} node
 * @returns {string | undefined}
 */
function nameOfNode(node) {
  const field = node.childForFieldName('name');
  if (field) return field.text;
  return findNameChild(node);
}

/**
 * @param {import('tree-sitter').SyntaxNode} node
 * @param {string[]} types
 * @returns {import('tree-sitter').SyntaxNode | undefined}
 */
function findFirstChildOfType(node, types) {
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return undefined;
}