import type { Product } from "../../modules/catalog/types";
import type { SaleSummary } from "../../modules/sales/types";

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";

const baseHeaders = {
  "content-type": "application/json"
};

const authStorageKey = "naijapos.auth";

export interface CreateSalePayload {
  branchId: string;
  terminalId: string;
  customerId?: string;
  tableId?: string;
  tableOrderId?: string;
  idempotencyKey: string;
  lines: Array<{
    productId: string;
    quantity: number;
    discount: number;
    note?: string;
  }>;
  payments: Array<{
    method: PaymentMethodCode;
    amount: number;
    reference?: string;
  }>;
}

export interface CreateSaleResponse {
  saleId: string;
  summary: SaleSummary & {
    lines: CompletedSaleLine[];
    paid: number;
    balance: number;
  };
  receipt: SaleReceiptSnapshot;
}

export type PaymentMethodCode = "cash" | "card" | "bank_transfer" | "mobile_money" | "customer_credit" | "voucher";

export type SaleStatus = "completed" | "voided" | "refunded" | "partially_refunded";

export interface CompletedSaleLine {
  productId: string;
  name: string;
  quantity: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
}

export interface CompletedSale {
  id: string;
  tenantId: string;
  branchId: string;
  terminalId: string;
  shiftId: string;
  cashierId: string;
  customerId?: string;
  customer?: Pick<Customer, "id" | "name" | "phone" | "group" | "loyaltyPoints" | "outstandingBalance">;
  tableId?: string;
  tableOrderId?: string;
  idempotencyKey: string;
  summary: SaleSummary & {
    lines: CompletedSaleLine[];
    paid: number;
    balance: number;
  };
  status: SaleStatus;
  refundTotal: number;
  receipt: SaleReceiptSnapshot;
  voidReason?: string;
  refundReason?: string;
  createdAt: string;
  updatedAt: string;
  payments: PaymentRecord[];
}

export interface SaleReceiptSnapshot {
  businessName: string;
  taxId?: string;
  currency: TenantSettings["currency"];
  footer: string;
  whatsappEnabled: boolean;
  printerName?: string;
  printEnabled: boolean;
}

export interface RegisterShift {
  id: string;
  tenantId: string;
  branchId: string;
  terminalId: string;
  cashierId: string;
  status: "open" | "closed";
  openingBalance: number;
  expectedCash: number;
  countedCash?: number;
  variance?: number;
  openedAt: string;
  closedAt?: string;
  managerNote?: string;
}

