import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { extract } from 'tar';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';
import { z } from 'zod';

import {
  GitLabApiError,
  GitLabArchiveError,
  GitLabAuthError,
  GitLabNotFoundError,
  GitLabRateLimitError,
  GitLabTimeoutError,
} from '../errors/index.js';

/**
 * @typedef {object} GitLabAdapterOptions
 * @property {typeof fetch} [fetchImpl]     Optional override for fetch (used in tests).
 * @property {number} [maxRetries]          Override the default max retries when GitLab returns 429 / 5xx.
 * @property {number} [initialBackoffMs]    Initial back-off in ms (exponential).
 */

const TREE_API_PATH = (projectId, ref) =>
  `/api/v4/projects/${projectId}/repository/tree?ref=${encodeURIComponent(ref)}&per_page=100`;

const BLOB_API_PATH = (projectId, sha) =>
  `/api/v4/projects/${projectId}/repository/blobs/${sha}`;

const RAW_FILE_API_PATH = (projectId, ref, path) =>
  `/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(
    path
  )}/raw?ref=${encodeURIComponent(ref)}`;

const PROJECT_API_PATH = (projectId) => `/api/v4/projects/${projectId}`;

const ARCHIVE_API_PATH = (projectId, sha, format) =>
  `/api/v4/projects/${projectId}/repository/archive.${format}?sha=${encodeURIComponent(sha)}`;

const COMPARE_API_PATH = (projectId, from, to) =>
  `/api/v4/projects/${projectId}/repository/compare?from=${encodeURIComponent(
    from
  )}&to=${encodeURIComponent(to)}`;

const BRANCH_API_PATH = (projectId, branch) =>
  `/api/v4/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`;

const BranchSchema = z.object({
  name: z.string(),
  default: z.boolean().optional(),
  commit: z.object({ id: z.string(), short_id: z.string().optional() }).optional(),
});

const ProjectSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  path_with_namespace: z.string(),
  default_branch: z.string(),
  web_url: z.string().optional(),
});

const TreeNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tree', 'blob']),
  path: z.string(),
  mode: z.string().optional(),
});

const CompareDiffSchema = z.object({
  diff: z
    .array(
      z.object({
        old_path: z.string().optional(),
        new_path: z.string().optional(),
        new_file: z.boolean().optional(),
        deleted_file: z.boolean().optional(),
        renamed_file: z.boolean().optional(),
      })
    )
    .optional()
    .default([]),
  diffs: z
    .array(
      z.object({
        old_path: z.string().optional(),
        new_path: z.string().optional(),
        new_file: z.boolean().optional(),
        deleted_file: z.boolean().optional(),
        renamed_file: z.boolean().optional(),
      })
    )
    .optional()
    .default([]),
  compare_commit: z
    .object({
      id: z.string().optional(),
    })
    .optional(),
  compare_same_ref: z.boolean().optional(),
});

export class GitLabRepositoryAdapter {
  /** @type {string} */
  name = 'GitLab';
  /** @type {string} */
  repositoryId;

  /** @type {import('../config/index.js').GitLabConfig} */
  #config;
  /** @type {import('../logger/index.js').Logger} */
  #log;
  /** @type {typeof fetch} */
  #fetchImpl;
  /** @type {number} */
  #maxRetries;
  /** @type {number} */
  #initialBackoffMs;

