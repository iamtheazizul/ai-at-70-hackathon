// Shared domain types. Pure data — no platform APIs, no I/O.

export type NodeId = number;
export type AisleId = number;
export type SectionId = number;
export type ProductId = number;
export type EntryId = number;

export type NodeKind =
  | 'entrance'
  | 'aisle_end'
  | 'intersection'
  | 'checkout'
  | 'service_desk'
  | 'landmark';

export interface StoreNode {
  id: NodeId;
  kind: NodeKind;
  /** Shopper-facing, e.g. "Aisle 7, bakery end". Instructions are built from these. */
  label: string;
  aisleId?: AisleId;
  photoPath?: string;
}

export interface Edge {
  a: NodeId;
  b: NodeId;
  metres: number;
  measured: boolean;
}

export type SignVariantKind = 'number' | 'category';

export interface SignVariant {
  variant: string;
  kind: SignVariantKind;
}

export interface Aisle {
  id: AisleId;
  label: string;
  /** `Section.side` is defined relative to this end, never to the shopper's heading. */
  referenceEndNode: NodeId;
  ends: NodeId[];
  signVariants: SignVariant[];
  isCold: boolean;
  /** Exempt from the ambient-before-cold ordering constraint (set during survey). */
  coldRelaxed: boolean;
}

export interface Section {
  id: SectionId;
  aisleId: AisleId;
  side: 'left' | 'right';
  bay: number;
  accessNode: NodeId;
}

export interface Product {
  id: ProductId;
  name: string;
  brand?: string;
  variant?: string;
  sizeText?: string;
  category: string;
  photoPath?: string;
}

export type LocationSource = 'survey' | 'staff' | 'observation_reviewed';
export type ReviewStatus = 'authoritative' | 'provisional';

export interface ProductLocation {
  productId: ProductId;
  sectionId: SectionId;
  shelfLevel?: 'low' | 'mid' | 'eye' | 'high';
  source: LocationSource;
  /** ISO date. Drives the freshness check and cautious wording in the UI. */
  verifiedOn: string;
  reviewStatus: ReviewStatus;
}

/** A sealed, versioned snapshot. An active trip pins one of these and never swaps it. */
export interface StorePack {
  packId: string;
  packVersion: number;
  layoutVersion: string;
  storeName: string;
  nodes: StoreNode[];
  edges: Edge[];
  aisles: Aisle[];
  sections: Section[];
  products: Product[];
  /** barcode -> product. Resolution goes through here or the code is unknown. */
  barcodes: Record<string, ProductId>;
  locations: ProductLocation[];
  entranceNode: NodeId;
  checkoutNode: NodeId;
}

/** A requested item. `acceptedProducts` empty means the request is category-level. */
export interface ListEntry {
  id: EntryId;
  requestText: string;
  quantity: number;
  acceptedProducts: ProductId[];
  substitutesAllowed: boolean;
}
