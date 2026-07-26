import { renderToStaticMarkup } from "react-dom/server";
import type { PaymentRecord, PaymentMethodCode, SaleReceiptSnapshot } from "../../shared/api/client";
import { formatMoney } from "../../shared/utils/money";
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
  return method.replace("_", " ");
}

function ReceiptDocument({ receipt }: { receipt: PrintableReceipt }) {
  const money = (amount: number) => formatMoney(amount, receipt.receipt.currency);

  return (
    <article className="thermal-receipt">
      <header>
        <h1>{receipt.receipt.businessName}</h1>
        {receipt.receipt.taxId ? <p>{receipt.receipt.taxId}</p> : null}
        <strong>{receipt.label ?? "Receipt"} #{receipt.saleId}</strong>
        <span>{new Date(receipt.createdAt).toLocaleString()}</span>
      </header>

      <section className="receipt-meta">
        <span>Terminal</span><b>{receipt.terminalId}</b>
        <span>Cashier</span><b>{receipt.cashierId}</b>
        <span>Customer</span><b>{receipt.customerName ?? "Walk-in"}</b>
        {receipt.tableLabel ? <><span>Table</span><b>{receipt.tableLabel}</b></> : null}
      </section>

      <section className="receipt-lines">
        {receipt.summary.lines.map((line) => (
          <div key={`${line.productId}-${line.name}`}>
            <strong>{line.name}</strong>
            <span>{line.quantity} x {money(Math.round(line.subtotal / line.quantity))}</span>
            <b>{money(line.total)}</b>
          </div>
        ))}
      </section>

      <section className="receipt-totals">
        <span>Subtotal</span><b>{money(receipt.summary.subtotal)}</b>
        <span>Discount</span><b>-{money(receipt.summary.discount)}</b>
        <span>Service charge</span><b>{money(receipt.summary.serviceCharge)}</b>
        <span>VAT</span><b>{money(receipt.summary.vat)}</b>
        <strong>Total</strong><strong>{money(receipt.summary.total)}</strong>
        <span>Paid</span><b>{money(receipt.summary.paid)}</b>
        <span>Balance</span><b>{money(receipt.summary.balance)}</b>
      </section>

      <section className="receipt-payments">
        {receipt.payments.map((payment, index) => (
          <div key={`${payment.method}-${index}`}>
            <span>{methodLabel(payment.method)}</span>
            <b>{money(payment.amount)}</b>
            {payment.reference ? <em>{payment.reference}</em> : null}
          </div>
        ))}
      </section>

      <footer>
        <p>{receipt.receipt.footer}</p>
        <span>{receipt.receipt.printerName ?? "Browser print"}</span>
      </footer>
    </article>
  );
}

export function printReceipt(receipt: PrintableReceipt) {
  const markup = renderToStaticMarkup(<ReceiptDocument receipt={receipt} />);
  const printWindow = window.open("", "_blank", "width=420,height=720");

  if (!printWindow) {
    return false;
  }

  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>${receipt.label ?? "Receipt"} ${receipt.saleId}</title>
    <style>
      * { box-sizing: border-box; }
      body { background: #f4f5f6; color: #111; font-family: "Courier New", monospace; margin: 0; padding: 16px; }
      .thermal-receipt { background: #fff; margin: 0 auto; max-width: 320px; padding: 14px; }
      header, footer { text-align: center; }
      h1 { font-size: 18px; margin: 0 0 4px; text-transform: uppercase; }
      p, span, b, strong, em { font-size: 12px; }
      header p, header span, footer span, footer p { display: block; margin: 2px 0; }
      header strong { border-top: 1px dashed #111; display: block; margin-top: 10px; padding-top: 10px; }
      section { border-top: 1px dashed #111; margin-top: 10px; padding-top: 10px; }
      .receipt-meta, .receipt-totals { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; }
      .receipt-lines div, .receipt-payments div { display: grid; gap: 2px; grid-template-columns: 1fr auto; margin-bottom: 8px; }
      .receipt-lines strong { grid-column: 1 / -1; }
      .receipt-lines span, .receipt-payments em { color: #555; }
      .receipt-payments em { grid-column: 1 / -1; font-style: normal; }
      .receipt-totals strong { font-size: 14px; }
      footer { border-top: 1px dashed #111; margin-top: 10px; padding-top: 10px; }
      @media print {
        @page { margin: 4mm; size: 80mm auto; }
        body { background: #fff; padding: 0; }
        .thermal-receipt { max-width: none; padding: 0; width: 72mm; }
      }
    </style>
  </head>
  <body>${markup}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();

  return true;
}
