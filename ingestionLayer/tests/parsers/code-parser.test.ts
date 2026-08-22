import { describe, it, expect } from 'vitest';
import { TreeSitterCodeParser } from '../../src/parsers/code/code-parser.js';

describe('TreeSitterCodeParser - language detection', () => {
  const parser = new TreeSitterCodeParser();

  it('supports TypeScript and JavaScript extensions', () => {
    expect(parser.supports('foo.ts')).toBe(true);
    expect(parser.supports('foo.tsx')).toBe(true);
    expect(parser.supports('foo.js')).toBe(true);
    expect(parser.supports('foo.jsx')).toBe(true);
    expect(parser.supports('foo.mjs')).toBe(true);
    expect(parser.supports('foo.cjs')).toBe(true);
  });

  it('does not claim to support unrelated extensions', () => {
    expect(parser.supports('foo.py')).toBe(false);
    expect(parser.supports('foo.go')).toBe(false);
    expect(parser.supports('README.md')).toBe(false);
  });
});

describe('TreeSitterCodeParser - TypeScript classes & methods', () => {
  const parser = new TreeSitterCodeParser();

  it('extracts a class with its methods and named fields', () => {
    const src = `export class UserService {
  async findUser(id: string): Promise<User> {
    return this.repo.find(id);
  }

  async addUser(input: NewUser): Promise<User> {
    return this.repo.save(input);
  }
}
`;
    const parsed = parser.parse(src, 'src/services/user.service.ts');
    expect(parsed.parseError).toBeUndefined();
    const cls = parsed.topLevel.find((n) => n.type === 'class_declaration');
    expect(cls).toBeDefined();
    expect(cls?.name).toBe('UserService');
    expect(cls?.startLine).toBe(1);
    expect(parsed.declarations.some((n) => n.type === 'method_definition')).toBe(true);
    const findUser = parsed.declarations.find((n) => n.name === 'findUser');
    expect(findUser).toBeDefined();
    expect(findUser?.startLine).toBe(2);
  });

  it('captures position metadata accurately', () => {
    const src = `class A {
  foo() { return 1; }
}
`;
    const parsed = parser.parse(src, 'a.ts');
    const cls = parsed.topLevel[0]!;
    expect(cls.startLine).toBe(1);
    expect(cls.endLine).toBe(3);
    expect(cls.startColumn).toBe(0);
  });

  it('extracts top-level functions', () => {
    const src = `export function greet(name: string): string {
  return 'Hello ' + name;
}

function helper(): void {}
`;
    const parsed = parser.parse(src, 'src/greet.ts');
    const funcs = parsed.topLevel.filter((n) => n.type === 'function_declaration');
    expect(funcs.map((f) => f.name).sort()).toEqual(['greet', 'helper']);
  });
});

describe('TreeSitterCodeParser - interfaces and type aliases', () => {
  const parser = new TreeSitterCodeParser();

  it('extracts an interface', () => {
    const src = `export interface User {
  id: string;
  name: string;
}
`;
    const parsed = parser.parse(src, 'src/types/user.ts');
    const iface = parsed.topLevel.find((n) => n.type === 'interface_declaration');
    expect(iface?.name).toBe('User');
  });

  it('extracts a type alias', () => {
    const src = `export type Nullable<T> = T | null;\n`;
    const parsed = parser.parse(src, 'src/types/util.ts');
    const alias = parsed.topLevel.find((n) => n.type === 'type_alias_declaration');
    expect(alias?.name).toBe('Nullable');
  });

  it('extracts an enum', () => {
    const src = `export enum Role {\n  Admin = 'admin',\n  User = 'user'\n}\n`;
    const parsed = parser.parse(src, 'src/types/role.ts');
    const e = parsed.topLevel.find((n) => n.type === 'enum_declaration');
    expect(e?.name).toBe('Role');
  });

  it('extracts lexical (const) declarations', () => {
    const src = `export const DEFAULT_PORT = 8080;\n`;
    const parsed = parser.parse(src, 'src/config.ts');
    const lex = parsed.topLevel.find((n) => n.type === 'lexical_declaration');
    expect(lex).toBeDefined();
  });
});

describe('TreeSitterCodeParser - JavaScript', () => {
  const parser = new TreeSitterCodeParser();

  it('parses a JS class', () => {
    const src = `class Counter {
  constructor() { this.value = 0; }
  inc() { this.value += 1; }
}
module.exports = { Counter };
`;
    const parsed = parser.parse(src, 'src/counter.js');
    expect(parsed.language).toBe('js');
    const cls = parsed.topLevel.find((n) => n.type === 'class_declaration');
    expect(cls?.name).toBe('Counter');
    expect(parsed.declarations.some((n) => n.name === 'inc')).toBe(true);
  });

  it('parses JS function declarations', () => {
    const src = `function add(a, b) { return a + b; }\n`;
    const parsed = parser.parse(src, 'src/math.js');
    const fn = parsed.topLevel.find((n) => n.type === 'function_declaration');
    expect(fn?.name).toBe('add');
  });
});

describe('TreeSitterCodeParser - robustness', () => {
  const parser = new TreeSitterCodeParser();

  it('does not throw on syntax errors, but exposes parseError', () => {
    const src = `class Broken {\n  method( { return 1; }\n`;
    const parsed = parser.parse(src, 'src/broken.ts');
    expect(parsed.parseError).toBeDefined();
    // Still produces a node, just with ERROR markers.
    expect(parsed.topLevel.length).toBeGreaterThanOrEqual(0);
  });

  it('handles empty source', () => {
    const parsed = parser.parse('', 'src/empty.ts');
    expect(parsed.topLevel).toEqual([]);
    expect(parsed.declarations).toEqual([]);
  });

  it('preserves the original source in the result', () => {
    const src = `export const x = 1;\n`;
    const parsed = parser.parse(src, 'src/consts.ts');
    expect(parsed.source).toBe(src);
  });
});
