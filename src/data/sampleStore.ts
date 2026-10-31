import type { Aisle, Edge, ListEntry, Product, ProductLocation, Section, StoreNode, StorePack } from '../core/types';

/**
 * A fixture store for tests and the demo: eight aisles between a front and a
 * back walkway, entrance and checkout at the front-left. Aisles 7-8 are frozen.
 *
 * This is NOT survey data. A real pack is built from the Supabase master data
 * by the pack tool and carries digests, a layout version and verification
 * dates. This exists so the core can be exercised without a store visit.
 */

const AISLE_COUNT = 8;
const COLD_AISLES = new Set([7, 8]);

const AISLE_CATEGORY: Record<number, string> = {
  1: 'PRODUCE',
  2: 'BAKERY',
  3: 'CEREAL',
  4: 'PASTA',
  5: 'TINNED',
  6: 'DRINKS',
  7: 'FROZEN',
  8: 'ICE CREAM',
};

const frontNode = (i: number): number => 10 + i;
const backNode = (i: number): number => 20 + i;

/**
 * Top-down geometry, metres. Origin is the front end of aisle 1; x runs along
 * the front walkway, y from the front walkway towards the back of the store.
 *
 * The edge lengths below are derived from these constants, so in this fixture
 * every edge equals the straight-line distance between its nodes exactly. Real
 * survey data will not be that tidy — walkways jog, aisles are not perfectly
 * parallel, and paced distances carry a few percent of error. That is why
 * tests/geometry.test.ts checks agreement within a tolerance rather than
 * asserting equality.
 */
const AISLE_PITCH_M = 6;
const AISLE_LENGTH_M = 25;
const ENTRANCE_SETBACK_M = 5;
const CHECKOUT_OFFSET_M = 4;

const aisleX = (i: number): number => AISLE_PITCH_M * (i - 1);

const nodes: StoreNode[] = [
  {
    id: 1,
    kind: 'entrance',
    label: 'Main entrance',
    xMetres: 0,
    yMetres: -ENTRANCE_SETBACK_M,
    photoPath: 'photos/entrance.webp',
  },
  { id: 2, kind: 'checkout', label: 'Checkouts', xMetres: -CHECKOUT_OFFSET_M, yMetres: 0 },
];
for (let i = 1; i <= AISLE_COUNT; i++) {
  nodes.push({
    id: frontNode(i),
    kind: 'aisle_end',
    label: `Aisle ${i}, front end`,
    aisleId: i,
    xMetres: aisleX(i),
    yMetres: 0,
    photoPath: `photos/aisle-${i}-front.webp`,
  });
  nodes.push({
    id: backNode(i),
    kind: 'aisle_end',
    label: `Aisle ${i}, back end`,
    aisleId: i,
    xMetres: aisleX(i),
    yMetres: AISLE_LENGTH_M,
    photoPath: `photos/aisle-${i}-back.webp`,
  });
}

const edges: Edge[] = [
  { a: 1, b: frontNode(1), metres: ENTRANCE_SETBACK_M, measured: true },
  { a: 2, b: frontNode(1), metres: CHECKOUT_OFFSET_M, measured: true },
];
for (let i = 1; i < AISLE_COUNT; i++) {
  edges.push({ a: frontNode(i), b: frontNode(i + 1), metres: AISLE_PITCH_M, measured: true });
  edges.push({ a: backNode(i), b: backNode(i + 1), metres: AISLE_PITCH_M, measured: true });
}
for (let i = 1; i <= AISLE_COUNT; i++) {
  edges.push({ a: frontNode(i), b: backNode(i), metres: AISLE_LENGTH_M, measured: true });
}

const aisles: Aisle[] = [];
for (let i = 1; i <= AISLE_COUNT; i++) {
  aisles.push({
    id: i,
    label: String(i),
    referenceEndNode: frontNode(i),
    ends: [frontNode(i), backNode(i)],
    signVariants: [
      { variant: String(i), kind: 'number' },
      { variant: `AISLE ${i}`, kind: 'number' },
      { variant: AISLE_CATEGORY[i]!, kind: 'category' },
    ],
    isCold: COLD_AISLES.has(i),
    coldRelaxed: false,
  });
}

const sections: Section[] = [];
for (let i = 1; i <= AISLE_COUNT; i++) {
  sections.push({ id: i * 10 + 1, aisleId: i, side: 'left', bay: 1, accessNode: frontNode(i) });
  sections.push({ id: i * 10 + 2, aisleId: i, side: 'right', bay: 2, accessNode: backNode(i) });
}

interface Seed {
  id: number;
  name: string;
  brand: string;
  variant?: string;
  sizeText?: string;
  aisle: number;
  bay: 1 | 2;
  barcode: string;
}

