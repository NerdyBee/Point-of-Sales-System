import { Building2, Check, CreditCard, Pencil, Plus, Printer, ReceiptText, RefreshCcw, Search, Tag, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchBranchOptions, fetchCatalogProducts, fetchCurrentTenant, readStoredAuth, renameProductCategory, updateTenantSettings, type BranchOption, type TenantProfile, type TenantSettings } from "../../shared/api/client";
import { notifyTenantSettingsUpdated } from "../../shared/hooks/useTenantSettings";
import { formatMoney } from "../../shared/utils/money";

const emptySettings: TenantSettings = {
  businessName: "",
  taxId: "",
  defaultBranchId: "",
  defaultTaxRate: 0,
  serviceChargeEnabled: false,
  serviceChargeRate: 0,
  currency: "NGN",
  productCategories: [],
  receiptFooter: "",
  whatsappReceipts: false,
  paymentMethods: { cash: true, card: false, bankTransfer: false, mobileMoney: false },
  hardware: { printer: "", cashDrawer: false, barcodeScanner: false }
};

const emptyBranches: BranchOption[] = [];
const paymentMethodLabels: Record<keyof TenantSettings["paymentMethods"], string> = {
  cash: "Cash",
  card: "Card",
  bankTransfer: "Bank transfer",
  mobileMoney: "Mobile money"
};

function decimalToPercent(rate: number) {
  return Math.round(rate * 10000) / 100;
}

function percentToDecimal(percent: string) {
  const numericPercent = Number(percent);
  return Number.isFinite(numericPercent) ? Math.max(0, Math.min(100, numericPercent)) / 100 : 0;
}

