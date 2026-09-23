import { describe, it, expect } from 'vitest';
import { CodeChunker } from '../../src/chunkers/code-chunker.js';
import { TreeSitterCodeParser } from '../../src/parsers/code/code-parser.js';

const parser = new TreeSitterCodeParser();

function chunks(src: string, path: string, opts?: ConstructorParameters<typeof CodeChunker>[0]): ReturnType<CodeChunker['chunk']> {
  const parsed = parser.parse(src, path);
  return new CodeChunker(opts).chunk(parsed);
}

describe('CodeChunker - JSDoc attachment', () => {
  it('attaches a JSDoc block to a method without duplicating the chunk', () => {
    const src = `class UserRepo {
  /**
   * Creates a user.
   * @param username User username
   */
  async createUser(username) {
    return save(username);
  }
}
`;
    const out = chunks(src, 'src/user.ts');
    const method = out.find((c) => c.symbolType === 'method');
    expect(method).toBeDefined();
    expect(out.filter((c) => c.symbolType === 'method')).toHaveLength(1);
    expect(method?.jsdoc).toContain('Creates a user');
    expect(method?.content).toContain('async createUser');
  });

  it('attaches JSDoc to a function declaration', () => {
    const src = `/**
 * Creates a payment.
 */
function createPayment() {
  return 1;
}
`;
    const out = chunks(src, 'src/pay.ts');
    const fn = out.find((c) => c.symbolType === 'function');
    expect(fn?.jsdoc).toContain('Creates a payment');
    expect(fn?.content).toContain('function createPayment');
  });

  it('attaches JSDoc to a class declaration', () => {
    const src = `/**
 * Handles user operations.
 */
class UserService {
  greet() { return 'hi'; }
}
`;
    const out = chunks(src, 'src/user.service.ts');
    const cls = out.find((c) => c.symbolType === 'class');
    expect(cls?.jsdoc).toContain('Handles user operations');
  });

  it('does not attach an unrelated comment to the next declaration', () => {
    const src = `// some unrelated comment
const x = 1;

/**
 * This is for foo.
 */
function foo() { return 2; }
`;
    const out = chunks(src, 'src/a.ts');
    const fn = out.find((c) => c.symbolType === 'function');
    expect(fn?.jsdoc).toContain('This is for foo');
  });

  it('leaves a method without JSDoc with no jsdoc field', () => {
    const src = `async createUser(username) {
  return save(username);
}
`;
    const out = chunks(src, 'src/user.ts');
    const method = out.find((c) => c.symbolType === 'method');
    expect(method?.jsdoc).toBeUndefined();
  });

  it('startLine includes JSDoc when JSDoc is directly attached', () => {
    const src = `class A {
  /**
   * Hello
   */
  foo() { return 1; }
}
`;
    const out = chunks(src, 'src/a.ts');
    const m = out.find((c) => c.symbolType === 'method');
    // class A { at line 1
    // / at line 2
    // * at line 3
    // * Hello at line 4
    // */ at line 5
    // foo at line 6
    expect(m?.startLine).toBeLessThanOrEqual(5);
  });
});

describe('CodeChunker - signature extraction', () => {
  it('extracts a class signature', () => {
    const src = `class PaymentService {
  pay() { return 1; }
}
`;
    const out = chunks(src, 'src/p.ts');
    const cls = out.find((c) => c.symbolType === 'class');
    expect(cls?.signature).toContain('class PaymentService');
    expect(cls?.signature).not.toContain('return');
  });

  it('extracts a method signature (without body)', () => {
    const src = `class Calc {
  add(a: number, b: number): number {
    const r = a + b;
    return r;
  }
}
`;
    const out = chunks(src, 'src/calc.ts');
    const m = out.find((c) => c.symbolType === 'method');
    expect(m?.signature).toContain('add');
    expect(m?.signature).toContain('a: number');
    expect(m?.signature).toContain('b: number');
    expect(m?.signature).toContain('number');
    expect(m?.signature).not.toContain('const r');
    expect(m?.signature).not.toContain('return r');
  });

  it('extracts an async function signature', () => {
    const src = `async function createPayment(req: PaymentRequest): Promise<PaymentResponse> {
  return doSomething(req);
}
`;
    const out = chunks(src, 'src/pay.ts');
    const fn = out.find((c) => c.symbolType === 'function');
    expect(fn?.signature).toContain('async function createPayment');
    expect(fn?.signature).toContain('Promise<PaymentResponse>');
    expect(fn?.signature).not.toContain('return doSomething');
  });

  it('extracts an interface signature', () => {
    const src = `interface User {
  id: string;
  name: string;
}
`;
    const out = chunks(src, 'src/u.ts');
    const i = out.find((c) => c.symbolType === 'interface');
    expect(i?.signature).toContain('interface User');
    expect(i?.signature).not.toContain('id: string');
  });

  it('extracts a type alias signature', () => {
    const src = `type PaymentStatus = 'pending' | 'settled' | 'reverted';
`;
    const out = chunks(src, 'src/types.ts');
    const t = out.find((c) => c.symbolType === 'type');
    expect(t?.signature).toContain('type PaymentStatus');
    expect(t?.signature).not.toContain("'settled'");
  });

  it('extracts an enum signature', () => {
    const src = `enum Role {
  Admin = 'admin',
  User = 'user'
}
`;
    const out = chunks(src, 'src/role.ts');
    const e = out.find((c) => c.symbolType === 'enum');
    expect(e?.signature).toContain('enum Role');
    expect(e?.signature).not.toContain('Admin');
  });
});

