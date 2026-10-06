import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ActivationScreen } from "../screens/ActivationScreen";
import { BackupScreen, backupAgeDays, backupReminderDays } from "../screens/BackupScreen";
import { LockScreen } from "../screens/LockScreen";
import { ManageScreen } from "../screens/ManageScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { ReportsScreen } from "../screens/ReportsScreen";
import { SalesScreen } from "../screens/SalesScreen";
import { SellScreen } from "../screens/SellScreen";
import { SetupScreen } from "../screens/SetupScreen";
import { SyncScreen } from "../screens/SyncScreen";
import { lastBackupAt } from "../standalone/business";
import { isStandalone } from "../sync/settings";
import { Icon, IconButton, type IconName } from "../ui/appKit";
import { Button } from "../ui/components";
import { useLayout } from "../ui/layout";
import { colors, font, radius, spacing } from "../ui/theme";
import { useApp } from "./AppContext";

type Tab = "sell" | "sales" | "register" | "reports" | "manage" | "sync" | "backup";
const managePermissions = ["catalog.manage", "staff.manage", "settings.manage"];

const tabIcons: Record<Tab, [IconName, IconName]> = {
  sell: ["cart-outline", "cart"],
  sales: ["receipt-outline", "receipt"],
  register: ["cash-outline", "cash"],
  reports: ["bar-chart-outline", "bar-chart"],
  manage: ["grid-outline", "grid"],
  sync: ["sync-outline", "sync"],
  backup: ["cloud-upload-outline", "cloud-upload"]
};

