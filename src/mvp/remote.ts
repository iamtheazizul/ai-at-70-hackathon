import type { Catalog, PastTripItem, Product } from "./types";

interface RemoteStore {
  id: number;
  name: string;
  note: string;
}

interface RemoteProduct {
  id: number;
  name: string;
}

interface RemoteSynonym {
  product_id: number;
  phrase: string;
}

interface RemoteLocation {
  store_id: number;
  product_id: number;
  aisle: string;
}

interface RemoteRule {
  store_id: number;
  product_id: number;
  substitute_product_id: number;
}

interface RemoteTripItem {
  trip_id: number;
  product_id: number | null;
  status: PastTripItem["status"];
}

export interface RemoteCatalog {
  storeName: string;
  note: string;
  catalog: Catalog;
  pastItems: PastTripItem[];
}

function headers(key: string): HeadersInit {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function getJson<T>(url: string, key: string, path: string): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: headers(key),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Supabase ${path} returned ${response.status}`);
  return (await response.json()) as T;
}

/** Read the demonstration catalog. Returns null when the project is unreachable or the schema is absent. */
export async function loadRemoteCatalog(url: string, key: string): Promise<RemoteCatalog | null> {
  if (!url || !key) return null;
  try {
    const [stores, products, synonyms, locations, rules, tripItems] = await Promise.all([
      getJson<RemoteStore[]>(url, key, "stores?select=id,name,note&limit=1"),
      getJson<RemoteProduct[]>(url, key, "products?select=id,name"),
      getJson<RemoteSynonym[]>(url, key, "synonyms?select=product_id,phrase"),
      getJson<RemoteLocation[]>(url, key, "locations?select=store_id,product_id,aisle"),
      getJson<RemoteRule[]>(url, key, "substitute_rules?select=store_id,product_id,substitute_product_id"),
      getJson<RemoteTripItem[]>(url, key, "trip_items?select=trip_id,product_id,status"),
    ]);
    const store = stores[0];
    if (!store) return null;
    const catalog: Catalog = {
      storeId: store.id,
      products: products.map((row) => ({ id: row.id, name: row.name })),
      synonyms: synonyms.map((row) => ({ productId: row.product_id, phrase: row.phrase })),
      locations: locations.map((row) => ({
        storeId: row.store_id,
        productId: row.product_id,
        aisle: row.aisle,
      })),
      rules: rules.map((row) => ({
        storeId: row.store_id,
        productId: row.product_id,
        substituteProductId: row.substitute_product_id,
      })),
    };
    const pastItems: PastTripItem[] = tripItems.flatMap((row) =>
      row.product_id == null
        ? []
        : [{ tripId: row.trip_id, productId: row.product_id, status: row.status }],
    );
    return { storeName: store.name, note: store.note, catalog, pastItems };
  } catch {
    return null;
  }
}

export function productById(products: Product[], id: number): Product | null {
  return products.find((product) => product.id === id) ?? null;
}
