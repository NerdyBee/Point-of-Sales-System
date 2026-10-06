export function hasInvertedDateRange(startDate: string, endDate: string) {
  return Boolean(startDate && endDate && startDate > endDate);
}

export function dateRangeErrorMessage() {
  return "Start date must be before end date";
}
