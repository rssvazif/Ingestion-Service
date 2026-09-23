import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent, Heading, Code, Link, Paragraph, PhrasingContent } from 'mdast';

import type {
  MarkdownCodeBlock,
  MarkdownHeading,
  MarkdownLink,
  MarkdownParserOptions,
  ParsedDocumentation,
} from './types.js';
import { FileParseError } from '../../errors/index.js';

/**
 * Parses a raw Markdown string into a structured representation.
 *
 * This parser does NOT use an LLM. It uses remark-parse (unified) to build
 * a proper MDAST and then derives the flat structures that chunkers need.
 */
export class MarkdownParser {
  private readonly maxBytes: number;
  private readonly processor: ReturnType<typeof unified>;

  constructor(options: MarkdownParserOptions = {}) {
    this.maxBytes = options.maxBytes ?? 5_000_000;
    this.processor = unified().use(remarkParse) as unknown as ReturnType<typeof unified>;
  }

  parse(content: string, metadata?: { filePath?: string }): ParsedDocumentation {
    if (Buffer.byteLength(content, 'utf8') > this.maxBytes) {
      throw new FileParseError(
        `Markdown document exceeds maximum size of ${this.maxBytes} bytes`,
        metadata?.filePath ?? '<unknown>',
        { maxBytes: this.maxBytes }
      );
    }
    let ast: Root;
    try {
      ast = this.processor.parse(content) as Root;
    } catch (cause) {
      throw new FileParseError(
        `Failed to parse Markdown: ${(cause as Error).message}`,
        metadata?.filePath ?? '<unknown>',
        { cause: (cause as Error).message }
      );
    }

    const headings: MarkdownHeading[] = [];
    const codeBlocks: MarkdownCodeBlock[] = [];
    const links: MarkdownLink[] = [];
    const topLevel: ParsedDocumentation['topLevel'] = [];

    for (const node of ast.children) {
      const startLine = node.position?.start?.line ?? 1;
      const endLine = node.position?.end?.line ?? startLine;
      topLevel.push({ node, startLine, endLine });
      this.collect(node, headings, codeBlocks, links);
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

  private collect(
    node: RootContent | PhrasingContent,
    headings: MarkdownHeading[],
    codeBlocks: MarkdownCodeBlock[],
    links: MarkdownLink[]
  ): void {
    switch (node.type) {
      case 'heading': {
        const h = node as Heading;
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
        const c = node as Code;
        codeBlocks.push({
          language: c.lang ?? undefined,
          value: c.value,
          startLine: c.position?.start?.line ?? 1,
          endLine: c.position?.end?.line ?? c.position?.start?.line ?? 1,
        });
        break;
      }
      case 'link': {
        const l = node as Link;
        links.push({
          text: textFromChildren(l.children),
          url: l.url,
          startLine: l.position?.start?.line ?? 1,
        });
        break;
      }
      case 'paragraph': {
        const p = node as Paragraph;
        for (const child of p.children) this.collect(child, headings, codeBlocks, links);
        break;
      }
      case 'list':
      case 'blockquote':
      case 'table':
      case 'tableRow':
      case 'tableCell':
      case 'listItem':
        for (const child of (node as { children?: unknown[] }).children ?? []) {
          this.collect(child as PhrasingContent, headings, codeBlocks, links);
        }
        break;
      default:
        break;
    }
  }
}

function textFromChildren(children: PhrasingContent[]): string {
  let out = '';
  for (const c of children) {
    if (c.type === 'text' || c.type === 'inlineCode') {
      out += (c as { value: string }).value;
    } else if ('children' in c && Array.isArray((c as { children: unknown[] }).children)) {
      out += textFromChildren((c as { children: PhrasingContent[] }).children);
    }
  }
  return out.trim();
}

function rawFromNode(node: { position?: { start?: { offset?: number; line?: number }; end?: { offset?: number; line?: number } } } & { type?: string }): string {
  if (!node.position?.start?.offset || !node.position?.end?.offset) return '';
  return ''; // raw slice is filled in lazily by the chunker to avoid double work
}
