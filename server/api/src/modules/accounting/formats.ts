import type { LedgerGroup, Voucher } from "./vouchers";

/**
 * Files for the accountant: Tally's XML import (Gateway of Tally > Import > Transactions) and
 * a CSV day book for Excel, QuickBooks, Sage or any other package.
 */

function xml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Smallest units to a plain decimal string ("1234.50"), as Tally and spreadsheets expect. */
export function decimalAmount(amount: number, decimals: number) {
  const value = amount / 10 ** decimals;
  return value.toFixed(Math.max(decimals, 2));
}

function tallyEnvelope(report: "All Masters" | "Vouchers", messages: string[], company?: string) {
  const companyVariable = company ? `
        <STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : "";
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${report}</REPORTNAME>${companyVariable}
      </REQUESTDESC>
      <REQUESTDATA>
${messages.join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

/**
 * Tally ledger masters (Gateway of Tally > Import > Masters), imported once before the first
 * vouchers. Tally reports ledgers that already exist and creates the rest.
 */
export function tallyLedgersXml(ledgers: Map<string, LedgerGroup>, company?: string) {
  const messages = [...ledgers].map(
    ([name, group]) => `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${xml(name)}" ACTION="Create">
            <NAME.LIST><NAME>${xml(name)}</NAME></NAME.LIST>
            <PARENT>${xml(group)}</PARENT>
            <ISBILLWISEON>${group === "Sundry Debtors" || group === "Sundry Creditors" ? "Yes" : "No"}</ISBILLWISEON>
          </LEDGER>
        </TALLYMESSAGE>`
  );
  return tallyEnvelope("All Masters", messages, company);
}

/**
 * Tally vouchers (Gateway of Tally > Import > Transactions). Debits are negative amounts with
 * ISDEEMEDPOSITIVE "Yes"; credits positive with "No".
 */
export function tallyVouchersXml(vouchers: Voucher[], options: { company?: string; decimals: number }) {
  const amount = (value: number) => decimalAmount(value, options.decimals);
  const messages = vouchers.map((voucher) => {
    const lines = voucher.lines
      .map(
        (line) => `            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${xml(line.ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>${line.amount > 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
              <AMOUNT>${amount(-line.amount)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`
      )
      .join("\n");
    return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${xml(voucher.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${voucher.date.replace(/-/g, "")}</DATE>
            <VOUCHERTYPENAME>${xml(voucher.type)}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${xml(voucher.number)}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${xml(voucher.party)}</PARTYLEDGERNAME>
            <NARRATION>${xml(voucher.narration)}</NARRATION>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
${lines}
          </VOUCHER>
        </TALLYMESSAGE>`;
  });
  return tallyEnvelope("Vouchers", messages, options.company);
}

/** One row per ledger line: date, voucher type and number, ledger, debit, credit, narration. */
export function dayBookCsv(vouchers: Voucher[], options: { decimals: number; branchName(branchId: string): string }) {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const amount = (value: number) => decimalAmount(value, options.decimals);
  const rows = [["Date", "Voucher type", "Voucher no.", "Branch", "Ledger", "Debit", "Credit", "Narration"]];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      rows.push([voucher.date, voucher.type, voucher.number, options.branchName(voucher.branchId), line.ledger, line.amount > 0 ? amount(line.amount) : "", line.amount < 0 ? amount(-line.amount) : "", voucher.narration]);
    }
  }
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
