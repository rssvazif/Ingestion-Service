import { createHash } from 'node:crypto';
import type { Revision } from '../repository/types.js';
import type { CodeChunk } from '../chunkers/code-chunker-types.js';
import type { DocumentationChunk } from '../chunkers/documentation-chunker-types.js';

/**
 * Canonical output of the ingestion pipeline. Every KnowledgeChunk is
 * self-describing: the content + metadata together are enough to serve the
 * RAG context without re-fetching from GitLab.
 */
export type KnowledgeChunkType = 'code' | 'documentation' | 'config' | 'delete';

export interface KnowledgeChunkMetadata {
  /** Stable repository identifier (project id / url-encoded path). */
  repositoryId: string;
  /** Short repository name (last path segment). */
  repository: string;
  /** Service name derived from the project path. */
  service: string;
  /** Branch the chunk was produced from. */
  branch: string;
  /** Commit SHA the chunk was produced from. */
  commit: string;
  /** Optional application-defined version label (e.g. tag). */
  version?: string;
  /** Repo-relative POSIX path to the source file. */
  file: string;
  /** Inferred programming or markup language (e.g. "ts", "ts", "md"). */
  language?: string;
  /** Symbolic name (function/class/method name or section title). */
  symbol?: string;
  /** Kind of the symbol (class/method/function/interface/...). */
  symbolType?: string;
  /** Documentation-only: heading hierarchy. */
  section?: string[];
  /** 1-based start line in the source file. */
  startLine?: number;
  /** 1-based end line in the source file. */
  endLine?: number;
  /** Incremental ingestion marker. */
  changeType?: 'added' | 'modified' | 'deleted';
  /** Whether this chunk was emitted by a fallback size-based split. */
  split?: boolean;
}

export interface KnowledgeChunk {
  /** Deterministic id derived from the chunk's identity (see {@link ContextInjector}). */
  id: string;
  type: KnowledgeChunkType;
  /** Raw content that will later be embedded / served as RAG context. */
  content: string;
  metadata: KnowledgeChunkMetadata;
}

export interface CodeInjectionContext {
  file: string;
  language?: string;
  repositoryId: string;
  repository: string;
  service: string;
  revision: Revision;
  changeType?: 'added' | 'modified' | 'deleted';
}

export interface DocumentationInjectionContext {
  file: string;
  language?: string;
  repositoryId: string;
  repository: string;
  service: string;
  revision: Revision;
  changeType?: 'added' | 'modified' | 'deleted';
}

export interface ConfigInjectionContext {
  file: string;
  language?: string;
  repositoryId: string;
  repository: string;
  service: string;
  revision: Revision;
  changeType?: 'added' | 'modified' | 'deleted';
}

export interface DeleteInjectionContext {
  file: string;
  repositoryId: string;
  repository: string;
  service: string;
  revision: Revision;
}

/**
 * Stable id generation. The id is derived from the chunk's identity so that
 * re-ingesting the same content yields the same id and a future vector store
 * can upsert deterministically.
 */
export function buildChunkId(parts: {
  type: KnowledgeChunkType;
  repositoryId: string;
  branch: string;
  commit: string;
  file: string;
  symbol?: string;
  section?: string[];
  startLine?: number;
  endLine?: number;
}): string {
  const symbolPart = parts.symbol ?? '';
  const sectionPart = parts.section ? parts.section.join(' > ') : '';
  const key = [
    parts.type,
    parts.repositoryId,
    parts.branch,
    parts.commit,
    parts.file,
    symbolPart,
    sectionPart,
    parts.startLine ?? '',
    parts.endLine ?? '',
  ].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 32);
}

export function deriveRepositoryName(repositoryId: string): string {
  const decoded = decodeURIComponent(repositoryId);
  const parts = decoded.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? decoded;
}

export function deriveServiceName(repositoryId: string, filePath: string): string {
  const decoded = decodeURIComponent(repositoryId);
  const repoParts = decoded.split('/').filter((p) => p.length > 0);
  const repoLast = repoParts[repoParts.length - 1] ?? decoded;
  const stripped = repoLast.replace(/^partService/i, '').replace(/^part-/, '');
  if (stripped.length > 0) return stripped;
  const fileParts = filePath.split('/').filter((p) => p.length > 0);
  if (fileParts.length > 1) return fileParts[0]!;
  return repoLast;
}
