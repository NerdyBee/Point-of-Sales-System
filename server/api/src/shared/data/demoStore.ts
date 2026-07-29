import type { PermissionAction } from "@pos/types";
import { createHash } from "node:crypto";

export function demoSecretHash(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

export interface DemoTenant {
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

export interface BranchProfile {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  status: "active" | "paused";
  createdAt: string;
}

export interface TerminalDevice {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  deviceCode: string;
  status: "online" | "offline" | "maintenance";
  appVersion: string;
  lastSeenAt?: string;
  createdAt: string;
}

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

export interface DemoProduct {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  cost: number;
  taxRate: number;
  image: string;
  stock: number;
  reorderPoint: number;
  station: "Kitchen" | "Bar" | "Counter";
  modifiers: string[];
}

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

export interface PurchaseOrderLine {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
  total: number;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  orderNumber: string;
  status: "draft" | "pending_approval" | "approved" | "partially_received" | "received" | "cancelled";
  expectedAt?: string;
  lines: PurchaseOrderLine[];
  subtotal: number;
  note?: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInvoicePayment {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string;
  paidAt: string;
  note?: string;
  createdBy: string;
}

export interface SupplierInvoiceCredit {
  id: string;
  supplierReturnId: string;
  amount: number;
  reference: string;
  creditedAt: string;
  createdBy: string;
}

export interface SupplierInvoice {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  status: "open" | "partially_paid" | "paid" | "voided";
  invoiceDate: string;
  dueDate?: string;
  amount: number;
  amountPaid: number;
  creditTotal: number;
  balanceDue: number;
  payments: SupplierInvoicePayment[];
  credits: SupplierInvoiceCredit[];
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierReturn {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  supplierInvoiceId?: string;
  quantity: number;
  unitCost: number;
  creditAmount: number;
  reference: string;
  reason: string;
  returnedAt: string;
  createdBy: string;
  createdAt: string;
}

export interface InventoryTransfer {
  id: string;
  tenantId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  sourceProductId: string;
  destinationProductId: string;
  productName: string;
  quantity: number;
  reference: string;
  note: string;
  sourceMovementId: string;
  destinationMovementId: string;
  createdBy: string;
  createdAt: string;
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
  station: PrepStation;
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

export type PrepTicketStatus = "new" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
export type PrepStation = "Kitchen" | "Bar" | "Counter";

export interface PrepTicketItem {
  id: string;
  productId?: string;
  sourceTableItemId?: string;
  productName: string;
  quantity: number;
  modifiers: string[];
  note?: string;
  status: PrepTicketStatus;
}

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
  items: PrepTicketItem[];
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

export interface CustomerLedgerEntry {
  id: string;
  tenantId: string;
  branchId: string;
  customerId: string;
  type: "credit_sale" | "payment" | "loyalty_adjustment" | "voucher";
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
  passwordHash?: string;
  pinHash?: string;
  pinEnabled: boolean;
  active: boolean;
  salesTotal: number;
  inviteStatus: "pending" | "accepted" | "revoked" | "expired";
  invitedAt?: string;
  invitedBy?: string;
  inviteExpiresAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  tenantId: string;
  staffId: string;
  branchId?: string;
  terminalId?: string;
  role: StaffRole;
  refreshTokenHash: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "mobile_money" | "customer_credit" | "voucher";

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
  method: PaymentMethod;
  amount: number;
  reference?: string;
  reconciliationStatus: "pending" | "matched";
  createdAt: string;
}

export interface CompletedSaleLine {
  productId: string;
  name: string;
  quantity: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
}

export interface CompletedSaleSummary {
  lines: CompletedSaleLine[];
  subtotal: number;
  discount: number;
  serviceCharge: number;
  vat: number;
  total: number;
  paid: number;
  balance: number;
}

export interface CompletedSale {
  id: string;
  tenantId: string;
  branchId: string;
  terminalId: string;
  shiftId: string;
  cashierId: string;
  customerId?: string;
  tableId?: string;
  tableOrderId?: string;
  idempotencyKey: string;
  summary: CompletedSaleSummary;
  status: "completed" | "voided" | "refunded" | "partially_refunded";
  refundTotal: number;
  receipt: {
    businessName: string;
    taxId?: string;
    currency: TenantSettings["currency"];
    footer: string;
    whatsappEnabled: boolean;
    printerName?: string;
    printEnabled: boolean;
  };
  voidReason?: string;
  refundReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  branchId: string;
  shiftId: string;
  type: "cash_in" | "cash_out" | "paid_in" | "paid_out";
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  tenantId: string;
  branchId: string;
  category: string;
  description: string;
  vendor?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  status: "draft" | "pending_approval" | "approved" | "paid" | "rejected" | "voided";
  spentAt: string;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  branchId: string;
  type: "discount" | "void" | "refund" | "cash_movement" | "register_close" | "stock_adjustment" | "customer_credit" | "expense";
  entityType: string;
  entityId: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "applied";
  requestedBy: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  branchId?: string;
  userId: string;
  action:
    | PermissionAction
    | "tenant.view"
    | "tenant.settings_updated"
    | "tenant.product_category_renamed"
    | "catalog.view"
    | "product.created"
    | "product.updated"
    | "supplier.created"
    | "purchase_order.created"
    | "purchase_order.status_changed"
    | "supplier_invoice.created"
    | "supplier_invoice.payment_recorded"
    | "supplier_return.created"
    | "inventory.transfer_created"
    | "inventory.count_posted"
    | "inventory.purchase_received"
    | "inventory.sale_stock_issued"
    | "inventory.sale_stock_returned"
    | "sale.created"
    | "sale.replayed"
    | "sale.voided"
    | "sale.refunded"
    | "receipt.print_queued"
    | "receipt.whatsapp_queued"
    | "table.created"
    | "table.order_opened"
    | "table.item_added"
    | "table.item_removed"
    | "table.bill_requested"
    | "table.order_transferred"
    | "table.reservation_created"
    | "table.reservation_status_changed"
    | "table.layout_updated"
    | "table.state_changed"
    | "prep_ticket.created"
    | "prep_ticket.status_changed"
    | "prep_ticket.item_status_changed"
    | "prep_ticket.priority_changed"
    | "customer.created"
    | "customer.updated"
    | "customer.ledger_posted"
    | "staff.created"
    | "staff.updated"
    | "staff.status_changed"
    | "staff.invite_resent"
    | "staff.invite_revoked"
    | "role.created"
    | "role.updated"
    | "role.permissions_updated"
    | "staff.role_assigned"
    | "auth.login"
    | "auth.login_failed"
    | "auth.pin_login"
    | "auth.pin_login_failed"
    | "auth.refresh"
    | "auth.session_revoked"
    | "branch.created"
    | "branch.updated"
    | "terminal.created"
    | "terminal.updated"
    | "approval.requested"
    | "approval.approved"
    | "approval.rejected"
    | "approval.applied"
    | "register.opened"
    | "register.cash_movement"
    | "register.payment_reconciled"
    | "register.closed"
    | "expense.created"
    | "expense.updated"
    | "expense.approved"
    | "expense.paid"
    | "expense.rejected"
    | "expense.voided"
    | "subscription.updated"
    | "subscription.invoice_updated"
    | "sync.record_queued"
    | "sync.record_updated"
    | "payment.recorded";
  entityType: string;
  entityId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export const demoTenants: DemoTenant[] = [
  {
    id: "tenant-lagos-foods",
    name: "Lagos Central Foods",
    plan: "Professional",
    branchLimit: 8,
    activeBranches: 3,
    settings: {
      businessName: "Lagos Central Foods",
      taxId: "TIN-1029384756",
      defaultBranchId: "branch-lagos-main",
      defaultTaxRate: 0.075,
      serviceChargeEnabled: true,
      serviceChargeRate: 0.05,
      currency: "NGN",
      productCategories: ["Meals", "Drinks", "Bakery", "Retail", "Pharmacy", "Services"],
      receiptFooter: "Thank you for choosing Lagos Central.",
      whatsappReceipts: true,
      paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
      hardware: { printer: "Epson TM-T20III", cashDrawer: true, barcodeScanner: true }
    }
  },
  {
    id: "tenant-abuja-pharma",
    name: "Abuja Health Mart",
    plan: "Business",
    branchLimit: 3,
    activeBranches: 1,
    settings: {
      businessName: "Abuja Health Mart",
      taxId: "TIN-5647382910",
      defaultBranchId: "branch-abuja-main",
      defaultTaxRate: 0,
      serviceChargeEnabled: false,
      serviceChargeRate: 0,
      currency: "NGN",
      productCategories: ["Pharmacy", "Retail", "Services"],
      receiptFooter: "Get well soon.",
      whatsappReceipts: false,
      paymentMethods: { cash: true, card: true, bankTransfer: false, mobileMoney: false },
      hardware: { printer: "Generic 80mm Thermal", cashDrawer: true, barcodeScanner: true }
    }
  }
];

export const tenantSubscriptions: TenantSubscription[] = [
  {
    id: "sub-lagos-foods",
    tenantId: "tenant-lagos-foods",
    plan: "Professional",
    status: "active",
    billingEmail: "accounts@lagoscentral.example",
    amount: 45000,
    interval: "monthly",
    branchLimit: 8,
    userLimit: 45,
    terminalLimit: 12,
    storageGb: 50,
    renewalDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 18).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "sub-abuja-pharma",
    tenantId: "tenant-abuja-pharma",
    plan: "Business",
    status: "grace_period",
    billingEmail: "owner@abujahealth.example",
    amount: 25000,
    interval: "monthly",
    branchLimit: 3,
    userLimit: 18,
    terminalLimit: 5,
    storageGb: 20,
    renewalDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    graceEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 4).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export const subscriptionInvoices: SubscriptionInvoice[] = [
  {
    id: "sub-inv-1",
    tenantId: "tenant-lagos-foods",
    invoiceNumber: "SUB-1001",
    plan: "Professional",
    amount: 45000,
    currency: "NGN",
    status: "paid",
    issuedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 42).toISOString(),
    dueAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 35).toISOString(),
    paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 34).toISOString(),
    paymentReference: "PAYSTACK-SUB-1001",
    createdAt: new Date().toISOString()
  },
  {
    id: "sub-inv-2",
    tenantId: "tenant-lagos-foods",
    invoiceNumber: "SUB-1002",
    plan: "Professional",
    amount: 45000,
    currency: "NGN",
    status: "open",
    issuedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "sub-inv-3",
    tenantId: "tenant-abuja-pharma",
    invoiceNumber: "SUB-2001",
    plan: "Business",
    amount: 25000,
    currency: "NGN",
    status: "overdue",
    issuedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 17).toISOString(),
    dueAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    createdAt: new Date().toISOString()
  }
];

export const branches: BranchProfile[] = [
  {
    id: "branch-lagos-main",
    tenantId: "tenant-lagos-foods",
    name: "Main Branch",
    address: "12 Admiralty Way",
    city: "Lagos",
    phone: "+2348010000000",
    status: "active",
    createdAt: new Date().toISOString()
  },
  {
    id: "branch-lagos-ikeja",
    tenantId: "tenant-lagos-foods",
    name: "Ikeja Express",
    address: "18 Allen Avenue",
    city: "Lagos",
    phone: "+2348010000001",
    status: "active",
    createdAt: new Date().toISOString()
  },
  {
    id: "branch-lagos-lekki",
    tenantId: "tenant-lagos-foods",
    name: "Lekki Waterfront",
    address: "4 Admiralty Road",
    city: "Lagos",
    phone: "+2348010000002",
    status: "paused",
    createdAt: new Date().toISOString()
  },
  {
    id: "branch-abuja-main",
    tenantId: "tenant-abuja-pharma",
    name: "Abuja Main Branch",
    address: "23 Aminu Kano Crescent",
    city: "Abuja",
    phone: "+2348020000000",
    status: "active",
    createdAt: new Date().toISOString()
  }
];

export const syncQueueRecords: SyncQueueRecord[] = [
  {
    id: "sync-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    terminalId: "terminal-web-1",
    recordType: "sale",
    operation: "create",
    idempotencyKey: "terminal-web-1-offline-demo-1",
    payload: { lines: 2, total: 21300, source: "offline terminal" },
    status: "queued",
    attempts: 0,
    createdBy: "LCF-MAI-MUS",
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString()
  },
  {
    id: "sync-2",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    terminalId: "terminal-web-1",
    recordType: "payment",
    operation: "create",
    idempotencyKey: "terminal-web-1-payment-conflict-1",
    payload: { saleId: "INV-00012", method: "bank_transfer", amount: 12500 },
    status: "conflict",
    attempts: 2,
    error: "Server already has a newer payment state",
    lastAttemptAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    createdBy: "LCF-MAI-MUS",
    createdAt: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString()
  },
  {
    id: "sync-3",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    terminalId: "terminal-web-1",
    recordType: "receipt_action",
    operation: "create",
    idempotencyKey: "terminal-web-1-print-retry-1",
    payload: { saleId: "INV-00011", channel: "print" },
    status: "failed",
    attempts: 1,
    error: "Printer service unavailable during reconnect",
    lastAttemptAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    createdBy: "LCF-MAI-MUS",
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString()
  }
];

export const terminals: TerminalDevice[] = [
  {
    id: "terminal-web-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Front Counter",
    deviceCode: "LAG-MAIN-01",
    status: "online",
    appVersion: "1.0.0",
    lastSeenAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "terminal-web-2",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Terrace POS",
    deviceCode: "LAG-MAIN-02",
    status: "offline",
    appVersion: "1.0.0",
    lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "terminal-ikeja-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-ikeja",
    name: "Ikeja Counter",
    deviceCode: "LAG-IKEJA-01",
    status: "maintenance",
    appVersion: "0.9.8",
    lastSeenAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  }
];

export const demoProducts: DemoProduct[] = [
  {
    id: "p1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Signature Jollof Rice",
    sku: "MEAL-JOLLOF",
    barcode: "2341000001",
    category: "Meals",
    price: 8500,
    cost: 3800,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=600&q=80",
    stock: 42,
    reorderPoint: 10,
    station: "Kitchen",
    modifiers: ["Extra plantain", "No pepper", "Grilled chicken"]
  },
  {
    id: "p2",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Wagyu Beef Burger",
    sku: "MEAL-BURGER",
    barcode: "2341000002",
    category: "Meals",
    price: 12500,
    cost: 6200,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80",
    stock: 18,
    reorderPoint: 8,
    station: "Kitchen",
    modifiers: ["Extra cheese", "No onions", "Double patty"]
  },
  {
    id: "p3",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Passion Mojito",
    sku: "BAR-MOJITO",
    barcode: "2341000003",
    category: "Drinks",
    price: 4200,
    cost: 1500,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1560512823-829485b8bf24?auto=format&fit=crop&w=600&q=80",
    stock: 64,
    reorderPoint: 15,
    station: "Bar",
    modifiers: ["Extra ice", "No sugar", "Mocktail"]
  },
  {
    id: "p4",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Suya Chicken Skewers",
    sku: "MEAL-SUYA-CHICKEN",
    barcode: "2341000004",
    category: "Meals",
    price: 7200,
    cost: 3100,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=600&q=80",
    stock: 34,
    reorderPoint: 10,
    station: "Kitchen",
    modifiers: ["Extra yaji", "No onions", "Add plantain"]
  },
  {
    id: "p5",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Seafood Okra Bowl",
    sku: "MEAL-SEAFOOD-OKRA",
    barcode: "2341000005",
    category: "Meals",
    price: 14500,
    cost: 7600,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80",
    stock: 16,
    reorderPoint: 6,
    station: "Kitchen",
    modifiers: ["Pounded yam", "Eba", "Extra fish"]
  },
  {
    id: "p6",
    tenantId: "tenant-abuja-pharma",
    branchId: "branch-abuja-main",
    name: "Malaria Test Kit",
    sku: "PHA-MAL-KIT",
    barcode: "2341000006",
    category: "Pharmacy",
    price: 3200,
    cost: 2100,
    taxRate: 0,
    image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=600&q=80",
    stock: 31,
    reorderPoint: 12,
    station: "Counter",
    modifiers: []
  },
  {
    id: "p7",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Ofada Rice and Ayamase",
    sku: "MEAL-OFADA",
    barcode: "2341000007",
    category: "Meals",
    price: 9800,
    cost: 4400,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=80",
    stock: 28,
    reorderPoint: 8,
    station: "Kitchen",
    modifiers: ["Extra sauce", "Boiled egg", "No offal"]
  },
  {
    id: "p8",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Grilled Croaker Platter",
    sku: "MEAL-CROAKER",
    barcode: "2341000008",
    category: "Meals",
    price: 18500,
    cost: 9800,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1505576399279-565b52d4ac71?auto=format&fit=crop&w=600&q=80",
    stock: 12,
    reorderPoint: 5,
    station: "Kitchen",
    modifiers: ["Chips", "Jollof side", "Pepper sauce"]
  },
  {
    id: "p9",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Moi Moi Parcel",
    sku: "MEAL-MOI-MOI",
    barcode: "2341000009",
    category: "Meals",
    price: 2600,
    cost: 900,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=600&q=80",
    stock: 55,
    reorderPoint: 20,
    station: "Kitchen",
    modifiers: ["With egg", "With fish", "No pepper"]
  },
  {
    id: "p10",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Peppered Goat Meat",
    sku: "MEAL-GOAT-PEPPER",
    barcode: "2341000010",
    category: "Meals",
    price: 11000,
    cost: 5800,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80",
    stock: 22,
    reorderPoint: 7,
    station: "Kitchen",
    modifiers: ["Extra pepper", "Mild", "Add chips"]
  },
  {
    id: "p11",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Chapman Pitcher",
    sku: "BAR-CHAPMAN-PITCHER",
    barcode: "2341000011",
    category: "Drinks",
    price: 6000,
    cost: 2300,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=600&q=80",
    stock: 40,
    reorderPoint: 12,
    station: "Bar",
    modifiers: ["Less sugar", "Extra bitters", "No cucumber"]
  },
  {
    id: "p12",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Zobo Cooler",
    sku: "BAR-ZOBO",
    barcode: "2341000012",
    category: "Drinks",
    price: 2500,
    cost: 800,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=600&q=80",
    stock: 70,
    reorderPoint: 18,
    station: "Bar",
    modifiers: ["Ginger", "Pineapple", "No sugar"]
  },
  {
    id: "p13",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Tiger Nut Milk",
    sku: "BAR-TIGERNUT",
    barcode: "2341000013",
    category: "Drinks",
    price: 3000,
    cost: 1100,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=600&q=80",
    stock: 46,
    reorderPoint: 14,
    station: "Bar",
    modifiers: ["Date sweetened", "Coconut", "Chilled"]
  },
  {
    id: "p14",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Espresso Double",
    sku: "BAR-ESPRESSO-DBL",
    barcode: "2341000014",
    category: "Drinks",
    price: 2800,
    cost: 700,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80",
    stock: 85,
    reorderPoint: 20,
    station: "Bar",
    modifiers: ["Single shot", "Oat milk", "Iced"]
  },
  {
    id: "p15",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Fresh Orange Juice",
    sku: "BAR-ORANGE-JUICE",
    barcode: "2341000015",
    category: "Drinks",
    price: 3500,
    cost: 1300,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&w=600&q=80",
    stock: 38,
    reorderPoint: 10,
    station: "Bar",
    modifiers: ["No ice", "Extra ginger", "Large cup"]
  },
  {
    id: "p16",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Butter Croissant",
    sku: "BAK-CROISSANT",
    barcode: "2341000016",
    category: "Bakery",
    price: 2200,
    cost: 850,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80",
    stock: 60,
    reorderPoint: 18,
    station: "Counter",
    modifiers: ["Warm it", "Add butter", "Chocolate dip"]
  },
  {
    id: "p17",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Meat Pie",
    sku: "BAK-MEAT-PIE",
    barcode: "2341000017",
    category: "Bakery",
    price: 1800,
    cost: 650,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80",
    stock: 48,
    reorderPoint: 16,
    station: "Counter",
    modifiers: ["Warm it", "Extra filling", "Takeaway pack"]
  },
  {
    id: "p18",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Banana Bread Slice",
    sku: "BAK-BANANA-BREAD",
    barcode: "2341000018",
    category: "Bakery",
    price: 1600,
    cost: 500,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1605286978633-2dec93ff88a2?auto=format&fit=crop&w=600&q=80",
    stock: 36,
    reorderPoint: 12,
    station: "Counter",
    modifiers: ["Toast", "Add honey", "No nuts"]
  },
  {
    id: "p19",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Chocolate Muffin",
    sku: "BAK-CHOC-MUFFIN",
    barcode: "2341000019",
    category: "Bakery",
    price: 1900,
    cost: 620,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1607958996333-41aef7caefaa?auto=format&fit=crop&w=600&q=80",
    stock: 32,
    reorderPoint: 10,
    station: "Counter",
    modifiers: ["Warm it", "Extra chocolate", "Cream side"]
  },
  {
    id: "p20",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Sourdough Loaf",
    sku: "BAK-SOURDOUGH",
    barcode: "2341000020",
    category: "Bakery",
    price: 4200,
    cost: 1600,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80",
    stock: 20,
    reorderPoint: 8,
    station: "Counter",
    modifiers: ["Sliced", "Unsliced", "Seeded"]
  },
  {
    id: "p21",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Bottled Water Pack",
    sku: "RTL-WATER-PACK",
    barcode: "2341000021",
    category: "Retail",
    price: 1800,
    cost: 900,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1564419320461-6870880221ad?auto=format&fit=crop&w=600&q=80",
    stock: 120,
    reorderPoint: 30,
    station: "Counter",
    modifiers: ["Room temp", "Chilled"]
  },
  {
    id: "p22",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Plantain Chips Jar",
    sku: "RTL-PLANTAIN-CHIPS",
    barcode: "2341000022",
    category: "Retail",
    price: 2400,
    cost: 1000,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1599490659213-e2b9527bd087?auto=format&fit=crop&w=600&q=80",
    stock: 52,
    reorderPoint: 15,
    station: "Counter",
    modifiers: ["Sweet", "Spicy", "Mixed"]
  },
  {
    id: "p23",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Groundnut Pack",
    sku: "RTL-GROUNDNUT",
    barcode: "2341000023",
    category: "Retail",
    price: 1500,
    cost: 620,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1556761223-4c4282c73f77?auto=format&fit=crop&w=600&q=80",
    stock: 68,
    reorderPoint: 20,
    station: "Counter",
    modifiers: ["Salted", "Unsalted", "Spicy"]
  },
  {
    id: "p24",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "House Spice Rub",
    sku: "RTL-SPICE-RUB",
    barcode: "2341000024",
    category: "Retail",
    price: 3800,
    cost: 1500,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1532336414038-cf19250c5757?auto=format&fit=crop&w=600&q=80",
    stock: 24,
    reorderPoint: 8,
    station: "Counter",
    modifiers: ["Mild", "Hot", "Gift wrap"]
  },
  {
    id: "p25",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Signature Apron",
    sku: "RTL-APRON",
    barcode: "2341000025",
    category: "Retail",
    price: 7500,
    cost: 3300,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80",
    stock: 14,
    reorderPoint: 5,
    station: "Counter",
    modifiers: ["Black", "Green", "White"]
  },
  {
    id: "p26",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Paracetamol Tablets",
    sku: "PHA-PARACETAMOL",
    barcode: "2341000026",
    category: "Pharmacy",
    price: 1200,
    cost: 550,
    taxRate: 0,
    image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=600&q=80",
    stock: 90,
    reorderPoint: 25,
    station: "Counter",
    modifiers: []
  },
  {
    id: "p27",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "ORS Sachet",
    sku: "PHA-ORS",
    barcode: "2341000027",
    category: "Pharmacy",
    price: 900,
    cost: 300,
    taxRate: 0,
    image: "https://images.unsplash.com/photo-1576602976047-174e57a47881?auto=format&fit=crop&w=600&q=80",
    stock: 75,
    reorderPoint: 24,
    station: "Counter",
    modifiers: []
  },
  {
    id: "p28",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Table Service Charge",
    sku: "SVC-TABLE-SERVICE",
    barcode: "2341000028",
    category: "Services",
    price: 1500,
    cost: 0,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=600&q=80",
    stock: 0,
    reorderPoint: 0,
    station: "Counter",
    modifiers: ["Standard", "Premium"]
  },
  {
    id: "p29",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Event Catering Deposit",
    sku: "SVC-CATERING-DEPOSIT",
    barcode: "2341000029",
    category: "Services",
    price: 50000,
    cost: 0,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1519671282429-b44660ead0a7?auto=format&fit=crop&w=600&q=80",
    stock: 0,
    reorderPoint: 0,
    station: "Counter",
    modifiers: ["Indoor", "Outdoor", "Corporate"]
  },
  {
    id: "p30",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Delivery Fee",
    sku: "SVC-DELIVERY",
    barcode: "2341000030",
    category: "Services",
    price: 2500,
    cost: 0,
    taxRate: 0.075,
    image: "https://images.unsplash.com/photo-1526367790999-0150786686a2?auto=format&fit=crop&w=600&q=80",
    stock: 0,
    reorderPoint: 0,
    station: "Counter",
    modifiers: ["Island", "Mainland", "Express"]
  }
];

export const auditEvents: AuditEvent[] = [];
export const completedSales = new Map<string, { saleId: string; summary: unknown; receipt: CompletedSale["receipt"] }>();
export const saleLedger: CompletedSale[] = [];
export const suppliers: Supplier[] = [
  {
    id: "sup-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Mainland Fresh Foods",
    contactPerson: "Tunde Adebayo",
    phone: "+2348090000001",
    email: "orders@mainlandfresh.example",
    leadTimeDays: 2,
    active: true,
    productIds: ["p1", "p4", "p5", "p7", "p8", "p9", "p10"],
    createdAt: new Date().toISOString()
  },
  {
    id: "sup-2",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Lagos Beverage Depot",
    contactPerson: "Bisi Cole",
    phone: "+2348090000002",
    email: "supply@lagosbeverage.example",
    leadTimeDays: 1,
    active: true,
    productIds: ["p3", "p11", "p12", "p13", "p14", "p15", "p21"],
    createdAt: new Date().toISOString()
  },
  {
    id: "sup-3",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Island Bakery Supply",
    contactPerson: "Ada Nwosu",
    phone: "+2348090000003",
    email: "hello@islandbakery.example",
    leadTimeDays: 3,
    active: true,
    productIds: ["p16", "p17", "p18", "p19", "p20"],
    createdAt: new Date().toISOString()
  },
  {
    id: "sup-4",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Counter Retail Partners",
    contactPerson: "Mariam Okorie",
    phone: "+2348090000004",
    email: "retail@counterpartners.example",
    leadTimeDays: 4,
    active: true,
    productIds: ["p22", "p23", "p24", "p25", "p26", "p27"],
    createdAt: new Date().toISOString()
  },
  {
    id: "sup-5",
    tenantId: "tenant-abuja-pharma",
    branchId: "branch-abuja-main",
    name: "Abuja Medline Supply",
    contactPerson: "Ife Yusuf",
    phone: "+2348090000005",
    email: "orders@abujamedline.example",
    leadTimeDays: 2,
    active: true,
    productIds: ["p6"],
    createdAt: new Date().toISOString()
  }
];
export const purchaseOrders: PurchaseOrder[] = [];
export const supplierInvoices: SupplierInvoice[] = [];
export const supplierReturns: SupplierReturn[] = [];
export const inventoryTransfers: InventoryTransfer[] = [];
export const stockMovements: StockMovement[] = demoProducts
  .filter((product) => product.category.trim().toLowerCase() !== "services")
  .map((product, index) => ({
    id: `move-${index + 1}`,
    tenantId: product.tenantId,
    branchId: product.branchId,
    productId: product.id,
    productName: product.name,
    type: "receipt",
    quantityDelta: product.stock,
    balanceAfter: product.stock,
    reason: "Seed opening stock",
    reference: `SEED-${product.branchId}-${product.sku}`,
    createdAt: new Date().toISOString(),
    createdBy: "system"
  }));
export const restaurantTables: RestaurantTable[] = [
  {
    id: "table-01",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    area: "Main Dining",
    label: "T01",
    seats: 2,
    state: "available",
    guests: 0,
    x: 10,
    y: 15
  },
  {
    id: "table-04",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    area: "Main Dining",
    label: "T04",
    seats: 6,
    state: "occupied",
    guests: 5,
    waiterId: "waiter-1",
    orderId: "table-order-1",
    customerName: "Amina Bello",
    x: 42,
    y: 20,
    openedAt: new Date().toISOString()
  },
  {
    id: "table-08",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    area: "Terrace",
    label: "T08",
    seats: 4,
    state: "awaiting_payment",
    guests: 3,
    waiterId: "waiter-2",
    orderId: "table-order-2",
    x: 68,
    y: 45,
    openedAt: new Date().toISOString()
  },
  {
    id: "table-12",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    area: "Private Room",
    label: "T12",
    seats: 8,
    state: "reserved",
    guests: 0,
    customerName: "Nneka Foods Ltd",
    x: 24,
    y: 62
  }
];
export const tableOrders: TableOrder[] = [
  {
    id: "table-order-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    tableId: "table-04",
    guests: 5,
    waiterId: "waiter-1",
    customerName: "Amina Bello",
    items: [
      { id: "table-item-1", productId: "p2", productName: "Wagyu Beef Burger", station: "Kitchen", quantity: 2, unitPrice: 12500, modifiers: ["Extra cheese"], note: "Medium well" },
      { id: "table-item-2", productId: "p1", productName: "Signature Jollof Rice", station: "Kitchen", quantity: 1, unitPrice: 8500, modifiers: ["Extra plantain"] }
    ],
    prepStatus: "preparing",
    status: "open",
    openedAt: new Date().toISOString()
  },
  {
    id: "table-order-2",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    tableId: "table-08",
    guests: 3,
    waiterId: "waiter-2",
    items: [
      { id: "table-item-3", productId: "p3", productName: "Passion Mojito", station: "Bar", quantity: 3, unitPrice: 4200, modifiers: ["Extra ice"] }
    ],
    prepStatus: "new",
    status: "bill_requested",
    openedAt: new Date().toISOString()
  }
];
export const tableReservations: TableReservation[] = [
  {
    id: "reservation-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    tableId: "table-12",
    tableLabel: "T12",
    customerName: "Nneka Foods Ltd",
    phone: "+2348033333333",
    guests: 6,
    reservedAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    durationMinutes: 120,
    status: "booked",
    note: "Private room preferred",
    createdAt: new Date().toISOString(),
    createdBy: "LCF-MAI-CHI"
  }
];
export const prepTickets: PrepTicket[] = [
  {
    id: "KOT-1088",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    tableOrderId: "table-order-1",
    station: "Kitchen",
    tableLabel: "T04",
    waiterId: "waiter-1",
    serviceType: "dine_in",
    priority: "normal",
    status: "preparing",
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    acceptedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    items: [
      { id: "item-1", productName: "Wagyu Beef Burger", quantity: 2, modifiers: ["Extra cheese", "No onions"], status: "preparing" },
      { id: "item-2", productName: "Signature Jollof Rice", quantity: 1, modifiers: ["Extra plantain"], note: "Mild pepper", status: "preparing" }
    ]
  },
  {
    id: "BOT-1089",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    tableOrderId: "table-order-2",
    station: "Bar",
    tableLabel: "T08",
    waiterId: "waiter-2",
    serviceType: "dine_in",
    priority: "rush",
    status: "new",
    createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    items: [
      { id: "item-3", productName: "Passion Mojito", quantity: 3, modifiers: ["Extra ice"], status: "new" }
    ]
  },
  {
    id: "KOT-1090",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    station: "Counter",
    tableLabel: "Takeaway",
    waiterId: "LCF-MAI-MUS",
    serviceType: "takeaway",
    priority: "normal",
    status: "ready",
    createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    readyAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    items: [
      { id: "item-4", productName: "Butter Croissant", quantity: 6, modifiers: ["Warm it"], status: "ready" }
    ]
  }
];
export const customers: Customer[] = [
  {
    id: "cust-1",
    tenantId: "tenant-lagos-foods",
    name: "Amina Bello",
    phone: "+2348011111111",
    email: "amina@example.com",
    group: "VIP",
    loyaltyPoints: 2480,
    creditLimit: 0,
    outstandingBalance: 0,
    notes: "Prefers terrace seating",
    lastVisitAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "cust-2",
    tenantId: "tenant-lagos-foods",
    name: "Kola Martins",
    phone: "+2348022222222",
    group: "Credit account",
    loyaltyPoints: 920,
    creditLimit: 100000,
    outstandingBalance: 38500,
    notes: "Requires manager approval above limit",
    lastVisitAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "cust-3",
    tenantId: "tenant-lagos-foods",
    name: "Nneka Foods Ltd",
    phone: "+2348033333333",
    email: "orders@nnekafoods.example",
    group: "Wholesale",
    loyaltyPoints: 5200,
    creditLimit: 250000,
    outstandingBalance: 125000,
    notes: "Monthly statement customer",
    lastVisitAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  }
];
export const customerLedger: CustomerLedgerEntry[] = [
  {
    id: "cust-ledger-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    customerId: "cust-2",
    type: "credit_sale",
    amount: 38500,
    pointsDelta: 385,
    balanceAfter: 38500,
    pointsAfter: 920,
    note: "Opening credit sale",
    createdAt: new Date().toISOString(),
    createdBy: "LCF-MAI-CHI"
  }
];
export const staffMembers: StaffMember[] = [
  {
    id: "LCF-MAI-ADA",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Adaeze Okafor",
    email: "adaeze@example.com",
    phone: "+2348033333333",
    role: "owner",
    passwordHash: demoSecretHash("Password123!"),
    pinHash: demoSecretHash("123456"),
    pinEnabled: true,
    active: true,
    salesTotal: 0,
    inviteStatus: "accepted",
    lastSeenAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "LCF-MAI-CHI",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Chinelo Okafor",
    email: "chinelo@example.com",
    phone: "+2348044444444",
    role: "manager",
    passwordHash: demoSecretHash("Password123!"),
    pinHash: demoSecretHash("123456"),
    pinEnabled: true,
    active: true,
    salesTotal: 425000,
    inviteStatus: "accepted",
    lastSeenAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "LCF-MAI-MUS",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Musa Ibrahim",
    email: "musa@example.com",
    phone: "+2348055555555",
    role: "cashier",
    passwordHash: demoSecretHash("Password123!"),
    pinHash: demoSecretHash("123456"),
    pinEnabled: true,
    active: true,
    salesTotal: 318200,
    inviteStatus: "accepted",
    lastSeenAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "LCF-MAI-SAR",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Sarah Johnson",
    email: "sarah@example.com",
    phone: "+2348066666666",
    role: "inventory",
    passwordHash: demoSecretHash("Password123!"),
    pinEnabled: false,
    active: true,
    salesTotal: 284000,
    inviteStatus: "accepted",
    lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "LCF-MAI-TUN",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    name: "Tunde Balogun",
    email: "tunde@example.com",
    phone: "+2348077777777",
    role: "state_manager",
    passwordHash: demoSecretHash("Password123!"),
    pinHash: demoSecretHash("123456"),
    pinEnabled: true,
    active: true,
    salesTotal: 0,
    inviteStatus: "accepted",
    lastSeenAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  }
];

export const authSessions: AuthSession[] = [];
export const registerShifts: RegisterShift[] = [
  {
    id: "shift-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    terminalId: "terminal-web-1",
    cashierId: "LCF-MAI-MUS",
    status: "open",
    openingBalance: 50000,
    expectedCash: 50000,
    openedAt: new Date().toISOString()
  }
];
export const paymentRecords: PaymentRecord[] = [];
export const cashMovements: CashMovement[] = [];
export const expenses: Expense[] = [
  {
    id: "expense-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    category: "Utilities",
    description: "Generator diesel refill",
    vendor: "Mainland Energy Supply",
    amount: 45000,
    paymentMethod: "cash",
    reference: "EXP-DIESEL-001",
    status: "paid",
    spentAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    approvedBy: "LCF-MAI-CHI",
    approvedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    paidAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    note: "Evening operations supply",
    createdBy: "LCF-MAI-CHI",
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "expense-2",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    category: "Repairs",
    description: "Receipt printer maintenance",
    vendor: "POS Hardware Clinic",
    amount: 18000,
    paymentMethod: "bank_transfer",
    reference: "EXP-PRINTER-002",
    status: "approved",
    spentAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    approvedBy: "LCF-MAI-CHI",
    approvedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    note: "Print head cleaning and test roll",
    createdBy: "LCF-MAI-CHI",
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  }
];
export const approvalRequests: ApprovalRequest[] = [
  {
    id: "approval-1",
    tenantId: "tenant-lagos-foods",
    branchId: "branch-lagos-main",
    type: "discount",
    entityType: "saleDraft",
    entityId: "terminal-web-1",
    amount: 62000,
    reason: "Corporate customer discount above cashier threshold",
    status: "pending",
    requestedBy: "LCF-MAI-MUS",
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString()
  }
];

export function appendAudit(event: Omit<AuditEvent, "id" | "createdAt">) {
  const auditEvent: AuditEvent = {
    ...event,
    id: `audit-${auditEvents.length + 1}`,
    createdAt: new Date().toISOString()
  };

  auditEvents.unshift(auditEvent);
  return auditEvent;
}

export function appendStockMovement(event: Omit<StockMovement, "id" | "createdAt">) {
  const movement: StockMovement = {
    ...event,
    id: `move-${stockMovements.length + 1}`,
    createdAt: new Date().toISOString()
  };

  stockMovements.unshift(movement);
  return movement;
}

export function appendCustomerLedger(event: Omit<CustomerLedgerEntry, "id" | "createdAt">) {
  const entry: CustomerLedgerEntry = {
    ...event,
    id: `cust-ledger-${customerLedger.length + 1}`,
    createdAt: new Date().toISOString()
  };

  customerLedger.unshift(entry);
  return entry;
}

export function appendPaymentRecord(event: Omit<PaymentRecord, "id" | "createdAt">) {
  const payment: PaymentRecord = {
    ...event,
    id: `payment-${paymentRecords.length + 1}`,
    createdAt: new Date().toISOString()
  };

  paymentRecords.unshift(payment);
  return payment;
}

export function appendCompletedSale(event: Omit<CompletedSale, "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const sale: CompletedSale = {
    ...event,
    createdAt: now,
    updatedAt: now
  };

  saleLedger.unshift(sale);
  return sale;
}

export function appendCashMovement(event: Omit<CashMovement, "id" | "createdAt">) {
  const movement: CashMovement = {
    ...event,
    id: `cash-move-${cashMovements.length + 1}`,
    createdAt: new Date().toISOString()
  };

  cashMovements.unshift(movement);
  return movement;
}

export function appendApprovalRequest(event: Omit<ApprovalRequest, "id" | "createdAt" | "status">) {
  const approval: ApprovalRequest = {
    ...event,
    id: `approval-${approvalRequests.length + 1}`,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  approvalRequests.unshift(approval);
  return approval;
}
