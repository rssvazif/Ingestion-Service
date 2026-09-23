import { GitLabRepositoryAdapter } from '../repository/gitlab-adapter.js';
import { FileClassifier } from '../discovery/file-classifier.js';
import { FileDiscovery } from '../discovery/file-discovery.js';
import { MarkdownParser } from '../parsers/documentation/markdown-parser.js';
import { TreeSitterCodeParser } from '../parsers/code/code-parser.js';
import { CodeChunker } from '../chunkers/code-chunker.js';
import { DocumentationChunker } from '../chunkers/documentation-chunker.js';
import { ContextInjector } from '../knowledge/index.js';
import { FileIngestionStateStore, IngestionStateImpl } from '../state/index.js';

import { IngestionOrchestrator } from './ingestion-orchestrator.js';

/**
 * Build a factory that constructs a fully-wired {@link IngestionOrchestrator}
 * for a given GitLab configuration. Shared by the CLI and the BullMQ worker so
 * the pipeline wiring only exists in one place.
 *
 * @param {{
 *   config: import('../config/index.js').IngestionConfig,
 *   log: import('../logger/index.js').Logger,
 * }} deps
 * @returns {(gitlab: import('../config/index.js').GitLabConfig) => IngestionOrchestrator}
 */
export function createOrchestratorFactory({ config, log }) {
  return (gitlab) => {
    const adapter = new GitLabRepositoryAdapter(gitlab, log);
    const classifier = new FileClassifier({ maxFileSizeBytes: config.maxFileSizeBytes });
    const discovery = new FileDiscovery(adapter, log, { classifier });
    const state = new IngestionStateImpl(new FileIngestionStateStore(config.stateFile));
    const injector = new ContextInjector();
    return new IngestionOrchestrator({
      adapter,
      discovery,
      state,
      markdownParser: new MarkdownParser(),
      codeParser: new TreeSitterCodeParser(),
      documentationChunker: new DocumentationChunker(),
      codeChunker: new CodeChunker(),
      contextInjector: injector,
      log,
    });
  };
}

export * from './ingestion-orchestrator.js';