function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function SettingsView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const activeBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const [tenant, setTenant] = useState<TenantProfile | null>(null);
  const [settings, setSettings] = useState<TenantSettings>(emptySettings);
  const [branches, setBranches] = useState<BranchOption[]>(emptyBranches);
  const [categoryUsage, setCategoryUsage] = useState<Record<string, number>>({});
  const [newCategory, setNewCategory] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [renameCategory, setRenameCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [status, setStatus] = useState("Ready");

  const enabledPaymentCount = useMemo(() => Object.values(settings.paymentMethods).filter(Boolean).length, [settings.paymentMethods]);
  const hasEnabledPaymentMethod = enabledPaymentCount > 0;
  const categoryCount = settings.productCategories.length;
  const filteredCategories = useMemo(() => {
    const normalizedQuery = categoryQuery.trim().toLowerCase();
    return settings.productCategories.filter((category) => {
      const usage = categoryUsage[category] ?? 0;
      return !normalizedQuery || `${category} ${usage} items`.toLowerCase().includes(normalizedQuery);
    });
  }, [categoryQuery, categoryUsage, settings.productCategories]);

  async function loadSettings() {
    setStatus("Syncing settings...");

    try {
      const [response, catalogResponse, branchResponse] = await Promise.all([
        fetchCurrentTenant(activeUserId, activeBranchId),
        fetchCatalogProducts(),
        fetchBranchOptions()
      ]);
      const nextUsage = catalogResponse.products.reduce<Record<string, number>>((usage, product) => {
        usage[product.category] = (usage[product.category] ?? 0) + 1;
        return usage;
      }, {});
      setTenant(response.tenant);
      setSettings({ ...emptySettings, ...response.tenant.settings });
      setBranches(branchResponse.branches);
      setCategoryUsage(nextUsage);
      setStatus("Settings synced");
    } catch (error) {
      setTenant(null);
      setSettings(emptySettings);
      setBranches(emptyBranches);
      setCategoryUsage({});
      setStatus(error instanceof Error ? error.message : "Unable to load settings");
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  function updateSetting<K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updatePaymentMethod<K extends keyof TenantSettings["paymentMethods"]>(key: K, value: boolean) {
    setSettings((current) => ({
      ...current,
      paymentMethods: { ...current.paymentMethods, [key]: value }
    }));
  }

  function updateHardware<K extends keyof TenantSettings["hardware"]>(key: K, value: TenantSettings["hardware"][K]) {
    setSettings((current) => ({
      ...current,
      hardware: { ...current.hardware, [key]: value }
    }));
  }

  function updateRateFromPercent(key: "defaultTaxRate" | "serviceChargeRate", value: string) {
    updateSetting(key, percentToDecimal(value));
  }

  function addProductCategory() {
    const nextCategory = normalizeCategoryName(newCategory);

    if (!nextCategory) {
      setStatus("Enter a category name");
      return;
    }

    if (settings.productCategories.some((category) => category.toLowerCase() === nextCategory.toLowerCase())) {
      setStatus("Category already exists");
      return;
    }

    setSettings((current) => ({
      ...current,
      productCategories: [...current.productCategories, nextCategory]
    }));
    setNewCategory("");
    setStatus("Category added");
  }

  function removeProductCategory(category: string) {
    if ((categoryUsage[category] ?? 0) > 0) {
      setStatus(`${category} is used by ${categoryUsage[category]} products`);
      return;
    }

    if (settings.productCategories.length <= 1) {
      setStatus("Keep at least one product category");
      return;
    }

    setSettings((current) => ({
      ...current,
      productCategories: current.productCategories.filter((item) => item !== category)
    }));
    setStatus("Category removed");
  }

  function openRenameCategory(category: string) {
    setRenameCategory(category);
    setRenameValue(category);
  }

  function closeRenameCategory() {
    setRenameCategory(null);
    setRenameValue("");
  }

  async function submitRenameCategory(event: FormEvent) {
    event.preventDefault();

    if (!renameCategory) return;

    const nextCategory = normalizeCategoryName(renameValue);

    if (!nextCategory) {
      setStatus("Enter a category name");
      return;
    }

    if (
      nextCategory.toLowerCase() !== renameCategory.toLowerCase() &&
      settings.productCategories.some((category) => category.toLowerCase() === nextCategory.toLowerCase())
    ) {
      setStatus("Category already exists");
      return;
    }

    const branchId = settings.defaultBranchId || activeBranchId;

    if (!branchId) {
      setStatus("Select a default branch before renaming categories");
      return;
    }

    setStatus("Renaming category...");

    try {
      const response = await renameProductCategory(renameCategory, nextCategory, activeUserId, branchId);
      setTenant(response.tenant);
      setSettings(response.tenant.settings);
      setCategoryUsage((current) => {
        const nextUsage = { ...current };
        nextUsage[response.tenant.settings.productCategories.find((category) => category.toLowerCase() === nextCategory.toLowerCase()) ?? nextCategory] = nextUsage[renameCategory] ?? 0;
        delete nextUsage[renameCategory];
        return nextUsage;
      });
      notifyTenantSettingsUpdated();
      setStatus(`Category renamed across ${response.updatedProductCount} products`);
      closeRenameCategory();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to rename category");
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();

    if (!hasEnabledPaymentMethod) {
      setStatus("Enable at least one payment method before saving");
      return;
    }

    if (!settings.defaultBranchId && !activeBranchId) {
      setStatus("Select a default branch before saving settings");
      return;
    }

    setStatus("Saving settings...");

    try {
      const response = await updateTenantSettings(settings, activeUserId, settings.defaultBranchId || activeBranchId);
      setTenant(response.tenant);
      setSettings(response.tenant.settings);
      notifyTenantSettingsUpdated();
      setStatus("Settings saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save settings");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Business configuration</p>
          <h1>Settings</h1>
        </div>
        <div className="button-group">
          <button className="secondary-button" onClick={loadSettings}><RefreshCcw size={18} /> Sync</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Plan</span><Building2 size={20} /></div>
          <strong>{tenant?.plan ?? "Not loaded"}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Branches</span></div>
          <strong>{tenant ? `${tenant.activeBranches}/${tenant.branchLimit}` : "0/0"}</strong>
          <small>Active branch capacity</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Payments</span><CreditCard size={20} /></div>
          <strong>{enabledPaymentCount}</strong>
          <small>Enabled methods</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Categories</span><Tag size={20} /></div>
          <strong>{categoryCount}</strong>
          <small>{Object.values(categoryUsage).reduce((sum, count) => sum + count, 0)} assigned products</small>
        </article>
      </section>

      <form className="settings-workflow" onSubmit={saveSettings}>
        <section className="panel">
          <div className="panel-header">
            <h2>Tenant profile</h2>
            <Building2 size={20} />
          </div>
          <div className="settings-form">
            <label>
              Business name
              <input value={settings.businessName} onChange={(event) => updateSetting("businessName", event.target.value)} required />
            </label>
            <label>
              Tax ID
              <input value={settings.taxId ?? ""} onChange={(event) => updateSetting("taxId", event.target.value)} />
            </label>
            <label>
              Default branch
              <select value={settings.defaultBranchId} onChange={(event) => updateSetting("defaultBranchId", event.target.value)} required>
                <option value="">Default branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>)}
              </select>
            </label>
            <label>
              Currency
              <select value={settings.currency} onChange={(event) => updateSetting("currency", event.target.value as TenantSettings["currency"])}>
                <option value="">Currency</option>
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
                <option value="GHS">GHS</option>
                <option value="KES">KES</option>
                <option value="ZAR">ZAR</option>
              </select>
            </label>
            <label>
              VAT rate (%)
              <input
                max={100}
                min={0}
                step={0.1}
                type="number"
                value={decimalToPercent(settings.defaultTaxRate)}
                onChange={(event) => updateRateFromPercent("defaultTaxRate", event.target.value)}
              />
            </label>
            <label>
              Service charge (%)
              <input
                max={100}
                min={0}
                step={0.1}
                type="number"
                value={decimalToPercent(settings.serviceChargeRate)}
                onChange={(event) => updateRateFromPercent("serviceChargeRate", event.target.value)}
              />
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={settings.serviceChargeEnabled} onChange={(event) => updateSetting("serviceChargeEnabled", event.target.checked)} />
              Include service charge by default
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Receipts and payment</h2>
            <ReceiptText size={20} />
          </div>
          <div className="settings-form">
            <label className="wide-field">
              Receipt footer
              <input value={settings.receiptFooter} onChange={(event) => updateSetting("receiptFooter", event.target.value)} />
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={settings.whatsappReceipts} onChange={(event) => updateSetting("whatsappReceipts", event.target.checked)} />
              WhatsApp receipts
            </label>
            {Object.entries(settings.paymentMethods).map(([key, value]) => (
              <label className="toggle-line" key={key}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(event) => updatePaymentMethod(key as keyof TenantSettings["paymentMethods"], event.target.checked)}
                />
                {paymentMethodLabels[key as keyof TenantSettings["paymentMethods"]]}
              </label>
            ))}
            {!hasEnabledPaymentMethod ? (
              <div className="settings-warning wide-field">
                Enable at least one payment method so cashiers can complete sales.
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Product categories</h2>
            <Tag size={20} />
          </div>
          <div className="settings-form">
            <label className="wide-field">
              New category
              <div className="settings-inline-control">
                <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Breakfast, Frozen foods" />
                <button className="secondary-button" type="button" onClick={addProductCategory}><Plus size={18} /> Add</button>
              </div>
            </label>
            <div className="search-box compact-search wide-field">
              <Search size={16} />
              <input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Search categories" />
              {categoryQuery ? <button type="button" onClick={() => setCategoryQuery("")} aria-label="Clear category search"><X size={14} /></button> : null}
            </div>
            <div className="settings-chip-list wide-field">
              {filteredCategories.length === 0 ? (
                <span>
                  <strong>No categories found</strong>
                  <small>{categoryQuery ? "Clear search to view all categories" : "Add the first category above"}</small>
                </span>
              ) : filteredCategories.map((category) => (
                <span key={category}>
                  <strong>{category}</strong>
                  <small>{categoryUsage[category] ?? 0} items</small>
                  <button type="button" onClick={() => openRenameCategory(category)} aria-label={`Rename ${category}`}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" disabled={(categoryUsage[category] ?? 0) > 0} onClick={() => removeProductCategory(category)} aria-label={`Remove ${category}`}>
                    <Trash2 size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Hardware</h2>
            <Printer size={20} />
          </div>
          <div className="settings-form">
            <label className="wide-field">
              Receipt printer
              <input value={settings.hardware.printer} onChange={(event) => updateHardware("printer", event.target.value)} />
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={settings.hardware.cashDrawer} onChange={(event) => updateHardware("cashDrawer", event.target.checked)} />
              Cash drawer
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={settings.hardware.barcodeScanner} onChange={(event) => updateHardware("barcodeScanner", event.target.checked)} />
              Barcode scanner
            </label>
          </div>
        </section>

        <aside className="panel receipt-preview">
          <div className="panel-header">
            <h2>Receipt preview</h2>
            <span>{settings.currency}</span>
          </div>
          <div>
            <strong>{settings.businessName || "Business name"}</strong>
            <span>{settings.taxId || "No tax ID"}</span>
            <hr />
            <p>Signature Jollof Rice</p>
            <b>{formatMoney(8500, settings.currency)}</b>
            <p>VAT {Math.round(settings.defaultTaxRate * 1000) / 10}%</p>
            <p>{settings.serviceChargeEnabled ? `Service ${Math.round(settings.serviceChargeRate * 1000) / 10}%` : "No service charge"}</p>
            <hr />
            <small>{settings.receiptFooter || "Receipt footer"}</small>
          </div>
          <button className="primary-button" type="submit" disabled={!hasEnabledPaymentMethod}><Check size={18} /> Save settings</button>
        </aside>
      </form>
      {renameCategory ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeRenameCategory}>
          <section className="modal-panel settings-category-modal" role="dialog" aria-modal="true" aria-labelledby="rename-category-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Catalog settings</p>
                <h2 id="rename-category-title">Rename category</h2>
              </div>
              <button className="icon-button" onClick={closeRenameCategory} aria-label="Close rename modal"><X size={18} /></button>
            </div>
            <form className="settings-form" onSubmit={submitRenameCategory}>
              <label className="wide-field">
                Category name
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required />
              </label>
              <div className="form-summary wide-field">
                <span>{categoryUsage[renameCategory] ?? 0} products will move from {renameCategory}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Rename</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
