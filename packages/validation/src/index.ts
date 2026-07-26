import { z } from "zod";

export const tenantScopedSchema = z.object({
  tenantId: z.string().min(1),
  branchId: z.string().min(1).optional()
});

export const saleLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  note: z.string().max(280).optional(),
  discount: z.number().min(0).default(0)
});

export const productCategorySchema = z.string().min(2).max(60);
export const preparationStationSchema = z.enum(["Kitchen", "Bar", "Counter"]);

export const productInputSchema = z.object({
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  sku: z.string().min(2).max(40),
  barcode: z.string().min(4).max(40),
  category: productCategorySchema,
  price: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative(),
  taxRate: z.number().min(0).max(1).optional(),
  image: z.string().url().or(z.string().regex(/^\/uploads\/products\/[A-Za-z0-9._-]+$/, "Upload a product image")),
  stock: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative(),
  station: preparationStationSchema,
  modifiers: z.array(z.string().min(1).max(60)).default([])
});

export const stockMovementTypeSchema = z.enum(["receipt", "issue", "adjustment", "transfer", "waste", "count"]);

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().min(1),
  type: stockMovementTypeSchema,
  quantityDelta: z.number().int().refine((value) => value !== 0, "Quantity delta cannot be zero"),
  reason: z.string().min(3).max(160),
  reference: z.string().max(80).optional()
});

export const stockCountSchema = z.object({
  branchId: z.string().min(1),
  reference: z.string().min(2).max(80),
  reason: z.string().min(3).max(160),
  counts: z.array(z.object({
    productId: z.string().min(1),
    countedQuantity: z.number().int().nonnegative()
  })).min(1)
});

export const supplierInputSchema = z.object({
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  contactPerson: z.string().min(2).max(120),
  phone: z.string().min(7).max(24),
  email: z.string().email().optional().or(z.literal("")),
  leadTimeDays: z.number().int().min(0).max(90),
  active: z.boolean().default(true),
  productIds: z.array(z.string().min(1)).min(1)
});

export const supplierReceiptSchema = z.object({
  supplierId: z.string().min(1),
  branchId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  reference: z.string().min(2).max(80),
  note: z.string().min(3).max(160)
});

export const tableStateSchema = z.enum(["available", "occupied", "reserved", "awaiting_payment", "delayed", "unavailable"]);

export const tableOrderInputSchema = z.object({
  tableId: z.string().min(1),
  guests: z.number().int().min(1).max(40),
  waiterId: z.string().min(1),
  customerName: z.string().max(120).optional(),
  specialInstructions: z.string().max(240).optional()
});

export const tableOrderItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  modifiers: z.array(z.string().min(1).max(80)).default([]),
  note: z.string().max(160).optional()
});

export const tableBillRequestSchema = z.object({
  note: z.string().min(3).max(160).optional()
});

export const tableStateUpdateSchema = z.object({
  state: tableStateSchema,
  reason: z.string().min(3).max(160).optional()
});

export const tableLayoutUpdateSchema = z.object({
  area: z.string().min(2).max(80),
  label: z.string().min(1).max(20),
  seats: z.number().int().min(1).max(24),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100)
});

export const tableReservationInputSchema = z.object({
  branchId: z.string().min(1),
  tableId: z.string().min(1),
  customerName: z.string().min(2).max(120),
  phone: z.string().min(7).max(24),
  guests: z.number().int().min(1).max(40),
  reservedAt: z.string().datetime(),
  durationMinutes: z.number().int().min(30).max(360),
  note: z.string().max(240).optional()
});

export const prepTicketStatusSchema = z.enum(["new", "accepted", "preparing", "ready", "served", "cancelled"]);

export const prepTicketStatusUpdateSchema = z.object({
  status: prepTicketStatusSchema,
  note: z.string().max(160).optional()
});

export const prepTicketItemStatusUpdateSchema = z.object({
  status: prepTicketStatusSchema.exclude(["served", "cancelled"]),
  note: z.string().max(160).optional()
});

export const customerGroupSchema = z.enum(["Walk-in", "VIP", "Credit account", "Wholesale", "Staff"]);

