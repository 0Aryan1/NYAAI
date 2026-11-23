/** Runs `fn` for each item with at most `limit` at once; the first failure rejects after the others settle. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const errors: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        try {
          await fn(next);
        } catch (err) {
          errors.push(err);
        }
      }
    }),
  );
  if (errors.length) throw errors[0];
}
