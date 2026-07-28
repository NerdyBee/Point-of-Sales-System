import {
  BarChart3,
  BadgeDollarSign,
  Building2,
  ChefHat,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  LogOut,
  LayoutDashboard,
  ChevronDown,
  PackageSearch,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  RefreshCcw,
  KeyRound,
  LockKeyhole,
  UserRound,
  Store,
  Table2,
  Users,
  WalletCards
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AuditLogView } from "../modules/audit/AuditLogView";
import { ApprovalsView } from "../modules/approvals/ApprovalsView";
import { BranchesView } from "../modules/branches/BranchesView";
import { CatalogView } from "../modules/catalog/CatalogView";
import { CustomersView } from "../modules/customers/CustomersView";
import { ExpensesView } from "../modules/expenses/ExpensesView";
import { InventoryView } from "../modules/inventory/InventoryView";
import { KitchenDisplay } from "../modules/kitchen/KitchenDisplay";
import { RegisterView } from "../modules/registers/RegisterView";
import { ProfileView } from "../modules/profile/ProfileView";
import { Dashboard } from "../modules/reports/Dashboard";
import { ReportsView } from "../modules/reports/ReportsView";
import { RolesView } from "../modules/roles/RolesView";
import { FloorPlanView } from "../modules/restaurant/FloorPlanView";
import { SalesTerminal, type SettledTableReceipt, type TerminalTableContext } from "../modules/sales/SalesTerminal";
import { SalesHistoryView } from "../modules/sales/SalesHistoryView";
import { StaffView } from "../modules/staff/StaffView";
import { SecurityView } from "../modules/security/SecurityView";
import { SubscriptionsView } from "../modules/subscriptions/SubscriptionsView";
import { SyncMonitorView } from "../modules/sync/SyncMonitorView";
import { SettingsView } from "../modules/settings/SettingsView";
import { clearStoredAuth, fetchBranchOptions, logoutAuthSession, readStoredAuth, refreshAuth, storeAuth, type ApprovalRequest, type AuthResponse, type BranchOption } from "../shared/api/client";

type ModuleKey = "dashboard" | "sales" | "salesHistory" | "reports" | "catalog" | "inventory" | "expenses" | "branches" | "registers" | "floor" | "kitchen" | "customers" | "staff" | "roles" | "profile" | "security" | "subscriptions" | "sync" | "approvals" | "audit" | "settings";

const navItems = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "reports.profit.view" },
  { key: "sales", label: "POS Terminal", icon: ShoppingCart, permission: "sale.create" },
  { key: "salesHistory", label: "Sales", icon: ReceiptText, permission: "sale.create" },
  { key: "reports", label: "Reports", icon: FileBarChart, permission: "reports.profit.view" },
  { key: "catalog", label: "Catalog", icon: Store, permission: "catalog.manage" },
  { key: "inventory", label: "Inventory", icon: PackageSearch, permission: "inventory.adjust" },
  { key: "expenses", label: "Expenses", icon: CircleDollarSign, permission: "expense.manage" },
  { key: "branches", label: "Branches", icon: Building2, permission: "branch.manage" },
  { key: "registers", label: "Register", icon: WalletCards, permission: "register.manage" },
  { key: "floor", label: "Floor", icon: Table2, permission: "restaurant.manage" },
  { key: "kitchen", label: "Kitchen", icon: ChefHat, permission: "kitchen.manage" },
  { key: "customers", label: "Customers", icon: Users, permission: "customer.manage" },
  { key: "staff", label: "Staff", icon: ShieldCheck, permission: "staff.manage" },
  { key: "roles", label: "Roles", icon: LockKeyhole, permission: "roles.manage" },
  { key: "security", label: "Security", icon: KeyRound, permission: "staff.manage" },
  { key: "subscriptions", label: "Subscriptions", icon: BadgeDollarSign, permission: "subscription.manage" },
  { key: "sync", label: "Sync", icon: RefreshCcw, permission: "sync.manage" },
  { key: "approvals", label: "Approvals", icon: ClipboardCheck, permission: "approval.manage" },
  { key: "audit", label: "Audit", icon: ClipboardList, permission: "audit.view" },
  { key: "settings", label: "Settings", icon: Settings, permission: "settings.manage" }
] satisfies Array<{ key: ModuleKey; label: string; icon: typeof LayoutDashboard; permission: string }>;

