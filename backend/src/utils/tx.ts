import mongoose, { type ClientSession } from 'mongoose';

/**
 * Run `fn` inside a MongoDB multi-document transaction.
 * `withTransaction` retries automatically on TransientTransactionError
 * (e.g. write conflicts from concurrent checkouts on the same stock row),
 * so `fn` must not have side effects outside the database.
 */
export async function withTx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15_000 },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}
