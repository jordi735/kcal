// Static HTML/text templates colocated in ./templates/, loaded once at
// module load. Mirrors the server/migrations/ loading pattern in db.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./templates/', import.meta.url));
const read = (name: string): string => readFileSync(`${dir}${name}`, 'utf8');

export const loginCodeHtml = read('login-code.html');
export const loginCodeText = read('login-code.txt');
export const debugPageHtml = read('debug.html');

// {{key}} -> vars[key]. Throws on unknown keys so template typos surface
// on first call rather than shipping silently. Does NOT escape — callers
// are responsible for escaping user data before substitution.
export function render(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`template: missing var "${key}"`);
    }
    return String(vars[key]);
  });
}