export interface PaymentRecord {
  id: string;
  tenantId: string;
  branchId: string;
  saleId: string;
  shiftId: string;
  method: PaymentMethodCode;
  amount: number;
  reference?: string;
  reconciliationStatus: "matched" | "pending";
  createdAt: string;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  branchId: string;
  shiftId: string;
  type: "cash_in" | "cash_out" | "paid_in" | "paid_out";
  amount: number;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export type ExpenseStatus = "draft" | "pending_approval" | "approved" | "paid" | "rejected" | "voided";

export interface Expense {
  id: string;
  tenantId: string;
  branchId: string;
  category: string;
  description: string;
  vendor?: string;
  amount: number;
  paymentMethod: PaymentMethodCode;
  reference?: string;
  status: ExpenseStatus;
  spentAt: string;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensePayload {
  branchId: string;
  category: string;
  description: string;
  vendor?: string;
  amount: number;
  paymentMethod: PaymentMethodCode;
  reference?: string;
  status: ExpenseStatus;
  spentAt: string;
  note?: string;
}

export interface OpenRegisterPayload {
  branchId: string;
  terminalId: string;
  openingBalance: number;
}

export interface CashMovementPayload {
  shiftId: string;
  type: CashMovement["type"];
  amount: number;
  reason: string;
}

export interface CloseRegisterPayload {
  shiftId: string;
  countedCash: number;
  managerNote?: string;
}

export type ProductPayload = Omit<Product, "id"> & {
  branchId: string;
};

export interface StockMovement {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  productName: string;
  supplierId?: string;
  supplierName?: string;
  type: "receipt" | "issue" | "adjustment" | "transfer" | "waste" | "count";
  quantityDelta: number;
  balanceAfter: number;
  reason: string;
  reference?: string;
  createdAt: string;
  createdBy: string;
}

export interface Supplier {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  leadTimeDays: number;
  active: boolean;
  productIds: string[];
  createdAt: string;
}

export interface StockAdjustmentPayload {
  productId: string;
  branchId: string;
  type: StockMovement["type"];
  quantityDelta: number;
  reason: string;
  reference?: string;
}

export interface StockCountPayload {
  branchId: string;
  reference: string;
  reason: string;
  counts: Array<{
    productId: string;
    countedQuantity: number;
  }>;
}

export interface SupplierPayload {
  branchId: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  leadTimeDays: number;
  active: boolean;
  productIds: string[];
}

export interface PurchaseReceiptPayload {
  supplierId: string;
  branchId: string;
  productId: string;
  quantity: number;
  reference: string;
  note: string;
}

export type RestaurantTableState = "available" | "occupied" | "reserved" | "awaiting_payment" | "delayed" | "unavailable";

export interface RestaurantTable {
  id: string;
  tenantId: string;
  branchId: string;
  area: string;
  label: string;
  seats: number;
  state: RestaurantTableState;
  guests: number;
  waiterId?: string;
  orderId?: string;
  customerName?: string;
  specialInstructions?: string;
  x: number;
  y: number;
  openedAt?: string;
}

export interface TableLayoutPayload {
  area: string;
  label: string;
  seats: number;
  x: number;
  y: number;
}

export interface TableOrder {
  id: string;
  tenantId: string;
  branchId: string;
  tableId: string;
  guests: number;
  waiterId: string;
  customerName?: string;
  specialInstructions?: string;
  items: TableOrderItem[];
  prepStatus?: "new" | "preparing" | "ready" | "served";
  status: "open" | "bill_requested" | "closed" | "cancelled";
  openedAt: string;
  billRequestedAt?: string;
}

export interface TableOrderItem {
  id: string;
  productId: string;
  productName: string;
  station: Product["station"];
  quantity: number;
  unitPrice: number;
  modifiers: string[];
  note?: string;
}

export interface TableReservation {
  id: string;
  tenantId: string;
  branchId: string;
  tableId: string;
  tableLabel: string;
  customerName: string;
  phone: string;
  guests: number;
  reservedAt: string;
  durationMinutes: number;
  status: "booked" | "seated" | "cancelled" | "no_show";
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface OpenTableOrderPayload {
  tableId: string;
  guests: number;
  waiterId: string;
  customerName?: string;
  specialInstructions?: string;
}

export interface TableOrderItemPayload {
  productId: string;
  quantity: number;
  modifiers: string[];
  note?: string;
}

export interface TableReservationPayload {
  branchId: string;
  tableId: string;
  customerName: string;
  phone: string;
  guests: number;
  reservedAt: string;
  durationMinutes: number;
  note?: string;
}

export type PrepTicketStatus = "new" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
export type PrepStation = "Kitchen" | "Bar" | "Counter";

export interface PrepTicket {
  id: string;
  tenantId: string;
  branchId: string;
  tableOrderId?: string;
  station: PrepStation;
  tableLabel: string;
  waiterId: string;
  serviceType: "dine_in" | "takeaway" | "delivery";
  priority: "normal" | "rush";
  status: PrepTicketStatus;
  items: Array<{
    id: string;
    productId?: string;
    sourceTableItemId?: string;
    productName: string;
    quantity: number;
    modifiers: string[];
    note?: string;
    status: PrepTicketStatus;
  }>;
  createdAt: string;
  acceptedAt?: string;
  readyAt?: string;
  servedAt?: string;
  cancelledAt?: string;
}

export type CustomerGroup = "Walk-in" | "VIP" | "Credit account" | "Wholesale" | "Staff";

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email?: string;
  group: CustomerGroup;
  loyaltyPoints: number;
  creditLimit: number;
  outstandingBalance: number;
  notes?: string;
  lastVisitAt?: string;
  createdAt: string;
}

export interface CustomerPayload {
  name: string;
  phone: string;
  email?: string;
  group: CustomerGroup;
  creditLimit: number;
  loyaltyPoints: number;
  notes?: string;
}

export interface CustomerLedgerPayload {
  type: "credit_sale" | "payment" | "loyalty_adjustment" | "voucher";
  amount: number;
  pointsDelta: number;
  note: string;
}

export interface CustomerLedgerEntry {
  id: string;
  tenantId: string;
  customerId: string;
  type: CustomerLedgerPayload["type"];
  amount: number;
  pointsDelta: number;
  balanceAfter: number;
  pointsAfter: number;
  note: string;
  createdAt: string;
  createdBy: string;
}

export type StaffRole = string;

export interface StaffMember {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  email: string;
  phone: string;
  role: StaffRole;
  pinEnabled: boolean;
  active: boolean;
  salesTotal: number;
  inviteStatus: "pending" | "accepted" | "revoked" | "expired";
  invitedAt?: string;
  invitedBy?: string;
  inviteExpiresAt?: string;
  lastSeenAt?: string;
  createdAt: string;
  permissions: string[];
}

export interface AuthStaff {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  email: string;
  role: StaffRole;
  permissions: string[];
}

export interface AuthSession {
  id: string;
  tenantId: string;
  staffId: string;
  branchId?: string;
  terminalId?: string;
  role: StaffRole;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface AuthResponse {
  staff: AuthStaff;
  session: AuthSession;
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

export interface AccessPermission {
  action: string;
  label: string;
  group: string;
  description: string;
}

export interface AccessRole {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  description?: string;
  system: boolean;
  staffCount: number;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RolePayload {
  name: string;
  label: string;
  description?: string;
}

function authStorage() {
  if (window.localStorage.getItem(authStorageKey)) return window.localStorage;
  if (window.sessionStorage.getItem(authStorageKey)) return window.sessionStorage;
  return window.localStorage;
}

export function readStoredAuth() {
  const rawAuth = window.localStorage.getItem(authStorageKey) ?? window.sessionStorage.getItem(authStorageKey);
  if (!rawAuth) return null;

  try {
    return JSON.parse(rawAuth) as AuthResponse;
  } catch {
    window.localStorage.removeItem(authStorageKey);
    window.sessionStorage.removeItem(authStorageKey);
    return null;
  }
}

export function storeAuth(auth: AuthResponse, persist = true) {
  const storage = persist ? window.localStorage : window.sessionStorage;
  window.localStorage.removeItem(authStorageKey);
  window.sessionStorage.removeItem(authStorageKey);
  storage.setItem(authStorageKey, JSON.stringify(auth));
  window.dispatchEvent(new CustomEvent("naijapos-auth-changed", { detail: auth }));
}

export function clearStoredAuth() {
  window.localStorage.removeItem(authStorageKey);
  window.sessionStorage.removeItem(authStorageKey);
  window.dispatchEvent(new CustomEvent("naijapos-auth-changed", { detail: null }));
}

function authHeaders() {
  const auth = readStoredAuth();
  if (!auth) return {};

  return {
    authorization: `Bearer ${auth.accessToken}`,
    "x-tenant-id": auth.staff.tenantId,
    "x-branch-id": auth.session.branchId ?? auth.staff.branchId
  };
}

function composeHeaders(headers?: HeadersInit) {
  const composed = new Headers(baseHeaders);
  const auth = authHeaders();

  Object.entries(auth).forEach(([key, value]) => composed.set(key, value));

  if (headers) {
    new Headers(headers).forEach((value, key) => {
      if (!value.trim()) return;
      const lowerKey = key.toLowerCase();
      const isAuthIdentityHeader = ["authorization", "x-tenant-id", "x-role", "x-user-id"].includes(lowerKey);
      if (Object.keys(auth).length > 0 && isAuthIdentityHeader) return;
      composed.set(key, value);
    });
  }

  return composed;
}

function branchHeaders(branchId?: string) {
  return branchId ? { "x-branch-id": branchId } : undefined;
}

async function refreshStoredAuth() {
  const auth = readStoredAuth();
  if (!auth?.refreshToken) return null;

  const response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify({ refreshToken: auth.refreshToken })
  });

  if (!response.ok) {
    clearStoredAuth();
    return null;
  }

  const nextAuth = (await response.json()) as AuthResponse;
  authStorage().setItem(authStorageKey, JSON.stringify(nextAuth));
  window.dispatchEvent(new CustomEvent("naijapos-auth-changed", { detail: nextAuth }));
  return nextAuth;
}

export interface StaffPayload {
  branchId: string;
  name: string;
  email: string;
  phone: string;
  role: StaffRole;
  pinEnabled: boolean;
  active: boolean;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  branchId?: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export type ApprovalType = "discount" | "void" | "refund" | "cash_movement" | "register_close" | "stock_adjustment" | "customer_credit" | "expense";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "applied";

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  branchId: string;
  type: ApprovalType;
  entityType: string;
  entityId: string;
  amount: number;
  reason: string;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}

export interface ApprovalPayload {
  branchId: string;
  type: ApprovalType;
  entityType: string;
  entityId: string;
  amount: number;
  reason: string;
}

export interface TenantSettings {
  businessName: string;
  taxId?: string;
  defaultBranchId: string;
  defaultTaxRate: number;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  currency: "NGN" | "USD" | "GHS" | "KES" | "ZAR";
  productCategories: string[];
  receiptFooter: string;
  whatsappReceipts: boolean;
  paymentMethods: {
    cash: boolean;
    card: boolean;
    bankTransfer: boolean;
    mobileMoney: boolean;
  };
  hardware: {
    printer: string;
    cashDrawer: boolean;
    barcodeScanner: boolean;
  };
}

export interface TenantProfile {
  id: string;
  name: string;
  plan: SubscriptionPlan;
  branchLimit: number;
  activeBranches: number;
  settings: TenantSettings;
}

export type SubscriptionPlan = "Free Trial" | "Starter" | "Business" | "Professional" | "Enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "grace_period" | "restricted" | "cancelled";
export type SubscriptionInvoiceStatus = "draft" | "open" | "paid" | "void" | "overdue";

export interface SubscriptionPlanOption {
  plan: SubscriptionPlan;
  amount: number;
  branchLimit: number;
  userLimit: number;
  terminalLimit: number;
  storageGb: number;
  features: string[];
}

export interface TenantSubscription {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingEmail: string;
  amount: number;
  interval: "monthly" | "yearly";
  branchLimit: number;
  userLimit: number;
  terminalLimit: number;
  storageGb: number;
  renewalDate: string;
  trialEndsAt?: string;
  graceEndsAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: TenantSettings["currency"];
  status: SubscriptionInvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  paymentReference?: string;
  createdAt: string;
}

export interface SubscriptionUpdatePayload {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingEmail: string;
  renewalDate: string;
  graceEndsAt?: string;
  notes?: string;
}

export type BranchStatus = "active" | "paused";

export interface BranchProfile {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  status: BranchStatus;
  createdAt: string;
}

export interface BranchPayload {
  name: string;
  address: string;
  city: string;
  phone: string;
  status: BranchStatus;
}

export type TerminalStatus = "online" | "offline" | "maintenance";

export interface TerminalDevice {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  deviceCode: string;
  status: TerminalStatus;
  appVersion: string;
  lastSeenAt?: string;
  createdAt: string;
}

export type BranchOption = Pick<BranchProfile, "id" | "tenantId" | "name" | "city" | "status">;
export type TerminalOption = Omit<TerminalDevice, "createdAt">;

export type SyncRecordStatus = "queued" | "processing" | "synced" | "failed" | "conflict";
export type SyncRecordType = "sale" | "table_order" | "payment" | "cash_movement" | "stock_adjustment" | "receipt_action";

export interface SyncQueueRecord {
  id: string;
  tenantId: string;
  branchId: string;
  terminalId: string;
  recordType: SyncRecordType;
  operation: "create" | "update" | "delete";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: SyncRecordStatus;
  attempts: number;
  error?: string;
  serverEntityId?: string;
  lastAttemptAt?: string;
  syncedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncQueuePayload {
  branchId: string;
  terminalId: string;
  recordType: SyncRecordType;
  operation: SyncQueueRecord["operation"];
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface TerminalPayload {
  branchId: string;
  name: string;
  deviceCode: string;
  status: TerminalStatus;
  appVersion: string;
}

export interface DashboardReport {
  period: ReportPeriod;
  periodLabel: string;
  summary: {
    totalSales: number;
    orderCount: number;
    averageTransaction: number;
    grossProfit: number;
    expenseTotal: number;
    netProfit: number;
    lowStockCount: number;
    openRegisterCash: number;
    auditEventCount: number;
    pendingApprovalCount: number;
    pendingApprovalValue: number;
    highPriorityApprovalCount: number;
  };
  hourlySales: Array<{ label: string; amount: number }>;
  lowStock: Array<{ id: string; name: string; sku: string; stock: number; reorderPoint: number }>;
  staffPerformance: Array<{ id: string; name: string; role: string; salesTotal: number; status: string }>;
  paymentMix: Record<string, number>;
  categorySales: Array<{ category: string; quantity: number; sales: number; cost: number; profit: number }>;
  topProducts: Array<{ id: string; name: string; quantity: number; sales: number; profit: number }>;
  approvals: Array<{
    id: string;
    type: ApprovalType;
    entityType: string;
    entityId: string;
    amount: number;
    reason: string;
    requestedBy: string;
    createdAt: string;
  }>;
}

export type ReportPeriod = "today" | "week" | "month" | "year" | "all";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: composeHeaders(init?.headers)
  });

