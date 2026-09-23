import {
  buildChunkId,
  deriveRepositoryName,
  deriveServiceName,
} from './types.js';

/**
 * Context Injector.
 *
 * Converts raw / chunked layer output (CodeChunk, DocumentationChunk, raw
 * config content, deleted-file markers) into the canonical KnowledgeChunk
 * representation used downstream by the embedding / vector-store layer.
 *
 * The injector is intentionally pure - it takes a {@link Revision} and a
 * piece of metadata and returns KnowledgeChunk[] without touching the file
 * system or the network.
 */
export class ContextInjector {
  /**
   * @param {import('../chunkers/code-chunker-types.js').CodeChunk[]} chunks
   * @param {import('./types.js').CodeInjectionContext} ctx
   * @returns {import('./types.js').KnowledgeChunk[]}
   */
  injectCode(chunks, ctx) {
    const base = this.#baseMetadata(ctx);
    return chunks.map((c) => {
      const meta = {
        ...base,
        language: c.language,
        symbol: c.symbol,
        symbolType: c.symbolType,
        parentSymbol: c.parentSymbol,
        signature: c.signature,
        jsdoc: c.jsdoc,
        startLine: c.startLine,
        endLine: c.endLine,
        ...(ctx.changeType ? { changeType: ctx.changeType } : {}),
      };
      return {
        id: buildChunkId({
          type: 'code',
          repositoryId: ctx.repositoryId,
          branch: ctx.revision.branch,
          commit: ctx.revision.commit,
          file: ctx.file,
          symbol: c.symbol,
          parentSymbol: c.parentSymbol,
          signature: c.signature,
          startLine: c.startLine,
          endLine: c.endLine,
        }),
        type: 'code',
        content: c.content,
        metadata: meta,
      };
    });
  }

  /**
   * @param {import('../chunkers/documentation-chunker-types.js').DocumentationChunk[]} chunks
   * @param {import('./types.js').DocumentationInjectionContext} ctx
   * @returns {import('./types.js').KnowledgeChunk[]}
   */
  injectDocumentation(chunks, ctx) {
    const base = this.#baseMetadata(ctx);
    // First pass: generate an id for every chunk and build a lookup so
    // children can resolve their parent index to the parent's chunk id.
    const ids = chunks.map((c) =>
      buildChunkId({
        type: 'documentation',
        repositoryId: ctx.repositoryId,
        branch: ctx.revision.branch,
        commit: ctx.revision.commit,
        file: ctx.file,
        symbol: c.title,
        sectionPath: c.sectionPath,
        sectionTitle: c.title,
        parentId: c.parentId,
        startLine: c.startLine,
        endLine: c.endLine,
      })
    );
    return chunks.map((c, index) => {
      const parentId =
        c.parentIndex !== undefined ? ids[c.parentIndex] : undefined;
      const meta = {
        ...base,
        language: ctx.language ?? 'markdown',
        symbol: c.title,
        symbolType: c.kind === 'parent' ? 'section_parent' : 'section_child',
        section: c.sectionPath,
        sectionPath: c.sectionPath,
        sectionTitle: c.title,
        parentId,
        startLine: c.startLine,
        endLine: c.endLine,
        split: c.split,
        ...(ctx.changeType ? { changeType: ctx.changeType } : {}),
      };
      return {
        id: ids[index],
        type: 'documentation',
        content: c.content,
        metadata: meta,
      };
    });
  }

  /**
   * @param {string} file
   * @param {string} content
   * @param {import('./types.js').ConfigInjectionContext} ctx
   * @returns {import('./types.js').KnowledgeChunk}
   */
  injectConfig(file, content, ctx) {
    const meta = {
      ...this.#baseMetadata(ctx),
      language: ctx.language ?? extLanguage(file),
      symbol: file.split('/').pop() ?? file,
      symbolType: 'config',
      ...(ctx.changeType ? { changeType: ctx.changeType } : {}),
    };
    return {
      id: buildChunkId({
        type: 'config',
        repositoryId: ctx.repositoryId,
        branch: ctx.revision.branch,
        commit: ctx.revision.commit,
        file,
        symbol: meta.symbol,
      }),
      type: 'config',
      content,
      metadata: meta,
    };
  }

  /**
   * @param {import('../repository/types.js').ChangedFile[]} deleted
   * @param {import('./types.js').DeleteInjectionContext} ctxBase
   * @returns {import('./types.js').KnowledgeChunk[]}
   */
  injectDeletions(deleted, ctxBase) {
    return deleted.map((d) => {
      const meta = {
        ...this.#baseMetadata(ctxBase),
        changeType: 'deleted',
      };
      return {
        id: buildChunkId({
          type: 'delete',
          repositoryId: ctxBase.repositoryId,
          branch: ctxBase.revision.branch,
          commit: ctxBase.revision.commit,
          file: d.path,
          symbol: d.path,
        }),
        type: 'delete',
        content: '',
        metadata: meta,
      };
    });
  }

  /**
   * @param {import('./types.js').CodeInjectionContext | import('./types.js').DocumentationInjectionContext | import('./types.js').ConfigInjectionContext | import('./types.js').DeleteInjectionContext} ctx
   * @returns {import('./types.js').KnowledgeChunkMetadata}
   */
  #baseMetadata(ctx) {
    const repository = deriveRepositoryName(ctx.repositoryId);
    const service = deriveServiceName(ctx.repositoryId, ctx.file);
    const meta = {
      repositoryId: ctx.repositoryId,
      repository,
      service,
      branch: ctx.revision.branch,
      commit: ctx.revision.commit,
      file: ctx.file,
    };
    if (ctx.revision.version) meta.version = ctx.revision.version;
    return meta;
  }
}

/** @param {string} file */
function extLanguage(file) {
  const idx = file.lastIndexOf('.');
  if (idx < 0) return 'text';
  const slash = file.lastIndexOf('/');
  if (slash > idx) return 'text';
  return file.slice(idx + 1).toLowerCase();
}

/** @returns {ContextInjector} */
export function defaultContextInjector() {
  return new ContextInjector();
}