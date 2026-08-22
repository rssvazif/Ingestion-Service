import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitLabRepositoryAdapter } from '../../src/repository/gitlab-adapter.js';
import {
  GitLabApiError,
  GitLabAuthError,
  GitLabNotFoundError,
  GitLabRateLimitError,
} from '../../src/errors/index.js';
import type { Logger } from '../../src/logger/index.js';
import type { GitLabConfig } from '../../src/config/index.js';

const config: GitLabConfig = {
  host: 'https://gitlab.example.com',
  token: 'secret-token-1234567890',
  projectId: 'group%2Fproject',
  branch: 'main',
};

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child(): Logger {
    return silentLogger;
  },
  setLevel() {},
};

interface MockRoute {
  match: (url: string, init?: RequestInit) => boolean;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function makeFetch(routes: MockRoute[]): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const route = routes.find((r) => r.match(url as string, init));
    if (!route) {
      return new Response('not found', { status: 404 });
    }
    const headers = new Headers(route.headers ?? {});
    const ct = headers.get('content-type') ?? 'application/json';
    if (route.status === 404) {
      return new Response(JSON.stringify({ message: '404 Not found' }), {
        status: route.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (route.status === 401 || route.status === 403) {
      return new Response(JSON.stringify({ message: '401 Unauthorized' }), {
        status: route.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (route.status === 429) {
      return new Response('', {
        status: 429,
        headers: { 'retry-after': '1' },
      });
    }
    if (route.status >= 500) {
      return new Response('boom', { status: route.status });
    }
    const body =
      typeof route.body === 'string'
        ? route.body
        : route.body instanceof Buffer
          ? route.body
          : JSON.stringify(route.body ?? {});
    return new Response(body, { status: route.status, headers: { 'content-type': ct } });
  }) as unknown as typeof fetch;
}

describe('GitLabRepositoryAdapter - construction', () => {
  it('throws when host is missing', () => {
    expect(() => new GitLabRepositoryAdapter({ ...config, host: '' }, silentLogger)).toThrow(
      GitLabAuthError
    );
  });

  it('throws when token is missing', () => {
    expect(() => new GitLabRepositoryAdapter({ ...config, token: '' }, silentLogger)).toThrow(
      GitLabAuthError
    );
  });

  it('throws when projectId is missing', () => {
    expect(
      () => new GitLabRepositoryAdapter({ ...config, projectId: '' }, silentLogger)
    ).toThrow(GitLabAuthError);
  });

  it('exposes a stable repositoryId derived from projectId', () => {
    const a = new GitLabRepositoryAdapter(config, silentLogger);
    expect(a.repositoryId).toBe('group%2Fproject');
    expect(a.name).toBe('GitLab');
  });

  it('strips trailing slashes from host', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) =>
          url === 'https://gitlab.example.com/api/v4/projects/group%2Fproject',
        status: 200,
        body: {
          id: 1,
          name: 'p',
          path_with_namespace: 'group/project',
          default_branch: 'main',
        },
      },
    ]);
    const a = new GitLabRepositoryAdapter(
      { ...config, host: 'https://gitlab.example.com/' },
      silentLogger,
      { fetchImpl }
    );
    const info = await a.getRepositoryInfo();
    expect(info.defaultBranch).toBe('main');
  });
});

describe('GitLabRepositoryAdapter - getRepositoryInfo', () => {
  it('returns parsed info on success', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/api/v4/projects/group%2Fproject'),
        status: 200,
        body: {
          id: 42,
          name: 'service',
          path_with_namespace: 'group/service',
          default_branch: 'develop',
          web_url: 'https://gitlab.example.com/group/service',
        },
      },
    ]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    const info = await a.getRepositoryInfo();
    expect(info).toMatchObject({
      id: 42,
      name: 'service',
      pathWithNamespace: 'group/service',
      defaultBranch: 'develop',
    });
  });

  it('throws GitLabAuthError on 401', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, status: 401 },
    ]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    await expect(a.getRepositoryInfo()).rejects.toBeInstanceOf(GitLabAuthError);
  });

  it('throws GitLabAuthError on 403', async () => {
    const fetchImpl = makeFetch([{ match: () => true, status: 403 }]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    await expect(a.getRepositoryInfo()).rejects.toBeInstanceOf(GitLabAuthError);
  });

  it('throws GitLabNotFoundError on 404', async () => {
    const fetchImpl = makeFetch([{ match: () => true, status: 404 }]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    await expect(a.getRepositoryInfo()).rejects.toBeInstanceOf(GitLabNotFoundError);
  });
});

describe('GitLabRepositoryAdapter - getCurrentRevision', () => {
  it('returns the latest commit SHA for a branch', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) =>
          url.includes('/repository/branches/develop') && url.includes('group%2Fproject'),
        status: 200,
        body: { name: 'develop', commit: { id: 'abc123def456' } },
      },
    ]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    const rev = await a.getCurrentRevision('develop');
    expect(rev).toEqual({
      repositoryId: 'group%2Fproject',
      commit: 'abc123def456',
      branch: 'develop',
    });
  });

  it('throws on missing commit', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, status: 200, body: { name: 'develop' } },
    ]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    await expect(a.getCurrentRevision('develop')).rejects.toBeInstanceOf(GitLabApiError);
  });

  it('throws when branch is empty', async () => {
    const a = new GitLabRepositoryAdapter(config, silentLogger);
    await expect(a.getCurrentRevision('')).rejects.toBeInstanceOf(GitLabApiError);
  });
});

