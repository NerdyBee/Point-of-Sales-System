import { Armchair, CalendarDays, Check, Plus, RefreshCcw, Users, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addTableOrderItem,
  createRestaurantTable,
  createTableReservation,
  fetchBranchOptions,
  fetchCatalogProducts,
  fetchRestaurantTables,
  fetchStaff,
  openTableOrder,
  readStoredAuth,
  removeTableOrderItem,
  requestTableBill,
  transferTableOrder,
  updateTableLayout,
  updateTableReservationStatus,
  updateTableState,
  type BranchOption,
  type OpenTableOrderPayload,
  type RestaurantTable,
  type RestaurantTableState,
  type StaffMember,
  type TableCreatePayload,
  type TableLayoutPayload,
  type TableOrderItemPayload,
  type TableReservation,
  type TableReservationPayload,
  type TableOrder
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import type { Product } from "../catalog/types";
import type { SettledTableReceipt, TerminalTableContext } from "../sales/SalesTerminal";

const defaultBranchId = "";
const fallbackBranches: BranchOption[] = [];

const stateTone: Record<RestaurantTableState, "success" | "warning" | "danger" | "info"> = {
  available: "success",
  occupied: "info",
  reserved: "danger",
  awaiting_payment: "warning",
  delayed: "warning",
  unavailable: "danger"
};

const stateLabels: Record<RestaurantTableState, string> = {
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  awaiting_payment: "Awaiting payment",
  delayed: "Delayed",
  unavailable: "Unavailable"
};

const prepTone: Record<NonNullable<TableOrder["prepStatus"]>, "success" | "warning" | "danger" | "info"> = {
  new: "warning",
  preparing: "info",
  ready: "success",
  served: "success"
};

function defaultReservation(tableId = "", branchId = defaultBranchId): TableReservationPayload {
  const reservedAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  reservedAt.setMinutes(0, 0, 0);

  return {
    branchId,
    tableId,
    customerName: "",
    phone: "",
    guests: 2,
    reservedAt: reservedAt.toISOString().slice(0, 16),
    durationMinutes: 120,
    note: ""
  };
}

interface FloorPlanViewProps {
  onSendToPos?: (context: TerminalTableContext) => void;
  settledReceipt?: SettledTableReceipt | null;
  onSettledReceiptSeen?: () => void;
}

export function FloorPlanView({ onSendToPos, settledReceipt, onSettledReceiptSeen }: FloorPlanViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? defaultBranchId;
  const activeUserId = storedAuth?.staff.id ?? "";
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [reservations, setReservations] = useState<TableReservation[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [form, setForm] = useState<OpenTableOrderPayload>({
    tableId: "",
    guests: 2,
    waiterId: storedAuth?.staff.id ?? "",
    customerName: "",
    specialInstructions: ""
  });
  const [reservationForm, setReservationForm] = useState<TableReservationPayload>(defaultReservation("", initialBranchId));
  const [reservationModalOpen, setReservationModalOpen] = useState(false);
  const [layoutForm, setLayoutForm] = useState<TableLayoutPayload>({
    area: "",
    label: "",
    seats: 2,
    x: 50,
    y: 50
  });
  const [layoutMode, setLayoutMode] = useState<"create" | "edit">("edit");
  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [itemForm, setItemForm] = useState<TableOrderItemPayload>({
    productId: "",
    quantity: 1,
    modifiers: [],
    note: ""
  });
  const [transferTargetTableId, setTransferTargetTableId] = useState("");
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? tables[0],
    [selectedTableId, tables]
  );
  const selectedOrder = useMemo(
    () => orders.find((order) => order.tableId === selectedTable?.id && order.status !== "closed" && order.status !== "cancelled") ?? null,
    [orders, selectedTable]
  );
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === itemForm.productId) ?? null,
    [itemForm.productId, products]
  );
  const branchProducts = useMemo(
    () => products.filter((product) => product.branchId === branchId),
    [branchId, products]
  );
  const selectedOrderTotal = useMemo(
    () => selectedOrder?.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) ?? 0,
    [selectedOrder]
  );
  const waiterOptions = useMemo(() => staff.filter((member) => member.active), [staff]);
  const actingWaiterId = selectedOrder?.waiterId ?? form.waiterId ?? storedAuth?.staff.id ?? "";
  const transferTableOptions = useMemo(
    () => tables.filter((table) => table.id !== selectedTable?.id && !table.orderId && (table.state === "available" || table.state === "reserved")),
    [selectedTable?.id, tables]
  );
  const reservationPage = usePaginatedRows(reservations, 4);
  const tableSummaryPage = usePaginatedRows(tables, 8);

  const counts = useMemo(() => {
    return tables.reduce<Record<RestaurantTableState, number>>(
      (acc, table) => ({ ...acc, [table.state]: acc[table.state] + 1 }),
      { available: 0, occupied: 0, reserved: 0, awaiting_payment: 0, delayed: 0, unavailable: 0 }
    );
  }, [tables]);

  async function loadTables(nextBranchId = branchId) {
    try {
      if (!nextBranchId) {
        setTables([]);
        setOrders([]);
        setStaff([]);
        setReservations([]);
        setSelectedTableId("");
        setStatus("Select a branch");
        return;
      }

      const [branchResponse, response, staffResponse] = await Promise.all([fetchBranchOptions(), fetchRestaurantTables(nextBranchId, activeUserId), fetchStaff(nextBranchId, activeUserId)]);
      setBranches(branchResponse.branches.length ? branchResponse.branches : fallbackBranches);
      setTables(response.tables);
      setOrders(response.openOrders);
      setStaff(staffResponse.staff);
      setReservations(response.reservations);
      const nextSelectedTableId = response.tables.some((table) => table.id === selectedTableId) ? selectedTableId : response.tables[0]?.id ?? "";
      setSelectedTableId(nextSelectedTableId);
      setForm((current) => ({
        ...current,
        tableId: response.tables.some((table) => table.id === current.tableId) ? current.tableId : nextSelectedTableId,
        waiterId: staffResponse.staff.some((member) => member.id === current.waiterId) ? current.waiterId : staffResponse.staff.find((member) => member.active)?.id ?? ""
      }));
      setStatus("Floor synced");
    } catch (error) {
      setTables([]);
      setOrders([]);
      setBranches(fallbackBranches);
      setStaff([]);
      setReservations([]);
      setSelectedTableId("");
      setStatus(error instanceof Error ? error.message : "Unable to load floor");
    }
  }

  useEffect(() => {
    void loadTables();
    void loadCatalog(branchId);
  }, []);

  useEffect(() => {
    if (!settledReceipt) {
      return;
    }

    setStatus(`${settledReceipt.tableLabel ?? "Table"} settled: ${settledReceipt.saleId}`);
    void loadTables();
  }, [settledReceipt?.saleId]);

  async function loadCatalog(nextBranchId = branchId) {
    try {
      if (!nextBranchId) {
        setProducts([]);
        return;
      }

      const response = await fetchCatalogProducts(nextBranchId);
      setProducts(response.products);
    } catch {
      setProducts([]);
    }
  }

  function selectTable(table: RestaurantTable) {
    setSelectedTableId(table.id);
    setTransferTargetTableId("");
    setForm((current) => ({ ...current, tableId: table.id, guests: Math.max(1, table.guests || Math.min(table.seats, 2)) }));
    setReservationForm((current) => ({ ...current, branchId, tableId: table.id, guests: Math.max(1, Math.min(table.seats, current.guests)) }));
  }

  function openReservationModal() {
    setReservationForm(defaultReservation(selectedTable?.id ?? "", branchId));
    setReservationModalOpen(true);
  }

  function changeBranch(nextBranchId: string) {
    if (!nextBranchId) return;

    setBranchId(nextBranchId);
    setSelectedTableId("");
    setForm({ tableId: "", guests: 2, waiterId: "", customerName: "", specialInstructions: "" });
    setReservationForm(defaultReservation("", nextBranchId));
    setItemForm({ productId: "", quantity: 1, modifiers: [], note: "" });
    void loadTables(nextBranchId);
    void loadCatalog(nextBranchId);
  }

  function openLayoutModal() {
    if (!selectedTable) {
      setStatus("Select a table to edit");
      return;
    }

    setLayoutMode("edit");
    setLayoutForm({
      area: selectedTable.area,
      label: selectedTable.label,
      seats: selectedTable.seats,
      x: selectedTable.x,
      y: selectedTable.y
    });
    setLayoutModalOpen(true);
  }

  function openCreateTableModal() {
    if (!branchId) {
      setStatus("Select a branch before adding tables");
      return;
    }

    const nextNumber = tables.length + 1;
    setLayoutMode("create");
    setLayoutForm({
      area: selectedTable?.area ?? "Main Dining",
      label: `T${String(nextNumber).padStart(2, "0")}`,
      seats: 4,
      x: 50,
      y: 50
    });
    setLayoutModalOpen(true);
  }

  function updateLayoutForm<K extends keyof TableLayoutPayload>(key: K, value: TableLayoutPayload[K]) {
    setLayoutForm((current) => ({ ...current, [key]: value }));
  }

  async function submitTableOrder(event: FormEvent) {
    event.preventDefault();

    if (!form.waiterId) {
      setStatus("Select a waiter");
      return;
    }

    setStatus("Opening table order...");

    try {
      const response = await openTableOrder(form, branchId);
      setTables((current) => current.map((table) => (table.id === response.table.id ? response.table : table)));
      setOrders((current) => [response.order, ...current]);
      onSendToPos?.({
        tableId: response.table.id,
        tableLabel: response.table.label,
        tableOrderId: response.order.id,
        guests: response.order.guests,
        waiterId: response.order.waiterId,
        customerName: response.order.customerName,
        items: []
      });
      setStatus(`Opened ${response.table.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to open table");
    }
  }

  async function changeState(state: RestaurantTableState, reason: string) {
    if (!selectedTable) {
      return;
    }

    setStatus("Updating table state...");

    try {
      const response = await updateTableState(selectedTable.id, state, reason, branchId, activeUserId);
      setTables((current) => current.map((table) => (table.id === response.table.id ? response.table : table)));
      setStatus(`${response.table.label} is ${stateLabels[response.table.state]}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update table");
    }
  }

  async function submitReservation(event: FormEvent) {
    event.preventDefault();

    if (!reservationForm.tableId) {
      setStatus("Select a table");
      return;
    }

    setStatus("Creating reservation...");

    try {
      const response = await createTableReservation({
        ...reservationForm,
        reservedAt: new Date(reservationForm.reservedAt).toISOString()
      }, activeUserId);
      setTables((current) => current.map((table) => (table.id === response.table.id ? response.table : table)));
      setReservations((current) => [response.reservation, ...current]);
      setReservationModalOpen(false);
      setStatus(`Reserved ${response.table.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create reservation");
    }
  }

  async function changeReservationStatus(reservation: TableReservation, status: "seated" | "cancelled" | "no_show") {
    const statusCopy = status === "no_show" ? "Marking no-show..." : status === "seated" ? "Seating reservation..." : "Cancelling reservation...";
    setStatus(statusCopy);

    try {
      const response = await updateTableReservationStatus(reservation.id, { status, note: status === "seated" ? "Guest arrived" : "Floor action" }, branchId, activeUserId);
      setReservations((current) => current.filter((item) => item.id !== response.reservation.id));
      if (response.table) {
        setTables((current) => current.map((table) => (table.id === response.table?.id ? response.table : table)));
      }
      if (status === "seated") {
        setSelectedTableId(reservation.tableId);
        setForm((current) => ({
          ...current,
          tableId: reservation.tableId,
          guests: reservation.guests,
          waiterId: current.waiterId || waiterOptions[0]?.id || "",
          customerName: reservation.customerName,
          specialInstructions: reservation.note ?? ""
        }));
      }
      setStatus(status === "seated" ? `${reservation.customerName} ready to open order` : `${reservation.customerName} ${status === "no_show" ? "marked no-show" : "cancelled"}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update reservation");
    }
  }

  async function submitLayout(event: FormEvent) {
    event.preventDefault();

    if (layoutMode === "edit" && !selectedTable) {
      return;
    }

    if (layoutMode === "create" && !branchId) {
      setStatus("Select a branch before adding tables");
      return;
    }

    setStatus(layoutMode === "create" ? "Creating table..." : "Saving table layout...");

    try {
      if (layoutMode === "create") {
        const payload: TableCreatePayload = { ...layoutForm, branchId };
        const response = await createRestaurantTable(payload, activeUserId);
        setTables((current) => [...current, response.table]);
        setSelectedTableId(response.table.id);
        setForm((current) => ({ ...current, tableId: response.table.id, guests: Math.min(response.table.seats, current.guests || 2) }));
        setLayoutModalOpen(false);
        setStatus(`Added ${response.table.label}`);
        return;
      }

      const response = await updateTableLayout(selectedTable.id, layoutForm, branchId, activeUserId);
      setTables((current) => current.map((table) => (table.id === response.table.id ? response.table : table)));
      setLayoutModalOpen(false);
      setStatus(`Updated ${response.table.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update table layout");
    }
  }

  async function submitOrderItem(event: FormEvent) {
    event.preventDefault();

    if (!selectedOrder) {
      setStatus("Open a table order before adding items");
      return;
    }

    if (!itemForm.productId) {
      setStatus("Select a product");
      return;
    }

    setStatus("Adding table order item...");

    try {
      const response = await addTableOrderItem(selectedOrder.id, itemForm, branchId, actingWaiterId);
      setOrders((current) => current.map((order) => (order.id === response.order.id ? response.order : order)));
      setItemForm((current) => ({ ...current, quantity: 1, modifiers: [], note: "" }));
      setStatus(`${response.item.productName} routed to ${response.prepTicket.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to add table item");
    }
  }

  async function removeOrderItem(itemId: string) {
    if (!selectedOrder) return;

    setStatus("Removing table order item...");

    try {
      const response = await removeTableOrderItem(selectedOrder.id, itemId, branchId, actingWaiterId);
      setOrders((current) => current.map((order) => (order.id === response.order.id ? response.order : order)));
      setStatus("Table order item removed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove table item");
    }
  }

  async function requestBill() {
    if (!selectedTable) return;

    if (!selectedOrder) {
      await changeState("awaiting_payment", "Bill requested");
      return;
    }

    setStatus("Requesting table bill...");

    try {
      const response = await requestTableBill(selectedOrder.id, "Waiter requested bill", branchId, actingWaiterId);
      setTables((current) => current.map((table) => (table.id === response.table.id ? response.table : table)));
      setOrders((current) => current.map((order) => (order.id === response.order.id ? response.order : order)));
      onSendToPos?.({
        tableId: response.table.id,
        tableLabel: response.table.label,
        tableOrderId: response.order.id,
        guests: response.order.guests,
        waiterId: response.order.waiterId,
        customerName: response.order.customerName,
        items: tableItemsForPos(response.order)
      });
      setStatus(`Bill requested for ${response.table.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to request bill");
    }
  }

  async function transferSelectedOrder() {
    if (!selectedOrder) {
      setStatus("Open a table order before transferring");
      return;
    }

    if (!transferTargetTableId) {
      setStatus("Select a target table");
      return;
    }

    setStatus("Transferring table order...");

    try {
      const response = await transferTableOrder(selectedOrder.id, { targetTableId: transferTargetTableId, reason: "Guest moved table" }, branchId, actingWaiterId);
      setTables((current) =>
        current.map((table) => {
          if (response.sourceTable && table.id === response.sourceTable.id) return response.sourceTable;
          if (table.id === response.targetTable.id) return response.targetTable;
          return table;
        })
      );
      setOrders((current) => current.map((order) => (order.id === response.order.id ? response.order : order)));
      setSelectedTableId(response.targetTable.id);
      setForm((current) => ({ ...current, tableId: response.targetTable.id, guests: response.order.guests, waiterId: response.order.waiterId }));
      setTransferTargetTableId("");
      setStatus(`Transferred order to ${response.targetTable.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to transfer table order");
    }
  }

  function tableItemsForPos(order: TableOrder | null) {
    if (!order) return [];

    return order.items
      .map((item) => {
        const product = branchProducts.find((catalogProduct) => catalogProduct.id === item.productId);
        return product ? { product, quantity: item.quantity, discount: 0, note: [item.modifiers.join(", "), item.note].filter(Boolean).join(" | ") } : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  function sendSelectedTableToPos() {
    if (!selectedTable) return;

    onSendToPos?.({
      tableId: selectedTable.id,
      tableLabel: selectedTable.label,
      tableOrderId: selectedOrder?.id ?? selectedTable.orderId,
      guests: selectedOrder?.guests ?? selectedTable.guests,
      waiterId: selectedOrder?.waiterId ?? selectedTable.waiterId,
      customerName: selectedOrder?.customerName ?? selectedTable.customerName,
      items: tableItemsForPos(selectedOrder)
    });
    setStatus(`${selectedTable.label} sent to POS`);
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Hospitality operations</p>
          <h1>Restaurant floor</h1>
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
          <button className="secondary-button" onClick={() => void loadTables()}><RefreshCcw size={18} /> Sync</button>
          <button className="secondary-button" onClick={openReservationModal}><CalendarDays size={18} /> Reservations</button>
          <button className="secondary-button" onClick={openCreateTableModal}><Plus size={18} /> Add table</button>
          <button className="primary-button" onClick={openLayoutModal}><Armchair size={18} /> Edit table</button>
        </div>
      </div>
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top"><span>Available</span></div>
          <strong>{counts.available}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Occupied</span></div>
          <strong>{counts.occupied}</strong>
          <small>{orders.length} open orders</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Awaiting payment</span></div>
          <strong>{counts.awaiting_payment}</strong>
          <small>Bill requested</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Reservations</span></div>
          <strong>{reservations.length}</strong>
          <small>Upcoming bookings</small>
        </article>
      </section>
      {settledReceipt ? (
        <section className="settlement-banner">
          <div>
            <span>Settlement complete</span>
            <strong>{settledReceipt.tableLabel ?? "Table"} closed for {displayMoney(settledReceipt.total)}</strong>
            <small>{settledReceipt.saleId} - {new Date(settledReceipt.settledAt).toLocaleTimeString()}</small>
          </div>
          <button className="secondary-button" onClick={onSettledReceiptSeen}>Clear</button>
        </section>
      ) : null}
      <section className="floor-wrap">
        <div className="floor-map">
          {tables.length === 0 ? (
            <div className="empty-state">
              <span>No floor tables found for this branch.</span>
              <button className="secondary-button" onClick={openCreateTableModal}><Plus size={18} /> Add table</button>
            </div>
          ) : tables.map((table) => (
            <button
              className={`table-node table-${stateTone[table.state]} ${selectedTableId === table.id ? "table-selected" : ""}`}
              key={table.id}
              onClick={() => selectTable(table)}
              style={{ left: `${table.x}%`, top: `${table.y}%` }}
            >
              <strong>{table.label}</strong>
              <span><Users size={14} /> {table.guests}</span>
            </button>
          ))}
        </div>
        <aside className="panel table-control-panel">
          <div className="panel-header">
            <h2>{selectedTable?.label ?? "Table"} controls</h2>
            {selectedTable ? <StatusBadge label={stateLabels[selectedTable.state]} tone={stateTone[selectedTable.state]} /> : null}
          </div>
          {selectedTable ? (
            <div className="table-pos-context">
              <span>{selectedOrder?.id ?? selectedTable.orderId ?? "No active order"}</span>
              <strong>{selectedTable.customerName || "Walk-in guest"}</strong>
              {selectedOrder?.prepStatus ? <StatusBadge label={`Prep ${selectedOrder.prepStatus}`} tone={prepTone[selectedOrder.prepStatus]} /> : null}
              {selectedOrder?.status === "bill_requested" ? <StatusBadge label="Bill requested" tone="warning" /> : null}
              <button className="secondary-button" onClick={sendSelectedTableToPos} disabled={!selectedOrder && !selectedTable.orderId}>
                Send to POS
              </button>
            </div>
          ) : null}
          {selectedTable ? (
            <form className="table-order-form" onSubmit={submitTableOrder}>
              <label>
                Guests
                <input
                  max={selectedTable.seats}
                  min="1"
                  type="number"
                  value={form.guests}
                  onChange={(event) => setForm((current) => ({ ...current, guests: Number(event.target.value) }))}
                />
              </label>
              <label>
                Waiter
                <select value={form.waiterId} onChange={(event) => setForm((current) => ({ ...current, waiterId: event.target.value }))}>
                  <option value="" disabled>Waiter</option>
                  {waiterOptions.map((member) => <option key={member.id} value={member.id}>{member.name} - {member.role}</option>)}
                </select>
              </label>
              <label className="wide-field">
                Customer
                <input value={form.customerName ?? ""} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} />
              </label>
              <label className="wide-field">
                Instructions
                <input value={form.specialInstructions ?? ""} onChange={(event) => setForm((current) => ({ ...current, specialInstructions: event.target.value }))} />
              </label>
              <button className="primary-button wide-field" disabled={selectedTable.state === "occupied" || selectedTable.state === "awaiting_payment"} type="submit">
                <Check size={18} /> Open order
              </button>
            </form>
          ) : null}
          {selectedOrder ? (
            <form className="table-item-form" onSubmit={submitOrderItem}>
              <div className="panel-header">
                <h2>Order items</h2>
                <span>{displayMoney(selectedOrderTotal)}</span>
              </div>
              <label>
                Product
                <select value={itemForm.productId} onChange={(event) => {
                  const nextProduct = products.find((product) => product.id === event.target.value);
                  setItemForm((current) => ({
                    ...current,
                    productId: event.target.value,
                    modifiers: nextProduct?.modifiers.slice(0, 1) ?? []
                  }));
                }}>
                  <option value="" disabled>Product</option>
                  {branchProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </label>
              <label>
                Quantity
                <input min="1" type="number" value={itemForm.quantity} onChange={(event) => setItemForm((current) => ({ ...current, quantity: Number(event.target.value) }))} />
              </label>
              <label className="wide-field">
                Modifiers
                <input
                  value={itemForm.modifiers.join(", ")}
                  onChange={(event) => setItemForm((current) => ({ ...current, modifiers: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
                  placeholder={selectedProduct?.modifiers.join(", ") ?? "No modifiers"}
                />
              </label>
              <label className="wide-field">
                Note
                <input value={itemForm.note ?? ""} onChange={(event) => setItemForm((current) => ({ ...current, note: event.target.value }))} />
              </label>
              <button className="secondary-button wide-field" type="submit"><Check size={18} /> Add item</button>
              <div className="table-order-items wide-field">
                {selectedOrder.items.length === 0 ? (
                  <div className="empty-state">No items added to this table yet.</div>
                ) : (
                  selectedOrder.items.map((item) => (
                    <div className="list-row" key={item.id}>
                      <div>
                        <strong>{item.quantity}x {item.productName}</strong>
                        <span>{item.station} - {[item.modifiers.join(", "), item.note].filter(Boolean).join(" - ") || "No notes"}</span>
                      </div>
                      <b>{displayMoney(item.unitPrice * item.quantity)}</b>
                      <button type="button" className="icon-danger" onClick={() => removeOrderItem(item.id)} aria-label={`Remove ${item.productName}`}>
                        <X size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </form>
          ) : null}
          <div className="table-state-actions">
            <button onClick={requestBill} disabled={!selectedTable || selectedTable.state === "available"}>Bill</button>
            <button onClick={() => changeState("available", "Bill paid")}>Release</button>
            <button onClick={() => changeState("delayed", "Kitchen delay")}>Delay</button>
          </div>
          <div className="table-transfer-control">
            <select value={transferTargetTableId} onChange={(event) => setTransferTargetTableId(event.target.value)} disabled={!selectedOrder}>
              <option value="">Transfer to table</option>
              {transferTableOptions.map((table) => (
                <option key={table.id} value={table.id}>{table.label} - {stateLabels[table.state]} - {table.seats} seats</option>
              ))}
            </select>
            <button className="secondary-button" onClick={transferSelectedOrder} disabled={!selectedOrder || !transferTargetTableId}>
              Transfer
            </button>
          </div>
          <div className="stack">
            {reservationPage.pageRows.map((reservation, index) => (
              <div className="list-row reservation-row" key={reservation.id}>
                <div>
                  <strong><span className="number-cell">{reservationPage.startIndex + index + 1}</span>{reservation.customerName}</strong>
                  <span>{reservation.tableLabel} - {reservation.guests} guests - {new Date(reservation.reservedAt).toLocaleTimeString()}</span>
                </div>
                <div className="row-action-stack">
                  <StatusBadge label={reservation.status} tone="info" />
                  <button type="button" onClick={() => changeReservationStatus(reservation, "seated")}>Seat</button>
                  <button type="button" onClick={() => changeReservationStatus(reservation, "no_show")}>No-show</button>
                  <button type="button" onClick={() => changeReservationStatus(reservation, "cancelled")}>Cancel</button>
                </div>
              </div>
            ))}
            {reservations.length > 0 ? (
              <TablePagination
                page={reservationPage.page}
                pageCount={reservationPage.pageCount}
                pageSize={reservationPage.pageSize}
                totalRows={reservationPage.totalRows}
                startIndex={reservationPage.startIndex}
                visibleCount={reservationPage.pageRows.length}
                onPageChange={reservationPage.setPage}
                onPageSizeChange={reservationPage.setPageSize}
              />
            ) : null}
            {tableSummaryPage.pageRows.map((table, index) => {
              const tableOrder = orders.find((order) => order.tableId === table.id);
              return (
                <div className="list-row" key={table.id}>
                  <div>
                    <strong><span className="number-cell">{tableSummaryPage.startIndex + index + 1}</span>{table.label}</strong>
                    <span>{table.area} - {table.guests}/{table.seats} guests</span>
                  </div>
                  {tableOrder?.prepStatus ? (
                    <StatusBadge
                      label={tableOrder.status === "bill_requested" ? "Bill requested" : `Prep ${tableOrder.prepStatus}`}
                      tone={tableOrder.status === "bill_requested" ? "warning" : prepTone[tableOrder.prepStatus]}
                    />
                  ) : (
                    <StatusBadge label={stateLabels[table.state]} tone={stateTone[table.state]} />
                  )}
                </div>
              );
            })}
            {tables.length > 0 ? (
              <TablePagination
                page={tableSummaryPage.page}
                pageCount={tableSummaryPage.pageCount}
                pageSize={tableSummaryPage.pageSize}
                totalRows={tableSummaryPage.totalRows}
                startIndex={tableSummaryPage.startIndex}
                visibleCount={tableSummaryPage.pageRows.length}
                onPageChange={tableSummaryPage.setPage}
                onPageSizeChange={tableSummaryPage.setPageSize}
              />
            ) : null}
          </div>
        </aside>
      </section>
      {reservationModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setReservationModalOpen(false)}>
          <section className="modal-panel reservation-modal" role="dialog" aria-modal="true" aria-labelledby="reservation-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Floor booking</p>
                <h2 id="reservation-modal-title">Create reservation</h2>
              </div>
              <button className="icon-button" onClick={() => setReservationModalOpen(false)} aria-label="Close reservation modal"><X size={18} /></button>
            </div>
            <form className="reservation-form" onSubmit={submitReservation}>
              <label>
                Table
                <select value={reservationForm.tableId} onChange={(event) => setReservationForm((current) => ({ ...current, tableId: event.target.value }))}>
                  <option value="" disabled>Table</option>
                  {tables.map((table) => <option key={table.id} value={table.id}>{table.label} - {table.seats} seats</option>)}
                </select>
              </label>
              <label>
                Guests
                <input min="1" type="number" value={reservationForm.guests} onChange={(event) => setReservationForm((current) => ({ ...current, guests: Number(event.target.value) }))} />
              </label>
              <label>
                Customer
                <input value={reservationForm.customerName} onChange={(event) => setReservationForm((current) => ({ ...current, customerName: event.target.value }))} required />
              </label>
              <label>
                Phone
                <input value={reservationForm.phone} onChange={(event) => setReservationForm((current) => ({ ...current, phone: event.target.value }))} required />
              </label>
              <label>
                Reserved at
                <input type="datetime-local" value={reservationForm.reservedAt} onChange={(event) => setReservationForm((current) => ({ ...current, reservedAt: event.target.value }))} required />
              </label>
              <label>
                Duration
                <select value={reservationForm.durationMinutes} onChange={(event) => setReservationForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))}>
                  <option value="" disabled>Duration</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                </select>
              </label>
              <label className="wide-field">
                Note
                <input value={reservationForm.note ?? ""} onChange={(event) => setReservationForm((current) => ({ ...current, note: event.target.value }))} />
              </label>
              <div className="form-summary">
                <span>{status}</span>
                <span>{reservations.length} active reservations</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save reservation</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {layoutModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setLayoutModalOpen(false)}>
          <section className="modal-panel reservation-modal" role="dialog" aria-modal="true" aria-labelledby="layout-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Floor setup</p>
                <h2 id="layout-modal-title">{layoutMode === "create" ? "Add table" : "Edit table"}</h2>
              </div>
              <button className="icon-button" onClick={() => setLayoutModalOpen(false)} aria-label="Close floor edit modal"><X size={18} /></button>
            </div>
            <form className="reservation-form" onSubmit={submitLayout}>
              <label>
                Label
                <input value={layoutForm.label} onChange={(event) => updateLayoutForm("label", event.target.value)} required />
              </label>
              <label>
                Area
                <input value={layoutForm.area} onChange={(event) => updateLayoutForm("area", event.target.value)} required />
              </label>
              <label>
                Seats
                <input min="1" max="24" type="number" value={layoutForm.seats} onChange={(event) => updateLayoutForm("seats", Number(event.target.value))} required />
              </label>
              <label>
                X position
                <input min="0" max="100" type="number" value={layoutForm.x} onChange={(event) => updateLayoutForm("x", Number(event.target.value))} required />
              </label>
              <label>
                Y position
                <input min="0" max="100" type="number" value={layoutForm.y} onChange={(event) => updateLayoutForm("y", Number(event.target.value))} required />
              </label>
              <div className="form-summary">
                <span>{layoutMode === "create" ? branches.find((branch) => branch.id === branchId)?.name ?? "New table" : selectedTable?.label ?? "Table"}</span>
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> {layoutMode === "create" ? "Create table" : "Save table"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
