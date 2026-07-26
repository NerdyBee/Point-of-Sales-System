export interface TenantScoped {
  tenantId: string;
  branchId?: string;
}

export type PermissionAction =
  | "sale.create"
  | "sale.refund"
  | "sale.void"
  | "catalog.manage"
  | "inventory.adjust"
  | "restaurant.manage"
  | "kitchen.manage"
  | "customer.manage"
  | "staff.manage"
  | "branch.manage"
  | "register.manage"
  | "register.close"
  | "expense.manage"
  | "subscription.manage"
  | "sync.manage"
  | "approval.manage"
  | "audit.view"
  | "reports.profit.view"
  | "settings.manage"
  | "roles.manage";