  /**
   * @param {import('../config/index.js').GitLabConfig} config
   * @param {import('../logger/index.js').Logger} log
   * @param {GitLabAdapterOptions} [opts]
   */
  constructor(config, log, opts = {}) {
    if (!config.host) throw new GitLabAuthError('GitLab host is required', { config: '<missing>' });
    if (!config.token) throw new GitLabAuthError('GitLab token is required', { config: '<missing>' });
    if (!config.projectId)
      throw new GitLabAuthError('GitLab projectId is required', { config: '<missing>' });

    this.#config = {
      ...config,
      host: config.host.replace(/\/+$/, ''),
    };
    this.#log = log.child({ adapter: 'GitLab', project: config.projectId });
    this.#fetchImpl = opts.fetchImpl ?? fetch;
    this.#maxRetries = opts.maxRetries ?? 3;
    this.#initialBackoffMs = opts.initialBackoffMs ?? 500;
    this.repositoryId = this.#config.projectId;
  }

  // -- Public API --------------------------------------------------------

  /** @returns {Promise<import('./adapter.js').RepositoryInfo>} */
  async getRepositoryInfo() {
    const { body } = await this.#requestJson(PROJECT_API_PATH(this.#config.projectId), { method: 'GET' });
    const parsed = ProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new GitLabApiError('Unexpected GitLab project payload', undefined, {
        issues: parsed.error.issues,
      });
    }
    return {
      id: parsed.data.id,
      name: parsed.data.name,
      pathWithNamespace: parsed.data.path_with_namespace,
      defaultBranch: parsed.data.default_branch,
      webUrl: parsed.data.web_url,
    };
  }

  /** @returns {Promise<string>} */
  async getDefaultBranch() {
    const info = await this.getRepositoryInfo();
    return info.defaultBranch;
  }

  /**
   * @param {string} branch
   * @returns {Promise<import('./types.js').Revision>}
   */
  async getCurrentRevision(branch) {
    if (!branch) throw new GitLabApiError('Branch is required');
    const path = BRANCH_API_PATH(this.#config.projectId, branch);
    const { body } = await this.#requestJson(path, { method: 'GET' });
    const parsed = BranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new GitLabApiError(`Unexpected GitLab branch payload for '${branch}'`, undefined, {
        issues: parsed.error.issues,
      });
    }
    if (!parsed.data.commit?.id) {
      throw new GitLabApiError(`Branch '${branch}' has no commit`, undefined, { branch });
    }
    return {
      repositoryId: this.repositoryId,
      commit: parsed.data.commit.id,
      branch,
    };
  }

  /**
   * @param {import('./types.js').Revision} revision
   * @param {import('./adapter.js').ListFilesOptions} [options]
   * @returns {Promise<import('./types.js').RepositoryFile[]>}
   */
  async listFiles(revision, options = {}) {
    if (!revision.commit) throw new GitLabApiError('Revision commit is required');
    const includeDirs = options.includeDirectories ?? false;
    const prefix = options.pathPrefix ?? '';

    const all = [];
    await this.#walkTree(revision.commit, prefix, includeDirs, all);
    return all;
  }

  /**
   * @param {import('./types.js').FileRevision} revision
   * @returns {Promise<Buffer>}
   */
  async getFile(revision) {
    if (!revision.path) throw new GitLabApiError('File path is required');
    if (!revision.commit && !revision.hash) {
      throw new GitLabApiError('File revision requires either commit or hash');
    }
    if (revision.hash && !revision.commit) {
      // Direct blob fetch by SHA, no need for raw path encoding
      const url = this.#url(BLOB_API_PATH(this.#config.projectId, revision.hash));
      return this.#requestBuffer(url, undefined);
    }
    const url = this.#url(
      RAW_FILE_API_PATH(this.#config.projectId, revision.commit, revision.path)
    );
    return this.#requestBuffer(url, undefined);
  }

  /**
   * @param {import('./types.js').Revision} from
   * @param {import('./types.js').Revision} to
   * @returns {Promise<import('./types.js').ChangedFile[]>}
   */
  async getChangedFiles(from, to) {
    if (!from.commit || !to.commit) {
      throw new GitLabApiError('Both from.commit and to.commit are required for compare');
    }
    const { body } = await this.#requestJson(
      COMPARE_API_PATH(this.#config.projectId, from.commit, to.commit),
      { method: 'GET' }
    );
    const parsed = CompareDiffSchema.safeParse(body);
    if (!parsed.success) {
      throw new GitLabApiError('Unexpected GitLab compare payload', undefined, {
        issues: parsed.error.issues,
      });
    }
    const entries = parsed.data.diff.length > 0 ? parsed.data.diff : parsed.data.diffs;
    return entries.map((d) => {
      const isDeleted = !!d.deleted_file;
      const isNew = !!d.new_file;
      const oldPath = d.old_path;
      const newPath = d.new_path ?? oldPath ?? '';
      let changeType;
      if (isDeleted) changeType = 'deleted';
      else if (isNew) changeType = 'added';
      else changeType = 'modified';
      const preserveOldPath = isDeleted || (oldPath != null && oldPath !== newPath);
      return {
        path: newPath,
        oldPath: preserveOldPath ? oldPath : undefined,
        changeType,
      };
    });
  }

  /**
   * @param {import('./types.js').Revision} revision
   * @returns {Promise<import('./types.js').ArchiveEntry[]>}
   */
  async downloadArchive(revision) {
    if (!revision.commit) throw new GitLabArchiveError('Revision commit is required');
    const url = this.#url(ARCHIVE_API_PATH(this.#config.projectId, revision.commit, 'tar.gz'));
    const buf = await this.#downloadArchiveBuffer(url);
    return this.#parseTarGz(buf);
  }

  /**
   * Downloads the archive via Node's built-in `https` module instead of
   * `fetch`. Some GitLab instances return HTTP 406 for the archive endpoint
   * when the request is sent via undici (Node's default `fetch`); falling
   * back to HTTP/1.1 via `https.request` works around the issue without
   * pulling in additional dependencies.
   *
   * @param {string} url
   * @returns {Promise<Buffer>}
   */
  #downloadArchiveBuffer(url) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const options = {
        method: 'GET',
        hostname: u.hostname,
        port: u.port ? u.port : '443',
        path: `${u.pathname}${u.search}`,
        headers: {
          'PRIVATE-TOKEN': this.#config.token,
          Accept: 'application/octet-stream',
        },
      };
      const req = https.request(options, (res) => {
          const status = res.statusCode ?? 0;
          if (status === 401 || status === 403) {
            reject(new GitLabAuthError(`GitLab rejected credentials (HTTP ${status})`, { status }));
            return;
          }
          if (status === 404) {
            reject(new GitLabNotFoundError(`GitLab resource not found (HTTP 404)`, { url }));
            return;
          }
          if (status === 429) {
            const retryAfter = Number(res.headers['retry-after']);
            reject(
              new GitLabRateLimitError(
                'GitLab rate limit exceeded',
                Number.isFinite(retryAfter) ? retryAfter : undefined,
                { url }
              )
            );
            return;
          }
          if (status < 200 || status >= 300) {
            reject(
              new GitLabApiError(`GitLab request failed: HTTP ${status}`, status, { url })
            );
            return;
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', (err) =>
            reject(new GitLabArchiveError('Archive download failed', { cause: err.message }))
          );
        }
      );
      req.on('error', (err) =>
        reject(
          err.name === 'AbortError'
            ? new GitLabTimeoutError('Archive download timed out', { url })
            : new GitLabArchiveError('Archive request error', { cause: err.message })
        )
      );
      req.end();
    });
  }

  // -- Internals --------------------------------------------------------

  /** @param {string} path */
  #url(path) {
    return `${this.#config.host}${path}`;
  }

  /** @returns {Record<string, string>} */
  #authHeaders() {
    return { 'PRIVATE-TOKEN': this.#config.token };
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   * @returns {Promise<{ body: unknown, headers: Headers }>}
   */
  async #requestJson(path, init = {}) {
    const { body, headers } = await this.#requestRaw(this.#url(path), init, 'json');
    if (body === undefined) return { body: {}, headers };
    return { body, headers };
  }

  /**
   * @param {string} url
   * @param {RequestInit | undefined} init
   * @returns {Promise<Buffer>}
   */
  async #requestBuffer(url, init) {
    const { body } = await this.#requestRaw(url, init, 'binary');
    return body;
  }

  /**
   * @param {string} url
   * @param {RequestInit | undefined} init
   * @param {'json' | 'binary'} kind
   * @returns {Promise<{ body: unknown, headers: Headers }>}
   */
  async #requestRaw(url, init, kind) {
    const start = Date.now();
    const initHeaders = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          initHeaders[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          initHeaders[k] = v;
        }
      } else {
        Object.assign(initHeaders, init.headers);
      }
    }
    const headers = {
      ...this.#authHeaders(),
      ...initHeaders,
    };
    if (!headers['Accept']) {
      headers['Accept'] = kind === 'binary' ? 'application/octet-stream' : 'application/json';
    }
    let attempt = 0;
    let lastError;
    while (attempt <= this.#maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timeoutMs = 60_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.#fetchImpl(url, { ...(init ?? {}), headers, signal: controller.signal });
        clearTimeout(timer);
        if (res.status === 401 || res.status === 403) {
          throw new GitLabAuthError(`GitLab rejected credentials (HTTP ${res.status})`, {
            status: res.status,
          });
        }
        if (res.status === 404) {
          throw new GitLabNotFoundError(`GitLab resource not found (HTTP 404)`, { url });
        }
        if (res.status === 429) {
          const retryAfterRaw = res.headers.get('Retry-After');
          const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
          if (attempt > this.#maxRetries) {
            throw new GitLabRateLimitError(
              'GitLab rate limit exceeded after retries',
              Number.isFinite(retryAfter) ? retryAfter : undefined,
              { url, attempt }
            );
          }
          const backoff = retryAfter && Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : this.#backoffMs(attempt);
          this.#log.warn('GitLab rate limited; backing off', { url, backoffMs: backoff, attempt });
          await delay(backoff);
          continue;
        }
        if (res.status >= 500) {
          if (attempt > this.#maxRetries) {
            throw new GitLabApiError(`GitLab server error (HTTP ${res.status})`, res.status, { url });
          }
          const backoff = this.#backoffMs(attempt);
          this.#log.warn(`GitLab server error ${res.status}; retrying`, { url, backoffMs: backoff });
          await delay(backoff);
          continue;
        }
        if (!res.ok) {
          throw new GitLabApiError(
            `GitLab request failed: HTTP ${res.status}`,
            res.status,
            { url }
          );
        }
        const arr = new Uint8Array(await res.arrayBuffer());
        const elapsed = Date.now() - start;
        this.#log.debug('GitLab request completed', { url, status: res.status, bytes: arr.length, ms: elapsed });
        if (kind === 'json') {
          if (arr.length === 0) return { body: {}, headers: res.headers };
          try {
            return { body: JSON.parse(Buffer.from(arr).toString('utf8')), headers: res.headers };
          } catch (cause) {
            throw new GitLabApiError('Failed to parse GitLab JSON response', undefined, {
              url,
              cause: cause.message,
            });
          }
        }
        return { body: Buffer.from(arr), headers: res.headers };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (
          err instanceof GitLabAuthError ||
          err instanceof GitLabNotFoundError ||
          err instanceof GitLabApiError ||
          err instanceof GitLabRateLimitError ||
          err instanceof GitLabTimeoutError ||
          err instanceof GitLabArchiveError
        ) {
          throw err;
        }
        if (err?.name === 'AbortError') {
          throw new GitLabTimeoutError(`GitLab request timed out after ${timeoutMs}ms`, { url });
        }
        if (attempt > this.#maxRetries) {
          throw new GitLabApiError(
            `GitLab request failed: ${err.message}`,
            undefined,
            { url, cause: err.message }
          );
        }
        const backoff = this.#backoffMs(attempt);
        this.#log.warn(`GitLab request error; retrying`, {
          url,
          attempt,
          backoffMs: backoff,
          error: err.message,
        });
        await delay(backoff);
      }
    }
    throw new GitLabApiError(
      `GitLab request failed after ${this.#maxRetries} attempts`,
      undefined,
      { cause: lastError?.message }
    );
  }

  /** @param {number} attempt */
  #backoffMs(attempt) {
    return this.#initialBackoffMs * 2 ** (attempt - 1);
  }

  /**
   * @param {string} ref
   * @param {string} pathPrefix
   * @param {boolean} includeDirs
   * @param {import('./types.js').RepositoryFile[]} out
   * @returns {Promise<void>}
   */
  async #walkTree(ref, pathPrefix, includeDirs, out) {
    const all = [];
    let page = null;
    do {
      const base = TREE_API_PATH(this.#config.projectId, ref);
      const pathParam = page ? '' : `&path=${encodeURIComponent(pathPrefix)}`;
      const pageParam = page
        ? `&pagination=keyset&page_token=${encodeURIComponent(page)}`
        : '&pagination=keyset';
      const url = `${base}${pathParam}${pageParam}`;
      const { body, headers } = await this.#requestJson(url, { method: 'GET' });
      const items = z.array(TreeNodeSchema).parse(body);
      all.push(...items);
      const next = headers.get('x-next-page');
      page = next && next.length > 0 ? next : null;
    } while (page);

    for (const node of all) {
      if (node.type === 'blob') {
        out.push({
          path: node.path,
          name: node.name,
          type: 'file',
          hash: node.id,
          commit: ref,
        });
      } else if (includeDirs) {
        out.push({
          path: node.path,
          name: node.name,
          type: 'directory',
          commit: ref,
        });
        await this.#walkTree(ref, node.path, includeDirs, out);
      }
    }
  }

  /**
   * @param {Buffer} buf
   * @returns {Promise<import('./types.js').ArchiveEntry[]>}
   */
  async #parseTarGz(buf) {
    const dir = mkdtempSync(join(tmpdir(), 'rag-archive-'));
    const entries = [];
    try {
      const src = Readable.from(buf);
      await pipeline(src, createGunzip(), extract({ cwd: dir, strip: 1 }));
      const { readdirSync, statSync, readFileSync } = await import('node:fs');
      const stack = [dir];
      while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (!entry.isFile()) continue;
          const stat = statSync(full);
          const content = readFileSync(full);
          const rel = full.startsWith(dir) ? full.slice(dir.length + 1) : entry.name;
          entries.push({ path: rel, content, size: stat.size });
        }
      }
    } catch (cause) {
      throw new GitLabArchiveError('Failed to parse GitLab archive', {
        cause: cause.message,
      });
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    return entries;
  }
}