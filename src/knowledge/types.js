import { createHash } from 'node:crypto';

/**
 * Canonical output of the ingestion pipeline. Every KnowledgeChunk is
 * self-describing: the content + metadata together are enough to serve the
 * RAG context without re-fetching from GitLab.
 *
 * @typedef {('code' | 'documentation' | 'config' | 'delete')} KnowledgeChunkType
 */

/**
 * @typedef {object} KnowledgeChunkMetadata
 * @property {string} repositoryId            Stable repository identifier (project id / url-encoded path).
 * @property {string} repository              Short repository name (last path segment).
 * @property {string} service                 Service name derived from the project path.
 * @property {string} branch                  Branch the chunk was produced from.
 * @property {string} commit                  Commit SHA the chunk was produced from.
 * @property {string} [version]               Optional application-defined version label (e.g. tag).
 * @property {string} file                    Repo-relative POSIX path to the source file.
 * @property {string} [language]              Inferred programming or markup language (e.g. "ts", "md").
 * @property {string} [symbol]                Symbolic name (function/class/method name or section title).
 * @property {string} [symbolType]            Kind of the symbol (class/method/function/interface/...).
 * @property {string} [parentSymbol]          Parent symbol for nested members (e.g. method on a class).
 * @property {string} [signature]             Deterministic signature for the symbol, when extractable.
 * @property {string} [jsdoc]                 JSDoc comment directly attached to this symbol.
 * @property {string[]} [section]             Documentation-only: heading hierarchy (legacy field kept for compat).
 * @property {string[]} [sectionPath]         Documentation-only: heading hierarchy (explicit, replaces `section`).
 * @property {string} [sectionTitle]          Documentation-only: most specific heading title.
 * @property {string} [parentId]              Documentation-only: parent chunk id (used for parent-child retrieval).
 * @property {number} [startLine]             1-based start line in the source file.
 * @property {number} [endLine]               1-based end line in the source file.
 * @property {('added' | 'modified' | 'deleted')} [changeType] Incremental ingestion marker.
 * @property {boolean} [split]                Whether this chunk was emitted by a fallback size-based split.
 */

/**
 * @typedef {object} KnowledgeChunk
 * @property {string} id           Deterministic id derived from the chunk's identity (see {@link ContextInjector}).
 * @property {KnowledgeChunkType} type
 * @property {string} content      Raw content that will later be embedded / served as RAG context.
 * @property {KnowledgeChunkMetadata} metadata
 */

/**
 * @typedef {object} CodeInjectionContext
 * @property {string} file
 * @property {string} [language]
 * @property {string} repositoryId
 * @property {string} repository
 * @property {string} service
 * @property {import('../repository/types.js').Revision} revision
 * @property {('added' | 'modified' | 'deleted')} [changeType]
 */

/**
 * @typedef {object} DocumentationInjectionContext
 * @property {string} file
 * @property {string} [language]
 * @property {string} repositoryId
 * @property {string} repository
 * @property {string} service
 * @property {import('../repository/types.js').Revision} revision
 * @property {('added' | 'modified' | 'deleted')} [changeType]
 */

/**
 * @typedef {object} ConfigInjectionContext
 * @property {string} file
 * @property {string} [language]
 * @property {string} repositoryId
 * @property {string} repository
 * @property {string} service
 * @property {import('../repository/types.js').Revision} revision
 * @property {('added' | 'modified' | 'deleted')} [changeType]
 */

/**
 * @typedef {object} DeleteInjectionContext
 * @property {string} file
 * @property {string} repositoryId
 * @property {string} repository
 * @property {string} service
 * @property {import('../repository/types.js').Revision} revision
 */

/**
 * @typedef {object} ChunkIdParts
 * @property {KnowledgeChunkType} type
 * @property {string} repositoryId
 * @property {string} branch
 * @property {string} commit
 * @property {string} file
 * @property {string} [symbol]
 * @property {string[]} [section]
 * @property {string[]} [sectionPath]
 * @property {string} [sectionTitle]
 * @property {string} [parentSymbol]
 * @property {string} [parentId]
 * @property {string} [signature]
 * @property {number} [startLine]
 * @property {number} [endLine]
 */

/**
 * Stable id generation. The id is derived from the chunk's identity so that
 * re-ingesting the same content yields the same id and a future vector store
 * can upsert deterministically.
 *
 * @param {ChunkIdParts} parts
 * @returns {string}
 */
export function buildChunkId(parts) {
  const symbolPart = parts.symbol ?? '';
  const sectionPart = parts.section ? parts.section.join(' > ') : '';
  const sectionPathPart = parts.sectionPath ? parts.sectionPath.join(' > ') : '';
  const parentSymbolPart = parts.parentSymbol ?? '';
  const parentIdPart = parts.parentId ?? '';
  const signaturePart = parts.signature ?? '';
  const sectionTitlePart = parts.sectionTitle ?? '';
  const key = [
    parts.type,
    parts.repositoryId,
    parts.branch,
    parts.commit,
    parts.file,
    symbolPart,
    sectionPart,
    sectionPathPart,
    sectionTitlePart,
    parentSymbolPart,
    parentIdPart,
    signaturePart,
    parts.startLine ?? '',
    parts.endLine ?? '',
  ].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 32);
}

/**
 * @param {string} repositoryId
 * @returns {string}
 */
export function deriveRepositoryName(repositoryId) {
  const decoded = decodeURIComponent(repositoryId);
  const parts = decoded.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? decoded;
}

/**
 * @param {string} repositoryId
 * @param {string} filePath
 * @returns {string}
 */
export function deriveServiceName(repositoryId, filePath) {
  const decoded = decodeURIComponent(repositoryId);
  const repoParts = decoded.split('/').filter((p) => p.length > 0);
  const repoLast = repoParts[repoParts.length - 1] ?? decoded;
  const stripped = repoLast.replace(/^partService/i, '').replace(/^part-/, '');
  if (stripped.length > 0) return stripped;
  const fileParts = filePath.split('/').filter((p) => p.length > 0);
  if (fileParts.length > 1) return fileParts[0];
  return repoLast;
}