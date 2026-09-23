import { createHash } from 'node:crypto';

/**
 * @param {IngestionSnapshot} snapshot
 * @param {string} repositoryId
 * @param {string} branch
 * @returns {BranchState}
 */
function getBranch(snapshot, repositoryId, branch) {
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
export class IngestionStateImpl {
  /** @type {string} */
  name;
  /** @type {IngestionSnapshot} */
  #data;
  /** @type {IngestionStateStore} */
  #store;

  /**
   * @param {IngestionStateStore} store
   * @param {string} [name]
   */
  constructor(store, name) {
    this.#store = store;
    this.name = name ?? store.constructor.name;
    this.#data = this.#store.load();
  }

  /**
   * @param {string} repositoryId
   * @param {string} branch
   * @returns {import('../repository/types.js').Revision | null}
   */
  getLatestRevision(repositoryId, branch) {
    const br = this.#data.repositories[repositoryId]?.branches[branch];
    return br?.lastIngestedRevision ?? null;
  }

  /**
   * @param {string} repositoryId
   * @param {string} branch
   * @returns {boolean}
   */
  hasIngestion(repositoryId, branch) {
    return this.getLatestRevision(repositoryId, branch) !== null;
  }

  /** @param {import('../repository/types.js').Revision} revision */
  setLatestRevision(revision) {
    const br = getBranch(this.#data, revision.repositoryId, revision.branch);
    br.lastIngestedRevision = revision;
    this.#persist();
  }

  /**
   * @param {{ jobId: string, repositoryId: string, branch: string, mode: 'full' | 'incremental' }} input
   * @returns {IngestionJob}
   */
  beginJob(input) {
    const job = {
      jobId: input.jobId,
      repositoryId: input.repositoryId,
      branch: input.branch,
      mode: input.mode,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const br = getBranch(this.#data, input.repositoryId, input.branch);
    br.jobs.push(job);
    this.#persist();
    return job;
  }

  /**
   * @param {string} jobId
   * @param {import('../repository/types.js').Revision} revision
   * @returns {IngestionJob}
   */
  completeJob(jobId, revision) {
    const repo = this.#data.repositories[revision.repositoryId];
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
    this.#persist();
    return job;
  }

  /**
   * @param {string} jobId
   * @param {string} error
   * @returns {IngestionJob}
   */
  failJob(jobId, error) {
    for (const repo of Object.values(this.#data.repositories)) {
      for (const br of Object.values(repo.branches)) {
        const job = br.jobs.find((j) => j.jobId === jobId);
        if (job) {
          job.status = 'failed';
          job.completedAt = new Date().toISOString();
          job.error = error;
          this.#persist();
          return job;
        }
      }
    }
    throw new Error(`Job ${jobId} not found`);
  }

  /**
   * @param {string} repositoryId
   * @param {string} branch
   * @returns {IngestionJob | null}
   */
  getCurrentJob(repositoryId, branch) {
    const br = this.#data.repositories[repositoryId]?.branches[branch];
    if (!br) return null;
    for (let i = br.jobs.length - 1; i >= 0; i -= 1) {
      if (br.jobs[i].status === 'running') return br.jobs[i];
    }
    return null;
  }

  /** @returns {IngestionSnapshot} */
  snapshot() {
    return JSON.parse(JSON.stringify(this.#data));
  }

  /**
   * @param {string} repositoryId
   * @param {string} branch
   */
  clearBranch(repositoryId, branch) {
    const repo = this.#data.repositories[repositoryId];
    if (!repo) return;
    delete repo.branches[branch];
    if (Object.keys(repo.branches).length === 0) {
      delete this.#data.repositories[repositoryId];
    }
    this.#persist();
  }

  #persist() {
    this.#store.save(this.#data);
  }
}

/**
 * @param {{ repositoryId: string, branch: string, mode: 'full' | 'incremental' }} input
 * @returns {string}
 */
export function generateJobId(input) {
  const ts = Date.now();
  const random = Math.floor(Math.random() * 1e6).toString(36);
  const key = `${input.repositoryId}|${input.branch}|${input.mode}|${ts}|${random}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}