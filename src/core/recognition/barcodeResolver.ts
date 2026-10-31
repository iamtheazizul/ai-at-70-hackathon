import type { ListEntry, Product, ProductId, StorePack } from '../types';

export type VerifyOutcome =
  | { kind: 'verified'; productId: ProductId; product: Product }
  | { kind: 'known_mismatch'; productId: ProductId; product: Product; requested: string }
  | { kind: 'unknown_code'; barcode: string };

/** Fixed before testing, so "correct within an attempt" means something. */
export const BARCODE_ATTEMPT_MS = 6000;

/**
 * A decoded code confirms identity **only through a valid catalogue mapping**.
 * It does not prove the item entered the cart, and it does not reveal where the
 * product sits on the shelf.
 */
export function resolveBarcode(barcode: string, pack: StorePack, entry: ListEntry): VerifyOutcome {
  const productId = pack.barcodes[barcode.trim()];
  if (productId === undefined) return { kind: 'unknown_code', barcode };

  const product = pack.products.find((p) => p.id === productId);
  if (!product) return { kind: 'unknown_code', barcode };

  if (entry.acceptedProducts.includes(productId)) {
    return { kind: 'verified', productId, product };
  }
  return { kind: 'known_mismatch', productId, product, requested: entry.requestText };
}

/**
 * Framing, not model quality, is what decides whether a 1D barcode decodes.
 * ML Kit's working figure is roughly 190 px across an EAN-13, so the capture
 * layer sizes its framing rectangle from this and enables continuous autofocus.
 */
export const MIN_BARCODE_WIDTH_PX = 190;

export function framingGuideWidthPx(previewWidthPx: number): number {
  // Ask the shopper to fill ~40% of the preview; below that, warn instead.
  return Math.max(MIN_BARCODE_WIDTH_PX, Math.round(previewWidthPx * 0.4));
}

export function previewTooNarrow(previewWidthPx: number): boolean {
  return previewWidthPx * 0.4 < MIN_BARCODE_WIDTH_PX;
}
