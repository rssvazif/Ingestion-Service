import { unified } from 'unified';
import remarkParse from 'remark-parse';

import { FileParseError } from '../../errors/index.js';

/**
 * Parses a raw Markdown string into a structured representation.
 *
 * This parser does NOT use an LLM. It uses remark-parse (unified) to build
 * a proper MDAST and then derives the flat structures that chunkers need.
 */
export class MarkdownParser {
  /** @type {number} */
  #maxBytes;
  /** @type {ReturnType<typeof unified>} */
  #processor;

  /** @param {MarkdownParserOptions} [options] */
  constructor(options = {}) {
    this.#maxBytes = options.maxBytes ?? 5_000_000;
    this.#processor = unified().use(remarkParse);
  }

  /**
   * @param {string} content
   * @param {{ filePath?: string }} [metadata]
   * @returns {ParsedDocumentation}
   */
  parse(content, metadata) {
    if (Buffer.byteLength(content, 'utf8') > this.#maxBytes) {
      throw new FileParseError(
        `Markdown document exceeds maximum size of ${this.#maxBytes} bytes`,
        metadata?.filePath ?? '<unknown>',
        { maxBytes: this.#maxBytes }
      );
    }
    let ast;
    try {
      ast = this.#processor.parse(content);
    } catch (cause) {
      throw new FileParseError(
        `Failed to parse Markdown: ${cause.message}`,
        metadata?.filePath ?? '<unknown>',
        { cause: cause.message }
      );
    }

    const headings = [];
    const codeBlocks = [];
    const links = [];
    const topLevel = [];

    for (const node of ast.children) {
      const startLine = node.position?.start?.line ?? 1;
      const endLine = node.position?.end?.line ?? startLine;
      topLevel.push({ node, startLine, endLine });
      this.#collect(node, headings, codeBlocks, links);
    }

    return {
      source: content,
      headings,
      codeBlocks,
      links,
      ast,
      topLevel,
    };
  }

  /**
   * @param {import('mdast').RootContent | import('mdast').PhrasingContent} node
   * @param {MarkdownHeading[]} headings
   * @param {MarkdownCodeBlock[]} codeBlocks
   * @param {MarkdownLink[]} links
   */
  #collect(node, headings, codeBlocks, links) {
    switch (node.type) {
      case 'heading': {
        const h = node;
        headings.push({
          depth: h.depth,
          text: textFromChildren(h.children),
          raw: rawFromNode(h),
          startLine: h.position?.start?.line ?? 1,
          endLine: h.position?.end?.line ?? h.position?.start?.line ?? 1,
        });
        break;
      }
      case 'code': {
        const c = node;
        codeBlocks.push({
          language: c.lang ?? undefined,
          value: c.value,
          startLine: c.position?.start?.line ?? 1,
          endLine: c.position?.end?.line ?? c.position?.start?.line ?? 1,
        });
        break;
      }
      case 'link': {
        const l = node;
        links.push({
          text: textFromChildren(l.children),
          url: l.url,
          startLine: l.position?.start?.line ?? 1,
        });
        break;
      }
      case 'paragraph': {
        const p = node;
        for (const child of p.children) this.#collect(child, headings, codeBlocks, links);
        break;
      }
      case 'list':
      case 'blockquote':
      case 'table':
      case 'tableRow':
      case 'tableCell':
      case 'listItem':
        for (const child of (node.children ?? [])) {
          this.#collect(child, headings, codeBlocks, links);
        }
        break;
      default:
        break;
    }
  }
}

/**
 * @param {import('mdast').PhrasingContent[]} children
 * @returns {string}
 */
function textFromChildren(children) {
  let out = '';
  for (const c of children) {
    if (c.type === 'text' || c.type === 'inlineCode') {
      out += c.value;
    } else if ('children' in c && Array.isArray(c.children)) {
      out += textFromChildren(c.children);
    }
  }
  return out.trim();
}

/**
 * @param {{ position?: { start?: { offset?: number, line?: number }, end?: { offset?: number, line?: number } } }} node
 * @returns {string}
 */
function rawFromNode(node) {
  if (!node.position?.start?.offset || !node.position?.end?.offset) return '';
  return ''; // raw slice is filled in lazily by the chunker to avoid double work
}