export const customerInputSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(7).max(24),
  email: z.string().email().optional().or(z.literal("")),
  group: customerGroupSchema,
  creditLimit: z.number().int().nonnegative(),
  loyaltyPoints: z.number().int().nonnegative().default(0),
  notes: z.string().max(240).optional()
});

export const customerLedgerInputSchema = z.object({
  type: z.enum(["credit_sale", "payment", "loyalty_adjustment", "voucher"]),
  amount: z.number().int(),
  pointsDelta: z.number().int().default(0),
  note: z.string().min(3).max(160)
});

export const staffRoleSchema = z.string().min(2).max(60).regex(/^[a-z][a-z0-9_-]*$/, "Use a lowercase role slug");

export const staffInputSchema = z.object({
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(24),
  role: staffRoleSchema,
  pinEnabled: z.boolean().default(true),
  active: z.boolean().default(true)
});

export const staffStatusSchema = z.object({
  active: z.boolean(),
  reason: z.string().min(3).max(160)
});

export const roleInputSchema = z.object({
  name: z.string().min(2).max(60).regex(/^[a-z][a-z0-9_-]*$/, "Use a lowercase slug, for example floor_manager"),
  label: z.string().min(2).max(120),
  description: z.string().max(240).optional().or(z.literal(""))
});

export const rolePermissionUpdateSchema = z.object({
  permissions: z.array(z.string().min(3).max(80)).default([])
});

export const staffRoleAssignmentSchema = z.object({
  staffId: z.string().min(1).max(80),
  role: z.string().min(2).max(60)
});

export const authLoginSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6).max(120),
  terminalId: z.string().max(80).optional().or(z.literal(""))
});

export const authPinLoginSchema = z.object({
  tenantId: z.string().min(1),
  branchId: z.string().min(1),
  terminalId: z.string().min(1).max(80),
  staffId: z.string().min(1).max(80),
  pin: z.string().min(4).max(12)
});

export const authRefreshSchema = z.object({
  refreshToken: z.string().min(20)
});

export const branchStatusSchema = z.enum(["active", "paused"]);

export const branchInputSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().min(3).max(180),
  city: z.string().min(2).max(80),
  phone: z.string().min(7).max(24),
  status: branchStatusSchema.default("active")
});

export const terminalStatusSchema = z.enum(["online", "offline", "maintenance"]);

export const terminalInputSchema = z.object({
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  deviceCode: z.string().min(3).max(80),
  status: terminalStatusSchema.default("offline"),
  appVersion: z.string().min(1).max(40)
});

export const paymentMethodSchema = z.enum(["cash", "card", "bank_transfer", "mobile_money", "customer_credit", "voucher"]);

export const expenseStatusSchema = z.enum(["draft", "pending_approval", "approved", "paid", "rejected", "voided"]);

export const expenseInputSchema = z.object({
  branchId: z.string().min(1),
  category: z.string().min(2).max(80),
  description: z.string().min(3).max(180),
  vendor: z.string().max(120).optional().or(z.literal("")),
  amount: z.number().int().positive(),
  paymentMethod: z.enum(["cash", "card", "bank_transfer", "mobile_money", "customer_credit", "voucher"]),
  reference: z.string().max(100).optional().or(z.literal("")),
  spentAt: z.string().datetime(),
  status: expenseStatusSchema.default("draft"),
  note: z.string().max(240).optional().or(z.literal(""))
});

export const openRegisterShiftSchema = z.object({
  branchId: z.string().min(1),
  terminalId: z.string().min(1),
  openingBalance: z.number().int().nonnegative()
});

export const cashMovementSchema = z.object({
  shiftId: z.string().min(1),
  type: z.enum(["cash_in", "cash_out", "paid_in", "paid_out"]),
  amount: z.number().int().positive(),
  reason: z.string().min(3).max(160)
});

export const paymentReconciliationSchema = z.object({
  note: z.string().min(3).max(160).optional()
});

export const closeRegisterShiftSchema = z.object({
  shiftId: z.string().min(1),
  countedCash: z.number().int().nonnegative(),
  managerNote: z.string().min(3).max(160).optional()
});

export const saleActionSchema = z.object({
  reason: z.string().min(3).max(160)
});

export const saleRefundSchema = saleActionSchema.extend({
  amount: z.number().int().positive()
});

