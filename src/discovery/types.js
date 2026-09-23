/**
 * @typedef {('PROCESS' | 'IGNORE')} ClassificationAction
 * @typedef {('CODE' | 'DOCUMENTATION' | 'CONFIG')} ProcessingKind
 * @typedef {(
 *   'known_markdown' | 'known_code_extension' | 'known_config_file' |
 *   'known_documentation_path' | 'unknown_extension' | 'ignored_directory' |
 *   'generated_directory' | 'test_artifact' | 'snapshot' | 'log_file' |
 *   'binary_file' | 'lock_file' | 'too_large' | 'explicit_ignore_pattern'
 * )} ClassificationReason
 */

/**
 * @typedef {object} ClassificationDecision
 * @property {import('../repository/types.js').RepositoryFile} file
 * @property {ClassificationAction} action
 * @property {ProcessingKind} [kind]
 * @property {string} [language]
 * @property {ClassificationReason} reason
 */

/**
 * Options for {@link FileClassifier}.
 * @typedef {object} FileClassifierOptions
 * @property {number} [maxFileSizeBytes]              Maximum file size in bytes; files larger than this are ignored.
 * @property {RegExp[]} [extraIgnorePatterns]          Additional ignore patterns (regex or glob-style strings).
 * @property {string[]} [documentationFileNames]       File names treated as documentation (case-insensitive).
 * @property {string[]} [documentationDirectories]     Additional file paths treated as documentation directories.
 * @property {boolean} [ignoreLockFiles]               Whether to ignore lock files (package-lock.json, yarn.lock, etc.).
 * @property {string[]} [ignoreDirectories]            Override the set of directories classified as `generated_directory`.
 * @property {RegExp[]} [testArtifactPatterns]         Override the set of patterns classified as `test_artifact`.
 * @property {RegExp[]} [snapshotPatterns]             Override the set of patterns classified as `snapshot`.
 * @property {RegExp[]} [logFilePatterns]              Override the set of patterns classified as `log_file`.
 */

/**
 * Result of running classify() over an array of files.
 * @typedef {object} ClassificationResult
 * @property {ClassificationDecision[]} processed
 * @property {ClassificationDecision[]} ignored
 */

/**
 * Detector helpers - kept as injectable so tests can swap in deterministic
 * implementations if needed. By default these use a small NUL-byte heuristic
 * for binary detection.
 *
 * @typedef {object} BinaryDetector
 * @property {(content: Buffer) => boolean} isBinary
 */

/** @type {BinaryDetector} */
export const defaultBinaryDetector = {
  isBinary(content) {
    if (content.length === 0) return false;
    const sample = content.subarray(0, Math.min(8192, content.length));
    for (let i = 0; i < sample.length; i += 1) {
      if (sample[i] === 0) return true;
    }
    return false;
  },
};