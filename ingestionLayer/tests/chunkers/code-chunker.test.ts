import { describe, it, expect } from 'vitest';
import { CodeChunker } from '../../src/chunkers/code-chunker.js';
import { TreeSitterCodeParser } from '../../src/parsers/code/code-parser.js';

const parser = new TreeSitterCodeParser();

function chunks(src: string, path: string, opts?: ConstructorParameters<typeof CodeChunker>[0]): ReturnType<CodeChunker['chunk']> {
  const parsed = parser.parse(src, path);
  return new CodeChunker(opts).chunk(parsed);
}

describe('CodeChunker - class extraction', () => {
  it('produces a class chunk and one chunk per method', () => {
    const src = `export class UserService {
  async findUser(id: string): Promise<User> {
    return this.repo.find(id);
  }

  async addUser(input: NewUser): Promise<User> {
    return this.repo.save(input);
  }
}
`;
    const out = chunks(src, 'src/services/user.service.ts');
    const classChunk = out.find((c) => c.symbolType === 'class');
    expect(classChunk?.symbol).toBe('UserService');
    expect(classChunk?.content).toContain('class UserService');
    const methods = out.filter((c) => c.symbolType === 'method');
    expect(methods.map((m) => m.symbol).sort()).toEqual([
      'UserService.addUser',
      'UserService.findUser',
    ]);
    expect(methods[0]?.parentSymbol).toBe('UserService');
  });

  it('preserves the actual source content for each method', () => {
    const src = `export class A {
  hello() {
    return 'hi';
  }
}
`;
    const out = chunks(src, 'src/a.ts');
    const m = out.find((c) => c.symbolType === 'method');
    expect(m?.content).toContain('return');
    expect(m?.content).toContain("'hi'");
    expect(m?.content).toContain('hello');
  });
});

describe('CodeChunker - functions & variables', () => {
  it('extracts top-level function declarations', () => {
    const src = `export function greet(name: string): string {
  return 'Hello ' + name;
}
`;
    const out = chunks(src, 'src/greet.ts');
    expect(out[0]?.symbol).toBe('greet');
    expect(out[0]?.symbolType).toBe('function');
    expect(out[0]?.language).toBe('ts');
  });

  it('extracts lexical declarations (export const)', () => {
    const src = `export const DEFAULT_PORT = 8080;\n`;
    const out = chunks(src, 'src/config.ts');
    expect(out[0]?.symbol).toBe('DEFAULT_PORT');
    expect(out[0]?.symbolType).toBe('variable');
    expect(out[0]?.content).toContain('8080');
  });

  it('extracts type aliases', () => {
    const src = `export type Nullable<T> = T | null;\n`;
    const out = chunks(src, 'src/types/util.ts');
    expect(out[0]?.symbol).toBe('Nullable');
    expect(out[0]?.symbolType).toBe('type');
    expect(out[0]?.content).toContain('T | null');
  });

  it('extracts interfaces', () => {
    const src = `export interface User {
  id: string;
  name: string;
}
`;
    const out = chunks(src, 'src/types/user.ts');
    expect(out[0]?.symbol).toBe('User');
    expect(out[0]?.symbolType).toBe('interface');
  });

  it('extracts enums', () => {
    const src = `export enum Role {\n  Admin = 'admin'\n}\n`;
    const out = chunks(src, 'src/types/role.ts');
    expect(out[0]?.symbol).toBe('Role');
    expect(out[0]?.symbolType).toBe('enum');
  });
});

describe('CodeChunker - line ranges', () => {
  it('records correct start/end lines for methods', () => {
    const src = `export class A {
  foo() {
    return 1;
  }
  bar() {
    return 2;
  }
}
`;
    const out = chunks(src, 'src/a.ts');
    const foo = out.find((c) => c.symbol === 'A.foo');
    const bar = out.find((c) => c.symbol === 'A.bar');
    expect(foo?.startLine).toBe(2);
    expect(foo?.endLine).toBe(4);
    expect(bar?.startLine).toBe(5);
    expect(bar?.endLine).toBe(7);
  });
});

describe('CodeChunker - source content preservation', () => {
  it('method chunks include the full body of the method', () => {
    const src = `class Calc {
  add(a: number, b: number): number {
    const r = a + b;
    return r;
  }
}
`;
    const out = chunks(src, 'src/calc.ts');
    const m = out.find((c) => c.symbolType === 'method');
    expect(m?.content).toContain('const r = a + b');
    expect(m?.content).toContain('return r');
  });

  it('class chunk includes the entire class definition', () => {
    const src = `export class Widget {
  render(): string {
    return '<div/>';
  }
}
`;
    const out = chunks(src, 'src/widget.ts');
    const c = out.find((c) => c.symbolType === 'class');
    expect(c?.content).toContain('class Widget');
    expect(c?.content).toContain('render(): string');
    expect(c?.content).toContain("'<div/>'");
  });
});
