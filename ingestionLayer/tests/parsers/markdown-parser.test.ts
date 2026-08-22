import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../../src/parsers/documentation/markdown-parser.js';

describe('MarkdownParser - basic', () => {
  const parser = new MarkdownParser();

  it('extracts heading text and depth', () => {
    const doc = parser.parse('# Hello\n');
    expect(doc.headings).toEqual([
      expect.objectContaining({ depth: 1, text: 'Hello' }),
    ]);
  });

  it('handles nested headings', () => {
    const md = `# A

## A.1

### A.1.a

## A.2
`;
    const doc = parser.parse(md);
    expect(doc.headings.map((h) => `${h.depth}:${h.text}`)).toEqual([
      '1:A',
      '2:A.1',
      '3:A.1.a',
      '2:A.2',
    ]);
  });

  it('records code block language and value', () => {
    const md = '```ts\nconst x = 1;\n```\n';
    const doc = parser.parse(md);
    expect(doc.codeBlocks).toHaveLength(1);
    expect(doc.codeBlocks[0]?.language).toBe('ts');
    expect(doc.codeBlocks[0]?.value).toBe('const x = 1;');
  });

  it('captures start/end line positions for code blocks', () => {
    const md = 'intro line\n\n```js\nconsole.log(1)\n```\n';
    const doc = parser.parse(md);
    expect(doc.codeBlocks[0]?.startLine).toBe(3);
    expect(doc.codeBlocks[0]?.endLine).toBe(5);
  });

  it('extracts link text and URL', () => {
    const md = 'See [the docs](https://example.com) for details.\n';
    const doc = parser.parse(md);
    expect(doc.links[0]).toMatchObject({ text: 'the docs', url: 'https://example.com' });
  });

  it('exposes the raw MDAST tree', () => {
    const doc = parser.parse('# Title\n\nparagraph\n');
    expect(doc.ast.type).toBe('root');
    expect(Array.isArray(doc.ast.children)).toBe(true);
    expect(doc.ast.children.length).toBeGreaterThan(0);
  });

  it('preserves the full source string', () => {
    const src = '# Title\n\nbody\n';
    expect(parser.parse(src).source).toBe(src);
  });

  it('handles empty input', () => {
    const doc = parser.parse('');
    expect(doc.headings).toEqual([]);
    expect(doc.codeBlocks).toEqual([]);
    expect(doc.links).toEqual([]);
  });

  it('throws FileParseError on oversized input', () => {
    const small = new MarkdownParser({ maxBytes: 5 });
    expect(() => small.parse('# a very long heading\n')).toThrow();
  });

  it('records top-level node line positions', () => {
    const md = '# A\n\npara\n\n# B\n';
    const doc = parser.parse(md);
    expect(doc.topLevel.map((t) => t.startLine)).toEqual([1, 3, 5]);
  });
});

describe('MarkdownParser - heading hierarchy', () => {
  const parser = new MarkdownParser();

  it('preserves heading levels across long documents', () => {
    const lines = ['# Lvl1'];
    for (let i = 1; i <= 5; i += 1) lines.push(`## Lvl2-${i}`);
    lines.push('# Lvl1-again');
    const md = lines.join('\n') + '\n';
    const doc = parser.parse(md);
    expect(doc.headings.map((h) => h.depth)).toEqual([1, 2, 2, 2, 2, 2, 1]);
  });
});
