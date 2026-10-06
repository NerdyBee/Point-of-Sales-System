import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Platform } from "../data/db";
import { readModel, type Staff, type Tenant } from "../data/readModel";
import { SyncEngine, type SyncStatus } from "../sync/engine";
import { loadSettings, type DeviceSettings } from "../sync/settings";
import { ensureStandaloneUpgrades } from "../standalone/business";

const backgroundSyncMs = 20_000;
const autoLockMs = 10 * 60_000;

interface AppContextValue {
  platform: Platform;
  engine: SyncEngine;
  settings: DeviceSettings | null;
  tenant: Tenant | null;
  staff: Staff | null;
  permissions: Set<string>;
  syncStatus: SyncStatus;
  /** Bumped after local writes or a sync so screens re-query. */
  dataVersion: number;
  refresh(): Promise<void>;
  signIn(staff: Staff): Promise<void>;
  signOut(): void;
  touch(): void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider(props: { platform: Platform; children: ReactNode }) {
  const engine = useMemo(() => new SyncEngine(props.platform), [props.platform]);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(engine.getStatus());
  const [dataVersion, setDataVersion] = useState(0);
  const lastActivity = useRef(Date.now());
  const upgraded = useRef(false);

  const refresh = useCallback(async () => {
    if (!upgraded.current) {
      upgraded.current = true;
      // Devices set up with an older version get newly added permissions (e.g. customer credit).
      await ensureStandaloneUpgrades(props.platform).catch(() => undefined);
    }
    const next = await loadSettings(props.platform);
    setSettings(next);
    setTenant(next ? await readModel.tenant(props.platform.db, next.tenantId) : null);
    await engine.refreshCounts();
    setDataVersion((version) => version + 1);
  }, [props.platform, engine]);

  useEffect(() => engine.subscribe(setSyncStatus), [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Background sync while the app is in the foreground and paired.
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    const tick = async () => {
      if (AppState.currentState !== "active") return;
      await engine.syncNow();
      if (!cancelled) await refresh();
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
  }, [settings?.terminalId, engine, refresh]);

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
    tenant,
    staff,
    permissions,
    syncStatus,
    dataVersion,
    refresh,
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