describe('CodeChunker - trivial lexical declaration filtering', () => {
  it('skips require() calls', () => {
    const src = `const express = require("express");\n`;
    const out = chunks(src, 'src/app.ts');
    expect(out).toHaveLength(0);
  });

  it('skips plain local value assignments', () => {
    const src = `const localValue = foo();
`;
    const out = chunks(src, 'src/a.ts');
    expect(out).toHaveLength(0);
  });

  it('skips simple assignments and local helpers', () => {
    const src = `let count = 0;
const helper = (a, b) => a + b;
`;
    const out = chunks(src, 'src/a.ts');
    expect(out).toHaveLength(0);
  });

  it('keeps exported object literals (configuration)', () => {
    const src = `export const PAYMENT_STATUS = {
  PENDING: 'pending',
  SETTLED: 'settled',
  REVERTED: 'reverted'
};
`;
    const out = chunks(src, 'src/status.ts');
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('PAYMENT_STATUS');
    expect(out[0]?.exported).toBe(true);
  });

  it('keeps exported array literals (enum-like constants)', () => {
    const src = `export const VALID_LOCALES = ['en', 'fa', 'ar'];
`;
    const out = chunks(src, 'src/locales.ts');
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('VALID_LOCALES');
  });

  it('keeps defineConfig-style factory calls even when not exported', () => {
    const src = `const cfg = defineConfig({ port: 8080 });
`;
    const out = chunks(src, 'src/a.ts');
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('cfg');
  });

  it('does not skip when includeSemanticDeclarationsOnly=false', () => {
    const src = `const x = 1;
const y = 2;
`;
    const out = chunks(src, 'src/a.ts', { includeSemanticDeclarationsOnly: false });
    expect(out).toHaveLength(2);
  });
});

describe('CodeChunker - parentSymbol metadata', () => {
  it('sets parentSymbol on every method of a class', () => {
    const src = `class Calc {
  add(a, b) { return a + b; }
  sub(a, b) { return a - b; }
}
`;
    const out = chunks(src, 'src/c.ts');
    const methods = out.filter((c) => c.symbolType === 'method');
    for (const m of methods) {
      expect(m.parentSymbol).toBe('Calc');
    }
  });

  it('does not set parentSymbol on the class chunk itself', () => {
    const src = `class A {}
`;
    const out = chunks(src, 'src/a.ts');
    const cls = out.find((c) => c.symbolType === 'class');
    expect(cls?.parentSymbol).toBeUndefined();
  });

  it('exposes exported flag on exported declarations', () => {
    const src = `export class Foo {}
export function bar() {}
`;
    const out = chunks(src, 'src/a.ts');
    expect(out.find((c) => c.symbolType === 'class')?.exported).toBe(true);
    expect(out.find((c) => c.symbolType === 'function')?.exported).toBe(true);
  });
});

describe('CodeChunker - semantic content composition', () => {
  it('injects a Parent/Signature block into method content by default', () => {
    const src = `class Svc {
  async run(x: number): Promise<void> {
    return;
  }
}
`;
    const out = chunks(src, 'src/svc.ts');
    const m = out.find((c) => c.symbolType === 'method');
    expect(m?.content).toContain('Parent: Svc');
    expect(m?.content).toContain('Method: Svc.run');
    expect(m?.content).toContain('Signature:');
    expect(m?.content).toContain('async run(x: number)');
  });

  it('does NOT inject semantic context when includeSemanticContextInContent=false', () => {
    const src = `class Svc {
  async run() {}
}
`;
    const out = chunks(src, 'src/svc.ts', { includeSemanticContextInContent: false });
    const m = out.find((c) => c.symbolType === 'method');
    expect(m?.content).not.toContain('Parent: Svc');
    expect(m?.content).toContain('async run');
  });

  it('includes JSDoc in the chunk content header', () => {
    const src = `/**
 * Builds a user.
 */
class UserBuilder {
  build() { return new User(); }
}
`;
    const out = chunks(src, 'src/u.ts');
    const cls = out.find((c) => c.symbolType === 'class');
    expect(cls?.content).toContain('Builds a user');
    expect(cls?.content).toContain('class UserBuilder');
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