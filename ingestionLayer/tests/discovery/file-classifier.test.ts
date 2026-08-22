import { describe, it, expect } from 'vitest';
import { FileClassifier, extOf, _internal } from '../../src/discovery/file-classifier.js';
import type { RepositoryFile } from '../../src/repository/types.js';

function file(path: string, size?: number): RepositoryFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    type: 'file',
    size,
  };
}

describe('extOf', () => {
  it('extracts lowercase extension', () => {
    expect(extOf('foo/Bar.TS')).toBe('ts');
    expect(extOf('plain')).toBe('');
    expect(extOf('a.b/c')).toBe('');
    expect(extOf('a/b.c')).toBe('c');
  });
});

describe('FileClassifier - documentation', () => {
  const c = new FileClassifier();

  it('classifies README.md as documentation', () => {
    const d = c.classify(file('README.md'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('DOCUMENTATION');
    expect(d.reason).toBe('known_markdown');
  });

  it('classifies README.markdown', () => {
    expect(c.classify(file('docs/README.markdown')).kind).toBe('DOCUMENTATION');
  });

  it('classifies arbitrary .md in docs/', () => {
    const d = c.classify(file('docs/authentication.md'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('DOCUMENTATION');
    expect(d.reason).toBe('known_documentation_path');
  });

  it('classifies .mdx as documentation', () => {
    expect(c.classify(file('docs/page.mdx')).kind).toBe('DOCUMENTATION');
  });

  it('classifies CHANGELOG.md via filename list', () => {
    expect(c.classify(file('CHANGELOG.md')).kind).toBe('DOCUMENTATION');
  });
});

describe('FileClassifier - code', () => {
  const c = new FileClassifier();

  it('classifies TypeScript files', () => {
    const d = c.classify(file('src/user.service.ts'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('CODE');
    expect(d.language).toBe('ts');
  });

  it('classifies TSX files', () => {
    expect(c.classify(file('src/components/Button.tsx')).language).toBe('tsx');
  });

  it('classifies JavaScript files', () => {
    const d = c.classify(file('src/index.js'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('CODE');
    expect(d.language).toBe('js');
  });

  it('classifies JSX files', () => {
    expect(c.classify(file('src/widget.jsx')).language).toBe('jsx');
  });

  it('classifies ESM files (mjs/cjs)', () => {
    expect(c.classify(file('src/foo.mjs')).language).toBe('mjs');
    expect(c.classify(file('src/bar.cjs')).language).toBe('cjs');
  });
});

describe('FileClassifier - ignored', () => {
  const c = new FileClassifier();

  it('ignores files inside node_modules', () => {
    const d = c.classify(file('node_modules/foo/index.js'));
    expect(d.action).toBe('IGNORE');
    expect(d.reason).toBe('ignored_directory');
  });

  it('ignores .git contents', () => {
    expect(c.classify(file('.git/HEAD')).reason).toBe('ignored_directory');
  });

  it('ignores dist/ and build/ outputs', () => {
    expect(c.classify(file('dist/index.js')).reason).toBe('ignored_directory');
    expect(c.classify(file('build/output.js')).reason).toBe('ignored_directory');
  });

  it('ignores binary files (png, jpg, pdf, etc.)', () => {
    expect(c.classify(file('assets/logo.png')).reason).toBe('binary_file');
    expect(c.classify(file('docs/diagram.pdf')).reason).toBe('binary_file');
    expect(c.classify(file('static/font.woff2')).reason).toBe('binary_file');
  });

  it('ignores lock files by default', () => {
    expect(c.classify(file('package-lock.json')).reason).toBe('lock_file');
    expect(c.classify(file('yarn.lock')).reason).toBe('lock_file');
    expect(c.classify(file('pnpm-lock.yaml')).reason).toBe('lock_file');
  });

  it('can be configured to keep lock files', () => {
    const lenient = new FileClassifier({ ignoreLockFiles: false });
    expect(lenient.classify(file('package-lock.json')).action).toBe('IGNORE');
    expect(lenient.classify(file('package-lock.json')).reason).toBe('unknown_extension');
  });

  it('ignores oversized files', () => {
    const strict = new FileClassifier({ maxFileSizeBytes: 100 });
    const d = strict.classify(file('big.ts', 200));
    expect(d.action).toBe('IGNORE');
    expect(d.reason).toBe('too_large');
  });

  it('ignores unsupported extensions', () => {
    expect(c.classify(file('data.xyz')).reason).toBe('unknown_extension');
  });

  it('ignores files matching extra patterns', () => {
    const custom = new FileClassifier({ extraIgnorePatterns: [/\.gen\.ts$/] });
    expect(custom.classify(file('src/types.gen.ts')).reason).toBe('explicit_ignore_pattern');
  });
});

describe('FileClassifier - config', () => {
  const c = new FileClassifier();

  it('classifies package.json as config', () => {
    expect(c.classify(file('package.json')).kind).toBe('CONFIG');
  });

  it('classifies tsconfig.json as config', () => {
    expect(c.classify(file('tsconfig.json')).kind).toBe('CONFIG');
  });

  it('classifies Dockerfile as config', () => {
    expect(c.classify(file('Dockerfile')).kind).toBe('CONFIG');
  });
});

describe('FileClassifier - classifyAll', () => {
  it('splits processed vs ignored deterministically', () => {
    const c = new FileClassifier();
    const result = c.classifyAll([
      file('README.md'),
      file('src/index.ts'),
      file('node_modules/foo.js'),
      file('data.unknown'),
    ]);
    expect(result.processed.map((p) => p.file.path).sort()).toEqual(['README.md', 'src/index.ts']);
    expect(result.ignored.map((p) => p.file.path).sort()).toEqual([
      'data.unknown',
      'node_modules/foo.js',
    ]);
  });
});

describe('FileClassifier - extension tables (sanity)', () => {
  it('contains the expected code extensions', () => {
    for (const ext of ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go']) {
      expect(_internal.CODE_EXTENSIONS.has(ext)).toBe(true);
    }
  });
  it('contains the expected documentation extensions', () => {
    for (const ext of ['md', 'mdx', 'markdown']) {
      expect(_internal.DOC_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});
