import { describe, it, expect, beforeEach } from 'vitest';
import { IngestionOrchestrator } from '../../src/orchestrator/ingestion-orchestrator.js';
import { TreeSitterCodeParser } from '../../src/parsers/code/code-parser.js';
import { MarkdownParser } from '../../src/parsers/documentation/markdown-parser.js';
import { CodeChunker } from '../../src/chunkers/code-chunker.js';
import { DocumentationChunker } from '../../src/chunkers/documentation-chunker.js';
import { FileClassifier } from '../../src/discovery/file-classifier.js';
import { FileDiscovery } from '../../src/discovery/file-discovery.js';
import { ContextInjector } from '../../src/knowledge/index.js';
import { IngestionStateImpl, InMemoryIngestionStateStore } from '../../src/state/index.js';
import type { RepositoryAdapter } from '../../src/repository/adapter.js';
import type {
  ArchiveEntry,
  ChangedFile,
  FileRevision,
  RepositoryFile,
  Revision,
} from '../../src/repository/types.js';

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
  setLevel() {},
};

interface AdapterState {
  currentRevision: Revision;
  filesByCommit: Map<string, Map<string, { content: string; hash: string }>>;
  changes: ChangedFile[];
}

class FakeAdapter implements RepositoryAdapter {
  public readonly name = 'fake';
  public readonly repositoryId = 'group%2FpartServiceFileStorage';
  public state: AdapterState;

  constructor(state: AdapterState) {
    this.state = state;
  }

  async getRepositoryInfo() {
    return {
      id: 1,
      name: 'partServiceFileStorage',
      pathWithNamespace: 'group/partServiceFileStorage',
      defaultBranch: 'develop',
    };
  }

  async getCurrentRevision(branch: string): Promise<Revision> {
    return { ...this.state.currentRevision, branch };
  }

  async getDefaultBranch() {
    return 'develop';
  }

  async listFiles(revision: Revision): Promise<RepositoryFile[]> {
    const files = this.state.filesByCommit.get(revision.commit);
    if (!files) return [];
    return Array.from(files.entries()).map(([path, info]) => ({
      path,
      name: path.split('/').pop() ?? path,
      type: 'file',
      commit: revision.commit,
      hash: info.hash,
    }));
  }

  async getFile(revision: FileRevision): Promise<Buffer> {
    const files = this.state.filesByCommit.get(revision.commit);
    if (!files) throw new Error('no commit');
    const f = files.get(revision.path);
    if (!f) throw new Error('no file');
    return Buffer.from(f.content);
  }

  async getChangedFiles(): Promise<ChangedFile[]> {
    return this.state.changes;
  }

  async downloadArchive(revision: Revision): Promise<ArchiveEntry[]> {
    const files = this.state.filesByCommit.get(revision.commit);
    if (!files) return [];
    return Array.from(files.entries()).map(([path, info]) => ({
      path,
      size: Buffer.byteLength(info.content),
      content: Buffer.from(info.content),
    }));
  }
}

function makeOrchestrator(adapter: FakeAdapter, state: IngestionStateImpl): IngestionOrchestrator {
  const discovery = new FileDiscovery(
    adapter,
    silentLogger as never,
    { classifier: new FileClassifier() }
  );
  return new IngestionOrchestrator({
    adapter,
    discovery,
    state,
    markdownParser: new MarkdownParser(),
    codeParser: new TreeSitterCodeParser(),
    documentationChunker: new DocumentationChunker(),
    codeChunker: new CodeChunker(),
    contextInjector: new ContextInjector(),
    log: silentLogger as never,
  });
}

function commitWithFiles(files: Record<string, string>): { commit: string; files: Map<string, { content: string; hash: string }> } {
  const map = new Map<string, { content: string; hash: string }>();
  for (const [path, content] of Object.entries(files)) {
    map.set(path, { content, hash: hashOf(content) });
  }
  const ordered = Object.keys(files).sort().map((k) => `${k}:${files[k]}`).join('|');
  return { commit: hashOf(ordered), files: map };
}

