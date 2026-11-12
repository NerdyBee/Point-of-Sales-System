import {
  BarChart3,
  Building2,
  ChefHat,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileText,
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
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { QuotationsView } from "../modules/quotations/QuotationsView";
import { StaffView } from "../modules/staff/StaffView";
import { SecurityView } from "../modules/security/SecurityView";
import { SetupView } from "../modules/setup/SetupView";
import { LicenseView } from "../modules/license/LicenseView";
import { LICENSE_VENDOR } from "../shared/vendor";
import { SyncMonitorView } from "../modules/sync/SyncMonitorView";
import { SettingsView } from "../modules/settings/SettingsView";
import { clearStoredAuth, fetchBranchOptions, fetchCurrentTenant, fetchLicenseStatus, fetchSetupStatus, licenseRequiredEvent, type LicenseStatus, type SetupStatus, logoutAuthSession, readStoredAuth, refreshAuth, storeAuth, type ApprovalRequest, type AuthResponse, type BranchOption, type Quotation } from "../shared/api/client";

type ModuleKey = "dashboard" | "sales" | "salesHistory" | "quotations" | "reports" | "catalog" | "inventory" | "expenses" | "branches" | "registers" | "floor" | "kitchen" | "customers" | "staff" | "roles" | "profile" | "security" | "sync" | "approvals" | "audit" | "settings";

const navItems = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "reports.profit.view" },
  { key: "sales", label: "POS Terminal", icon: ShoppingCart, permission: "sale.create" },
  { key: "salesHistory", label: "Sales", icon: ReceiptText, permission: "sale.create" },
  { key: "quotations", label: "Quotations", icon: FileText, permission: "sale.create" },
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
  { key: "sync", label: "Sync", icon: RefreshCcw, permission: "sync.manage" },
  { key: "approvals", label: "Approvals", icon: ClipboardCheck, permission: "approval.manage" },
  { key: "audit", label: "Audit", icon: ClipboardList, permission: "audit.view" },
  { key: "settings", label: "Settings", icon: Settings, permission: "settings.manage" }
] satisfies Array<{ key: ModuleKey; label: string; icon: typeof LayoutDashboard; permission: string }>;

const idleSignOutMs = 10 * 60_000;

const modulePermissions = Object.fromEntries(navItems.map((item) => [item.key, item.permission])) as Partial<Record<ModuleKey, string>>;

function firstModuleForPermissions(permissions: string[]) {
  return navItems.find((item) => permissions.includes(item.permission))?.key ?? "profile";
}

export function App() {
  const [activeModule, setActiveModule] = useState<ModuleKey>("dashboard");
  const [terminalTableContext, setTerminalTableContext] = useState<TerminalTableContext | null>(null);
  const [terminalQuotation, setTerminalQuotation] = useState<Quotation | null>(null);
  const [settledTableReceipt, setSettledTableReceipt] = useState<SettledTableReceipt | null>(null);
  const [approvalHandoff, setApprovalHandoff] = useState<ApprovalRequest | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [auth, setAuth] = useState<AuthResponse | null>(() => readStoredAuth());
  // A fresh offline install has no business yet: show the setup page instead of sign-in.
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [businessName, setBusinessName] = useState("");
  // Installed copies must be activated; until then only the activation page is shown.
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const activeBranchId = auth?.session.branchId ?? auth?.staff.branchId ?? "";
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const authModuleKey = auth ? `${auth.staff.id}:${activeBranchId}:${auth.staff.role}:${auth.staff.permissions.join("|")}` : "signed-out";
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
    setAccountMenuOpen(false);
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
    if (!accountMenuOpen) return;

    function closeAccountMenu(event: MouseEvent) {
      if (accountMenuRef.current?.contains(event.target as Node)) return;
      setAccountMenuOpen(false);
    }

    function closeAccountMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }

    document.addEventListener("mousedown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenuOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    const storedAuth = readStoredAuth();
    if (!storedAuth?.refreshToken) return;

    void refreshAuth(storedAuth.refreshToken)
      .then((response) => {
        storeAuth(response);
        handleAuthChange(response);
      })
      .catch(() => {
        clearStoredAuth();
        handleAuthChange(null);
      });
  }, []);

  useEffect(() => {
    if (!auth) return;
    fetchCurrentTenant()
      .then(({ tenant }) => setBusinessName(tenant.settings.businessName || tenant.name))
      .catch(() => undefined);
  }, [auth?.staff.tenantId]);

  useEffect(() => {
    const loadLicense = () => fetchLicenseStatus().then(setLicense).catch(() => undefined);
    void loadLicense();
    window.addEventListener(licenseRequiredEvent, loadLicense);
    return () => window.removeEventListener(licenseRequiredEvent, loadLicense);
  }, []);

  useEffect(() => {
    if (auth || (license?.required && !license.active)) return;
    fetchSetupStatus().then(setSetupStatus).catch(() => setSetupStatus(null));
  }, [auth, license]);

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

  // Sign out after a while without use, like the Android app's till lock, so an unattended
  // computer does not stay open on someone's account. Staff sign back in with their PIN.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  useEffect(() => {
    if (!auth) return;
    let lastActivity = Date.now();
    const markActive = () => {
      lastActivity = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity > idleSignOutMs) void logoutRef.current();
    }, 30_000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, markActive));
      window.clearInterval(timer);
    };
  }, [auth]);

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
      setTerminalQuotation(null);
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
        quotation={terminalQuotation}
        onQuotationDone={() => setTerminalQuotation(null)}
      />
    ),
    quotations: (
      <QuotationsView
        onLoadToTill={(quote) => {
          setTerminalQuotation(quote);
          navigateToModule("sales");
        }}
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

  if (license?.required && !license.active) {
    return (
      <div className="auth-gate">
        <main className="auth-gate-main">
          <LicenseView status={license} onActivated={setLicense} />
        </main>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="auth-gate">
        <main className="auth-gate-main">
          {setupStatus?.needsSetup ? <SetupView local={setupStatus.local} /> : <SecurityView auth={auth} onAuthChange={handleAuthChange} />}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-block">
          <div className="brand-mark">AP</div>
          <div>
            <strong>Ajoke POS</strong>
            <span>Point of sale</span>
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
            <span>{businessName || auth.staff.tenantId}</span>
            <strong>{currentUser.branch || "No branch assigned"}</strong>
          </div>
          <div className="top-actions">
            {canAccess("reports.profit.view") ? <button onClick={() => navigateToModule("dashboard")}><BarChart3 size={18} /> Today</button> : null}
            <div className="user-menu" ref={accountMenuRef}>
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
        {license?.warn ? (
          <div className="license-warning" role="status">
            Your Ajoke POS licence ends on {license.expires} ({license.daysLeft} day{license.daysLeft === 1 ? "" : "s"} left). Send code {license.deviceCode} to {LICENSE_VENDOR.name} to renew.
          </div>
        ) : null}
        <main key={`${displayedModule}:${authModuleKey}`}>{moduleViews[displayedModule]}</main>
      </div>
    </div>
  );
}
