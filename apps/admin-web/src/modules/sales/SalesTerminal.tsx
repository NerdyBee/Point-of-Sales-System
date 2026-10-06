import { BadgePercent, Banknote, Ban, Check, CreditCard, MessageCircle, Minus, Pause, Play, Plus, Printer, ScanBarcode, Search, Smartphone, Split, Trash2, UserRound, Wifi, WifiOff, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { applyApproval, createApproval, createSale, fetchBranchOptions, fetchCatalogProducts, fetchCurrentRegister, fetchCustomers, queueReceiptDelivery, readStoredAuth, resolveMediaUrl } from "../../shared/api/client";
import type { ApprovalRequest, BranchOption, Customer, PaymentMethodCode, RegisterShift, TenantSettings, TerminalOption } from "../../shared/api/client";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import type { Product, ProductCategory } from "../catalog/types";
import { applyManagerApproval, calculateSale } from "./pricing";
import { printReceipt, type PrintableReceipt } from "./receiptPrint";
import type { CartItem, SaleSyncState } from "./types";

const defaultBranchId = "";
const defaultTerminalId = "";
const fallbackBranches: BranchOption[] = [];

function isServiceCategory(category: string) {
  return category.trim().toLowerCase() === "services";
}
const defaultPaymentSettings: TenantSettings["paymentMethods"] = { cash: true, card: true, bankTransfer: true, mobileMoney: false };
const paymentSettingKey: Partial<Record<PaymentMethodCode, keyof TenantSettings["paymentMethods"]>> = {
  cash: "cash",
  card: "card",
  bank_transfer: "bankTransfer",
  mobile_money: "mobileMoney"
};
const allPaymentMethods: Array<{ method: PaymentMethodCode; label: string; icon: typeof Banknote }> = [
  { method: "cash", label: "Cash", icon: Banknote },
  { method: "card", label: "Card", icon: CreditCard },
  { method: "bank_transfer", label: "Transfer", icon: Smartphone },
  { method: "mobile_money", label: "Mobile", icon: Smartphone },
  { method: "customer_credit", label: "Credit", icon: UserRound }
];
const referenceRequiredMethods = new Set<PaymentMethodCode>(["card", "bank_transfer", "mobile_money"]);

interface HeldOrder {
  id: string;
  label: string;
  items: CartItem[];
  total: number;
  discountApprovalId?: string;
  createdAt: string;
}

type LastSaleReceipt = PrintableReceipt;

interface TenderPayment {
  id: string;
  method: PaymentMethodCode;
  amount: number;
  reference?: string;
}

export interface TerminalTableContext {
  tableId: string;
  tableLabel: string;
  tableOrderId?: string;
  guests?: number;
  waiterId?: string;
  customerName?: string;
  items?: CartItem[];
}

export interface SettledTableReceipt {
  saleId: string;
  tableId?: string;
  tableLabel?: string;
  tableOrderId?: string;
  total: number;
  settledAt: string;
}

interface SalesTerminalProps {
  tableContext?: TerminalTableContext | null;
  onClearTableContext?: () => void;
  onTableSettled?: (receipt: SettledTableReceipt) => void;
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function SalesTerminal({ tableContext, onClearTableContext, onTableSettled, approvalHandoff, onApprovalHandoffConsumed }: SalesTerminalProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const cashierId = storedAuth?.staff.id ?? "";
  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branchId, setBranchId] = useState(storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? defaultBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [terminalId, setTerminalId] = useState(storedAuth?.session.terminalId ?? defaultTerminalId);
  const [paymentSettings, setPaymentSettings] = useState<TenantSettings["paymentMethods"]>(defaultPaymentSettings);
  const { settings, currency, displayMoney } = useTenantSettings();
  const categories: Array<ProductCategory | "All"> = ["All", ...(settings?.productCategories.length ? settings.productCategories : [])];
  const [cart, setCart] = useState<CartItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncState, setSyncState] = useState<SaleSyncState>({ status: "idle" });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [tenderPayments, setTenderPayments] = useState<TenderPayment[]>([]);
  const [registerShift, setRegisterShift] = useState<RegisterShift | null>(null);
  const [registerMessage, setRegisterMessage] = useState("Checking register shift...");
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountProductId, setDiscountProductId] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [discountApprovalId, setDiscountApprovalId] = useState("");
  const [saleDiscountApprovalId, setSaleDiscountApprovalId] = useState("");
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidApprovalId, setVoidApprovalId] = useState("");
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitQuantities, setSplitQuantities] = useState<Record<string, number>>({});
  const [lastSettledReceipt, setLastSettledReceipt] = useState<SettledTableReceipt | null>(null);
  const [lastSaleReceipt, setLastSaleReceipt] = useState<LastSaleReceipt | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const handledApprovalIdRef = useRef<string | null>(null);

  async function refreshCustomers(clearOnError = true) {
    if (!online) {
      return;
    }

    try {
      const response = await fetchCustomers();
      setCustomers(response.customers);
    } catch {
      if (clearOnError) {
        setCustomers([]);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      if (!online) {
        return;
      }

      try {
        if (!branchId) {
          setProducts([]);
          setSyncState({ status: "error", message: "Select a branch before loading catalog" });
          return;
        }

        const response = await fetchCatalogProducts(branchId);

        if (!cancelled) {
          setProducts(response.products.filter((product) => product.branchId === branchId));
          setSyncState({ status: "success", message: "Catalog synced from API", saleId: "catalog" });
        }
      } catch (error) {
        if (!cancelled) {
          setProducts([]);
          setSyncState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load catalog"
          });
        }
      }
    }

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [branchId, online]);

  useEffect(() => {
    if (
      !approvalHandoff ||
      approvalHandoff.entityType !== "saleDraft" ||
      approvalHandoff.entityId !== terminalId ||
      approvalHandoff.status !== "approved" ||
      handledApprovalIdRef.current === approvalHandoff.id
    ) {
      return;
    }

    if (approvalHandoff.type === "discount") {
      const firstItem = cart[0];
      if (!firstItem) {
        setSyncState({ status: "success", message: `Approval waiting for an active cart: ${approvalHandoff.id}`, saleId: approvalHandoff.id });
        return;
      }

      handledApprovalIdRef.current = approvalHandoff.id;
      setDiscountApprovalId(approvalHandoff.id);
      setDiscountReason(approvalHandoff.reason);
      setDiscountProductId(firstItem.product.id);
      setDiscountAmount(Math.min(Math.round(approvalHandoff.amount / firstItem.quantity), firstItem.product.price));
      setDiscountModalOpen(true);
      setSyncState({ status: "success", message: `Approval ready: ${approvalHandoff.id}`, saleId: approvalHandoff.id });
      onApprovalHandoffConsumed?.();
    }

    if (approvalHandoff.type === "void") {
      if (cart.length === 0) {
        setSyncState({ status: "success", message: `Void approval waiting for an active cart: ${approvalHandoff.id}`, saleId: approvalHandoff.id });
        return;
      }

      handledApprovalIdRef.current = approvalHandoff.id;
      setVoidApprovalId(approvalHandoff.id);
      setVoidReason(approvalHandoff.reason);
      setVoidModalOpen(true);
      setSyncState({ status: "success", message: `Void approval ready: ${approvalHandoff.id}`, saleId: approvalHandoff.id });
      onApprovalHandoffConsumed?.();
    }
  }, [approvalHandoff?.id, cart]);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers() {
      if (!online) {
        return;
      }

      try {
        const response = await fetchCustomers();
        if (!cancelled) {
          setCustomers(response.customers);
        }
      } catch {
        if (!cancelled) {
          setCustomers([]);
        }
      }
    }

    void loadCustomers();

    return () => {
      cancelled = true;
    };
  }, [online]);

  useEffect(() => {
    if (tableContext?.items) {
      setCart(tableContext.items.map((item) => ({ ...item })));
      setSaleDiscountApprovalId("");
      setLastSettledReceipt(null);
    }
  }, [tableContext]);

  useEffect(() => {
    setPaymentSettings(settings?.paymentMethods ?? defaultPaymentSettings);
  }, [settings]);

  const chargeControls = useMemo(
    () => ({
      vatRate: settings?.defaultTaxRate,
      serviceChargeEnabled: settings?.serviceChargeEnabled ?? true,
      serviceChargeRate: settings?.serviceChargeRate ?? 0.05
    }),
    [settings?.defaultTaxRate, settings?.serviceChargeEnabled, settings?.serviceChargeRate]
  );

  useEffect(() => {
    if (category !== "All" && !categories.includes(category)) {
      setCategory("All");
    }
  }, [category, categories.join("|")]);

  async function loadRegister(nextTerminalId = terminalId, nextBranchId = branchId) {
    if (!online) {
      setRegisterMessage("Register will sync when back online");
      return;
    }

    if (!nextTerminalId) {
      setRegisterShift(null);
      setRegisterMessage("Select a terminal");
      return;
    }

    try {
      const response = await fetchCurrentRegister(nextBranchId, nextTerminalId);
      setRegisterShift(response.shift ?? null);
      setRegisterMessage(response.shift ? "Register shift open" : "No open register shift");
    } catch (error) {
      setRegisterShift(null);
      setRegisterMessage(error instanceof Error ? error.message : "Unable to load register");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadTerminals() {
      if (!online) {
        setRegisterMessage("Register will sync when back online");
        return;
      }

      try {
        const response = await fetchBranchOptions();
        if (cancelled) return;

        setBranches(response.branches.length > 0 ? response.branches : fallbackBranches);
        setTerminals(response.terminals);
        const effectiveBranchId = branchId || response.branches[0]?.id || "";
        if (effectiveBranchId && effectiveBranchId !== branchId) {
          setBranchId(effectiveBranchId);
        }

        const branchTerminals = response.terminals.filter((terminal) => terminal.branchId === effectiveBranchId);
        const currentTerminal = branchTerminals.find((terminal) => terminal.id === terminalId);
        const defaultTerminal = currentTerminal ?? branchTerminals.find((terminal) => terminal.status === "online");
        if (defaultTerminal) {
          setTerminalId(defaultTerminal.id);
          await loadRegister(defaultTerminal.id, effectiveBranchId);
        } else {
          setRegisterShift(null);
          setRegisterMessage("No terminal provisioned for this branch");
        }
      } catch (error) {
        if (!cancelled) {
          setRegisterShift(null);
          setRegisterMessage(error instanceof Error ? error.message : "Unable to load terminals");
        }
      }
    }

    void loadTerminals();

    return () => {
      cancelled = true;
    };
  }, [branchId, online]);

  useEffect(() => {
    void loadRegister(terminalId, branchId);
  }, [branchId, terminalId, online]);

  const filteredProducts = products.filter((product) => {
    const categoryMatch = category === "All" || product.category === category;
    const queryMatch = `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(query.toLowerCase());
    return categoryMatch && queryMatch;
  });

  const summary = useMemo(() => calculateSale(cart, chargeControls), [cart, chargeControls]);
  const hardware = settings?.hardware;
  const printerReady = Boolean(hardware?.printer.trim());
  const scannerReady = Boolean(hardware?.barcodeScanner);
  const drawerReady = Boolean(hardware?.cashDrawer);
  const branchTerminals = useMemo(() => terminals.filter((terminal) => terminal.branchId === branchId), [branchId, terminals]);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const selectedTerminal = useMemo(() => terminals.find((terminal) => terminal.id === terminalId) ?? null, [terminalId, terminals]);
  const selectedDiscountItem = useMemo(
    () => (discountProductId ? cart.find((item) => item.product.id === discountProductId) ?? null : null),
    [cart, discountProductId]
  );
  const proposedDiscountTotal = selectedDiscountItem ? discountAmount * selectedDiscountItem.quantity : 0;
  const splitItems = useMemo(
    () => cart
      .map((item) => ({ ...item, quantity: Math.min(splitQuantities[item.product.id] ?? 0, item.quantity) }))
      .filter((item) => item.quantity > 0),
    [cart, splitQuantities]
  );
  const splitSummary = useMemo(() => calculateSale(splitItems, chargeControls), [splitItems, chargeControls]);
  const orderTitle = tableContext ? tableContext.tableLabel : "Walk-in";
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const creditAvailable = selectedCustomer ? Math.max(selectedCustomer.creditLimit - selectedCustomer.outstandingBalance, 0) : 0;
  const tenderTotal = tenderPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const tenderVariance = summary.total - tenderTotal;
  const tenderBalance = Math.max(tenderVariance, 0);
  const tenderOverpay = Math.max(-tenderVariance, 0);
  const selectedTenderAmount = paymentAmount > 0 ? paymentAmount : tenderBalance;
  const tenderCreditTotal = tenderPayments
    .filter((payment) => payment.method === "customer_credit")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const paymentReferenceRequired = referenceRequiredMethods.has(paymentMethod);
  const paymentMethods = useMemo(
    () =>
      allPaymentMethods.filter((item) => {
        const key = paymentSettingKey[item.method];
        if (key) return paymentSettings[key];
        if (item.method === "customer_credit") return Boolean(selectedCustomer && creditAvailable > 0);
        return true;
      }),
    [creditAvailable, paymentSettings, selectedCustomer]
  );
  const visiblePaymentMethods = useMemo(
    () => allPaymentMethods.filter((item) => {
      const key = paymentSettingKey[item.method];
      return key ? paymentSettings[key] : true;
    }),
    [paymentSettings]
  );

  useEffect(() => {
    if (paymentMethods.length > 0 && !paymentMethods.some((item) => item.method === paymentMethod)) {
      setPaymentMethod(paymentMethods[0].method);
    }
  }, [paymentMethod, paymentMethods]);

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setTerminalId("");
    setRegisterShift(null);
    setRegisterMessage("Select a terminal");
    setCart([]);
    setPaymentReference("");
    setPaymentAmount(0);
    setTenderPayments([]);
    setSaleDiscountApprovalId("");
    setLastSaleReceipt(null);
    setLastSettledReceipt(null);
    setSyncState({ status: "success", message: "Branch changed. Select a terminal to continue.", saleId: nextBranchId });
  }

  function changeTerminal(nextTerminalId: string) {
    setTerminalId(nextTerminalId);
    setRegisterShift(null);
    setPaymentReference("");
    setPaymentAmount(0);
    setTenderPayments([]);
    setSaleDiscountApprovalId("");

    if (!nextTerminalId) {
      setRegisterMessage("Select a terminal");
      setSyncState({ status: "success", message: "Select a terminal to continue.", saleId: branchId });
      return;
    }

    setRegisterMessage("Checking register shift...");
    setSyncState({ status: "loading", message: "Checking register shift..." });
    void loadRegister(nextTerminalId, branchId);
  }

  function addProduct(product: Product) {
    if (!isServiceCategory(product.category) && product.stock <= 0) {
      setSyncState({ status: "error", message: `${product.name} is out of stock` });
      return;
    }

    setCart((items) => {
      const existing = items.find((item) => item.product.id === product.id);
      if (existing) {
        if (!isServiceCategory(product.category) && existing.quantity >= product.stock) {
          setSyncState({ status: "error", message: `${product.name} has only ${product.stock} available` });
          return items;
        }
        return items.map((item) => (item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      setSyncState({ status: "success", message: `${product.name} added`, saleId: product.id });
      return [...items, { product, quantity: 1, discount: 0 }];
    });
  }

  function addTenderPayment() {
    if (cart.length === 0) {
      setSyncState({ status: "error", message: "Add items before adding a payment" });
      return;
    }

    const amount = Math.min(Math.round(selectedTenderAmount), tenderBalance);

    if (amount <= 0) {
      setSyncState({ status: "error", message: "Enter a payment amount" });
      return;
    }

    if (paymentReferenceRequired && !paymentReference.trim()) {
      setSyncState({ status: "error", message: "Enter the payment reference before adding this payment" });
      return;
    }

    if (paymentMethod === "customer_credit" && !selectedCustomer) {
      setSyncState({ status: "error", message: "Select a customer before adding customer credit" });
      return;
    }

    if (paymentMethod === "customer_credit" && selectedCustomer && tenderCreditTotal + amount > creditAvailable) {
      setSyncState({ status: "error", message: "Customer credit limit is not enough for this payment" });
      return;
    }

    setTenderPayments((current) => [
      ...current,
      {
        id: `tender-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        method: paymentMethod,
        amount,
        reference: paymentReference.trim() || undefined
      }
    ]);
    setPaymentReference("");
    setPaymentAmount(0);
    setSyncState({ status: "success", message: `${displayMoney(amount)} payment added`, saleId: "tender" });
  }

  function removeTenderPayment(paymentId: string) {
    setTenderPayments((current) => current.filter((payment) => payment.id !== paymentId));
  }

  function paymentMethodLabel(method: PaymentMethodCode) {
    return allPaymentMethods.find((item) => item.method === method)?.label ?? method.replace("_", " ");
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((items) => {
      let stockMessage = "";
      const nextItems = items
        .map((item) => {
          if (item.product.id !== productId) return item;
          const nextQuantity = Math.max(item.quantity + delta, 0);
          if (!isServiceCategory(item.product.category) && nextQuantity > item.product.stock) {
            stockMessage = `${item.product.name} has only ${item.product.stock} available`;
            return item;
          }
          return { ...item, quantity: nextQuantity };
        })
        .filter((item) => item.quantity > 0);

      if (stockMessage) {
        setSyncState({ status: "error", message: stockMessage });
      }

      return nextItems;
    });
  }

  function openDiscountModal() {
    if (cart.length === 0) {
      setSyncState({ status: "error", message: "Add an item before applying a discount" });
      return;
    }

    const firstItem = cart[0];
    setDiscountProductId(firstItem.product.id);
    setDiscountAmount(firstItem.discount);
    setDiscountReason("");
    setDiscountApprovalId("");
    setDiscountModalOpen(true);
  }

  function closeDiscountModal() {
    setDiscountModalOpen(false);
    setDiscountProductId("");
    setDiscountAmount(0);
    setDiscountReason("");
    setDiscountApprovalId("");
  }

  function openVoidModal() {
    if (cart.length === 0) {
      setSyncState({ status: "error", message: "Add an item before requesting a void" });
      return;
    }

    setVoidReason("");
    setVoidApprovalId("");
    setVoidModalOpen(true);
  }

  function closeVoidModal() {
    setVoidModalOpen(false);
    setVoidReason("");
    setVoidApprovalId("");
  }

  function holdOrder() {
    if (cart.length === 0) {
      setSyncState({ status: "error", message: "Add items before holding an order" });
      return;
    }

    const heldOrder: HeldOrder = {
      id: `hold-${Date.now()}`,
      label: `Table #08 - ${cart.length} lines`,
      items: cart.map((item) => ({ ...item })),
      total: summary.total,
      discountApprovalId: saleDiscountApprovalId,
      createdAt: new Date().toISOString()
    };

    setHeldOrders((current) => [heldOrder, ...current]);
    setCart([]);
    setPaymentReference("");
    setSaleDiscountApprovalId("");
    setSyncState({ status: "success", message: `Order held: ${heldOrder.label}`, saleId: heldOrder.id });
  }

  function resumeHeldOrder(orderId: string) {
    if (cart.length > 0) {
      setSyncState({ status: "error", message: "Hold or complete the current cart before resuming another order" });
      return;
    }

    const heldOrder = heldOrders.find((order) => order.id === orderId);
    if (!heldOrder) {
      setSyncState({ status: "error", message: "Held order was not found" });
      return;
    }

    setCart(heldOrder.items.map((item) => ({ ...item })));
    setSaleDiscountApprovalId(heldOrder.discountApprovalId ?? "");
    setHeldOrders((current) => current.filter((order) => order.id !== orderId));
    setSyncState({ status: "success", message: `Resumed ${heldOrder.label}`, saleId: heldOrder.id });
  }

  function openSplitModal() {
    if (cart.length === 0) {
      setSyncState({ status: "error", message: "Add items before splitting an order" });
      return;
    }

    setSplitQuantities(Object.fromEntries(cart.map((item) => [item.product.id, 0])));
    setSplitModalOpen(true);
  }

  function closeSplitModal() {
    setSplitModalOpen(false);
    setSplitQuantities({});
  }

  async function queueLastReceiptPrint() {
    if (!lastSaleReceipt?.receipt.printEnabled) {
      setSyncState({ status: "error", message: "No printer was captured for this receipt" });
      return;
    }

    const printStarted = printReceipt(lastSaleReceipt);
    setSyncState({ status: "loading", message: printStarted ? "Printing receipt..." : "Allow pop-ups to print this receipt" });

    try {
      await queueReceiptDelivery(lastSaleReceipt.saleId, "print", branchId, cashierId);
      setSyncState({ status: "success", message: `Receipt queued for ${lastSaleReceipt.receipt.printerName}`, saleId: lastSaleReceipt.saleId });
    } catch (error) {
      setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to queue receipt print" });
    }
  }

  async function queueLastReceiptWhatsapp() {
    if (!lastSaleReceipt?.receipt.whatsappEnabled) {
      setSyncState({ status: "error", message: "WhatsApp receipts were off for this sale" });
      return;
    }

    setSyncState({ status: "loading", message: "Queueing WhatsApp receipt..." });

    try {
      await queueReceiptDelivery(lastSaleReceipt.saleId, "whatsapp", branchId, cashierId);
      setSyncState({ status: "success", message: "WhatsApp receipt queued", saleId: lastSaleReceipt.saleId });
    } catch (error) {
      setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to queue WhatsApp receipt" });
    }
  }

  function updateSplitQuantity(productId: string, delta: number) {
    const item = cart.find((cartItem) => cartItem.product.id === productId);
    if (!item) return;

    setSplitQuantities((current) => ({
      ...current,
      [productId]: Math.min(Math.max((current[productId] ?? 0) + delta, 0), item.quantity)
    }));
  }

  async function submitDiscount(event: FormEvent) {
    event.preventDefault();

    if (!selectedDiscountItem) {
      setSyncState({ status: "error", message: "Select an item before applying a discount" });
      return;
    }

    if (discountAmount > selectedDiscountItem.product.price) {
      setSyncState({ status: "error", message: "Discount cannot exceed the item price" });
      return;
    }

    if (applyManagerApproval("discount", proposedDiscountTotal) && !discountApprovalId.trim()) {
      setSyncState({ status: "loading", message: "Requesting manager approval..." });

      try {
        const response = await createApproval({
          branchId,
          type: "discount",
          entityType: "saleDraft",
          entityId: terminalId,
          amount: proposedDiscountTotal,
          reason: discountReason
        });
        setSyncState({ status: "success", message: `Approval requested: ${response.approval.id}`, saleId: response.approval.id });
        closeDiscountModal();
      } catch (error) {
        setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to request approval" });
      }
      return;
    }

    if (applyManagerApproval("discount", proposedDiscountTotal)) {
      setSyncState({ status: "loading", message: "Applying approved discount..." });

      try {
        const response = await applyApproval(
          discountApprovalId.trim(),
          "saleDraft",
          terminalId,
          "discount",
          proposedDiscountTotal,
          `${discountReason} | ${selectedDiscountItem.product.name}`,
          cashierId,
          branchId
        );

        setCart((items) =>
          items.map((item) => (
            item.product.id === selectedDiscountItem.product.id
              ? { ...item, discount: discountAmount, note: `${discountReason} | approval ${response.approval.id}` }
              : item
          ))
        );
        setSaleDiscountApprovalId(response.approval.id);
        setSyncState({ status: "success", message: `Approved discount applied: ${response.approval.id}`, saleId: "discount" });
        closeDiscountModal();
      } catch (error) {
        setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to apply approval" });
      }
      return;
    }

    setCart((items) =>
      items.map((item) => (item.product.id === selectedDiscountItem.product.id ? { ...item, discount: discountAmount, note: discountReason } : item))
    );
    setSaleDiscountApprovalId("");
    setSyncState({ status: "success", message: `Discount applied to ${selectedDiscountItem.product.name}`, saleId: "discount" });
    closeDiscountModal();
  }

  async function submitVoid(event: FormEvent) {
    event.preventDefault();

    if (cart.length === 0) {
      setSyncState({ status: "error", message: "No active order to void" });
      closeVoidModal();
      return;
    }

    if (!voidApprovalId.trim()) {
      setSyncState({ status: "loading", message: "Requesting manager approval..." });

      try {
        const response = await createApproval({
          branchId,
          type: "void",
          entityType: "saleDraft",
          entityId: terminalId,
          amount: summary.total,
          reason: voidReason
        });
        setSyncState({ status: "success", message: `Void approval requested: ${response.approval.id}`, saleId: response.approval.id });
        closeVoidModal();
      } catch (error) {
        setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to request void approval" });
      }
      return;
    }

    setSyncState({ status: "loading", message: "Applying approved void..." });

    try {
      const response = await applyApproval(
        voidApprovalId.trim(),
        "saleDraft",
        terminalId,
        "void",
        summary.total,
        voidReason,
        cashierId,
        branchId
      );
      setCart([]);
      setPaymentReference("");
      setSyncState({ status: "success", message: `Order voided with approval ${response.approval.id}`, saleId: "void" });
      closeVoidModal();
    } catch (error) {
      setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to apply void approval" });
    }
  }

  async function completeSale() {
    if (cart.length === 0) {
      return;
    }

    if (!online) {
      setSyncState({ status: "error", message: "Offline queue captured locally for later sync" });
      return;
    }

    if (!registerShift) {
      setSyncState({ status: "error", message: "Open a register shift before taking payments" });
      return;
    }

    if (!selectedTerminal) {
      setSyncState({ status: "error", message: "Select a valid terminal before taking payments" });
      return;
    }

    if (selectedTerminal.status !== "online") {
      setSyncState({ status: "error", message: "Sales can only be posted from an online terminal" });
      return;
    }

    const salePayments = tenderPayments.length > 0
      ? tenderPayments.map((payment) => ({ method: payment.method, amount: payment.amount, reference: payment.reference }))
      : [{ method: paymentMethod, amount: summary.total, reference: paymentReference || undefined }];
    const creditPaymentTotal = salePayments
      .filter((payment) => payment.method === "customer_credit")
      .reduce((sum, payment) => sum + payment.amount, 0);

    if (tenderPayments.length > 0 && tenderVariance !== 0) {
      setSyncState({
        status: "error",
        message: tenderVariance > 0
          ? `Add ${displayMoney(tenderBalance)} more to settle this sale`
          : `Remove ${displayMoney(tenderOverpay)} from payments before settling`
      });
      return;
    }

    if (creditPaymentTotal > 0 && !selectedCustomer) {
      setSyncState({ status: "error", message: "Select a customer before using customer credit" });
      return;
    }

    if (selectedCustomer && creditPaymentTotal > creditAvailable) {
      setSyncState({ status: "error", message: "Customer credit limit is not enough for this sale" });
      return;
    }

    if (tenderPayments.length === 0 && paymentReferenceRequired && !paymentReference.trim()) {
      setSyncState({ status: "error", message: "Enter the payment reference before posting this sale" });
      return;
    }

    setSyncState({ status: "loading", message: "Posting sale to API..." });

    try {
      const response = await createSale({
        branchId,
        terminalId,
        customerId: selectedCustomerId || undefined,
        tableId: tableContext?.tableId,
        tableOrderId: tableContext?.tableOrderId,
        idempotencyKey: `${terminalId}-${Date.now()}`,
        discountApprovalId: summary.discount >= 50000 ? saleDiscountApprovalId : undefined,
        lines: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          discount: item.discount,
          note: item.note
        })),
        payments: salePayments
      });
      const registerResponse = await fetchCurrentRegister(branchId, terminalId);
      await refreshCustomers(false);
      const paidWith = salePayments;
      const settledReceipt = tableContext?.tableOrderId
        ? {
            saleId: response.saleId,
            tableId: tableContext.tableId,
            tableLabel: tableContext.tableLabel,
            tableOrderId: tableContext.tableOrderId,
            total: response.summary.total,
            settledAt: new Date().toISOString()
          }
        : null;

      setCart([]);
      setPaymentReference("");
      setPaymentAmount(0);
      setTenderPayments([]);
      setSelectedCustomerId("");
      setSaleDiscountApprovalId("");
      setLastSaleReceipt({
        saleId: response.saleId,
        terminalId,
        cashierId,
        customerName: selectedCustomer?.name,
        tableLabel: tableContext?.tableLabel,
        createdAt: new Date().toISOString(),
        summary: response.summary,
        payments: paidWith,
        receipt: response.receipt
      });
      if (settledReceipt) {
        setLastSettledReceipt(settledReceipt);
        onTableSettled?.(settledReceipt);
      }
      onClearTableContext?.();
      setRegisterShift(registerResponse.shift ?? null);
      setRegisterMessage(registerResponse.shift ? "Register shift open" : "No open register shift");
      setSyncState({
        status: "success",
        message: `Sale completed at ${displayMoney(response.summary.total, response.receipt.currency)}`,
        saleId: response.saleId
      });
    } catch (error) {
      setSyncState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to complete sale"
      });
    }
  }

  async function completeSplitPayment(event: FormEvent) {
    event.preventDefault();

    if (splitItems.length === 0) {
      setSyncState({ status: "error", message: "Select at least one item for the split payment" });
      return;
    }

    if (!online) {
      setSyncState({ status: "error", message: "Split payment needs online sync for this terminal" });
      return;
    }

    if (!registerShift) {
      setSyncState({ status: "error", message: "Open a register shift before taking split payments" });
      return;
    }

    if (!selectedTerminal) {
      setSyncState({ status: "error", message: "Select a valid terminal before taking split payments" });
      return;
    }

    if (selectedTerminal.status !== "online") {
      setSyncState({ status: "error", message: "Split payments require an online terminal" });
      return;
    }

    if (paymentMethod === "customer_credit" && !selectedCustomer) {
      setSyncState({ status: "error", message: "Select a customer before using customer credit" });
      return;
    }

    if (paymentMethod === "customer_credit" && selectedCustomer && splitSummary.total > creditAvailable) {
      setSyncState({ status: "error", message: "Customer credit limit is not enough for this split" });
      return;
    }

    if (paymentReferenceRequired && !paymentReference.trim()) {
      setSyncState({ status: "error", message: "Enter the payment reference before posting this split" });
      return;
    }

    setSyncState({ status: "loading", message: "Posting split payment..." });

    try {
      const response = await createSale({
        branchId,
        terminalId,
        customerId: selectedCustomerId || undefined,
        tableId: tableContext?.tableId,
        idempotencyKey: `${terminalId}-split-${Date.now()}`,
        discountApprovalId: splitSummary.discount >= 50000 ? saleDiscountApprovalId : undefined,
        lines: splitItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          discount: item.discount,
          note: item.note ? `${item.note} | split payment` : "Split payment"
        })),
        payments: [{ method: paymentMethod, amount: splitSummary.total, reference: paymentReference || undefined }]
      });
      const registerResponse = await fetchCurrentRegister(branchId, terminalId);
      await refreshCustomers(false);
      const paidWith = [{ method: paymentMethod, amount: response.summary.total, reference: paymentReference || undefined }];

      setCart((items) =>
        items
          .map((item) => ({
            ...item,
            quantity: item.quantity - (splitQuantities[item.product.id] ?? 0)
          }))
          .filter((item) => item.quantity > 0)
      );
      setRegisterShift(registerResponse.shift ?? null);
      setRegisterMessage(registerResponse.shift ? "Register shift open" : "No open register shift");
      setPaymentReference("");
      setLastSaleReceipt({
        saleId: response.saleId,
        terminalId,
        cashierId,
        customerName: selectedCustomer?.name,
        tableLabel: tableContext?.tableLabel,
        createdAt: new Date().toISOString(),
        summary: response.summary,
        payments: paidWith,
        receipt: response.receipt
      });
      setSyncState({ status: "success", message: `Split paid at ${displayMoney(response.summary.total, response.receipt.currency)}`, saleId: response.saleId });
      closeSplitModal();
    } catch (error) {
      setSyncState({ status: "error", message: error instanceof Error ? error.message : "Unable to complete split payment" });
    }
  }

  return (
    <div className="terminal-layout">
      <aside className="category-rail">
        <div className="search-box">
          {scannerReady ? <ScanBarcode size={18} /> : <Search size={18} />}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scannerReady ? "Scan barcode or search" : "Search name or SKU"} />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear product search"><X size={14} /></button>
          ) : null}
        </div>
        <div className="category-list">
          {categories.map((item) => (
            <button className={item === category ? "active" : ""} key={item} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>
        <label className="terminal-selector">
          Branch
          {branchLocked ? (
            <span className="locked-select-value">
              <strong>{selectedBranch?.name ?? branchId}</strong>
              <small>{selectedBranch?.status ?? "assigned"}</small>
            </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id} disabled={branch.status !== "active"}>
                  {branch.name} - {branch.city} - {branch.status}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="terminal-selector">
          Terminal
          <select value={terminalId} onChange={(event) => changeTerminal(event.target.value)}>
            <option value="">Terminal</option>
            {branchTerminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id} disabled={terminal.status !== "online"}>
                {terminal.name} - {terminal.status}
              </option>
            ))}
          </select>
        </label>
        <button className="connection-button" onClick={() => setOnline((value) => !value)}>
          {online ? <Wifi size={18} /> : <WifiOff size={18} />}
          {online ? "Online sync" : "Offline queue"}
        </button>
        <div className={`sync-banner sync-${syncState.status}`}>
          {syncState.status === "idle" ? "Ready for sales" : syncState.message}
        </div>
        <div className={`register-summary ${registerShift ? "register-open" : "register-closed"}`}>
          <span>{registerMessage}</span>
          <strong>{registerShift ? displayMoney(registerShift.expectedCash) : "No shift"}</strong>
          <small>{selectedTerminal?.deviceCode ?? terminalId}</small>
        </div>
        <div className="hardware-status">
          <div className={`hardware-status-row ${printerReady ? "" : "off"}`}>
            <Printer size={15} />
            <span>{printerReady ? hardware?.printer : "No printer"}</span>
          </div>
          <div className={`hardware-status-row ${drawerReady ? "" : "off"}`}>
            <Banknote size={15} />
            <span>{drawerReady ? "Cash drawer ready" : "Manual cash drawer"}</span>
          </div>
          <div className={`hardware-status-row ${scannerReady ? "" : "off"}`}>
            <ScanBarcode size={15} />
            <span>{scannerReady ? "Scanner ready" : "Scanner off"}</span>
          </div>
        </div>
      </aside>

      <section className="product-grid">
        {filteredProducts.map((product) => {
          const isService = isServiceCategory(product.category);
          const outOfStock = !isService && product.stock <= 0;
          const lowStock = !isService && product.stock > 0 && product.stock <= product.reorderPoint;
          return (
            <button className={`product-card ${outOfStock ? "product-card-disabled" : ""}`} disabled={outOfStock} key={product.id} onClick={() => addProduct(product)}>
              <div className="product-image-wrap">
                <img src={resolveMediaUrl(product.image)} alt="" />
                <span>{product.category}</span>
              </div>
              <div className="product-card-body">
                <strong>{product.name}</strong>
                <small>{product.station}</small>
                <footer>
                  <b>{displayMoney(product.price)}</b>
                  <em className={outOfStock ? "stock-empty-pill" : lowStock ? "stock-low-pill" : ""}>{isService ? "Service" : outOfStock ? "Out of stock" : `${product.stock} left`}</em>
                </footer>
              </div>
            </button>
          );
        })}
      </section>

      <aside className="cart-panel">
        <div className="cart-header">
          <div>
            <p className="eyebrow">Current order</p>
            <h2>{orderTitle}</h2>
          </div>
          <span>{tableContext?.guests ? `${tableContext.guests} guests` : `${cart.length} lines`}</span>
        </div>
        {tableContext ? (
          <div className="active-table-context">
            <span>{tableContext.tableOrderId ?? "New table sale"}</span>
            <strong>{tableContext.customerName || "Dine-in guest"}</strong>
            <small>{tableContext.waiterId ?? "No waiter assigned"}</small>
          </div>
        ) : null}
        <label className="customer-selector">
          Customer
          <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
            <option value="">Customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name} - {customer.group}</option>
            ))}
          </select>
          <small>
            {selectedCustomer
              ? `${selectedCustomer.loyaltyPoints} pts - credit ${displayMoney(creditAvailable)}`
              : "Attach a customer for loyalty, credit, and receipt history"}
          </small>
        </label>

        <div className="cart-lines">
          {cart.length === 0 ? (
            <div className="empty-state">Tap a product to start a sale.</div>
          ) : (
            cart.map((item) => (
              <div className="cart-line" key={item.product.id}>
                <div className="qty-controls">
                  <button onClick={() => updateQuantity(item.product.id, -1)} aria-label={`Reduce ${item.product.name}`}>
                    <Minus size={16} />
                  </button>
                  <b>{item.quantity}</b>
                  <button onClick={() => updateQuantity(item.product.id, 1)} aria-label={`Increase ${item.product.name}`}>
                    <Plus size={16} />
                  </button>
                </div>
                <div className="line-detail">
                  <strong>{item.product.name}</strong>
                  <span>{item.discount > 0 ? `${item.product.station} - discount ${displayMoney(item.discount)} each` : item.product.station}</span>
                </div>
                <b>{displayMoney(Math.max((item.product.price - item.discount) * item.quantity, 0))}</b>
                <button className="icon-danger" onClick={() => updateQuantity(item.product.id, -item.quantity)} aria-label={`Remove ${item.product.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="totals">
          <span>Subtotal <b>{displayMoney(summary.subtotal)}</b></span>
          <span>Discount <b>-{displayMoney(summary.discount)}</b></span>
          <span>Service charge <b>{displayMoney(summary.serviceCharge)}</b></span>
          <span>VAT <b>{displayMoney(summary.vat)}</b></span>
          <strong>Total due <b>{displayMoney(summary.total)}</b></strong>
        </div>

        <div className="payment-box">
          <div className="payment-methods">
            {visiblePaymentMethods.length === 0 ? (
              <span className="payment-method-empty">No enabled payment method</span>
            ) : visiblePaymentMethods.map((item) => {
              const Icon = item.icon;
              const creditDisabled = item.method === "customer_credit" && (!selectedCustomer || creditAvailable <= 0);
              const disabledReason = !selectedCustomer ? "Select a customer first" : "No credit available";
              return (
                <button
                  className={paymentMethod === item.method ? "active" : ""}
                  disabled={creditDisabled}
                  key={item.method}
                  onClick={() => setPaymentMethod(item.method)}
                  title={creditDisabled ? disabledReason : item.label}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>
          {selectedCustomer ? (
            <small className="payment-guidance">Customer credit available: {displayMoney(creditAvailable)}</small>
          ) : (
            <small className="payment-guidance">Select a customer to enable credit sale.</small>
          )}
          <div className="payment-reference">
            <span>Amount</span>
            <div className="payment-amount-row">
              <input
                min="0"
                max={tenderBalance}
                type="number"
                value={paymentAmount || ""}
                onChange={(event) => setPaymentAmount(Number(event.target.value))}
                placeholder={displayMoney(tenderBalance)}
              />
              <button className="secondary-button" disabled={paymentMethods.length === 0 || tenderBalance <= 0} onClick={addTenderPayment}>
                <Plus size={16} /> Add
              </button>
            </div>
          </div>
          {paymentMethod !== "cash" ? (
            <label className="payment-reference">
              {paymentReferenceRequired ? "Reference required" : "Reference"}
              <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Approval or transfer ID" required={paymentReferenceRequired} />
            </label>
          ) : null}
          {tenderPayments.length > 0 ? (
            <div className="tender-list">
              {tenderPayments.map((payment) => (
                <div className="list-row" key={payment.id}>
                  <div>
                    <strong>{paymentMethodLabel(payment.method)}</strong>
                    <span>{payment.reference ?? "No reference"}</span>
                  </div>
                  <b>{displayMoney(payment.amount)}</b>
                  <button className="icon-danger" onClick={() => removeTenderPayment(payment.id)} aria-label={`Remove ${paymentMethodLabel(payment.method)} payment`}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="list-row">
                <div>
                  <strong>{tenderOverpay > 0 ? "Overpaid" : "Remaining"}</strong>
                  <span>{tenderBalance > 0 ? "Add another tender" : tenderOverpay > 0 ? "Remove a tender" : "Ready to settle"}</span>
                </div>
                <b>{displayMoney(tenderOverpay || tenderBalance)}</b>
              </div>
            </div>
          ) : null}
        </div>

        <div className="cart-actions">
          <button onClick={holdOrder}><Pause size={16} /> Hold</button>
          <button onClick={openSplitModal}><Split size={16} /> Split</button>
          <button onClick={openDiscountModal}><BadgePercent size={16} /> Discount</button>
          <button className="danger-button" onClick={openVoidModal}><Ban size={16} /> Void</button>
        </div>
        <button
          className="pay-button"
          disabled={
            cart.length === 0 ||
            paymentMethods.length === 0 ||
            syncState.status === "loading" ||
            (online && !registerShift) ||
            (tenderPayments.length === 0 && paymentReferenceRequired && !paymentReference.trim()) ||
            (tenderPayments.length > 0 && tenderVariance !== 0)
          }
          onClick={completeSale}
        >
          {syncState.status === "loading" ? "Processing..." : "Pay now"}
          <b>{displayMoney(tenderPayments.length > 0 ? tenderTotal : summary.total)}</b>
        </button>
        {lastSettledReceipt ? (
          <div className="settlement-receipt">
            <span>Table settled</span>
            <strong>{lastSettledReceipt.tableLabel ?? "Table"} - {displayMoney(lastSettledReceipt.total)}</strong>
            <small>{lastSettledReceipt.saleId} at {new Date(lastSettledReceipt.settledAt).toLocaleTimeString()}</small>
          </div>
        ) : null}
        {lastSaleReceipt ? (
          <div className="receipt-note receipt-card">
            <strong>{lastSaleReceipt?.receipt.businessName ?? "Receipt ready"}</strong>
            <span>{lastSaleReceipt.saleId}</span>
            {lastSaleReceipt?.receipt.taxId ? <small>{lastSaleReceipt.receipt.taxId}</small> : null}
            <b>{displayMoney(lastSaleReceipt?.summary.total ?? 0, lastSaleReceipt?.receipt.currency ?? currency)}</b>
            <small>{lastSaleReceipt?.receipt.footer}</small>
            <em>
              {lastSaleReceipt?.receipt.printEnabled
                ? `Print ready: ${lastSaleReceipt.receipt.printerName}`
                : "No receipt printer configured"}
            </em>
            <em>{lastSaleReceipt?.receipt.whatsappEnabled ? "WhatsApp receipt enabled" : "WhatsApp receipt off"}</em>
            <div className="receipt-actions">
              <button className="secondary-button" disabled={!lastSaleReceipt?.receipt.printEnabled} onClick={queueLastReceiptPrint}>
                <Printer size={15} /> Print
              </button>
              <button className="secondary-button" disabled={!lastSaleReceipt?.receipt.whatsappEnabled} onClick={queueLastReceiptWhatsapp}>
                <MessageCircle size={15} /> WhatsApp
              </button>
            </div>
          </div>
        ) : null}
        {heldOrders.length > 0 ? (
          <div className="held-orders">
            <span>Held orders</span>
            {heldOrders.map((order) => (
              <button key={order.id} onClick={() => resumeHeldOrder(order.id)}>
                <Play size={14} />
                <strong>{order.label}</strong>
                <small>{displayMoney(order.total)} - {new Date(order.createdAt).toLocaleTimeString()}</small>
              </button>
            ))}
          </div>
        ) : null}
      </aside>
      {discountModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeDiscountModal}>
          <section className="modal-panel terminal-modal" role="dialog" aria-modal="true" aria-labelledby="discount-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">POS approval workflow</p>
                <h2 id="discount-modal-title">Apply discount</h2>
              </div>
              <button className="icon-button" onClick={closeDiscountModal} aria-label="Close discount modal"><X size={18} /></button>
            </div>
            <form className="terminal-action-form" onSubmit={submitDiscount}>
              <label>
                Product
                <select value={discountProductId} onChange={(event) => {
                  const nextItem = cart.find((item) => item.product.id === event.target.value);
                  setDiscountProductId(event.target.value);
                  setDiscountAmount(nextItem?.discount ?? 0);
                }}>
                  <option value="">Product</option>
                  {cart.map((item) => (
                    <option key={item.product.id} value={item.product.id}>{item.product.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Discount per item
                <input type="number" min={0} max={selectedDiscountItem?.product.price ?? 0} value={discountAmount} onChange={(event) => setDiscountAmount(Number(event.target.value))} required />
              </label>
              <label className="wide-field">
                Reason
                <input value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} placeholder="Customer recovery, promo, manager exception" required />
              </label>
              {applyManagerApproval("discount", proposedDiscountTotal) ? (
                <label className="wide-field">
                  Approved request ID
                  <input value={discountApprovalId} onChange={(event) => setDiscountApprovalId(event.target.value)} placeholder="Leave blank to request manager approval" />
                </label>
              ) : null}
              <div className={applyManagerApproval("discount", proposedDiscountTotal) ? "approval-warning" : "discount-preview"}>
                <span>{selectedDiscountItem ? `${selectedDiscountItem.quantity} x ${selectedDiscountItem.product.name}` : "No item selected"}</span>
                <strong>{displayMoney(proposedDiscountTotal)}</strong>
                <small>{applyManagerApproval("discount", proposedDiscountTotal) ? "Manager approval required or approved ID needed" : "Applies immediately"}</small>
              </div>
              <div className="form-summary">
                <span>{statusLabel(syncState)}</span>
                <span>{summary.discount > 0 ? `${displayMoney(summary.discount)} already applied` : "No active discount"}</span>
                <button className="primary-button" type="submit"><Check size={18} /> {applyManagerApproval("discount", proposedDiscountTotal) && discountApprovalId.trim() ? "Apply approved" : applyManagerApproval("discount", proposedDiscountTotal) ? "Request approval" : "Apply"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {voidModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeVoidModal}>
          <section className="modal-panel terminal-modal" role="dialog" aria-modal="true" aria-labelledby="void-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">POS approval workflow</p>
                <h2 id="void-modal-title">Void current order</h2>
              </div>
              <button className="icon-button" onClick={closeVoidModal} aria-label="Close void modal"><X size={18} /></button>
            </div>
            <form className="terminal-action-form" onSubmit={submitVoid}>
              <label className="wide-field">
                Reason
                <input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Duplicate order, customer cancelled, wrong table" required />
              </label>
              <label className="wide-field">
                Approved request ID
                <input value={voidApprovalId} onChange={(event) => setVoidApprovalId(event.target.value)} placeholder="Leave blank to request manager approval" />
              </label>
              <div className="approval-warning">
                <span>{cart.length} lines will be removed</span>
                <strong>{displayMoney(summary.total)}</strong>
                <small>{applyManagerApproval("void", summary.total) ? "Manager approval required" : "Applies immediately"}</small>
              </div>
              <div className="form-summary">
                <span>{statusLabel(syncState)}</span>
                <span>{voidApprovalId.trim() ? "Approved void will clear cart" : "Request manager approval"}</span>
                <button className={voidApprovalId.trim() ? "danger-button" : "primary-button"} type="submit">
                  {voidApprovalId.trim() ? <Ban size={18} /> : <Check size={18} />}
                  {voidApprovalId.trim() ? "Apply void" : "Request approval"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {splitModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeSplitModal}>
          <section className="modal-panel terminal-modal" role="dialog" aria-modal="true" aria-labelledby="split-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Order payment</p>
                <h2 id="split-modal-title">Split order</h2>
              </div>
              <button className="icon-button" onClick={closeSplitModal} aria-label="Close split modal"><X size={18} /></button>
            </div>
            <form className="terminal-action-form" onSubmit={completeSplitPayment}>
              <div className="split-lines wide-field">
                {cart.map((item) => {
                  const selectedQuantity = splitQuantities[item.product.id] ?? 0;
                  return (
                    <div className="split-line" key={item.product.id}>
                      <div>
                        <strong>{item.product.name}</strong>
                        <span>{selectedQuantity} of {item.quantity} selected</span>
                      </div>
                      <div className="qty-controls">
                        <button type="button" onClick={() => updateSplitQuantity(item.product.id, -1)}><Minus size={16} /></button>
                        <b>{selectedQuantity}</b>
                        <button type="button" onClick={() => updateSplitQuantity(item.product.id, 1)}><Plus size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="discount-preview">
                <span>{splitItems.length} lines selected</span>
                <strong>{displayMoney(splitSummary.total)}</strong>
                <small>Remaining items stay in the active cart</small>
              </div>
              <div className="form-summary">
                <span>{paymentMethods.find((item) => item.method === paymentMethod)?.label ?? paymentMethod}</span>
                <span>{statusLabel(syncState)}</span>
                <button className="primary-button" disabled={paymentReferenceRequired && !paymentReference.trim()} type="submit"><Check size={18} /> Pay split</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(state: SaleSyncState) {
  return state.status === "idle" ? "Ready" : state.message;
}
