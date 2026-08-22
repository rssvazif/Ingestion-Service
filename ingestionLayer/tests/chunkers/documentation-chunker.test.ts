import { describe, it, expect } from 'vitest';
import { DocumentationChunker } from '../../src/chunkers/documentation-chunker.js';
import { MarkdownParser } from '../../src/parsers/documentation/markdown-parser.js';

const parser = new MarkdownParser();

function chunk(md: string, opts?: { maxChars?: number; overlapChars?: number }): ReturnType<DocumentationChunker['chunk']> {
  const doc = parser.parse(md);
  const chunker = new DocumentationChunker(opts);
  return chunker.chunk(doc);
}

describe('DocumentationChunker - section boundaries', () => {
  it('creates one chunk per heading', () => {
    const md = `# A

content A

# B

content B
`;
    const out = chunk(md);
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('A');
    expect(out[1]?.title).toBe('B');
    expect(out[0]?.content).toContain('content A');
    expect(out[1]?.content).toContain('content B');
  });

  it('attaches nested children to their parent section path', () => {
    const md = `# Authentication

intro

## Login

login content

## Refresh

refresh content
`;
    const out = chunk(md);
    // 3 chunks: Authentication, Login, Refresh
    expect(out).toHaveLength(3);
    expect(out[0]?.section).toEqual(['Authentication']);
    expect(out[1]?.section).toEqual(['Authentication', 'Login']);
    expect(out[2]?.section).toEqual(['Authentication', 'Refresh']);
  });

  it('records correct line ranges', () => {
    const md = `# Top

intro

## Child

child body

# Next

next body
`;
    const out = chunk(md);
    expect(out).toHaveLength(3);
    expect(out[0]?.startLine).toBe(1);
    // Top section ends at line just before Child (line 5)
    expect(out[0]?.endLine).toBe(4);
    expect(out[1]?.startLine).toBe(5);
    // Child section ends at line just before Next (line 9)
    expect(out[1]?.endLine).toBe(8);
    expect(out[2]?.startLine).toBe(9);
    expect(out[2]?.endLine).toBe(12);
  });
});

describe('DocumentationChunker - large section splitting', () => {
  it('splits very large sections into overlapping windows', () => {
    const para = 'lorem ipsum dolor sit amet '.repeat(50);
    const md = `# Big\n\n${para}\n\n${para}\n\n${para}\n`;
    const out = chunk(md, { maxChars: 400, overlapChars: 80 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.split)).toBe(true);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(400 + 80 + 50);
    }
  });

  it('preserves heading path metadata across splits', () => {
    const para = 'word '.repeat(200);
    const md = `# Parent\n\n## Child\n\n${para}\n`;
    const out = chunk(md, { maxChars: 300, overlapChars: 30 });
    expect(out.length).toBeGreaterThan(1);
    const childChunks = out.filter((c) => c.title === 'Child');
    expect(childChunks.length).toBeGreaterThan(1);
    for (const c of childChunks) {
      expect(c.section).toEqual(['Parent', 'Child']);
    }
  });

  it('does not split sections that fit within maxChars', () => {
    const md = `# Small\n\nshort content\n`;
    const out = chunk(md, { maxChars: 1000 });
    expect(out).toHaveLength(1);
    expect(out[0]?.split).toBe(false);
  });
});

describe('DocumentationChunker - heading hierarchy', () => {
  it('tracks deep heading hierarchies correctly', () => {
    const md = `# A\n\n## A.1\n\n### A.1.a\n\ncontent\n`;
    const out = chunk(md);
    expect(out).toHaveLength(3);
    expect(out[0]?.section).toEqual(['A']);
    expect(out[1]?.section).toEqual(['A', 'A.1']);
    expect(out[2]?.section).toEqual(['A', 'A.1', 'A.1.a']);
    expect(out[2]?.depth).toBe(3);
  });

  it('returns a single body chunk when there are no headings', () => {
    const md = 'plain text without any headings\nmore text\n';
    const out = chunk(md);
    expect(out).toHaveLength(1);
    expect(out[0]?.section).toEqual([]);
    expect(out[0]?.title).toBe('Body');
  });
});
