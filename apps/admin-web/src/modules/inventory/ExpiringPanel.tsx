import { CalendarClock, Check, Tag, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { endProductClearance, fetchExpiringLots, setProductClearance, type ExpiringLot } from "../../shared/api/client";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import { activeClearance } from "../sales/pricing";

const windows = [7, 30, 60, 90];

function expiryText(daysLeft: number) {
  if (daysLeft < 0) return `Expired ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "Expires tomorrow";
  return `Expires in ${daysLeft} days`;
}

/**
 * Batches close to expiry (from purchase receipts and stock received with an expiry date),
 * and clearance pricing: put the expiring units on sale at a percentage off. The till sells
 * those units first at the clearance price, then the normal price comes back.
 */
export function ExpiringPanel(props: { branchId: string; canSetClearance: boolean; onChanged(): void }) {
  const { displayMoney } = useTenantSettings();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<ExpiringLot[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExpiringLot | null>(null);
  const [percent, setPercent] = useState("30");
  const [price, setPrice] = useState("");
  const [units, setUnits] = useState("");
  const [endsAt, setEndsAt] = useState("");

  async function load() {
    try {
      const response = await fetchExpiringLots(props.branchId, days);
      setRows(response.lots);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load expiring stock");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.branchId, days]);

  function open(row: ExpiringLot) {
    const current = activeClearance({ ...row.product, clearanceRemaining: row.product.clearanceRemaining ?? 0 } as never);
    const startPercent = current ? current.percent : 30;
    setEditing(row);
    setPercent(String(startPercent));
    setPrice(String(current ? current.price : Math.round(row.product.price * (1 - startPercent / 100))));
    setUnits(String(current ? current.remaining : row.lot.remaining));
    setEndsAt(current?.endsAt ?? row.lot.expiryDate);
  }

  function changePercent(value: string) {
    const clean = value.replace(/\D/g, "").slice(0, 2);
    setPercent(clean);
    if (editing) setPrice(clean ? String(Math.round(editing.product.price * (1 - Number(clean) / 100))) : "");
  }

  function changePrice(value: string) {
    setPrice(value);
    if (editing && value && Number(value) < editing.product.price) setPercent(String(Math.round(((editing.product.price - Number(value)) / editing.product.price) * 100)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      await setProductClearance(editing.product.id, { clearancePrice: Number(price), units: Number(units), endsAt: endsAt || undefined, expiryDate: editing.lot.expiryDate }, editing.product.branchId);
      setEditing(null);
      setStatus(`${editing.product.name} is on clearance`);
      await load();
      props.onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to set clearance");
    }
  }

  async function stop(row: ExpiringLot) {
    try {
      await endProductClearance(row.product.id, row.product.branchId);
      setStatus(`Clearance on ${row.product.name} stopped`);
      await load();
      props.onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to stop clearance");
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2><CalendarClock size={18} /> Expiring soon</h2>
        <div className="expiry-windows">
          {windows.map((option) => (
            <button key={option} type="button" className={days === option ? "active" : ""} onClick={() => setDays(option)}>
              {option} days
            </button>
          ))}
        </div>
      </div>
      {status ? <p className="expiry-status">{status}</p> : null}
      {rows.length === 0 ? (
        <div className="empty-state">Nothing expiring within {days} days. Add expiry dates when you receive stock to see batches here.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Batch</th>
                <th>Units left</th>
                <th>Expiry</th>
                <th>Clearance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const clearance = activeClearance({ ...row.product, clearanceRemaining: row.product.clearanceRemaining ?? 0 } as never);
                return (
                  <tr key={row.lot.id}>
                    <td><strong>{row.product.name}</strong><br /><small>{row.product.category}</small></td>
                    <td>{row.lot.reference ?? "-"}<br /><small>{new Date(row.lot.createdAt).toLocaleDateString()}</small></td>
                    <td>{row.lot.remaining} of {row.lot.quantity}</td>
                    <td className={row.lot.daysLeft <= 7 ? "expiry-urgent" : ""}>{row.lot.expiryDate}<br /><small>{expiryText(row.lot.daysLeft)}</small></td>
                    <td>{clearance ? <span className="clearance-pill">−{clearance.percent}% · {displayMoney(clearance.price)} · {clearance.remaining} left</span> : "-"}</td>
                    <td>
                      {props.canSetClearance ? (
                        <>
                          <button type="button" className="secondary-button" onClick={() => open(row)}><Tag size={16} /> {clearance ? "Change" : "Put on clearance"}</button>
                          {clearance ? <button type="button" className="ghost-button" onClick={() => void stop(row)}><X size={16} /> Stop</button> : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <form className="inventory-form register-section" onSubmit={save}>
          <div className="panel-header wide-field">
            <h2>Clearance: {editing.product.name}</h2>
            <span>Normal price {displayMoney(editing.product.price)} · batch expires {editing.lot.expiryDate}</span>
          </div>
          <label>
            Percent off
            <input type="number" min={1} max={99} value={percent} onChange={(event) => changePercent(event.target.value)} required />
          </label>
          <label>
            Clearance price
            <input type="number" min={0} value={price} onChange={(event) => changePrice(event.target.value)} required />
          </label>
          <label>
            Units on clearance
            <input type="number" min={1} max={editing.product.stock} value={units} onChange={(event) => setUnits(event.target.value)} required />
          </label>
          <label>
            Ends on
            <input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
          <div className="discount-preview wide-field">
            <span>Next {units || 0} sold</span>
            <strong>{displayMoney(Number(price) || 0)} each</strong>
            <small>Then {displayMoney(editing.product.price)} again. Cashiers can sell clearance units without discount approval.</small>
          </div>
          <button className="primary-button" type="submit"><Check size={18} /> Save clearance</button>
          <button className="ghost-button" type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      ) : null}
    </section>
  );
}
