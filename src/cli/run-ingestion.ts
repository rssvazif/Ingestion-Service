import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../logger/index.js';
import { GitLabRepositoryAdapter } from '../repository/gitlab-adapter.js';
import { FileClassifier } from '../discovery/file-classifier.js';
import { FileDiscovery } from '../discovery/file-discovery.js';
import { MarkdownParser } from '../parsers/documentation/markdown-parser.js';
import { TreeSitterCodeParser } from '../parsers/code/code-parser.js';
import { CodeChunker } from '../chunkers/code-chunker.js';
import { DocumentationChunker } from '../chunkers/documentation-chunker.js';
import { ContextInjector } from '../knowledge/index.js';
import { FileIngestionStateStore, IngestionStateImpl } from '../state/index.js';
import { IngestionOrchestrator } from '../orchestrator/ingestion-orchestrator.js';

export interface CliArgs {
  incremental?: boolean;
  forceFull?: boolean;
  branch?: string;
  output?: string;
  preview?: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (const raw of argv.slice(2)) {
    if (raw === '--incremental') args.incremental = true;
    else if (raw === '--full' || raw === '--force-full') args.forceFull = true;
    else if (raw.startsWith('--branch=')) args.branch = raw.slice('--branch='.length);
    else if (raw.startsWith('--output=')) args.output = raw.slice('--output='.length);
    else if (raw.startsWith('--preview=')) {
      const n = Number(raw.slice('--preview='.length));
      if (Number.isFinite(n) && n >= 0) args.preview = n;
    }
    else if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      'RAG Ingestion Layer CLI',
      '',
      'Usage:',
      '  npm run ingestion [-- --incremental] [-- --full] [-- --branch=<name>] [-- --output=<file>] [-- --preview=<n>]',
      '',
      'Options:',
      '  --incremental          Run incremental ingestion only (require prior state).',
      '  --full / --force-full  Force a full ingestion even when state exists.',
      '  --branch=<name>        Override the configured branch.',
      '  --output=<file>        Write the KnowledgeChunk[] as JSON to <file>.',
      '  --preview=<n>          Print the first <n> chunks to stdout (truncated).',
      '  --help, -h             Print this help text.',
      '',
    ].join('\n')
  );
}

export async function runCli(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv);
  const config = loadConfig();
  const log = getLogger(config.logLevel);
  log.info('RAG ingestion started', {
    host: config.gitlab.host,
    branch: config.gitlab.branch,
    incremental: args.incremental === true,
    forceFull: args.forceFull === true,
  });

  const adapter = new GitLabRepositoryAdapter(config.gitlab, log);
  const classifier = new FileClassifier({ maxFileSizeBytes: config.maxFileSizeBytes });
  const discovery = new FileDiscovery(adapter, log, { classifier });
  const state = new IngestionStateImpl(new FileIngestionStateStore(config.stateFile));
  const injector = new ContextInjector();

  const orchestrator = new IngestionOrchestrator({
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

  let result;
  try {
    if (args.incremental) {
      result = await orchestrator.runIncremental({
        branch: args.branch,
        forceFull: args.forceFull,
      });
    } else {
      result = await orchestrator.run({
        branch: args.branch,
        forceFull: args.forceFull,
      });
    }
  } catch (err) {
    log.error('Ingestion failed', {
      error: (err as Error).message,
      code: (err as { code?: string }).code,
    });
    return 1;
  }

  printResult(result);

  if (args.preview !== undefined && result.chunks.length > 0) {
    printPreview(result.chunks, args.preview);
  }

  if (args.output) {
    const outPath = resolve(args.output);
    writeFileSync(outPath, JSON.stringify(result.chunks, null, 2), 'utf8');
    log.info('KnowledgeChunks written to disk', {
      path: outPath,
      count: result.chunks.length,
    });
    process.stdout.write(`\nWrote ${result.chunks.length} chunk(s) to ${outPath}\n`);
  }

  if (result.mode === 'skipped') return 0;
  return result.stats.filesFailed > 0 ? 2 : 0;
}

function printPreview(
  chunks: import('../knowledge/types.js').KnowledgeChunk[],
  limit: number
): void {
  const shown = chunks.slice(0, limit);
  const lines: string[] = ['', `Preview (first ${shown.length} of ${chunks.length}):`];
  for (const c of shown) {
    const m = c.metadata;
    const header = `[${c.type}] ${m.symbol ?? '<no-symbol>'} @ ${m.file}:${m.startLine ?? '?'}-${m.endLine ?? '?'}`;
    lines.push('');
    lines.push(header);
    const snippet = c.content.length > 240 ? `${c.content.slice(0, 240)}…` : c.content;
    for (const ln of snippet.split('\n').slice(0, 12)) {
      lines.push(`    ${ln}`);
    }
    if (c.content.length > 240 || c.content.split('\n').length > 12) {
      lines.push('    …');
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function printResult(result: import('../orchestrator/ingestion-orchestrator.js').IngestionResult): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('Repository:');
  lines.push(`  ${result.repository.name} (${result.repository.id})`);
  lines.push('Branch:');
  lines.push(`  ${result.branch}`);
  if (result.revision) {
    lines.push('Revision:');
    lines.push(`  ${result.revision.commit}`);
  }
  if (result.previousRevision) {
    lines.push('Previous revision:');
    lines.push(`  ${result.previousRevision.commit}`);
  }
  lines.push('Mode:');
  lines.push(`  ${result.mode}`);
  lines.push('');
  lines.push('Stats:');
  lines.push(`  Files discovered:   ${result.stats.filesDiscovered}`);
  lines.push(`  Files ignored:      ${result.stats.filesIgnored}`);
  lines.push(`  Files processed:    ${result.stats.filesProcessed}`);
  lines.push(`  Files failed:       ${result.stats.filesFailed}`);
  lines.push(`  Code chunks:        ${result.stats.codeChunks}`);
  lines.push(`  Documentation:      ${result.stats.documentationChunks}`);
  lines.push(`  Config chunks:      ${result.stats.configChunks}`);
  lines.push(`  Delete chunks:      ${result.stats.deleteChunks}`);
  lines.push(`  Total chunks:       ${result.stats.totalChunks}`);
  lines.push(`  Duration:           ${result.durationMs} ms`);
  if (result.failures.length > 0) {
    lines.push('');
    lines.push('Failures:');
    for (const f of result.failures) {
      lines.push(`  - [${f.stage}] ${f.path}: ${f.error}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Fatal: ${(err as Error).message}\n`);
      process.exit(1);
    }
  );
}
