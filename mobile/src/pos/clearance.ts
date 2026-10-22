import type { CartLine } from "./pricing";

/**
 * Clearance ("near expiry") pricing. An owner or manager puts a number of units of a product
 * on clearance at a lower price. At the till those units are sold first at the clearance
 * price; once they are used up (or the end date passes) the normal price applies again.
 * Same rules as the server (sales.repository) and the web till.
 */

export interface ClearanceFields {
  price: number;
  /** Unit price while on clearance (null = not on clearance). */
  clearancePrice?: number | null;
  /** Units still to sell at the clearance price. */
  clearanceRemaining?: number | null;
  /** Last day of the clearance (YYYY-MM-DD, inclusive), usually the batch's expiry date. */
  clearanceEndsAt?: string | null;
  /** Expiry date of the batch being cleared (YYYY-MM-DD), for display. */
  clearanceExpiry?: string | null;
}

export interface ActiveClearance {
  price: number;
  remaining: number;
  /** Discount per unit. */
  discount: number;
  percent: number;
  endsAt: string | null;
  expiry: string | null;
}

/** End of a YYYY-MM-DD day in device local time. */
export function endOfDay(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export function activeClearance(product: ClearanceFields, now = Date.now()): ActiveClearance | null {
  const price = product.clearancePrice;
  const remaining = Number(product.clearanceRemaining ?? 0);
  if (price === null || price === undefined || remaining <= 0 || price >= product.price || price < 0) return null;
  if (product.clearanceEndsAt && now > endOfDay(product.clearanceEndsAt)) return null;
  const discount = product.price - price;
  return {
    price,
    remaining,
    discount,
    percent: Math.round((discount / product.price) * 100),
    endsAt: product.clearanceEndsAt ?? null,
    expiry: product.clearanceExpiry ?? null
  };
}

/** Units of a cart line that go at the clearance price. */
export function clearanceUnits(line: Pick<CartLine, "product" | "quantity">, now = Date.now()) {
  const clearance = activeClearance(line.product, now);
  return clearance ? Math.min(line.quantity, clearance.remaining) : 0;
}

/**
 * Splits cart lines into the lines actually sold: clearance units at the clearance price
 * (flagged `clearance`), the rest at the normal price with any manual discount.
 */
export function expandCart(cart: CartLine[], now = Date.now()): CartLine[] {
  const lines: CartLine[] = [];
  for (const line of cart) {
    const clearance = activeClearance(line.product, now);
    const units = clearance ? Math.min(line.quantity, clearance.remaining) : 0;
    if (units > 0) lines.push({ product: line.product, quantity: units, discount: clearance!.discount, note: line.note, clearance: true });
    if (line.quantity - units > 0) lines.push({ ...line, quantity: line.quantity - units, clearance: undefined });
  }
  return lines;
}