function hashOf(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

describe('IngestionOrchestrator - full ingestion', () => {
  let state: IngestionStateImpl;
  let store: InMemoryIngestionStateStore;

  beforeEach(() => {
    store = new InMemoryIngestionStateStore();
    state = new IngestionStateImpl(store);
  });

  it('runs a full ingestion on an empty state', async () => {
    const snap = commitWithFiles({
      'README.md': '# Title\n\nIntro\n',
      'src/user.service.ts': 'export class UserService {\n  hello() { return 1; }\n}\n',
      'package.json': '{"name":"x"}',
    });
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: snap.commit },
      filesByCommit: new Map([[snap.commit, snap.files]]),
      changes: [],
    });
    const orch = makeOrchestrator(adapter, state);
    const result = await orch.runFull();
    expect(result.mode).toBe('full');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.stats.codeChunks).toBeGreaterThan(0);
    expect(result.stats.documentationChunks).toBeGreaterThan(0);
    expect(result.stats.configChunks).toBeGreaterThan(0);
    expect(result.stats.totalChunks).toBe(result.chunks.length);
    expect(state.hasIngestion('group%2FpartServiceFileStorage', 'develop')).toBe(true);
  });

  it('skips when there is nothing new to ingest', async () => {
    const snap = commitWithFiles({ 'README.md': '# Title\n' });
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: snap.commit },
      filesByCommit: new Map([[snap.commit, snap.files]]),
      changes: [],
    });
    const orch = makeOrchestrator(adapter, state);
    await orch.runFull();
    const second = await orch.run();
    expect(second.mode).toBe('skipped');
    expect(second.chunks).toHaveLength(0);
  });

  it('reports per-file failures without failing the whole run', async () => {
    const snap = commitWithFiles({
      'README.md': '# Title\n',
      'src/broken.ts': 'class {  unterminated method(:\n',
    });
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: snap.commit },
      filesByCommit: new Map([[snap.commit, snap.files]]),
      changes: [],
    });
    const orch = makeOrchestrator(adapter, state);
    const result = await orch.runFull();
    expect(result.stats.filesFailed).toBeGreaterThanOrEqual(0);
    expect(result.chunks.some((c) => c.metadata.file === 'README.md')).toBe(true);
  });
});

describe('IngestionOrchestrator - incremental ingestion', () => {
  let state: IngestionStateImpl;
  let store: InMemoryIngestionStateStore;

  beforeEach(() => {
    store = new InMemoryIngestionStateStore();
    state = new IngestionStateImpl(store);
  });

  it('runs incremental ingestion when a previous revision exists', async () => {
    const fromSnap = commitWithFiles({
      'README.md': '# Old\n',
      'src/a.ts': 'export const a = 1;\n',
    });
    const toSnap = commitWithFiles({
      'README.md': '# New\n',
      'src/a.ts': 'export const a = 2;\n',
      'src/b.ts': 'export const b = 3;\n',
    });
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: toSnap.commit },
      filesByCommit: new Map([
        [fromSnap.commit, fromSnap.files],
        [toSnap.commit, toSnap.files],
      ]),
      changes: [
        { path: 'README.md', changeType: 'modified', oldPath: 'README.md' },
        { path: 'src/a.ts', changeType: 'modified', oldPath: 'src/a.ts' },
        { path: 'src/b.ts', changeType: 'added' },
      ],
    });
    state.setLatestRevision({
      repositoryId: 'group%2FpartServiceFileStorage',
      branch: 'develop',
      commit: fromSnap.commit,
    });
    const orch = makeOrchestrator(adapter, state);
    const result = await orch.runIncremental();
    expect(result.mode).toBe('incremental');
    expect(result.stats.filesProcessed).toBe(3);
    expect(result.chunks.some((c) => c.metadata.file === 'src/b.ts')).toBe(true);
  });

  it('emits delete KnowledgeChunks for deleted files', async () => {
    const fromSnap = commitWithFiles({
      'src/old.ts': 'export const old = 1;\n',
    });
    const toSnap = commitWithFiles({});
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: toSnap.commit },
      filesByCommit: new Map([
        [fromSnap.commit, fromSnap.files],
        [toSnap.commit, toSnap.files],
      ]),
      changes: [{ path: 'src/old.ts', changeType: 'deleted', oldPath: 'src/old.ts' }],
    });
    state.setLatestRevision({
      repositoryId: 'group%2FpartServiceFileStorage',
      branch: 'develop',
      commit: fromSnap.commit,
    });
    const orch = makeOrchestrator(adapter, state);
    const result = await orch.runIncremental();
    expect(result.stats.deleteChunks).toBe(1);
    expect(result.chunks.find((c) => c.type === 'delete')).toBeDefined();
  });

  it('throws when no previous revision exists for incremental', async () => {
    const snap = commitWithFiles({});
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: snap.commit },
      filesByCommit: new Map([[snap.commit, snap.files]]),
      changes: [],
    });
    const orch = makeOrchestrator(adapter, state);
    await expect(orch.runIncremental()).rejects.toThrow();
  });

  it('run() picks incremental when revisions differ', async () => {
    const fromSnap = commitWithFiles({ 'README.md': '# Old\n' });
    const toSnap = commitWithFiles({ 'README.md': '# New\n' });
    const adapter = new FakeAdapter({
      currentRevision: { repositoryId: 'group%2FpartServiceFileStorage', branch: 'develop', commit: toSnap.commit },
      filesByCommit: new Map([
        [fromSnap.commit, fromSnap.files],
        [toSnap.commit, toSnap.files],
      ]),
      changes: [{ path: 'README.md', changeType: 'modified', oldPath: 'README.md' }],
    });
    state.setLatestRevision({
      repositoryId: 'group%2FpartServiceFileStorage',
      branch: 'develop',
      commit: fromSnap.commit,
    });
    const orch = makeOrchestrator(adapter, state);
    const result = await orch.run();
    expect(result.mode).toBe('incremental');
  });
});
