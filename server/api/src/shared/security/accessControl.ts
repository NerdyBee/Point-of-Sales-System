import type { PermissionAction } from "@pos/types";

export const permissionCatalog: Array<{ action: PermissionAction; label: string; group: string; description: string }> = [
  { action: "sale.create", label: "Create sales", group: "Sales", description: "Create POS sales and receipt actions" },
  { action: "sale.refund", label: "Refund sales", group: "Sales", description: "Refund completed sales" },
  { action: "sale.void", label: "Void sales", group: "Sales", description: "Void completed sales" },
  { action: "catalog.manage", label: "Manage catalog", group: "Catalog", description: "Create and update products and categories" },
  { action: "inventory.adjust", label: "Adjust inventory", group: "Inventory", description: "Receive, count, and adjust stock" },
  { action: "restaurant.manage", label: "Manage restaurant", group: "Restaurant", description: "Manage tables, orders, and reservations" },
  { action: "kitchen.manage", label: "Manage kitchen", group: "Kitchen", description: "Update preparation tickets" },
  { action: "customer.manage", label: "Manage customers", group: "Customers", description: "Create customers and ledger entries" },
  { action: "staff.manage", label: "Manage staff", group: "Staff", description: "Invite, update, and deactivate staff" },
  { action: "roles.manage", label: "Manage roles", group: "Staff", description: "Create roles and assign permissions" },
  { action: "branch.manage", label: "Manage branches", group: "Branches", description: "Create branches and provision terminals" },
  { action: "register.manage", label: "Manage registers", group: "Register", description: "Open registers and reconcile payments" },
  { action: "register.close", label: "Close registers", group: "Register", description: "Close register shifts" },
  { action: "expense.manage", label: "Manage expenses", group: "Finance", description: "Create and approve expenses" },
  { action: "subscription.manage", label: "Manage subscription", group: "Administration", description: "Control SaaS plan and billing" },
  { action: "sync.manage", label: "Manage sync", group: "Administration", description: "View and resolve offline sync queue" },
  { action: "approval.manage", label: "Manage approvals", group: "Administration", description: "Approve or reject sensitive actions" },
  { action: "audit.view", label: "View audit log", group: "Administration", description: "Inspect audit events" },
  { action: "reports.profit.view", label: "View profit reports", group: "Reports", description: "View profit, cost, and margin reporting" },
  { action: "settings.manage", label: "Manage settings", group: "Settings", description: "Update tenant settings and tax controls" }
];

export const permissionsByRole: Record<string, PermissionAction[]> = {
  owner: permissionCatalog.map((permission) => permission.action),
  state_manager: ["sale.create", "sale.refund", "sale.void", "catalog.manage", "inventory.adjust", "restaurant.manage", "kitchen.manage", "customer.manage", "staff.manage", "branch.manage", "register.manage", "register.close", "expense.manage", "sync.manage", "approval.manage", "audit.view", "reports.profit.view"],
  manager: ["sale.create", "sale.refund", "sale.void", "catalog.manage", "inventory.adjust", "restaurant.manage", "kitchen.manage", "customer.manage", "staff.manage", "branch.manage", "register.manage", "register.close", "expense.manage", "sync.manage", "approval.manage", "audit.view", "reports.profit.view"],
  waiter: ["sale.create", "restaurant.manage"],
  kitchen: ["kitchen.manage"],
  bar: ["kitchen.manage"],
  cashier: ["sale.create", "register.manage"],
  teller: ["sale.create", "register.manage"],
  inventory: ["inventory.adjust"],
  accountant: ["expense.manage", "reports.profit.view"],
  auditor: ["audit.view", "reports.profit.view"]
};

export function fallbackPermissionsForRole(role: string) {
  return permissionsByRole[role] ?? [];
}
