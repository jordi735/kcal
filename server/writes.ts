// Mutations shared by REST routes and MCP tools. Callers validate their own
// input and resolve userId from verified credentials. Ownership checks, writes,
// and follow-up reads stay in one transaction so failures leave no partial work.

import { normalizeBrandName, normalizeProductName } from '../shared/normalize.js';
import { isEntryAmount, isLocalDate, parseEntryGroupName } from '../shared/constraints.js';
import { db } from './db.js';
import { isPositiveInt } from './guards.js';
import { log } from './log.js';
import { readGroupEntries, rowToEntry, rowToEntryGroup, rowToProduct } from './reads.js';
import { statements } from './statements.js';
import { trimOrNull } from './util.js';
import type {
  EntryGroupRow, EntryJoinRow, EntryMembershipRow, EntryUpdate, EntryWithMacros,
  McpEntryGroupResult, McpUngroupResult, McpEntryGroupDeleteResult,
  NewEntryBody, NewProductBody, Product, ProductPatch, ProductRow,
} from './types.js';

export class WriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'WriteError';
  }
}

export function createEntry(userId: number, body: NewEntryBody, savedOnly = false): EntryWithMacros {
  if (!isEntryAmount(body.grams)) throw new WriteError(400, 'invalid_entry');
  const entry = db.transaction(() => {
    const product = statements.products.selectById.get(userId, body.product_id) as ProductRow | undefined;
    if (product === undefined) throw new WriteError(404, 'product_not_found');
    if (savedOnly && product.is_temp !== 0) throw new WriteError(400, 'product_not_loggable');
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
  // Legacy stored amounts stay readable and taggable. The current amount rule
  // applies only when the caller supplies a replacement amount.
  if (body.grams !== undefined && !isEntryAmount(body.grams)) {
    throw new WriteError(400, 'invalid_entry');
  }
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

function requireEntryGroup(userId: number, groupId: number): EntryGroupRow {
  if (!isPositiveInt(groupId)) throw new WriteError(400, 'invalid_id');
  const group = statements.entryGroups.selectById.get(userId, groupId) as EntryGroupRow | undefined;
  if (group === undefined) throw new WriteError(404, 'not_found');
  return group;
}

export function createEntryGroup(
  userId: number, rawName: string, entryIds: number[],
): Omit<McpEntryGroupResult, 'user_id'> {
  const name = parseEntryGroupName(rawName);
  if (name === null || entryIds.length < 2 || !entryIds.every(isPositiveInt)
    || new Set(entryIds).size !== entryIds.length) {
    throw new WriteError(400, 'invalid_group');
  }
  const result = db.transaction(() => {
    const members = entryIds.map((id) => {
      const member = statements.entries.selectMembershipById.get(userId, id) as EntryMembershipRow | undefined;
      if (member === undefined) throw new WriteError(404, 'not_found');
      return member;
    });
    const first = members[0];
    if (first === undefined || !isLocalDate(first.local_date)
      || members.some((member) => member.local_date !== first.local_date)) {
      throw new WriteError(400, 'invalid_group');
    }
    if (members.some((member) => member.group_id !== null)) {
      throw new WriteError(409, 'already_grouped');
    }

    const inserted = statements.entryGroups.insert.run(userId, first.local_date, name, Date.now());
    const groupId = Number(inserted.lastInsertRowid);
    for (const id of entryIds) {
      if (statements.entries.assignGroup.run(groupId, userId, id).changes !== 1) {
        throw new WriteError(409, 'already_grouped');
      }
    }
    const group = requireEntryGroup(userId, groupId);
    return { group: rowToEntryGroup(group), entries: readGroupEntries(userId, groupId) };
  })();
  log.info('entry group created', {
    userId, groupId: result.group.id, date: result.group.local_date, entryCount: result.entries.length,
  });
  return result;
}

export function updateEntryGroup(
  userId: number, groupId: number, rawName: string,
): Omit<McpEntryGroupResult, 'user_id'> {
  const name = parseEntryGroupName(rawName);
  if (name === null) throw new WriteError(400, 'invalid_group');
  const result = db.transaction(() => {
    requireEntryGroup(userId, groupId);
    if (statements.entryGroups.updateName.run(name, userId, groupId).changes !== 1) {
      throw new WriteError(404, 'not_found');
    }
    return {
      group: rowToEntryGroup(requireEntryGroup(userId, groupId)),
      entries: readGroupEntries(userId, groupId),
    };
  })();
  log.info('entry group renamed', { userId, groupId });
  return result;
}

export function setEntryGroupTagged(
  userId: number, groupId: number, tagged: boolean,
): Omit<McpEntryGroupResult, 'user_id'> {
  if (typeof tagged !== 'boolean') throw new WriteError(400, 'invalid_group');
  const result = db.transaction(() => {
    const group = requireEntryGroup(userId, groupId);
    statements.entries.updateTaggedForGroup.run(tagged ? 1 : 0, userId, groupId);
    return { group: rowToEntryGroup(group), entries: readGroupEntries(userId, groupId) };
  })();
  log.info('entry group tagged', { userId, groupId, tagged });
  return result;
}

export function ungroupEntries(userId: number, groupId: number): Omit<McpUngroupResult, 'user_id'> {
  const entries = db.transaction(() => {
    requireEntryGroup(userId, groupId);
    const children = readGroupEntries(userId, groupId);
    if (statements.entryGroups.delete.run(userId, groupId).changes !== 1) {
      throw new WriteError(404, 'not_found');
    }
    // The FK clears group_id. Re-read the former children in the original ID
    // order to return their persisted, now-ungrouped state.
    return children.map((child) => {
      const row = statements.entries.selectById.get(userId, child.id) as EntryJoinRow | undefined;
      if (row === undefined) throw new WriteError(404, 'not_found');
      return rowToEntry(row);
    });
  })();
  log.info('entry group dissolved', { userId, groupId });
  return { ok: true, group_id: groupId, entries };
}

export function deleteEntryGroup(
  userId: number, groupId: number,
): Omit<McpEntryGroupDeleteResult, 'user_id'> {
  const deletedEntryIds = db.transaction(() => {
    requireEntryGroup(userId, groupId);
    const children = readGroupEntries(userId, groupId);
    statements.entries.deleteForGroup.run(userId, groupId);
    if (statements.entryGroups.delete.run(userId, groupId).changes !== 1) {
      throw new WriteError(404, 'not_found');
    }
    return children.map((child) => child.id);
  })();
  log.info('entry group deleted', { userId, groupId, entryCount: deletedEntryIds.length });
  return { ok: true, group_id: groupId, deleted_entry_ids: deletedEntryIds };
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
