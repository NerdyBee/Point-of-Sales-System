import { BRAND } from "../brand";
import type { TenantSettings } from "../data/readModel";
import type { SaleRecord } from "../pos/actions";
import type { SaleSummary } from "../pos/pricing";
import type { LedgerEntry } from "../standalone/credit";
import { EscPosBuilder, type PaperWidth } from "./escpos";
import { logoForPrinter } from "./logo";

/** Everything printed on a sales receipt. Shared by the printer and the "share as text" fallback. */
export interface ReceiptData {
  businessName: string;
  branchName?: string;
  taxId?: string;
  phone?: string;
  address?: string;
  /** Shop logo as base64 PNG; printed above the name when present. */
  logoPng?: string;
  footer?: string;
  currency: string;
  number: string;
  createdAt: string;
  staffName: string;
  customer?: { name: string; phone?: string };
  summary: SaleSummary;
  payments: { method: string; amount: number; reference?: string }[];
  /** Cash handed over by the customer (to show change). */
  tendered?: number;
  /** When the sale has a customer: what they owe after this sale. */
  account?: { balanceAfter: number };
  voided?: boolean;
  reprint?: boolean;
}

const methodNames: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Transfer", mobile_money: "Mobile money", customer_credit: "On account" };
const printSymbols: Record<string, string> = { NGN: "N", GHS: "GHS ", KES: "KSh ", ZAR: "R", USD: "$" };

