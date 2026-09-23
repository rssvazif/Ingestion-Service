import { z } from 'zod';
import { NormalizedTriggerSchema } from './trigger-schema.js';
import type { NormalizedTrigger } from './types.js';

const ProjectSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  path_with_namespace: z.string().optional(),
  web_url: z.string().optional(),
});

const ObjectAttributesSchema = z.object({
  iid: z.number().int().positive().optional(),
  target_branch: z.string().min(1),
  source_branch: z.string().min(1).optional(),
  state: z.string().optional(),
  action: z.string().min(1),
  merge_commit_sha: z.string().nullable().optional(),
  url: z.string().url().optional(),
});

const MergeRequestWebhookSchema = z.object({
  object_kind: z.literal('merge_request'),
  project: ProjectSchema,
  object_attributes: ObjectAttributesSchema,
});

export class GitLabPayloadError extends Error {
  public readonly issues?: string[];
  public readonly reason: string;

  constructor(reason: string, issues?: string[]) {
    super(`Invalid GitLab webhook payload: ${reason}`);
    this.name = 'GitLabPayloadError';
    this.reason = reason;
    this.issues = issues;
  }
}

const ACCEPTED_ACTIONS = new Set(['merge', 'approved']);

export function parseGitLabMergeRequestWebhook(body: unknown): NormalizedTrigger {
  const parsed = MergeRequestWebhookSchema.safeParse(body);
  if (!parsed.success) {
    throw new GitLabPayloadError(
      'payload did not match the Merge Request webhook schema',
      parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }

  const { project, object_attributes: attrs } = parsed.data;

  if (!ACCEPTED_ACTIONS.has(attrs.action)) {
    throw new GitLabPayloadError(
      `unsupported action '${attrs.action}'; expected one of ${[...ACCEPTED_ACTIONS].join(', ')}`,
    );
  }

  const normalized = NormalizedTriggerSchema.parse({
    action: attrs.action,
    projectId: String(project.id),
    branch: attrs.target_branch,
    sourceBranch: attrs.source_branch,
    commit: attrs.merge_commit_sha ?? undefined,
    mergeRequestIid: attrs.iid,
    mergeRequestUrl: attrs.url,
  });

  return normalized;
}
