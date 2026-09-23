import { generateJobId, IngestionStateImpl } from '../state/index.js';
import { defaultContextInjector } from '../knowledge/index.js';
import { FileParseError } from '../errors/index.js';

/** @typedef {('full' | 'incremental' | 'skipped')} IngestionMode */

/**
 * @typedef {object} IngestionOrchestratorDeps
 * @property {import('../repository/adapter.js').RepositoryAdapter} adapter
 * @property {import('../discovery/file-discovery.js').FileDiscovery} discovery
 * @property {import('../state/types.js').IngestionState} state
 * @property {import('../parsers/documentation/markdown-parser.js').MarkdownParser} markdownParser
 * @property {import('../parsers/code/code-parser.js').TreeSitterCodeParser} codeParser
 * @property {import('../chunkers/documentation-chunker.js').DocumentationChunker} documentationChunker
 * @property {import('../chunkers/code-chunker.js').CodeChunker} codeChunker
 * @property {import('../knowledge/context-injector.js').ContextInjector} [contextInjector]
 * @property {import('../logger/index.js').Logger} log
 */

/**
 * @typedef {object} IngestionRunOptions
 * @property {string} [branch]         Override the configured branch.
 * @property {boolean} [forceFull]     Force a full ingestion even when state exists.
 * @property {string} [repositoryId]   Override the configured repository id.
 */

/**
 * @typedef {('fetch' | 'parse' | 'chunk' | 'inject')} FileFailureStage
 */

/**
 * @typedef {object} FileFailure
 * @property {string} path
 * @property {FileFailureStage} stage
 * @property {string} error
 */

/**
 * @typedef {object} IngestionStats
 * @property {number} filesDiscovered
 * @property {number} filesIgnored
 * @property {number} filesProcessed
 * @property {number} filesFailed
 * @property {number} codeChunks
 * @property {number} documentationChunks
 * @property {number} configChunks
 * @property {number} deleteChunks
 * @property {number} totalChunks
 */

/**
 * @typedef {object} IngestionResult
 * @property {IngestionMode} mode
 * @property {{ id: string, name: string, webUrl?: string }} repository
 * @property {string} branch
 * @property {import('../repository/types.js').Revision} [revision]
 * @property {import('../repository/types.js').Revision} [previousRevision]
 * @property {string} [jobId]
 * @property {IngestionStats} stats
 * @property {FileFailure[]} failures
 * @property {import('../knowledge/types.js').KnowledgeChunk[]} chunks
 * @property {number} durationMs
 * @property {string} startedAt
 * @property {string} completedAt
 */

/**
 * @typedef {object} ProcessedFile
 * @property {string} path
 * @property {string} name
 * @property {number} size
 * @property {string} commit
 * @property {string} [hash]
 * @property {import('../discovery/types.js').ClassificationDecision} classification
 * @property {Buffer} content
 * @property {('added' | 'modified' | 'deleted')} changeType
 */

export class IngestionOrchestrator {
  /** @type {IngestionOrchestratorDeps} */
  #deps;
  /** @type {import('../knowledge/context-injector.js').ContextInjector} */
  #contextInjector;

  /** @param {IngestionOrchestratorDeps} deps */
  constructor(deps) {
    this.#deps = deps;
    this.#contextInjector = deps.contextInjector ?? defaultContextInjector();
  }

