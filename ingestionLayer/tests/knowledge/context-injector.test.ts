import { describe, it, expect } from 'vitest';
import {
  ContextInjector,
  buildChunkId,
  deriveRepositoryName,
  deriveServiceName,
} from '../../src/knowledge/index.js';
import type { CodeInjectionContext, DocumentationInjectionContext, ConfigInjectionContext, DeleteInjectionContext } from '../../src/knowledge/types.js';
import type { Revision } from '../../src/repository/types.js';
import type { CodeChunk } from '../../src/chunkers/code-chunker-types.js';
import type { DocumentationChunk } from '../../src/chunkers/documentation-chunker-types.js';

const revision: Revision = {
  repositoryId: 'group%2FpartServiceFileStorage',
  branch: 'develop',
  commit: 'abc123def456',
};

const baseCtx: Pick<CodeInjectionContext, 'file' | 'repositoryId' | 'repository' | 'service' | 'revision'> = {
  file: 'src/services/file.service.ts',
  repositoryId: 'group%2FpartServiceFileStorage',
  repository: 'partServiceFileStorage',
  service: 'file-storage',
  revision,
};

describe('deriveRepositoryName / deriveServiceName', () => {
  it('derives the human-friendly repository name from the encoded id', () => {
    expect(deriveRepositoryName('group%2FpartServiceFileStorage')).toBe(
      'partServiceFileStorage'
    );
    expect(deriveRepositoryName('foo')).toBe('foo');
  });

  it('derives the service name by stripping the project prefix', () => {
    expect(deriveServiceName('group%2FpartServiceFileStorage', 'src/a.ts')).toBe(
      'FileStorage'
    );
  });
});

describe('buildChunkId', () => {
  it('is deterministic for identical inputs', () => {
    const id1 = buildChunkId({
      type: 'code',
      repositoryId: 'r',
      branch: 'b',
      commit: 'c',
      file: 'f',
      symbol: 's',
      startLine: 1,
      endLine: 2,
    });
    const id2 = buildChunkId({
      type: 'code',
      repositoryId: 'r',
      branch: 'b',
      commit: 'c',
      file: 'f',
      symbol: 's',
      startLine: 1,
      endLine: 2,
    });
    expect(id1).toBe(id2);
  });

  it('changes when the symbol changes', () => {
    const id1 = buildChunkId({
      type: 'code',
      repositoryId: 'r',
      branch: 'b',
      commit: 'c',
      file: 'f',
      symbol: 'a',
      startLine: 1,
      endLine: 2,
    });
    const id2 = buildChunkId({
      type: 'code',
      repositoryId: 'r',
      branch: 'b',
      commit: 'c',
      file: 'f',
      symbol: 'b',
      startLine: 1,
      endLine: 2,
    });
    expect(id1).not.toBe(id2);
  });
});

