import { z } from 'zod';

export const NormalizedTriggerSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).optional(),
});