const modulePermissions = Object.fromEntries(navItems.map((item) => [item.key, item.permission])) as Partial<Record<ModuleKey, string>>;

function firstModuleForPermissions(permissions: string[]) {
  return navItems.find((item) => permissions.includes(item.permission))?.key ?? "profile";
}

export function App() {
  const [activeModule, setActiveModule] = useState<ModuleKey>("dashboard");
  const [terminalTableContext, setTerminalTableContext] = useState<TerminalTableContext | null>(null);
  const [settledTableReceipt, setSettledTableReceipt] = useState<SettledTableReceipt | null>(null);
  const [approvalHandoff, setApprovalHandoff] = useState<ApprovalRequest | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [auth, setAuth] = useState<AuthResponse | null>(() => readStoredAuth());
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const activeBranchId = auth?.session.branchId ?? auth?.staff.branchId ?? "";
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const currentUser = { name: auth?.staff.name ?? "", role: auth?.staff.role ?? "", email: auth?.staff.email ?? "", phone: auth?.staff.phone ?? "", branch: activeBranch?.name ?? activeBranchId };
  const currentUserInitials = currentUser.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function handleAuthChange(nextAuth: AuthResponse | null) {
    setAuth(nextAuth);
    setAccountMenuOpen(false);
    if (nextAuth && activeModule === "security") setActiveModule(firstModuleForPermissions(nextAuth.staff.permissions));
    if (!nextAuth) setActiveModule("security");
  }

  function canAccess(permission?: string) {
    return !permission || (auth?.staff.permissions.includes(permission) ?? false);
  }

  const permittedNavItems = navItems.filter((item) => canAccess(item.permission));
  const firstPermittedModule = permittedNavItems[0]?.key ?? "profile";
  const displayedModule = auth && activeModule !== "profile" && !canAccess(modulePermissions[activeModule]) ? firstPermittedModule : activeModule;

  function navigateToModule(module: ModuleKey) {
    if (module === "profile" || canAccess(modulePermissions[module])) {
      setActiveModule(module);
      return;
    }

    setActiveModule(firstPermittedModule);
  }

  useEffect(() => {
    function syncAuth(event: Event) {
      handleAuthChange((event as CustomEvent<AuthResponse | null>).detail ?? readStoredAuth());
    }

    window.addEventListener("naijapos-auth-changed", syncAuth);
    return () => window.removeEventListener("naijapos-auth-changed", syncAuth);
  }, []);

  useEffect(() => {
    const storedAuth = readStoredAuth();
    if (!storedAuth?.refreshToken) return;

    void refreshAuth(storedAuth.refreshToken)
      .then((response) => {
        storeAuth(response);
        handleAuthChange(response);
      })
      .catch(() => clearStoredAuth());
  }, []);

  useEffect(() => {
    if (!auth) return;
    if (displayedModule === activeModule) return;
    setActiveModule(displayedModule);
  }, [activeModule, displayedModule]);

  useEffect(() => {
    if (activeModule === "profile") return;
    if (canAccess(modulePermissions[activeModule])) return;
    setActiveModule(firstPermittedModule);
  }, [activeModule, auth, firstPermittedModule]);

  useEffect(() => {
    if (!auth) {
      setBranches([]);
      return;
    }

    let mounted = true;
    fetchBranchOptions()
      .then((response) => {
        if (mounted) setBranches(response.branches);
      })
      .catch(() => {
        if (mounted) setBranches([]);
      });

    return () => {
      mounted = false;
    };
  }, [auth?.session.id]);

  function sendTableToPos(context: TerminalTableContext) {
    setTerminalTableContext(context);
    navigateToModule("sales");
  }

  async function logout() {
    try {
      if (auth) await logoutAuthSession();
    } catch {
      // Local logout should still succeed if the server is offline.
    } finally {
      clearStoredAuth();
      handleAuthChange(null);
      setApprovalHandoff(null);
      setTerminalTableContext(null);
      setSettledTableReceipt(null);
      setAccountMenuOpen(false);
    }
  }

  function openModuleFromAccount(module: ModuleKey) {
    navigateToModule(module);
    setAccountMenuOpen(false);
  }

  const moduleViews: Record<ModuleKey, ReactNode> = {
    dashboard: (
      <Dashboard
        onNewSale={() => navigateToModule("sales")}
        onOpenApprovals={() => navigateToModule("approvals")}
        onOpenAudit={() => navigateToModule("audit")}
        onOpenInventory={() => navigateToModule("inventory")}
        onOpenRegisters={() => navigateToModule("registers")}
      />
    ),
    sales: (
      <SalesTerminal
        tableContext={terminalTableContext}
        onClearTableContext={() => setTerminalTableContext(null)}
        onTableSettled={(receipt) => {
          setSettledTableReceipt(receipt);
          setTerminalTableContext(null);
        }}
        approvalHandoff={approvalHandoff}
        onApprovalHandoffConsumed={() => setApprovalHandoff(null)}
      />
    ),
    salesHistory: <SalesHistoryView approvalHandoff={approvalHandoff} onApprovalHandoffConsumed={() => setApprovalHandoff(null)} />,
    reports: <ReportsView />,
    catalog: <CatalogView />,
    inventory: <InventoryView approvalHandoff={approvalHandoff} onApprovalHandoffConsumed={() => setApprovalHandoff(null)} />,
    expenses: <ExpensesView approvalHandoff={approvalHandoff} onApprovalHandoffConsumed={() => setApprovalHandoff(null)} />,
    branches: <BranchesView />,
    registers: <RegisterView approvalHandoff={approvalHandoff} onApprovalHandoffConsumed={() => setApprovalHandoff(null)} />,
    floor: <FloorPlanView onSendToPos={sendTableToPos} settledReceipt={settledTableReceipt} onSettledReceiptSeen={() => setSettledTableReceipt(null)} />,
    kitchen: <KitchenDisplay />,
    customers: <CustomersView approvalHandoff={approvalHandoff} onApprovalHandoffConsumed={() => setApprovalHandoff(null)} />,
    staff: <StaffView />,
    roles: <RolesView />,
    profile: <ProfileView user={currentUser} />,
    security: <SecurityView auth={auth} onAuthChange={handleAuthChange} />,
    subscriptions: <SubscriptionsView />,
    sync: <SyncMonitorView />,
    approvals: (
      <ApprovalsView
        onOpenSource={(module, approval) => {
          setApprovalHandoff(approval);
          navigateToModule(module);
        }}
      />
    ),
    audit: <AuditLogView />,
    settings: <SettingsView />
  };

  if (!auth) {
    return (
      <div className="auth-gate">
        <main className="auth-gate-main">
          <SecurityView auth={auth} onAuthChange={handleAuthChange} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-block">
          <div className="brand-mark">NP</div>
          <div>
            <strong>NaijaPOS</strong>
            <span>Multi-tenant SaaS</span>
          </div>
        </div>
        <nav aria-label="Main modules">
          {permittedNavItems.map(({ key, label, icon: Icon }) => (
            <button className={displayedModule === key ? "nav-active" : ""} key={key} onClick={() => navigateToModule(key)}>
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="top-bar">
          <div>
            <span>{auth.staff.tenantId}</span>
            <strong>{currentUser.branch || "No branch assigned"}</strong>
          </div>
          <div className="top-actions">
            {canAccess("reports.profit.view") ? <button onClick={() => navigateToModule("dashboard")}><BarChart3 size={18} /> Today</button> : null}
            <div className="user-menu">
              <button
                className="user-menu-trigger"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                aria-label="Current user account"
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                <span className="avatar">{currentUserInitials}</span>
                <span>
                  <strong>{currentUser.name}</strong>
                  <small>{currentUser.role}</small>
                </span>
                <ChevronDown size={16} />
              </button>
              {accountMenuOpen ? (
                <div className="account-dropdown" role="menu">
                  <div className="account-dropdown-header">
                    <span className="avatar">{currentUserInitials}</span>
                    <div>
                      <strong>{currentUser.name}</strong>
                      <small>{currentUser.email}</small>
                    </div>
                  </div>
                  {auth ? <button role="menuitem" onClick={() => openModuleFromAccount("profile")}><UserRound size={16} /> Profile</button> : null}
                  {canAccess("staff.manage") ? <button role="menuitem" onClick={() => openModuleFromAccount("security")}><KeyRound size={16} /> Security</button> : null}
                  {auth ? <button className="logout-button" role="menuitem" onClick={logout}><LogOut size={16} /> Logout</button> : null}
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main>{moduleViews[displayedModule]}</main>
      </div>
    </div>
  );
}
