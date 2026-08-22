import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';

import type { CodeNode, CodeParser, ParsedCode } from './types.js';
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
export class TreeSitterCodeParser implements CodeParser {
  public readonly language: string;
  private readonly parser: Parser;
  private readonly tsLang: unknown;
  private readonly tsxLang: unknown;
  private readonly jsLang: unknown;

  constructor() {
    this.parser = new Parser();
    this.tsLang = TypeScript.typescript;
    this.tsxLang = TypeScript.tsx;
    this.jsLang = JavaScript;
    this.language = 'typescript';
  }

  supports(filePath: string): boolean {
    const ext = extOf(filePath);
    return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext);
  }

  private languageFor(filePath: string): unknown {
    const ext = extOf(filePath);
    switch (ext) {
      case 'ts':
      case 'mts':
      case 'cts':
        return this.tsLang;
      case 'tsx':
        return this.tsxLang;
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
      default:
        return this.jsLang;
    }
  }

  parse(source: string, filePath: string): ParsedCode {
    const language = this.languageFor(filePath);
    this.parser.setLanguage(language);
    let tree;
    try {
      const bufferSize = Math.max(32 * 1024, source.length + 1024);
      tree = this.parser.parse(source, undefined, { bufferSize });
    } catch (cause) {
      throw new FileParseError(
        `Tree-sitter failed to parse ${filePath}: ${(cause as Error).message}`,
        filePath,
        { cause: (cause as Error).message }
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

  /** Public helper for tests: find named children of a node. */
  findMethodsInClass(classNode: CodeNode, rootSource: string): CodeNode[] {
    return findMethodsInNode(classNode, rootSource);
  }
}

function collectTopLevel(root: Parser.SyntaxNode, source: string): CodeNode[] {
  const out: CodeNode[] = [];
  for (let i = 0; i < root.childCount; i += 1) {
    const c = root.child(i);
    if (!c) continue;
    if (c.type === 'export_statement') {
      const inner = unwrapExport(c);
      if (inner) {
        const built = treeSitterToCodeNode(inner, source);
        attachMethods(built, inner, source);
        out.push(built);
      }
      continue;
    }
    if (TOP_LEVEL_DECLARATION_TYPES.has(c.type)) {
      const built = treeSitterToCodeNode(c, source);
      attachMethods(built, c, source);
      out.push(built);
    }
  }
  return out;
}

function attachMethods(classNode: CodeNode, rawNode: Parser.SyntaxNode, source: string): void {
  if (classNode.type !== 'class_declaration' && classNode.type !== 'abstract_class_declaration') {
    return;
  }
  const body = rawNode.childForFieldName('body') ?? findFirstChildOfType(rawNode, ['class_body']);
  if (!body) return;
  for (let i = 0; i < body.childCount; i += 1) {
    const c = body.child(i);
    if (!c) continue;
    if (c.type === 'method_definition' || c.type === 'method_signature' || c.type === 'public_field_definition' || c.type === 'abstract_method_signature') {
      classNode.children.push(treeSitterToCodeNode(c, source));
    }
  }
}

function unwrapExport(exportNode: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
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

function collectAllDeclarations(root: Parser.SyntaxNode, source: string): CodeNode[] {
  const out: CodeNode[] = [];
  const seen = new Set<number>();

  function visit(node: Parser.SyntaxNode): void {
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

function findMethodsInNode(classNode: CodeNode, source: string): CodeNode[] {
  // Walk classNode.text structure (re-parse would be redundant); rely on
  // the children already attached by attachMethods.
  return classNode.children.filter(
    (c) => c.type === 'method_definition' || c.type === 'method_signature'
  );
}

function findFirstChildOfType(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | undefined {
  for (let i = 0; i < node.childCount; i += 1) {
    const c = node.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return undefined;
}

function countErrorDescendants(root: Parser.SyntaxNode): number {
  let count = 0;
  function visit(node: Parser.SyntaxNode): void {
    if (node.type === 'ERROR' || node.isMissing) count += 1;
    for (let i = 0; i < node.childCount; i += 1) {
      const c = node.child(i);
      if (c) visit(c);
    }
  }
  visit(root);
  return count;
}

function extOf(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  const slash = path.lastIndexOf('/');
  if (slash > idx) return '';
  return path.slice(idx + 1).toLowerCase();
}
