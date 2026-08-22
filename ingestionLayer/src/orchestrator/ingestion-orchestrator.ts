import type { RepositoryAdapter } from '../repository/adapter.js';
import type { Revision } from '../repository/types.js';
import type { ClassificationResult } from '../discovery/types.js';
import type { FileDiscovery } from '../discovery/file-discovery.js';
import type { Logger } from '../logger/index.js';
import type { IngestionState } from '../state/index.js';
import type { MarkdownParser } from '../parsers/documentation/markdown-parser.js';
import type { TreeSitterCodeParser } from '../parsers/code/code-parser.js';
import type { CodeChunker } from '../chunkers/code-chunker.js';
import type { DocumentationChunker } from '../chunkers/documentation-chunker.js';
import type { ContextInjector } from '../knowledge/index.js';
import type { KnowledgeChunk } from '../knowledge/types.js';
import { generateJobId, IngestionStateImpl } from '../state/index.js';
import { defaultContextInjector } from '../knowledge/index.js';
import { FileParseError } from '../errors/index.js';

export type IngestionMode = 'full' | 'incremental' | 'skipped';

export interface IngestionOrchestratorDeps {
  adapter: RepositoryAdapter;
  discovery: FileDiscovery;
  state: IngestionState;
  markdownParser: MarkdownParser;
  codeParser: TreeSitterCodeParser;
  documentationChunker: DocumentationChunker;
  codeChunker: CodeChunker;
  contextInjector?: ContextInjector;
  log: Logger;
}

export interface IngestionRunOptions {
  /** Override the configured branch. */
  branch?: string;
  /** Force a full ingestion even when state exists. */
  forceFull?: boolean;
  /** Override the configured repository id. */
  repositoryId?: string;
}

export interface FileFailure {
  path: string;
  stage: 'fetch' | 'parse' | 'chunk' | 'inject';
  error: string;
}

export interface IngestionResult {
  mode: IngestionMode;
  repository: {
    id: string;
    name: string;
    webUrl?: string;
  };
  branch: string;
  revision?: Revision;
  previousRevision?: Revision;
  jobId?: string;
  stats: {
    filesDiscovered: number;
    filesIgnored: number;
    filesProcessed: number;
    filesFailed: number;
    codeChunks: number;
    documentationChunks: number;
    configChunks: number;
    deleteChunks: number;
    totalChunks: number;
  };
  failures: FileFailure[];
  chunks: KnowledgeChunk[];
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

/**
 * One entry inside the orchestrator's file-processing pipeline. Holds the
 * raw content plus the classification decision so downstream stages can
 * dispatch on the kind without re-classifying.
 */
interface ProcessedFile {
  path: string;
  name: string;
  size: number;
  commit: string;
  hash?: string;
  classification: ClassificationResult['processed'][number];
  content: Buffer;
  changeType: 'added' | 'modified' | 'deleted';
}

export class IngestionOrchestrator {
  private readonly deps: IngestionOrchestratorDeps;
  private readonly contextInjector: ContextInjector;

  constructor(deps: IngestionOrchestratorDeps) {
    this.deps = deps;
    this.contextInjector = deps.contextInjector ?? defaultContextInjector();
  }

  async run(options: IngestionRunOptions = {}): Promise<IngestionResult> {
    const start = Date.now();
    try {
      const branch = options.branch ?? (await this.deps.adapter.getDefaultBranch());
      const repositoryId = options.repositoryId ?? this.deps.adapter.repositoryId;

      const revision = await this.deps.adapter.getCurrentRevision(branch);
      const previousRevision =
        this.deps.state.getLatestRevision(repositoryId, branch) ?? undefined;
      const forceFull = options.forceFull === true;

      if (!previousRevision) {
        return this.runFullInternal({
          branch,
          repositoryId,
          revision,
          previousRevision,
          start,
        });
      }

      if (previousRevision.commit === revision.commit) {
        if (!forceFull) {
          this.deps.log.info('No revision change detected; nothing to do', {
            branch,
            commit: revision.commit,
          });
          return this.buildSkippedResult({
            branch,
            revision,
            previousRevision,
            start,
          });
        }
        return this.runFullInternal({
          branch,
          repositoryId,
          revision,
          previousRevision,
          start,
        });
      }

      return this.runIncrementalInternal({
        branch,
        repositoryId,
        from: previousRevision,
        to: revision,
        start,
      });
    } catch (err) {
      this.deps.log.error('Ingestion failed', { error: (err as Error).message });
      throw err;
    }
  }

