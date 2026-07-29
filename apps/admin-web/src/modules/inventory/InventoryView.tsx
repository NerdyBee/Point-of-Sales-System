import { ArrowDownUp, Check, ClipboardCheck, Download, FileText, Plus, RefreshCcw, Search, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  createApproval,
  createInventoryTransfer,
  createPurchaseOrder,
  createSupplierInvoice,
  createSupplierReturn,
  createSupplier,
  createStockAdjustment,
  createStockCount,
  fetchBranchOptions,
  fetchInventoryStock,
  fetchInventoryTransfers,
  fetchPurchaseOrders,
  fetchSuppliers,
  fetchSupplierInvoices,
  fetchSupplierReturns,
  fetchSupplierStatement,
  readStoredAuth,
  recordSupplierInvoicePayment,
  receivePurchase,
  updatePurchaseOrderStatus,
  type ApprovalRequest,
  type BranchOption,
  type InventoryTransfer,
  type PaymentMethodCode,
  type PurchaseOrder,
  type PurchaseOrderPayload,
  type PurchaseReceiptPayload,
  type PurchaseOrderStatus,
  type StockAdjustmentPayload,
  type StockCountPayload,
  type StockTransferPayload,
  type StockMovement,
  type SupplierInvoice,
  type SupplierInvoicePayload,
  type SupplierInvoicePaymentPayload,
  type SupplierReturn,
  type SupplierReturnPayload,
  type SupplierStatement,
  type Supplier,
  type SupplierPayload
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import type { Product } from "../catalog/types";

const defaultBranchId = "";
const fallbackBranches: BranchOption[] = [];

function isServiceCategory(category: string) {
  return category.trim().toLowerCase() === "services";
}

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
    note: "Supplier delivery",
    purchaseOrderId: ""
  };
}

function defaultPurchaseOrder(branchId = defaultBranchId): PurchaseOrderPayload {
  return {
    branchId,
    supplierId: "",
    expectedAt: "",
    note: "",
    lines: [{ productId: "", quantity: 1, unitCost: undefined }]
  };
}

function defaultSupplierInvoice(branchId = defaultBranchId): SupplierInvoicePayload {
  return {
    branchId,
    supplierId: "",
    purchaseOrderId: "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString(),
    dueDate: "",
    amount: 0,
    note: ""
  };
}

function defaultSupplierPayment(balanceDue = 0): SupplierInvoicePaymentPayload {
  return {
    amount: balanceDue,
    paymentMethod: "" as PaymentMethodCode,
    reference: "",
    paidAt: new Date().toISOString(),
    note: ""
  };
}

