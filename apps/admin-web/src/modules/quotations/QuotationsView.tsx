import { Check, Plus, Printer, RefreshCcw, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createQuotation,
  fetchBranchOptions,
  fetchCatalogProducts,
  fetchCustomers,
  fetchQuotations,
  readStoredAuth,
  updateQuotationStatus,
  type BranchOption,
  type Customer,
  type Quotation,
  type QuotationKind,
  type QuotationStatus
} from "../../shared/api/client";
import { MoneyInput } from "../../shared/components/MoneyInput";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import { documentDate, openPrintWindow, printDocument, quotationHtml } from "../../shared/utils/documentPrint";
import type { Product } from "../catalog/types";
import { calculateSale } from "../sales/pricing";

interface QuotationsViewProps {
  /** Opens the till with the quotation's items in the cart. */
  onLoadToTill(quote: Quotation): void;
}

interface DraftLine {
  productId: string;
  quantity: number;
  discount: number;
}

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const kindLabels: Record<QuotationKind, string> = { quotation: "Quotation", proforma: "Proforma invoice" };

function statusBadge(quote: Quotation) {
  if (quote.status === "converted") return <StatusBadge label="Sold" tone="success" />;
  if (quote.status === "cancelled") return <StatusBadge label="Cancelled" tone="danger" />;
  if (quote.expired) return <StatusBadge label="Expired" tone="warning" />;
  return <StatusBadge label={quote.status === "accepted" ? "Accepted" : "Open"} tone="info" />;
}

/**
 * Quotations and proforma invoices: priced like a sale, printed for the customer, and loaded
 * into the till when the customer comes to buy. Nothing leaves stock until then.
 */
