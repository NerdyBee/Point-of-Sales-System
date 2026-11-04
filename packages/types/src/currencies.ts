/**
 * Currencies a business can trade in. `decimals` is how many decimal places prices use in
 * practice (Nigerian prices are whole naira even though kobo exist).
 *
 * A business's `moneyDecimals` setting is fixed when it is created: every amount stored for
 * it (prices, totals, payments) is a whole number of its smallest unit, so 4.99 USD is 499.
 * Businesses created before this setting existed have none, which means 0 (whole units).
 *
 * Keep in sync with mobile/src/pos/currencies.ts.
 */
export interface CurrencyInfo {
  code: string;
  name: string;
  decimals: number;
}

export const currencies: CurrencyInfo[] = [
  { code: "NGN", name: "Nigerian naira", decimals: 0 },
  { code: "GHS", name: "Ghanaian cedi", decimals: 2 },
  { code: "KES", name: "Kenyan shilling", decimals: 0 },
  { code: "ZAR", name: "South African rand", decimals: 2 },
  { code: "XOF", name: "West African CFA franc", decimals: 0 },
  { code: "XAF", name: "Central African CFA franc", decimals: 0 },
  { code: "GMD", name: "Gambian dalasi", decimals: 2 },
  { code: "SLE", name: "Sierra Leonean leone", decimals: 2 },
  { code: "LRD", name: "Liberian dollar", decimals: 2 },
  { code: "UGX", name: "Ugandan shilling", decimals: 0 },
  { code: "TZS", name: "Tanzanian shilling", decimals: 0 },
  { code: "RWF", name: "Rwandan franc", decimals: 0 },
  { code: "ETB", name: "Ethiopian birr", decimals: 2 },
  { code: "EGP", name: "Egyptian pound", decimals: 2 },
  { code: "MAD", name: "Moroccan dirham", decimals: 2 },
  { code: "ZMW", name: "Zambian kwacha", decimals: 2 },
  { code: "BWP", name: "Botswana pula", decimals: 2 },
  { code: "NAD", name: "Namibian dollar", decimals: 2 },
  { code: "MUR", name: "Mauritian rupee", decimals: 2 },
  { code: "USD", name: "US dollar", decimals: 2 },
  { code: "CAD", name: "Canadian dollar", decimals: 2 },
  { code: "GBP", name: "British pound", decimals: 2 },
  { code: "EUR", name: "Euro", decimals: 2 },
  { code: "CHF", name: "Swiss franc", decimals: 2 },
  { code: "SEK", name: "Swedish krona", decimals: 2 },
  { code: "NOK", name: "Norwegian krone", decimals: 2 },
  { code: "DKK", name: "Danish krone", decimals: 2 },
  { code: "PLN", name: "Polish zloty", decimals: 2 },
  { code: "TRY", name: "Turkish lira", decimals: 2 },
  { code: "AED", name: "UAE dirham", decimals: 2 },
  { code: "SAR", name: "Saudi riyal", decimals: 2 },
  { code: "QAR", name: "Qatari riyal", decimals: 2 },
  { code: "INR", name: "Indian rupee", decimals: 2 },
  { code: "PKR", name: "Pakistani rupee", decimals: 0 },
  { code: "CNY", name: "Chinese yuan", decimals: 2 },
  { code: "HKD", name: "Hong Kong dollar", decimals: 2 },
  { code: "SGD", name: "Singapore dollar", decimals: 2 },
  { code: "MYR", name: "Malaysian ringgit", decimals: 2 },
  { code: "JPY", name: "Japanese yen", decimals: 0 },
  { code: "AUD", name: "Australian dollar", decimals: 2 },
  { code: "NZD", name: "New Zealand dollar", decimals: 2 },
  { code: "BRL", name: "Brazilian real", decimals: 2 },
  { code: "MXN", name: "Mexican peso", decimals: 2 },
  { code: "JMD", name: "Jamaican dollar", decimals: 2 },
  { code: "TTD", name: "Trinidad and Tobago dollar", decimals: 2 },
  { code: "XCD", name: "East Caribbean dollar", decimals: 2 }
];

export const currencyCodes = currencies.map((currency) => currency.code);

/** Decimal places new businesses in this currency use (2 for unknown codes). */
export function currencyDecimals(code: string) {
  return currencies.find((currency) => currency.code === code)?.decimals ?? 2;
}
