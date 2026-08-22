import type { ParsedDocumentation } from '../parsers/documentation/types.js';
import type {
  DocumentationChunk,
  DocumentationChunkerOptions,
} from './documentation-chunker-types.js';

export type { DocumentationChunk, DocumentationChunkerOptions } from './documentation-chunker-types.js';

/**
 * Splits a parsed Markdown document into logical sections based on heading
 * hierarchy. A "section" runs from one heading to the next heading of equal
 * or shallower depth.
 */
export class DocumentationChunker {
  private readonly maxChars: number;
  private readonly overlapChars: number;

  constructor(options: DocumentationChunkerOptions = {}) {
    this.maxChars = options.maxChars ?? 2000;
    this.overlapChars = options.overlapChars ?? 150;
  }

  chunk(doc: ParsedDocumentation): DocumentationChunk[] {
    const headings = doc.headings;
    if (headings.length === 0) {
      const end = lastLine(doc.source);
      return [
        {
          section: [],
          title: 'Body',
          depth: 0,
          startLine: 1,
          endLine: end,
          content: doc.source.trim(),
          split: false,
        },
      ];
    }

    const chunks: DocumentationChunk[] = [];
    for (let i = 0; i < headings.length; i += 1) {
      const h = headings[i]!;
      const next = headings[i + 1];
      const sectionEndLine = next ? next.startLine - 1 : lastLine(doc.source);
      const sectionContent = sliceLines(doc.source, h.startLine, sectionEndLine).trim();
      const sectionPath = sectionPathUpTo(doc.headings, h, i);
      const base: Omit<DocumentationChunk, 'content'> = {
        section: sectionPath,
        title: h.text,
        depth: h.depth,
        startLine: h.startLine,
        endLine: sectionEndLine,
        split: false,
      };
      if (sectionContent.length <= this.maxChars) {
        chunks.push({ ...base, content: sectionContent, split: false });
        continue;
      }
      const splitChunks = this.splitLargeSection(sectionContent, base);
      chunks.push(...splitChunks);
    }

    return chunks;
  }

  private splitLargeSection(
    content: string,
    base: Omit<DocumentationChunk, 'content'>
  ): DocumentationChunk[] {
    const lines = content.split('\n');
    const windows: { startLine: number; endLine: number; text: string }[] = [];
    let currentText = '';
    let startLine = base.startLine;
    let currentLine = base.startLine;
    let buffer: string[] = [];

    const flush = (): void => {
      if (buffer.length === 0) return;
      const text = buffer.join('\n').trim();
      if (text.length > 0) {
        windows.push({ startLine, endLine: currentLine, text });
      }
    };

    for (const line of lines) {
      currentLine += 1;
      const candidate = currentText.length === 0 ? line : currentText + '\n' + line;
      if (candidate.length > this.maxChars && currentText.length > 0) {
        flush();
        const tail = currentText.slice(Math.max(0, currentText.length - this.overlapChars));
        buffer = tail ? [tail] : [];
        currentText = tail;
        startLine = Math.max(base.startLine, currentLine - tail.split('\n').length);
      } else {
        currentText = candidate;
        buffer.push(line);
      }
    }
    flush();

    return windows.map(
      (w): DocumentationChunk => ({
        ...base,
        startLine: w.startLine,
        endLine: w.endLine,
        content: w.text,
        split: true,
      })
    );
  }
}

function sectionPathUpTo(
  headings: ParsedDocumentation['headings'],
  current: ParsedDocumentation['headings'][number],
  currentIndex: number
): string[] {
  const path: string[] = [];
  let targetDepth = current.depth - 1;
  for (let i = currentIndex - 1; i >= 0 && targetDepth >= 1; i -= 1) {
    const h = headings[i]!;
    if (h.depth === targetDepth) {
      path.unshift(h.text);
      targetDepth -= 1;
    }
  }
  path.push(current.text);
  return path;
}

function lastLine(text: string): number {
  return text.length === 0 ? 1 : text.split('\n').length;
}

function sliceLines(text: string, startLine: number, endLine: number): string {
  const lines = text.split('\n');
  return lines.slice(startLine - 1, endLine).join('\n');
}
