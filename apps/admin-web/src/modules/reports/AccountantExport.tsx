import { Download, FileSpreadsheet, Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadAccountingExport, fetchAccountingSummary, fetchBranchOptions, type AccountingExportSummary, type BranchOption } from "../../shared/api/client";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const voucherLabels: Record<string, string> = {
  Sales: "Sales",
  "Credit Note": "Refunds and voids",
  Receipt: "Customer payments",
  Purchase: "Supplier invoices",
  Payment: "Payments (suppliers and expenses)"
};

/**
 * "Export for accountant" on the Reports page: a period's sales, refunds, customer payments,
 * supplier invoices and payments, and expenses as Tally import files or a CSV day book.
 */
export function AccountantExport() {
  const { displayMoney } = useTenantSettings();
  const now = new Date();
  // Accountants usually work month by month: last month by default.
  const [from, setFrom] = useState(() => localDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const [to, setTo] = useState(() => localDay(new Date(now.getFullYear(), now.getMonth(), 0)));
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [summary, setSummary] = useState<AccountingExportSummary | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void fetchBranchOptions().then((response) => setBranches(response.branches), () => undefined);
  }, []);

  useEffect(() => {
    setStatus("");
    void fetchAccountingSummary(from, to, branchId).then(setSummary, (error: Error) => {
      setSummary(null);
      setStatus(error.message);
    });
  }, [from, to, branchId]);

  async function download(format: "tally" | "tally-ledgers" | "csv") {
    setBusy(format);
    try {
      setStatus(`Downloaded ${await downloadAccountingExport(format, from, to, branchId)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel accountant-export">
      <div className="panel-header">
        <h2>Export for accountant</h2>
        <Landmark size={20} />
      </div>
      <p className="muted-text">
        Sales, refunds, customer payments, supplier invoices and payments, and expenses for the period, as accounting vouchers.
        Each event is dated the day it happened. Ledger names are set in Settings under Accounting export.
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

      {summary ? (
        summary.voucherCount ? (
          <table className="data-table accountant-export-summary">
            <thead>
              <tr><th>Vouchers</th><th>Count</th><th>Value</th></tr>
            </thead>
            <tbody>
              {Object.entries(summary.byType).map(([type, totals]) => (
                <tr key={type}><td>{voucherLabels[type] ?? type}</td><td>{totals.count}</td><td>{displayMoney(totals.total)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted-text">Nothing to export in this period.</p>
        )
      ) : null}

      <div className="accountant-export-actions">
        <div>
          <strong>Tally</strong>
          <small>Import in Tally: Gateway of Tally, Import, Masters (ledgers file, first time only), then Import, Transactions (vouchers file).{summary?.tallyCompany ? ` Company: ${summary.tallyCompany}.` : ""}</small>
          <div className="button-group">
            <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void download("tally-ledgers")}><Download size={16} /> 1. Ledgers</button>
            <button className="primary-button" disabled={Boolean(busy) || !summary?.voucherCount} onClick={() => void download("tally")}><Download size={16} /> 2. Vouchers</button>
          </div>
        </div>
        <div>
          <strong>Excel, QuickBooks, Sage and others</strong>
          <small>A day book: one row per ledger line with debit and credit.</small>
          <div className="button-group">
            <button className="secondary-button" disabled={Boolean(busy) || !summary?.voucherCount} onClick={() => void download("csv")}><FileSpreadsheet size={16} /> Day book (CSV)</button>
          </div>
        </div>
      </div>
      {status ? <p className="muted-text">{status}</p> : null}
    </section>
  );
}
