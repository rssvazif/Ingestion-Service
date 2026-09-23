import { z } from 'zod';

export const NormalizedTriggerSchema = z.object({
  action: z.enum(['merge', 'approved']),
  projectId: z.string().min(1),
  branch: z.string().min(1),
  sourceBranch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  mergeRequestIid: z.number().int().positive().optional(),
  mergeRequestUrl: z.string().url().optional(),
  version: z.string().min(1).optional(),
  forceFull: z.boolean().optional(),
});

export type NormalizedTriggerInput = z.infer<typeof NormalizedTriggerSchema>;
