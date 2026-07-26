export type CurrencyCode = "NGN" | "USD" | "GHS" | "KES" | "ZAR";

const currencyLocales: Record<CurrencyCode, string> = {
  NGN: "en-NG",
  USD: "en-US",
  GHS: "en-GH",
  KES: "en-KE",
  ZAR: "en-ZA"
};

export function formatMoney(amount: number, currency: CurrencyCode = "NGN") {
  return new Intl.NumberFormat(currencyLocales[currency] ?? "en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(amount);
}
