import type { RepositoryFile } from '../repository/types.js';
import {
  type BinaryDetector,
  type ClassificationDecision,
  type ClassificationResult,
  type FileClassifierOptions,
  type ProcessingKind,
  defaultBinaryDetector,
} from './types.js';

/**
 * Default code extensions recognised by the classifier. Other extensions
 * are intentionally ignored unless they appear in {@link DOC_EXTENSIONS}
 * or {@link CONFIG_FILE_NAMES}.
 */
export const DEFAULT_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'py',
  'java',
  'kt',
  'go',
  'rs',
  'rb',
  'php',
  'cs',
  'cpp',
  'c',
  'h',
  'hpp',
  'swift',
  'scala',
  'sh',
  'bash',
  'zsh',
  'vue',
  'svelte',
]);

/** Default documentation extensions. */
export const DEFAULT_DOC_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'mdx',
  'markdown',
  'rst',
  'adoc',
]);

/** Default documentation file names (case-insensitive). */
export const DEFAULT_DOCUMENTATION_FILE_NAMES: readonly string[] = [
  'readme.md',
  'readme.markdown',
  'readme.rst',
  'readme.txt',
  'changelog.md',
  'contributing.md',
  'license.md',
  'license.txt',
  'code_of_conduct.md',
  'security.md',
  'authors.md',
  'acknowledgements.md',
];

/** Default documentation directories (any doc file under these counts as documentation). */
export const DEFAULT_DOCUMENTATION_DIRECTORIES: readonly string[] = [
  'docs/',
  'documentation/',
  'doc/',
];

/**
 * Directories that contain generated / non-source content. Any file under
 * one of these directories is ignored with reason
 * {@link ClassificationReason 'generated_directory'}.
 *
 * The list intentionally does NOT include the whole `tests/` tree: test
 * source files such as `tests/payment.test.ts` are valuable and should be
 * processed. Only generated subdirectories of `tests/` are listed below
 * under {@link DEFAULT_TEST_ARTIFACT_PATTERNS}.
 */
export const DEFAULT_IGNORE_DIRECTORIES: readonly string[] = [
  'node_modules/',
  '.git/',
  '.github/',
  '.gitlab/',
  '.idea/',
  '.vscode/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.next/',
  '.nuxt/',
  '.cache/',
  '.parcel-cache/',
  '.turbo/',
  '.nyc_output/',
  'target/',
  'bin/',
  'obj/',
  '__pycache__/',
  '.venv/',
  'venv/',
  'tmp/',
  'temp/',
  'logs/',
  'log/',
  'test-results/',
  'test-output/',
  'snapshots/',
  '.husky/',
];

/**
 * Patterns that mark files as test artefacts rather than source. The
 * classifier keeps the entire `tests/` directory available for source
 * code, but ignores generated content inside it.
 */
export const DEFAULT_TEST_ARTIFACT_PATTERNS: readonly RegExp[] = [
  // Generic generated subdirectories under tests/
  /(?:^|\/)(?:tests|test|__tests__)\/(?:output|results|coverage|snapshots?|artifacts?|fixtures[_-]generated|reports?|reports)\//i,
  // Playwright / Cypress / Jest common output locations
  /(?:^|\/)playwright-report\//i,
  /(?:^|\/)cypress\/(?:screenshots|videos|results|reports)\//i,
  /(?:^|\/)allure-(?:results|report)\//i,
  // Mocha / Jest XML / JSON reports
  /(^|\/)junit[^/]*\.(?:xml|json)$/i,
  /(^|\/)(?:report|results?)\.(?:xml|json|html)$/i,
  // tarball / build artefacts often committed by mistake under tests
  /\.(?:tar|tar\.gz|tgz|zip)$/i,
];

/** Patterns that identify snapshot files (Jest, Vitest, custom .snap). */
export const DEFAULT_SNAPSHOT_PATTERNS: readonly RegExp[] = [
  /\.(?:snap|snapx)$/i,
  /[\\/]__snapshots__[\\/]/i,
];

/** Patterns that identify log files. */
export const DEFAULT_LOG_FILE_PATTERNS: readonly RegExp[] = [
  /\.(?:log|logs)$/i,
  /[\\/]npm-debug\.log$/i,
  /[\\/]yarn-debug\.log$/i,
  /[\\/]yarn-error\.log$/i,
  /[\\/]pnpm-debug\.log$/i,
];

/** Binary / archive / media extensions we never want to ingest. */
export const DEFAULT_IGNORE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'svg',
  'webp',
  'pdf',
  'mp3',
  'mp4',
  'mov',
  'avi',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'pyc',
  'class',
  'jar',
  'war',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  '7z',
  'rar',
  'dll',
  'exe',
  'so',
  'dylib',
  'min.js',
  'min.css',
  'bundle.js',
  'map',
]);

