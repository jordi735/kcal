// Canonical starter-product data — single source of truth for both the
// server seed script (inserted as real DB rows for new users) and the
// frontend mocks. Shape mirrors `Product.per100` so both sides import
// without remapping fields.

export type SeedProductData = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: { kcal: number; protein: number; carbs: number; fat: number };
};

export const seedProducts: readonly SeedProductData[] = [
  { name: 'Greek Yogurt 0%',  brand: 'Fage',        unit: 'g',  barcode: null, per100: { kcal: 59,  protein: 10.3, carbs: 3.6,  fat: 0.4 } },
  { name: 'Oatmeal',          brand: 'Quaker',      unit: 'g',  barcode: null, per100: { kcal: 379, protein: 13.2, carbs: 67.7, fat: 6.5 } },
  { name: 'Banana',           brand: null,          unit: 'g',  barcode: null, per100: { kcal: 89,  protein: 1.1,  carbs: 22.8, fat: 0.3 } },
  { name: 'Chicken Breast',   brand: null,          unit: 'g',  barcode: null, per100: { kcal: 165, protein: 31,   carbs: 0,    fat: 3.6 } },
  { name: 'White Rice',       brand: "Uncle Ben's", unit: 'g',  barcode: null, per100: { kcal: 130, protein: 2.7,  carbs: 28,   fat: 0.3 } },
  { name: 'Almonds',          brand: null,          unit: 'g',  barcode: null, per100: { kcal: 579, protein: 21,   carbs: 21.6, fat: 49.9 } },
  { name: 'Whey Isolate',     brand: 'MyProtein',   unit: 'g',  barcode: null, per100: { kcal: 375, protein: 90,   carbs: 2.5,  fat: 1 } },
  { name: 'Olive Oil',        brand: null,          unit: 'ml', barcode: null, per100: { kcal: 884, protein: 0,    carbs: 0,    fat: 100 } },
  { name: 'Eggs',             brand: null,          unit: 'g',  barcode: null, per100: { kcal: 155, protein: 13,   carbs: 1.1,  fat: 11 } },
  { name: 'Skyr Vanilla',     brand: 'Arla',        unit: 'g',  barcode: null, per100: { kcal: 72,  protein: 11,   carbs: 6,    fat: 0.2 } },
  { name: 'Salmon Fillet',    brand: null,          unit: 'g',  barcode: null, per100: { kcal: 208, protein: 20,   carbs: 0,    fat: 13 } },
  { name: 'Sourdough Bread',  brand: null,          unit: 'g',  barcode: null, per100: { kcal: 250, protein: 9,    carbs: 48,   fat: 1.5 } },
];
