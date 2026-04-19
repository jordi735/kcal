// Seed data + helpers

const SEED_PRODUCTS = [
  { id: 'p1', name: 'Greek Yogurt 0%', brand: 'Fage', per100: { kcal: 59, p: 10.3, c: 3.6, f: 0.4 } },
  { id: 'p2', name: 'Oatmeal', brand: 'Quaker', per100: { kcal: 379, p: 13.2, c: 67.7, f: 6.5 } },
  { id: 'p3', name: 'Banana', brand: null, per100: { kcal: 89, p: 1.1, c: 22.8, f: 0.3 } },
  { id: 'p4', name: 'Chicken Breast', brand: null, per100: { kcal: 165, p: 31, c: 0, f: 3.6 } },
  { id: 'p5', name: 'White Rice', brand: 'Uncle Ben\'s', per100: { kcal: 130, p: 2.7, c: 28, f: 0.3 } },
  { id: 'p6', name: 'Almonds', brand: null, per100: { kcal: 579, p: 21, c: 21.6, f: 49.9 } },
  { id: 'p7', name: 'Whey Isolate', brand: 'MyProtein', per100: { kcal: 375, p: 90, c: 2.5, f: 1 } },
  { id: 'p8', name: 'Olive Oil', brand: null, per100: { kcal: 884, p: 0, c: 0, f: 100 } },
  { id: 'p9', name: 'Eggs', brand: null, per100: { kcal: 155, p: 13, c: 1.1, f: 11 } },
  { id: 'p10', name: 'Skyr Vanilla', brand: 'Arla', per100: { kcal: 72, p: 11, c: 6, f: 0.2 } },
  { id: 'p11', name: 'Salmon Fillet', brand: null, per100: { kcal: 208, p: 20, c: 0, f: 13 } },
  { id: 'p12', name: 'Sourdough Bread', brand: null, per100: { kcal: 250, p: 9, c: 48, f: 1.5 } },
];

// Today's entries (for the currently-selected day)
const SEED_ENTRIES = [
  { id: 'e1', productId: 'p1', grams: 200, time: '08:14', meal: 'Breakfast' },
  { id: 'e2', productId: 'p2', grams: 60, time: '08:15', meal: 'Breakfast' },
  { id: 'e3', productId: 'p3', grams: 120, time: '08:16', meal: 'Breakfast' },
  { id: 'e4', productId: 'p4', grams: 180, time: '12:48', meal: 'Lunch' },
  { id: 'e5', productId: 'p5', grams: 200, time: '12:49', meal: 'Lunch' },
  { id: 'e6', productId: 'p8', grams: 10, time: '12:50', meal: 'Lunch' },
];

const DEFAULT_GOALS = { kcal: 2400, p: 180, c: 240, f: 80 };

// Compute totals from entries
function computeTotals(entries, products) {
  const total = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const e of entries) {
    let per100;
    if (e.tempProduct) {
      per100 = e.tempProduct.per100;
    } else {
      const prod = products.find(p => p.id === e.productId);
      if (!prod) continue;
      per100 = prod.per100;
    }
    const factor = e.grams / 100;
    total.kcal += per100.kcal * factor;
    total.p += per100.p * factor;
    total.c += per100.c * factor;
    total.f += per100.f * factor;
  }
  return total;
}

function entryMacros(entry, products) {
  let per100;
  if (entry.tempProduct) per100 = entry.tempProduct.per100;
  else {
    const prod = products.find(p => p.id === entry.productId);
    if (!prod) return { kcal: 0, p: 0, c: 0, f: 0 };
    per100 = prod.per100;
  }
  const f = entry.grams / 100;
  return {
    kcal: per100.kcal * f,
    p: per100.p * f,
    c: per100.c * f,
    f: per100.f * f,
  };
}

function entryName(entry, products) {
  if (entry.tempProduct) return entry.tempProduct.name;
  const prod = products.find(p => p.id === entry.productId);
  return prod ? prod.name : 'Unknown';
}

function entryBrand(entry, products) {
  if (entry.tempProduct) return entry.tempProduct.brand;
  const prod = products.find(p => p.id === entry.productId);
  return prod ? prod.brand : null;
}

// Week helpers
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekDays(monday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

Object.assign(window, {
  SEED_PRODUCTS, SEED_ENTRIES, DEFAULT_GOALS,
  computeTotals, entryMacros, entryName, entryBrand,
  getWeekNumber, getMonday, weekDays, isSameDay,
  DAY_LETTERS, MONTH_NAMES,
});