/** Patterns that flag compiled/minified/derived source artefacts. */
export const DEFAULT_IGNORE_FILE_PATTERNS: readonly RegExp[] = [
  /\.(?:min|bundle)\.(?:js|css)$/i,
  /\.(?:map)$/i,
  /\.(?:dll|exe|so|dylib|class|jar|war)$/i,
  /\.(?:zip|tar|tgz|tar\.gz|gz|bz2|7z|rar)$/i,
  /\.(?:png|jpg|jpeg|gif|bmp|ico|svg|webp)$/i,
  /\.(?:pdf|mp3|mp4|mov|avi)$/i,
  /\.(?:woff|woff2|ttf|eot|pyc)$/i,
];

/** Default known configuration file names (case-insensitive). */
export const DEFAULT_CONFIG_FILE_NAMES: ReadonlySet<string> = new Set(
  [
    'package.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.build.json',
    'jest.config.json',
    'jest.config.ts',
    'jest.config.js',
    'vitest.config.ts',
    'vitest.config.js',
    'vite.config.ts',
    'vite.config.js',
    'webpack.config.js',
    'rollup.config.js',
    '.eslintrc.json',
    '.eslintrc.js',
    '.prettierrc.json',
    '.prettierrc.js',
    'docker-compose.yml',
    'docker-compose.yaml',
    'dockerfile',
    '.dockerignore',
    'makefile',
    'gemfile',
  ].map((n) => n.toLowerCase())
);

/** Lock file patterns. */
export const DEFAULT_LOCK_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)bun\.lockb?$/i,
  /(^|\/)composer\.lock$/i,
  /(^|\/)Gemfile\.lock$/i,
  /(^|\/)Cargo\.lock$/i,
  /(^|\/)poetry\.lock$/i,
];

export class FileClassifier {
  private readonly maxFileSizeBytes: number;
  private readonly ignoreDirectoryRe: RegExp;
  private readonly extraIgnorePatterns: RegExp[];
  private readonly docFileNames: Set<string>;
  private readonly docDirectories: string[];
  private readonly ignoreLockFiles: boolean;
  private readonly testArtifactPatterns: RegExp[];
  private readonly snapshotPatterns: RegExp[];
  private readonly logFilePatterns: RegExp[];
  private readonly ignoreExtensions: Set<string>;
  private readonly ignoreFilePatterns: RegExp[];

  constructor(
    options: FileClassifierOptions = {},
    private readonly detector: BinaryDetector = defaultBinaryDetector
  ) {
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 2_000_000;
    this.extraIgnorePatterns = options.extraIgnorePatterns ?? [];

    const allIgnoreDirs = [
      ...DEFAULT_IGNORE_DIRECTORIES,
      ...(options.ignoreDirectories ?? []),
      ...(options.documentationDirectories ?? []),
    ];
    this.ignoreDirectoryRe = buildDirRegex(allIgnoreDirs);

    this.docFileNames = new Set(
      (options.documentationFileNames ?? DEFAULT_DOCUMENTATION_FILE_NAMES).map((n) =>
        n.toLowerCase()
      )
    );
    this.docDirectories = (options.documentationDirectories ?? DEFAULT_DOCUMENTATION_DIRECTORIES).map(
      (d) => d.toLowerCase()
    );
    this.ignoreLockFiles = options.ignoreLockFiles ?? true;

    this.testArtifactPatterns = [...DEFAULT_TEST_ARTIFACT_PATTERNS, ...(options.testArtifactPatterns ?? [])];
    this.snapshotPatterns = [...DEFAULT_SNAPSHOT_PATTERNS, ...(options.snapshotPatterns ?? [])];
    this.logFilePatterns = [...DEFAULT_LOG_FILE_PATTERNS, ...(options.logFilePatterns ?? [])];
    this.ignoreExtensions = new Set([
      ...DEFAULT_IGNORE_EXTENSIONS,
      ...extractExtensionList(options.extraIgnorePatterns),
    ]);
    this.ignoreFilePatterns = [
      ...DEFAULT_IGNORE_FILE_PATTERNS,
      ...DEFAULT_LOG_FILE_PATTERNS,
      ...DEFAULT_SNAPSHOT_PATTERNS,
      ...DEFAULT_TEST_ARTIFACT_PATTERNS,
      ...(options.extraIgnorePatterns ?? []),
    ];
  }

