import { FileSpreadsheet, Printer, Receipt } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadTaxReturnCsv, fetchBranchOptions, fetchTaxReturn, type BranchOption, type TaxReturn } from "../../shared/api/client";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import { documentDate, printDocument } from "../../shared/utils/documentPrint";

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escape(value: string | number) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The VAT lines as [label, value excl. VAT, VAT, bold]. */
export function vatLines(vat: TaxReturn["vat"]): [string, number | null, number | null, boolean][] {
  return [
    ["Sales with VAT", vat.sales.vatableValue, vat.sales.vat, false],
    ["Zero-rated / exempt sales", vat.sales.nonVatValue, null, false],
    ["Less refunds and voids", -vat.returns.value, -vat.returns.vat, false],
    ["Output VAT", null, vat.outputVat, true],
    ["Purchases (supplier invoices)", vat.purchases.value, vat.purchases.vat, false],
    ["Expenses", vat.expenses.value, vat.expenses.vat, false],
    ["Input VAT", null, vat.inputVat, true],
    [vat.netVat >= 0 ? "VAT payable" : "VAT credit carried forward", null, Math.abs(vat.netVat), true]
  ];
}

/**
 * VAT return and withholding tax on the Reports page: what to declare and pay for a period,
 * from the same records as the accountant's export.
 */
export function TaxReturnPanel() {
  const { settings, displayMoney } = useTenantSettings();
  const now = new Date();
  const [from, setFrom] = useState(() => localDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const [to, setTo] = useState(() => localDay(new Date(now.getFullYear(), now.getMonth(), 0)));
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [result, setResult] = useState<TaxReturn | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void fetchBranchOptions().then((response) => setBranches(response.branches), () => undefined);
  }, []);

  useEffect(() => {
    setStatus("");
    void fetchTaxReturn(from, to, branchId).then(setResult, (error: Error) => {
      setResult(null);
      setStatus(error.message);
    });
  }, [from, to, branchId]);

  const money = (value: number | null) => (value === null ? "" : displayMoney(value));
  const branchLabel = branches.find((branch) => branch.id === branchId)?.name ?? "All branches";

  function print() {
    if (!result || !settings) return;
    const vatRows = vatLines(result.vat)
      .map(([label, value, vat, bold]) => `<tr${bold ? ' class="b"' : ""}><td>${escape(label)}</td><td class="n">${money(value)}</td><td class="n">${money(vat)}</td></tr>`)
      .join("");
    const whtRows = result.withholding.rows
      .map((row) => `<tr><td>${documentDate(row.date)}</td><td>${escape(row.payee)}</td><td>${escape(row.reference)}</td><td class="n">${money(row.gross)}</td><td class="n">${money(row.withheld)}</td></tr>`)
      .join("");
    setStatus(
      printDocument(`<!doctype html><html><head><meta charset="utf-8" /><title>VAT and WHT ${from} to ${to}</title><style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 28px; }
        h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 22px 0 6px; } p { margin: 2px 0; color: #444; }
        table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; } .n { text-align: right; } .b td { font-weight: bold; }
      </style></head><body>
        <h1>${escape(settings.businessName)}</h1>
        ${settings.taxId ? `<p>TIN: ${escape(settings.taxId)}</p>` : ""}
        <p>VAT return and withholding tax, ${documentDate(from)} to ${documentDate(to)} · ${escape(branchLabel)}</p>
        <h2>VAT</h2><table><thead><tr><th></th><th class="n">Value (excl. VAT)</th><th class="n">VAT</th></tr></thead><tbody>${vatRows}</tbody></table>
        <h2>Withholding tax deducted</h2><table><thead><tr><th>Date</th><th>Payee</th><th>Reference</th><th class="n">Gross</th><th class="n">WHT</th></tr></thead>
        <tbody>${whtRows || '<tr><td colspan="5">None in this period</td></tr>'}<tr class="b"><td colspan="4">Total to pay to the tax office</td><td class="n">${money(result.withholding.total)}</td></tr></tbody></table>
      </body></html>`) || "Opened for printing"
    );
  }

  async function downloadCsv() {
    try {
      setStatus(`Downloaded ${await downloadTaxReturnCsv(from, to, branchId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Download failed");
    }
  }

  return (
    <section className="panel accountant-export">
      <div className="panel-header">
        <h2>VAT and withholding tax</h2>
        <Receipt size={20} />
      </div>
      <p className="muted-text">
        What to declare for the period: VAT charged on sales less VAT paid on purchases and expenses, and the withholding tax kept back from suppliers and vendors.
        {settings?.currency === "NGN" ? " In Nigeria both are due by the 21st of the following month." : ""}
      </p>
      <div className="accountant-export-controls">
        <label>
          From
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </label>
        {branches.length > 1 ? (
          <label>
            Branch
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">All branches</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {result ? (
        <div className="tax-return-grid">
          <table className="data-table">
            <thead><tr><th>VAT</th><th>Value (excl. VAT)</th><th>VAT</th></tr></thead>
            <tbody>
              {vatLines(result.vat).map(([label, value, vat, bold]) => (
                <tr key={label} className={bold ? "tax-return-total" : undefined}><td>{label}</td><td>{money(value)}</td><td>{money(vat)}</td></tr>
              ))}
            </tbody>
          </table>
          <table className="data-table">
            <thead><tr><th>Withholding tax</th><th>Gross</th><th>WHT</th></tr></thead>
            <tbody>
              {result.withholding.rows.length ? result.withholding.rows.map((row, index) => (
                <tr key={`${row.date}-${index}`}><td>{row.payee}<small className="muted-text"> {documentDate(row.date)} · {row.reference}</small></td><td>{money(row.gross)}</td><td>{money(row.withheld)}</td></tr>
              )) : <tr><td colSpan={3}>No withholding tax deducted in this period.</td></tr>}
              <tr className="tax-return-total"><td>Total to pay</td><td /><td>{money(result.withholding.total)}</td></tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="button-group">
        <button className="secondary-button" disabled={!result} onClick={print}><Printer size={16} /> Print</button>
        <button className="secondary-button" disabled={!result} onClick={() => void downloadCsv()}><FileSpreadsheet size={16} /> CSV</button>
      </div>
      <p className="muted-text">Enter VAT included on supplier invoices and expenses, and withholding tax when paying suppliers and expenses, so they count here.</p>
      {status ? <p className="muted-text">{status}</p> : null}
    </section>
  );
}
