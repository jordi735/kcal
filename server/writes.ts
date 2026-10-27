// Mutations shared by REST routes and MCP tools. Callers validate their own
// input and resolve userId from verified credentials. Ownership checks, writes,
// and follow-up reads stay in one transaction so failures leave no partial work.

import { parseProductBarcode, parseProductBrand, parseProductName, parseProductText } from '../shared/productText.js';
import { isEntryAmount, isLocalDate, isLocalTime, MAX_ENTRY_GROUP_MEMBERS, parseEntryGroupName } from '../shared/constraints.js';
import { db } from './db.js';
import { WriteError } from './errors.js';
import { isPositiveInt } from './guards.js';
import { rowToProduct } from './products.js';
import { readGroupEntries, rowToEntry, rowToEntryGroup, sumMacros } from './reads.js';
import { statements } from './statements.js';
import type {
  EntryGroupRow, EntryJoinRow, EntryMembershipRow, EntryUpdate, EntryWithMacros,
  EntryGroupResult, UngroupResult, EntryGroupDeleteResult, EntryGroup, Macros,
  NewEntryBody, NewProductBody, Product, ProductPatch,
} from './types.js';

export function createEntry(userId: number, body: NewEntryBody, savedOnly = false): EntryWithMacros {
  if (!isEntryAmount(body.amount) || !isLocalDate(body.local_date) || !isLocalTime(body.local_time)) {
    throw new WriteError(400, 'invalid_entry');
  }
  const entry = db.transaction(() => {
    const product = statements.products.selectById.get(userId, body.product_id);
    if (product === undefined) throw new WriteError(404, 'product_not_found');
    if (savedOnly && product.is_temp !== 0) throw new WriteError(400, 'product_not_loggable');
    const inserted = statements.entries.insert.run(
      userId,
      body.product_id,
      body.amount,
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
  return entry;
}

// The MCP receipt adds an outer transaction; nested helpers use savepoints.
export function createEntries(userId: number, body: {
  entries: { product_id: number; amount: number }[];
  local_date: string;
  local_time: string;
  group_name?: string;
}): { entries: EntryWithMacros[]; group: EntryGroup | null; totals: Macros } {
  if (body.entries.length < 1 || body.entries.length > 50) throw new WriteError(400, 'invalid_entries');
  if (body.group_name !== undefined && (body.entries.length < 2 || parseEntryGroupName(body.group_name) === null)) {
    throw new WriteError(400, 'invalid_group');
  }
  return db.transaction(() => {
    let entries = body.entries.map((item) => createEntry(userId, {
      ...item, local_date: body.local_date, local_time: body.local_time,
    }, true));
    let group: EntryGroup | null = null;
    if (body.group_name !== undefined) {
      const grouped = createEntryGroup(userId, body.group_name, entries.map((entry) => entry.id));
      group = grouped.group;
      entries = grouped.entries;
    }
    return { entries, group, totals: sumMacros(entries.map((entry) => entry.macros)) };
  })();
}

export function updateEntry(userId: number, entryId: number, body: EntryUpdate): EntryWithMacros {
  // Legacy stored amounts stay readable and taggable. The current amount rule
  // applies only when the caller supplies a replacement amount.
  if ((body.amount !== undefined && !isEntryAmount(body.amount))
    || (body.product_id !== undefined && !isPositiveInt(body.product_id))
    || (body.local_time !== undefined && !isLocalTime(body.local_time))
    || (body.tagged !== undefined && typeof body.tagged !== 'boolean')
    || [body.amount, body.product_id, body.local_time, body.tagged].every((value) => value === undefined)) {
    throw new WriteError(400, 'invalid_entry');
  }
  const entry = db.transaction(() => {
    const current = statements.entries.selectById.get(userId, entryId) as EntryJoinRow | undefined;
    if (current === undefined) throw new WriteError(404, 'not_found');
    if (body.product_id !== undefined) {
      const product = statements.products.selectById.get(userId, body.product_id);
      if (product === undefined) throw new WriteError(404, 'product_not_found');
      if (product.is_temp !== 0) throw new WriteError(400, 'product_not_loggable');
      if (rowToProduct(product).unit !== rowToEntry(current).product.unit && body.amount === undefined) {
        throw new WriteError(400, 'amount_required_for_unit_change');
      }
    }
    statements.entries.update.run(body.product_id ?? null, body.amount ?? null, body.local_time ?? null,
      body.tagged === undefined ? null : body.tagged ? 1 : 0, userId, entryId);
    const row = statements.entries.selectById.get(userId, entryId) as EntryJoinRow | undefined;
    if (row === undefined) throw new WriteError(404, 'not_found');
    return rowToEntry(row);
  })();
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
): EntryGroupResult {
  const name = parseEntryGroupName(rawName);
  if (name === null || entryIds.length < 2 || entryIds.length > MAX_ENTRY_GROUP_MEMBERS || !entryIds.every(isPositiveInt)
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
  return result;
}

export function updateEntryGroup(
  userId: number, groupId: number, rawName: string,
): EntryGroupResult {
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
  return result;
}

export function setEntryGroupTagged(
  userId: number, groupId: number, tagged: boolean,
): EntryGroupResult {
  if (typeof tagged !== 'boolean') throw new WriteError(400, 'invalid_group');
  const result = db.transaction(() => {
    const group = requireEntryGroup(userId, groupId);
    statements.entries.updateTaggedForGroup.run(tagged ? 1 : 0, userId, groupId);
    return { group: rowToEntryGroup(group), entries: readGroupEntries(userId, groupId) };
  })();
  return result;
}

export function ungroupEntries(userId: number, groupId: number): UngroupResult {
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
  return { ok: true, group_id: groupId, entries };
}

export function deleteEntryGroup(
  userId: number, groupId: number,
): EntryGroupDeleteResult {
  const deletedEntryIds = db.transaction(() => {
    requireEntryGroup(userId, groupId);
    const children = readGroupEntries(userId, groupId);
    statements.entries.deleteForGroup.run(userId, groupId);
    if (statements.entryGroups.delete.run(userId, groupId).changes !== 1) {
      throw new WriteError(404, 'not_found');
    }
    return children.map((child) => child.id);
  })();
  return { ok: true, group_id: groupId, deleted_entry_ids: deletedEntryIds };
}

export function createProduct(userId: number, body: NewProductBody): Product {
  const text = parseProductText(body);
  if (text === null) throw new WriteError(400, 'invalid_product');
  const product = db.transaction(() => {
    const inserted = statements.products.insert.run(
      text.name,
      text.brand,
      body.unit,
      text.barcode,
      body.per100.kcal,
      body.per100.protein,
      body.per100.carbs,
      body.per100.fat,
      body.is_temp ? 1 : 0,
      userId,
      Date.now(),
    );
    const row = statements.products.selectById.get(userId, Number(inserted.lastInsertRowid));
    if (row === undefined) throw new WriteError(500, 'insert_failed');
    return rowToProduct(row);
  })();
  return product;
}

export function updateProduct(userId: number, productId: number, body: ProductPatch): Product {
  const product = db.transaction(() => {
    const current = statements.products.selectById.get(userId, productId);
    if (current === undefined) throw new WriteError(404, 'not_found');
    // Omitted metadata bypasses normalization so legacy values stay unchanged.
    const name = body.name === undefined ? { value: current.name } : parseProductName(body.name);
    const brand = body.brand === undefined ? { value: current.brand } : parseProductBrand(body.brand);
    const barcode = body.barcode === undefined ? { value: current.barcode } : parseProductBarcode(body.barcode);
    if (name === null || brand === null || barcode === null) {
      throw new WriteError(400, 'invalid_product');
    }
    const result = statements.products.update.run(
      name.value,
      brand.value,
      body.unit ?? current.unit,
      barcode.value,
      body.per100?.kcal ?? current.kcal_per100,
      body.per100?.protein ?? current.protein_per100,
      body.per100?.carbs ?? current.carbs_per100,
      body.per100?.fat ?? current.fat_per100,
      userId,
      productId,
    );
    if (result.changes === 0) throw new WriteError(404, 'not_found');
    const row = statements.products.selectById.get(userId, productId);
    if (row === undefined) throw new WriteError(404, 'not_found');
    return rowToProduct(row);
  })();
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
  return { ok: true, product_id: productId, deleted_entry_count: deletedEntryCount };
}
