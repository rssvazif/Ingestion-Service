/**
 * Repository file representation produced by the Repository Adapter and
 * consumed by downstream classification / parsing layers.
 */
export interface RepositoryFile {
  /** Repo-relative POSIX path, e.g. "src/services/user.service.ts" */
  path: string;
  /** File name only, e.g. "user.service.ts" */
  name: string;
  /** Either 'file' or 'directory' when reported by the adapter */
  type: 'file' | 'directory';
  /** File size in bytes (best-effort, may be undefined when listing the tree) */
  size?: number;
  /** Git blob SHA when known */
  hash?: string;
  /** Commit SHA the file listing was produced from */
  commit?: string;
  /** Programming language inferred from the extension (lower-case) */
  language?: string;
}

/**
 * A single point in the repository's history.
 *
 * - commit: full or short SHA, exactly the value GitLab returns for the branch
 * - branch: branch name resolved at ingestion time
 * - version: optional application-defined version label (e.g. tag)
 * - repositoryId: a stable id (project id / url-encoded path) used for state tracking
 */
export interface Revision {
  repositoryId: string;
  commit: string;
  branch: string;
  version?: string;
}

/** Identifier for a particular file inside a particular revision. */
export interface FileRevision {
  path: string;
  commit: string;
  hash?: string;
  size?: number;
}

export type ChangeType = 'added' | 'modified' | 'deleted';

/** One entry returned by GitLab's compare API. */
export interface ChangedFile {
  path: string;
  oldPath?: string;
  changeType: ChangeType;
  /** Blob SHA of the new content (added / modified) */
  newHash?: string;
  /** Blob SHA of the previous content (modified / deleted) */
  oldHash?: string;
}

/**
 * One entry inside a downloaded archive (tar.gz / zip) snapshot.
 *
 * For incremental ingestion we still go through the same shape so downstream
 * code can treat both full and incremental inputs uniformly.
 */
export interface ArchiveEntry {
  path: string;
  content: Buffer;
  size: number;
  mode?: number;
}
