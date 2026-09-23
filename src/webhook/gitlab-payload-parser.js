import { z } from 'zod';
import { NormalizedTriggerSchema } from './trigger-schema.js';

const ProjectSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().optional(),
});

const MergeRequestWebhookSchema = z.object({
  object_kind: z.literal('merge_request'),
  project: ProjectSchema,
});

export class GitLabPayloadError extends Error {
  /** @type {string[]} */
  issues;
  /** @type {string} */
  reason;

  /**
   * @param {string} reason
   * @param {string[]} [issues]
   */
  constructor(reason, issues) {
    super(`Invalid GitLab webhook payload: ${reason}`);
    this.name = 'GitLabPayloadError';
    this.reason = reason;
    this.issues = issues;
  }
}

/**
 * @param {unknown} body
 * @returns {NormalizedTrigger}
 */
export function parseGitLabMergeRequestWebhook(body) {
  const parsed = MergeRequestWebhookSchema.safeParse(body);
  if (!parsed.success) {
    throw new GitLabPayloadError(
      'payload did not match the Merge Request webhook schema',
      parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }

  const { project } = parsed.data;

  return NormalizedTriggerSchema.parse({
    projectId: String(project.id),
    projectName: project.name,
  });
}