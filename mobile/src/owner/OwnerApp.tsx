import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { setMoneyDecimals } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import { clearSettings, getKv, setKv } from "../sync/settings";
import { Icon, IconButton, type IconName } from "../ui/appKit";
import { BrandHeader } from "../ui/BrandMark";
import { Banner, Button, Card, Field, Muted, Title } from "../ui/components";
import { KeyboardAwareScrollView } from "../ui/keyboard";
import { colors, font, spacing } from "../ui/theme";
import { OwnerApi, loadOwnerSession, ownerSignIn, saveOwnerSession, type OwnerSession } from "./api";
import { ApprovalsScreen, OverviewScreen, SalesScreen, StockScreen } from "./OwnerScreens";

/** Locks after this long without a tap, like the shop tills; the password opens it again. */
const autoLockMs = 10 * 60_000;
const lastStaffKey = "owner.lastStaffId";

export interface Branch {
  id: string;
  name: string;
}

interface OwnerContextValue {
  api: OwnerApi;
  currency: string;
  branches: Branch[];
  staffNames: Map<string, string>;
  branchName(id: string): string;
  can(permission: string): boolean;
  /** Pending approvals, shown as a badge on the tab. */
  pendingCount: number;
  setPendingCount(count: number): void;
}

const OwnerContext = createContext<OwnerContextValue | null>(null);

export function useOwner() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error("useOwner must be used inside OwnerApp");
  return value;
}

type Tab = "overview" | "sales" | "stock" | "approvals";
const tabs: { key: Tab; label: string; icon: [IconName, IconName] }[] = [
  { key: "overview", label: "Overview", icon: ["stats-chart-outline", "stats-chart"] },
  { key: "sales", label: "Sales", icon: ["receipt-outline", "receipt"] },
  { key: "stock", label: "Stock", icon: ["cube-outline", "cube"] },
  { key: "approvals", label: "Approvals", icon: ["checkmark-done-outline", "checkmark-done"] }
];

