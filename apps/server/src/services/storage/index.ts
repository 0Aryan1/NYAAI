/**
 * Object storage: the one door to the S3 API (LLD §2, HLD D5). SeaweedFS locally, R2 in the pilot, S3 Mumbai
 * in production; only configuration changes. Buckets are private; signed links come with uploads (Day 4).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ExternalServiceError } from '../../errors.ts';

export interface StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The longest one request may take (ms). */
  timeoutMs?: number;
}

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  /** Every key under a prefix (library upkeep scripts, "delete my data"). */
  list(prefix: string): Promise<string[]>;
  /** Removes one object; a key that is not there is not an error. */
  delete(key: string): Promise<void>;
}

export function createStorage(cfg: StorageConfig): Storage {
  const s3 = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    ...(cfg.timeoutMs
      ? { requestHandler: { requestTimeout: cfg.timeoutMs, connectionTimeout: Math.min(cfg.timeoutMs, 10_000) } }
      : {}),
  });
  /** Storage that does not answer is an outside-service outage for the caller (503 on a request), not a crash. */
  const send = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      throw new ExternalServiceError('File storage', err instanceof Error ? err.message : String(err));
    }
  };
  return {
    async put(key, body, contentType) {
      await send(() =>
        s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType })),
      );
    },
    async get(key) {
      const out = await send(() => s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key })));
      if (!out.Body) throw new Error(`empty object ${key}`);
      return out.Body.transformToByteArray();
    },
    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return true;
      } catch (err) {
        if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
        throw new ExternalServiceError('File storage', err instanceof Error ? err.message : String(err));
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const out = await send(() =>
          s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token })),
        );
        keys.push(...(out.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])));
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async delete(key) {
      await send(() => s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })));
    },
  };
}