  /**
   * @param {IngestionRunOptions} [options]
   * @returns {Promise<IngestionResult>}
   */
  async run(options = {}) {
    const start = Date.now();
    try {
      const branch = options.branch ?? (await this.#deps.adapter.getDefaultBranch());
      const repositoryId = options.repositoryId ?? this.#deps.adapter.repositoryId;

      const revision = await this.#deps.adapter.getCurrentRevision(branch);
      const previousRevision =
        this.#deps.state.getLatestRevision(repositoryId, branch) ?? undefined;
      const forceFull = options.forceFull === true;

      if (!previousRevision) {
        return this.#runFullInternal({
          branch,
          repositoryId,
          revision,
          previousRevision,
          start,
        });
      }

      if (previousRevision.commit === revision.commit) {
        if (!forceFull) {
          this.#deps.log.info('No revision change detected; nothing to do', {
            branch,
            commit: revision.commit,
          });
          return this.#buildSkippedResult({
            branch,
            revision,
            previousRevision,
            start,
          });
        }
        return this.#runFullInternal({
          branch,
          repositoryId,
          revision,
          previousRevision,
          start,
        });
      }

      return this.#runIncrementalInternal({
        branch,
        repositoryId,
        from: previousRevision,
        to: revision,
        start,
      });
    } catch (err) {
      this.#deps.log.error('Ingestion failed', { error: err.message });
      throw err;
    }
  }

  /**
   * @param {IngestionRunOptions} [options]
   * @returns {Promise<IngestionResult>}
   */
  async runFull(options = {}) {
    const start = Date.now();
    const branch = options.branch ?? (await this.#deps.adapter.getDefaultBranch());
    const repositoryId = options.repositoryId ?? this.#deps.adapter.repositoryId;
    const revision = await this.#deps.adapter.getCurrentRevision(branch);
    const previousRevision =
      this.#deps.state.getLatestRevision(repositoryId, branch) ?? undefined;
    return this.#runFullInternal({
      branch,
      repositoryId,
      revision,
      previousRevision,
      start,
    });
  }

  /**
   * @param {IngestionRunOptions} [options]
   * @returns {Promise<IngestionResult>}
   */
  async runIncremental(options = {}) {
    const start = Date.now();
    const branch = options.branch ?? (await this.#deps.adapter.getDefaultBranch());
    const repositoryId = options.repositoryId ?? this.#deps.adapter.repositoryId;
    const to = await this.#deps.adapter.getCurrentRevision(branch);
    const from =
      this.#deps.state.getLatestRevision(repositoryId, branch) ??
      (() => {
        throw new Error(
          'No previous ingestion state available; cannot run incrementally'
        );
      })();
    return this.#runIncrementalInternal({ branch, repositoryId, from, to, start });
  }

  // -- Internals --------------------------------------------------------

  /**
   * @param {{ branch: string, repositoryId: string, revision: import('../repository/types.js').Revision, previousRevision?: import('../repository/types.js').Revision, start: number }} input
   * @returns {Promise<IngestionResult>}
   */
  async #runFullInternal(input) {
    const { branch, repositoryId, revision } = input;
    const jobId = generateJobId({ repositoryId, branch, mode: 'full' });
    this.#deps.state.beginJob({ jobId, repositoryId, branch, mode: 'full' });
    this.#deps.log.info('Starting full ingestion', {
      branch,
      commit: revision.commit,
      jobId,
    });
    const discovery = await this.#deps.discovery.discoverFull(revision);
    const processed = [];
    const failures = [];
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
    const result = await this.#processFiles({
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
    this.#deps.state.completeJob(jobId, revision);
    return result;
  }

  /**
   * @param {{ branch: string, repositoryId: string, from: import('../repository/types.js').Revision, to: import('../repository/types.js').Revision, start: number }} input
   * @returns {Promise<IngestionResult>}
   */
  async #runIncrementalInternal(input) {
    const { branch, repositoryId, from, to } = input;
    const jobId = generateJobId({ repositoryId, branch, mode: 'incremental' });
    this.#deps.state.beginJob({ jobId, repositoryId, branch, mode: 'incremental' });
    this.#deps.log.info('Starting incremental ingestion', {
      branch,
      from: from.commit,
      to: to.commit,
      jobId,
    });
    const discovery = await this.#deps.discovery.discoverIncremental(from, to);
    const processed = [];
    const failures = [];
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
    const result = await this.#processFiles({
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
    this.#deps.state.completeJob(jobId, to);
    return result;
  }

  /**
   * @param {{ branch: string, repositoryId: string, revision: import('../repository/types.js').Revision, files: ProcessedFile[], deletions: import('../repository/types.js').ChangedFile[], ignored: number, failures: FileFailure[], start: number, mode: 'full' | 'incremental', jobId: string, previousRevision?: import('../repository/types.js').Revision }} input
   * @returns {Promise<IngestionResult>}
   */
  async #processFiles(input) {
    const chunks = [];
    const failures = input.failures;
    let filesFailed = 0;
    for (const file of input.files) {
      try {
        const produced = this.#processFile(file, input.revision);
        chunks.push(...produced);
      } catch (err) {
        filesFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ path: file.path, stage: errorStage(err), error: message });
        this.#deps.log.warn('Failed to process file', {
          path: file.path,
          error: message,
        });
      }
    }
    const deletes = this.#contextInjector.injectDeletions(input.deletions, {
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

  /**
   * @param {ProcessedFile} file
   * @param {import('../repository/types.js').Revision} revision
   * @returns {import('../knowledge/types.js').KnowledgeChunk[]}
   */
  #processFile(file, revision) {
    const { classification, content, path, changeType } = file;
    const ctxBase = {
      file: path,
      repositoryId: this.#deps.adapter.repositoryId,
      repository: deriveRepoName(this.#deps.adapter.repositoryId),
      service: '',
      revision,
      changeType,
    };
    if (!classification.kind) {
      throw new FileParseError('File has no classification kind', path);
    }
    if (classification.kind === 'CODE') {
      const parser = this.#deps.codeParser;
      const parsed = parser.parse(content.toString('utf8'), path);
      const codeChunks = this.#deps.codeChunker.chunk(parsed);
      return this.#contextInjector.injectCode(codeChunks, {
        ...ctxBase,
        language: classification.language ?? parsed.language,
      });
    }
    if (classification.kind === 'DOCUMENTATION') {
      const parsed = this.#deps.markdownParser.parse(content.toString('utf8'), { filePath: path });
      const docChunks = this.#deps.documentationChunker.chunk(parsed);
      return this.#contextInjector.injectDocumentation(docChunks, {
        ...ctxBase,
        language: classification.language ?? 'markdown',
      });
    }
    if (classification.kind === 'CONFIG') {
      return [
        this.#contextInjector.injectConfig(path, content.toString('utf8'), {
          ...ctxBase,
          language: classification.language,
        }),
      ];
    }
    throw new FileParseError(`Unsupported classification kind: ${classification.kind}`, path);
  }

  /**
   * @param {{ branch: string, revision: import('../repository/types.js').Revision, previousRevision?: import('../repository/types.js').Revision, start: number }} input
   * @returns {IngestionResult}
   */
  #buildSkippedResult(input) {
    return {
      mode: 'skipped',
      repository: {
        id: this.#deps.adapter.repositoryId,
        name: deriveRepoName(this.#deps.adapter.repositoryId),
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

/** @param {string} repositoryId */
function deriveRepoName(repositoryId) {
  const decoded = decodeURIComponent(repositoryId);
  const parts = decoded.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? decoded;
}

/**
 * @param {unknown} err
 * @returns {FileFailureStage}
 */
function errorStage(err) {
  if (err instanceof FileParseError) return 'parse';
  const name = err?.name ?? '';
  if (name.includes('Timeout')) return 'fetch';
  if (err instanceof Error && /parse/i.test(err.message)) return 'parse';
  return 'chunk';
}

/** @returns {IngestionStats} */
function emptyStats() {
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

/**
 * @param {{ discovered: number, ignored: number, processed: number, failed: number, chunks: import('../knowledge/types.js').KnowledgeChunk[] }} input
 * @returns {IngestionStats}
 */
function computeStats(input) {
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