import { describe, it, expect } from 'vitest';
import { DocumentationChunker } from '../../src/chunkers/documentation-chunker.js';
import { MarkdownParser } from '../../src/parsers/documentation/markdown-parser.js';

const parser = new MarkdownParser();

function chunk(md: string, opts?: { maxChars?: number; overlapChars?: number }): ReturnType<DocumentationChunker['chunk']> {
  const doc = parser.parse(md);
  const chunker = new DocumentationChunker(opts);
  return chunker.chunk(doc);
}

function onlyChildren(out: ReturnType<DocumentationChunker['chunk']>) {
  return out.filter((c) => c.kind === 'child');
}

function onlyParents(out: ReturnType<DocumentationChunker['chunk']>) {
  return out.filter((c) => c.kind === 'parent');
}

describe('DocumentationChunker - section boundaries', () => {
  it('emits one parent + one child per heading', () => {
    const md = `# A

content A

# B

content B
`;
    const out = chunk(md);
    expect(onlyParents(out).map((c) => c.title)).toEqual(['A', 'B']);
    expect(onlyChildren(out).map((c) => c.title)).toEqual(['A', 'B']);
    const childA = onlyChildren(out)[0]!;
    expect(childA.content).toContain('content A');
    const childB = onlyChildren(out)[1]!;
    expect(childB.content).toContain('content B');
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
    expect(out.length).toBe(6); // 3 parents + 3 children
    const children = onlyChildren(out);
    expect(children.map((c) => c.sectionPath)).toEqual([
      ['Authentication'],
      ['Authentication', 'Login'],
      ['Authentication', 'Refresh'],
    ]);
  });

  it('records correct line ranges on child chunks', () => {
    const md = `# Top

intro

## Child

child body

# Next

next body
`;
    const out = chunk(md);
    const children = onlyChildren(out);
    expect(children[0]?.startLine).toBe(1);
    expect(children[0]?.endLine).toBe(4);
    expect(children[1]?.startLine).toBe(5);
    expect(children[1]?.endLine).toBe(8);
    expect(children[2]?.startLine).toBe(9);
    expect(children[2]?.endLine).toBe(12);
  });

  it('child chunks reference the parent chunk by index', () => {
    const md = `# A

body

## B

b body
`;
    const out = chunk(md);
    const parentA = onlyParents(out)[0]!;
    const parentB = onlyParents(out)[1]!;
    const children = onlyChildren(out);
    const childA = children[0]!;
    const childB = children[1]!;
    expect(childA.parentIndex).toBe(out.indexOf(parentA));
    expect(childB.parentIndex).toBe(out.indexOf(parentB));
  });
});

describe('DocumentationChunker - parent / child pairing', () => {
  it('pairs each parent with exactly one child for small sections', () => {
    const md = `# A

body

# B

body
`;
    const out = chunk(md);
    expect(onlyParents(out)).toHaveLength(2);
    expect(onlyChildren(out)).toHaveLength(2);
  });

  it('produces multiple children for a large section but a single parent', () => {
    const para = 'lorem ipsum dolor sit amet '.repeat(50);
    const md = `# Big\n\n${para}\n\n${para}\n\n${para}\n`;
    const out = chunk(md, { maxChars: 400, overlapChars: 80 });
    const parents = onlyParents(out);
    const children = onlyChildren(out);
    expect(parents).toHaveLength(1);
    expect(children.length).toBeGreaterThan(1);
    // All children must reference the same parent index.
    for (const c of children) {
      expect(c.parentIndex).toBe(out.indexOf(parents[0]!));
      expect(c.split).toBe(true);
    }
  });

  it('parent content is compacted when children are split', () => {
    const para = 'word '.repeat(200);
    const md = `# Parent\n\n## Child\n\n${para}\n`;
    const out = chunk(md, { maxChars: 300, overlapChars: 30 });
    const parents = onlyParents(out);
    const children = onlyChildren(out);
    // Child section is large — its parent is compacted, the children are split.
    const childParent = parents.find((p) => p.title === 'Child')!;
    expect(childParent.content.length).toBeLessThanOrEqual(300 + 10);
    const childChildren = children.filter((c) => c.title === 'Child');
    expect(childChildren.length).toBeGreaterThan(1);
    // The split children collectively cover the original body.
    const combined = childChildren.map((c) => c.content).join('\n');
    expect(combined).toContain('word');
  });
});

describe('DocumentationChunker - large section splitting', () => {
  it('splits very large sections into overlapping windows', () => {
    const para = 'lorem ipsum dolor sit amet '.repeat(50);
    const md = `# Big\n\n${para}\n\n${para}\n\n${para}\n`;
    const out = chunk(md, { maxChars: 400, overlapChars: 80 });
    const children = onlyChildren(out);
    expect(children.length).toBeGreaterThan(1);
    for (const c of children) {
      expect(c.content.length).toBeLessThanOrEqual(400 + 80 + 50);
    }
  });

  it('preserves sectionPath across splits', () => {
    const para = 'word '.repeat(200);
    const md = `# Parent\n\n## Child\n\n${para}\n`;
    const out = chunk(md, { maxChars: 300, overlapChars: 30 });
    const children = onlyChildren(out);
    expect(children.length).toBeGreaterThan(1);
    const childChildren = children.filter((c) => c.title === 'Child');
    for (const c of childChildren) {
      expect(c.sectionPath).toEqual(['Parent', 'Child']);
      expect(c.title).toBe('Child');
    }
  });

  it('does not split small sections', () => {
    const md = `# Small\n\nshort content\n`;
    const out = chunk(md, { maxChars: 1000 });
    const children = onlyChildren(out);
    expect(children).toHaveLength(1);
    expect(children[0]!.split).toBe(false);
  });
});

describe('DocumentationChunker - heading hierarchy', () => {
  it('tracks deep heading hierarchies correctly', () => {
    const md = `# A\n\n## A.1\n\n### A.1.a\n\ncontent\n`;
    const out = chunk(md);
    const children = onlyChildren(out);
    expect(children.map((c) => c.sectionPath)).toEqual([
      ['A'],
      ['A', 'A.1'],
      ['A', 'A.1', 'A.1.a'],
    ]);
    expect(children[2]?.depth).toBe(3);
  });

  it('handles sibling sub-trees correctly (#A / ##B / ###C / ##D / #E)', () => {
    const md = `# A\n\n## B\n\n### C\n\nc-body\n\n## D\n\nd-body\n\n# E\n\ne-body\n`;
    const out = chunk(md);
    const children = onlyChildren(out);
    expect(children.map((c) => c.sectionPath)).toEqual([
      ['A'],
      ['A', 'B'],
      ['A', 'B', 'C'],
      ['A', 'D'],
      ['E'],
    ]);
  });

  it('returns one parent + one child for a body without headings', () => {
    const md = 'plain text without any headings\nmore text\n';
    const out = chunk(md);
    const parents = onlyParents(out);
    const children = onlyChildren(out);
    expect(parents).toHaveLength(1);
    expect(children).toHaveLength(1);
    expect(parents[0]!.sectionPath).toEqual([]);
    expect(parents[0]!.title).toBe('Body');
    expect(children[0]!.sectionPath).toEqual([]);
    expect(children[0]!.parentIndex).toBe(0);
  });
});

describe('DocumentationChunker - parent-child retrieval readiness', () => {
  it('produces chunk ids that resolve to the parent chunk', () => {
    const md = `# A\n\n## B\n\nb body\n`;
    const out = chunk(md);
    const parents = onlyParents(out);
    const children = onlyChildren(out);
    expect(children[1]!.parentIndex).toBe(out.indexOf(parents[1]!));
  });
});