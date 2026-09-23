import { describe, it, expect } from 'vitest';
import {
  GitLabPayloadError,
  parseGitLabMergeRequestWebhook,
} from '../../src/webhook/gitlab-payload-parser.js';

/**
 * @param {Record<string, unknown>} [overrides]
 */
function makePayload(overrides = {}) {
  return {
    object_kind: 'merge_request',
    project: {
      id: 449,
      name: 'partServiceFileStorage',
    },
    ...overrides,
  };
}

describe('parseGitLabMergeRequestWebhook', () => {
  it('extracts projectId from a minimal payload', () => {
    const trigger = parseGitLabMergeRequestWebhook(makePayload());
    expect(trigger).toEqual({
      projectId: '449',
      projectName: 'partServiceFileStorage',
    });
  });

  it('accepts a numeric project id passed as string', () => {
    const trigger = parseGitLabMergeRequestWebhook(
      makePayload({ project: { id: '449' } }),
    );
    expect(trigger.projectId).toBe('449');
  });

  it('omits projectName when not supplied', () => {
    const trigger = parseGitLabMergeRequestWebhook(
      makePayload({ project: { id: 449 } }),
    );
    expect(trigger).toEqual({ projectId: '449' });
  });

  it('ignores any extra fields including object_attributes', () => {
    const trigger = parseGitLabMergeRequestWebhook(
      makePayload({
        object_attributes: { target_branch: 'develop', action: 'merge' },
      }),
    );
    expect(trigger).toEqual({
      projectId: '449',
      projectName: 'partServiceFileStorage',
    });
  });

  it('rejects payloads that are not merge_request webhooks', () => {
    expect(() =>
      parseGitLabMergeRequestWebhook({ object_kind: 'push' }),
    ).toThrow(GitLabPayloadError);
  });

  it('rejects payloads missing project.id', () => {
    const payload = makePayload();
    delete payload.project.id;
    expect(() => parseGitLabMergeRequestWebhook(payload)).toThrow(GitLabPayloadError);
  });

  it('rejects empty bodies', () => {
    expect(() => parseGitLabMergeRequestWebhook({})).toThrow(GitLabPayloadError);
  });
});