import type { ArchiveEntry, ChangedFile, FileRevision, RepositoryFile, Revision } from './types.js';

/**
 * Abstraction over any source-control host.
 *
 * Implementations are responsible for resolving revision metadata, listing
 * files, retrieving file contents, comparing two revisions, and producing
 * downloadable snapshots.
 */
export interface RepositoryAdapter {
  /** Display name for logging (never includes the token). */
  readonly name: string;

  /** Stable id used as the primary key for ingestion state. */
  readonly repositoryId: string;

  /** Resolve metadata about the repository (default branch, project id, ...). */
  getRepositoryInfo(): Promise<RepositoryInfo>;

  /** Resolve the latest commit SHA for a branch. */
  getCurrentRevision(branch: string): Promise<Revision>;

  /**
   * List all regular files reachable from `revision.commit`.
   * Directories are optionally included when `includeDirectories` is true.
   */
  listFiles(revision: Revision, options?: ListFilesOptions): Promise<RepositoryFile[]>;

  /** Fetch the raw content of a single file at a given revision. */
  getFile(revision: FileRevision): Promise<Buffer>;

  /** List files that changed between two revisions. */
  getChangedFiles(from: Revision, to: Revision): Promise<ChangedFile[]>;

  /**
   * Download a snapshot of the repository at `revision` as a tar.gz (or zip)
   * stream. Returns a fully-materialized list of ArchiveEntry — implementations
   * are free to stream-parse internally.
   */
  downloadArchive(revision: Revision): Promise<ArchiveEntry[]>;

  /** Convenience helper to fetch a slice of the repo metadata. */
  getDefaultBranch(): Promise<string>;
}

export interface RepositoryInfo {
  id: string | number;
  name: string;
  pathWithNamespace: string;
  defaultBranch: string;
  webUrl?: string;
}

export interface ListFilesOptions {
  includeDirectories?: boolean;
  pathPrefix?: string;
  recursive?: boolean;
}
