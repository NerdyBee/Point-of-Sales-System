/**
 * Turns a period's trading into accounting vouchers for the shop's accountant (Tally, or any
 * package via the CSV day book). Every event is booked on the day it happened: a sale on its
 * day, a later refund or void as a credit note on the refund/void day.
 *
 * Amounts here are in the business's smallest unit (see moneyDecimals). In every voucher the
 * debits equal the credits; `amount` is positive for a debit and negative for a credit.
 */

export interface LedgerNames {
  sales: string;
  salesReturns: string;
  vat: string;
  serviceCharge: string;
  discount: string;
  cash: string;
  card: string;
  bankTransfer: string;
  mobileMoney: string;
  voucher: string;
  purchases: string;
  /** VAT paid on purchases and expenses, claimed back against Output VAT. */
  inputVat: string;
  /** Withholding tax kept back from suppliers and vendors, owed to the tax office. */
  withholdingTax: string;
  /** Customer accounts: each customer's own name (as Sundry Debtors) or one shared ledger. */
  customerLedger: "customer" | "shared";
  sharedCustomerLedger: string;
  /** Supplier accounts: each supplier's own name (as Sundry Creditors) or one shared ledger. */
  supplierLedger: "supplier" | "shared";
  sharedSupplierLedger: string;
}

export const defaultLedgers: LedgerNames = {
  sales: "Sales Account",
  salesReturns: "Sales Returns",
  vat: "Output VAT",
  serviceCharge: "Service Charge",
  discount: "Discount Allowed",
  cash: "Cash",
  card: "POS Card Account",
  bankTransfer: "Bank Account",
  mobileMoney: "Mobile Money",
  voucher: "Gift Vouchers",
  purchases: "Purchase Account",
  inputVat: "Input VAT",
  withholdingTax: "WHT Payable",
  customerLedger: "customer",
  sharedCustomerLedger: "Sundry Debtors (POS)",
  supplierLedger: "supplier",
  sharedSupplierLedger: "Sundry Creditors (POS)"
};

/** Tally's built-in group for each kind of ledger, used when the export also creates ledgers. */
export type LedgerGroup = "Sales Accounts" | "Purchase Accounts" | "Duties & Taxes" | "Indirect Incomes" | "Indirect Expenses" | "Cash-in-Hand" | "Bank Accounts" | "Sundry Debtors" | "Sundry Creditors";

export interface VoucherLine {
  ledger: string;
  amount: number;
}

export interface Voucher {
  type: "Sales" | "Credit Note" | "Receipt" | "Purchase" | "Payment";
  date: string;
  number: string;
  narration: string;
  /** The ledger Tally shows as the voucher's party (cash/bank or the customer/supplier). */
  party: string;
  branchId: string;
  lines: VoucherLine[];
}

export interface SaleInput {
  id: string;
  branchId: string;
  createdAt: string;
  customerName?: string;
  summary: { subtotal: number; discount: number; serviceCharge: number; vat: number; total: number };
  payments: { method: string; amount: number }[];
}

export interface ReturnInput {
  saleId: string;
  kind: "refund" | "void";
  amount: number;
  at: string;
  sale: SaleInput;
}

export interface CustomerPaymentInput {
  id: string;
  branchId: string;
  customerName: string;
  amount: number;
  at: string;
  note: string;
}

export interface PurchaseInput {
  id: string;
  branchId: string;
  supplierName: string;
  invoiceNumber: string;
  amount: number;
  /** VAT included in amount. */
  vat?: number;
  date: string;
}

export interface SupplierPaymentInput {
  id: string;
  branchId: string;
  supplierName: string;
  invoiceNumber: string;
  amount: number;
  method: string;
  reference: string;
  /** Part of amount kept back as withholding tax (not paid out). */
  withholdingTax?: number;
  at: string;
}

export interface ExpenseInput {
  id: string;
  branchId: string;
  category: string;
  description: string;
  vendor?: string | null;
  amount: number;
  /** VAT included in amount. */
  vat?: number;
  /** Part of amount kept back as withholding tax (not paid out). */
  withholdingTax?: number;
  method: string;
  at: string;
}

export interface VoucherInput {
  ledgers: LedgerNames;
  /** Shown in narrations, e.g. "Main". */
  branchName(branchId: string): string;
  sales: SaleInput[];
  returns: ReturnInput[];
  customerPayments: CustomerPaymentInput[];
  purchases: PurchaseInput[];
  supplierPayments: SupplierPaymentInput[];
  expenses: ExpenseInput[];
}

