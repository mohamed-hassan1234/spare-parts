/** True for a MongoDB duplicate-key error on the given field. */
export function isDuplicateKeyError(e: unknown, field: string) {
  const err = e as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  return err?.code === 11000 && (err.keyPattern ? field in err.keyPattern : String(err.message).includes(field));
}

/**
 * Run an idempotent write. If a concurrent request with the same Idempotency-Key committed first,
 * the unique index rejects this one; we then return the original result instead of an error, so
 * client retries and double-clicks always see the same outcome and nothing is recorded twice.
 */
export async function onceByKey<T>(key: string | undefined, replay: () => Promise<T | null | undefined>, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (key && isDuplicateKeyError(e, 'idempotencyKey')) {
      const prior = await replay();
      if (prior) return prior;
    }
    throw e;
  }
}
