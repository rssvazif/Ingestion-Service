import { createHash } from 'node:crypto';

import type {
  IngestionJob,
  IngestionSnapshot,
  IngestionState,
  IngestionStateStore,
  RepositoryState,
  BranchState,
} from './types.js';
import type { Revision } from '../repository/types.js';

function getBranch(
  snapshot: IngestionSnapshot,
  repositoryId: string,
  branch: string
): BranchState {
  let repo = snapshot.repositories[repositoryId];
  if (!repo) {
    repo = { branches: {} };
    snapshot.repositories[repositoryId] = repo;
  }
  let br = repo.branches[branch];
  if (!br) {
    br = { jobs: [] };
    repo.branches[branch] = br;
  }
  return br;
}

/**
 * In-memory IngestionState implementation backed by a pluggable store.
 *
 * Mutating methods modify the in-memory snapshot and flush it to the
 * underlying store so reads after a process restart see the same data.
 */
export class IngestionStateImpl implements IngestionState {
  public readonly name: string;
  private data: IngestionSnapshot;
  private readonly store: IngestionStateStore;

  constructor(store: IngestionStateStore, name?: string) {
    this.store = store;
    this.name = name ?? store.constructor.name;
    this.data = this.store.load();
  }

  getLatestRevision(repositoryId: string, branch: string): Revision | null {
    const br = this.data.repositories[repositoryId]?.branches[branch];
    return br?.lastIngestedRevision ?? null;
  }

  hasIngestion(repositoryId: string, branch: string): boolean {
    return this.getLatestRevision(repositoryId, branch) !== null;
  }

  setLatestRevision(revision: Revision): void {
    const br = getBranch(this.data, revision.repositoryId, revision.branch);
    br.lastIngestedRevision = revision;
    this.persist();
  }

  beginJob(input: {
    jobId: string;
    repositoryId: string;
    branch: string;
    mode: 'full' | 'incremental';
  }): IngestionJob {
    const job: IngestionJob = {
      jobId: input.jobId,
      repositoryId: input.repositoryId,
      branch: input.branch,
      mode: input.mode,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const br = getBranch(this.data, input.repositoryId, input.branch);
    br.jobs.push(job);
    this.persist();
    return job;
  }

  completeJob(jobId: string, revision: Revision): IngestionJob {
    const repo: RepositoryState | undefined = this.data.repositories[revision.repositoryId];
    const br = repo?.branches[revision.branch];
    if (!br) {
      throw new Error(`No branch state found for ${revision.repositoryId}@${revision.branch}`);
    }
    const job = br.jobs.find((j) => j.jobId === jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.revision = revision;
    br.lastIngestedRevision = revision;
    this.persist();
    return job;
  }

  failJob(jobId: string, error: string): IngestionJob {
    for (const repo of Object.values(this.data.repositories)) {
      for (const br of Object.values(repo.branches)) {
        const job = br.jobs.find((j) => j.jobId === jobId);
        if (job) {
          job.status = 'failed';
          job.completedAt = new Date().toISOString();
          job.error = error;
          this.persist();
          return job;
        }
      }
    }
    throw new Error(`Job ${jobId} not found`);
  }

  getCurrentJob(repositoryId: string, branch: string): IngestionJob | null {
    const br = this.data.repositories[repositoryId]?.branches[branch];
    if (!br) return null;
    for (let i = br.jobs.length - 1; i >= 0; i -= 1) {
      if (br.jobs[i]!.status === 'running') return br.jobs[i]!;
    }
    return null;
  }

  snapshot(): IngestionSnapshot {
    return JSON.parse(JSON.stringify(this.data)) as IngestionSnapshot;
  }

  clearBranch(repositoryId: string, branch: string): void {
    const repo = this.data.repositories[repositoryId];
    if (!repo) return;
    delete repo.branches[branch];
    if (Object.keys(repo.branches).length === 0) {
      delete this.data.repositories[repositoryId];
    }
    this.persist();
  }

  private persist(): void {
    this.store.save(this.data);
  }
}

export function generateJobId(input: {
  repositoryId: string;
  branch: string;
  mode: 'full' | 'incremental';
}): string {
  const ts = Date.now();
  const random = Math.floor(Math.random() * 1e6).toString(36);
  const key = `${input.repositoryId}|${input.branch}|${input.mode}|${ts}|${random}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}
