import type { ChangedFile, Revision } from '../repository/types.js';
import type { CodeChunk } from '../chunkers/code-chunker-types.js';
import type { DocumentationChunk } from '../chunkers/documentation-chunker-types.js';
import type {
  CodeInjectionContext,
  ConfigInjectionContext,
  DeleteInjectionContext,
  DocumentationInjectionContext,
  KnowledgeChunk,
  KnowledgeChunkMetadata,
} from './types.js';
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
  injectCode(chunks: CodeChunk[], ctx: CodeInjectionContext): KnowledgeChunk[] {
    const base = this.baseMetadata(ctx);
    return chunks.map((c): KnowledgeChunk => {
      const meta: KnowledgeChunkMetadata = {
        ...base,
        language: c.language,
        symbol: c.symbol,
        symbolType: c.symbolType,
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
          startLine: c.startLine,
          endLine: c.endLine,
        }),
        type: 'code',
        content: c.content,
        metadata: meta,
      };
    });
  }

  injectDocumentation(
    chunks: DocumentationChunk[],
    ctx: DocumentationInjectionContext
  ): KnowledgeChunk[] {
    const base = this.baseMetadata(ctx);
    return chunks.map((c): KnowledgeChunk => {
      const meta: KnowledgeChunkMetadata = {
        ...base,
        language: ctx.language ?? 'markdown',
        symbol: c.title,
        symbolType: 'section',
        section: c.section,
        startLine: c.startLine,
        endLine: c.endLine,
        split: c.split,
        ...(ctx.changeType ? { changeType: ctx.changeType } : {}),
      };
      return {
        id: buildChunkId({
          type: 'documentation',
          repositoryId: ctx.repositoryId,
          branch: ctx.revision.branch,
          commit: ctx.revision.commit,
          file: ctx.file,
          symbol: c.title,
          section: c.section,
          startLine: c.startLine,
          endLine: c.endLine,
        }),
        type: 'documentation',
        content: c.content,
        metadata: meta,
      };
    });
  }

  injectConfig(file: string, content: string, ctx: ConfigInjectionContext): KnowledgeChunk {
    const meta: KnowledgeChunkMetadata = {
      ...this.baseMetadata(ctx),
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

  injectDeletions(
    deleted: ChangedFile[],
    ctxBase: DeleteInjectionContext
  ): KnowledgeChunk[] {
    return deleted.map((d): KnowledgeChunk => {
      const meta: KnowledgeChunkMetadata = {
        ...this.baseMetadata(ctxBase),
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

  private baseMetadata(
    ctx:
      | CodeInjectionContext
      | DocumentationInjectionContext
      | ConfigInjectionContext
      | DeleteInjectionContext
  ): KnowledgeChunkMetadata {
    const repository = deriveRepositoryName(ctx.repositoryId);
    const service = deriveServiceName(ctx.repositoryId, ctx.file);
    const meta: KnowledgeChunkMetadata = {
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

function extLanguage(file: string): string {
  const idx = file.lastIndexOf('.');
  if (idx < 0) return 'text';
  const slash = file.lastIndexOf('/');
  if (slash > idx) return 'text';
  return file.slice(idx + 1).toLowerCase();
}

export function defaultContextInjector(): ContextInjector {
  return new ContextInjector();
}
