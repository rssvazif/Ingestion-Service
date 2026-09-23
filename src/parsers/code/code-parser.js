import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';

import { treeSitterToCodeNode } from './types.js';
import { FileParseError } from '../../errors/index.js';

const TOP_LEVEL_DECLARATION_TYPES = new Set([
  'class_declaration',
  'abstract_class_declaration',
  'function_declaration',
  'generator_function_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'lexical_declaration',
]);

const NESTED_DECLARATION_TYPES = new Set([
  'class_declaration',
  'abstract_class_declaration',
  'function_declaration',
  'generator_function_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'lexical_declaration',
  'method_definition',
  'method_signature',
  'public_field_definition',
  'abstract_method_signature',
]);

/**
 * Tree-sitter based parser for TypeScript / JavaScript source files.
 *
 * Languages are dynamically selected based on file extension so the parser
 * picks the correct grammar. Other languages can be plugged in later via
 * the same CodeParser contract.
 */
export class TreeSitterCodeParser {
  /** @type {string} */
  language = 'typescript';
  /** @type {Parser} */
  #parser;
  /** @type {unknown} */
  #tsLang;
  /** @type {unknown} */
  #tsxLang;
  /** @type {unknown} */
  #jsLang;

  constructor() {
    this.#parser = new Parser();
    this.#tsLang = TypeScript.typescript;
    this.#tsxLang = TypeScript.tsx;
    this.#jsLang = JavaScript;
  }

  /** @param {string} filePath */
  supports(filePath) {
    const ext = extOf(filePath);
    return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext);
  }

  /** @param {string} filePath */
  #languageFor(filePath) {
    const ext = extOf(filePath);
    switch (ext) {
      case 'ts':
      case 'mts':
      case 'cts':
        return this.#tsLang;
      case 'tsx':
        return this.#tsxLang;
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
      default:
        return this.#jsLang;
    }
  }

  /**
   * @param {string} source
   * @param {string} filePath
   * @returns {ParsedCode}
   */
  parse(source, filePath) {
    const language = this.#languageFor(filePath);
    this.#parser.setLanguage(language);
    let tree;
    try {
      const bufferSize = Math.max(32 * 1024, source.length + 1024);
      tree = this.#parser.parse(source, undefined, { bufferSize });
    } catch (cause) {
      throw new FileParseError(
        `Tree-sitter failed to parse ${filePath}: ${cause.message}`,
        filePath,
        { cause: cause.message }
      );
    }

    const root = tree.rootNode;
    const lang = extOf(filePath);
    const langLabel =
      lang === 'tsx' ? 'tsx' : lang === 'ts' || lang === 'mts' || lang === 'cts' ? 'ts' : 'js';

    if (root.hasError) {
      const errCount = countErrorDescendants(root);
      return {
        filePath,
        language: langLabel,
        source,
        topLevel: collectTopLevel(root, source),
        declarations: collectAllDeclarations(root, source),
        parseError: `Tree-sitter reported ${errCount} parse error node(s)`,
      };
    }

    return {
      filePath,
      language: langLabel,
      source,
      topLevel: collectTopLevel(root, source),
      declarations: collectAllDeclarations(root, source),
    };
  }

  /** Public helper for tests: find named children of a node.
   * @param {CodeNode} classNode
   * @param {string} rootSource
   * @returns {CodeNode[]}
   */
  findMethodsInClass(classNode, rootSource) {
    return findMethodsInNode(classNode, rootSource);
  }
}

/**
 * @param {Parser.SyntaxNode} root
 * @param {string} source
 * @returns {CodeNode[]}
 */
function collectTopLevel(root, source) {
  const out = [];
  for (let i = 0; i < root.childCount; i += 1) {
    const c = root.child(i);
    if (!c) continue;
    if (c.type === 'export_statement') {
      const inner = unwrapExport(c);
      if (inner) {
        const built = treeSitterToCodeNode(inner, source);
        attachJsDoc(built, inner, source);
        attachExportedFlag(built, inner, true);
        attachMethods(built, inner, source);
        out.push(built);
      }
      continue;
    }
    if (TOP_LEVEL_DECLARATION_TYPES.has(c.type)) {
      const built = treeSitterToCodeNode(c, source);
      attachJsDoc(built, c, source);
      attachMethods(built, c, source);
      out.push(built);
    }
  }
  return out;
}

/**
 * @param {CodeNode} classNode
 * @param {Parser.SyntaxNode} rawNode
 * @param {string} source
 */
