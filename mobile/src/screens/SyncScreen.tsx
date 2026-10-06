import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { resetLocalData } from "../data/schema";
import { setServerToken } from "../sync/settings";
import type { ServerKey } from "../sync/types";
import { Badge, Banner, Button, Card, Muted, Title } from "../ui/components";
import { PrinterCard } from "./PrinterSheet";
import { colors, font, spacing } from "../ui/theme";

type CommandRow = Awaited<ReturnType<ReturnType<typeof useApp>["engine"]["recentCommands"]>>[number];

const commandLabels: Record<string, string> = {
  "register.open": "Open register",
  "register.close": "Close register",
  "sale.create": "Sale",
  "customer.create": "New customer"
};

export function SyncScreen(props: { onRepair: () => void }) {
  const { platform, engine, settings, syncStatus, dataVersion, refresh, staff, permissions, signOut } = useApp();
  const [commands, setCommands] = useState<CommandRow[]>([]);

  useEffect(() => {
    void engine.recentCommands().then(setCommands);
  }, [engine, dataVersion, syncStatus.running]);

  const servers = (["local", "cloud"] as ServerKey[]).filter((key) => settings?.servers[key]);
  const canReset = !staff || permissions.has("sync.manage");

  const reset = () => {
    const unsent = syncStatus.pending;
    Alert.alert(
      "Reset this tablet?",
      unsent ? `${unsent} item(s) have not reached the server and will be lost.` : "All local data is removed and the tablet must be paired again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () =>
            void (async () => {
              await setServerToken(platform, "local", null);
              await setServerToken(platform, "cloud", null);
              await resetLocalData(platform.db);
              signOut();
              await refresh();
            })()
        }
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.column}>
        <Title>Sync</Title>
        {syncStatus.revoked ? <Banner tone="danger" message="This tablet was removed on the server. Pair it again." /> : null}
        {syncStatus.lastError && !syncStatus.revoked ? <Banner tone="warning" message={syncStatus.lastError} /> : null}

        <PrinterCard />

        <Card>
          <Text style={styles.heading}>{settings?.tenantName} · {settings?.terminalName}</Text>
          <Muted>Mode: {settings?.mode === "hybrid" ? "Office server + cloud" : settings?.mode === "cloud" ? "Cloud only" : "Office server only"} · Device code {settings?.deviceCode}</Muted>
          {servers.map((key) => (
            <View key={key} style={styles.row}>
              <Text style={styles.label}>{key === "local" ? "Office server" : "Cloud"} · {settings?.servers[key]?.url}</Text>
              <Badge
                label={syncStatus.reachable[key] === undefined ? "Unknown" : syncStatus.reachable[key] ? "Reachable" : "Offline"}
                tone={syncStatus.reachable[key] ? "success" : syncStatus.reachable[key] === false ? "warning" : "neutral"}
              />
            </View>
          ))}
          <View style={styles.row}>
            <Text style={styles.label}>Waiting to send</Text>
            <Text style={styles.value}>{syncStatus.pending}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Needs manager review</Text>
            <Text style={styles.value}>{syncStatus.conflicts}</Text>
          </View>
          <Muted>
            Last sync: {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "never"}
            {syncStatus.lastPullFrom ? ` from ${syncStatus.lastPullFrom === "local" ? "office server" : "cloud"}` : ""}
          </Muted>
          <Button label="Sync now" busy={syncStatus.running} onPress={() => void engine.retryNow().then(refresh)} />
        </Card>

        <Card>
          <Text style={styles.heading}>Recent activity</Text>
          {commands.length === 0 ? <Muted>Nothing sent yet.</Muted> : null}
          {commands.map((command) => (
            <View key={command.id} style={styles.command}>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>{commandLabels[command.type] ?? command.type}{command.serverEntityId ? ` · ${command.serverEntityId}` : ""}</Text>
                <Text style={styles.meta}>{new Date(command.createdAt).toLocaleString()}{command.target ? ` → ${command.target === "local" ? "office" : "cloud"}` : ""}</Text>
                {command.error ? <Text style={[styles.meta, { color: command.status === "conflict" ? colors.danger : colors.warning }]}>{command.error}</Text> : null}
              </View>
              <Badge
                label={command.status === "synced" ? "Synced" : command.status === "conflict" ? "Review on server" : "Waiting"}
                tone={command.status === "synced" ? "success" : command.status === "conflict" ? "danger" : "warning"}
              />
            </View>
          ))}
        </Card>

        {canReset ? (
          <Card>
            <Text style={styles.heading}>Device</Text>
            <Button label="Pair with another server" variant="secondary" onPress={props.onRepair} />
            <Button label="Reset tablet" variant="danger" onPress={reset} />
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, alignItems: "center", backgroundColor: colors.background, flexGrow: 1 },
  column: { width: "100%", maxWidth: 760, gap: spacing.lg },
  heading: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  label: { fontSize: font.md, color: colors.textMuted, flexShrink: 1 },
  value: { fontSize: font.md, fontWeight: "600", color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
  command: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted }
});
