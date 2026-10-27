// Keep the existing email syntax while bounding validation and stored addresses.
import { MAX_EMAIL_BYTES } from './constraints.js';

const encoder = new TextEncoder();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function withinByteLimit(value: string): boolean {
  // UTF-8 cannot use fewer bytes than this UTF-16 length. Check it first so
  // attacker-controlled input cannot cause a large encoding allocation.
  return value.length <= MAX_EMAIL_BYTES && encoder.encode(value).byteLength <= MAX_EMAIL_BYTES;
}

export function isEmail(value: unknown): value is string {
  if (typeof value !== 'string' || !withinByteLimit(value)) return false;
  // Unicode lowercase mappings can expand the address. Auth uses this same
  // normalization after validation, so both incoming and stored forms must fit.
  if (!withinByteLimit(value.trim().toLowerCase())) return false;
  return EMAIL_RE.test(value);
}
