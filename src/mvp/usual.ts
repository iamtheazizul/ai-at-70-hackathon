import type { PastTripItem, Product } from "./types";

/** Items bought on at least two past trips, most frequent first. */
export function myUsual(items: PastTripItem[], products: Product[]): Product[] {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (item.status !== "found") continue;
    counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .filter((entry) => entry[1] >= 2)
    .map(([productId, count]) => {
      const product = products.find((row) => row.id === productId);
      return product ? { product, count } : null;
    })
    .filter((row): row is { product: Product; count: number } => row !== null);

  ranked.sort((a, b) => b.count - a.count || a.product.name.localeCompare(b.product.name));
  return ranked.map((row) => row.product);
}