  if (response.status === 401 && readStoredAuth()?.refreshToken && !path.startsWith("/api/v1/auth/")) {
    const refreshedAuth = await refreshStoredAuth();
    if (refreshedAuth) {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: composeHeaders(init?.headers)
      });
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function requestPublicJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: new Headers({ ...baseHeaders, ...Object.fromEntries(new Headers(init?.headers).entries()) })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const diagnostic = [body.reason, body.email, body.tenantId].filter(Boolean).join(" | ");
    throw new Error(`${body.error ?? `API request failed with ${response.status}`}${diagnostic ? ` (${diagnostic})` : ""}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchCatalogProducts(branchId?: string) {
  const params = branchId ? `?${new URLSearchParams({ branchId }).toString()}` : "";
  return requestJson<{ products: Product[] }>(`/api/v1/catalog/products${params}`, {
    headers: branchId ? { "x-branch-id": branchId } : undefined
  });
}

export function resolveMediaUrl(path: string) {
  return path.startsWith("/uploads/") ? `${apiBaseUrl}${path}` : path;
}

export async function uploadProductImage(file: File, branchId = "", userId = "") {
  const response = await fetch(`${apiBaseUrl}/api/v1/catalog/product-images`, {
    method: "POST",
    headers: composeHeaders({
      "x-branch-id": branchId,
      "x-file-name": file.name,
      "content-type": file.type
    }),
    body: file
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Image upload failed with ${response.status}`);
  }

