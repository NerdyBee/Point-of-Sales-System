import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { TenantSettings } from "../data/readModel";
import { useApp } from "../shell/AppContext";
import { createStandaloneBusiness, restoreBackup } from "../standalone/business";
import { pickBackupFile } from "../standalone/files";
import { pairServer, probeServer } from "../sync/engine";
import type { ServerKey, SyncMode } from "../sync/types";
import { AboutLine, BrandHeader } from "../ui/BrandMark";
import { Banner, Button, Card, Field, Muted, Title } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

const modes: { value: SyncMode; title: string; description: string }[] = [
  { value: "local", title: "Office server only", description: "Syncs over the shop Wi-Fi with the server installed in the office. Works without internet." },
  { value: "cloud", title: "Cloud only", description: "Syncs with the online server whenever this device has internet." },
  { value: "hybrid", title: "Office server + cloud", description: "Uses the office server when on the shop Wi-Fi and falls back to the cloud elsewhere." },
  {
    value: "standalone",
    title: "This device only (no server)",
    description: "For a small shop with no server. Products, staff, sales and stock are kept on this phone or tablet; back it up regularly."
  }
];

const currencies: TenantSettings["currency"][] = ["NGN", "GHS", "KES", "ZAR", "USD"];

interface ServerForm {
  url: string;
  code: string;
  status?: string;
}

/**
 * First-run setup: pair with a server (codes come from the web app: Sync monitor →
 * "Pair a tablet"), or set the tablet up to run the shop on its own.
 */
export function SetupScreen() {
  const { settings } = useApp();
  // A tablet that is already paired can add a server but cannot switch to standalone.
  const available = settings ? modes.filter((mode) => mode.value !== "standalone") : modes;
  const [mode, setMode] = useState<SyncMode>(settings?.mode ?? "local");

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <BrandHeader size={88} />
        <Title>Set up this device</Title>
        <Muted>Choose how this device keeps its records.</Muted>

        <View style={styles.modes}>
          {available.map((option) => (
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

        {mode === "standalone" ? <StandaloneSetup /> : <ServerSetup mode={mode} />}
        <AboutLine />
      </View>
    </ScrollView>
  );
}

function ServerSetup(props: { mode: SyncMode }) {
  const { platform, engine, refresh, settings } = useApp();
  const [forms, setForms] = useState<Record<ServerKey, ServerForm>>({
    local: { url: settings?.servers.local?.url ?? "http://192.168.1.10:4000", code: "" },
    cloud: { url: settings?.servers.cloud?.url ?? "https://", code: "" }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needed: ServerKey[] = props.mode === "hybrid" ? ["local", "cloud"] : [props.mode === "cloud" ? "cloud" : "local"];

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
        await pairServer(platform, { server: key, url: forms[key].url, pairingCode: forms[key].code, mode: props.mode });
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
    <>
      <Muted>A manager creates pairing codes in the web app under Sync monitor → Pair a tablet.</Muted>
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
            hint={key === "local" ? "The office computer's address on the shop network, e.g. http://192.168.1.10:4000" : "The online address of your Ajoke POS server"}
          />
          <Field label="Pairing code" value={forms[key].code} onChangeText={(code) => update(key, { code: code.toUpperCase() })} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-EFGH" />
          <View style={styles.row}>
            <Button label="Test connection" variant="secondary" onPress={() => void test(key)} />
            {forms[key].status ? <Muted>{forms[key].status}</Muted> : null}
          </View>
        </Card>
      ))}
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button label={busy ? "Pairing and downloading data..." : "Pair and download data"} onPress={() => void pair()} busy={busy} large />
    </>
  );
}

function StandaloneSetup() {
  const { platform, refresh } = useApp();
  const [businessName, setBusinessName] = useState("");
  const [currency, setCurrency] = useState<TenantSettings["currency"]>("NGN");
  const [vat, setVat] = useState("7.5");
  const [serviceChargeOn, setServiceChargeOn] = useState(false);
  const [serviceCharge, setServiceCharge] = useState("5");
  const [ownerName, setOwnerName] = useState("");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (pin !== pinAgain) return setError("The two PINs do not match");
    setBusy(true);
    try {
      await createStandaloneBusiness(platform, {
        businessName,
        currency,
        vatPercent: Number(vat) || 0,
        serviceChargePercent: serviceChargeOn ? Number(serviceCharge) || 0 : 0,
        ownerName,
        ownerPin: pin
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const restore = async () => {
    setError(null);
    try {
      const content = await pickBackupFile();
      if (!content) return;
      setBusy(true);
      await restoreBackup(platform, content);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <Text style={styles.cardTitle}>Your business</Text>
        <Field label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="e.g. Mama Nkechi Provisions" />
        <Text style={styles.label}>Currency</Text>
        <View style={styles.row}>
          {currencies.map((item) => (
            <Pressable key={item} accessibilityRole="radio" accessibilityState={{ selected: currency === item }} onPress={() => setCurrency(item)} style={[styles.chip, currency === item && styles.chipActive]}>
              <Text style={[styles.chipLabel, currency === item && { color: colors.primaryText }]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="VAT %" value={vat} onChangeText={setVat} keyboardType="decimal-pad" hint="Use 0 if you do not charge VAT" />
        <View style={styles.switchRow}>
          <Text style={styles.label}>Add a service charge</Text>
          <Switch value={serviceChargeOn} onValueChange={setServiceChargeOn} />
        </View>
        {serviceChargeOn ? <Field label="Service charge %" value={serviceCharge} onChangeText={setServiceCharge} keyboardType="decimal-pad" /> : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Owner</Text>
        <Muted>The owner signs in with this PIN and can add products, staff and settings.</Muted>
        <Field label="Owner's name" value={ownerName} onChangeText={setOwnerName} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="6-digit PIN" value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Repeat PIN" value={pinAgain} onChangeText={(value) => setPinAgain(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry />
          </View>
        </View>
      </Card>

      <Banner tone="info" message="All records stay on this device. Use Backup regularly so a lost or broken device does not mean lost records." />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button label="Create business on this device" onPress={() => void create()} busy={busy} large />
      <Button label="Restore from a backup file instead" variant="ghost" onPress={() => void restore()} disabled={busy} />
    </>
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
  label: { color: colors.text, fontSize: font.sm, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.md, color: colors.text, fontWeight: "600" }
});
