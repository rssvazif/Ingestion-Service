import { describe, it, expect } from 'vitest';
import {
  GitLabPayloadError,
  parseGitLabMergeRequestWebhook,
} from '../../src/webhook/gitlab-payload-parser.js';

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object_kind: 'merge_request',
    project: {
      id: 449,
      name: 'partServiceFileStorage',
      path_with_namespace: 'infrastructure/services/public/services/partServiceFileStorage',
      web_url: 'https://gitlab.example.com/group/project',
    },
    object_attributes: {
      iid: 123,
      target_branch: 'develop',
      source_branch: 'feature/x',
      state: 'merged',
      action: 'merge',
      merge_commit_sha: 'abc123def456',
      url: 'https://gitlab.example.com/group/project/-/merge_requests/123',
    },
    ...overrides,
  };
}

describe('parseGitLabMergeRequestWebhook', () => {
  it('extracts a normalized trigger from a merge event', () => {
    const trigger = parseGitLabMergeRequestWebhook(makePayload());
    expect(trigger).toEqual({
      action: 'merge',
      projectId: '449',
      branch: 'develop',
      sourceBranch: 'feature/x',
      commit: 'abc123def456',
      mergeRequestIid: 123,
      mergeRequestUrl: 'https://gitlab.example.com/group/project/-/merge_requests/123',
    });
  });

  it('accepts approved events', () => {
    const trigger = parseGitLabMergeRequestWebhook(
      makePayload({
        object_attributes: { ...(makePayload().object_attributes as object), action: 'approved', merge_commit_sha: null },
      }),
    );
    expect(trigger.action).toBe('approved');
    expect(trigger.commit).toBeUndefined();
  });

  it('accepts a numeric project id passed as string', () => {
    const trigger = parseGitLabMergeRequestWebhook(
      makePayload({ project: { id: '449' } }),
    );
    expect(trigger.projectId).toBe('449');
  });

  it('rejects unsupported actions', () => {
    expect(() =>
      parseGitLabMergeRequestWebhook(
        makePayload({
          object_attributes: {
            ...(makePayload().object_attributes as object),
            action: 'open',
          },
        }),
      ),
    ).toThrow(GitLabPayloadError);
  });

  it('rejects payloads that are not merge_request webhooks', () => {
    expect(() =>
      parseGitLabMergeRequestWebhook({ object_kind: 'push' }),
    ).toThrow(GitLabPayloadError);
  });

  it('rejects payloads missing target_branch', () => {
    const payload = makePayload();
    delete (payload.object_attributes as Record<string, unknown>).target_branch;
    expect(() => parseGitLabMergeRequestWebhook(payload)).toThrow(GitLabPayloadError);
  });

  it('rejects payloads missing project.id', () => {
    const payload = makePayload();
    delete (payload.project as Record<string, unknown>).id;
    expect(() => parseGitLabMergeRequestWebhook(payload)).toThrow(GitLabPayloadError);
  });
});