describe('ContextInjector - code chunks', () => {
  const injector = new ContextInjector();

  it('converts a code chunk to a KnowledgeChunk with all metadata', () => {
    const code: CodeChunk = {
      symbol: 'FileService.upload',
      symbolType: 'method',
      language: 'ts',
      startLine: 42,
      endLine: 81,
      content: 'async upload(file: File): Promise<UploadResult> { /* ... */ }',
      nodeType: 'method_definition',
      parentSymbol: 'FileService',
    };
    const out = injector.injectCode([code], { ...baseCtx, language: 'ts' });
    expect(out).toHaveLength(1);
    const chunk = out[0]!;
    expect(chunk.type).toBe('code');
    expect(chunk.content).toContain('upload');
    expect(chunk.metadata).toMatchObject({
      repositoryId: 'group%2FpartServiceFileStorage',
      repository: 'partServiceFileStorage',
      service: 'FileStorage',
      branch: 'develop',
      commit: 'abc123def456',
      file: 'src/services/file.service.ts',
      language: 'ts',
      symbol: 'FileService.upload',
      symbolType: 'method',
      startLine: 42,
      endLine: 81,
    });
    expect(chunk.id).toHaveLength(32);
  });

  it('propagates the changeType when provided', () => {
    const code: CodeChunk = {
      symbol: 'A',
      symbolType: 'class',
      language: 'ts',
      startLine: 1,
      endLine: 1,
      content: 'class A {}',
      nodeType: 'class_declaration',
    };
    const [chunk] = injector.injectCode([code], { ...baseCtx, changeType: 'modified' });
    expect(chunk.metadata.changeType).toBe('modified');
  });

  it('produces distinct ids for two different code chunks in the same file', () => {
    const a: CodeChunk = {
      symbol: 'A',
      symbolType: 'class',
      language: 'ts',
      startLine: 1,
      endLine: 5,
      content: 'class A {}',
      nodeType: 'class_declaration',
    };
    const b: CodeChunk = {
      symbol: 'B',
      symbolType: 'class',
      language: 'ts',
      startLine: 10,
      endLine: 20,
      content: 'class B {}',
      nodeType: 'class_declaration',
    };
    const [ca, cb] = injector.injectCode([a, b], baseCtx);
    expect(ca.id).not.toBe(cb.id);
  });
});

describe('ContextInjector - documentation chunks', () => {
  const injector = new ContextInjector();

  it('converts a documentation chunk to a KnowledgeChunk', () => {
    const doc: DocumentationChunk = {
      section: ['Authentication', 'Login'],
      title: 'Login',
      depth: 2,
      startLine: 10,
      endLine: 40,
      content: '# Login flow ...',
      split: false,
    };
    const ctx: DocumentationInjectionContext = {
      file: 'docs/authentication.md',
      repositoryId: 'group%2FpartServiceFileStorage',
      repository: 'partServiceFileStorage',
      service: 'FileStorage',
      revision,
    };
    const [chunk] = injector.injectDocumentation([doc], ctx);
    expect(chunk.type).toBe('documentation');
    expect(chunk.metadata.section).toEqual(['Authentication', 'Login']);
    expect(chunk.metadata.symbol).toBe('Login');
    expect(chunk.metadata.symbolType).toBe('section');
    expect(chunk.metadata.startLine).toBe(10);
    expect(chunk.metadata.endLine).toBe(40);
    expect(chunk.metadata.file).toBe('docs/authentication.md');
    expect(chunk.content).toContain('Login flow');
  });
});

describe('ContextInjector - config files', () => {
  const injector = new ContextInjector();

  it('injects a config file as a single KnowledgeChunk', () => {
    const ctx: ConfigInjectionContext = {
      file: 'package.json',
      repositoryId: 'group%2FpartServiceFileStorage',
      repository: 'partServiceFileStorage',
      service: 'FileStorage',
      revision,
    };
    const chunk = injector.injectConfig('package.json', '{"name":"x"}', ctx);
    expect(chunk.type).toBe('config');
    expect(chunk.content).toBe('{"name":"x"}');
    expect(chunk.metadata.symbol).toBe('package.json');
    expect(chunk.metadata.symbolType).toBe('config');
    expect(chunk.metadata.file).toBe('package.json');
  });
});

describe('ContextInjector - deletions', () => {
  const injector = new ContextInjector();

  it('produces a delete KnowledgeChunk per deleted file', () => {
    const ctxBase: DeleteInjectionContext = {
      file: 'src/removed.ts',
      repositoryId: 'group%2FpartServiceFileStorage',
      repository: 'partServiceFileStorage',
      service: 'FileStorage',
      revision,
    };
    const chunks = injector.injectDeletions(
      [{ path: 'src/removed.ts', changeType: 'deleted', oldPath: 'src/removed.ts' }],
      ctxBase
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe('delete');
    expect(chunks[0]!.metadata.changeType).toBe('deleted');
    expect(chunks[0]!.metadata.file).toBe('src/removed.ts');
  });
});
