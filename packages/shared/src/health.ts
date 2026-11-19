import { z } from 'zod';

export const DependencyStatus = z.enum(['ok', 'down']);
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  db: DependencyStatus,
  redis: DependencyStatus,
  pgvector: z.string().nullable(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
