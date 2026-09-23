/**
 * @typedef {('running' | 'completed' | 'failed')} JobStatus
 */

/**
 * @typedef {object} IngestionJob
 * @property {string} jobId
 * @property {string} repositoryId
 * @property {string} branch
 * @property {JobStatus} status
 * @property {string} startedAt
 * @property {string} [completedAt]
 * @property {string} [error]
 * @property {import('../repository/types.js').Revision} [revision]
 * @property {('full' | 'incremental')} [mode]
 */

/**
 * @typedef {object} BranchState
 * @property {import('../repository/types.js').Revision} [lastIngestedRevision]
 * @property {IngestionJob[]} jobs
 */

/**
 * @typedef {object} RepositoryState
 * @property {Record<string, BranchState>} branches
 */

/**
 * @typedef {object} IngestionSnapshot
 * @property {Record<string, RepositoryState>} repositories
 * @property {string} [updatedAt]
 */

/**
 * @typedef {object} IngestionStateStore
 * @property {() => IngestionSnapshot} load
 * @property {(snapshot: IngestionSnapshot) => void} save
 */

/**
 * Abstraction over ingestion state persistence. Implementations should be
 * safe to call from a single process; multi-process coordination is out of
 * scope for this phase.
 *
 * @typedef {object} IngestionState
 * @property {string} name                                  Stable identifier of this state instance (e.g. file path or DB name).
 * @property {(repositoryId: string, branch: string) => import('../repository/types.js').Revision | null} getLatestRevision
 * @property {(repositoryId: string, branch: string) => boolean} hasIngestion
 * @property {(revision: import('../repository/types.js').Revision) => void} setLatestRevision
 * @property {(input: { jobId: string, repositoryId: string, branch: string, mode: 'full' | 'incremental' }) => IngestionJob} beginJob
 * @property {(jobId: string, revision: import('../repository/types.js').Revision) => IngestionJob} completeJob
 * @property {(jobId: string, error: string) => IngestionJob} failJob
 * @property {(repositoryId: string, branch: string) => IngestionJob | null} getCurrentJob
 * @property {() => IngestionSnapshot} snapshot
 * @property {(repositoryId: string, branch: string) => void} clearBranch
 */