import { ArrowDownUp, Check, ClipboardCheck, Download, Plus, RefreshCcw, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  createApproval,
  createSupplier,
  createStockAdjustment,
  createStockCount,
  fetchBranchOptions,
  fetchInventoryStock,
  fetchSuppliers,
  readStoredAuth,
  receivePurchase,
  type ApprovalRequest,
  type BranchOption,
  type PurchaseReceiptPayload,
  type StockAdjustmentPayload,
  type StockCountPayload,
  type StockMovement,
  type Supplier,
  type SupplierPayload
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import type { Product } from "../catalog/types";

const defaultBranchId = "";
const fallbackBranches: BranchOption[] = [];

function defaultAdjustment(branchId = defaultBranchId): StockAdjustmentPayload {
  return {
    productId: "",
    branchId,
    type: "" as StockMovement["type"],
    quantityDelta: 1,
    reason: "Supplier delivery",
    reference: ""
  };
}

function defaultPurchase(branchId = defaultBranchId): PurchaseReceiptPayload {
  return {
    supplierId: "",
    branchId,
    productId: "",
    quantity: 1,
    reference: "",
    note: "Supplier delivery"
  };
}

function defaultSupplier(branchId = defaultBranchId): SupplierPayload {
  return {
    branchId,
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    leadTimeDays: 2,
    active: true,
    productIds: []
  };
}

interface InventoryViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function InventoryView({ approvalHandoff, onApprovalHandoffConsumed }: InventoryViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? defaultBranchId;
  const activeUserId = storedAuth?.staff.id ?? "";
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [adjustment, setAdjustment] = useState<StockAdjustmentPayload>(defaultAdjustment(initialBranchId));
  const [purchase, setPurchase] = useState<PurchaseReceiptPayload>(defaultPurchase(initialBranchId));
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<SupplierPayload>(defaultSupplier(initialBranchId));
  const [adjustmentApprovalId, setAdjustmentApprovalId] = useState("");
  const [countModalOpen, setCountModalOpen] = useState(false);
  const [countReference, setCountReference] = useState(`COUNT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  const [countReason, setCountReason] = useState("Cycle count");
  const [countValues, setCountValues] = useState<Record<string, number>>({});
  const [countApprovalId, setCountApprovalId] = useState("");
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handledApprovalIdRef = useRef<string | null>(null);

  const inventoryValue = useMemo(() => products.reduce((sum, product) => sum + product.stock * product.cost, 0), [products]);
  const lowStockCount = useMemo(() => products.filter((product) => product.stock <= product.reorderPoint).length, [products]);
  const selectedAdjustmentProduct = useMemo(
    () => products.find((product) => product.id === adjustment.productId) ?? null,
    [adjustment.productId, products]
  );
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === purchase.supplierId) ?? null,
    [purchase.supplierId, suppliers]
  );
  const supplierProducts = useMemo(
    () => selectedSupplier ? products.filter((product) => selectedSupplier.productIds.includes(product.id)) : products,
    [products, selectedSupplier]
  );
  const selectedPurchaseProduct = useMemo(
    () => supplierProducts.find((product) => product.id === purchase.productId) ?? null,
    [purchase.productId, supplierProducts]
  );
  const stockPage = usePaginatedRows(products, 10);
  const adjustmentValue = selectedAdjustmentProduct ? Math.abs(adjustment.quantityDelta) * selectedAdjustmentProduct.cost : 0;
  const countVarianceItems = useMemo(
    () => products.filter((product) => (countValues[product.id] ?? product.stock) !== product.stock).length,
    [countValues, products]
  );
  const countVarianceValue = useMemo(
    () =>
      products.reduce((sum, product) => {
        const countedQuantity = countValues[product.id] ?? product.stock;
        return sum + Math.abs(countedQuantity - product.stock) * product.cost;
      }, 0),
    [countValues, products]
  );

  async function loadInventory(nextBranchId = branchId) {
    try {
      if (!nextBranchId) {
        setProducts([]);
        setMovements([]);
        setSuppliers([]);
        setCountValues({});
        setStatus("Select a branch");
        return;
      }

      const [branchResponse, stockResponse, supplierResponse] = await Promise.all([
        fetchBranchOptions(),
        fetchInventoryStock(nextBranchId, activeUserId),
        fetchSuppliers(nextBranchId, activeUserId)
      ]);
      setBranches(branchResponse.branches.length ? branchResponse.branches : fallbackBranches);
      setProducts(stockResponse.products);
      setMovements(stockResponse.movements);
      setSuppliers(supplierResponse.suppliers);
      setCountValues(Object.fromEntries(stockResponse.products.map((product) => [product.id, product.stock])));
      setStatus("Inventory synced");
    } catch (error) {
      setProducts([]);
      setMovements([]);
      setBranches(fallbackBranches);
      setSuppliers([]);
      setCountValues({});
      setStatus(error instanceof Error ? error.message : "Unable to load inventory");
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  useEffect(() => {
    if (!approvalHandoff || approvalHandoff.type !== "stock_adjustment" || approvalHandoff.status !== "approved" || handledApprovalIdRef.current === approvalHandoff.id) {
      return;
    }

    handledApprovalIdRef.current = approvalHandoff.id;

    if (approvalHandoff.entityType === "productStock") {
      setAdjustment((current) => ({
        ...current,
        productId: approvalHandoff.entityId,
        reason: approvalHandoff.reason
      }));
      setAdjustmentApprovalId(approvalHandoff.id);
      setStatus(`Stock movement approval ready: ${approvalHandoff.id}`);
    }

    if (approvalHandoff.entityType === "stockCount") {
      setCountReference(approvalHandoff.entityId);
      setCountReason(approvalHandoff.reason);
      setCountApprovalId(approvalHandoff.id);
      setCountValues(Object.fromEntries(products.map((product) => [product.id, product.stock])));
      setCountModalOpen(true);
      setStatus(`Stock count approval ready: ${approvalHandoff.id}`);
    }
    onApprovalHandoffConsumed?.();
  }, [approvalHandoff?.id, products]);

  function updateAdjustment<K extends keyof StockAdjustmentPayload>(key: K, value: StockAdjustmentPayload[K]) {
    setAdjustment((current) => ({ ...current, [key]: value }));
  }

  function updatePurchase<K extends keyof PurchaseReceiptPayload>(key: K, value: PurchaseReceiptPayload[K]) {
    setPurchase((current) => ({ ...current, [key]: value }));
  }

  function updateSupplierDraft<K extends keyof SupplierPayload>(key: K, value: SupplierPayload[K]) {
    setSupplierDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleSupplierProduct(productId: string) {
    setSupplierDraft((current) => {
      const nextProductIds = current.productIds.includes(productId)
        ? current.productIds.filter((id) => id !== productId)
        : [...current.productIds, productId];

      return { ...current, productIds: nextProductIds };
    });
  }

  useEffect(() => {
    if (selectedSupplier && !selectedSupplier.productIds.includes(purchase.productId)) {
      setPurchase((current) => ({ ...current, productId: "" }));
    }
  }, [purchase.productId, selectedSupplier?.id, selectedSupplier?.productIds.join("|")]);

  function openCountModal() {
    setCountValues(Object.fromEntries(products.map((product) => [product.id, product.stock])));
    setCountReference(`COUNT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
    setCountReason("Cycle count");
    setCountApprovalId("");
    setCountModalOpen(true);
  }

  function openSupplierModal() {
    setSupplierDraft(defaultSupplier(branchId));
    setSupplierModalOpen(true);
  }

  function changeBranch(nextBranchId: string) {
    if (!nextBranchId) return;

    setBranchId(nextBranchId);
    setAdjustment(defaultAdjustment(nextBranchId));
    setPurchase(defaultPurchase(nextBranchId));
    setSupplierDraft(defaultSupplier(nextBranchId));
    setAdjustmentApprovalId("");
    setCountApprovalId("");
    void loadInventory(nextBranchId);
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const text = await file.text();
    const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    const importedCounts: Record<string, number> = {};

    rows.forEach((row, index) => {
      const [firstCell, secondCell] = row.split(",").map((cell) => cell.trim());
      if (index === 0 && /sku|product/i.test(firstCell)) return;

      const product = products.find((item) => item.sku.toLowerCase() === firstCell.toLowerCase() || item.id === firstCell);
      const quantity = Number(secondCell);
      if (product && Number.isFinite(quantity) && quantity >= 0) {
        importedCounts[product.id] = Math.round(quantity);
      }
    });

    if (Object.keys(importedCounts).length === 0) {
      setStatus("CSV import found no matching SKU or product ID rows");
      return;
    }

    setCountValues((current) => ({ ...Object.fromEntries(products.map((product) => [product.id, product.stock])), ...current, ...importedCounts }));
    setCountReference(`IMPORT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
    setCountReason(`CSV import: ${file.name}`);
    setCountApprovalId("");
    setCountModalOpen(true);
    setStatus(`Imported ${Object.keys(importedCounts).length} stock rows`);
  }

  function prepareTransfer() {
    setAdjustment((current) => ({
      ...current,
      type: "transfer",
      quantityDelta: current.quantityDelta > 0 ? -current.quantityDelta : current.quantityDelta || -1,
      reason: "Branch stock transfer",
      reference: `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`
    }));
    setAdjustmentApprovalId("");
    setStatus("Transfer movement ready for approval");
  }

  function exportStockCsv() {
    const rows = [
      ["sku", "name", "category", "stock", "reorderPoint", "cost", "value"],
      ...products.map((product) => [
        product.sku,
        product.name,
        product.category,
        String(product.stock),
        String(product.reorderPoint),
        String(product.cost),
        String(product.stock * product.cost)
      ])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `branch-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Stock ledger exported");
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault();

    if (!selectedAdjustmentProduct) {
      setStatus("Select a product before recording movement");
      return;
    }

    if (!adjustment.type) {
      setStatus("Select a movement type");
      return;
    }

    if (!adjustmentApprovalId.trim()) {
      setStatus("Requesting stock approval...");

      try {
        const response = await createApproval({
          branchId: adjustment.branchId,
          type: "stock_adjustment",
          entityType: "productStock",
          entityId: adjustment.productId,
          amount: adjustmentValue,
          reason: `${adjustment.type}: ${adjustment.reason}`
        });
        setStatus(`Stock approval requested: ${response.approval.id}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to request stock approval");
      }
      return;
    }

    setStatus("Applying approved stock movement...");

    try {
      const approvalResponse = await applyApproval(
        adjustmentApprovalId.trim(),
        "productStock",
        adjustment.productId,
        "stock_adjustment",
        adjustmentValue,
        adjustment.reason,
        activeUserId,
        adjustment.branchId
      );
      const response = await createStockAdjustment(adjustment, activeUserId);
      setProducts((current) => current.map((product) => (product.id === response.product.id ? response.product : product)));
      setMovements((current) => [response.movement, ...current].slice(0, 20));
      setAdjustmentApprovalId("");
      setStatus(`Stock movement recorded with ${approvalResponse.approval.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to record movement");
    }
  }

  async function submitPurchaseReceipt(event: FormEvent) {
    event.preventDefault();

    if (!selectedSupplier || !selectedPurchaseProduct) {
      setStatus("Select a supplier and covered product before receiving stock");
      return;
    }

    setStatus("Receiving supplier delivery...");

    try {
      const response = await receivePurchase(purchase, activeUserId);
      setProducts((current) => current.map((product) => (product.id === response.product.id ? response.product : product)));
      setMovements((current) => [response.movement, ...current].slice(0, 20));
      setPurchase((current) => ({
        ...current,
        quantity: 1,
        reference: "",
        note: `Supplier delivery from ${response.supplier.name}`
      }));
      setStatus(`Received ${response.movement.quantityDelta} ${response.product.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to receive purchase");
    }
  }

  async function submitSupplier(event: FormEvent) {
    event.preventDefault();

    if (supplierDraft.productIds.length === 0) {
      setStatus("Select at least one product for supplier coverage");
      return;
    }

    setStatus("Saving supplier...");

    try {
      const response = await createSupplier(supplierDraft, activeUserId);
      setSuppliers((current) => [response.supplier, ...current]);
      setPurchase((current) => ({
        ...current,
        supplierId: response.supplier.id,
        productId: response.supplier.productIds[0] ?? current.productId
      }));
      setSupplierModalOpen(false);
      setStatus(`Supplier added: ${response.supplier.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to add supplier");
    }
  }

  async function submitStockCount(event: FormEvent) {
    event.preventDefault();
    const payload: StockCountPayload = {
      branchId,
      reference: countReference,
      reason: countReason,
      counts: products.map((product) => ({
        productId: product.id,
        countedQuantity: countValues[product.id] ?? product.stock
      }))
    };

    if (countVarianceItems > 0 && !countApprovalId.trim()) {
      setStatus("Requesting count approval...");

      try {
        const response = await createApproval({
          branchId: payload.branchId,
          type: "stock_adjustment",
          entityType: "stockCount",
          entityId: countReference,
          amount: countVarianceValue,
          reason: `${countReason}: ${countVarianceItems} variance items`
        });
        setStatus(`Count approval requested: ${response.approval.id}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to request count approval");
      }
      return;
    }

    setStatus(countApprovalId.trim() ? "Applying approved stock count..." : "Posting stock count...");

    try {
      if (countApprovalId.trim()) {
        await applyApproval(
          countApprovalId.trim(),
          "stockCount",
          countReference,
          "stock_adjustment",
          countVarianceValue,
          countReason,
          activeUserId,
          payload.branchId
        );
      }
      const response = await createStockCount(payload, activeUserId);
      setProducts((current) => current.map((product) => response.products.find((item) => item.id === product.id) ?? product));
      setMovements((current) => [...response.movements, ...current].slice(0, 20));
      setCountModalOpen(false);
      setCountApprovalId("");
      setStatus(`Stock count posted with ${response.movements.length} variances`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to post stock count");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Stock control</p>
          <h1>Inventory dashboard</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Branch
            <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button" onClick={() => importInputRef.current?.click()}><Upload size={18} /> Import CSV</button>
          <button className="secondary-button" onClick={() => void loadInventory()}><RefreshCcw size={18} /> Sync</button>
          <button className="secondary-button" onClick={openCountModal}><ClipboardCheck size={18} /> Count stock</button>
          <button className="secondary-button" onClick={openSupplierModal}><Plus size={18} /> Supplier</button>
          <button className="primary-button" onClick={prepareTransfer}><ArrowDownUp size={18} /> Transfer stock</button>
          <input ref={importInputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={importCsv} />
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top"><span>Inventory value</span></div>
          <strong>{displayMoney(inventoryValue)}</strong>
          <small>At current branch cost</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Low stock items</span></div>
          <strong>{lowStockCount}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Movement records</span></div>
          <strong>{movements.length}</strong>
          <small>Latest branch activity</small>
        </article>
      </section>

      <div className="inventory-workflow">
        <section className="panel inventory-form-panel">
          <div className="panel-header">
            <h2>Record stock movement</h2>
            <span>Manager approval</span>
          </div>
          <form className="inventory-form" onSubmit={submitAdjustment}>
            <label>
              Product
              <select value={adjustment.productId} onChange={(event) => updateAdjustment("productId", event.target.value)}>
                <option value="" disabled>Product</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label>
              Type
              <select value={adjustment.type} onChange={(event) => updateAdjustment("type", event.target.value as StockMovement["type"])}>
                <option value="" disabled>Type</option>
                <option value="receipt">Receipt</option>
                <option value="issue">Issue</option>
                <option value="adjustment">Adjustment</option>
                <option value="transfer">Transfer</option>
                <option value="waste">Waste</option>
                <option value="count">Count variance</option>
              </select>
            </label>
            <label>
              Quantity delta
              <input
                type="number"
                value={adjustment.quantityDelta}
                onChange={(event) => updateAdjustment("quantityDelta", Number(event.target.value))}
              />
            </label>
            <label>
              Reference
              <input value={adjustment.reference ?? ""} onChange={(event) => updateAdjustment("reference", event.target.value)} placeholder="GRN-002" />
            </label>
            <label className="wide-field">
              Reason
              <input value={adjustment.reason} onChange={(event) => updateAdjustment("reason", event.target.value)} required />
            </label>
            <label className="wide-field">
              Approved request ID
              <input value={adjustmentApprovalId} onChange={(event) => setAdjustmentApprovalId(event.target.value)} placeholder="Leave blank to request manager approval" />
            </label>
            <div className="approval-warning wide-field">
              <span>{selectedAdjustmentProduct?.name ?? "Selected stock"} requires approval</span>
              <strong>{displayMoney(adjustmentValue)}</strong>
              <small>{adjustmentApprovalId.trim() ? "Approved movement will be recorded" : "Manager approval request will be created"}</small>
            </div>
            <button className="primary-button wide-field" type="submit"><Check size={18} /> {adjustmentApprovalId.trim() ? "Apply movement" : "Request approval"}</button>
          </form>
          <form className="inventory-form register-section" onSubmit={submitPurchaseReceipt}>
            <div className="panel-header wide-field">
              <h2>Receive supplier purchase</h2>
              <span>{suppliers.length} suppliers</span>
            </div>
            <label>
              Supplier
              <select value={purchase.supplierId} onChange={(event) => updatePurchase("supplierId", event.target.value)}>
                <option value="" disabled>Supplier</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
            <label>
              Product
              <select value={purchase.productId} onChange={(event) => updatePurchase("productId", event.target.value)}>
                <option value="" disabled>Product</option>
                {supplierProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label>
              Quantity
              <input type="number" min={1} value={purchase.quantity} onChange={(event) => updatePurchase("quantity", Number(event.target.value))} required />
            </label>
            <label>
              Reference
              <input value={purchase.reference} onChange={(event) => updatePurchase("reference", event.target.value)} placeholder="PO-1002" required />
            </label>
            <label className="wide-field">
              Note
              <input value={purchase.note} onChange={(event) => updatePurchase("note", event.target.value)} required />
            </label>
            <div className="discount-preview wide-field">
              <span>{selectedSupplier?.name ?? "Supplier"}</span>
              <strong>{selectedPurchaseProduct ? displayMoney(selectedPurchaseProduct.cost * purchase.quantity) : displayMoney(0)}</strong>
              <small>{selectedSupplier ? `${selectedSupplier.leadTimeDays} day lead time` : "Supplier coverage required"}</small>
            </div>
            <button className="primary-button wide-field" disabled={!selectedSupplier || !selectedPurchaseProduct} type="submit"><Check size={18} /> Receive purchase</button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Movement history</h2>
            <span>{movements.length} records</span>
          </div>
          <div className="stack">
            {movements.length === 0 ? (
              <div className="empty-state">No stock movements yet.</div>
            ) : (
              movements.map((movement) => (
                <div className="list-row" key={movement.id}>
                  <div>
                    <strong>{movement.productName}</strong>
                    <span>{movement.type} - {movement.reason}{movement.supplierName ? ` - ${movement.supplierName}` : ""}</span>
                  </div>
                  <b>{movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}</b>
                </div>
              ))
            )}
          </div>
          <div className="panel-header register-history-header">
            <h2>Suppliers</h2>
            <span>{suppliers.length} active</span>
          </div>
          <div className="supplier-grid">
            {suppliers.length === 0 ? (
              <div className="empty-state">No suppliers configured.</div>
            ) : suppliers.map((supplier) => (
              <article className="supplier-card" key={supplier.id}>
                <div>
                  <strong>{supplier.name}</strong>
                  <span>{supplier.contactPerson} - {supplier.phone}</span>
                </div>
                <small>{supplier.productIds.length} products - {supplier.leadTimeDays} day lead</small>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Branch stock ledger</h2>
          <button className="ghost-button" onClick={exportStockCsv}><Download size={16} /> Export</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>SKU</th>
                <th>Available</th>
                <th>Reorder</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stockPage.pageRows.length === 0 ? (
                <tr><td colSpan={7}>No stock records found.</td></tr>
              ) : stockPage.pageRows.map((product, index) => (
                <tr key={product.id}>
                  <td className="number-cell">{stockPage.startIndex + index + 1}</td>
                  <td>{product.name}</td>
                  <td>{product.sku}</td>
                  <td>{product.stock}</td>
                  <td>{product.reorderPoint}</td>
                  <td>{displayMoney(product.stock * product.cost)}</td>
                  <td>
                    <StatusBadge
                      label={product.stock <= product.reorderPoint ? "Low stock" : "Healthy"}
                      tone={product.stock <= product.reorderPoint ? "warning" : "success"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={stockPage.page}
          pageCount={stockPage.pageCount}
          pageSize={stockPage.pageSize}
          totalRows={stockPage.totalRows}
          startIndex={stockPage.startIndex}
          visibleCount={stockPage.pageRows.length}
          onPageChange={stockPage.setPage}
          onPageSizeChange={stockPage.setPageSize}
        />
      </section>
      {countModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCountModalOpen(false)}>
          <section className="modal-panel stock-count-modal" role="dialog" aria-modal="true" aria-labelledby="stock-count-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Inventory control</p>
                <h2 id="stock-count-modal-title">Post stock count</h2>
              </div>
              <button className="icon-button" onClick={() => setCountModalOpen(false)} aria-label="Close stock count modal"><X size={18} /></button>
            </div>
            <form className="stock-count-form" onSubmit={submitStockCount}>
              <label>
                Reference
                <input value={countReference} onChange={(event) => setCountReference(event.target.value)} required />
              </label>
              <label>
                Reason
                <input value={countReason} onChange={(event) => setCountReason(event.target.value)} required />
              </label>
              <label className="wide-field">
                Approved request ID
                <input value={countApprovalId} onChange={(event) => setCountApprovalId(event.target.value)} placeholder="Leave blank to request manager approval for variances" />
              </label>
              <div className="stock-count-list wide-field">
                {products.map((product) => {
                  const countedQuantity = countValues[product.id] ?? product.stock;
                  const variance = countedQuantity - product.stock;
                  return (
                    <div className="stock-count-row" key={product.id}>
                      <div>
                        <strong>{product.name}</strong>
                        <span>Expected {product.stock} - {product.sku}</span>
                      </div>
                      <input
                        min={0}
                        type="number"
                        value={countedQuantity}
                        onChange={(event) => setCountValues((current) => ({ ...current, [product.id]: Number(event.target.value) }))}
                        aria-label={`Counted quantity for ${product.name}`}
                      />
                      <b>{variance > 0 ? "+" : ""}{variance}</b>
                    </div>
                  );
                })}
              </div>
              <div className={countVarianceItems > 0 ? "approval-warning wide-field" : "discount-preview wide-field"}>
                <span>{countVarianceItems} variance items</span>
                <strong>{displayMoney(countVarianceValue)}</strong>
                <small>{countVarianceItems > 0 ? countApprovalId.trim() ? "Approved count will be posted" : "Manager approval request will be created" : "No approval needed when there are no variances"}</small>
              </div>
              <div className="form-summary">
                <span>{products.length} counted items</span>
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> {countVarianceItems > 0 && !countApprovalId.trim() ? "Request approval" : "Post count"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {supplierModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSupplierModalOpen(false)}>
          <section className="modal-panel supplier-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supplier management</p>
                <h2 id="supplier-modal-title">Add supplier</h2>
              </div>
              <button className="icon-button" onClick={() => setSupplierModalOpen(false)} aria-label="Close supplier modal"><X size={18} /></button>
            </div>
            <form className="supplier-form" onSubmit={submitSupplier}>
              <label>
                Supplier name
                <input value={supplierDraft.name} onChange={(event) => updateSupplierDraft("name", event.target.value)} required />
              </label>
              <label>
                Contact person
                <input value={supplierDraft.contactPerson} onChange={(event) => updateSupplierDraft("contactPerson", event.target.value)} required />
              </label>
              <label>
                Phone
                <input value={supplierDraft.phone} onChange={(event) => updateSupplierDraft("phone", event.target.value)} required />
              </label>
              <label>
                Email
                <input type="email" value={supplierDraft.email ?? ""} onChange={(event) => updateSupplierDraft("email", event.target.value)} />
              </label>
              <label>
                Lead time days
                <input type="number" min={0} max={90} value={supplierDraft.leadTimeDays} onChange={(event) => updateSupplierDraft("leadTimeDays", Number(event.target.value))} required />
              </label>
              <label>
                Status
                <select value={supplierDraft.active ? "active" : "inactive"} onChange={(event) => updateSupplierDraft("active", event.target.value === "active")}>
                  <option value="" disabled>Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <div className="supplier-product-picker wide-field">
                {products.map((product) => (
                  <label key={product.id} className={supplierDraft.productIds.includes(product.id) ? "supplier-product-option selected" : "supplier-product-option"}>
                    <input
                      type="checkbox"
                      checked={supplierDraft.productIds.includes(product.id)}
                      onChange={() => toggleSupplierProduct(product.id)}
                    />
                    <span>{product.name}</span>
                    <small>{product.sku}</small>
                  </label>
                ))}
              </div>
              <div className="form-summary">
                <span>{supplierDraft.productIds.length} covered products</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save supplier</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
