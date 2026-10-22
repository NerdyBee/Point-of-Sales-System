/**
 * Expiry batches and clearance pricing (same rules as the tablet app: mobile/src/pos/clearance.ts
 * and mobile/src/standalone/expiry.ts).
 *
 * - A stock lot is a batch as received, with an optional expiry date (YYYY-MM-DD). What is left
 *   of each lot is derived from the product's current stock, oldest units sold first.
 * - A clearance puts `clearanceRemaining` units on sale at `clearancePrice` until
 *   `clearanceEndsAt` (inclusive). Sale lines flagged `clearance` use those units; such
 *   discounts are set by an owner/manager, so they do not need sale.discount or an approval.
 */

export interface ClearanceColumns {
  price: number;
  clearancePrice?: number | null;
  clearancePercent?: number | null;
  clearanceRemaining?: number | null;
  clearanceEndsAt?: string | null;
  clearanceExpiry?: string | null;
  clearanceSetBy?: string | null;
  clearanceSetAt?: Date | string | null;
}

export interface LotColumns {
  id: string;
  quantity: number;
  expiryDate: string | null;
  createdAt: Date | string;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidExpiryDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Whole days from today (UTC dates) to the given YYYY-MM-DD; negative when past. */
export function daysUntil(isoDate: string, now = new Date()) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(year, month - 1, day) - today) / 86_400_000);
}

export function activeClearance(product: ClearanceColumns, now = new Date()) {
  const price = product.clearancePrice;
  const remaining = Number(product.clearanceRemaining ?? 0);
  if (price === null || price === undefined || remaining <= 0 || price < 0 || price >= product.price) return null;
  if (product.clearanceEndsAt && daysUntil(product.clearanceEndsAt, now) < 0) return null;
  return { price, remaining, discount: product.price - price, endsAt: product.clearanceEndsAt ?? null };
}

/** The clearance fields as returned by the API. */
export function clearanceFieldsOf(product: ClearanceColumns) {
  return {
    clearancePrice: product.clearancePrice ?? null,
    clearancePercent: product.clearancePercent ?? null,
    clearanceRemaining: Number(product.clearanceRemaining ?? 0),
    clearanceEndsAt: product.clearanceEndsAt ?? null,
    clearanceExpiry: product.clearanceExpiry ?? null,
    clearanceSetAt: product.clearanceSetAt ? new Date(product.clearanceSetAt).toISOString() : null
  };
}

/** What is left of each lot, newest lots holding the units on the shelf. */
export function allocateStock<T extends LotColumns>(stock: number, lots: T[], now = new Date()) {
  let left = Math.max(0, stock);
  const time = (value: Date | string) => new Date(value).getTime();
  return [...lots]
    .sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id.localeCompare(a.id))
    .map((lot) => {
      const remaining = Math.min(lot.quantity, left);
      left -= remaining;
      return { ...lot, remaining, daysLeft: lot.expiryDate ? daysUntil(lot.expiryDate, now) : null };
    });
}

type SaleLine = { productId: string; quantity: number; discount?: number; clearance?: boolean };

/**
 * Checks clearance lines against the products and returns the manual discount (the part that
 * needs sale.discount / an approval) and the clearance units used per product.
 * A replayed offline sale has already happened: it is accepted if the product has had a
 * clearance, and units are taken from what is left.
 */
export function checkClearanceLines(
  lines: SaleLine[],
  productFor: (productId: string) => (ClearanceColumns & { name: string }) | undefined,
  options: { replay?: boolean; now?: Date } = {}
) {
  let manualDiscount = 0;
  const used: Record<string, number> = {};
  for (const line of lines) {
    const discount = (line.discount ?? 0) * line.quantity;
    if (!line.clearance) {
      manualDiscount += discount;
      continue;
    }
    const product = productFor(line.productId);
    if (!product) continue;
    const clearance = activeClearance(product, options.now);
    if (!clearance) {
      if (!options.replay || !product.clearanceSetAt) return { status: "clearance_not_available" as const, productName: product.name };
    } else if ((line.discount ?? 0) > clearance.discount) {
      return { status: "clearance_not_available" as const, productName: product.name };
    }
    used[line.productId] = (used[line.productId] ?? 0) + line.quantity;
  }
  if (!options.replay) {
    for (const [productId, units] of Object.entries(used)) {
      const product = productFor(productId)!;
      if (units > Number(product.clearanceRemaining ?? 0)) return { status: "clearance_not_available" as const, productName: product.name };
    }
  }
  return { status: "valid" as const, manualDiscount, used };
}