  return response.json() as Promise<{ imagePath: string }>;
}

export async function fetchCurrentTenant(userId = "", branchId?: string) {
  const headers: Record<string, string> = {};
  if (branchId) headers["x-branch-id"] = branchId;

  return requestJson<{ tenant: TenantProfile }>("/api/v1/tenants/current", {
    headers: Object.keys(headers).length > 0 ? headers : undefined
  });
}

export async function fetchDashboardReport(branchId = "", period: ReportPeriod = "today", userId = "") {
  const params = new URLSearchParams({ branchId, period });
  return requestJson<DashboardReport>(`/api/v1/reports/dashboard?${params.toString()}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function updateTenantSettings(payload: TenantSettings, userId = "", branchId = payload.defaultBranchId) {
  return requestJson<{ tenant: TenantProfile }>("/api/v1/tenants/current/settings", {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function renameProductCategory(from: string, to: string, userId = "", branchId = "") {
  return requestJson<{ tenant: TenantProfile; updatedProductCount: number }>("/api/v1/tenants/current/product-categories/rename", {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ from, to })
  });
}

export async function fetchSubscriptionOverview(branchId = "") {
  return requestJson<{ subscription: TenantSubscription | null; invoices: SubscriptionInvoice[]; plans: SubscriptionPlanOption[] }>("/api/v1/subscriptions/current", {
    headers: branchHeaders(branchId)
  });
}

export async function updateSubscription(payload: SubscriptionUpdatePayload, branchId = "") {
  return requestJson<{ subscription: TenantSubscription }>("/api/v1/subscriptions/current", {
    method: "PATCH",
    headers: branchHeaders(branchId),
    body: JSON.stringify(payload)
  });
}

export async function updateSubscriptionInvoice(invoiceId: string, status: SubscriptionInvoiceStatus, paymentReference?: string, branchId = "") {
  return requestJson<{ invoice: SubscriptionInvoice }>(`/api/v1/subscriptions/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: branchHeaders(branchId),
    body: JSON.stringify({ status, paymentReference })
  });
}

