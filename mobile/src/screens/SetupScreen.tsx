import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { pairServer, probeServer } from "../sync/engine";
import type { ServerKey, SyncMode } from "../sync/types";
import { Banner, Button, Card, Field, Muted, Title } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

const modes: { value: SyncMode; title: string; description: string }[] = [
  { value: "local", title: "Office server only", description: "Syncs over the shop Wi-Fi with the server installed in the office. Works without internet." },
  { value: "cloud", title: "Cloud only", description: "Syncs with the online server whenever this tablet has internet." },
  { value: "hybrid", title: "Office server + cloud", description: "Uses the office server when on the shop Wi-Fi and falls back to the cloud elsewhere." }
];

interface ServerForm {
  url: string;
  code: string;
  status?: string;
}

/** First-run pairing. Codes come from the web app: Sync → Devices → "Pair a tablet". */
export function SetupScreen() {
  const { platform, engine, refresh, settings } = useApp();
  const [mode, setMode] = useState<SyncMode>(settings?.mode ?? "local");
  const [forms, setForms] = useState<Record<ServerKey, ServerForm>>({
    local: { url: settings?.servers.local?.url ?? "http://192.168.1.10:4000", code: "" },
    cloud: { url: settings?.servers.cloud?.url ?? "https://", code: "" }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needed: ServerKey[] = mode === "hybrid" ? ["local", "cloud"] : [mode === "cloud" ? "cloud" : "local"];

  const update = (key: ServerKey, patch: Partial<ServerForm>) => setForms((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const test = async (key: ServerKey) => {
    update(key, { status: "Checking..." });
    try {
      const hello = await probeServer(platform, forms[key].url);
      update(key, { status: `Reachable - ${hello.role} server` });
    } catch (cause) {
      update(key, { status: `Not reachable: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
  };

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const key of needed) {
        if (!forms[key].code.trim()) throw new Error(`Enter the pairing code for the ${key === "local" ? "office" : "cloud"} server`);
        await pairServer(platform, { server: key, url: forms[key].url, pairingCode: forms[key].code, mode });
      }
      const status = await engine.syncNow();
      if (status.lastError && !status.lastSyncAt) throw new Error(status.lastError);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <Title>Set up this tablet</Title>
        <Muted>Choose where this tablet syncs. A manager creates pairing codes in the web app under Sync → Devices.</Muted>

        <View style={styles.modes}>
          {modes.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === option.value }}
              onPress={() => setMode(option.value)}
              style={[styles.mode, mode === option.value && styles.modeSelected]}
            >
              <Text style={styles.modeTitle}>{option.title}</Text>
              <Text style={styles.modeDescription}>{option.description}</Text>
            </Pressable>
          ))}
        </View>

        {needed.map((key) => (
          <Card key={key}>
            <Text style={styles.cardTitle}>{key === "local" ? "Office server" : "Cloud server"}</Text>
            <Field
              label="Server address"
              value={forms[key].url}
              onChangeText={(url) => update(key, { url, status: undefined })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint={key === "local" ? "The office computer's address on the shop network, e.g. http://192.168.1.10:4000" : "The online address of your NaijaPOS server"}
            />
            <Field
              label="Pairing code"
              value={forms[key].code}
              onChangeText={(code) => update(key, { code: code.toUpperCase() })}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCD-EFGH"
            />
            <View style={styles.row}>
              <Button label="Test connection" variant="secondary" onPress={() => void test(key)} />
              {forms[key].status ? <Muted>{forms[key].status}</Muted> : null}
            </View>
          </Card>
        ))}

        {error ? <Banner tone="danger" message={error} /> : null}
        <Button label={busy ? "Pairing and downloading data..." : "Pair and download data"} onPress={() => void pair()} busy={busy} large />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, alignItems: "center", backgroundColor: colors.background, flexGrow: 1 },
  column: { width: "100%", maxWidth: 720, gap: spacing.lg },
  modes: { gap: spacing.sm },
  mode: { borderWidth: 2, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.xs },
  modeSelected: { borderColor: colors.primary, backgroundColor: "#E7F5F0" },
  modeTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  modeDescription: { fontSize: font.md, color: colors.textMuted },
  cardTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" }
});