function attachMethods(classNode, rawNode, source) {
  if (classNode.type !== 'class_declaration' && classNode.type !== 'abstract_class_declaration') {
    return;
  }
  const body = rawNode.childForFieldName('body') ?? findFirstChildOfType(rawNode, ['class_body']);
  if (!body) return;
  for (let i = 0; i < body.childCount; i += 1) {
    const c = body.child(i);
    if (!c) continue;
    if (c.type === 'method_definition' || c.type === 'method_signature' || c.type === 'public_field_definition' || c.type === 'abstract_method_signature') {
      const childNode = treeSitterToCodeNode(c, source);
      attachJsDoc(childNode, c, source);
      classNode.children.push(childNode);
    }
  }
}

/**
 * Attach the JSDoc comment that directly precedes a declaration to its
 * CodeNode. Walks the previous-sibling chain and collects consecutive
 * comment nodes. The first non-comment sibling (or end of chain) ends the
 * collection, so unrelated comments are never attached.
 *
 * @param {CodeNode} node
 * @param {Parser.SyntaxNode} rawNode
 * @param {string} source
 */
function attachJsDoc(node, rawNode, source) {
  const collected = [];
  let prev = rawNode.previousSibling;
  while (prev && prev.type === 'comment') {
    const text = source.slice(prev.startIndex, prev.endIndex);
    collected.unshift(text);
    prev = prev.previousSibling;
  }
  if (collected.length === 0) return;
  const joined = collected.join('\n');
  // Only attach block comments that look like JSDoc (/** ... */).
  if (!joined.includes('/**')) return;
  node.jsdoc = joined;
  // Extend the startLine to include the JSDoc, when it is directly above.
  const jsDocStartLine = rawNode.startPosition.row - collected.length + 1;
  if (jsDocStartLine > 0 && jsDocStartLine < node.startLine) {
    node.startLine = jsDocStartLine;
  }
}

/**
 * @param {CodeNode} node
 * @param {Parser.SyntaxNode} _rawNode
 * @param {boolean} value
 */
function attachExportedFlag(node, _rawNode, value) {
  node.exported = value;
}

/**
 * @param {Parser.SyntaxNode} exportNode
 * @returns {Parser.SyntaxNode | undefined}
 */
function unwrapExport(exportNode) {
  for (let i = 0; i < exportNode.childCount; i += 1) {
    const c = exportNode.child(i);
    if (!c) continue;
    if (TOP_LEVEL_DECLARATION_TYPES.has(c.type)) return c;
    if (c.type === 'default') continue;
    if (c.type === 'export_clause' || c.type === 'export_specifier') continue;
    if (c.isNamed) return c;
  }
  return undefined;
}

/**
 * @param {Parser.SyntaxNode} root
 * @param {string} source
 * @returns {CodeNode[]}
 */
function collectAllDeclarations(root, source) {
  const out = [];
  const seen = new Set();

  /** @param {Parser.SyntaxNode} node */
  function visit(node) {
    if (seen.has(node.id)) return;
    if (NESTED_DECLARATION_TYPES.has(node.type)) {
      out.push(treeSitterToCodeNode(node, source));
      seen.add(node.id);
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const c = node.child(i);
      if (c) visit(c);
    }
  }

  visit(root);
  return out;
}

/**
 * @param {CodeNode} classNode
 * @param {string} _source
 * @returns {CodeNode[]}
 */
function findMethodsInNode(classNode, _source) {
  // Walk classNode.text structure (re-parse would be redundant); rely on
  // the children already attached by attachMethods.
  return classNode.children.filter(
    (c) => c.type === 'method_definition' || c.type === 'method_signature'
  );
}

/**
 * @param {Parser.SyntaxNode} node
 * @param {string[]} types
 * @returns {Parser.SyntaxNode | undefined}
 */
function findFirstChildOfType(node, types) {
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return undefined;
}

/**
 * @param {Parser.SyntaxNode} root
 * @returns {number}
 */
function countErrorDescendants(root) {
  let count = 0;
  /** @param {Parser.SyntaxNode} node */
  function visit(node) {
    if (node.type === 'ERROR' || node.isMissing) count += 1;
    for (let i = 0; i < node.childCount; i += 1) {
      const c = node.child(i);
      if (c) visit(c);
    }
  }
  visit(root);
  return count;
}

/**
 * @param {string} path
 * @returns {string}
 */
function extOf(path) {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  const slash = path.lastIndexOf('/');
  if (slash > idx) return '';
  return path.slice(idx + 1).toLowerCase();
}