export async function fetchBranches() {
  return requestJson<{ branches: BranchProfile[]; terminals: TerminalDevice[] }>("/api/v1/branches");
}

export async function fetchBranchOptions() {
  return requestJson<{ branches: BranchOption[]; terminals: TerminalOption[] }>("/api/v1/branches/options");
}

export async function fetchAuthBootstrap(tenantId: string, branchId?: string) {
  const params = new URLSearchParams({ tenantId });
  if (branchId) params.set("branchId", branchId);
  return requestJson<{
    branches: BranchOption[];
    terminals: TerminalOption[];
    staff: Array<Pick<StaffMember, "id" | "tenantId" | "branchId" | "name" | "role" | "pinEnabled" | "active">>;
  }>(`/api/v1/auth/bootstrap?${params.toString()}`);
}

export async function createBranch(payload: BranchPayload, branchId = "") {
  return requestJson<{ branch: BranchProfile }>("/api/v1/branches", {
    method: "POST",
    headers: branchHeaders(branchId),
    body: JSON.stringify(payload)
  });
}

export async function updateBranch(branchId: string, payload: Partial<BranchPayload>) {
  return requestJson<{ branch: BranchProfile }>(`/api/v1/branches/${branchId}`, {
    method: "PATCH",
    headers: branchHeaders(branchId),
    body: JSON.stringify(payload)
  });
}

