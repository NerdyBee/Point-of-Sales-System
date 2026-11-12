import { fetchCustomerStatement, type CustomerStatement, type TenantSettings } from "../../shared/api/client";

export type StatementBusiness = Pick<TenantSettings, "businessName" | "address" | "phone" | "taxId">;

function escape(value: string | number) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function day(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

/** A printable statement of account: what the customer owed, each movement, what they owe now. */
export function statementHtml(statement: CustomerStatement, business: StatementBusiness, money: (amount: number) => string) {
  const amount = (value: number) => (value ? money(value) : "");
  const rows = statement.lines
    .map((line) => `<tr><td>${day(line.date)}</td><td>${escape(line.description)}</td><td class="n">${amount(line.debit)}</td><td class="n">${amount(line.credit)}</td><td class="n">${money(line.balance)}</td></tr>`)
    .join("");
  const ageing = statement.ageing;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Statement - ${escape(statement.customer.name)}</title>
    <style>
      * { box-sizing: border-box; }
      body { color: #111; font-family: Arial, sans-serif; margin: 0; padding: 28px; font-size: 12px; }
      header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 18px; margin: 0; letter-spacing: 1px; }
      p { margin: 2px 0; }
      .right { text-align: right; }
      .to { margin-bottom: 14px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f2f2f2; text-transform: uppercase; font-size: 11px; }
      .n { text-align: right; white-space: nowrap; }
      .forward td, .due td { font-weight: bold; }
      .due td { border-top: 2px solid #111; border-bottom: 3px double #111; }
      .ageing { margin-top: 18px; }
      .ageing th, .ageing td { text-align: right; }
      footer { margin-top: 24px; color: #555; }
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
        <h2>STATEMENT OF ACCOUNT</h2>
        <p>${day(statement.from)} to ${day(statement.to)}</p>
        <p>Printed ${day(new Date().toISOString())}</p>
      </div>
    </header>
    <div class="to">
      <p><strong>To: ${escape(statement.customer.name)}</strong></p>
      ${statement.customer.phone ? `<p>${escape(statement.customer.phone)}</p>` : ""}
      ${statement.customer.email ? `<p>${escape(statement.customer.email)}</p>` : ""}
      ${statement.customer.creditLimit ? `<p>Credit limit: ${money(statement.customer.creditLimit)}</p>` : ""}
    </div>
    <table>
      <thead><tr><th>Date</th><th>Details</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead>
      <tbody>
        <tr class="forward"><td>${day(statement.from)}</td><td>Balance brought forward</td><td></td><td></td><td class="n">${money(statement.openingBalance)}</td></tr>
        ${rows || `<tr><td></td><td>No transactions in this period</td><td></td><td></td><td></td></tr>`}
        <tr class="due"><td>${day(statement.to)}</td><td>Balance due</td><td></td><td></td><td class="n">${money(statement.closingBalance)}</td></tr>
      </tbody>
    </table>
    <table class="ageing">
      <thead><tr><th>Current (0-30 days)</th><th>31-60 days</th><th>61-90 days</th><th>Over 90 days</th><th>Total due today</th></tr></thead>
      <tbody><tr><td>${money(ageing.current)}</td><td>${money(ageing.days31to60)}</td><td>${money(ageing.days61to90)}</td><td>${money(ageing.over90)}</td><td><strong>${money(statement.customer.outstandingBalance)}</strong></td></tr></tbody>
    </table>
    <footer>Please contact us if anything on this statement does not agree with your records.</footer>
  </body>
</html>`;
}

/** Fetches a customer's statement and opens it in a print window. Returns an error message, or "". */
export async function printCustomerStatement(customerId: string, from: string, to: string, business: StatementBusiness, money: (amount: number) => string) {
  const printWindow = window.open("", "_blank", "width=900,height=900");
  if (!printWindow) return "Allow popups to print the statement";
  try {
    const statement = await fetchCustomerStatement(customerId, from, to);
    printWindow.document.write(statementHtml(statement, business, money));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    return "";
  } catch (error) {
    printWindow.close();
    return error instanceof Error ? error.message : "Could not load the statement";
  }
}
