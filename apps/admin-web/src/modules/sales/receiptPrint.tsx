import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PaymentRecord, PaymentMethodCode, SaleReceiptSnapshot } from "../../shared/api/client";
import { toMajorUnits } from "../../shared/utils/money";
import type { SaleSummary } from "./types";

type PrintablePayment = Pick<PaymentRecord, "method" | "amount" | "reference"> | {
  method: PaymentMethodCode;
  amount: number;
  reference?: string;
};

export interface PrintableReceipt {
  saleId: string;
  terminalId: string;
  cashierId: string;
  customerName?: string;
  tableLabel?: string;
  createdAt: string;
  summary: SaleSummary & {
    lines: Array<{
      productId: string;
      name: string;
      quantity: number;
      subtotal: number;
      discount: number;
      vat: number;
      total: number;
    }>;
    paid: number;
    balance: number;
  };
  payments: PrintablePayment[];
  receipt: SaleReceiptSnapshot;
  label?: "Receipt" | "Reprint";
}

function methodLabel(method: PaymentMethodCode) {
  return method.replace("_", " ").toUpperCase();
}

/** Receipt amounts always show two decimals, as shoppers expect (1,850.00); the currency is printed once. */
function amount(value: number) {
  return toMajorUnits(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function receiptDate(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Printed receipt in the layout Nigerian shoppers know: shop details, SALES INVOICE (or the
 * shop's own heading), who sold it, item columns, totals, payments and balance, then the slogan.
 */
function ReceiptDocument({ receipt }: { receipt: PrintableReceipt }) {
  const shop = receipt.receipt;
  const { summary } = receipt;
  const itemCount = summary.lines.reduce((count, line) => count + line.quantity, 0);
  const change = Math.max(0, summary.paid - summary.total);
  const due = Math.max(0, summary.total - summary.paid);

  return (
    <article className="thermal-receipt">
      <header>
        <h1>{shop.businessName}</h1>
        {shop.address ? <p>{shop.address}</p> : null}
        {shop.email ? <p className="as-typed">{shop.email}</p> : null}
        {shop.website ? <p className="as-typed">{shop.website}</p> : null}
        {shop.phone ? <p>{shop.phone}</p> : null}
        {shop.taxId ? <p>Tax ID: {shop.taxId}</p> : null}
      </header>

      <h2>{(shop.title || "SALES INVOICE").toUpperCase()}{receipt.label === "Reprint" ? " (REPRINT)" : ""}</h2>

      <dl className="receipt-meta">
        {shop.branchName ? <><dt>BRANCH</dt><dd>{shop.branchName.toUpperCase()}</dd></> : null}
        <dt>ACCOUNT</dt><dd>{receipt.customerName ? receipt.customerName.toUpperCase() : "(WALK-IN CUSTOMER)"}</dd>
        <dt>SOLD BY</dt><dd>{(shop.cashierName ?? receipt.cashierId).toUpperCase()}</dd>
        <dt>INVOICE NO</dt><dd>{receipt.saleId}</dd>
        {receipt.tableLabel ? <><dt>TABLE</dt><dd>{receipt.tableLabel}</dd></> : null}
        {shop.terminalName ? <><dt>TILL</dt><dd>{shop.terminalName.toUpperCase()}</dd></> : null}
        <dt>DATE</dt><dd>{receiptDate(receipt.createdAt)}</dd>
        <dt>CURRENCY</dt><dd>{shop.currency}</dd>
      </dl>

      <table className="receipt-items">
        <thead>
          <tr><th>ITEM</th><th>QTY</th><th>PRICE</th><th>AMOUNT</th></tr>
        </thead>
        <tbody>
          {summary.lines.map((line) => (
            <tr key={`${line.productId}-${line.name}`}>
              <td>{line.name.toUpperCase()}{line.discount ? <small>LESS DISCOUNT -{amount(line.discount)}</small> : null}</td>
              <td>{line.quantity}</td>
              <td>{amount(Math.round(line.subtotal / line.quantity))}</td>
              <td>{amount(line.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="receipt-totals">
        <dt>SUB TOTAL</dt><dd>{amount(summary.subtotal)}</dd>
        {summary.discount ? <><dt>DISCOUNT</dt><dd>-{amount(summary.discount)}</dd></> : null}
        {summary.serviceCharge ? <><dt>SERVICE CHARGE</dt><dd>{amount(summary.serviceCharge)}</dd></> : null}
        {summary.vat ? <><dt>VAT</dt><dd>{amount(summary.vat)}</dd></> : null}
        <dt className="grand">TOTAL ({itemCount})</dt><dd className="grand">{amount(summary.total)}</dd>
      </dl>

      <dl className="receipt-totals receipt-payments">
        {receipt.payments.map((payment, index) => (
          <Fragment key={`${payment.method}-${index}`}>
            <dt>{methodLabel(payment.method)}{payment.reference ? <small>REF {payment.reference}</small> : null}</dt><dd>{amount(payment.amount)}</dd>
          </Fragment>
        ))}
        <dt>INVOICE TOTAL</dt><dd>-{amount(summary.total)}</dd>
        {change ? <><dt>CHANGE</dt><dd>{amount(change)}</dd></> : null}
        <dt className="grand">INVOICE BALANCE</dt><dd className="grand">{amount(due)}</dd>
      </dl>

      <footer>
        {shop.footer ? <p>{shop.footer}</p> : null}
        <small>Powered by Ajoke POS</small>
      </footer>
    </article>
  );
}

/** The whole printable page, as HTML. */
export function receiptHtml(receipt: PrintableReceipt) {
  const markup = renderToStaticMarkup(<ReceiptDocument receipt={receipt} />);
  return `<!doctype html>
<html>
  <head>
    <title>${receipt.label ?? "Receipt"} ${receipt.saleId}</title>
    <style>
      * { box-sizing: border-box; }
      body { background: #f4f5f6; color: #111; font-family: "Courier New", Courier, monospace; margin: 0; padding: 16px; }
      .thermal-receipt { background: #fff; font-size: 12px; line-height: 1.35; margin: 0 auto; max-width: 320px; padding: 14px; }
      header { text-align: center; }
      header h1 { font-size: 16px; letter-spacing: 1px; margin: 0 0 4px; text-transform: uppercase; }
      header p { margin: 1px 0; text-transform: uppercase; }
      header p.as-typed { text-transform: none; }
      h2 { font-size: 20px; letter-spacing: 1px; margin: 14px 0 8px; }
      dl { display: grid; gap: 1px 6px; margin: 0; }
      dd { margin: 0; }
      .receipt-meta { grid-template-columns: max-content 1fr; }
      .receipt-meta dt { white-space: nowrap; }
      .receipt-meta dt::after { content: " :"; }
      .receipt-items { border-collapse: collapse; margin-top: 10px; width: 100%; }
      .receipt-items th, .receipt-items td { font-size: 11px; padding: 2px 0; text-align: right; vertical-align: top; }
      .receipt-items th:first-child, .receipt-items td:first-child { text-align: left; width: 46%; }
      .receipt-items thead th { border-bottom: 1px dashed #111; border-top: 1px dashed #111; font-weight: normal; }
      .receipt-items tbody tr:last-child td { border-bottom: 1px dashed #111; padding-bottom: 6px; }
      .receipt-items small, dt small { display: block; font-size: 10px; }
      .receipt-totals { grid-template-columns: 1fr auto; margin-top: 8px; }
      .receipt-totals dd { text-align: right; }
      .receipt-totals .grand { border-bottom: 3px double #111; font-weight: bold; padding-bottom: 2px; }
      .receipt-payments { border-top: 1px dashed #111; padding-top: 8px; }
      footer { border-top: 1px dashed #111; margin-top: 12px; padding-top: 8px; text-align: center; }
      footer p { font-style: italic; margin: 0 0 4px; }
      footer small { color: #555; font-size: 10px; }
      @media print {
        @page { margin: 4mm; size: 80mm auto; }
        body { background: #fff; padding: 0; }
        .thermal-receipt { max-width: none; padding: 0; width: 72mm; }
      }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

export function printReceipt(receipt: PrintableReceipt) {
  const printWindow = window.open("", "_blank", "width=420,height=720");

  if (!printWindow) {
    return false;
  }

  printWindow.document.write(receiptHtml(receipt));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();

  return true;
}
