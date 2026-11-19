/** Queue names from LLD §5. Job payloads carry ids only, never private text (HLD D4). */
export const QUEUES = ['ingest', 'build', 'check', 'export', 'research', 'nightly', 'status', 'learn', 'ops'] as const;
export type QueueName = (typeof QUEUES)[number];

export const TIMEZONE = 'Asia/Kolkata';
