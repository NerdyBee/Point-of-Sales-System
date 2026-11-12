import { localDay, type VoucherInput } from "./vouchers";

/**
 * VAT return and withholding tax (WHT) schedule for a period, from the same records as the
 * accountant's export, so the return agrees with the books.
 *
 *   Output VAT = VAT charged on sales, less VAT given back on refunds and voids (in proportion).
 *   Input VAT  = VAT included in supplier invoices (by invoice date) and paid expenses.
 *   Net VAT    = Output - Input: payable when positive, a credit to carry forward when negative.
 *   WHT        = tax kept back when paying suppliers and vendors, to be paid to the tax office.
 */

export interface WithholdingRow {
  date: string;
  payee: string;
  reference: string;
  /** What the payment settled (before tax was kept back). */
  gross: number;
  withheld: number;
  /** What the payee actually received. */
  paid: number;
  branchId: string;
}

export function taxReturn(data: Omit<VoucherInput, "ledgers">) {
  const vatable = data.sales.filter((sale) => sale.summary.vat > 0);
  const sales = {
    count: data.sales.length,
    /** Sales on which VAT was charged, without the VAT. */
    vatableValue: vatable.reduce((sum, sale) => sum + sale.summary.total - sale.summary.vat, 0),
    /** Zero-rated or exempt sales (no VAT charged). */
    nonVatValue: data.sales.filter((sale) => sale.summary.vat <= 0).reduce((sum, sale) => sum + sale.summary.total, 0),
    vat: data.sales.reduce((sum, sale) => sum + sale.summary.vat, 0)
  };

  const returns = data.returns.reduce(
    (totals, item) => {
      const ratio = item.sale.summary.total ? item.amount / item.sale.summary.total : 0;
      const vat = Math.round(item.sale.summary.vat * ratio);
      return { count: totals.count + 1, value: totals.value + item.amount - vat, vat: totals.vat + vat };
    },
    { count: 0, value: 0, vat: 0 }
  );

  const purchases = {
    count: data.purchases.length,
    value: data.purchases.reduce((sum, purchase) => sum + purchase.amount - (purchase.vat ?? 0), 0),
    vat: data.purchases.reduce((sum, purchase) => sum + (purchase.vat ?? 0), 0)
  };
  const expenses = {
    count: data.expenses.length,
    value: data.expenses.reduce((sum, expense) => sum + expense.amount - (expense.vat ?? 0), 0),
    vat: data.expenses.reduce((sum, expense) => sum + (expense.vat ?? 0), 0)
  };

  const outputVat = sales.vat - returns.vat;
  const inputVat = purchases.vat + expenses.vat;

  const withholding: WithholdingRow[] = [
    ...data.supplierPayments
      .filter((payment) => (payment.withholdingTax ?? 0) > 0)
      .map((payment) => ({
        date: localDay(payment.at),
        payee: payment.supplierName,
        reference: `Invoice ${payment.invoiceNumber}${payment.reference ? `, ${payment.reference}` : ""}`,
        gross: payment.amount,
        withheld: payment.withholdingTax!,
        paid: payment.amount - payment.withholdingTax!,
        branchId: payment.branchId
      })),
    ...data.expenses
      .filter((expense) => (expense.withholdingTax ?? 0) > 0)
      .map((expense) => ({
        date: localDay(expense.at),
        payee: expense.vendor || expense.description,
        reference: `${expense.category}: ${expense.description}`,
        gross: expense.amount,
        withheld: expense.withholdingTax!,
        paid: expense.amount - expense.withholdingTax!,
        branchId: expense.branchId
      }))
  ].sort((left, right) => left.date.localeCompare(right.date) || left.payee.localeCompare(right.payee));

  return {
    vat: { sales, returns, outputVat, purchases, expenses, inputVat, netVat: outputVat - inputVat },
    withholding: { rows: withholding, total: withholding.reduce((sum, row) => sum + row.withheld, 0) }
  };
}

export type TaxReturn = ReturnType<typeof taxReturn>;

/** The return as a CSV for the accountant or the tax office's upload sheet. */
export function taxReturnCsv(result: TaxReturn, options: { from: string; to: string; amount(value: number): string; branchName(id: string): string }) {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const { vat } = result;
  const rows: string[][] = [
    ["VAT return", `${options.from} to ${options.to}`, ""],
    ["Line", "Value (excl. VAT)", "VAT"],
    ["Sales with VAT", options.amount(vat.sales.vatableValue), options.amount(vat.sales.vat)],
    ["Zero-rated / exempt sales", options.amount(vat.sales.nonVatValue), ""],
    ["Less refunds and voids", options.amount(-vat.returns.value), options.amount(-vat.returns.vat)],
    ["Output VAT", "", options.amount(vat.outputVat)],
    ["Purchases (supplier invoices)", options.amount(vat.purchases.value), options.amount(vat.purchases.vat)],
    ["Expenses", options.amount(vat.expenses.value), options.amount(vat.expenses.vat)],
    ["Input VAT", "", options.amount(vat.inputVat)],
    [vat.netVat >= 0 ? "VAT payable" : "VAT credit carried forward", "", options.amount(Math.abs(vat.netVat))],
    [],
    ["Withholding tax schedule"],
    ["Date", "Payee", "Reference", "Branch", "Gross amount", "WHT deducted", "Amount paid"],
    ...result.withholding.rows.map((row) => [row.date, row.payee, row.reference, options.branchName(row.branchId), options.amount(row.gross), options.amount(row.withheld), options.amount(row.paid)]),
    ["Total", "", "", "", "", options.amount(result.withholding.total), ""]
  ];
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
