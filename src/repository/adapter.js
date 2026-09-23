/**
 * Abstraction over any source-control host.
 *
 * Implementations are responsible for resolving revision metadata, listing
 * files, retrieving file contents, comparing two revisions, and producing
 * downloadable snapshots.
 *
 * @typedef {object} RepositoryAdapter
 * @property {string} name                Display name for logging (never includes the token).
 * @property {string} repositoryId        Stable id used as the primary key for ingestion state.
 * @property {() => Promise<RepositoryInfo>} getRepositoryInfo
 * @property {(branch: string) => Promise<import('./types.js').Revision>} getCurrentRevision
 * @property {(revision: import('./types.js').Revision, options?: ListFilesOptions) => Promise<import('./types.js').RepositoryFile[]>} listFiles
 * @property {(revision: import('./types.js').FileRevision) => Promise<Buffer>} getFile
 * @property {(from: import('./types.js').Revision, to: import('./types.js').Revision) => Promise<import('./types.js').ChangedFile[]>} getChangedFiles
 * @property {(revision: import('./types.js').Revision) => Promise<import('./types.js').ArchiveEntry[]>} downloadArchive
 * @property {() => Promise<string>} getDefaultBranch
 */

/**
 * @typedef {object} RepositoryInfo
 * @property {string | number} id
 * @property {string} name
 * @property {string} pathWithNamespace
 * @property {string} defaultBranch
 * @property {string} [webUrl]
 */

/**
 * @typedef {object} ListFilesOptions
 * @property {boolean} [includeDirectories]
 * @property {string} [pathPrefix]
 * @property {boolean} [recursive]
 */