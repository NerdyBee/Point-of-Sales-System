import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LockScreen } from "../screens/LockScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { SalesScreen } from "../screens/SalesScreen";
import { SellScreen } from "../screens/SellScreen";
import { SetupScreen } from "../screens/SetupScreen";
import { SyncScreen } from "../screens/SyncScreen";
import { Button } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";
import { useApp } from "./AppContext";

type Tab = "sell" | "sales" | "register" | "sync";
const tabs: { key: Tab; label: string }[] = [
  { key: "sell", label: "Sell" },
  { key: "sales", label: "Sales" },
  { key: "register", label: "Register" },
  { key: "sync", label: "Sync" }
];

export function Shell() {
  const { settings, staff, signOut, syncStatus, touch } = useApp();
  const [tab, setTab] = useState<Tab>("sell");
  const [repairing, setRepairing] = useState(false);
  const [lockedView, setLockedView] = useState<"lock" | "sync">("lock");

  if (!settings || repairing) {
    return (
      <View style={{ flex: 1 }}>
        <SetupScreen />
        {repairing ? <Button label="Back" variant="ghost" onPress={() => setRepairing(false)} style={{ margin: spacing.lg }} /> : null}
      </View>
    );
  }

  if (!staff) {
    if (lockedView === "sync") {
      return (
        <View style={{ flex: 1 }}>
          <Button label="← Back to sign in" variant="ghost" onPress={() => setLockedView("lock")} style={{ alignSelf: "flex-start", margin: spacing.md }} />
          <SyncScreen onRepair={() => setRepairing(true)} />
        </View>
      );
    }
    return <LockScreen onOpenSync={() => setLockedView("sync")} />;
  }

  const online = Object.values(syncStatus.reachable).some(Boolean);
  const indicator = syncStatus.running
    ? { label: "Syncing...", color: colors.info }
    : syncStatus.conflicts
      ? { label: `${syncStatus.conflicts} need review`, color: colors.danger }
      : !online
        ? { label: syncStatus.pending ? `Offline · ${syncStatus.pending} waiting` : "Offline", color: colors.warning }
        : syncStatus.pending
          ? { label: `${syncStatus.pending} waiting`, color: colors.warning }
          : { label: "All synced", color: colors.success };

  return (
    <View style={styles.page} onTouchStart={touch}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          {tabs.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item.key }}
              onPress={() => setTab(item.key)}
              style={[styles.tab, tab === item.key && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, tab === item.key && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setTab("sync")} style={styles.indicator} accessibilityRole="button" accessibilityLabel={`Sync status: ${indicator.label}`}>
          <View style={[styles.dot, { backgroundColor: indicator.color }]} />
          <Text style={styles.indicatorLabel}>{indicator.label}</Text>
        </Pressable>
        <Text style={styles.staff} numberOfLines={1}>{staff.name}</Text>
        <Button label="Lock" variant="secondary" onPress={signOut} />
      </View>
      <View style={{ flex: 1 }}>
        {tab === "sell" ? <SellScreen onOpenRegister={() => setTab("register")} /> : null}
        {tab === "sales" ? <SalesScreen /> : null}
        {tab === "register" ? <RegisterScreen onOpened={() => setTab("sell")} /> : null}
        {tab === "sync" ? <SyncScreen onRepair={() => setRepairing(true)} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { flexDirection: "row", gap: spacing.xs, flex: 1 },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  tabActive: { backgroundColor: colors.surfaceMuted },
  tabLabel: { fontSize: font.md, fontWeight: "600", color: colors.textMuted },
  tabLabelActive: { color: colors.text },
  indicator: { flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  indicatorLabel: { fontSize: font.sm, color: colors.text, fontWeight: "600" },
  staff: { fontSize: font.md, color: colors.text, maxWidth: 180 }
});