  async runFull(options: IngestionRunOptions = {}): Promise<IngestionResult> {
    const start = Date.now();
    const branch = options.branch ?? (await this.deps.adapter.getDefaultBranch());
    const repositoryId = options.repositoryId ?? this.deps.adapter.repositoryId;
    const revision = await this.deps.adapter.getCurrentRevision(branch);
    const previousRevision =
      this.deps.state.getLatestRevision(repositoryId, branch) ?? undefined;
    return this.runFullInternal({
      branch,
      repositoryId,
      revision,
      previousRevision,
      start,
    });
  }

  async runIncremental(options: IngestionRunOptions = {}): Promise<IngestionResult> {
    const start = Date.now();
    const branch = options.branch ?? (await this.deps.adapter.getDefaultBranch());
    const repositoryId = options.repositoryId ?? this.deps.adapter.repositoryId;
    const to = await this.deps.adapter.getCurrentRevision(branch);
    const from =
      this.deps.state.getLatestRevision(repositoryId, branch) ??
      ((): Revision => {
        throw new Error(
          'No previous ingestion state available; cannot run incrementally'
        );
      })();
    return this.runIncrementalInternal({ branch, repositoryId, from, to, start });
  }

  // -- Internals --------------------------------------------------------

  private async runFullInternal(input: {
    branch: string;
    repositoryId: string;
    revision: Revision;
    previousRevision?: Revision;
    start: number;
  }): Promise<IngestionResult> {
    const { branch, repositoryId, revision } = input;
    const jobId = generateJobId({ repositoryId, branch, mode: 'full' });
    this.deps.state.beginJob({ jobId, repositoryId, branch, mode: 'full' });
    this.deps.log.info('Starting full ingestion', {
      branch,
      commit: revision.commit,
      jobId,
    });
    const discovery = await this.deps.discovery.discoverFull(revision);
    const processed: ProcessedFile[] = [];
    const failures: FileFailure[] = [];
    for (const entry of discovery.entries) {
      const decision = discovery.classification.processed.find(
        (d) => d.file.path === entry.path
      );
      if (!decision) continue;
      processed.push({
        path: entry.path,
        name: entry.path.split('/').pop() ?? entry.path,
        size: entry.size,
        commit: revision.commit,
        classification: decision,
        content: entry.content,
        changeType: 'added',
      });
    }
    const result = await this.processFiles({
      branch,
      repositoryId,
      revision,
      files: processed,
      deletions: [],
      ignored: discovery.classification.ignored.length,
      failures,
      start: input.start,
      mode: 'full',
      jobId,
    });
    this.deps.state.completeJob(jobId, revision);
    return result;
  }

  private async runIncrementalInternal(input: {
    branch: string;
    repositoryId: string;
    from: Revision;
    to: Revision;
    start: number;
  }): Promise<IngestionResult> {
    const { branch, repositoryId, from, to } = input;
    const jobId = generateJobId({ repositoryId, branch, mode: 'incremental' });
    this.deps.state.beginJob({ jobId, repositoryId, branch, mode: 'incremental' });
    this.deps.log.info('Starting incremental ingestion', {
      branch,
      from: from.commit,
      to: to.commit,
      jobId,
    });
    const discovery = await this.deps.discovery.discoverIncremental(from, to);
    const processed: ProcessedFile[] = [];
    const failures: FileFailure[] = [];
    for (const entry of discovery.entries) {
      const decision = discovery.classification.processed.find(
        (d) => d.file.path === entry.path
      );
      if (!decision) continue;
      const change = discovery.changes.find((c) => c.path === entry.path);
      processed.push({
        path: entry.path,
        name: entry.path.split('/').pop() ?? entry.path,
        size: entry.size,
        commit: to.commit,
        hash: change?.newHash,
        classification: decision,
        content: entry.content,
        changeType: change?.changeType === 'deleted' ? 'deleted' : 'modified',
      });
    }
    const result = await this.processFiles({
      branch,
      repositoryId,
      revision: to,
      files: processed,
      deletions: discovery.deleted,
      ignored: discovery.classification.ignored.length,
      failures,
      start: input.start,
      mode: 'incremental',
      jobId,
      previousRevision: from,
    });
    this.deps.state.completeJob(jobId, to);
    return result;
  }

  private async processFiles(input: {
    branch: string;
    repositoryId: string;
    revision: Revision;
    files: ProcessedFile[];
    deletions: import('../repository/types.js').ChangedFile[];
    ignored: number;
    failures: FileFailure[];
    start: number;
    mode: 'full' | 'incremental';
    jobId: string;
    previousRevision?: Revision;
  }): Promise<IngestionResult> {
    const chunks: KnowledgeChunk[] = [];
    const failures = input.failures;
    let filesFailed = 0;
    for (const file of input.files) {
      try {
        const produced = this.processFile(file, input.revision);
        chunks.push(...produced);
      } catch (err) {
        filesFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ path: file.path, stage: errorStage(err), error: message });
        this.deps.log.warn('Failed to process file', {
          path: file.path,
          error: message,
        });
      }
    }
    const deletes = this.contextInjector.injectDeletions(input.deletions, {
      file: '',
      repositoryId: input.repositoryId,
      repository: '',
      service: '',
      revision: input.revision,
    });
    chunks.push(...deletes);