export function Shell() {
  const { platform, settings, tenant, staff, signOut, syncStatus, touch, permissions, dataVersion, license, licensed, reloadLicense, skipLicense } = useApp();
  const [tab, setTab] = useState<Tab>("sell");
  const [repairing, setRepairing] = useState(false);
  const [lockedView, setLockedView] = useState<"lock" | "sync">("lock");
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const standalone = isStandalone(settings);
  const { compact } = useLayout();

  useEffect(() => {
    if (standalone) void lastBackupAt(platform).then(setLastBackup);
  }, [platform, standalone, dataVersion]);

  if (!license) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!licensed) {
    return (
      <ActivationScreen
        state={license}
        onActivated={() => {
          signOut();
          void reloadLicense();
        }}
        onSkip={skipLicense}
      />
    );
  }

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
          {standalone ? <BackupScreen /> : <SyncScreen onRepair={() => setRepairing(true)} />}
        </View>
      );
    }
    return <LockScreen onOpenSync={() => setLockedView("sync")} />;
  }

  const canManage = standalone && managePermissions.some((permission) => permissions.has(permission));
  const canReport = standalone && (permissions.has("inventory.adjust") || permissions.has("reports.profit.view"));
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "sell", label: "Sell" },
    { key: "sales", label: "Sales" },
    { key: "register", label: "Register" },
    ...(canReport ? [{ key: "reports" as const, label: "Reports" }] : []),
    ...(canManage ? [{ key: "manage" as const, label: "Manage" }] : []),
    standalone ? { key: "backup" as const, label: "Backup" } : { key: "sync" as const, label: "Sync", badge: syncStatus.pending + syncStatus.conflicts }
  ];

  const online = Object.values(syncStatus.reachable).some(Boolean);
  const backupAge = backupAgeDays(lastBackup);
  const indicator = standalone
    ? backupAge === null || backupAge >= backupReminderDays
      ? { label: backupAge === null ? "Not backed up" : `Backup ${backupAge}d old`, color: colors.warning }
      : { label: "Backed up", color: colors.success }
    : syncStatus.running
      ? { label: "Syncing...", color: colors.info }
      : syncStatus.conflicts
        ? { label: `${syncStatus.conflicts} need review`, color: colors.danger }
        : !online
          ? { label: syncStatus.pending ? `Offline · ${syncStatus.pending} waiting` : "Offline", color: colors.warning }
          : syncStatus.pending
            ? { label: `${syncStatus.pending} waiting`, color: colors.warning }
            : { label: "All synced", color: colors.success };

  const statusChip = (
    <Pressable
      onPress={() => setTab(standalone ? "backup" : "sync")}
      style={[styles.chip, { borderColor: indicator.color }]}
      accessibilityRole="button"
      accessibilityLabel={`Status: ${indicator.label}`}
    >
      <View style={[styles.dot, { backgroundColor: indicator.color }]} />
      <Text style={styles.chipLabel} numberOfLines={1}>{indicator.label}</Text>
    </Pressable>
  );

  const content = (
    <View style={{ flex: 1 }}>
      {tab === "sell" ? <SellScreen onOpenRegister={() => setTab("register")} onOpenManage={canManage ? () => setTab("manage") : undefined} /> : null}
      {tab === "sales" ? <SalesScreen /> : null}
      {tab === "register" ? <RegisterScreen onOpened={() => setTab("sell")} /> : null}
      {tab === "reports" ? <ReportsScreen /> : null}
      {tab === "manage" ? <ManageScreen /> : null}
      {tab === "sync" ? <SyncScreen onRepair={() => setRepairing(true)} /> : null}
      {tab === "backup" ? <BackupScreen /> : null}
    </View>
  );

  if (compact) {
    return (
      <View style={styles.page} onTouchStart={touch}>
        <View style={styles.appBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.appTitle} numberOfLines={1}>{tenant?.settings.businessName ?? settings.tenantName}</Text>
            <Text style={styles.appSubtitle} numberOfLines={1}>{staff.name}</Text>
          </View>
          {statusChip}
          <IconButton icon="lock-closed-outline" label="Lock" onPress={signOut} />
        </View>
        {content}
        <View style={styles.bottomBar} accessibilityRole="tablist">
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                onPress={() => setTab(item.key)}
                style={styles.bottomTab}
              >
                <View style={[styles.bottomIconWrap, active && styles.bottomIconActive]}>
                  <Icon name={tabIcons[item.key][active ? 1 : 0]} size={22} color={active ? colors.primary : colors.textMuted} />
                  {item.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeLabel}>{item.badge > 99 ? "99+" : item.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.bottomLabel, active && styles.bottomLabelActive]} numberOfLines={1}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page} onTouchStart={touch}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(item.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Icon name={tabIcons[item.key][active ? 1 : 0]} size={20} color={active ? colors.primary : colors.textMuted} />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
                {item.badge ? <Text style={styles.inlineBadge}>{item.badge}</Text> : null}
              </Pressable>
            );
          })}
        </View>
        {statusChip}
        <Text style={styles.staff} numberOfLines={1}>{staff.name}</Text>
        <Button label="Lock" variant="secondary" onPress={signOut} />
      </View>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  appBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  appTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  appSubtitle: { fontSize: font.sm, color: colors.textMuted },
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999, borderWidth: 1, maxWidth: 170 },
  chipLabel: { fontSize: font.sm, color: colors.text, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bottomBar: { flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, paddingBottom: 6 },
  bottomTab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 2 },
  bottomIconWrap: { width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  bottomIconActive: { backgroundColor: "#E7F5F0" },
  bottomLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  bottomLabelActive: { color: colors.primary },
  badge: { position: "absolute", top: -2, right: 8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  badgeLabel: { color: colors.primaryText, fontSize: 11, fontWeight: "700" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { flexDirection: "row", gap: spacing.xs, flex: 1 },
  tab: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  tabActive: { backgroundColor: "#E7F5F0" },
  tabLabel: { fontSize: font.md, fontWeight: "600", color: colors.textMuted },
  tabLabelActive: { color: colors.primary },
  inlineBadge: { fontSize: 12, fontWeight: "700", color: colors.primaryText, backgroundColor: colors.danger, borderRadius: 9, paddingHorizontal: 6, overflow: "hidden" },
  staff: { fontSize: font.md, color: colors.text, maxWidth: 180 }
});
