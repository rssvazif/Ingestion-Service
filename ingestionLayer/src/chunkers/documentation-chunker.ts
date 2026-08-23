import type { ParsedDocumentation, MarkdownHeading } from '../parsers/documentation/types.js';
import type {
  DocumentationChunk,
  DocumentationChunkerOptions,
} from './documentation-chunker-types.js';

export type { DocumentationChunk, DocumentationChunkerOptions } from './documentation-chunker-types.js';

/**
 * Splits a parsed Markdown document into logical sections based on heading
 * hierarchy and emits a parent/child pair for each section.
 *
 * - A `parent` chunk represents the full section content (or a compact
 *   summary when the section is large). Parent chunks restore context
 *   after a child has been retrieved.
 * - One or more `child` chunks are emitted for the same section. Each
 *   child carries a `parentIndex` pointing at the corresponding parent
 *   chunk in the same output list. Small sections produce a single child;
 *   large sections produce several overlapping fragments — all children
 *   preserve the same `sectionPath` so hierarchy survives splitting.
 */
export class DocumentationChunker {
  private readonly maxChars: number;
  private readonly overlapChars: number;

  constructor(options: DocumentationChunkerOptions = {}) {
    this.maxChars = options.maxChars ?? 2000;
    this.overlapChars = options.overlapChars ?? 150;
  }

