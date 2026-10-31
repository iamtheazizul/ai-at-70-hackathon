export interface Product {
  id: number;
  name: string;
}

export interface Synonym {
  productId: number;
  phrase: string;
}

export interface Location {
  storeId: number;
  productId: number;
  aisle: string;
}

export interface SubstituteRule {
  storeId: number;
  productId: number;
  substituteProductId: number;
}

export interface Catalog {
  storeId: number;
  products: Product[];
  synonyms: Synonym[];
  locations: Location[];
  rules: SubstituteRule[];
}

export interface PastTripItem {
  tripId: number;
  productId: number;
  status: "open" | "found" | "skipped" | "missing" | "substituted";
}

export type CommandId = "next" | "repeat" | "where" | "skip" | "pause" | "done";

export type ItemStatus = "open" | "found" | "skipped" | "missing" | "substituted";

export interface SummaryItem {
  name: string;
  status: ItemStatus;
  substituteName: string | null;
}
