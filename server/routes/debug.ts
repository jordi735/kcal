// GET /debug — unauthed HTML dump of every user + every product.
// Read-only, no secrets exposed (session tokens + login codes are never selected).
// This is a deliberate carve-out from the per-user isolation invariant documented
// in CLAUDE.md: the queries here intentionally bypass user_id/created_by scoping.
// Keep this file self-contained so the cross-user reads stay isolated from
// statements.ts (which is otherwise the allowlist of sanctioned cross-user reads).

import { Router } from 'express';
import { db } from '../db.js';
import { debugPageHtml, render } from '../templates.js';

export const debugRouter: Router = Router();

type DebugUserRow = {
  id: number;
  email: string;
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
  created_at: number;
};

type DebugProductRow = {
  id: number;
  name: string;
  brand: string | null;
  unit: string;
  barcode: string | null;
  kcal_per100: number;
  protein_per100: number;
  carbs_per100: number;
  fat_per100: number;
  is_temp: number;
  created_by: number;
  created_at: number;
};

const selectAllUsers = db.prepare(`
  SELECT id, email, goal_kcal, goal_protein, goal_carbs, goal_fat, created_at
  FROM users
  ORDER BY id ASC
`);

const selectAllProducts = db.prepare(`
  SELECT id, name, brand, unit, barcode,
         kcal_per100, protein_per100, carbs_per100, fat_per100,
         is_temp, created_by, created_at
  FROM products
  ORDER BY id ASC
`);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cell(v: string | number | null): string {
  if (v === null) return '<td class="null">—</td>';
  return `<td>${escapeHtml(String(v))}</td>`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

debugRouter.get('/', (_req, res) => {
  const users = selectAllUsers.all() as DebugUserRow[];
  const products = selectAllProducts.all() as DebugProductRow[];

  const userRows = users
    .map(
      (u) =>
        `<tr>${cell(u.id)}${cell(u.email)}${cell(u.goal_kcal)}${cell(u.goal_protein)}${cell(u.goal_carbs)}${cell(u.goal_fat)}${cell(fmtDate(u.created_at))}</tr>`,
    )
    .join('');

  const productRows = products
    .map(
      (p) =>
        `<tr>${cell(p.id)}${cell(p.name)}${cell(p.brand)}${cell(p.unit)}${cell(p.barcode)}${cell(p.kcal_per100)}${cell(p.protein_per100)}${cell(p.carbs_per100)}${cell(p.fat_per100)}${cell(p.is_temp ? 'yes' : 'no')}${cell(p.created_by)}${cell(fmtDate(p.created_at))}</tr>`,
    )
    .join('');

  const usersSection =
    users.length === 0
      ? '<div class="empty">no users</div>'
      : `<table>
    <thead><tr><th>id</th><th>email</th><th>kcal</th><th>protein</th><th>carbs</th><th>fat</th><th>created_at</th></tr></thead>
    <tbody>${userRows}</tbody>
  </table>`;

  const productsSection =
    products.length === 0
      ? '<div class="empty">no products</div>'
      : `<table>
    <thead><tr><th>id</th><th>name</th><th>brand</th><th>unit</th><th>barcode</th><th>kcal/100</th><th>protein/100</th><th>carbs/100</th><th>fat/100</th><th>temp?</th><th>created_by</th><th>created_at</th></tr></thead>
    <tbody>${productRows}</tbody>
  </table>`;

  const html = render(debugPageHtml, {
    generatedAt: escapeHtml(fmtDate(Date.now())),
    usersCount: users.length,
    productsCount: products.length,
    usersSection,
    productsSection,
  });

  res.type('html').send(html);
});
