/** Content fingerprints: SHA-256 as hex, for "have we stored this exact file or chunk before?" checks. */
import { createHash } from 'node:crypto';

export const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
