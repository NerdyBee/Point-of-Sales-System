import { currencies } from "@pos/types";

/** ISO 4217 code, e.g. "NGN" or "USD". The list offered to businesses is `currencies` in @pos/types. */
export type CurrencyCode = string;

export { currencies };

/**
 * Amounts are stored as whole numbers of the business's smallest unit: with 2 decimal places,
 * 499 means 4.99. The decimal places come from the business's `moneyDecimals` setting, which
 * useTenantSettings applies here once loaded (missing = 0, whole units).
 */
let activeDecimals = 0;

export function setMoneyDecimals(decimals: number | undefined) {
  activeDecimals = Number.isInteger(decimals) && decimals! > 0 ? Math.min(decimals!, 3) : 0;
}

export function moneyDecimals() {
  return activeDecimals;
}

/** Stored amount → the number a person reads and types (499 → 4.99). */
export function toMajorUnits(amount: number, decimals = activeDecimals) {
  return amount / 10 ** decimals;
}

/** Number a person typed → stored amount (4.99 → 499). */
export function fromMajorUnits(value: number, decimals = activeDecimals) {
  return Math.round(value * 10 ** decimals);
}

export function formatMoney(amount: number, currency: CurrencyCode = "NGN", decimals = activeDecimals) {
  try {
    // en-US with narrow symbols reads well everywhere: ₦8,500, $8,500.50, £, €, GH₵.
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(toMajorUnits(amount, decimals));
  } catch {
    // Unknown code: plain number with the code in front.
    return `${currency} ${toMajorUnits(amount, decimals).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }
}
