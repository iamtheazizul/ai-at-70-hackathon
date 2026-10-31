import type { Catalog, PastTripItem, Product } from "./types";

/** Unverified sample rows for the demo and tests. Not a surveyed store map. */
export const DEMO_NOTE = "Demonstration data. Not a surveyed store map.";

export const demoStore = {
  id: 1,
  name: "Sample Store (not a surveyed map)",
  note: DEMO_NOTE,
};

export const demoProducts: Product[] = [
  { id: 1, name: "Orange juice" },
  { id: 2, name: "Green yogurt" },
  { id: 3, name: "Chickpeas" },
  { id: 4, name: "Whole milk" },
  { id: 5, name: "Oat milk" },
  { id: 6, name: "Bread" },
  { id: 7, name: "Bananas" },
  { id: 8, name: "Eggs" },
  { id: 9, name: "Apple juice" },
  { id: 10, name: "Plain yogurt" },
];

export const demoCatalog: Catalog = {
  storeId: demoStore.id,
  products: demoProducts,
  synonyms: [
    { productId: 1, phrase: "OJ" },
    { productId: 1, phrase: "orange juice" },
    { productId: 2, phrase: "the green yogurt" },
    { productId: 2, phrase: "green yogurt" },
    { productId: 3, phrase: "garbanzo beans" },
    { productId: 3, phrase: "garbanzo" },
  ],
  locations: [
    { storeId: 1, productId: 1, aisle: "Aisle 6, drinks" },
    { storeId: 1, productId: 2, aisle: "Aisle 4, dairy" },
    { storeId: 1, productId: 3, aisle: "Aisle 5, tinned" },
    { storeId: 1, productId: 4, aisle: "Aisle 4, dairy" },
    { storeId: 1, productId: 5, aisle: "Aisle 4, dairy" },
    { storeId: 1, productId: 6, aisle: "Aisle 2, bakery" },
    { storeId: 1, productId: 7, aisle: "Aisle 1, produce" },
    { storeId: 1, productId: 8, aisle: "Aisle 4, dairy" },
    { storeId: 1, productId: 9, aisle: "Aisle 6, drinks" },
    { storeId: 1, productId: 10, aisle: "Aisle 4, dairy" },
  ],
  rules: [
    { storeId: 1, productId: 1, substituteProductId: 9 },
    { storeId: 1, productId: 2, substituteProductId: 10 },
  ],
};

export const demoPastItems: PastTripItem[] = [
  { tripId: 1, productId: 4, status: "found" },
  { tripId: 1, productId: 6, status: "found" },
  { tripId: 1, productId: 1, status: "found" },
  { tripId: 1, productId: 7, status: "found" },
  { tripId: 2, productId: 4, status: "found" },
  { tripId: 2, productId: 6, status: "found" },
  { tripId: 2, productId: 1, status: "found" },
  { tripId: 2, productId: 2, status: "found" },
  { tripId: 3, productId: 4, status: "found" },
  { tripId: 3, productId: 6, status: "found" },
  { tripId: 3, productId: 8, status: "found" },
  { tripId: 3, productId: 1, status: "found" },
];