describe('GitLabRepositoryAdapter - getChangedFiles', () => {
  it('normalizes compare response into change records', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/repository/compare'),
        status: 200,
        body: {
          diff: [
            { new_path: 'src/added.ts', new_file: true },
            { old_path: 'src/modified.ts', new_path: 'src/modified.ts' },
            { old_path: 'src/deleted.ts', deleted_file: true },
          ],
        },
      },
    ]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    const from = { repositoryId: config.projectId, commit: 'from-sha', branch: 'main' };
    const to = { repositoryId: config.projectId, commit: 'to-sha', branch: 'main' };
    const changes = await a.getChangedFiles(from, to);
    expect(changes).toEqual([
      { path: 'src/added.ts', changeType: 'added' },
      { path: 'src/modified.ts', oldPath: undefined, changeType: 'modified' },
      { path: 'src/deleted.ts', oldPath: 'src/deleted.ts', changeType: 'deleted' },
    ]);
  });

  it('throws when from/to commit is missing', async () => {
    const a = new GitLabRepositoryAdapter(config, silentLogger);
    await expect(
      a.getChangedFiles(
        { repositoryId: config.projectId, commit: '', branch: 'main' },
        { repositoryId: config.projectId, commit: 'sha', branch: 'main' }
      )
    ).rejects.toBeInstanceOf(GitLabApiError);
  });
});

describe('GitLabRepositoryAdapter - listFiles', () => {
  it('walks the tree recursively across keyset pages', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify([
            { id: 'sha1', name: 'src', type: 'tree', path: 'src' },
            { id: 'sha2', name: 'README.md', type: 'blob', path: 'README.md' },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-next-page': 'next-cursor' },
          }
        );
      }
      return new Response(
        JSON.stringify([
          { id: 'sha3', name: 'index.ts', type: 'blob', path: 'src/index.ts' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch;
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    const files = await a.listFiles({
      repositoryId: config.projectId,
      commit: 'sha0',
      branch: 'main',
    });
    expect(files.map((f) => f.path).sort()).toEqual(['README.md', 'src/index.ts']);
    expect(calls).toBe(2);
  });
});

describe('GitLabRepositoryAdapter - getFile', () => {
  it('fetches raw file content using commit SHA', async () => {
    let observedUrl = '';
    const fetchImpl = vi.fn(async (url: string): Promise<Response> => {
      observedUrl = url;
      return new Response('file content here', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }) as unknown as typeof fetch;
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    const buf = await a.getFile({
      path: 'src/index.ts',
      commit: 'deadbeef',
    });
    expect(buf.toString('utf8')).toBe('file content here');
    expect(observedUrl).toContain('/repository/files/');
    expect(observedUrl).toContain('ref=deadbeef');
  });

  it('fetches blob by SHA when only hash is provided', async () => {
    let observedUrl = '';
    const fetchImpl = vi.fn(async (url: string): Promise<Response> => {
      observedUrl = url;
      return new Response('blob content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }) as unknown as typeof fetch;
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    const buf = await a.getFile({ path: 'src/index.ts', hash: 'blobSha' });
    expect(buf.toString('utf8')).toBe('blob content');
    expect(observedUrl).toContain('/repository/blobs/blobSha');
  });

  it('throws on missing path / hash / commit', async () => {
    const a = new GitLabRepositoryAdapter(config, silentLogger);
    await expect(a.getFile({ path: '' } as never)).rejects.toBeInstanceOf(GitLabApiError);
    await expect(
      a.getFile({ path: 'foo' } as never)
    ).rejects.toBeInstanceOf(GitLabApiError);
  });
});

describe('GitLabRepositoryAdapter - rate limit & retries', () => {
  it('retries on 429 and eventually succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      calls += 1;
      if (calls < 3) {
        return new Response('', { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(
        JSON.stringify({ id: 1, name: 'p', path_with_namespace: 'g/p', default_branch: 'main' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch;
    const a = new GitLabRepositoryAdapter(config, silentLogger, {
      fetchImpl,
      initialBackoffMs: 1,
      maxRetries: 5,
    });
    const info = await a.getRepositoryInfo();
    expect(info.name).toBe('p');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('throws GitLabRateLimitError after exhausting retries on 429', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return new Response('', { status: 429, headers: { 'retry-after': '0' } });
    }) as unknown as typeof fetch;
    const a = new GitLabRepositoryAdapter(config, silentLogger, {
      fetchImpl,
      initialBackoffMs: 1,
      maxRetries: 1,
    });
    await expect(a.getRepositoryInfo()).rejects.toBeInstanceOf(GitLabRateLimitError);
  });

  it('retries on 5xx and eventually throws GitLabApiError', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return new Response('boom', { status: 503 });
    }) as unknown as typeof fetch;
    const a = new GitLabRepositoryAdapter(config, silentLogger, {
      fetchImpl,
      initialBackoffMs: 1,
      maxRetries: 1,
    });
    await expect(a.getRepositoryInfo()).rejects.toBeInstanceOf(GitLabApiError);
  });
});

describe('GitLabRepositoryAdapter - getDefaultBranch', () => {
  it('returns the default branch from project metadata', async () => {
    const fetchImpl = makeFetch([
      {
        match: (url) => url.includes('/api/v4/projects/group%2Fproject'),
        status: 200,
        body: {
          id: 1,
          name: 'p',
          path_with_namespace: 'g/p',
          default_branch: 'release',
        },
      },
    ]);
    const a = new GitLabRepositoryAdapter(config, silentLogger, { fetchImpl });
    expect(await a.getDefaultBranch()).toBe('release');
  });
});