export async function createTerminal(payload: TerminalPayload) {
  return requestJson<{ terminal: TerminalDevice }>("/api/v1/branches/terminals", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateTerminal(terminalId: string, payload: Partial<TerminalPayload>, branchId = payload.branchId ?? "") {
  return requestJson<{ terminal: TerminalDevice }>(`/api/v1/branches/terminals/${terminalId}`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function fetchSyncQueue(branchId = "", status = "all", terminalId = "", userId = "") {
  const params = new URLSearchParams({ branchId, status });
  if (terminalId) params.set("terminalId", terminalId);
  return requestJson<{ records: SyncQueueRecord[] }>(`/api/v1/sync/queue?${params.toString()}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function queueSyncRecord(payload: SyncQueuePayload, userId = "") {
  return requestJson<{ record: SyncQueueRecord; status: "created" | "replayed" }>("/api/v1/sync/queue", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateSyncRecordStatus(recordId: string, status: Exclude<SyncRecordStatus, "processing">, serverEntityId?: string, error?: string, branchId = "", userId = "") {
  return requestJson<{ record: SyncQueueRecord }>(`/api/v1/sync/queue/${recordId}/status`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ status, serverEntityId, error })
  });
}

export async function createCatalogProduct(payload: ProductPayload, userId = "") {
  return requestJson<{ product: Product }>("/api/v1/catalog/products", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateCatalogProduct(productId: string, payload: Partial<ProductPayload>, branchId = payload.branchId ?? "", userId = "") {
  return requestJson<{ product: Product }>(`/api/v1/catalog/products/${productId}`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function createSale(payload: CreateSalePayload) {
  return requestJson<CreateSaleResponse>("/api/v1/sales", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchSales(branchId = "", status = "all", userId = "") {
  const params = new URLSearchParams({ branchId, status });
  return requestJson<{ sales: CompletedSale[] }>(`/api/v1/sales?${params.toString()}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function voidSale(saleId: string, reason: string, branchId = "", userId = "") {
  return requestJson<{ sale: CompletedSale }>(`/api/v1/sales/${saleId}/void`, {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ reason })
  });
}

export async function refundSale(saleId: string, amount: number, reason: string, branchId = "", userId = "") {
  return requestJson<{ sale: CompletedSale }>(`/api/v1/sales/${saleId}/refund`, {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ amount, reason })
  });
}

export async function queueReceiptDelivery(saleId: string, channel: "print" | "whatsapp", branchId = "", userId = "") {
  return requestJson<{ delivery: { saleId: string; channel: "print" | "whatsapp"; status: "queued"; queuedAt: string } }>(
    `/api/v1/sales/${saleId}/receipt-actions`,
    {
      method: "POST",
      headers: { "x-branch-id": branchId },
      body: JSON.stringify({ channel })
    }
  );
}

export async function fetchCurrentRegister(branchId = "", terminalId = "") {
  const params = new URLSearchParams({ branchId, terminalId });
  return requestJson<{ shift: RegisterShift | null; payments: PaymentRecord[]; movements: CashMovement[] }>(
    `/api/v1/registers/current?${params.toString()}`,
    { headers: branchHeaders(branchId) }
  );
}

export async function openRegisterShift(payload: OpenRegisterPayload, userId = "") {
  return requestJson<{ shift: RegisterShift }>("/api/v1/registers/open", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function createCashMovement(payload: CashMovementPayload, branchId = "", userId = "") {
  return requestJson<{ shift: RegisterShift; movement: CashMovement }>("/api/v1/registers/cash-movements", {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function reconcilePayment(paymentId: string, note = "Matched with processor settlement", branchId = "", userId = "") {
  return requestJson<{ payment: PaymentRecord }>(`/api/v1/registers/payments/${paymentId}/reconcile`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ note })
  });
}

export async function closeRegisterShift(payload: CloseRegisterPayload, branchId = "", userId = "") {
  return requestJson<{ shift: RegisterShift }>("/api/v1/registers/close", {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function fetchExpenses(branchId = "", status = "all", userId = "") {
  return requestJson<{ expenses: Expense[] }>(`/api/v1/expenses?branchId=${branchId}&status=${status}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function createExpense(payload: ExpensePayload, userId = "") {
  return requestJson<{ expense: Expense }>("/api/v1/expenses", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateExpenseStatus(
  expenseId: string,
  status: Extract<ExpenseStatus, "approved" | "paid" | "rejected" | "voided">,
  note?: string,
  branchId = "",
  userId = ""
) {
  return requestJson<{ expense: Expense }>(`/api/v1/expenses/${expenseId}/status`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ status, note })
  });
}

export async function fetchInventoryStock(branchId = "", userId = "") {
  return requestJson<{ products: Product[]; movements: StockMovement[] }>(`/api/v1/inventory/stock?branchId=${branchId}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function fetchSuppliers(branchId = "", userId = "") {
  return requestJson<{ suppliers: Supplier[] }>(`/api/v1/inventory/suppliers?branchId=${branchId}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function createSupplier(payload: SupplierPayload, userId = "") {
  return requestJson<{ supplier: Supplier }>("/api/v1/inventory/suppliers", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function receivePurchase(payload: PurchaseReceiptPayload, userId = "") {
  return requestJson<{ product: Product; movement: StockMovement; supplier: Supplier }>("/api/v1/inventory/purchase-receipts", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function createStockAdjustment(payload: StockAdjustmentPayload, userId = "") {
  return requestJson<{ product: Product; movement: StockMovement }>("/api/v1/inventory/adjustments", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function createStockCount(payload: StockCountPayload, userId = "") {
  return requestJson<{ products: Product[]; movements: StockMovement[] }>("/api/v1/inventory/counts", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function fetchRestaurantTables(branchId = "", userId = "") {
  return requestJson<{ tables: RestaurantTable[]; openOrders: TableOrder[]; reservations: TableReservation[] }>(`/api/v1/restaurant/tables?branchId=${branchId}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function openTableOrder(payload: OpenTableOrderPayload, branchId = "") {
  return requestJson<{ table: RestaurantTable; order: TableOrder }>("/api/v1/restaurant/table-orders", {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function addTableOrderItem(orderId: string, payload: TableOrderItemPayload, branchId = "", userId = "") {
  return requestJson<{ order: TableOrder; item: TableOrderItem; prepTicket: PrepTicket }>(`/api/v1/restaurant/table-orders/${orderId}/items`, {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function removeTableOrderItem(orderId: string, itemId: string, branchId = "", userId = "") {
  return requestJson<{ order: TableOrder; prepTicket?: PrepTicket }>(`/api/v1/restaurant/table-orders/${orderId}/items/${itemId}`, {
    method: "DELETE",
    headers: { "x-branch-id": branchId }
  });
}

export async function requestTableBill(orderId: string, note = "Bill requested", branchId = "", userId = "") {
  return requestJson<{ table: RestaurantTable; order: TableOrder }>(`/api/v1/restaurant/table-orders/${orderId}/bill`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ note })
  });
}

export async function updateTableState(tableId: string, state: RestaurantTableState, reason: string, branchId = "", userId = "") {
  return requestJson<{ table: RestaurantTable }>(`/api/v1/restaurant/tables/${tableId}/state`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ state, reason })
  });
}

export async function updateTableLayout(tableId: string, payload: TableLayoutPayload, branchId = "", userId = "") {
  return requestJson<{ table: RestaurantTable }>(`/api/v1/restaurant/tables/${tableId}/layout`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function createTableReservation(payload: TableReservationPayload, userId = "") {
  return requestJson<{ table: RestaurantTable; reservation: TableReservation }>("/api/v1/restaurant/reservations", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function fetchPrepTickets(branchId = "", station: PrepStation | "All" = "All", userId = "") {
  return requestJson<{ tickets: PrepTicket[] }>(`/api/v1/kitchen/tickets?branchId=${branchId}&station=${station}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function updatePrepTicketStatus(ticketId: string, status: PrepTicketStatus, note?: string, branchId = "", userId = "", station: PrepStation | "All" = "Kitchen") {
  return requestJson<{ ticket: PrepTicket }>(`/api/v1/kitchen/tickets/${ticketId}/status`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ status, note })
  });
}

export async function updatePrepTicketItemStatus(ticketId: string, itemId: string, status: Exclude<PrepTicketStatus, "served" | "cancelled">, note?: string, branchId = "", userId = "", station: PrepStation | "All" = "Kitchen") {
  return requestJson<{ ticket: PrepTicket }>(`/api/v1/kitchen/tickets/${ticketId}/items/${itemId}/status`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ status, note })
  });
}

export async function fetchCustomers(query = "") {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  return requestJson<{ customers: Customer[] }>(`/api/v1/customers${params}`);
}

export async function createCustomer(payload: CustomerPayload, branchId = "", userId = "") {
  return requestJson<{ customer: Customer }>("/api/v1/customers", {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateCustomer(customerId: string, payload: Partial<CustomerPayload>, branchId = "", userId = "") {
  return requestJson<{ customer: Customer }>(`/api/v1/customers/${customerId}`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function postCustomerLedger(customerId: string, payload: CustomerLedgerPayload, branchId = "", userId = "") {
  return requestJson<{ customer: Customer; entry: CustomerLedgerEntry }>(`/api/v1/customers/${customerId}/ledger`, {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function fetchCustomerLedger(customerId: string, branchId = "", userId = "") {
  return requestJson<{ entries: CustomerLedgerEntry[] }>(`/api/v1/customers/${customerId}/ledger`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function fetchStaff(branchId = "", userId = "") {
  return requestJson<{ staff: StaffMember[] }>(`/api/v1/staff?branchId=${branchId}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function fetchRoles() {
  return requestJson<{ roles: AccessRole[]; permissions: AccessPermission[] }>("/api/v1/roles");
}

export async function fetchRoleOptions() {
  return requestJson<{ roles: AccessRole[] }>("/api/v1/roles/options");
}

export async function createRole(payload: RolePayload) {
  return requestJson<{ role: AccessRole }>("/api/v1/roles", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateRole(roleId: string, payload: Partial<RolePayload>) {
  return requestJson<{ role: AccessRole }>(`/api/v1/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function updateRolePermissions(roleId: string, permissions: string[]) {
  return requestJson<{ role: AccessRole }>(`/api/v1/roles/${roleId}/permissions`, {
    method: "PATCH",
    body: JSON.stringify({ permissions })
  });
}

export async function assignStaffRole(staffId: string, role: string, branchId = "") {
  return requestJson<{ status: "assigned"; staffId: string; role: string }>("/api/v1/roles/assign-staff", {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ staffId, role })
  });
}

export async function loginWithPassword(payload: { tenantId: string; email: string; password: string; terminalId?: string }) {
  return requestPublicJson<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function loginWithPin(payload: { tenantId: string; branchId: string; terminalId: string; staffId: string; pin: string }) {
  return requestPublicJson<AuthResponse>("/api/v1/auth/pin-login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function refreshAuth(refreshToken: string) {
  return requestPublicJson<AuthResponse>("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken })
  });
}

export async function logoutAuthSession() {
  return requestJson<{ session: AuthSession }>("/api/v1/auth/logout", {
    method: "POST"
  });
}

export async function fetchAuthSessions(userId = "", branchId = "") {
  return requestJson<{ sessions: AuthSession[] }>("/api/v1/auth/sessions", {
    headers: { "x-branch-id": branchId }
  });
}

export async function revokeAuthSession(sessionId: string, userId = "", branchId = "") {
  return requestJson<{ session: AuthSession }>(`/api/v1/auth/sessions/${sessionId}/revoke`, {
    method: "POST",
    headers: { "x-branch-id": branchId }
  });
}

export async function createStaff(payload: StaffPayload, userId = "") {
  return requestJson<{ staff: StaffMember }>("/api/v1/staff", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateStaff(staffId: string, payload: Partial<StaffPayload>, branchId = payload.branchId ?? "", userId = "") {
  return requestJson<{ staff: StaffMember }>(`/api/v1/staff/${staffId}`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify(payload)
  });
}

export async function updateStaffStatus(staffId: string, active: boolean, reason: string, branchId = "", userId = "") {
  return requestJson<{ staff: StaffMember }>(`/api/v1/staff/${staffId}/status`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ active, reason })
  });
}

export async function resendStaffInvite(staffId: string, branchId = "", userId = "") {
  return requestJson<{ staff: StaffMember }>(`/api/v1/staff/${staffId}/invite/resend`, {
    method: "POST",
    headers: { "x-branch-id": branchId }
  });
}

export async function revokeStaffInvite(staffId: string, branchId = "", userId = "") {
  return requestJson<{ staff: StaffMember }>(`/api/v1/staff/${staffId}/invite/revoke`, {
    method: "POST",
    headers: { "x-branch-id": branchId }
  });
}

export async function fetchAuditEvents(userId = "", branchId = "") {
  return requestJson<{ events: AuditEvent[] }>("/api/v1/audit", {
    headers: { "x-branch-id": branchId }
  });
}

export async function fetchApprovals(status = "all", type = "all", branchId = "", userId = "") {
  return requestJson<{ approvals: ApprovalRequest[] }>(`/api/v1/approvals?branchId=${branchId}&status=${status}&type=${type}`, {
    headers: { "x-branch-id": branchId }
  });
}

export async function createApproval(payload: ApprovalPayload) {
  return requestJson<{ approval: ApprovalRequest }>("/api/v1/approvals", {
    method: "POST",
    headers: { "x-branch-id": payload.branchId },
    body: JSON.stringify(payload)
  });
}

export async function decideApproval(approvalId: string, decision: "approved" | "rejected", note: string, branchId = "", userId = "") {
  return requestJson<{ approval: ApprovalRequest }>(`/api/v1/approvals/${approvalId}/decision`, {
    method: "PATCH",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ decision, note })
  });
}

export async function applyApproval(approvalId: string, entityType: string, entityId: string, type: ApprovalType, amount: number, note: string, userId = "", branchId = "") {
  return requestJson<{ approval: ApprovalRequest }>(`/api/v1/approvals/${approvalId}/apply`, {
    method: "POST",
    headers: { "x-branch-id": branchId },
    body: JSON.stringify({ entityType, entityId, type, amount, note })
  });
}
