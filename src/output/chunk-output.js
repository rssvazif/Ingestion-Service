import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** @typedef {import('../knowledge/types.js').KnowledgeChunk} KnowledgeChunk */
/** @typedef {import('../logger/index.js').Logger} Logger */

/**
 * @typedef {object} ChunkOutputConfig
 * @property {string} dir
 * @property {string} [file]
 */

/**
 * Resolve the destination path for a job's chunk JSON export, or `null` when
 * chunk output is disabled (`output.dir` not set). Without an explicit file
 * name each job writes to `<dir>/<jobId>.json`; job ids are sanitized so they
 * are always safe to use as file names.
 *
 * @param {Pick<import('../config/index.js').IngestionConfig, 'output'>['output']} [output]
 * @param {string} [jobId]
 * @returns {string | null}
 */
export function resolveChunkOutputPath(output, jobId) {
  if (!output?.dir) return null;
  const base = resolve(output.dir);
  const fileName =
    output.file && output.file.length > 0
      ? output.file
      : `${sanitizeFileName(jobId ?? 'chunks')}.json`;
  return join(base, fileName);
}

/**
 * Persist a `KnowledgeChunk[]` as pretty-printed JSON. The write is atomic
 * (temp file + rename) so a crash mid-write never leaves a truncated or
 * partially-written export behind. Missing directories are created.
 *
 * @param {{ path: string, chunks: KnowledgeChunk[], log?: Logger }} args
 * @returns {string} The resolved absolute path that was written.
 */
export function writeChunksToJson({ path, chunks, log }) {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(chunks, null, 2), 'utf8');
  renameSync(tmp, abs);
  log?.info?.('KnowledgeChunks written to disk', { path: abs, count: chunks.length });
  return abs;
}

/**
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
  const sanitized = String(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'chunks';
}