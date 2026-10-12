/** Whole number with thousands separators for display: "30000" → "30,000". Empty stays empty. */
export function groupDigits(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
