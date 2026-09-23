/**
 * Repository file representation produced by the Repository Adapter and
 * consumed by downstream classification / parsing layers.
 *
 * @typedef {object} RepositoryFile
 * @property {string} path               Repo-relative POSIX path, e.g. "src/services/user.service.ts"
 * @property {string} name               File name only, e.g. "user.service.ts"
 * @property {('file' | 'directory')} type Either 'file' or 'directory' when reported by the adapter.
 * @property {number} [size]             File size in bytes (best-effort, may be undefined when listing the tree).
 * @property {string} [hash]             Git blob SHA when known.
 * @property {string} [commit]           Commit SHA the file listing was produced from.
 * @property {string} [language]         Programming language inferred from the extension (lower-case).
 */

/**
 * A single point in the repository's history.
 *
 * - commit: full or short SHA, exactly the value GitLab returns for the branch
 * - branch: branch name resolved at ingestion time
 * - version: optional application-defined version label (e.g. tag)
 * - repositoryId: a stable id (project id / url-encoded path) used for state tracking
 *
 * @typedef {object} Revision
 * @property {string} repositoryId
 * @property {string} commit
 * @property {string} branch
 * @property {string} [version]
 */

/** Identifier for a particular file inside a particular revision.
 * @typedef {object} FileRevision
 * @property {string} path
 * @property {string} commit
 * @property {string} [hash]
 * @property {number} [size]
 */

/** @typedef {('added' | 'modified' | 'deleted')} ChangeType */

/** One entry returned by GitLab's compare API.
 * @typedef {object} ChangedFile
 * @property {string} path
 * @property {string} [oldPath]
 * @property {ChangeType} changeType
 * @property {string} [newHash] Blob SHA of the new content (added / modified).
 * @property {string} [oldHash] Blob SHA of the previous content (modified / deleted).
 */

/**
 * One entry inside a downloaded archive (tar.gz / zip) snapshot.
 *
 * For incremental ingestion we still go through the same shape so downstream
 * code can treat both full and incremental inputs uniformly.
 *
 * @typedef {object} ArchiveEntry
 * @property {string} path
 * @property {Buffer} content
 * @property {number} size
 * @property {number} [mode]
 */