import { assertSessionCurrent, type SessionScope } from './api';

export type MutationQueue = <T>(operation: () => Promise<T>) => Promise<T>;

// Commands retain the session that queued them. A rejection releases the queue;
// it must never cause a later command to run with a newly signed-in account.
export function createMutationQueue(session: SessionScope): MutationQueue {
  let tail: Promise<void> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(async () => {
      assertSessionCurrent(session);
      const value = await operation();
      assertSessionCurrent(session);
      return value;
    });
    tail = result.then(() => {}, () => {});
    return result;
  };
}