    const stats = computeStats({
      discovered: input.files.length + input.deletions.length + input.ignored,
      ignored: input.ignored,
      processed: input.files.length,
      failed: filesFailed,
      chunks,
    });
    const completedAt = new Date().toISOString();
    return {
      mode: input.mode,
      repository: {
        id: input.repositoryId,
        name: deriveRepoName(input.repositoryId),
      },
      branch: input.branch,
      revision: input.revision,
      previousRevision: input.previousRevision,
      jobId: input.jobId,
      stats,
      failures,
      chunks,
      durationMs: Date.now() - input.start,
      startedAt: new Date(input.start).toISOString(),
      completedAt,
    };
  }

  private processFile(file: ProcessedFile, revision: Revision): KnowledgeChunk[] {
    const { classification, content, path, changeType } = file;
    const ctxBase = {
      file: path,
      repositoryId: this.deps.adapter.repositoryId,
      repository: deriveRepoName(this.deps.adapter.repositoryId),
      service: '',
      revision,
      changeType,
    };
    if (!classification.kind) {
      throw new FileParseError('File has no classification kind', path);
    }
    if (classification.kind === 'CODE') {
      const parser = this.deps.codeParser;
      const parsed = parser.parse(content.toString('utf8'), path);
      const codeChunks = this.deps.codeChunker.chunk(parsed);
      return this.contextInjector.injectCode(codeChunks, {
        ...ctxBase,
        language: classification.language ?? parsed.language,
      });
    }
    if (classification.kind === 'DOCUMENTATION') {
      const parsed = this.deps.markdownParser.parse(content.toString('utf8'), { filePath: path });
      const docChunks = this.deps.documentationChunker.chunk(parsed);
      return this.contextInjector.injectDocumentation(docChunks, {
        ...ctxBase,
        language: classification.language ?? 'markdown',
      });
    }
    if (classification.kind === 'CONFIG') {
      return [
        this.contextInjector.injectConfig(path, content.toString('utf8'), {
          ...ctxBase,
          language: classification.language,
        }),
      ];
    }
    throw new FileParseError(`Unsupported classification kind: ${classification.kind}`, path);
  }

  private buildSkippedResult(input: {
    branch: string;
    revision: Revision;
    previousRevision?: Revision;
    start: number;
  }): IngestionResult {
    return {
      mode: 'skipped',
      repository: {
        id: this.deps.adapter.repositoryId,
        name: deriveRepoName(this.deps.adapter.repositoryId),
      },
      branch: input.branch,
      revision: input.revision,
      previousRevision: input.previousRevision,
      stats: emptyStats(),
      failures: [],
      chunks: [],
      durationMs: Date.now() - input.start,
      startedAt: new Date(input.start).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

function deriveRepoName(repositoryId: string): string {
  const decoded = decodeURIComponent(repositoryId);
  const parts = decoded.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? decoded;
}

function errorStage(err: unknown): FileFailure['stage'] {
  if (err instanceof FileParseError) return 'parse';
  const name = (err as Error | undefined)?.name ?? '';
  if (name.includes('Timeout')) return 'fetch';
  if (err instanceof Error && /parse/i.test(err.message)) return 'parse';
  return 'chunk';
}

function emptyStats(): IngestionResult['stats'] {
  return {
    filesDiscovered: 0,
    filesIgnored: 0,
    filesProcessed: 0,
    filesFailed: 0,
    codeChunks: 0,
    documentationChunks: 0,
    configChunks: 0,
    deleteChunks: 0,
    totalChunks: 0,
  };
}

function computeStats(input: {
  discovered: number;
  ignored: number;
  processed: number;
  failed: number;
  chunks: KnowledgeChunk[];
}): IngestionResult['stats'] {
  let code = 0;
  let doc = 0;
  let cfg = 0;
  let del = 0;
  for (const c of input.chunks) {
    if (c.type === 'code') code += 1;
    else if (c.type === 'documentation') doc += 1;
    else if (c.type === 'config') cfg += 1;
    else if (c.type === 'delete') del += 1;
  }
  return {
    filesDiscovered: input.discovered,
    filesIgnored: input.ignored,
    filesProcessed: input.processed,
    filesFailed: input.failed,
    codeChunks: code,
    documentationChunks: doc,
    configChunks: cfg,
    deleteChunks: del,
    totalChunks: input.chunks.length,
  };
}
