// Mutations shared by REST routes and MCP tools. Callers validate their own
// input and resolve userId from verified credentials. Ownership checks, writes,
// and follow-up reads stay in one transaction so failures leave no partial work.

import { normalizeBrandName, normalizeProductName } from '../shared/normalize.js';
import { db } from './db.js';
import { log } from './log.js';
import { rowToEntry, rowToProduct } from './reads.js';
import { statements } from './statements.js';
import { trimOrNull } from './util.js';
import type {
  EntryJoinRow, EntryMembershipRow, EntryUpdate, EntryWithMacros,
  NewEntryBody, NewProductBody, Product, ProductPatch, ProductRow,
} from './types.js';

export class WriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'WriteError';
  }
}

export function createEntry(userId: number, body: NewEntryBody): EntryWithMacros {
  const entry = db.transaction(() => {
    if (statements.products.ownedByUser.get(userId, body.product_id) === undefined) {
      throw new WriteError(404, 'product_not_found');
    }
    const inserted = statements.entries.insert.run(
      userId,
      body.product_id,
      body.grams,
      body.local_date,
      body.local_time,
      Date.now(),
    );
    const row = statements.entries.selectById.get(userId, Number(inserted.lastInsertRowid)) as
      | EntryJoinRow
      | undefined;
    if (row === undefined) throw new WriteError(500, 'insert_failed');
    return rowToEntry(row);
  })();
  log.info('entry added', {
    userId,
    entryId: entry.id,
    productId: entry.product.id,
    grams: entry.grams,
    date: entry.local_date,
  });
  return entry;
}

export function updateEntry(userId: number, entryId: number, body: EntryUpdate): EntryWithMacros {
  const entry = db.transaction(() => {
    if (statements.entries.selectMembershipById.get(userId, entryId) === undefined) {
      throw new WriteError(404, 'not_found');
    }
    if (body.grams !== undefined) {
      const result = statements.entries.updateGrams.run(body.grams, userId, entryId);
      if (result.changes === 0) throw new WriteError(404, 'not_found');
    }
    if (body.tagged !== undefined) {
      const result = statements.entries.updateTagged.run(body.tagged ? 1 : 0, userId, entryId);
      if (result.changes === 0) throw new WriteError(404, 'not_found');
    }
    const row = statements.entries.selectById.get(userId, entryId) as EntryJoinRow | undefined;
    if (row === undefined) throw new WriteError(404, 'not_found');
    return rowToEntry(row);
  })();
  log.info('entry updated', {
    userId,
    entryId: entry.id,
    grams: entry.grams,
    tagged: entry.tagged ? 1 : 0,
  });
  return entry;
}

export function deleteEntry(userId: number, entryId: number): {
  ok: true;
  entry_id: number;
  dissolved_group_id: number | null;
} {
  const dissolvedGroupId = db.transaction(() => {
    const member = statements.entries.selectMembershipById.get(userId, entryId) as
      | EntryMembershipRow
      | undefined;
    if (member === undefined) throw new WriteError(404, 'not_found');
    const result = statements.entries.delete.run(userId, entryId);
    if (result.changes === 0) throw new WriteError(404, 'not_found');

    if (member.group_id !== null) {
      const countRow = statements.entries.countForGroup.get(userId, member.group_id) as {
        count: number;
      };
      if (countRow.count < 2) {
        const dissolved = statements.entryGroups.delete.run(userId, member.group_id);
        if (dissolved.changes === 1) return member.group_id;
      }
    }
    return null;
  })();
  log.info('entry deleted', { userId, entryId, dissolvedGroupId });
  return { ok: true, entry_id: entryId, dissolved_group_id: dissolvedGroupId };
}

export function createProduct(userId: number, body: NewProductBody): Product {
  const product = db.transaction(() => {
    const inserted = statements.products.insert.run(
      normalizeProductName(body.name),
      normalizeBrandName(body.brand),
      body.unit,
      trimOrNull(body.barcode),
      body.per100.kcal,
      body.per100.protein,
      body.per100.carbs,
      body.per100.fat,
      body.is_temp ? 1 : 0,
      userId,
      Date.now(),
    );
    const row = statements.products.selectById.get(userId, Number(inserted.lastInsertRowid)) as
      | ProductRow
      | undefined;
    if (row === undefined) throw new WriteError(500, 'insert_failed');
    return rowToProduct(row);
  })();
  log.info('product created', { userId, productId: product.id, isTemp: product.is_temp });
  return product;
}

export function updateProduct(userId: number, productId: number, body: ProductPatch): Product {
  const product = db.transaction(() => {
    const current = statements.products.selectById.get(userId, productId) as ProductRow | undefined;
    if (current === undefined) throw new WriteError(404, 'not_found');
    const result = statements.products.update.run(
      normalizeProductName(body.name ?? current.name),
      normalizeBrandName(body.brand === undefined ? current.brand : body.brand),
      body.unit ?? current.unit,
      trimOrNull(body.barcode === undefined ? current.barcode : body.barcode),
      body.per100?.kcal ?? current.kcal_per100,
      body.per100?.protein ?? current.protein_per100,
      body.per100?.carbs ?? current.carbs_per100,
      body.per100?.fat ?? current.fat_per100,
      userId,
      productId,
    );
    if (result.changes === 0) throw new WriteError(404, 'not_found');
    const row = statements.products.selectById.get(userId, productId) as ProductRow | undefined;
    if (row === undefined) throw new WriteError(404, 'not_found');
    return rowToProduct(row);
  })();
  log.info('product updated', { userId, productId: product.id });
  return product;
}

export function deleteProduct(userId: number, productId: number): {
  ok: true;
  product_id: number;
  deleted_entry_count: number;
} {
  const deletedEntryCount = db.transaction(() => {
    // Check ownership before deleting entries or cleaning up groups: an unknown
    // or foreign product must never cause changes, including incidental cleanup.
    if (statements.products.ownedByUser.get(userId, productId) === undefined) {
      throw new WriteError(404, 'not_found');
    }
    const deletedEntries = statements.entries.deleteForProduct.run(userId, productId);
    statements.entryGroups.deleteTooSmallForUser.run(userId, userId);
    const result = statements.products.delete.run(userId, productId);
    if (result.changes === 0) throw new WriteError(404, 'not_found');
    return deletedEntries.changes;
  })();
  log.info('product deleted', { userId, productId });
  return { ok: true, product_id: productId, deleted_entry_count: deletedEntryCount };
}