/** YYYY-MM-DD of a timestamp, in the server's local time (the shop's day). */
export function localDay(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function methodLedger(ledgers: LedgerNames, method: string) {
  if (method === "card") return ledgers.card;
  if (method === "bank_transfer") return ledgers.bankTransfer;
  if (method === "mobile_money") return ledgers.mobileMoney;
  if (method === "voucher") return ledgers.voucher;
  return ledgers.cash;
}

function customerLedger(ledgers: LedgerNames, name: string | undefined) {
  return ledgers.customerLedger === "shared" || !name ? ledgers.sharedCustomerLedger : name;
}

function supplierLedger(ledgers: LedgerNames, name: string) {
  return ledgers.supplierLedger === "shared" ? ledgers.sharedSupplierLedger : name;
}

/** Adds lines for the same ledger together and drops zero lines. */
function merge(lines: VoucherLine[]) {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.ledger, (totals.get(line.ledger) ?? 0) + line.amount);
  return [...totals].filter(([, amount]) => amount !== 0).map(([ledger, amount]) => ({ ledger, amount }));
}

/** The income side of sales: Sales (gross), less discount, plus VAT and service charge, as credits. */
function incomeLines(ledgers: LedgerNames, summary: SaleInput["summary"], ratio = 1): VoucherLine[] {
  const part = (value: number) => Math.round(value * ratio);
  const vat = part(summary.vat);
  const service = part(summary.serviceCharge);
  const discount = part(summary.discount);
  // Whatever rounding leaves over goes to Sales, so the voucher always balances.
  const sales = part(summary.total) - vat - service + discount;
  return [
    { ledger: ledgers.sales, amount: -sales },
    { ledger: ledgers.discount, amount: discount },
    { ledger: ledgers.vat, amount: -vat },
    { ledger: ledgers.serviceCharge, amount: -service }
  ];
}

export function buildVouchers(input: VoucherInput): Voucher[] {
  const { ledgers } = input;
  const vouchers: Voucher[] = [];

  // Sales: one voucher per branch per day for walk-in payments; credit sales one each, charged
  // to the customer. Any part of a sale not covered by payments is also left on credit.
  const daily = new Map<string, { date: string; branchId: string; count: number; lines: VoucherLine[] }>();
  for (const sale of input.sales) {
    const credit = sale.summary.total - sale.payments.filter((payment) => payment.method !== "customer_credit").reduce((sum, payment) => sum + payment.amount, 0);
    const paid = sale.payments.filter((payment) => payment.method !== "customer_credit");
    if (credit > 0) {
      vouchers.push({
        type: "Sales",
        date: localDay(sale.createdAt),
        number: sale.id,
        narration: `Credit sale ${sale.id} to ${sale.customerName ?? "customer"} (${input.branchName(sale.branchId)})`,
        party: customerLedger(ledgers, sale.customerName),
        branchId: sale.branchId,
        lines: merge([
          { ledger: customerLedger(ledgers, sale.customerName), amount: credit },
          ...paid.map((payment) => ({ ledger: methodLedger(ledgers, payment.method), amount: payment.amount })),
          ...incomeLines(ledgers, sale.summary)
        ])
      });
      continue;
    }
    const key = `${localDay(sale.createdAt)}|${sale.branchId}`;
    const day = daily.get(key) ?? { date: localDay(sale.createdAt), branchId: sale.branchId, count: 0, lines: [] };
    day.count += 1;
    // Cash change: payments above the total (cash tendered) are not income.
    const overpaid = -credit;
    day.lines.push(...paid.map((payment) => ({ ledger: methodLedger(ledgers, payment.method), amount: payment.amount })));
    if (overpaid > 0) day.lines.push({ ledger: ledgers.cash, amount: -overpaid });
    day.lines.push(...incomeLines(ledgers, sale.summary));
    daily.set(key, day);
  }
  for (const day of [...daily.values()].sort((left, right) => left.date.localeCompare(right.date))) {
    vouchers.push({
      type: "Sales",
      date: day.date,
      number: `POS-${day.date.replace(/-/g, "")}-${input.branchName(day.branchId).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase()}`,
      narration: `${day.count} POS sale${day.count === 1 ? "" : "s"} at ${input.branchName(day.branchId)} on ${day.date}`,
      party: ledgers.cash,
      branchId: day.branchId,
      lines: merge(day.lines)
    });
  }

  // Refunds and voids: credit notes on the day they happened, reversing the sale's VAT and
  // service charge in proportion, paid back the way the sale was paid (credit sales: the customer).
  for (const item of input.returns) {
    const ratio = item.sale.summary.total ? item.amount / item.sale.summary.total : 0;
    const onCredit = item.sale.payments.some((payment) => payment.method === "customer_credit");
    const paidBy = onCredit ? customerLedger(ledgers, item.sale.customerName) : methodLedger(ledgers, item.sale.payments[0]?.method ?? "cash");
    const income = incomeLines({ ...ledgers, sales: ledgers.salesReturns }, item.sale.summary, ratio).map((line) => ({ ...line, amount: -line.amount }));
    vouchers.push({
      type: "Credit Note",
      date: localDay(item.at),
      number: `${item.kind === "void" ? "VOID" : "RFD"}-${item.saleId}`,
      narration: `${item.kind === "void" ? "Void of" : "Refund on"} sale ${item.saleId} (${input.branchName(item.sale.branchId)})`,
      party: paidBy,
      branchId: item.sale.branchId,
      lines: merge([...income, { ledger: paidBy, amount: -item.amount }])
    });
  }

  for (const payment of input.customerPayments) {
    vouchers.push({
      type: "Receipt",
      date: localDay(payment.at),
      number: payment.id,
      narration: `Payment from ${payment.customerName} on account${payment.note ? `: ${payment.note}` : ""}`,
      party: customerLedger(ledgers, payment.customerName),
      branchId: payment.branchId,
      lines: [
        { ledger: ledgers.cash, amount: payment.amount },
        { ledger: customerLedger(ledgers, payment.customerName), amount: -payment.amount }
      ]
    });
  }

  for (const purchase of input.purchases) {
    vouchers.push({
      type: "Purchase",
      date: localDay(purchase.date),
      number: purchase.invoiceNumber,
      narration: `Supplier invoice ${purchase.invoiceNumber} from ${purchase.supplierName} (${input.branchName(purchase.branchId)})`,
      party: supplierLedger(ledgers, purchase.supplierName),
      branchId: purchase.branchId,
      lines: merge([
        { ledger: ledgers.purchases, amount: purchase.amount - (purchase.vat ?? 0) },
        { ledger: ledgers.inputVat, amount: purchase.vat ?? 0 },
        { ledger: supplierLedger(ledgers, purchase.supplierName), amount: -purchase.amount }
      ])
    });
  }

  for (const payment of input.supplierPayments) {
    vouchers.push({
      type: "Payment",
      date: localDay(payment.at),
      number: payment.id,
      narration: `Payment to ${payment.supplierName} for invoice ${payment.invoiceNumber}${payment.reference ? `, ref ${payment.reference}` : ""}`,
      party: methodLedger(ledgers, payment.method),
      branchId: payment.branchId,
      lines: merge([
        { ledger: supplierLedger(ledgers, payment.supplierName), amount: payment.amount },
        { ledger: methodLedger(ledgers, payment.method), amount: -(payment.amount - (payment.withholdingTax ?? 0)) },
        { ledger: ledgers.withholdingTax, amount: -(payment.withholdingTax ?? 0) }
      ])
    });
  }

  for (const expense of input.expenses) {
    vouchers.push({
      type: "Payment",
      date: localDay(expense.at),
      number: expense.id,
      narration: `${expense.description}${expense.vendor ? ` (${expense.vendor})` : ""}`,
      party: methodLedger(ledgers, expense.method),
      branchId: expense.branchId,
      lines: merge([
        { ledger: expense.category, amount: expense.amount - (expense.vat ?? 0) },
        { ledger: ledgers.inputVat, amount: expense.vat ?? 0 },
        { ledger: methodLedger(ledgers, expense.method), amount: -(expense.amount - (expense.withholdingTax ?? 0)) },
        { ledger: ledgers.withholdingTax, amount: -(expense.withholdingTax ?? 0) }
      ])
    });
  }

  return vouchers.sort((left, right) => left.date.localeCompare(right.date) || left.type.localeCompare(right.type) || left.number.localeCompare(right.number));
}