export const saleReceiptActionSchema = z.object({
  channel: z.enum(["print", "whatsapp"])
});

export const approvalRequestSchema = z.object({
  branchId: z.string().min(1),
  type: z.enum(["discount", "void", "refund", "cash_movement", "register_close", "stock_adjustment", "customer_credit", "expense"]),
  entityType: z.string().min(2).max(60),
  entityId: z.string().min(1).max(80),
  amount: z.number().int().nonnegative().default(0),
  reason: z.string().min(3).max(180),
  requestedBy: z.string().min(1).max(80).optional()
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().min(3).max(180)
});

export const approvalApplySchema = z.object({
  entityType: z.string().min(2).max(60),
  entityId: z.string().min(1).max(80),
  type: z.enum(["discount", "void", "refund", "cash_movement", "register_close", "stock_adjustment", "customer_credit", "expense"]),
  amount: z.number().int().nonnegative().default(0),
  note: z.string().min(3).max(180)
});

export const tenantSettingsSchema = z.object({
  businessName: z.string().min(2).max(120),
  taxId: z.string().max(40).optional(),
  defaultBranchId: z.string().min(1),
  defaultTaxRate: z.number().min(0).max(1),
  serviceChargeEnabled: z.boolean().default(true),
  serviceChargeRate: z.number().min(0).max(1).default(0.05),
  currency: z.enum(["NGN", "USD", "GHS", "KES", "ZAR"]),
  productCategories: z.array(productCategorySchema).min(1),
  receiptFooter: z.string().max(180),
  whatsappReceipts: z.boolean(),
  paymentMethods: z.object({
    cash: z.boolean(),
    card: z.boolean(),
    bankTransfer: z.boolean(),
    mobileMoney: z.boolean()
  }),
  hardware: z.object({
    printer: z.string().max(80),
    cashDrawer: z.boolean(),
    barcodeScanner: z.boolean()
  })
}).refine((settings) => Object.values(settings.paymentMethods).some(Boolean), {
  message: "At least one payment method must be enabled",
  path: ["paymentMethods"]
}).refine((settings) => new Set(settings.productCategories.map((category) => category.toLowerCase())).size === settings.productCategories.length, {
  message: "Product categories must be unique",
  path: ["productCategories"]
});

export const productCategoryRenameSchema = z.object({
  from: productCategorySchema,
  to: productCategorySchema
}).refine((payload) => payload.from.toLowerCase() !== payload.to.toLowerCase(), {
  message: "Choose a different category name",
  path: ["to"]
});

export const subscriptionPlanSchema = z.enum(["Free Trial", "Starter", "Business", "Professional", "Enterprise"]);
export const subscriptionStatusSchema = z.enum(["trialing", "active", "past_due", "grace_period", "restricted", "cancelled"]);

export const subscriptionUpdateSchema = z.object({
  plan: subscriptionPlanSchema,
  status: subscriptionStatusSchema,
  billingEmail: z.string().email(),
  renewalDate: z.string().datetime(),
  graceEndsAt: z.string().datetime().optional().or(z.literal("")),
  notes: z.string().max(240).optional().or(z.literal(""))
});

export const subscriptionInvoiceStatusSchema = z.enum(["draft", "open", "paid", "void", "overdue"]);

export const subscriptionInvoiceUpdateSchema = z.object({
  status: subscriptionInvoiceStatusSchema,
  paymentReference: z.string().max(100).optional().or(z.literal(""))
});

export const syncRecordStatusSchema = z.enum(["queued", "processing", "synced", "failed", "conflict"]);
export const syncRecordTypeSchema = z.enum(["sale", "table_order", "payment", "cash_movement", "stock_adjustment", "receipt_action"]);

export const syncQueueInputSchema = z.object({
  branchId: z.string().min(1),
  terminalId: z.string().min(1).max(80),
  recordType: syncRecordTypeSchema,
  operation: z.enum(["create", "update", "delete"]),
  idempotencyKey: z.string().min(8).max(180),
  payload: z.record(z.string(), z.unknown())
});

export const syncQueueStatusSchema = z.object({
  status: z.enum(["queued", "synced", "failed", "conflict"]),
  serverEntityId: z.string().max(80).optional().or(z.literal("")),
  error: z.string().max(240).optional().or(z.literal(""))
});