/** Money in plain ASCII, e.g. N12,500 — thermal printers cannot print ₦. */
export function printMoney(amount: number, currency: string) {
  const sign = amount < 0 ? "-" : "";
  const grouped = Math.abs(Math.round(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${printSymbols[currency] ?? `${currency} `}${grouped}`;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function change(receipt: ReceiptData) {
  const cash = receipt.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
  return receipt.tendered !== undefined && cash > 0 ? Math.max(0, receipt.tendered - cash) : 0;
}

export function buildReceiptBytes(receipt: ReceiptData, options: { width: PaperWidth; openDrawer?: boolean }) {
  const p = new EscPosBuilder(options.width);
  const money = (amount: number) => printMoney(amount, receipt.currency);

  if (options.openDrawer) p.openDrawer();

  p.align("center");
  const logo = receipt.logoPng ? logoForPrinter(receipt.logoPng, options.width) : null;
  if (logo) p.append(logo).feed(1);
  p.bold(true).large(true);
  p.wrapped(receipt.businessName, Math.floor(p.columns / 2));
  p.large(false).bold(false);
  if (receipt.branchName) p.line(receipt.branchName);
  if (receipt.address) p.wrapped(receipt.address);
  if (receipt.phone) p.line(`Tel: ${receipt.phone}`);
  if (receipt.taxId) p.line(`TIN: ${receipt.taxId}`);
  if (receipt.reprint) p.bold(true).line("*** REPRINT ***").bold(false);
  if (receipt.voided) p.bold(true).line("*** VOIDED ***").bold(false);
  p.feed(1);

  p.align("left");
  p.pair("Receipt", receipt.number);
  p.pair("Date", formatDate(receipt.createdAt));
  p.pair("Served by", receipt.staffName);
  if (receipt.customer) p.pair("Customer", receipt.customer.name);
  p.divider();

  for (const line of receipt.summary.lines) {
    p.wrapped(line.name);
    p.pair(`  ${line.quantity} x ${money(line.unitPrice)}`, money(line.subtotal));
    if (line.discount) p.pair("  Discount", `-${money(line.discount)}`);
  }
  p.divider();

  p.pair("Subtotal", money(receipt.summary.subtotal));
  if (receipt.summary.discount) p.pair("Discount", `-${money(receipt.summary.discount)}`);
  if (receipt.summary.vat) p.pair("VAT", money(receipt.summary.vat));
  if (receipt.summary.serviceCharge) p.pair("Service charge", money(receipt.summary.serviceCharge));
  p.bold(true).large(true).pair("TOTAL", money(receipt.summary.total), Math.floor(p.columns / 2)).large(false).bold(false);
  p.divider();

  for (const payment of receipt.payments) {
    p.pair(methodNames[payment.method] ?? payment.method, money(payment.amount));
    if (payment.reference) p.pair("  Ref", payment.reference);
  }
  if (receipt.tendered !== undefined && change(receipt) > 0) {
    p.pair("Cash received", money(receipt.tendered));
    p.pair("Change", money(change(receipt)));
  }
  if (receipt.account) {
    p.divider();
    p.bold(true).pair("Account balance", money(receipt.account.balanceAfter)).bold(false);
  }

  p.feed(1).align("center");
  if (receipt.footer) p.wrapped(receipt.footer);
  p.line(`Powered by ${BRAND.appName}`);
  p.cut();
  return p.build();
}

/** Plain-text receipt for sharing (WhatsApp, SMS) when no printer is available. */
export function buildReceiptText(receipt: ReceiptData) {
  const money = (amount: number) => printMoney(amount, receipt.currency);
  const lines = [
    receipt.businessName,
    ...(receipt.address ? [receipt.address] : []),
    ...(receipt.phone ? [`Tel: ${receipt.phone}`] : []),
    ...(receipt.voided ? ["*** VOIDED ***"] : []),
    `Receipt ${receipt.number}`,
    formatDate(receipt.createdAt),
    `Served by ${receipt.staffName}`,
    ...(receipt.customer ? [`Customer: ${receipt.customer.name}`] : []),
    "",
    ...receipt.summary.lines.map((line) => `${line.quantity} x ${line.name} - ${money(line.subtotal)}`),
    "",
    ...(receipt.summary.discount ? [`Discount: -${money(receipt.summary.discount)}`] : []),
    ...(receipt.summary.vat ? [`VAT: ${money(receipt.summary.vat)}`] : []),
    ...(receipt.summary.serviceCharge ? [`Service charge: ${money(receipt.summary.serviceCharge)}`] : []),
    `TOTAL: ${money(receipt.summary.total)}`,
    ...receipt.payments.map((payment) => `${methodNames[payment.method] ?? payment.method}: ${money(payment.amount)}`),
    ...(receipt.account ? [`Account balance: ${money(receipt.account.balanceAfter)}`] : []),
    ...(receipt.footer ? ["", receipt.footer] : [])
  ];
  return lines.join("\n");
}

/** Shop contact details and logo printed at the top of receipts. */
export interface ReceiptBranding {
  phone?: string;
  address?: string;
  logoPng?: string;
}

function accountAfterSale(record: SaleRecord) {
  if (!record.customer) return undefined;
  const balanceAfter = record.credit?.balanceAfter ?? record.customerBalance;
  return balanceAfter === undefined ? undefined : { balanceAfter };
}

/** Builds receipt data from a sale recorded on this device. */
export function receiptFromSale(
  sale: { number: string; serverId?: string | null; createdAt: string; status?: string },
  record: SaleRecord & { tendered?: number },
  tenant: TenantSettings,
  extra: { tendered?: number; reprint?: boolean; branding?: ReceiptBranding } = {}
): ReceiptData {
  return {
    businessName: tenant.businessName,
    taxId: tenant.taxId || undefined,
    phone: extra.branding?.phone || undefined,
    address: extra.branding?.address || undefined,
    logoPng: extra.branding?.logoPng || undefined,
    footer: tenant.receiptFooter,
    currency: tenant.currency ?? "NGN",
    number: sale.serverId ?? sale.number,
    createdAt: sale.createdAt,
    staffName: record.staffName,
    customer: record.customer ? { name: record.customer.name, phone: record.customer.phone } : undefined,
    summary: record.summary,
    payments: record.payments,
    tendered: extra.tendered ?? record.tendered,
    account: accountAfterSale(record),
    voided: sale.status === "voided",
    reprint: extra.reprint
  };
}

/** Everything printed on a receipt for money received against a customer's account. */
export interface PaymentReceiptData {
  businessName: string;
  branchName?: string;
  taxId?: string;
  phone?: string;
  address?: string;
  logoPng?: string;
  footer?: string;
  currency: string;
  number: string;
  createdAt: string;
  staffName: string;
  customer: { name: string; phone?: string };
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  /** What the customer owed before and after this payment. */
  balanceBefore: number;
  balanceAfter: number;
  reprint?: boolean;
}

export function buildPaymentReceiptBytes(receipt: PaymentReceiptData, options: { width: PaperWidth; openDrawer?: boolean }) {
  const p = new EscPosBuilder(options.width);
  const money = (amount: number) => printMoney(amount, receipt.currency);

  if (options.openDrawer) p.openDrawer();

  p.align("center");
  const logo = receipt.logoPng ? logoForPrinter(receipt.logoPng, options.width) : null;
  if (logo) p.append(logo).feed(1);
  p.bold(true).large(true);
  p.wrapped(receipt.businessName, Math.floor(p.columns / 2));
  p.large(false).bold(false);
  if (receipt.branchName) p.line(receipt.branchName);
  if (receipt.address) p.wrapped(receipt.address);
  if (receipt.phone) p.line(`Tel: ${receipt.phone}`);
  if (receipt.taxId) p.line(`TIN: ${receipt.taxId}`);
  p.feed(1).bold(true).line("PAYMENT RECEIPT").bold(false);
  if (receipt.reprint) p.bold(true).line("*** REPRINT ***").bold(false);
  p.feed(1);

  p.align("left");
  p.pair("Receipt", receipt.number);
  p.pair("Date", formatDate(receipt.createdAt));
  p.pair("Received by", receipt.staffName);
  p.pair("Customer", receipt.customer.name);
  if (receipt.customer.phone) p.pair("Phone", receipt.customer.phone);
  p.divider();

  p.pair("Previous balance", money(receipt.balanceBefore));
  p.bold(true).large(true).pair("PAID", money(receipt.amount), Math.floor(p.columns / 2)).large(false).bold(false);
  p.pair("Method", methodNames[receipt.method] ?? receipt.method);
  if (receipt.reference) p.pair("  Ref", receipt.reference);
  if (receipt.note) p.wrapped(receipt.note);
  p.divider();
  p.bold(true).pair("Balance owed", money(receipt.balanceAfter)).bold(false);
  if (receipt.balanceAfter <= 0) p.align("center").line("Account fully paid. Thank you!");

  p.feed(1).align("center");
  if (receipt.footer) p.wrapped(receipt.footer);
  p.line(`Powered by ${BRAND.appName}`);
  p.cut();
  return p.build();
}

/** Plain-text payment receipt for sharing when the image cannot be made. */
export function buildPaymentReceiptText(receipt: PaymentReceiptData) {
  const money = (amount: number) => printMoney(amount, receipt.currency);
  return [
    receipt.businessName,
    ...(receipt.address ? [receipt.address] : []),
    ...(receipt.phone ? [`Tel: ${receipt.phone}`] : []),
    "PAYMENT RECEIPT",
    `Receipt ${receipt.number}`,
    formatDate(receipt.createdAt),
    `Received by ${receipt.staffName}`,
    `Customer: ${receipt.customer.name}`,
    "",
    `Previous balance: ${money(receipt.balanceBefore)}`,
    `Paid: ${money(receipt.amount)} (${methodNames[receipt.method] ?? receipt.method}${receipt.reference ? ` ${receipt.reference}` : ""})`,
    ...(receipt.note ? [receipt.note] : []),
    `Balance owed: ${money(receipt.balanceAfter)}`,
    ...(receipt.footer ? ["", receipt.footer] : [])
  ].join("\n");
}

/** Builds a payment receipt from a payment ledger entry. */
export function paymentReceiptFromEntry(
  entry: LedgerEntry,
  customer: { name: string; phone?: string },
  tenant: TenantSettings,
  extra: { staffName: string; reprint?: boolean; branding?: ReceiptBranding }
): PaymentReceiptData {
  const amount = Math.abs(entry.amount);
  return {
    businessName: tenant.businessName,
    taxId: tenant.taxId || undefined,
    phone: extra.branding?.phone || undefined,
    address: extra.branding?.address || undefined,
    logoPng: extra.branding?.logoPng || undefined,
    footer: tenant.receiptFooter,
    currency: tenant.currency ?? "NGN",
    number: entry.receiptNumber ?? entry.id.replace(/^ledger-/, "").slice(0, 8).toUpperCase(),
    createdAt: entry.createdAt,
    staffName: extra.staffName,
    customer: { name: customer.name, phone: customer.phone },
    amount,
    method: entry.paymentMethod ?? "cash",
    reference: entry.paymentReference,
    note: entry.note && entry.note !== "Payment received" ? entry.note : undefined,
    balanceBefore: entry.balanceAfter + amount,
    balanceAfter: entry.balanceAfter,
    reprint: extra.reprint
  };
}
