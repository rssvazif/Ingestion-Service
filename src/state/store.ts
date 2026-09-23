import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { IngestionStateStore, IngestionSnapshot } from './types.js';

/**
 * File-backed implementation of {@link IngestionStateStore}. Writes are
 * atomic (temp file + rename) so a crash mid-write does not corrupt the
 * canonical state file.
 */
export class FileIngestionStateStore implements IngestionStateStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  load(): IngestionSnapshot {
    if (!existsSync(this.filePath)) {
      return { repositories: {} };
    }
    const text = readFileSync(this.filePath, 'utf8');
    if (text.trim().length === 0) {
      return { repositories: {} };
    }
    try {
      const parsed = JSON.parse(text) as IngestionSnapshot;
      if (!parsed.repositories || typeof parsed.repositories !== 'object') {
        return { repositories: {} };
      }
      return parsed;
    } catch {
      return { repositories: {} };
    }
  }

  save(snapshot: IngestionSnapshot): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const next: IngestionSnapshot = { ...snapshot, updatedAt: new Date().toISOString() };
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }
}

/**
 * In-memory implementation of {@link IngestionStateStore} used by tests.
 */
export class InMemoryIngestionStateStore implements IngestionStateStore {
  private data: IngestionSnapshot = { repositories: {} };

  load(): IngestionSnapshot {
    return JSON.parse(JSON.stringify(this.data)) as IngestionSnapshot;
  }

  save(snapshot: IngestionSnapshot): void {
    this.data = JSON.parse(JSON.stringify(snapshot)) as IngestionSnapshot;
  }
}
