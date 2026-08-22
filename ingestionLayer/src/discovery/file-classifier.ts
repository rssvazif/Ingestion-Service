import type { RepositoryFile } from '../repository/types.js';
import {
  type BinaryDetector,
  type ClassificationDecision,
  type ClassificationResult,
  type FileClassifierOptions,
  type ProcessingKind,
  defaultBinaryDetector,
} from './types.js';

const CODE_EXTENSIONS = new Set([
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

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'rst', 'adoc']);

const CONFIG_FILE_NAMES = new Set(
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

const IGNORED_DIRECTORIES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.next/',
  '.nuxt/',
  '.cache/',
  'target/',
  'bin/',
  'obj/',
  '__pycache__/',
  '.venv/',
  'venv/',
];

const IGNORED_FILE_PATTERNS: RegExp[] = [
  /\.min\.(js|css)$/i,
  /\.bundle\.js$/i,
  /\.map$/i,
  /\.dll$/i,
  /\.exe$/i,
  /\.so$/i,
  /\.dylib$/i,
  /\.class$/i,
  /\.jar$/i,
  /\.war$/i,
  /\.zip$/i,
  /\.tar$/i,
  /\.tar\.gz$/i,
  /\.tgz$/i,
  /\.gz$/i,
  /\.bz2$/i,
  /\.7z$/i,
  /\.rar$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.bmp$/i,
  /\.ico$/i,
  /\.svg$/i,
  /\.webp$/i,
  /\.pdf$/i,
  /\.mp3$/i,
  /\.mp4$/i,
  /\.mov$/i,
  /\.avi$/i,
  /\.woff$/i,
  /\.woff2$/i,
  /\.ttf$/i,
  /\.eot$/i,
  /\.pyc$/i,
];

const LOCK_FILE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)bun\.lockb?$/i,
  /(^|\/)composer\.lock$/i,
  /(^|\/)Gemfile\.lock$/i,
  /(^|\/)Cargo\.lock$/i,
  /(^|\/)poetry\.lock$/i,
];

const DEFAULT_DOCUMENTATION_FILE_NAMES = [
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

const DEFAULT_DOCUMENTATION_DIRECTORIES = ['docs/', 'documentation/', 'doc/'];

export class FileClassifier {
  private readonly maxFileSizeBytes: number;
  private readonly ignoreDirectoryRe: RegExp;
  private readonly extraIgnorePatterns: RegExp[];
  private readonly docFileNames: Set<string>;
  private readonly docDirectories: string[];
  private readonly ignoreLockFiles: boolean;

  constructor(options: FileClassifierOptions = {}, private readonly detector: BinaryDetector = defaultBinaryDetector) {
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 2_000_000;
    this.extraIgnorePatterns = options.extraIgnorePatterns ?? [];
    const allIgnoreDirs = [...IGNORED_DIRECTORIES, ...(options.documentationDirectories ?? [])];
    this.ignoreDirectoryRe = new RegExp(
      `(^|/)(?:${allIgnoreDirs.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/$/, '')).join('|')})/`,
      'i'
    );
    this.docFileNames = new Set(
      (options.documentationFileNames ?? DEFAULT_DOCUMENTATION_FILE_NAMES).map((n) => n.toLowerCase())
    );
    this.docDirectories = (options.documentationDirectories ?? DEFAULT_DOCUMENTATION_DIRECTORIES).map(
      (d) => d.toLowerCase()
    );
    this.ignoreLockFiles = options.ignoreLockFiles ?? true;
  }

  classify(file: RepositoryFile): ClassificationDecision {
    const path = file.path;
    const lower = path.toLowerCase();

    if (this.ignoreDirectoryRe.test('/' + lower)) {
      return {
        file,
        action: 'IGNORE',
        reason: 'ignored_directory',
      };
    }

    for (const re of IGNORED_FILE_PATTERNS) {
      if (re.test(lower)) {
        return { file, action: 'IGNORE', reason: 'binary_file' };
      }
    }
    for (const re of this.extraIgnorePatterns) {
      if (re.test(lower)) {
        return { file, action: 'IGNORE', reason: 'explicit_ignore_pattern' };
      }
    }

    if (this.ignoreLockFiles) {
      for (const re of LOCK_FILE_PATTERNS) {
        if (re.test(path)) {
          return { file, action: 'IGNORE', reason: 'lock_file' };
        }
      }
    }

    if (file.size !== undefined && file.size > this.maxFileSizeBytes) {
      return { file, action: 'IGNORE', reason: 'too_large' };
    }

    const fileName = file.name.toLowerCase();

    if (this.docFileNames.has(fileName)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'DOCUMENTATION',
        reason: 'known_markdown',
      };
    }

    if (this.docDirectories.some((d) => lower.startsWith(d))) {
      const ext = extOf(path);
      if (DOC_EXTENSIONS.has(ext)) {
        return {
          file,
          action: 'PROCESS',
          kind: 'DOCUMENTATION',
          reason: 'known_documentation_path',
        };
      }
    }

    if (CONFIG_FILE_NAMES.has(fileName)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'CONFIG',
        reason: 'known_config_file',
      };
    }

    const ext = extOf(path);

    if (DOC_EXTENSIONS.has(ext)) {
      return {
        file,
        action: 'PROCESS',
        kind: 'DOCUMENTATION',
        language: 'markdown',
        reason: 'known_markdown',
      };
    }

    if (CODE_EXTENSIONS.has(ext)) {
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
  CODE_EXTENSIONS,
  DOC_EXTENSIONS,
  CONFIG_FILE_NAMES,
  LOCK_FILE_PATTERNS,
};
export type { ProcessingKind };
