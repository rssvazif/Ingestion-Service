import type { RepositoryAdapter } from '../repository/adapter.js';
import type { ArchiveEntry, Revision } from '../repository/types.js';
import type { ClassificationResult } from './types.js';
import { FileClassifier } from './file-classifier.js';
import type { Logger } from '../logger/index.js';

/**
 * FileDiscovery turns an adapter into a normalized stream of files that the
 * orchestrator can process. For full ingestion it relies on archive download
 * (a single GitLab request), for incremental ingestion it uses compare.
 */
export interface FileDiscoveryOptions {
  classifierOptions?: ConstructorParameters<typeof FileClassifier>[0];
  classifier?: FileClassifier;
}

export class FileDiscovery {
  private readonly classifier: FileClassifier;
  private readonly log: Logger;

  constructor(
    private readonly adapter: RepositoryAdapter,
    log: Logger,
    options: FileDiscoveryOptions = {}
  ) {
    this.log = log.child({ layer: 'FileDiscovery' });
    this.classifier = options.classifier ?? new FileClassifier(options.classifierOptions);
  }

  /** Run full ingestion discovery: download archive, classify each file. */
  async discoverFull(revision: Revision): Promise<FullDiscoveryResult> {
    this.log.info('Discovering files from archive', {
      commit: revision.commit,
      branch: revision.branch,
    });
    const entries = await this.adapter.downloadArchive(revision);
    const files = entries.map((e): {
      path: string;
      name: string;
      type: 'file' | 'directory';
      size: number;
      commit: string;
      hash?: string;
      language?: string;
    } => ({
      path: e.path,
      name: e.path.split('/').pop() ?? e.path,
      type: 'file',
      size: e.size,
      commit: revision.commit,
    }));
    const classification = this.classifier.classifyAll(files as any);
    this.log.debug('Full discovery classification complete', {
      processed: classification.processed.length,
      ignored: classification.ignored.length,
    });
    return { entries, classification, files: files as any };
  }

  /** Run incremental discovery: list changed files and fetch their contents. */
  async discoverIncremental(
    from: Revision,
    to: Revision
  ): Promise<IncrementalDiscoveryResult> {
    this.log.info('Discovering changed files', { from: from.commit, to: to.commit });
    const changes = await this.adapter.getChangedFiles(from, to);
    const addedOrModified: typeof changes = [];
    const deleted: typeof changes = [];
    for (const c of changes) {
      if (c.changeType === 'deleted') deleted.push(c);
      else addedOrModified.push(c);
    }

    const entries: ArchiveEntry[] = [];
    const files: Array<{
      path: string;
      name: string;
      type: 'file' | 'directory';
      size: number;
      commit: string;
      hash?: string;
      language?: string;
    }> = [];
    for (const change of addedOrModified) {
      try {
        const content = await this.adapter.getFile({
          path: change.path,
          commit: to.commit,
          hash: change.newHash,
        });
        entries.push({ path: change.path, content, size: content.length });
        files.push({
          path: change.path,
          name: change.path.split('/').pop() ?? change.path,
          type: 'file',
          size: content.length,
          commit: to.commit,
          hash: change.newHash,
        });
      } catch (err) {
        this.log.warn('Failed to fetch changed file content', {
          path: change.path,
          error: (err as Error).message,
        });
      }
    }

    const classification = this.classifier.classifyAll(files as any);
    this.log.debug('Incremental discovery classification complete', {
      processed: classification.processed.length,
      ignored: classification.ignored.length,
      deleted: deleted.length,
    });
    return { changes, entries, classification, files: files as any, deleted };
  }
}

export interface FullDiscoveryResult {
  entries: ArchiveEntry[];
  classification: ClassificationResult;
  files: import('../repository/types.js').RepositoryFile[];
}

export interface IncrementalDiscoveryResult {
  changes: import('../repository/types.js').ChangedFile[];
  entries: ArchiveEntry[];
  classification: ClassificationResult;
  files: import('../repository/types.js').RepositoryFile[];
  deleted: import('../repository/types.js').ChangedFile[];
}
