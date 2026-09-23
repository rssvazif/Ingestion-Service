import { z } from 'zod';

export const NormalizedTriggerSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).optional(),
});

export type NormalizedTriggerInput = z.infer<typeof NormalizedTriggerSchema>;