/** The boss's phone: live view of every branch from the server, no till. */
export function OwnerApp() {
  const { platform, settings, refresh } = useApp();
  const [session, setSession] = useState<OwnerSession | null | undefined>(undefined);
  const [business, setBusiness] = useState<{ currency: string; branches: Branch[]; staffNames: Map<string, string> } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [pendingCount, setPendingCount] = useState(0);
  const lastActivity = useRef(Date.now());
  const api = useRef<OwnerApi | null>(null);

  useEffect(() => {
    void loadOwnerSession(platform).then(setSession, () => setSession(null));
  }, [platform]);

  const lock = useCallback(async () => {
    await saveOwnerSession(platform, null);
    api.current = null;
    setSession(null);
  }, [platform]);

  // Business details every screen needs: currency and decimals, branch and staff names.
  useEffect(() => {
    if (!session) return;
    api.current = new OwnerApi(platform, session, (next) => {
      if (!next) setSession(null);
    });
    const client = api.current;
    setLoadError(null);
    void (async () => {
      try {
        const [{ tenant }, { branches }, staff] = await Promise.all([
          client.request<{ tenant: { settings: { currency: string; moneyDecimals?: number } } }>("/tenants/current"),
          client.request<{ branches: Branch[] }>("/branches"),
          client.request<{ staff: { id: string; name: string }[] }>("/staff").catch(() => ({ staff: [] }))
        ]);
        setMoneyDecimals(tenant.settings.moneyDecimals);
        setBusiness({ currency: tenant.settings.currency, branches, staffNames: new Map(staff.staff.map((member) => [member.id, member.name])) });
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [platform, session]);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > autoLockMs) void lock();
    }, 30_000);
    return () => clearInterval(timer);
  }, [session, lock]);

  if (session === undefined) return null;
  if (!session) return <OwnerSignIn onSignedIn={(next) => { lastActivity.current = Date.now(); setSession(next); }} />;

  if (!business || !api.current) {
    return (
      <View style={styles.center}>
        {loadError ? (
          <>
            <Banner tone="danger" message={loadError} />
            <Button label="Try again" onPress={() => setSession({ ...session })} />
            <Button label="Sign out" variant="ghost" onPress={() => void lock()} />
          </>
        ) : (
          <Muted>Loading {settings?.tenantName ?? "your business"}...</Muted>
        )}
      </View>
    );
  }

  const value: OwnerContextValue = {
    api: api.current,
    currency: business.currency,
    branches: business.branches,
    staffNames: business.staffNames,
    branchName: (id) => business.branches.find((branch) => branch.id === id)?.name ?? id,
    can: (permission) => session.staff.permissions.includes(permission),
    pendingCount,
    setPendingCount
  };

  const disconnect = () => {
    Alert.alert("Disconnect this phone?", "It will stop showing this business until it is set up again. Nothing is deleted on the server.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await saveOwnerSession(platform, null);
            await clearSettings(platform);
            await refresh();
          })();
        }
      }
    ]);
  };

  return (
    <OwnerContext.Provider value={value}>
      <View style={styles.page} onTouchStart={() => { lastActivity.current = Date.now(); }}>
        <View style={styles.appBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{settings?.tenantName}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{session.staff.name} · all branches</Text>
          </View>
          <IconButton icon="log-out-outline" label="Disconnect this phone" onPress={disconnect} />
          <IconButton icon="lock-closed-outline" label="Lock" onPress={() => void lock()} />
        </View>
        <View style={{ flex: 1 }}>
          {tab === "overview" ? <OverviewScreen onOpenApprovals={() => setTab("approvals")} /> : null}
          {tab === "sales" ? <SalesScreen /> : null}
          {tab === "stock" ? <StockScreen /> : null}
          {tab === "approvals" ? <ApprovalsScreen /> : null}
        </View>
        <View style={styles.bottomBar} accessibilityRole="tablist">
          {tabs.map((item) => {
            const active = tab === item.key;
            const badge = item.key === "approvals" ? pendingCount : 0;
            return (
              <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={item.label} onPress={() => setTab(item.key)} style={styles.bottomTab}>
                <View style={[styles.iconWrap, active && styles.iconActive]}>
                  <Icon name={item.icon[active ? 1 : 0]} size={22} color={active ? colors.primary : colors.textMuted} />
                  {badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeLabel}>{badge > 99 ? "99+" : badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.tabLabel, active && { color: colors.primary }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </OwnerContext.Provider>
  );
}

/** Password sign-in (first time after setup, after locking, or when the sign-in expires). */
function OwnerSignIn(props: { onSignedIn(session: OwnerSession): void }) {
  const { platform, settings } = useApp();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getKv(platform, lastStaffKey).then((value) => value && setIdentifier(value));
  }, [platform]);

  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = await ownerSignIn(platform, settings?.servers.cloud?.url ?? "", identifier, password);
      await saveOwnerSession(platform, session);
      await setKv(platform, lastStaffKey, session.staff.id);
      props.onSignedIn(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.signIn} keyboardShouldPersistTaps="handled">
      <BrandHeader size={72} />
      <Title>{settings?.tenantName}</Title>
      <Muted>Owner view of all branches. Sign in to continue.</Muted>
      <Card>
        <Field label="Staff ID" value={identifier} onChangeText={(text) => setIdentifier(text.toUpperCase())} autoCapitalize="characters" autoCorrect={false} />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoFocus={Boolean(identifier)} />
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button label={busy ? "Signing in..." : "Sign in"} onPress={() => void signIn()} busy={busy} disabled={!identifier.trim() || !password} large />
      </Card>
      <Muted>Server: {settings?.servers.cloud?.url}</Muted>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  signIn: { padding: spacing.xl, gap: spacing.lg, maxWidth: 520, width: "100%", alignSelf: "center" },
  appBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted },
  bottomBar: { flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 6 },
  bottomTab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 2 },
  iconWrap: { width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  iconActive: { backgroundColor: "#E7F5F0" },
  tabLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  badge: { position: "absolute", top: -2, right: 8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  badgeLabel: { color: colors.primaryText, fontSize: 11, fontWeight: "700" }
});
