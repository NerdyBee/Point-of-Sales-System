import { useEffect, useMemo, useState } from "react";
import { fetchCurrentTenant, type TenantSettings } from "../api/client";
import { formatMoney, type CurrencyCode } from "../utils/money";

export const tenantSettingsUpdatedEvent = "pos:tenant-settings-updated";

export function notifyTenantSettingsUpdated() {
  window.dispatchEvent(new Event(tenantSettingsUpdatedEvent));
}

export function useTenantSettings() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>("NGN");

  useEffect(() => {
    let cancelled = false;

    async function loadTenantSettings() {
      try {
        const response = await fetchCurrentTenant();
        if (!cancelled) {
          setSettings(response.tenant.settings);
          setCurrency(response.tenant.settings.currency);
        }
      } catch {
        if (!cancelled) {
          setSettings(null);
          setCurrency("NGN");
        }
      }
    }

    void loadTenantSettings();
    window.addEventListener(tenantSettingsUpdatedEvent, loadTenantSettings);

    return () => {
      cancelled = true;
      window.removeEventListener(tenantSettingsUpdatedEvent, loadTenantSettings);
    };
  }, []);

  const displayMoney = useMemo(() => (amount: number, nextCurrency: CurrencyCode = currency) => formatMoney(amount, nextCurrency), [currency]);

  return { settings, currency, displayMoney };
}
