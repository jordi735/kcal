import { createHash } from 'node:crypto';

// App bearers contain 256 random bits. Persist their digest while the client
// keeps presenting the original bearer; a stored digest is not a credential.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
