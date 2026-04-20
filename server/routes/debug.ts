// GET /debug — unauthed HTML dump of every user + every product.
// Read-only, no secrets exposed (session tokens + magic-links are never selected).
// This is a deliberate carve-out from the per-user isolation invariant documented
// in CLAUDE.md: the queries here intentionally bypass user_id/created_by scoping.
// Keep this file self-contained so the cross-user reads stay isolated from
// statements.ts (which is otherwise the allowlist of sanctioned cross-user reads).

import { Router } from 'express';
import { db } from '../db.js';

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

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>kcal · debug</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #1d2021;
      color: #ebdbb2;
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    h1 { font-size: 18px; margin: 0 0 4px; color: #fabd2f; }
    h2 { font-size: 15px; margin: 32px 0 8px; color: #83a598; }
    .count { color: #928374; font-size: 12px; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 8px;
      background: #282828;
    }
    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid #3c3836;
      white-space: nowrap;
    }
    th {
      background: #32302f;
      color: #d3869b;
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    tr:hover td { background: #32302f; }
    td.null { color: #504945; font-style: italic; }
    .empty { color: #928374; padding: 12px 0; }
  </style>
</head>
<body>
  <h1>kcal · debug</h1>
  <div class="count">generated ${escapeHtml(fmtDate(Date.now()))}</div>

  <h2>users <span class="count">(${users.length})</span></h2>
  ${
    users.length === 0
      ? '<div class="empty">no users</div>'
      : `<table>
    <thead><tr><th>id</th><th>email</th><th>kcal</th><th>protein</th><th>carbs</th><th>fat</th><th>created_at</th></tr></thead>
    <tbody>${userRows}</tbody>
  </table>`
  }

  <h2>products <span class="count">(${products.length})</span></h2>
  ${
    products.length === 0
      ? '<div class="empty">no products</div>'
      : `<table>
    <thead><tr><th>id</th><th>name</th><th>brand</th><th>unit</th><th>barcode</th><th>kcal/100</th><th>protein/100</th><th>carbs/100</th><th>fat/100</th><th>temp?</th><th>created_by</th><th>created_at</th></tr></thead>
    <tbody>${productRows}</tbody>
  </table>`
  }
</body>
</html>`;

  res.type('html').send(html);
});
