// Dev-only: seed the 12 starter products for a given user.
// Usage: npm run seed -- <email>
// Idempotent — skips any product already present (by name) for that user.

import { normalizeBrandName, normalizeProductName } from '../shared/normalize.js';
import { seedProducts } from '../shared/seedProducts.js';
import { statements } from './statements.js';
import type { UserRow } from './types.js';

const email = process.argv[2];
if (email === undefined || email === '') {
  console.error('usage: npm run seed -- <email>');
  process.exit(1);
}

const userRow = statements.users.selectByEmail.get(email) as UserRow | undefined;
if (userRow === undefined) {
  console.error(`user not found: ${email}`);
  process.exit(1);
}

const now = Date.now();
let added = 0;
for (const p of seedProducts) {
  const name = normalizeProductName(p.name);
  if (statements.products.existsByNameForUser.get(userRow.id, name) !== undefined) continue;
  statements.products.insert.run(
    name,
    normalizeBrandName(p.brand),
    p.unit,
    p.barcode,
    p.per100.kcal,
    p.per100.protein,
    p.per100.carbs,
    p.per100.fat,
    0,
    userRow.id,
    now,
  );
  added++;
}
console.log(
  `[kcal seed] ${added} products inserted for ${email} (skipped ${
    seedProducts.length - added
  } already-present)`,
);
process.exit(0);
