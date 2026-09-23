import { describe, it, expect } from 'vitest';
import {
  FileClassifier,
  extOf,
  _internal,
  DEFAULT_CODE_EXTENSIONS,
  DEFAULT_DOC_EXTENSIONS,
  DEFAULT_IGNORE_DIRECTORIES,
  DEFAULT_IGNORE_EXTENSIONS,
  DEFAULT_TEST_ARTIFACT_PATTERNS,
  DEFAULT_SNAPSHOT_PATTERNS,
  DEFAULT_LOG_FILE_PATTERNS,
  DEFAULT_DOCUMENTATION_FILE_NAMES,
  DEFAULT_DOCUMENTATION_DIRECTORIES,
} from '../../src/discovery/file-classifier.js';
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

  it('processes test source files under tests/', () => {
    const d = c.classify(file('tests/payment.test.ts'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('CODE');
    expect(d.language).toBe('ts');
  });

  it('processes test specs in __tests__/', () => {
    const d = c.classify(file('src/__tests__/foo.test.ts'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('CODE');
  });
});

describe('FileClassifier - ignored', () => {
  const c = new FileClassifier();

  it('ignores files inside node_modules', () => {
    const d = c.classify(file('node_modules/foo/index.js'));
    expect(d.action).toBe('IGNORE');
    expect(d.reason).toBe('generated_directory');
  });

  it('ignores .git contents', () => {
    expect(c.classify(file('.git/HEAD')).reason).toBe('generated_directory');
  });

  it('ignores dist/ and build/ outputs', () => {
    expect(c.classify(file('dist/index.js')).reason).toBe('generated_directory');
    expect(c.classify(file('build/output.js')).reason).toBe('generated_directory');
  });

  it('ignores coverage/ output', () => {
    expect(c.classify(file('coverage/lcov.info')).reason).toBe('generated_directory');
    expect(c.classify(file('coverage/index.html')).reason).toBe('generated_directory');
  });

  it('ignores .nyc_output/', () => {
    expect(c.classify(file('.nyc_output/processinfo/index.json')).reason).toBe(
      'generated_directory'
    );
  });

  it('ignores test-results/ and test-output/', () => {
    // Pure XML/JSON reports inside test-results are flagged as test artefacts
    // (pattern wins over directory reason).
    expect(c.classify(file('test-results/junit.xml')).reason).toBe('test_artifact');
    expect(c.classify(file('test-output/report.html')).reason).toBe('test_artifact');
  });

  it('ignores snapshot directories', () => {
    // .snap files inside snapshots/ are flagged as snapshots, not generic dirs.
    expect(c.classify(file('snapshots/example.snap')).reason).toBe('snapshot');
  });

  it('ignores logs/ and tmp/', () => {
    // *.log inside logs/ is flagged as a log file, not generic generated dir.
    expect(c.classify(file('logs/server.log')).reason).toBe('log_file');
    expect(c.classify(file('tmp/cache.bin')).reason).toBe('generated_directory');
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

describe('FileClassifier - test artifacts', () => {
  const c = new FileClassifier();

  it('ignores tests/output/*', () => {
    const d = c.classify(file('tests/output/result.json'));
    expect(d.action).toBe('IGNORE');
    expect(d.reason).toBe('test_artifact');
  });

  it('ignores tests/results/*', () => {
    expect(c.classify(file('tests/results/junit.xml')).reason).toBe('test_artifact');
  });

  it('ignores test/__tests__/output/*', () => {
    expect(c.classify(file('test/__tests__/output/result.json')).reason).toBe('test_artifact');
  });

  it('ignores junit xml reports', () => {
    expect(c.classify(file('reports/junit.xml')).reason).toBe('test_artifact');
  });

  it('ignores playwright-report and cypress artefacts', () => {
    expect(c.classify(file('playwright-report/index.html')).reason).toBe('test_artifact');
    expect(c.classify(file('cypress/screenshots/home.png')).reason).toBe('test_artifact');
    expect(c.classify(file('cypress/videos/rec.mp4')).reason).toBe('test_artifact');
    expect(c.classify(file('cypress/results/output.json')).reason).toBe('test_artifact');
  });

  it('ignores allure report dirs', () => {
    expect(c.classify(file('allure-results/123.json')).reason).toBe('test_artifact');
    expect(c.classify(file('allure-report/index.html')).reason).toBe('test_artifact');
  });

  it('DOES NOT ignore tests/payment.test.ts', () => {
    const d = c.classify(file('tests/payment.test.ts'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('CODE');
  });

  it('DOES NOT ignore tests/integration/payment.spec.ts', () => {
    const d = c.classify(file('tests/integration/payment.spec.ts'));
    expect(d.action).toBe('PROCESS');
    expect(d.kind).toBe('CODE');
  });
});

describe('FileClassifier - snapshot files', () => {
  const c = new FileClassifier();

  it('ignores .snap files', () => {
    expect(c.classify(file('src/__snapshots__/component.snap')).reason).toBe('snapshot');
  });

  it('ignores files inside __snapshots__/', () => {
    expect(c.classify(file('src/components/__snapshots__/Button.test.tsx.snap')).reason).toBe(
      'snapshot'
    );
  });
});

describe('FileClassifier - log files', () => {
  const c = new FileClassifier();

  it('ignores *.log files anywhere', () => {
    expect(c.classify(file('logs/app.log')).reason).toBe('log_file');
    expect(c.classify(file('debug.log')).reason).toBe('log_file');
  });

  it('ignores npm/yarn debug logs at root', () => {
    expect(c.classify(file('npm-debug.log')).reason).toBe('log_file');
    expect(c.classify(file('yarn-error.log')).reason).toBe('log_file');
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

  it('preserves test source code while ignoring test artefacts', () => {
    const c = new FileClassifier();
    const result = c.classifyAll([
      file('tests/payment.test.ts'),
      file('tests/output/junit.xml'),
      file('tests/__snapshots__/foo.snap'),
    ]);
    expect(result.processed.map((p) => p.file.path)).toEqual(['tests/payment.test.ts']);
    expect(result.ignored.map((p) => p.file.path).sort()).toEqual([
      'tests/__snapshots__/foo.snap',
      'tests/output/junit.xml',
    ]);
    expect(result.ignored[0]?.reason).toMatch(/snapshot|test_artifact/);
  });
});

describe('FileClassifier - extension tables (sanity)', () => {
  it('contains the expected code extensions', () => {
    for (const ext of ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go']) {
      expect(DEFAULT_CODE_EXTENSIONS.has(ext)).toBe(true);
    }
  });
  it('contains the expected documentation extensions', () => {
    for (const ext of ['md', 'mdx', 'markdown']) {
      expect(DEFAULT_DOC_EXTENSIONS.has(ext)).toBe(true);
    }
  });
  it('contains the expected ignored extensions (binary/media)', () => {
    for (const ext of ['png', 'pdf', 'woff2', 'mp4']) {
      expect(DEFAULT_IGNORE_EXTENSIONS.has(ext)).toBe(true);
    }
  });
  it('exposes documentation filenames and directories as defaults', () => {
    expect(DEFAULT_DOCUMENTATION_FILE_NAMES).toContain('readme.md');
    expect(DEFAULT_DOCUMENTATION_DIRECTORIES).toContain('docs/');
  });
  it('exposes pattern sets for snapshots, logs, test artefacts', () => {
    expect(DEFAULT_SNAPSHOT_PATTERNS.length).toBeGreaterThan(0);
    expect(DEFAULT_LOG_FILE_PATTERNS.length).toBeGreaterThan(0);
    expect(DEFAULT_TEST_ARTIFACT_PATTERNS.length).toBeGreaterThan(0);
  });
  it('exposes DEFAULT_IGNORE_DIRECTORIES including test outputs', () => {
    expect(DEFAULT_IGNORE_DIRECTORIES).toContain('node_modules/');
    expect(DEFAULT_IGNORE_DIRECTORIES).toContain('coverage/');
    expect(DEFAULT_IGNORE_DIRECTORIES).toContain('test-results/');
    expect(DEFAULT_IGNORE_DIRECTORIES).toContain('test-output/');
  });
});

describe('FileClassifier - configurability', () => {
  it('allows adding custom ignored directories', () => {
    const c = new FileClassifier({ ignoreDirectories: ['.terraform/'] });
    expect(c.classify(file('.terraform/state.tfstate')).reason).toBe('generated_directory');
  });

  it('allows custom log file patterns', () => {
    const c = new FileClassifier({ logFilePatterns: [/foo\.trace$/i] });
    expect(c.classify(file('foo.trace')).reason).toBe('log_file');
  });

  it('keeps the defaults when options are not provided', () => {
    const c = new FileClassifier();
    expect(c.classify(file('node_modules/x')).reason).toBe('generated_directory');
  });
});

describe('FileClassifier - internal exports', () => {
  it('exposes DEFAULT_IGNORE_FILE_PATTERNS through _internal', () => {
    expect(_internal.DEFAULT_IGNORE_FILE_PATTERNS.length).toBeGreaterThan(0);
  });
});