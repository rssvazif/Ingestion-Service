import { FileClassifier } from './file-classifier.js';

/**
 * FileDiscovery turns an adapter into a normalized stream of files that the
 * orchestrator can process. For full ingestion it relies on archive download
 * (a single GitLab request), for incremental ingestion it uses compare.
 *
 * @typedef {object} FileDiscoveryOptions
 * @property {ConstructorParameters<typeof FileClassifier>[0]} [classifierOptions]
 * @property {FileClassifier} [classifier]
 */

/**
 * @typedef {object} RepositoryFileInput
 * @property {string} path
 * @property {string} name
 * @property {('file' | 'directory')} type
 * @property {number} size
 * @property {string} commit
 * @property {string} [hash]
 * @property {string} [language]
 */

/**
 * @typedef {object} FullDiscoveryResult
 * @property {import('../repository/types.js').ArchiveEntry[]} entries
 * @property {import('./types.js').ClassificationResult} classification
 * @property {import('../repository/types.js').RepositoryFile[]} files
 */

/**
 * @typedef {object} IncrementalDiscoveryResult
 * @property {import('../repository/types.js').ChangedFile[]} changes
 * @property {import('../repository/types.js').ArchiveEntry[]} entries
 * @property {import('./types.js').ClassificationResult} classification
 * @property {import('../repository/types.js').RepositoryFile[]} files
 * @property {import('../repository/types.js').ChangedFile[]} deleted
 */

export class FileDiscovery {
  /** @type {import('../repository/adapter.js').RepositoryAdapter} */
  #adapter;
  /** @type {FileClassifier} */
  #classifier;
  /** @type {import('../logger/index.js').Logger} */
  #log;

  /**
   * @param {import('../repository/adapter.js').RepositoryAdapter} adapter
   * @param {import('../logger/index.js').Logger} log
   * @param {FileDiscoveryOptions} [options]
   */
  constructor(adapter, log, options = {}) {
    this.#adapter = adapter;
    this.#log = log.child({ layer: 'FileDiscovery' });
    this.#classifier = options.classifier ?? new FileClassifier(options.classifierOptions);
  }

  /**
   * Run full ingestion discovery: download archive, classify each file.
   * @param {import('../repository/types.js').Revision} revision
   * @returns {Promise<FullDiscoveryResult>}
   */
  async discoverFull(revision) {
    this.#log.info('Discovering files from archive', {
      commit: revision.commit,
      branch: revision.branch,
    });
    const entries = await this.#adapter.downloadArchive(revision);
    const files = entries.map((e) => ({
      path: e.path,
      name: e.path.split('/').pop() ?? e.path,
      type: 'file',
      size: e.size,
      commit: revision.commit,
    }));
    const classification = this.#classifier.classifyAll(files);
    this.#log.debug('Full discovery classification complete', {
      processed: classification.processed.length,
      ignored: classification.ignored.length,
    });
    return { entries, classification, files };
  }

  /**
   * Run incremental discovery: list changed files and fetch their contents.
   * @param {import('../repository/types.js').Revision} from
   * @param {import('../repository/types.js').Revision} to
   * @returns {Promise<IncrementalDiscoveryResult>}
   */
  async discoverIncremental(from, to) {
    this.#log.info('Discovering changed files', { from: from.commit, to: to.commit });
    const changes = await this.#adapter.getChangedFiles(from, to);
    const addedOrModified = [];
    const deleted = [];
    for (const c of changes) {
      if (c.changeType === 'deleted') deleted.push(c);
      else addedOrModified.push(c);
    }

    const entries = [];
    const files = [];
    for (const change of addedOrModified) {
      try {
        const content = await this.#adapter.getFile({
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
        this.#log.warn('Failed to fetch changed file content', {
          path: change.path,
          error: err.message,
        });
      }
    }

    const classification = this.#classifier.classifyAll(files);
    this.#log.debug('Incremental discovery classification complete', {
      processed: classification.processed.length,
      ignored: classification.ignored.length,
      deleted: deleted.length,
    });
    return { changes, entries, classification, files, deleted };
  }
}