const SEEDS: Seed[] = [
  { id: 1, name: 'Bananas', brand: 'Loose', aisle: 1, bay: 1, barcode: '4011000000001' },
  { id: 2, name: 'Baby spinach', brand: 'Olivia', sizeText: '5 oz', aisle: 1, bay: 2, barcode: '4011000000002' },
  { id: 3, name: 'Sourdough loaf', brand: 'Bakehouse', aisle: 2, bay: 1, barcode: '4011000000003' },
  { id: 4, name: 'Bagels', brand: 'Bakehouse', variant: 'Plain', sizeText: '6 ct', aisle: 2, bay: 1, barcode: '4011000000004' },
  { id: 5, name: 'Bran flakes', brand: 'Harvest', variant: 'Original', sizeText: '18 oz', aisle: 3, bay: 1, barcode: '4011000000005' },
  // Deliberate near-twin of 5: same brand and line, different size. This is the
  // pair the shelf-finding experiment has to tell apart.
  { id: 6, name: 'Bran flakes', brand: 'Harvest', variant: 'Original', sizeText: '24 oz', aisle: 3, bay: 1, barcode: '4011000000006' },
  { id: 7, name: 'Spaghetti', brand: 'Riva', sizeText: '1 lb', aisle: 4, bay: 2, barcode: '4011000000007' },
  { id: 8, name: 'Tomato sauce', brand: 'Riva', variant: 'Basil', sizeText: '24 oz', aisle: 4, bay: 1, barcode: '4011000000008' },
  { id: 9, name: 'Tinned chickpeas', brand: 'Pantry', sizeText: '15 oz', aisle: 5, bay: 2, barcode: '4011000000009' },
  { id: 10, name: 'Orange juice', brand: 'Grove', variant: 'No pulp', sizeText: '52 oz', aisle: 6, bay: 1, barcode: '4011000000010' },
  { id: 11, name: 'Sparkling water', brand: 'Clearspring', variant: 'Lime', sizeText: '12 ct', aisle: 6, bay: 2, barcode: '4011000000011' },
  { id: 12, name: 'Frozen peas', brand: 'Northfield', sizeText: '16 oz', aisle: 7, bay: 1, barcode: '4011000000012' },
  { id: 13, name: 'Frozen blueberries', brand: 'Northfield', sizeText: '32 oz', aisle: 7, bay: 2, barcode: '4011000000013' },
  { id: 14, name: 'Vanilla ice cream', brand: 'Creamery', sizeText: '1 qt', aisle: 8, bay: 1, barcode: '4011000000014' },
];

const products: Product[] = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  brand: s.brand,
  variant: s.variant,
  sizeText: s.sizeText,
  category: AISLE_CATEGORY[s.aisle]!,
  photoPath: `photos/prod-${String(s.id).padStart(6, '0')}.webp`,
}));

const barcodes: Record<string, number> = {};
for (const s of SEEDS) barcodes[s.barcode] = s.id;

const locations: ProductLocation[] = SEEDS.map((s) => ({
  productId: s.id,
  sectionId: s.aisle * 10 + s.bay,
  shelfLevel: 'eye',
  source: 'survey',
  verifiedOn: '2026-10-27',
  reviewStatus: 'authoritative',
}));

export const sampleStorePack: StorePack = {
  packId: 'sample-store',
  packVersion: 1,
  layoutVersion: '2026-10',
  storeName: 'Sample Store (fixture)',
  nodes,
  edges,
  aisles,
  sections,
  products,
  barcodes,
  locations,
  entranceNode: 1,
  checkoutNode: 2,
};

/** The 10-item evaluation list shape from the PRD, over the fixture catalogue. */
export const sampleList: ListEntry[] = [
  { id: 1, requestText: 'Bananas', quantity: 1, acceptedProducts: [1], substitutesAllowed: true },
  { id: 2, requestText: 'Baby spinach, 5 oz', quantity: 1, acceptedProducts: [2], substitutesAllowed: false },
  { id: 3, requestText: 'Bagels, plain, 6 ct', quantity: 1, acceptedProducts: [4], substitutesAllowed: true },
  { id: 4, requestText: 'Harvest bran flakes, 18 oz', quantity: 1, acceptedProducts: [5], substitutesAllowed: false },
  { id: 5, requestText: 'Spaghetti', quantity: 2, acceptedProducts: [7], substitutesAllowed: true },
  { id: 6, requestText: 'Tomato sauce', quantity: 1, acceptedProducts: [8], substitutesAllowed: true },
  { id: 7, requestText: 'Orange juice, no pulp', quantity: 1, acceptedProducts: [10], substitutesAllowed: true },
  { id: 8, requestText: 'Frozen peas', quantity: 1, acceptedProducts: [12], substitutesAllowed: true },
  { id: 9, requestText: 'Vanilla ice cream', quantity: 1, acceptedProducts: [14], substitutesAllowed: false },
  // No accepted products and no location: must stay visible and unrouted.
  { id: 10, requestText: 'Birthday card', quantity: 1, acceptedProducts: [], substitutesAllowed: false },
];
