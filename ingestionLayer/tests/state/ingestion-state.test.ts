import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileIngestionStateStore,
  IngestionStateImpl,
  InMemoryIngestionStateStore,
  generateJobId,
} from '../../src/state/index.js';
import type { Revision } from '../../src/repository/types.js';

const revision: Revision = {
  repositoryId: 'group%2FpartServiceFileStorage',
  branch: 'develop',
  commit: 'aaa',
};

const revision2: Revision = {
  repositoryId: 'group%2FpartServiceFileStorage',
  branch: 'develop',
  commit: 'bbb',
};

describe('InMemoryIngestionStateStore', () => {
  let state: IngestionStateImpl;
  let store: InMemoryIngestionStateStore;

  beforeEach(() => {
    store = new InMemoryIngestionStateStore();
    state = new IngestionStateImpl(store);
  });

  it('starts empty', () => {
    expect(state.hasIngestion(revision.repositoryId, revision.branch)).toBe(false);
    expect(state.getLatestRevision(revision.repositoryId, revision.branch)).toBeNull();
  });

  it('records and retrieves the latest revision', () => {
    state.setLatestRevision(revision);
    expect(state.hasIngestion(revision.repositoryId, revision.branch)).toBe(true);
    expect(state.getLatestRevision(revision.repositoryId, revision.branch)).toEqual(revision);
  });

  it('updates the latest revision to the newer one', () => {
    state.setLatestRevision(revision);
    state.setLatestRevision(revision2);
    expect(state.getLatestRevision(revision.repositoryId, revision.branch)).toEqual(revision2);
  });

  it('tracks running jobs and exposes them via getCurrentJob', () => {
    const jobId = generateJobId({
      repositoryId: revision.repositoryId,
      branch: revision.branch,
      mode: 'full',
    });
    const started = state.beginJob({
      jobId,
      repositoryId: revision.repositoryId,
      branch: revision.branch,
      mode: 'full',
    });
    expect(started.status).toBe('running');
    expect(started.mode).toBe('full');
    const current = state.getCurrentJob(revision.repositoryId, revision.branch);
    expect(current?.jobId).toBe(jobId);
  });

  it('completes a job and records the resulting revision', () => {
    const jobId = generateJobId({
      repositoryId: revision.repositoryId,
      branch: revision.branch,
      mode: 'incremental',
    });
    state.beginJob({
      jobId,
      repositoryId: revision.repositoryId,
      branch: revision.branch,
      mode: 'incremental',
    });
    const completed = state.completeJob(jobId, revision);
    expect(completed.status).toBe('completed');
    expect(completed.revision).toEqual(revision);
    expect(state.getCurrentJob(revision.repositoryId, revision.branch)).toBeNull();
  });

  it('marks a job as failed and stores the error message', () => {
    const jobId = generateJobId({
      repositoryId: revision.repositoryId,
      branch: revision.branch,
      mode: 'full',
    });
    state.beginJob({
      jobId,
      repositoryId: revision.repositoryId,
      branch: revision.branch,
      mode: 'full',
    });
    const failed = state.failJob(jobId, 'boom');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('boom');
  });

  it('throws when completing an unknown job', () => {
    expect(() => state.completeJob('missing', revision)).toThrow();
  });

  it('throws when failing an unknown job', () => {
    expect(() => state.failJob('missing', 'x')).toThrow();
  });

  it('clearBranch removes state for one branch only', () => {
    state.setLatestRevision(revision);
    state.setLatestRevision({ ...revision, branch: 'main' });
    state.clearBranch(revision.repositoryId, revision.branch);
    expect(state.hasIngestion(revision.repositoryId, revision.branch)).toBe(false);
    expect(state.hasIngestion(revision.repositoryId, 'main')).toBe(true);
  });
});

describe('FileIngestionStateStore', () => {
  let tmpDir: string;
  let file: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rag-state-'));
    file = join(tmpDir, 'state.json');
  });

  it('returns an empty snapshot when the file does not exist', () => {
    const store = new FileIngestionStateStore(file);
    expect(store.load().repositories).toEqual({});
  });

  it('persists state across instances', () => {
    const store = new FileIngestionStateStore(file);
    const a = new IngestionStateImpl(store);
    a.setLatestRevision(revision);
    expect(existsSync(file)).toBe(true);

    const b = new IngestionStateImpl(new FileIngestionStateStore(file));
    expect(b.getLatestRevision(revision.repositoryId, revision.branch)).toEqual(revision);
  });

  it('recovers from a corrupt JSON file', () => {
    const store = new FileIngestionStateStore(file);
    store.save({ repositories: {} });
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(file, '{not json');
    const recovered = new FileIngestionStateStore(file).load();
    expect(recovered.repositories).toEqual({});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('generateJobId', () => {
  it('returns different ids for different inputs', () => {
    const a = generateJobId({ repositoryId: 'r', branch: 'main', mode: 'full' });
    const b = generateJobId({ repositoryId: 'r', branch: 'develop', mode: 'full' });
    const c = generateJobId({ repositoryId: 'r', branch: 'main', mode: 'incremental' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('keeps state JSON file readable', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rag-state-'));
    const file = join(tmpDir, 'state.json');
    const state = new IngestionStateImpl(new FileIngestionStateStore(file));
    state.setLatestRevision(revision);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('aaa');
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