  classify(file: RepositoryFile): ClassificationDecision {
    const path = file.path;
    const lower = path.toLowerCase();

    // 1. Most specific reasons first: snapshot > log > test_artifact.
    for (const re of this.snapshotPatterns) {
      if (re.test(path) || re.test(lower)) {
        return { file, action: 'IGNORE', reason: 'snapshot' };
      }
    }
    for (const re of this.logFilePatterns) {
      if (re.test(path) || re.test(lower)) {
        return { file, action: 'IGNORE', reason: 'log_file' };
      }
    }
    for (const re of this.testArtifactPatterns) {
      if (re.test(path) || re.test(lower)) {
        return { file, action: 'IGNORE', reason: 'test_artifact' };
      }
    }

    // 2. Directory-based ignore — entire generated trees.
    if (this.ignoreDirectoryRe.test('/' + lower)) {
      return {
        file,
        action: 'IGNORE',
        reason: 'generated_directory',
      };
    }

    // 3. Extra patterns (caller-supplied).
    for (const re of this.extraIgnorePatterns) {
      if (re.test(path) || re.test(lower)) {
        return { file, action: 'IGNORE', reason: 'explicit_ignore_pattern' };
      }
    }

    if (this.ignoreLockFiles) {
      for (const re of DEFAULT_LOCK_FILE_PATTERNS) {
        if (re.test(path)) {
          return { file, action: 'IGNORE', reason: 'lock_file' };
        }
      }
    }

    if (file.size !== undefined && file.size > this.maxFileSizeBytes) {
      return { file, action: 'IGNORE', reason: 'too_large' };
    }

    const fileName = file.name.toLowerCase();
    const ext = extOf(path);

    if (this.ignoreExtensions.has(ext)) {
      return { file, action: 'IGNORE', reason: 'binary_file' };
    }

    if (this.docFileNames.has(fileName)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'DOCUMENTATION',
        reason: 'known_markdown',
      };
    }

    if (this.docDirectories.some((d) => lower.startsWith(d))) {
      if (DEFAULT_DOC_EXTENSIONS.has(ext)) {
        return {
          file,
          action: 'PROCESS',
          kind: 'DOCUMENTATION',
          reason: 'known_documentation_path',
        };
      }
    }

    if (DEFAULT_CONFIG_FILE_NAMES.has(fileName)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'CONFIG',
        reason: 'known_config_file',
      };
    }

    if (DEFAULT_DOC_EXTENSIONS.has(ext)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'DOCUMENTATION',
        language: 'markdown',
        reason: 'known_markdown',
      };
    }

    if (DEFAULT_CODE_EXTENSIONS.has(ext)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'CODE',
        language: ext === 'tsx' ? 'tsx' : ext === 'jsx' ? 'jsx' : ext,
        reason: 'known_code_extension',
      };
    }

    return {
      file,
      action: 'IGNORE',
      reason: 'unknown_extension',
    };
  }

  classifyAll(files: RepositoryFile[]): ClassificationResult {
    const processed: ClassificationDecision[] = [];
    const ignored: ClassificationDecision[] = [];
    for (const f of files) {
      const decision = this.classify(f);
      if (decision.action === 'PROCESS') processed.push(decision);
      else ignored.push(decision);
    }
    return { processed, ignored };
  }
}

/**
 * Classify a regex pattern into the most appropriate ignore reason.
 * Order matters: more specific reasons (snapshot, log, test_artifact)
 * win over generic binary detection.
 */
function classifyPatternReason(re: RegExp): import('./types.js').ClassificationReason {
  const src = re.source.toLowerCase();
  if (DEFAULT_SNAPSHOT_PATTERNS.some((p) => p.source === re.source)) return 'snapshot';
  if (DEFAULT_LOG_FILE_PATTERNS.some((p) => p.source === re.source)) return 'log_file';
  if (DEFAULT_TEST_ARTIFACT_PATTERNS.some((p) => p.source === re.source)) return 'test_artifact';
  if (DEFAULT_IGNORE_FILE_PATTERNS.some((p) => p.source === re.source)) return 'binary_file';
  return 'explicit_ignore_pattern';
}

function buildDirRegex(dirs: readonly string[]): RegExp {
  const escaped = dirs
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/$/, ''))
    .filter((d) => d.length > 0);
  if (escaped.length === 0) return /(?!)/; // never matches
  return new RegExp(`(^|/)(?:${escaped.join('|')})/`, 'i');
}

function extractExtensionList(patterns: readonly RegExp[] | undefined): string[] {
  if (!patterns) return [];
  const exts = new Set<string>();
  for (const re of patterns) {
    const match = re.source.match(/\.([a-z0-9]+)\$/i);
    if (match && match[1]) {
      const cleaned = match[1].replace(/\\\./g, '').toLowerCase();
      if (cleaned.length > 1 && !cleaned.includes('(') && !cleaned.includes('|')) {
        exts.add(cleaned);
      }
    }
  }
  return [...exts];
}

export function extOf(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  const slash = path.lastIndexOf('/');
  if (slash > idx) return '';
  return path.slice(idx + 1).toLowerCase();
}

/** Detects whether a buffer looks like text content using the default heuristic. */
export function looksLikeBinary(buf: Buffer): boolean {
  return defaultBinaryDetector.isBinary(buf);
}

export const _internal = {
  DEFAULT_CODE_EXTENSIONS,
  DEFAULT_DOC_EXTENSIONS,
  DEFAULT_CONFIG_FILE_NAMES,
  DEFAULT_LOCK_FILE_PATTERNS,
  DEFAULT_IGNORE_DIRECTORIES,
  DEFAULT_TEST_ARTIFACT_PATTERNS,
  DEFAULT_SNAPSHOT_PATTERNS,
  DEFAULT_LOG_FILE_PATTERNS,
  DEFAULT_IGNORE_EXTENSIONS,
  DEFAULT_IGNORE_FILE_PATTERNS,
};
export type { ProcessingKind };