/** Every ledger the vouchers use, with the Tally group to create it under. */
export function ledgersUsed(vouchers: Voucher[], ledgers: LedgerNames, expenseCategories: string[]): Map<string, LedgerGroup> {
  const known = new Map<string, LedgerGroup>([
    [ledgers.sales, "Sales Accounts"],
    [ledgers.salesReturns, "Sales Accounts"],
    [ledgers.vat, "Duties & Taxes"],
    [ledgers.inputVat, "Duties & Taxes"],
    [ledgers.withholdingTax, "Duties & Taxes"],
    [ledgers.serviceCharge, "Indirect Incomes"],
    [ledgers.discount, "Indirect Expenses"],
    [ledgers.cash, "Cash-in-Hand"],
    [ledgers.card, "Bank Accounts"],
    [ledgers.bankTransfer, "Bank Accounts"],
    [ledgers.mobileMoney, "Bank Accounts"],
    [ledgers.voucher, "Sundry Debtors"],
    [ledgers.purchases, "Purchase Accounts"]
  ]);
  for (const category of expenseCategories) if (!known.has(category)) known.set(category, "Indirect Expenses");
  const used = new Map<string, LedgerGroup>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      if (used.has(line.ledger)) continue;
      const group = known.get(line.ledger) ?? (voucher.type === "Purchase" || (voucher.type === "Payment" && !expenseCategories.includes(voucher.lines[0].ledger)) ? "Sundry Creditors" : "Sundry Debtors");
      used.set(line.ledger, group);
    }
  }
  return used;
}
