import { FileText, HandCoins, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchCreditorsAgeing, fetchDebtorsAgeing, type CreditorAgeingRow, type DebtorAgeingRow } from "../../shared/api/client";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import { printCustomerStatement } from "../customers/statementPrint";

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * "Who owes us and who we owe" on the Reports page: customer balances and unpaid supplier
 * invoices split by age, with a printable statement for each customer.
 */
export function AgeingReports({ branchId = "" }: { branchId?: string }) {
  const { settings, displayMoney } = useTenantSettings();
  const now = new Date();
  const [statementFrom, setStatementFrom] = useState(() => localDay(new Date(now.getFullYear(), now.getMonth() - 2, 1)));
  const [statementTo, setStatementTo] = useState(() => localDay(now));
  const [debtors, setDebtors] = useState<DebtorAgeingRow[] | null>(null);
  const [creditors, setCreditors] = useState<CreditorAgeingRow[] | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    setStatus("");
    // Each list needs its own permission: show whichever this user may see.
    void fetchDebtorsAgeing().then((response) => setDebtors(response.rows), () => setDebtors(null));
    void fetchCreditorsAgeing(branchId).then((response) => setCreditors(response.rows), () => setCreditors(null));
  }, [branchId]);

  useEffect(load, [load]);

  async function printStatement(row: DebtorAgeingRow) {
    if (!settings) return;
    setStatus(await printCustomerStatement(row.customerId, statementFrom, statementTo, settings, (amount) => displayMoney(amount)));
  }

  const money = (amount: number) => (amount ? displayMoney(amount) : "-");
  if (!debtors && !creditors) return null;

  return (
    <section className="panel ageing-reports">
      <div className="panel-header">
        <h2>Who owes us and who we owe</h2>
        <button className="icon-button" onClick={load} aria-label="Refresh balances"><RefreshCcw size={18} /></button>
      </div>

      {debtors ? (
        <>
          <div className="ageing-heading">
            <h3><HandCoins size={18} /> Customers who owe (debtors)</h3>
            <div className="accountant-export-controls">
              <label>
                Statements from
                <input type="date" value={statementFrom} max={statementTo} onChange={(event) => setStatementFrom(event.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={statementTo} min={statementFrom} onChange={(event) => setStatementTo(event.target.value)} />
              </label>
            </div>
          </div>
          {debtors.length ? (
            <div className="table-wrap">
              <table className="data-table ageing-table">
                <thead>
                  <tr><th>Customer</th><th>0-30 days</th><th>31-60 days</th><th>61-90 days</th><th>Over 90 days</th><th>Total owed</th><th>Credit limit</th><th /></tr>
                </thead>
                <tbody>
                  {debtors.map((row) => (
                    <tr key={row.customerId} className={row.buckets.over90 ? "ageing-overdue" : undefined}>
                      <td><strong>{row.name}</strong><small>{row.phone}</small></td>
                      <td>{money(row.buckets.current)}</td>
                      <td>{money(row.buckets.days31to60)}</td>
                      <td>{money(row.buckets.days61to90)}</td>
                      <td>{money(row.buckets.over90)}</td>
                      <td><strong>{displayMoney(row.total)}</strong></td>
                      <td className={row.creditLimit && row.total > row.creditLimit ? "ageing-over-limit" : undefined}>{money(row.creditLimit)}</td>
                      <td><button className="secondary-button" onClick={() => void printStatement(row)}><FileText size={16} /> Statement</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td>{money(sum(debtors, (row) => row.buckets.current))}</td>
                    <td>{money(sum(debtors, (row) => row.buckets.days31to60))}</td>
                    <td>{money(sum(debtors, (row) => row.buckets.days61to90))}</td>
                    <td>{money(sum(debtors, (row) => row.buckets.over90))}</td>
                    <td>{displayMoney(sum(debtors, (row) => row.total))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="muted-text">No customer owes anything.</p>
          )}
          <p className="muted-text">Payments are matched to the oldest credit first, so what is left shows how long each part of the balance has been owed.</p>
        </>
      ) : null}

      {creditors ? (
        <>
          <h3><FileText size={18} /> Suppliers we owe (creditors)</h3>
          {creditors.length ? (
            <div className="table-wrap">
              <table className="data-table ageing-table">
                <thead>
                  <tr><th>Supplier</th><th>Not yet due</th><th>1-30 days late</th><th>31-60 days late</th><th>61-90 days late</th><th>Over 90 days late</th><th>Total owed</th></tr>
                </thead>
                <tbody>
                  {creditors.map((row) => (
                    <tr key={row.supplierId} className={row.buckets.over90 ? "ageing-overdue" : undefined}>
                      <td><strong>{row.name}</strong><small>{row.invoices.map((invoice) => invoice.invoiceNumber).join(", ")}</small></td>
                      <td>{money(row.buckets.notDue)}</td>
                      <td>{money(row.buckets.current)}</td>
                      <td>{money(row.buckets.days31to60)}</td>
                      <td>{money(row.buckets.days61to90)}</td>
                      <td>{money(row.buckets.over90)}</td>
                      <td><strong>{displayMoney(row.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td>{money(sum(creditors, (row) => row.buckets.notDue))}</td>
                    <td>{money(sum(creditors, (row) => row.buckets.current))}</td>
                    <td>{money(sum(creditors, (row) => row.buckets.days31to60))}</td>
                    <td>{money(sum(creditors, (row) => row.buckets.days61to90))}</td>
                    <td>{money(sum(creditors, (row) => row.buckets.over90))}</td>
                    <td>{displayMoney(sum(creditors, (row) => row.total))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="muted-text">No unpaid supplier invoices.</p>
          )}
          <p className="muted-text">Lateness counts from each invoice's due date, or its invoice date when no due date was entered.</p>
        </>
      ) : null}
      {status ? <p className="muted-text">{status}</p> : null}
    </section>
  );
}