export function QuotationsView({ onLoadToTill }: QuotationsViewProps) {
  const storedAuth = readStoredAuth();
  const permissions = storedAuth?.staff.permissions ?? [];
  const canDiscount = permissions.includes("sale.discount");
  const { settings, displayMoney } = useTenantSettings();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState(storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "");
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | "">("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const printAfterSave = useRef(false);

  const [kind, setKind] = useState<QuotationKind>("quotation");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [validUntil, setValidUntil] = useState(() => localDay(new Date(Date.now() + 14 * 86_400_000)));
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [productQuery, setProductQuery] = useState("");

  async function load(nextSearch = search) {
    try {
      const response = await fetchQuotations(branchId, statusFilter, nextSearch);
      setQuotes(response.quotations);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load quotations");
    }
  }

  useEffect(() => {
    void fetchBranchOptions().then((response) => {
      setBranches(response.branches);
      if (!branchId && response.branches[0]) setBranchId(response.branches[0].id);
    }, () => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [branchId, statusFilter]);

  useEffect(() => {
    if (!modalOpen || !branchId) return;
    void fetchCatalogProducts(branchId).then((response) => setProducts(response.products.filter((product) => product.branchId === branchId)), () => setProducts([]));
    void fetchCustomers("", branchId).then((response) => setCustomers(response.customers), () => setCustomers([]));
  }, [modalOpen, branchId]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const matches = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (!query) return [];
    return products.filter((product) => `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(query)).slice(0, 8);
  }, [productQuery, products]);
  const preview = useMemo(
    () =>
      calculateSale(
        lines.filter((line) => productById.has(line.productId)).map((line) => ({ product: productById.get(line.productId)!, quantity: line.quantity, discount: line.discount })),
        { vatRate: settings?.defaultTaxRate, serviceChargeEnabled: settings?.serviceChargeEnabled ?? true, serviceChargeRate: settings?.serviceChargeRate }
      ),
    [lines, productById, settings]
  );

  function openNew(nextKind: QuotationKind) {
    setKind(nextKind);
    setCustomerId("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setValidUntil(localDay(new Date(Date.now() + 14 * 86_400_000)));
    setNote("");
    setLines([]);
    setProductQuery("");
    setModalOpen(true);
  }

  function chooseCustomer(id: string) {
    setCustomerId(id);
    const customer = customers.find((item) => item.id === id);
    if (customer) {
      setCustomerName(customer.name);
      setCustomerPhone(customer.phone);
      setCustomerEmail(customer.email ?? "");
    }
  }

  function addProduct(product: Product) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      return existing ? current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line)) : [...current, { productId: product.id, quantity: 1, discount: 0 }];
    });
    setProductQuery("");
  }

  function updateLine(index: number, change: Partial<DraftLine>) {
    setLines((current) => current.map((line, position) => (position === index ? { ...line, ...change } : line)));
  }

  function print(quote: Quotation, printWindow?: Window | null) {
    if (!settings) return;
    setStatus(printDocument(quotationHtml(quote, settings, (amount) => displayMoney(amount)), printWindow));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const thenPrint = printAfterSave.current;
    printAfterSave.current = false;
    if (!lines.length) {
      setStatus("Add at least one item");
      return;
    }
    const printWindow = thenPrint ? openPrintWindow() : null;
    setSaving(true);
    try {
      const { quotation } = await createQuotation({ branchId, kind, customerId, customerName, customerPhone, customerEmail, validUntil, note, lines });
      setModalOpen(false);
      setStatus(`${kindLabels[quotation.kind]} ${quotation.number} saved`);
      await load();
      if (thenPrint) print(quotation, printWindow);
    } catch (error) {
      printWindow?.close();
      setStatus(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(quote: Quotation, next: "accepted" | "cancelled") {
    if (next === "cancelled" && !window.confirm(`Cancel ${quote.number}?`)) return;
    try {
      await updateQuotationStatus(quote.id, next);
      setStatus(`${quote.number} ${next}`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update");
    }
  }

  const live = (quote: Quotation) => quote.status === "open" || quote.status === "accepted";

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Price it on paper first, sell it later</p>
          <h1>Quotations</h1>
        </div>
        <div className="button-group">
          {branches.length > 1 ? (
            <label className="toolbar-select">
              Branch
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
          ) : null}
          <button className="secondary-button" onClick={() => void load()}><RefreshCcw size={18} /> Refresh</button>
          <button className="secondary-button" onClick={() => openNew("proforma")}><Plus size={18} /> Proforma invoice</button>
          <button className="primary-button" onClick={() => openNew("quotation")}><Plus size={18} /> Quotation</button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Quotations and proforma invoices</h2>
          <div className="search-box compact-search">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load()} placeholder="Number, customer or phone" />
            {search ? <button type="button" onClick={() => { setSearch(""); void load(""); }} aria-label="Clear search"><X size={14} /></button> : null}
          </div>
        </div>
        <div className="table-toolbar">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as QuotationStatus | "")}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="accepted">Accepted</option>
            <option value="converted">Sold</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {status ? <p className="muted-text">{status}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Number</th><th>Type</th><th>Customer</th><th>Date</th><th>Valid until</th><th>Total</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {quotes.length ? quotes.map((quote) => (
                <tr key={quote.id}>
                  <td><strong>{quote.number}</strong></td>
                  <td>{kindLabels[quote.kind]}</td>
                  <td>{quote.customerName}<small className="muted-text"> {quote.customerPhone}</small></td>
                  <td>{documentDate(quote.createdAt)}</td>
                  <td>{documentDate(quote.validUntil)}</td>
                  <td>{displayMoney(quote.summary.total)}</td>
                  <td>{statusBadge(quote)}{quote.saleId ? <small className="muted-text"> {quote.saleId}</small> : null}</td>
                  <td className="row-actions">
                    <button onClick={() => print(quote)} aria-label={`Print ${quote.number}`} title="Print"><Printer size={16} /></button>
                    {live(quote) ? (
                      <>
                        {quote.status === "open" ? <button onClick={() => void changeStatus(quote, "accepted")} aria-label={`Mark ${quote.number} accepted`} title="Customer accepted"><Check size={16} /></button> : null}
                        <button onClick={() => onLoadToTill(quote)} aria-label={`Sell ${quote.number} at the till`} title="Sell at the till"><ShoppingCart size={16} /></button>
                        <button onClick={() => void changeStatus(quote, "cancelled")} aria-label={`Cancel ${quote.number}`} title="Cancel"><Trash2 size={16} /></button>
                      </>
                    ) : null}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8}>No quotations yet. Use Quotation or Proforma invoice above to make one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}>
          <section className="modal-panel quotation-modal" role="dialog" aria-modal="true" aria-labelledby="quotation-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Prices from the {branches.find((branch) => branch.id === branchId)?.name ?? "branch"} catalogue</p>
                <h2 id="quotation-modal-title">New {kindLabels[kind].toLowerCase()}</h2>
              </div>
              <button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <form className="customer-form quotation-form" onSubmit={(event) => void save(event)}>
              <label>
                Type
                <select value={kind} onChange={(event) => setKind(event.target.value as QuotationKind)}>
                  <option value="quotation">Quotation</option>
                  <option value="proforma">Proforma invoice</option>
                </select>
              </label>
              <label>
                Existing customer
                <select value={customerId} onChange={(event) => chooseCustomer(event.target.value)}>
                  <option value="">New / walk-in</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
              </label>
              <label>
                Customer name
                <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required minLength={2} />
              </label>
              <label>
                Phone
                <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
              </label>
              <label>
                Email
                <input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
              </label>
              <label>
                Valid until
                <input type="date" value={validUntil} min={localDay(new Date())} onChange={(event) => setValidUntil(event.target.value)} required />
              </label>

              <div className="wide-field quotation-lines">
                <div className="search-box">
                  <Search size={16} />
                  <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Add item: name, SKU or barcode" />
                </div>
                {matches.length ? (
                  <ul className="quotation-matches">
                    {matches.map((product) => (
                      <li key={product.id}><button type="button" onClick={() => addProduct(product)}>{product.name} <span>{displayMoney(product.price)}</span></button></li>
                    ))}
                  </ul>
                ) : null}
                <table>
                  <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th>{canDiscount ? <th>Discount / unit</th> : null}<th>Amount</th><th /></tr></thead>
                  <tbody>
                    {lines.length ? lines.map((line, index) => {
                      const product = productById.get(line.productId);
                      return (
                        <tr key={line.productId}>
                          <td>{product?.name ?? line.productId}</td>
                          <td><input type="number" min={1} value={line.quantity} onChange={(event) => updateLine(index, { quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} /></td>
                          <td>{product ? displayMoney(product.price) : ""}</td>
                          {canDiscount ? <td><MoneyInput min={0} max={product?.price} value={line.discount} onChange={(amount) => updateLine(index, { discount: Math.min(Math.max(amount, 0), product?.price ?? 0) })} /></td> : null}
                          <td>{product ? displayMoney((product.price - Math.min(line.discount, product.price)) * line.quantity) : ""}</td>
                          <td><button type="button" className="icon-button" onClick={() => setLines((current) => current.filter((_, position) => position !== index))} aria-label="Remove item"><X size={14} /></button></td>
                        </tr>
                      );
                    }) : <tr><td colSpan={canDiscount ? 6 : 5}>Search above to add items.</td></tr>}
                  </tbody>
                </table>
              </div>

              <label className="wide-field">
                Note on the document
                <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Delivery within Lagos included; 50% deposit to confirm" />
              </label>
              <div className="form-summary">
                <span>
                  {preview.vat ? `VAT ${displayMoney(preview.vat)} · ` : ""}
                  {preview.serviceCharge ? `Service ${displayMoney(preview.serviceCharge)} · ` : ""}
                  Total <strong>{displayMoney(preview.total)}</strong>
                </span>
                <span>{status}</span>
                <div className="button-group">
                  <button className="secondary-button" type="submit" disabled={saving} onClick={() => { printAfterSave.current = false; }}><Check size={18} /> Save</button>
                  <button className="primary-button" type="submit" disabled={saving} onClick={() => { printAfterSave.current = true; }}><Printer size={18} /> Save and print</button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
