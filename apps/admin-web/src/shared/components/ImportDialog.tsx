import { Check, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { fetchBranchOptions, importSpreadsheetRows, readStoredAuth, type BranchOption, type ImportKind, type ImportResult } from "../api/client";
import { downloadCsv, readSpreadsheet, type SheetRow } from "../utils/spreadsheet";

interface ImportGuide {
  title: string;
  intro: string;
  template: (string | number)[][];
  notes: string[];
}

/** What each import expects, with a template the shop can fill in Excel. */
export const importGuides: Record<ImportKind, ImportGuide> = {
  products: {
    title: "Import products",
    intro: "One product per row. Name, Category and Price are needed; everything else is optional.",
    template: [
      ["Name", "Category", "Price", "Cost", "Stock", "Reorder point", "SKU", "Barcode", "VAT %"],
      ["Golden Penny Semovita 2kg", "Groceries", 3500, 2900, 40, 10, "", "", 7.5],
      ["Peak Milk Tin 400g", "Groceries", 2200, 1800, 60, 12, "", "", ""]
    ],
    notes: [
      "Blank SKU: one is made from the category (e.g. GRO-0001). A SKU already in this branch updates that product's name, prices and category.",
      "Stock is the opening stock for new products. Existing products keep their stock: use a stock count to change it.",
      "New categories are added for you. Products get a plain picture until you upload one."
    ]
  },
  customers: {
    title: "Import customers",
    intro: "One customer per row. Name and Phone are needed. Phone numbers find customers already saved.",
    template: [
      ["Name", "Phone", "Email", "Group", "Credit limit", "Opening balance", "Balance date", "Notes"],
      ["Nneka Foods Ltd", "08033333333", "orders@nnekafoods.example", "Wholesale", 250000, 125000, "01/08/2026", "Monthly statement"],
      ["Amina Bello", "08011111111", "", "VIP", 0, 0, "", ""]
    ],
    notes: [
      "Opening balance: what the customer already owed when you started using Ajoke POS. Balance date is when it was owed from (DD/MM/YYYY), so the debtors report ages it correctly.",
      "Groups: Walk-in, VIP, Credit account, Wholesale or Staff. Left blank, customers with credit are put in Credit account.",
      "Customers already saved (same phone) are updated; their balance is not changed."
    ]
  },
  "supplier-balances": {
    title: "Import supplier balances",
    intro: "What you owed suppliers when you started: one unpaid invoice per row. Add the suppliers first.",
    template: [
      ["Supplier", "Invoice number", "Invoice date", "Due date", "Amount", "VAT", "Note"],
      ["Valley Farms", "VF-2041", "30/09/2026", "30/10/2026", 80000, 0, "Opening balance"]
    ],
    notes: ["Supplier names must match suppliers already set up in this branch.", "Each row becomes an unpaid supplier invoice, aged in the creditors report from its due date."]
  }
};

interface ImportDialogProps {
  kind: ImportKind;
  onClose(): void;
  /** Called after rows were saved, to reload the screen behind. */
  onImported(): void;
  defaultBranchId?: string;
}

/**
 * Pick an Excel or CSV file, see every row checked (nothing saved), then import the good rows.
 */
export function ImportDialog({ kind, onClose, onImported, defaultBranchId }: ImportDialogProps) {
  const guide = importGuides[kind];
  const auth = readStoredAuth();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState(defaultBranchId || auth?.session.branchId || auth?.staff.branchId || "");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchBranchOptions().then((response) => {
      setBranches(response.branches);
      if (!branchId && response.branches[0]) setBranchId(response.branches[0].id);
    }, () => undefined);
  }, []);

  async function check(nextRows: SheetRow[], nextBranch = branchId) {
    if (!nextRows.length || !nextBranch) return;
    setBusy(true);
    setMessage("Checking rows...");
    try {
      setResult(await importSpreadsheetRows(kind, nextBranch, nextRows, false));
      setMessage("");
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Could not check the file");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    try {
      const records = await readSpreadsheet(file);
      if (!records.length) throw new Error("No rows found under the header row");
      if (records.length > 5000) throw new Error(`The file has ${records.length.toLocaleString()} rows; import at most 5,000 at a time`);
      setRows(records);
      await check(records);
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "Could not read the file");
    }
  }

  async function commit() {
    setBusy(true);
    setMessage("Importing...");
    try {
      const saved = await importSpreadsheetRows(kind, branchId, rows, true);
      setResult(saved);
      setMessage(`Done: ${saved.created} added, ${saved.updated} updated${saved.skipped ? `, ${saved.skipped} skipped` : ""}.`);
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const ready = result && !result.committed ? result.created + result.updated : 0;
  const problems = result?.rows.filter((row) => row.errors.length || row.warnings.length) ?? [];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Excel (.xlsx) or CSV</p>
            <h2 id="import-title">{guide.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="import-body">
          <p>{guide.intro}</p>
          <ul className="import-notes">{guide.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          <div className="button-group">
            <button className="secondary-button" onClick={() => downloadCsv(`ajokepos-${kind}-template.csv`, guide.template)}><Download size={16} /> Template</button>
            {branches.length > 1 ? (
              <label className="toolbar-select">
                Branch
                <select value={branchId} onChange={(event) => { setBranchId(event.target.value); void check(rows, event.target.value); }}>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
            ) : null}
            <button className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} /> Choose file</button>
            <input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => void chooseFile(event)} />
          </div>

          {fileName ? <p className="muted-text"><FileSpreadsheet size={14} /> {fileName}: {rows.length.toLocaleString()} rows</p> : null}

          {result ? (
            <>
              <div className="import-summary">
                <span><strong>{result.created}</strong> {result.committed ? "added" : "to add"}</span>
                <span><strong>{result.updated}</strong> {result.committed ? "updated" : "to update"}</span>
                <span className={result.skipped ? "import-skipped" : undefined}><strong>{result.skipped}</strong> {result.committed ? "skipped" : "with problems (will be skipped)"}</span>
              </div>
              {problems.length ? (
                <div className="table-wrap import-problems">
                  <table>
                    <thead><tr><th>Row</th><th>Item</th><th>What to fix or know</th></tr></thead>
                    <tbody>
                      {problems.slice(0, 200).map((row) => (
                        <tr key={row.row}>
                          <td>{row.row}</td>
                          <td>{row.label || "-"}</td>
                          <td>
                            {row.errors.map((error) => <div key={error} className="import-error">{error}</div>)}
                            {row.warnings.map((warning) => <div key={warning} className="muted-text">{warning}</div>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {problems.length > 200 ? <p className="muted-text">and {problems.length - 200} more rows</p> : null}
                </div>
              ) : null}
            </>
          ) : null}

          {message ? <p className="muted-text">{message}</p> : null}
          <div className="form-summary">
            <span>{result && !result.committed ? "Nothing is saved until you import." : ""}</span>
            {result?.committed ? (
              <button className="primary-button" onClick={onClose}><Check size={18} /> Close</button>
            ) : (
              <button className="primary-button" disabled={busy || !ready} onClick={() => void commit()}><Check size={18} /> Import {ready || ""} rows</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
