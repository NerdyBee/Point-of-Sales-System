import type { CompletedSale, Quotation, TenantSettings } from "../api/client";

/** A4 business documents: quotation, proforma invoice and credit note. */

export type DocumentBusiness = Pick<TenantSettings, "businessName" | "address" | "phone" | "taxId">;
type Money = (amount: number) => string;

function escape(value: string | number) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function documentDate(value: string) {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

interface DocumentParts {
  title: string;
  heading: string;
  meta: [string, string][];
  to: string[];
  rows: { description: string; quantity?: number; unit?: number; discount?: number; amount: number }[];
  totals: [string, number, boolean?][];
  notes: string[];
}

function documentHtml(parts: DocumentParts, business: DocumentBusiness, money: Money) {
  const amount = (value?: number) => (value ? money(value) : "");
  // A discount column only when something was discounted.
  const discounted = parts.rows.some((row) => row.discount);
  const discountCell = (row: DocumentParts["rows"][number]) => (discounted ? `<td class="n">${amount(row.discount)}</td>` : "");
  const rows = parts.rows
    .map((row, index) => `<tr><td>${index + 1}</td><td>${escape(row.description)}</td><td class="n">${row.quantity ?? ""}</td><td class="n">${amount(row.unit)}</td>${discountCell(row)}<td class="n">${money(row.amount)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escape(parts.title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { color: #111; font-family: Arial, sans-serif; margin: 0; padding: 28px; font-size: 12px; }
      header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 18px; margin: 0 0 6px; letter-spacing: 1px; }
      p { margin: 2px 0; }
      .right { text-align: right; }
      .to { margin-bottom: 14px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f2f2f2; text-transform: uppercase; font-size: 11px; }
      .n { text-align: right; white-space: nowrap; }
      .totals { margin-left: auto; margin-top: 10px; width: 320px; }
      .totals td { border: none; padding: 4px 8px; }
      .grand td { border-top: 2px solid #111; border-bottom: 3px double #111; font-weight: bold; font-size: 14px; }
      .notes { margin-top: 20px; }
      .sign { display: flex; justify-content: space-between; gap: 40px; margin-top: 48px; }
      .sign div { border-top: 1px solid #111; flex: 1; padding-top: 4px; }
      @media print { body { padding: 0; } }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>${escape(business.businessName)}</h1>
        ${business.address ? `<p>${escape(business.address)}</p>` : ""}
        ${business.phone ? `<p>Tel: ${escape(business.phone)}</p>` : ""}
        ${business.taxId ? `<p>TIN: ${escape(business.taxId)}</p>` : ""}
      </div>
      <div class="right">
        <h2>${escape(parts.heading)}</h2>
        ${parts.meta.map(([label, value]) => `<p>${escape(label)}: <strong>${escape(value)}</strong></p>`).join("")}
      </div>
    </header>
    <div class="to">${parts.to.map((line, index) => (index === 0 ? `<p><strong>${escape(line)}</strong></p>` : `<p>${escape(line)}</p>`)).join("")}</div>
    <table>
      <thead><tr><th>#</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th>${discounted ? '<th class="n">Discount</th>' : ""}<th class="n">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals"><tbody>
      ${parts.totals.map(([label, value, grand]) => `<tr${grand ? ' class="grand"' : ""}><td>${escape(label)}</td><td class="n">${money(value)}</td></tr>`).join("")}
    </tbody></table>
    <div class="notes">${parts.notes.filter(Boolean).map((note) => `<p>${escape(note)}</p>`).join("")}</div>
    <div class="sign"><div>Prepared by</div><div>Customer's acceptance</div></div>
  </body>
</html>`;
}

const chargeTotals = (summary: Quotation["summary"]): [string, number, boolean?][] =>
  [
    ["Subtotal", summary.subtotal] as [string, number],
    ...(summary.discount ? [["Discount", -summary.discount] as [string, number]] : []),
    ...(summary.serviceCharge ? [["Service charge", summary.serviceCharge] as [string, number]] : []),
    ...(summary.vat ? [["VAT", summary.vat] as [string, number]] : []),
    ["Total", summary.total, true]
  ];

/** Quotation or proforma invoice. */
export function quotationHtml(quote: Quotation, business: DocumentBusiness, money: Money) {
  const proforma = quote.kind === "proforma";
  return documentHtml(
    {
      title: `${proforma ? "Proforma invoice" : "Quotation"} ${quote.number}`,
      heading: proforma ? "PROFORMA INVOICE" : "QUOTATION",
      meta: [
        [proforma ? "Proforma no." : "Quote no.", quote.number],
        ["Date", documentDate(quote.createdAt)],
        ["Valid until", documentDate(quote.validUntil)]
      ],
      to: [`To: ${quote.customerName}`, quote.customerPhone, quote.customerEmail].filter(Boolean),
      rows: quote.summary.lines.map((line) => ({
        description: line.name,
        quantity: line.quantity,
        unit: Math.round(line.subtotal / line.quantity),
        discount: line.discount,
        amount: line.subtotal - line.discount
      })),
      totals: chargeTotals(quote.summary),
      notes: [
        quote.note,
        `Prices are valid until ${documentDate(quote.validUntil)}.`,
        proforma ? "This proforma invoice is not a receipt. Goods are released when payment is received." : "This is a quotation, not an invoice."
      ]
    },
    business,
    money
  );
}

/** Credit note for a refund or void: what is given back against the original invoice. */
export function creditNoteHtml(sale: CompletedSale, business: DocumentBusiness, money: Money) {
  const voided = sale.status === "voided";
  const credited = voided ? sale.summary.total : sale.refundTotal;
  const whole = voided || credited >= sale.summary.total;
  const vatShare = sale.summary.total ? Math.round((sale.summary.vat * credited) / sale.summary.total) : 0;
  return documentHtml(
    {
      title: `Credit note CN-${sale.id}`,
      heading: "CREDIT NOTE",
      meta: [
        ["Credit note no.", `CN-${sale.id}`],
        ["Date", documentDate(sale.updatedAt)],
        ["Against invoice", sale.id],
        ["Invoice date", documentDate(sale.createdAt)]
      ],
      to: [`To: ${sale.customer?.name ?? "Walk-in customer"}`, sale.customer?.phone ?? ""].filter(Boolean),
      rows: whole
        ? sale.summary.lines.map((line) => ({ description: line.name, quantity: line.quantity, unit: Math.round(line.subtotal / line.quantity), discount: line.discount, amount: line.subtotal - line.discount }))
        : [{ description: `Part refund against invoice ${sale.id}`, amount: credited - vatShare }],
      totals: whole
        ? chargeTotals(sale.summary).map(([label, value, grand]) => [grand ? "Total credited" : label, value, grand])
        : [...(vatShare ? [["VAT credited", vatShare] as [string, number]] : []), ["Total credited", credited, true]],
      notes: [`Reason: ${(voided ? sale.voidReason : sale.refundReason) || "Not given"}`, voided ? "The whole invoice was cancelled." : ""]
    },
    business,
    money
  );
}

/** A print window, opened during the click so popup blockers allow it; filled in later. */
export function openPrintWindow() {
  return window.open("", "_blank", "width=900,height=900");
}

/** Prints a document, in `printWindow` if one was opened already. Returns an error message, or "". */
export function printDocument(html: string, printWindow: Window | null = openPrintWindow()) {
  if (!printWindow) return "Allow popups to print";
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return "";
}
