import type { Revision } from '../repository/types.js';

export type JobStatus = 'running' | 'completed' | 'failed';

export interface IngestionJob {
  jobId: string;
  repositoryId: string;
  branch: string;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  revision?: Revision;
  mode?: 'full' | 'incremental';
}

export interface BranchState {
  lastIngestedRevision?: Revision;
  jobs: IngestionJob[];
}

export interface RepositoryState {
  branches: Record<string, BranchState>;
}

export interface IngestionSnapshot {
  repositories: Record<string, RepositoryState>;
  updatedAt?: string;
}

export interface IngestionStateStore {
  load(): IngestionSnapshot;
  save(snapshot: IngestionSnapshot): void;
}

/**
 * Abstraction over ingestion state persistence. Implementations should be
 * safe to call from a single process; multi-process coordination is out of
 * scope for this phase.
 */
export interface IngestionState {
  /** Stable identifier of this state instance (e.g. file path or DB name). */
  readonly name: string;

  /** Returns the latest successfully ingested revision for a branch, if any. */
  getLatestRevision(repositoryId: string, branch: string): Revision | null;

  /** Returns true when at least one revision has been ingested for a branch. */
  hasIngestion(repositoryId: string, branch: string): boolean;

  /** Records a new successfully ingested revision. */
  setLatestRevision(revision: Revision): void;

  /** Starts a new ingestion job. Returns the freshly-created job. */
  beginJob(input: {
    jobId: string;
    repositoryId: string;
    branch: string;
    mode: 'full' | 'incremental';
  }): IngestionJob;

  /** Marks a job as completed and updates the latest-revision bookkeeping. */
  completeJob(jobId: string, revision: Revision): IngestionJob;

  /** Marks a job as failed and stores the error message. */
  failJob(jobId: string, error: string): IngestionJob;

  /** Returns the currently running job for a branch, if any. */
  getCurrentJob(repositoryId: string, branch: string): IngestionJob | null;

  /** Returns a shallow snapshot of the entire state. */
  snapshot(): IngestionSnapshot;

  /** Drops any state for a single branch (used by tests / resets). */
  clearBranch(repositoryId: string, branch: string): void;
}