function defaultSupplierReturn(branchId = defaultBranchId): SupplierReturnPayload {
  return {
    branchId,
    supplierId: "",
    productId: "",
    supplierInvoiceId: "",
    quantity: 1,
    unitCost: undefined,
    reference: "",
    reason: "Damaged or incorrect supplier delivery",
    returnedAt: new Date().toISOString()
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

function defaultTransfer(branchId = defaultBranchId): StockTransferPayload {
  return {
    sourceBranchId: branchId,
    destinationBranchId: "",
    sourceProductId: "",
    destinationProductId: "",
    quantity: 1,
    reference: `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    note: "Branch stock transfer"
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
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoice[]>([]);
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [adjustment, setAdjustment] = useState<StockAdjustmentPayload>(defaultAdjustment(initialBranchId));
  const [purchase, setPurchase] = useState<PurchaseReceiptPayload>(defaultPurchase(initialBranchId));
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<SupplierPayload>(defaultSupplier(initialBranchId));
  const [purchaseOrderModalOpen, setPurchaseOrderModalOpen] = useState(false);
  const [purchaseOrderDraft, setPurchaseOrderDraft] = useState<PurchaseOrderPayload>(defaultPurchaseOrder(initialBranchId));
  const [supplierInvoiceModalOpen, setSupplierInvoiceModalOpen] = useState(false);
  const [supplierInvoiceDraft, setSupplierInvoiceDraft] = useState<SupplierInvoicePayload>(defaultSupplierInvoice(initialBranchId));
  const [invoicePaymentTarget, setInvoicePaymentTarget] = useState<SupplierInvoice | null>(null);
  const [supplierPaymentDraft, setSupplierPaymentDraft] = useState<SupplierInvoicePaymentPayload>(defaultSupplierPayment());
  const [supplierReturnModalOpen, setSupplierReturnModalOpen] = useState(false);
  const [supplierReturnDraft, setSupplierReturnDraft] = useState<SupplierReturnPayload>(defaultSupplierReturn(initialBranchId));
  const [supplierStatement, setSupplierStatement] = useState<SupplierStatement | null>(null);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferDraft, setTransferDraft] = useState<StockTransferPayload>(defaultTransfer(initialBranchId));
  const [destinationProducts, setDestinationProducts] = useState<Product[]>([]);
  const [adjustmentApprovalId, setAdjustmentApprovalId] = useState("");
  const [countModalOpen, setCountModalOpen] = useState(false);
  const [countReference, setCountReference] = useState(`COUNT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  const [countReason, setCountReason] = useState("Cycle count");
  const [countValues, setCountValues] = useState<Record<string, number>>({});
  const [countApprovalId, setCountApprovalId] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [stockCategoryFilter, setStockCategoryFilter] = useState("");
  const [stockStatusFilter, setStockStatusFilter] = useState("");
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handledApprovalIdRef = useRef<string | null>(null);

  const productCategories = useMemo(() => Array.from(new Set(products.map((product) => product.category))).sort(), [products]);
  const stockTrackedProducts = useMemo(() => products.filter((product) => !isServiceCategory(product.category)), [products]);
  const filteredStockProducts = useMemo(() => {
    const normalizedQuery = stockQuery.trim().toLowerCase();
    return products.filter((product) => {
      const isService = isServiceCategory(product.category);
      const isLowStock = !isService && product.stock <= product.reorderPoint;
      const matchesQuery = !normalizedQuery || [
        product.name,
        product.sku,
        product.barcode,
        product.category,
        String(product.stock),
        String(product.reorderPoint)
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesCategory = !stockCategoryFilter || product.category === stockCategoryFilter;
      const matchesStatus =
        !stockStatusFilter ||
        (stockStatusFilter === "tracked" && !isService) ||
        (stockStatusFilter === "service" && isService) ||
        (stockStatusFilter === "low" && isLowStock) ||
        (stockStatusFilter === "healthy" && !isService && !isLowStock);

      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [products, stockCategoryFilter, stockQuery, stockStatusFilter]);
  const inventoryValue = useMemo(() => stockTrackedProducts.reduce((sum, product) => sum + product.stock * product.cost, 0), [stockTrackedProducts]);
  const lowStockCount = useMemo(() => stockTrackedProducts.filter((product) => product.stock <= product.reorderPoint).length, [stockTrackedProducts]);
  const lowStockProducts = useMemo(
    () => stockTrackedProducts.filter((product) => product.stock <= product.reorderPoint),
    [stockTrackedProducts]
  );
  const selectedAdjustmentProduct = useMemo(
    () => products.find((product) => product.id === adjustment.productId) ?? null,
    [adjustment.productId, products]
  );
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === purchase.supplierId) ?? null,
    [purchase.supplierId, suppliers]
  );
  const supplierProducts = useMemo(
    () => selectedSupplier ? stockTrackedProducts.filter((product) => selectedSupplier.productIds.includes(product.id)) : stockTrackedProducts,
    [selectedSupplier, stockTrackedProducts]
  );
  const selectedPurchaseProduct = useMemo(
    () => supplierProducts.find((product) => product.id === purchase.productId) ?? null,
    [purchase.productId, supplierProducts]
  );
  const receivableOrders = useMemo(
    () => purchaseOrders.filter((order) => ["approved", "partially_received"].includes(order.status)),
    [purchaseOrders]
  );
  const selectedReceiptOrder = useMemo(
    () => receivableOrders.find((order) => order.id === purchase.purchaseOrderId) ?? null,
    [purchase.purchaseOrderId, receivableOrders]
  );
  const selectedOrderSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === purchaseOrderDraft.supplierId) ?? null,
    [purchaseOrderDraft.supplierId, suppliers]
  );
  const orderProducts = useMemo(
    () => selectedOrderSupplier ? stockTrackedProducts.filter((product) => selectedOrderSupplier.productIds.includes(product.id)) : stockTrackedProducts,
    [selectedOrderSupplier, stockTrackedProducts]
  );
  const purchaseOrderSubtotal = useMemo(
    () =>
      purchaseOrderDraft.lines.reduce((sum, line) => {
        const product = products.find((item) => item.id === line.productId);
        return sum + (line.unitCost ?? product?.cost ?? 0) * line.quantity;
      }, 0),
    [products, purchaseOrderDraft.lines]
  );
  const supplierReorderOptions = useMemo(
    () =>
      suppliers
        .map((supplier) => ({
          supplier,
          products: lowStockProducts.filter((product) => supplier.productIds.includes(product.id))
        }))
        .filter((option) => option.products.length > 0),
    [lowStockProducts, suppliers]
  );
  const supplierOpenBalance = useMemo(
    () => supplierInvoices.reduce((sum, invoice) => sum + invoice.balanceDue, 0),
    [supplierInvoices]
  );
  const selectedReturnSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === supplierReturnDraft.supplierId) ?? null,
    [supplierReturnDraft.supplierId, suppliers]
  );
  const returnProducts = useMemo(
    () => selectedReturnSupplier ? stockTrackedProducts.filter((product) => selectedReturnSupplier.productIds.includes(product.id)) : stockTrackedProducts,
    [selectedReturnSupplier, stockTrackedProducts]
  );
  const selectedReturnProduct = useMemo(
    () => products.find((product) => product.id === supplierReturnDraft.productId) ?? null,
    [products, supplierReturnDraft.productId]
  );
  const stockPage = usePaginatedRows(filteredStockProducts, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const adjustmentValue = selectedAdjustmentProduct ? Math.abs(adjustment.quantityDelta) * selectedAdjustmentProduct.cost : 0;
  const countVarianceItems = useMemo(
    () => stockTrackedProducts.filter((product) => (countValues[product.id] ?? product.stock) !== product.stock).length,
    [countValues, stockTrackedProducts]
  );
  const countVarianceValue = useMemo(
    () =>
      stockTrackedProducts.reduce((sum, product) => {
        const countedQuantity = countValues[product.id] ?? product.stock;
        return sum + Math.abs(countedQuantity - product.stock) * product.cost;
      }, 0),
    [countValues, stockTrackedProducts]
  );

  async function loadInventory(nextBranchId = branchId) {
    try {
      if (!nextBranchId) {
        setProducts([]);
        setMovements([]);
        setSuppliers([]);
        setPurchaseOrders([]);
        setSupplierInvoices([]);
        setSupplierReturns([]);
        setTransfers([]);
        setCountValues({});
        setStatus("Select a branch");
        return;
      }

      const [branchResponse, stockResponse, transferResponse, supplierResponse, purchaseOrderResponse, supplierInvoiceResponse, supplierReturnResponse] = await Promise.all([
        fetchBranchOptions(),
        fetchInventoryStock(nextBranchId, activeUserId),
        fetchInventoryTransfers(nextBranchId, activeUserId),
        fetchSuppliers(nextBranchId, activeUserId),
        fetchPurchaseOrders(nextBranchId, "all", activeUserId),
        fetchSupplierInvoices(nextBranchId, "all", "", activeUserId),
        fetchSupplierReturns(nextBranchId, "", activeUserId)
      ]);
      setBranches(branchResponse.branches.length ? branchResponse.branches : fallbackBranches);
      setProducts(stockResponse.products);
      setMovements(stockResponse.movements);
      setSuppliers(supplierResponse.suppliers);
      setPurchaseOrders(purchaseOrderResponse.purchaseOrders);
      setSupplierInvoices(supplierInvoiceResponse.supplierInvoices);
      setSupplierReturns(supplierReturnResponse.supplierReturns);
      setTransfers(transferResponse.transfers);
      setCountValues(Object.fromEntries(stockResponse.products.filter((product) => !isServiceCategory(product.category)).map((product) => [product.id, product.stock])));
      setStatus("Inventory synced");
    } catch (error) {
      setProducts([]);
      setMovements([]);
      setBranches(fallbackBranches);
      setSuppliers([]);
      setPurchaseOrders([]);
      setSupplierInvoices([]);
      setSupplierReturns([]);
      setTransfers([]);
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
      setCountValues(Object.fromEntries(stockTrackedProducts.map((product) => [product.id, product.stock])));
      setCountModalOpen(true);
      setStatus(`Stock count approval ready: ${approvalHandoff.id}`);
    }
    onApprovalHandoffConsumed?.();
  }, [approvalHandoff?.id, products, stockTrackedProducts]);

  function updateAdjustment<K extends keyof StockAdjustmentPayload>(key: K, value: StockAdjustmentPayload[K]) {
    setAdjustment((current) => ({ ...current, [key]: value }));
  }

  function updatePurchase<K extends keyof PurchaseReceiptPayload>(key: K, value: PurchaseReceiptPayload[K]) {
    setPurchase((current) => ({ ...current, [key]: value }));
  }

  function updateSupplierDraft<K extends keyof SupplierPayload>(key: K, value: SupplierPayload[K]) {
    setSupplierDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePurchaseOrderDraft<K extends keyof PurchaseOrderPayload>(key: K, value: PurchaseOrderPayload[K]) {
    setPurchaseOrderDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSupplierInvoiceDraft<K extends keyof SupplierInvoicePayload>(key: K, value: SupplierInvoicePayload[K]) {
    setSupplierInvoiceDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSupplierPaymentDraft<K extends keyof SupplierInvoicePaymentPayload>(key: K, value: SupplierInvoicePaymentPayload[K]) {
    setSupplierPaymentDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSupplierReturnDraft<K extends keyof SupplierReturnPayload>(key: K, value: SupplierReturnPayload[K]) {
    setSupplierReturnDraft((current) => ({ ...current, [key]: value }));
  }

  function updateTransferDraft<K extends keyof StockTransferPayload>(key: K, value: StockTransferPayload[K]) {
    setTransferDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePurchaseOrderLine(index: number, patch: Partial<PurchaseOrderPayload["lines"][number]>) {
    setPurchaseOrderDraft((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    }));
  }

  function addPurchaseOrderLine() {
    setPurchaseOrderDraft((current) => ({ ...current, lines: [...current.lines, { productId: "", quantity: 1, unitCost: undefined }] }));
  }

  function removePurchaseOrderLine(index: number) {
    setPurchaseOrderDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }));
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
    setCountValues(Object.fromEntries(stockTrackedProducts.map((product) => [product.id, product.stock])));
    setCountReference(`COUNT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
    setCountReason("Cycle count");
    setCountApprovalId("");
    setCountModalOpen(true);
  }

  function openSupplierModal() {
    setSupplierDraft(defaultSupplier(branchId));
    setSupplierModalOpen(true);
  }

  function openPurchaseOrderModal() {
    setPurchaseOrderDraft(defaultPurchaseOrder(branchId));
    setPurchaseOrderModalOpen(true);
  }

  function recommendedReorderQuantity(product: Product) {
    const targetStock = Math.max(product.reorderPoint * 2, product.stock + 1);
    return Math.max(1, targetStock - product.stock);
  }

  function openReorderPurchaseOrder(supplierId?: string) {
    const selectedOption = supplierId
      ? supplierReorderOptions.find((option) => option.supplier.id === supplierId)
      : supplierReorderOptions[0];

    if (!selectedOption) {
      setStatus("No low-stock products are linked to active suppliers");
      return;
    }

    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + selectedOption.supplier.leadTimeDays);

    setPurchaseOrderDraft({
      branchId,
      supplierId: selectedOption.supplier.id,
      expectedAt: expectedDate.toISOString(),
      note: `Reorder ${selectedOption.products.length} low-stock items`,
      lines: selectedOption.products.map((product) => ({
        productId: product.id,
        quantity: recommendedReorderQuantity(product),
        unitCost: product.cost
      }))
    });
    setPurchaseOrderModalOpen(true);
    setStatus(`Reorder draft ready for ${selectedOption.supplier.name}`);
  }

  function openSupplierInvoiceModal() {
    setSupplierInvoiceDraft(defaultSupplierInvoice(branchId));
    setSupplierInvoiceModalOpen(true);
  }

  function openPaymentModal(invoice: SupplierInvoice) {
    setInvoicePaymentTarget(invoice);
    setSupplierPaymentDraft(defaultSupplierPayment(invoice.balanceDue));
  }

  function openSupplierReturnModal() {
    setSupplierReturnDraft(defaultSupplierReturn(branchId));
    setSupplierReturnModalOpen(true);
  }

  function openTransferModal() {
    setTransferDraft(defaultTransfer(branchId));
    setDestinationProducts([]);
    setTransferModalOpen(true);
  }

  function changeBranch(nextBranchId: string) {
    if (!nextBranchId) return;

    setBranchId(nextBranchId);
    setAdjustment(defaultAdjustment(nextBranchId));
    setPurchase(defaultPurchase(nextBranchId));
    setSupplierDraft(defaultSupplier(nextBranchId));
    setPurchaseOrderDraft(defaultPurchaseOrder(nextBranchId));
    setSupplierInvoiceDraft(defaultSupplierInvoice(nextBranchId));
    setSupplierReturnDraft(defaultSupplierReturn(nextBranchId));
    setTransferDraft(defaultTransfer(nextBranchId));
    setDestinationProducts([]);
    setAdjustmentApprovalId("");
    setCountApprovalId("");
    void loadInventory(nextBranchId);
  }

  async function selectDestinationBranch(destinationBranchId: string) {
    setTransferDraft((current) => ({ ...current, destinationBranchId, destinationProductId: "" }));
    setDestinationProducts([]);

    if (!destinationBranchId) return;

    try {
      const response = await fetchInventoryStock(destinationBranchId, activeUserId);
      const destinationStockProducts = response.products.filter((product) => !isServiceCategory(product.category));
      setDestinationProducts(destinationStockProducts);
      setStatus(`Loaded ${destinationStockProducts.length} destination stock records`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load destination stock");
    }
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

      const product = stockTrackedProducts.find((item) => item.sku.toLowerCase() === firstCell.toLowerCase() || item.id === firstCell);
      const quantity = Number(secondCell);
      if (product && Number.isFinite(quantity) && quantity >= 0) {
        importedCounts[product.id] = Math.round(quantity);
      }
    });

    if (Object.keys(importedCounts).length === 0) {
      setStatus("CSV import found no matching SKU or product ID rows");
      return;
    }

    setCountValues((current) => ({ ...Object.fromEntries(stockTrackedProducts.map((product) => [product.id, product.stock])), ...current, ...importedCounts }));
    setCountReference(`IMPORT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
    setCountReason(`CSV import: ${file.name}`);
    setCountApprovalId("");
    setCountModalOpen(true);
    setStatus(`Imported ${Object.keys(importedCounts).length} stock rows`);
  }

  function exportStockCsv() {
    const rows = [
      ["sku", "name", "category", "stock", "reorderPoint", "cost", "value"],
      ...filteredStockProducts.map((product) => [
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
      if (response.purchaseOrder) {
        setPurchaseOrders((current) => current.map((order) => (order.id === response.purchaseOrder?.id ? response.purchaseOrder : order)));
      }
      setPurchase((current) => ({
        ...current,
        quantity: 1,
        reference: "",
        purchaseOrderId: response.purchaseOrder?.status === "received" ? "" : current.purchaseOrderId,
        note: `Supplier delivery from ${response.supplier.name}`
      }));
      setStatus(`Received ${response.movement.quantityDelta} ${response.product.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to receive purchase");
    }
  }

  async function submitPurchaseOrder(event: FormEvent) {
    event.preventDefault();
    const validLines = purchaseOrderDraft.lines.filter((line) => line.productId && line.quantity > 0);

    if (!purchaseOrderDraft.supplierId) {
      setStatus("Select a supplier for the purchase order");
      return;
    }

    if (validLines.length === 0) {
      setStatus("Add at least one purchase order line");
      return;
    }

    setStatus("Creating purchase order...");

    try {
      const response = await createPurchaseOrder({ ...purchaseOrderDraft, lines: validLines }, activeUserId);
      setPurchaseOrders((current) => [response.purchaseOrder, ...current]);
      setPurchaseOrderModalOpen(false);
      setStatus(`Purchase order created: ${response.purchaseOrder.orderNumber}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create purchase order");
    }
  }

  async function changePurchaseOrderStatus(order: PurchaseOrder, status: Extract<PurchaseOrderStatus, "pending_approval" | "approved" | "cancelled">) {
    setStatus(`Updating ${order.orderNumber}...`);

    try {
      const response = await updatePurchaseOrderStatus(order.id, status, "", order.branchId, activeUserId);
      setPurchaseOrders((current) => current.map((item) => (item.id === order.id ? response.purchaseOrder : item)));
      setStatus(`${response.purchaseOrder.orderNumber} is ${response.purchaseOrder.status.replaceAll("_", " ")}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update purchase order");
    }
  }

  async function submitSupplierInvoice(event: FormEvent) {
    event.preventDefault();

    if (!supplierInvoiceDraft.supplierId) {
      setStatus("Select a supplier for the invoice");
      return;
    }

    if (supplierInvoiceDraft.amount <= 0) {
      setStatus("Supplier invoice amount must be above zero");
      return;
    }

    setStatus("Creating supplier invoice...");

    try {
      const response = await createSupplierInvoice(supplierInvoiceDraft, activeUserId);
      setSupplierInvoices((current) => [response.supplierInvoice, ...current]);
      setSupplierInvoiceModalOpen(false);
      setStatus(`Supplier invoice added: ${response.supplierInvoice.invoiceNumber}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create supplier invoice");
    }
  }

  async function submitSupplierPayment(event: FormEvent) {
    event.preventDefault();

    if (!invoicePaymentTarget) return;
    if (!supplierPaymentDraft.paymentMethod) {
      setStatus("Select a supplier payment method");
      return;
    }

    setStatus("Recording supplier payment...");

    try {
      const response = await recordSupplierInvoicePayment(invoicePaymentTarget.id, supplierPaymentDraft, invoicePaymentTarget.branchId, activeUserId);
      setSupplierInvoices((current) => current.map((invoice) => (invoice.id === response.supplierInvoice.id ? response.supplierInvoice : invoice)));
      setInvoicePaymentTarget(null);
      setStatus(`Payment recorded for ${response.supplierInvoice.invoiceNumber}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to record supplier payment");
    }
  }

  async function submitSupplierReturn(event: FormEvent) {
    event.preventDefault();

    if (!selectedReturnSupplier || !selectedReturnProduct) {
      setStatus("Select a supplier and product for return");
      return;
    }

    setStatus("Recording supplier return...");

    try {
      const response = await createSupplierReturn(supplierReturnDraft, activeUserId);
      setSupplierReturns((current) => [response.supplierReturn, ...current]);
      setProducts((current) => current.map((product) => (product.id === response.product.id ? response.product : product)));
      setMovements((current) => [response.movement, ...current].slice(0, 20));
      if (response.supplierInvoice) {
        setSupplierInvoices((current) => current.map((invoice) => (invoice.id === response.supplierInvoice?.id ? response.supplierInvoice : invoice)));
      }
      setSupplierReturnModalOpen(false);
      setStatus(`Supplier return recorded: ${response.supplierReturn.reference}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to record supplier return");
    }
  }

  async function submitTransfer(event: FormEvent) {
    event.preventDefault();
    const sourceProduct = stockTrackedProducts.find((product) => product.id === transferDraft.sourceProductId);
    const destinationProduct = destinationProducts.find((product) => product.id === transferDraft.destinationProductId);

    if (!sourceProduct) {
      setStatus("Select the source product to transfer");
      return;
    }

    if (!transferDraft.destinationBranchId) {
      setStatus("Select the destination branch");
      return;
    }

    if (!destinationProduct) {
      setStatus("Select the destination product stock record");
      return;
    }

    setStatus("Creating inventory transfer...");

    try {
      const response = await createInventoryTransfer(transferDraft, activeUserId);
      setProducts((current) => current.map((product) => (product.id === response.sourceProduct.id ? response.sourceProduct : product)));
      if (response.destinationProduct.branchId === branchId) {
        setProducts((current) => current.map((product) => (product.id === response.destinationProduct.id ? response.destinationProduct : product)));
      }
      setDestinationProducts((current) => current.map((product) => (product.id === response.destinationProduct.id ? response.destinationProduct : product)));
      setMovements((current) => {
        const nextMovements = [response.sourceMovement];
        if (response.destinationMovement.branchId === branchId) nextMovements.push(response.destinationMovement);
        return [...nextMovements, ...current].slice(0, 20);
      });
      setTransfers((current) => [response.transfer, ...current]);
      setTransferModalOpen(false);
      setStatus(`Transfer posted: ${response.transfer.reference}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create transfer");
    }
  }

  function branchLabel(nextBranchId: string) {
    const branch = branches.find((item) => item.id === nextBranchId);
    return branch ? `${branch.name} - ${branch.city}` : nextBranchId;
  }

  function clearStockFilters() {
    setStockQuery("");
    setStockCategoryFilter("");
    setStockStatusFilter("");
  }

  async function openSupplierStatement(supplier: Supplier) {
    setStatus(`Loading ${supplier.name} statement...`);

    try {
      const response = await fetchSupplierStatement(branchId, supplier.id, activeUserId);
      setSupplierStatement(response.statement);
      setStatus(`Statement loaded for ${supplier.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load supplier statement");
    }
  }

  function selectReceiptOrder(orderId: string) {
    const order = receivableOrders.find((item) => item.id === orderId);
    if (!order) {
      setPurchase((current) => ({ ...current, purchaseOrderId: "", supplierId: "", productId: "", reference: "" }));
      return;
    }

    const openLine = order.lines.find((line) => line.receivedQuantity < line.quantity);
    setPurchase((current) => ({
      ...current,
      purchaseOrderId: order.id,
      supplierId: order.supplierId,
      productId: openLine?.productId ?? "",
      quantity: openLine ? Math.max(1, openLine.quantity - openLine.receivedQuantity) : 1,
      reference: order.orderNumber,
      note: `Supplier delivery against ${order.orderNumber}`
    }));
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
      counts: stockTrackedProducts.map((product) => ({
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
            {branchLocked ? (
              <span className="locked-select-value locked-select-value-compact">
                <strong>{selectedBranch?.name ?? branchId}</strong>
                <small>{selectedBranch?.city ?? "assigned"}</small>
              </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                <option value="">Branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
                ))}
              </select>
            )}
          </label>
          <button className="secondary-button" onClick={() => importInputRef.current?.click()}><Upload size={18} /> Import CSV</button>
          <button className="secondary-button" onClick={() => void loadInventory()}><RefreshCcw size={18} /> Sync</button>
          <button className="secondary-button" onClick={openCountModal}><ClipboardCheck size={18} /> Count stock</button>
          <button className="secondary-button" onClick={openPurchaseOrderModal}><FileText size={18} /> Purchase order</button>
          <button className="secondary-button" onClick={() => openReorderPurchaseOrder()} disabled={supplierReorderOptions.length === 0}><FileText size={18} /> Reorder low stock</button>
          <button className="secondary-button" onClick={openSupplierInvoiceModal}><FileText size={18} /> Supplier invoice</button>
          <button className="secondary-button" onClick={openSupplierReturnModal}><ArrowDownUp size={18} /> Supplier return</button>
          <button className="secondary-button" onClick={openSupplierModal}><Plus size={18} /> Supplier</button>
          <button className="primary-button" onClick={openTransferModal}><ArrowDownUp size={18} /> Transfer stock</button>
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
        <article className="stat-card">
          <div className="stat-card-top"><span>Supplier balance</span></div>
          <strong>{displayMoney(supplierOpenBalance)}</strong>
          <small>{supplierInvoices.filter((invoice) => invoice.balanceDue > 0).length} open invoices</small>
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
                <option value="">Product</option>
                {stockTrackedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label>
              Type
              <select value={adjustment.type} onChange={(event) => updateAdjustment("type", event.target.value as StockMovement["type"])}>
                <option value="">Type</option>
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
            <label className="wide-field">
              Purchase order
              <select value={purchase.purchaseOrderId ?? ""} onChange={(event) => selectReceiptOrder(event.target.value)}>
                <option value="">Purchase order</option>
                {receivableOrders.map((order) => (
                  <option key={order.id} value={order.id}>{order.orderNumber} - {order.supplierName}</option>
                ))}
              </select>
            </label>
            <label>
              Supplier
              <select value={purchase.supplierId} onChange={(event) => updatePurchase("supplierId", event.target.value)} disabled={Boolean(selectedReceiptOrder)}>
                <option value="">Supplier</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
            <label>
              Product
              <select value={purchase.productId} onChange={(event) => updatePurchase("productId", event.target.value)}>
                <option value="">Product</option>
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
            <h2>Branch transfers</h2>
            <span>{transfers.length} records</span>
          </div>
          <div className="stack">
            {transfers.length === 0 ? (
              <div className="empty-state">No branch transfers posted.</div>
            ) : transfers.slice(0, 6).map((transfer) => (
              <div className="list-row" key={transfer.id}>
                <div>
                  <strong>{transfer.reference}</strong>
                  <span>{transfer.productName} - {branchLabel(transfer.sourceBranchId)} to {branchLabel(transfer.destinationBranchId)}</span>
                </div>
                <b>{transfer.quantity}</b>
              </div>
            ))}
          </div>
          <div className="panel-header register-history-header">
            <h2>Purchase orders</h2>
            <span>{purchaseOrders.length} orders</span>
          </div>
          <div className="stack">
            {purchaseOrders.length === 0 ? (
              <div className="empty-state">No purchase orders created.</div>
            ) : purchaseOrders.slice(0, 6).map((order) => {
              const orderedQuantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
              const receivedQuantity = order.lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
              return (
                <div className="list-row" key={order.id}>
                  <div>
                    <strong>{order.orderNumber}</strong>
                    <span>{order.supplierName} - {receivedQuantity}/{orderedQuantity} received - {displayMoney(order.subtotal)}</span>
                  </div>
                  <div className="button-group">
                    <StatusBadge label={order.status.replaceAll("_", " ")} tone={order.status === "approved" || order.status === "received" ? "success" : order.status === "cancelled" ? "danger" : "warning"} />
                    {order.status === "draft" ? <button className="ghost-button" onClick={() => void changePurchaseOrderStatus(order, "pending_approval")}>Submit</button> : null}
                    {order.status === "pending_approval" ? <button className="ghost-button" onClick={() => void changePurchaseOrderStatus(order, "approved")}>Approve</button> : null}
                    {["draft", "pending_approval", "approved"].includes(order.status) ? <button className="ghost-button danger-text" onClick={() => void changePurchaseOrderStatus(order, "cancelled")}>Cancel</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="panel-header register-history-header">
            <h2>Supplier invoices</h2>
            <span>{supplierInvoices.length} invoices</span>
          </div>
          <div className="stack">
            {supplierInvoices.length === 0 ? (
              <div className="empty-state">No supplier invoices captured.</div>
            ) : supplierInvoices.slice(0, 6).map((invoice) => (
              <div className="list-row" key={invoice.id}>
                <div>
                  <strong>{invoice.invoiceNumber}</strong>
                  <span>{invoice.supplierName} - paid {displayMoney(invoice.amountPaid)} - credits {displayMoney(invoice.creditTotal)}</span>
                </div>
                <div className="button-group">
                  <StatusBadge label={invoice.status.replaceAll("_", " ")} tone={invoice.status === "paid" ? "success" : invoice.status === "voided" ? "danger" : "warning"} />
                  {invoice.balanceDue > 0 && invoice.status !== "voided" ? <button className="ghost-button" onClick={() => openPaymentModal(invoice)}>Pay</button> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="panel-header register-history-header">
            <h2>Supplier returns</h2>
            <span>{supplierReturns.length} returns</span>
          </div>
          <div className="stack">
            {supplierReturns.length === 0 ? (
              <div className="empty-state">No supplier returns recorded.</div>
            ) : supplierReturns.slice(0, 5).map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.reference}</strong>
                  <span>{item.supplierName} - {item.quantity} {item.productName} - {displayMoney(item.creditAmount)}</span>
                </div>
                <StatusBadge label="credited" tone="warning" />
              </div>
            ))}
          </div>
          <div className="panel-header register-history-header">
            <h2>Suppliers</h2>
            <span>{suppliers.length} active</span>
          </div>
          <div className="supplier-grid">
            {suppliers.length === 0 ? (
              <div className="empty-state">No suppliers configured.</div>
            ) : suppliers.map((supplier) => {
              const reorderCount = lowStockProducts.filter((product) => supplier.productIds.includes(product.id)).length;
              return (
                <article className="supplier-card" key={supplier.id}>
                  <div>
                    <strong>{supplier.name}</strong>
                    <span>{supplier.contactPerson} - {supplier.phone}</span>
                  </div>
                  <small>{supplier.productIds.length} products - {supplier.leadTimeDays} day lead - {reorderCount} low stock</small>
                  <div className="button-group">
                    <button className="ghost-button" onClick={() => void openSupplierStatement(supplier)}>Statement</button>
                    <button className="ghost-button" onClick={() => openReorderPurchaseOrder(supplier.id)} disabled={reorderCount === 0}>Reorder</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Branch stock ledger</h2>
          <div className="button-group">
            <span>{filteredStockProducts.length} of {products.length} records</span>
            <button className="ghost-button" onClick={exportStockCsv}><Download size={16} /> Export</button>
          </div>
        </div>
        <div className="table-toolbar inventory-stock-toolbar">
          <div className="search-box compact-search">
            <Search size={16} />
            <input value={stockQuery} onChange={(event) => setStockQuery(event.target.value)} placeholder="Search product, SKU, barcode or stock" />
            {stockQuery ? (
              <button type="button" onClick={() => setStockQuery("")} aria-label="Clear stock search"><X size={14} /></button>
            ) : null}
          </div>
          <select value={stockCategoryFilter} onChange={(event) => setStockCategoryFilter(event.target.value)}>
            <option value="">Category</option>
            {productCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={stockStatusFilter} onChange={(event) => setStockStatusFilter(event.target.value)}>
            <option value="">Stock status</option>
            <option value="tracked">Stock-tracked</option>
            <option value="service">Non-stock services</option>
            <option value="low">Low stock</option>
            <option value="healthy">Healthy</option>
          </select>
          {(stockQuery || stockCategoryFilter || stockStatusFilter) ? (
            <button className="secondary-button" type="button" onClick={clearStockFilters}>Clear filters</button>
          ) : null}
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
                      label={isServiceCategory(product.category) ? "Non-stock service" : product.stock <= product.reorderPoint ? "Low stock" : "Healthy"}
                      tone={isServiceCategory(product.category) ? "info" : product.stock <= product.reorderPoint ? "warning" : "success"}
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
      {transferModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTransferModalOpen(false)}>
          <section className="modal-panel supplier-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Inventory control</p>
                <h2 id="transfer-modal-title">Transfer branch stock</h2>
              </div>
              <button className="icon-button" onClick={() => setTransferModalOpen(false)} aria-label="Close transfer modal"><X size={18} /></button>
            </div>
            <form className="supplier-form" onSubmit={submitTransfer}>
              <label>
                Source product
                <select value={transferDraft.sourceProductId} onChange={(event) => updateTransferDraft("sourceProductId", event.target.value)}>
                  <option value="">Source product</option>
                  {stockTrackedProducts.map((product) => <option key={product.id} value={product.id}>{product.name} - {product.stock} available</option>)}
                </select>
              </label>
              <label>
                Destination branch
                <select value={transferDraft.destinationBranchId} onChange={(event) => void selectDestinationBranch(event.target.value)}>
                  <option value="">Destination branch</option>
                  {branches.filter((branch) => branch.id !== branchId).map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
                  ))}
                </select>
              </label>
              <label>
                Destination product
                <select value={transferDraft.destinationProductId} onChange={(event) => updateTransferDraft("destinationProductId", event.target.value)} disabled={!transferDraft.destinationBranchId}>
                  <option value="">Destination product</option>
                  {destinationProducts.map((product) => <option key={product.id} value={product.id}>{product.name} - {product.stock} on hand</option>)}
                </select>
              </label>
              <label>
                Quantity
                <input
                  min={1}
                  max={stockTrackedProducts.find((product) => product.id === transferDraft.sourceProductId)?.stock ?? undefined}
                  type="number"
                  value={transferDraft.quantity}
                  onChange={(event) => updateTransferDraft("quantity", Number(event.target.value))}
                  required
                />
              </label>
              <label>
                Reference
                <input value={transferDraft.reference} onChange={(event) => updateTransferDraft("reference", event.target.value)} placeholder="TRF-20260726" required />
              </label>
              <label className="wide-field">
                Note
                <input value={transferDraft.note} onChange={(event) => updateTransferDraft("note", event.target.value)} required />
              </label>
              <div className="discount-preview wide-field">
                <span>{branchLabel(branchId)} to {transferDraft.destinationBranchId ? branchLabel(transferDraft.destinationBranchId) : "Destination branch"}</span>
                <strong>{transferDraft.quantity} units</strong>
                <small>{stockTrackedProducts.find((product) => product.id === transferDraft.sourceProductId)?.name ?? "Source product"} stock movement</small>
              </div>
              <div className="form-summary">
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Post transfer</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
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
                {stockTrackedProducts.map((product) => {
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
                <span>{stockTrackedProducts.length} counted items</span>
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
                  <option value="">Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <div className="supplier-product-picker wide-field">
                {stockTrackedProducts.map((product) => (
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
      {purchaseOrderModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPurchaseOrderModalOpen(false)}>
          <section className="modal-panel supplier-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-order-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supplier purchasing</p>
                <h2 id="purchase-order-modal-title">Create purchase order</h2>
              </div>
              <button className="icon-button" onClick={() => setPurchaseOrderModalOpen(false)} aria-label="Close purchase order modal"><X size={18} /></button>
            </div>
            <form className="supplier-form" onSubmit={submitPurchaseOrder}>
              <label>
                Supplier
                <select value={purchaseOrderDraft.supplierId} onChange={(event) => updatePurchaseOrderDraft("supplierId", event.target.value)}>
                  <option value="">Supplier</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label>
                Expected date
                <input type="date" value={purchaseOrderDraft.expectedAt?.slice(0, 10) ?? ""} onChange={(event) => updatePurchaseOrderDraft("expectedAt", event.target.value ? new Date(`${event.target.value}T09:00:00.000Z`).toISOString() : "")} />
              </label>
              <label className="wide-field">
                Note
                <input value={purchaseOrderDraft.note ?? ""} onChange={(event) => updatePurchaseOrderDraft("note", event.target.value)} placeholder="Restock low inventory items" />
              </label>
              <div className="stock-count-list wide-field">
                {purchaseOrderDraft.lines.map((line, index) => {
                  const selectedLineProduct = products.find((product) => product.id === line.productId);
                  return (
                    <div className="stock-count-row" key={`${line.productId || "line"}-${index}`}>
                      <select value={line.productId} onChange={(event) => {
                        const product = products.find((item) => item.id === event.target.value);
                        updatePurchaseOrderLine(index, { productId: event.target.value, unitCost: product?.cost });
                      }}>
                        <option value="">Product</option>
                        {orderProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                      <input min={1} type="number" value={line.quantity} onChange={(event) => updatePurchaseOrderLine(index, { quantity: Number(event.target.value) })} aria-label="Purchase order quantity" />
                      <input min={0} type="number" value={line.unitCost ?? selectedLineProduct?.cost ?? 0} onChange={(event) => updatePurchaseOrderLine(index, { unitCost: Number(event.target.value) })} aria-label="Purchase order unit cost" />
                      <button className="icon-button" type="button" onClick={() => removePurchaseOrderLine(index)} aria-label="Remove purchase order line" disabled={purchaseOrderDraft.lines.length === 1}><Trash2 size={16} /></button>
                    </div>
                  );
                })}
              </div>
              {purchaseOrderDraft.lines.some((line) => {
                const product = products.find((item) => item.id === line.productId);
                return product ? product.stock <= product.reorderPoint : false;
              }) ? (
                <div className="discount-preview wide-field">
                  <span>Low-stock reorder draft</span>
                  <strong>{purchaseOrderDraft.lines.length} lines</strong>
                  <small>Quantities target about twice each product reorder point.</small>
                </div>
              ) : null}
              <div className="form-summary">
                <span>{purchaseOrderDraft.lines.length} lines - {displayMoney(purchaseOrderSubtotal)}</span>
                <button className="secondary-button" type="button" onClick={addPurchaseOrderLine}><Plus size={18} /> Add line</button>
                <button className="primary-button" type="submit"><Check size={18} /> Save order</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {supplierInvoiceModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSupplierInvoiceModalOpen(false)}>
          <section className="modal-panel supplier-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-invoice-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supplier accounts</p>
                <h2 id="supplier-invoice-modal-title">Add supplier invoice</h2>
              </div>
              <button className="icon-button" onClick={() => setSupplierInvoiceModalOpen(false)} aria-label="Close supplier invoice modal"><X size={18} /></button>
            </div>
            <form className="supplier-form" onSubmit={submitSupplierInvoice}>
              <label>
                Supplier
                <select value={supplierInvoiceDraft.supplierId} onChange={(event) => updateSupplierInvoiceDraft("supplierId", event.target.value)}>
                  <option value="">Supplier</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label>
                Purchase order
                <select
                  value={supplierInvoiceDraft.purchaseOrderId ?? ""}
                  onChange={(event) => {
                    const order = purchaseOrders.find((item) => item.id === event.target.value);
                    setSupplierInvoiceDraft((current) => ({
                      ...current,
                      purchaseOrderId: event.target.value,
                      supplierId: order?.supplierId ?? current.supplierId,
                      amount: order?.subtotal ?? current.amount
                    }));
                  }}
                >
                  <option value="">Purchase order</option>
                  {purchaseOrders.filter((order) => order.status === "received" || order.status === "partially_received" || order.status === "approved").map((order) => (
                    <option key={order.id} value={order.id}>{order.orderNumber} - {order.supplierName}</option>
                  ))}
                </select>
              </label>
              <label>
                Invoice number
                <input value={supplierInvoiceDraft.invoiceNumber} onChange={(event) => updateSupplierInvoiceDraft("invoiceNumber", event.target.value)} placeholder="SUP-INV-1001" required />
              </label>
              <label>
                Amount
                <input type="number" min={1} value={supplierInvoiceDraft.amount} onChange={(event) => updateSupplierInvoiceDraft("amount", Number(event.target.value))} required />
              </label>
              <label>
                Invoice date
                <input type="date" value={supplierInvoiceDraft.invoiceDate.slice(0, 10)} onChange={(event) => updateSupplierInvoiceDraft("invoiceDate", new Date(`${event.target.value}T09:00:00.000Z`).toISOString())} required />
              </label>
              <label>
                Due date
                <input type="date" value={supplierInvoiceDraft.dueDate?.slice(0, 10) ?? ""} onChange={(event) => updateSupplierInvoiceDraft("dueDate", event.target.value ? new Date(`${event.target.value}T09:00:00.000Z`).toISOString() : "")} />
              </label>
              <label className="wide-field">
                Note
                <input value={supplierInvoiceDraft.note ?? ""} onChange={(event) => updateSupplierInvoiceDraft("note", event.target.value)} placeholder="Supplier invoice received" />
              </label>
              <div className="form-summary">
                <span>{displayMoney(supplierInvoiceDraft.amount)} invoice value</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save invoice</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {invoicePaymentTarget ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setInvoicePaymentTarget(null)}>
          <section className="modal-panel supplier-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-payment-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supplier accounts</p>
                <h2 id="supplier-payment-modal-title">Record supplier payment</h2>
              </div>
              <button className="icon-button" onClick={() => setInvoicePaymentTarget(null)} aria-label="Close supplier payment modal"><X size={18} /></button>
            </div>
            <form className="supplier-form" onSubmit={submitSupplierPayment}>
              <div className="discount-preview wide-field">
                <span>{invoicePaymentTarget.invoiceNumber} - {invoicePaymentTarget.supplierName}</span>
                <strong>{displayMoney(invoicePaymentTarget.balanceDue)}</strong>
                <small>Outstanding balance</small>
              </div>
              <label>
                Amount
                <input type="number" min={1} max={invoicePaymentTarget.balanceDue} value={supplierPaymentDraft.amount} onChange={(event) => updateSupplierPaymentDraft("amount", Number(event.target.value))} required />
              </label>
              <label>
                Method
                <select value={supplierPaymentDraft.paymentMethod} onChange={(event) => updateSupplierPaymentDraft("paymentMethod", event.target.value as PaymentMethodCode)}>
                  <option value="">Payment method</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
              </label>
              <label>
                Reference
                <input value={supplierPaymentDraft.reference} onChange={(event) => updateSupplierPaymentDraft("reference", event.target.value)} placeholder="TRF-9982" required />
              </label>
              <label>
                Paid date
                <input type="date" value={supplierPaymentDraft.paidAt.slice(0, 10)} onChange={(event) => updateSupplierPaymentDraft("paidAt", new Date(`${event.target.value}T09:00:00.000Z`).toISOString())} required />
              </label>
              <label className="wide-field">
                Note
                <input value={supplierPaymentDraft.note ?? ""} onChange={(event) => updateSupplierPaymentDraft("note", event.target.value)} placeholder="Supplier payment note" />
              </label>
              <div className="form-summary">
                <span>Balance after payment: {displayMoney(Math.max(0, invoicePaymentTarget.balanceDue - supplierPaymentDraft.amount))}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Record payment</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {supplierStatement ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSupplierStatement(null)}>
          <section className="modal-panel stock-count-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-statement-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supplier accounts</p>
                <h2 id="supplier-statement-modal-title">{supplierStatement.supplier.name} statement</h2>
              </div>
              <button className="icon-button" onClick={() => setSupplierStatement(null)} aria-label="Close supplier statement modal"><X size={18} /></button>
            </div>
            <section className="stats-grid">
              <article className="stat-card">
                <div className="stat-card-top"><span>Invoiced</span></div>
                <strong>{displayMoney(supplierStatement.totals.invoiced)}</strong>
              </article>
              <article className="stat-card">
                <div className="stat-card-top"><span>Paid</span></div>
                <strong>{displayMoney(supplierStatement.totals.paid)}</strong>
              </article>
              <article className="stat-card">
                <div className="stat-card-top"><span>Credits</span></div>
                <strong>{displayMoney(supplierStatement.totals.credited)}</strong>
              </article>
              <article className="stat-card">
                <div className="stat-card-top"><span>Balance</span></div>
                <strong>{displayMoney(supplierStatement.totals.balanceDue)}</strong>
              </article>
            </section>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierStatement.entries.length === 0 ? (
                    <tr><td colSpan={8}>No supplier ledger entries found.</td></tr>
                  ) : supplierStatement.entries.map((entry, index) => (
                    <tr key={entry.id}>
                      <td className="number-cell">{index + 1}</td>
                      <td>{new Date(entry.date).toLocaleDateString()}</td>
                      <td>{entry.type}</td>
                      <td>{entry.reference}</td>
                      <td>{entry.description}</td>
                      <td>{entry.debit ? displayMoney(entry.debit) : "-"}</td>
                      <td>{entry.credit ? displayMoney(entry.credit) : "-"}</td>
                      <td>{displayMoney(entry.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
      {supplierReturnModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSupplierReturnModalOpen(false)}>
          <section className="modal-panel supplier-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-return-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Supplier purchasing</p>
                <h2 id="supplier-return-modal-title">Record supplier return</h2>
              </div>
              <button className="icon-button" onClick={() => setSupplierReturnModalOpen(false)} aria-label="Close supplier return modal"><X size={18} /></button>
            </div>
            <form className="supplier-form" onSubmit={submitSupplierReturn}>
              <label>
                Supplier
                <select value={supplierReturnDraft.supplierId} onChange={(event) => setSupplierReturnDraft((current) => ({ ...current, supplierId: event.target.value, productId: "", supplierInvoiceId: "" }))}>
                  <option value="">Supplier</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label>
                Product
                <select value={supplierReturnDraft.productId} onChange={(event) => {
                  const product = products.find((item) => item.id === event.target.value);
                  setSupplierReturnDraft((current) => ({ ...current, productId: event.target.value, unitCost: product?.cost }));
                }}>
                  <option value="">Product</option>
                  {returnProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </label>
              <label>
                Supplier invoice
                <select value={supplierReturnDraft.supplierInvoiceId ?? ""} onChange={(event) => updateSupplierReturnDraft("supplierInvoiceId", event.target.value)}>
                  <option value="">Supplier invoice</option>
                  {supplierInvoices.filter((invoice) => invoice.supplierId === supplierReturnDraft.supplierId && invoice.balanceDue > 0).map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} - {displayMoney(invoice.balanceDue)}</option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input type="number" min={1} max={selectedReturnProduct?.stock ?? undefined} value={supplierReturnDraft.quantity} onChange={(event) => updateSupplierReturnDraft("quantity", Number(event.target.value))} required />
              </label>
              <label>
                Unit cost
                <input type="number" min={0} value={supplierReturnDraft.unitCost ?? selectedReturnProduct?.cost ?? 0} onChange={(event) => updateSupplierReturnDraft("unitCost", Number(event.target.value))} required />
              </label>
              <label>
                Reference
                <input value={supplierReturnDraft.reference} onChange={(event) => updateSupplierReturnDraft("reference", event.target.value)} placeholder="SRET-1001" required />
              </label>
              <label>
                Return date
                <input type="date" value={supplierReturnDraft.returnedAt.slice(0, 10)} onChange={(event) => updateSupplierReturnDraft("returnedAt", new Date(`${event.target.value}T09:00:00.000Z`).toISOString())} required />
              </label>
              <label className="wide-field">
                Reason
                <input value={supplierReturnDraft.reason} onChange={(event) => updateSupplierReturnDraft("reason", event.target.value)} required />
              </label>
              <div className="form-summary">
                <span>Credit value: {displayMoney((supplierReturnDraft.unitCost ?? selectedReturnProduct?.cost ?? 0) * supplierReturnDraft.quantity)}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save return</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
