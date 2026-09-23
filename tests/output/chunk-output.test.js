import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveChunkOutputPath,
  writeChunksToJson,
} from '../../src/output/chunk-output.js';

/** @type {string} */
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chunk-output-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveChunkOutputPath', () => {
  it('returns null when output is not configured', () => {
    expect(resolveChunkOutputPath(undefined, 'job-1')).toBeNull();
    expect(resolveChunkOutputPath({}, 'job-1')).toBeNull();
    expect(resolveChunkOutputPath({ file: 'x.json' }, 'job-1')).toBeNull();
  });

  it('defaults to <jobId>.json inside the configured dir', () => {
    const path = resolveChunkOutputPath({ dir }, 'job-123');
    expect(path).toBe(join(dir, 'job-123.json'));
  });

  it('uses the fixed output file when set', () => {
    const path = resolveChunkOutputPath({ dir, file: 'chunks.json' }, 'job-123');
    expect(path).toBe(join(dir, 'chunks.json'));
  });

  it('sanitizes unsafe job ids for the file system', () => {
    const path = resolveChunkOutputPath({ dir }, 'a/b:c?d');
    expect(path).toBe(join(dir, 'a_b_c_d.json'));
  });
});

describe('writeChunksToJson', () => {
  it('writes a pretty-printed JSON array of chunks', () => {
    const chunks = [
      { id: 'c1', type: 'code', content: 'x', metadata: { file: 'a.ts' } },
    ];
    const path = join(dir, 'out.json');
    const written = writeChunksToJson({ path, chunks });
    expect(written).toBe(path);
    const parsed = JSON.parse(readFileSync(written, 'utf8'));
    expect(parsed).toEqual(chunks);
    expect(readFileSync(written, 'utf8')).toContain('\n');
  });

  it('creates missing directories', () => {
    const path = join(dir, 'nested', 'deeper', 'out.json');
    writeChunksToJson({ path, chunks: [] });
    expect(existsSync(path)).toBe(true);
  });

  it('overwrites an existing file atomically', () => {
    const path = join(dir, 'out.json');
    writeChunksToJson({ path, chunks: [{ id: 'a' }] });
    writeChunksToJson({ path, chunks: [{ id: 'b' }] });
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed).toEqual([{ id: 'b' }]);
  });
});