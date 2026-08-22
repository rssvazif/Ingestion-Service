import type { RepositoryFile } from '../repository/types.js';

export type ClassificationAction = 'PROCESS' | 'IGNORE';

export type ProcessingKind = 'CODE' | 'DOCUMENTATION' | 'CONFIG';

export type ClassificationReason =
  | 'known_markdown'
  | 'known_code_extension'
  | 'known_config_file'
  | 'known_documentation_path'
  | 'unknown_extension'
  | 'ignored_directory'
  | 'binary_file'
  | 'lock_file'
  | 'too_large'
  | 'explicit_ignore_pattern';

export interface ClassificationDecision {
  file: RepositoryFile;
  action: ClassificationAction;
  kind?: ProcessingKind;
  language?: string;
  reason: ClassificationReason;
}

/** Options for {@link FileClassifier}. */
export interface FileClassifierOptions {
  /** Maximum file size in bytes; files larger than this are ignored. */
  maxFileSizeBytes?: number;
  /** Additional ignore patterns (regex or glob-style strings). */
  extraIgnorePatterns?: RegExp[];
  /** File names treated as documentation (case-insensitive). */
  documentationFileNames?: string[];
  /** Additional file paths treated as documentation directories. */
  documentationDirectories?: string[];
  /** Whether to ignore lock files (package-lock.json, yarn.lock, etc.). */
  ignoreLockFiles?: boolean;
}

/** Result of running classify() over an array of files. */
export interface ClassificationResult {
  processed: ClassificationDecision[];
  ignored: ClassificationDecision[];
}

/**
 * Detector helpers - kept as injectable so tests can swap in deterministic
 * implementations if needed. By default these use a small NUL-byte heuristic
 * for binary detection.
 */
export interface BinaryDetector {
  isBinary(content: Buffer): boolean;
}

export const defaultBinaryDetector: BinaryDetector = {
  isBinary(content: Buffer): boolean {
    if (content.length === 0) return false;
    const sample = content.subarray(0, Math.min(8192, content.length));
    for (let i = 0; i < sample.length; i += 1) {
      if (sample[i] === 0) return true;
    }
    return false;
  },
};