  chunk(doc: ParsedDocumentation): DocumentationChunk[] {
    const sections = buildSections(doc);
    if (sections.length === 0) {
      const end = lastLine(doc.source);
      const body: DocumentationChunk = {
        kind: 'parent',
        section: [],
        sectionPath: [],
        title: 'Body',
        depth: 0,
        startLine: 1,
        endLine: end,
        content: doc.source.trim(),
        split: false,
      };
      // Emit one parent + one child for the implicit "Body" section so
      // the parent/child flow always has both halves.
      const child: DocumentationChunk = {
        ...body,
        kind: 'child',
        parentIndex: 0,
        content: body.content,
      };
      return [body, child];
    }

    const out: DocumentationChunk[] = [];
    // First pass: emit one parent chunk per section. Record the parent's
    // index in the output list so children can reference it later.
    for (const section of sections) {
      const parentContent = section.content;
      const parent: DocumentationChunk = {
        kind: 'parent',
        section: section.sectionPath,
        sectionPath: section.sectionPath,
        title: section.title,
        depth: section.depth,
        startLine: section.startLine,
        endLine: section.endLine,
        content: parentContent,
        split: false,
      };
      out.push(parent);
    }
    // Second pass: emit children. Children for a small section are a
    // single chunk with the same content; for a large section they are
    // overlapping fragments. Each child carries `parentIndex` pointing
    // at the matching parent in the output list.
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i]!;
      const parentIndex = i;
      const parent = out[i]!;
      if (section.content.length <= this.maxChars) {
        out.push({
          kind: 'child',
          parentIndex,
          section: section.sectionPath,
          sectionPath: section.sectionPath,
          title: section.title,
          depth: section.depth,
          startLine: section.startLine,
          endLine: section.endLine,
          content: section.content,
          split: false,
        });
        continue;
      }
      const fragments = this.splitLargeSection(section.content, {
        startLine: section.startLine,
        endLine: section.endLine,
      });
      for (const f of fragments) {
        out.push({
          kind: 'child',
          parentIndex,
          section: section.sectionPath,
          sectionPath: section.sectionPath,
          title: section.title,
          depth: section.depth,
          startLine: f.startLine,
          endLine: f.endLine,
          content: f.text,
          split: true,
        });
      }
      // Update parent content to a compact summary so the parent does not
      // duplicate the entire split fragment set.
      parent.content = this.compactSummary(section.content, this.maxChars);
    }
    return out;
  }

  private compactSummary(content: string, maxChars: number): string {
    const trimmed = content.trim();
    if (trimmed.length <= maxChars) return trimmed;
    const truncated = trimmed.slice(0, maxChars);
    const lastBreak = truncated.lastIndexOf('\n\n');
    if (lastBreak > maxChars / 2) return truncated.slice(0, lastBreak) + '\n\n...';
    return truncated + '\n\n...';
  }

  private splitLargeSection(
    content: string,
    base: { startLine: number; endLine: number }
  ): { startLine: number; endLine: number; text: string }[] {
    /**
     * Character-based window split. Each window is at most `maxChars`
     * characters; we prefer to break at a `\n\n` paragraph boundary,
     * falling back to `\n` line boundaries, then to hard character
     * slicing when a single line exceeds the limit. Windows overlap by
     * `overlapChars` characters.
     */
    const windows: { startLine: number; endLine: number; text: string }[] = [];
    if (content.length === 0) return windows;

    // Build a sorted list of newline offsets so we can map character
    // offsets to source line numbers in O(log N).
    const newlineOffsets: number[] = [];
    for (let i = 0; i < content.length; i += 1) {
      if (content.charCodeAt(i) === 10 /* \n */) {
        newlineOffsets.push(i + 1);
      }
    }
    const offsetToLineOffset = (offset: number): number => {
      if (offset <= 0 || newlineOffsets.length === 0) return 0;
      let lo = 0;
      let hi = newlineOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        const v = newlineOffsets[mid]!;
        if (v <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    let start = 0;
    let lastEnd = -1;
    while (start < content.length) {
      let end = Math.min(start + this.maxChars, content.length);
      if (end < content.length) {
        const slice = content.slice(start, end);
        let breakAt = slice.lastIndexOf('\n\n');
        if (breakAt <= this.maxChars / 2) {
          breakAt = slice.lastIndexOf('\n');
        }
        if (breakAt > 0) {
          end = start + breakAt;
        }
      }
      // Skip duplicate windows (e.g. empty trailing fragments).
      if (end > lastEnd) {
        const text = content.slice(start, end).trim();
        if (text.length > 0) {
          const startLine = base.startLine + offsetToLineOffset(start);
          const endLine = base.startLine + offsetToLineOffset(Math.max(end - 1, start));
          windows.push({ startLine, endLine, text });
        }
        lastEnd = end;
      }
      if (end >= content.length) break;
      // Advance past the break (and over the trailing newline) so the
      // next window actually progresses.
      let nextStart = end - this.overlapChars;
      if (nextStart <= start) nextStart = start + 1;
      // If we broke at `\n\n` or `\n`, skip the newline characters so
      // the next window doesn't start in the middle of a separator.
      while (nextStart < content.length && content.charCodeAt(nextStart) === 10) {
        nextStart += 1;
      }
      start = nextStart;
    }

    return windows;
  }
}

interface Section {
  title: string;
  depth: number;
  startLine: number;
  endLine: number;
  content: string;
  sectionPath: string[];
  parentTitle: string | undefined;
}

/**
 * Convert a flat heading list + the full document into an array of
 * "sections" — each section runs from its heading line to the next
 * heading of equal-or-shallower depth. The section's `sectionPath`
 * contains every ancestor heading title (oldest first) plus the
 * section's own title.
 */
function buildSections(doc: ParsedDocumentation): Section[] {
  const headings = doc.headings;
  if (headings.length === 0) return [];

  const sections: Section[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!;
    const next = headings[i + 1];
    const sectionEndLine = next ? next.startLine - 1 : lastLine(doc.source);
    const content = sliceLines(doc.source, h.startLine, sectionEndLine).trim();
    const sectionPath = sectionPathUpTo(doc.headings, h, i);
    sections.push({
      title: h.text,
      depth: h.depth,
      startLine: h.startLine,
      endLine: sectionEndLine,
      content,
      sectionPath,
      parentTitle: sectionPath.length >= 2 ? sectionPath[sectionPath.length - 2] : undefined,
    });
  }
  return sections;
}

function sectionPathUpTo(
  headings: MarkdownHeading[],
  current: MarkdownHeading,
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