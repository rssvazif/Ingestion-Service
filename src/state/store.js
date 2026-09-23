import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * File-backed implementation of {@link IngestionStateStore}. Writes are
 * atomic (temp file + rename) so a crash mid-write does not corrupt the
 * canonical state file.
 */
export class FileIngestionStateStore {
  /** @type {string} */
  #filePath;

  /** @param {string} filePath */
  constructor(filePath) {
    this.#filePath = resolve(filePath);
  }

  /** @returns {IngestionSnapshot} */
  load() {
    if (!existsSync(this.#filePath)) {
      return { repositories: {} };
    }
    const text = readFileSync(this.#filePath, 'utf8');
    if (text.trim().length === 0) {
      return { repositories: {} };
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed.repositories || typeof parsed.repositories !== 'object') {
        return { repositories: {} };
      }
      return parsed;
    } catch {
      return { repositories: {} };
    }
  }

  /** @param {IngestionSnapshot} snapshot */
  save(snapshot) {
    const dir = dirname(this.#filePath);
    mkdirSync(dir, { recursive: true });
    const next = { ...snapshot, updatedAt: new Date().toISOString() };
    const tmp = `${this.#filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, this.#filePath);
  }
}

/**
 * In-memory implementation of {@link IngestionStateStore} used by tests.
 */
export class InMemoryIngestionStateStore {
  /** @type {IngestionSnapshot} */
  #data = { repositories: {} };

  /** @returns {IngestionSnapshot} */
  load() {
    return JSON.parse(JSON.stringify(this.#data));
  }

  /** @param {IngestionSnapshot} snapshot */
  save(snapshot) {
    this.#data = JSON.parse(JSON.stringify(snapshot));
  }
}