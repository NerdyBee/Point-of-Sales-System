import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Platform } from "../data/db";
import { readModel, type Staff, type Tenant } from "../data/readModel";
import { SyncEngine, type SyncStatus } from "../sync/engine";
import { loadSettings, type DeviceSettings } from "../sync/settings";
import { ensureStandaloneUpgrades } from "../standalone/business";
import { loadLicense, type LicenseState } from "../license/licenseStore";
import { onActivity } from "../ui/activity";

const backgroundSyncMs = 20_000;
const autoLockMs = 10 * 60_000;

interface AppContextValue {
  platform: Platform;
  engine: SyncEngine;
  settings: DeviceSettings | null;
  /** False until the device settings have been read once (null settings then means "not set up"). */
  ready: boolean;
  /** Set when the shop's records could not be read; the shell shows it with a retry. */
  loadError: string | null;
  tenant: Tenant | null;
  staff: Staff | null;
  permissions: Set<string>;
  syncStatus: SyncStatus;
  /** Bumped after local writes or a sync so screens re-query. */
  dataVersion: number;
  refresh(): Promise<void>;
  /** null while loading. */
  license: LicenseState | null;
  licensed: boolean;
  reloadLicense(): Promise<void>;
  /** Development builds only: continue without a licence. */
  skipLicense?: () => void;
  signIn(staff: Staff): Promise<void>;
  signOut(): void;
  touch(): void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider(props: { platform: Platform; children: ReactNode }) {
  const engine = useMemo(() => new SyncEngine(props.platform), [props.platform]);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(engine.getStatus());
  const [dataVersion, setDataVersion] = useState(0);
  const lastActivity = useRef(Date.now());
  const upgraded = useRef(false);
  const [license, setLicense] = useState<LicenseState | null>(null);
  const [devSkip, setDevSkip] = useState(false);

  const reloadLicense = useCallback(async () => {
    try {
      setLicense(await loadLicense(props.platform));
    } catch {
      // Could not even read the device code: show activation rather than spin forever.
      setLicense((current) => current ?? { deviceCode: "UNKNOWN", check: null });
    }
  }, [props.platform]);

  // Check at start and whenever the app comes back to the foreground (catches expiry while open).
  useEffect(() => {
    void reloadLicense();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reloadLicense();
    });
    return () => subscription.remove();
  }, [reloadLicense]);

  const refresh = useCallback(async () => {
    try {
      if (!upgraded.current) {
        upgraded.current = true;
        // Devices set up with an older version get newly added permissions (e.g. customer credit).
        await ensureStandaloneUpgrades(props.platform).catch(() => undefined);
      }
      const next = await loadSettings(props.platform);
      setSettings(next);
      setTenant(next ? await readModel.tenant(props.platform.db, next.tenantId) : null);
      await engine.refreshCounts();
      setLoadError(null);
      setReady(true);
      setDataVersion((version) => version + 1);
    } catch (error) {
      // Never fall through to the setup screen just because a read failed.
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [props.platform, engine]);

  useEffect(() => engine.subscribe(setSyncStatus), [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Background sync while the app is in the foreground and paired (nothing to do standalone).
  useEffect(() => {
    if (!settings || settings.mode === "standalone") return;
    let cancelled = false;
    const tick = async () => {
      if (AppState.currentState !== "active") return;
      try {
        await engine.syncNow();
        if (!cancelled) await refresh();
      } catch {
        // The engine records its own errors in the sync status; try again next tick.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), backgroundSyncMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void tick();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [settings?.terminalId, settings?.mode, engine, refresh]);

  // Taps inside pop-ups and typing count as activity for the auto-lock.
  useEffect(
    () =>
      onActivity(() => {
        lastActivity.current = Date.now();
      }),
    []
  );

  // Lock the till after inactivity.
  useEffect(() => {
    if (!staff) return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > autoLockMs) setStaff(null);
    }, 30_000);
    return () => clearInterval(timer);
  }, [staff]);

  const value: AppContextValue = {
    platform: props.platform,
    engine,
    settings,
    ready,
    loadError,
    tenant,
    staff,
    permissions,
    syncStatus,
    dataVersion,
    refresh,
    license,
    licensed: Boolean(license?.check?.ok) || devSkip,
    reloadLicense,
    skipLicense: __DEV__ ? () => setDevSkip(true) : undefined,
    async signIn(member) {
      lastActivity.current = Date.now();
      setPermissions(await readModel.permissionsForRole(props.platform.db, member.role));
      setStaff(member);
    },
    signOut() {
      setStaff(null);
      setPermissions(new Set());
    },
    touch() {
      lastActivity.current = Date.now();
    }
  };

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
