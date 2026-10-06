import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { verifyPin } from "../auth/pin";
import { readModel, type Staff } from "../data/readModel";
import { useApp } from "../shell/AppContext";
import { isStandalone } from "../sync/settings";
import { LICENSE_WARN_DAYS } from "../license/config";
import { AboutLine, BrandHeader } from "../ui/BrandMark";
import { Banner, Button, Muted, PinPad, Title } from "../ui/components";
import { useLayout } from "../ui/layout";
import { colors, font, radius, spacing } from "../ui/theme";

/**
 * Staff pick their name and enter their 6-digit PIN. Works fully offline.
 * Wide screens show the list and PIN pad side by side; phones show one at a time.
 */
export function LockScreen(props: { onOpenSync: () => void }) {
  const { platform, settings, tenant, signIn, dataVersion, syncStatus, engine, license } = useApp();
  const licence = license?.check?.ok ? license.check : null;
  const { compact } = useLayout();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const standalone = isStandalone(settings);

  useEffect(() => {
    void readModel.signInStaff(platform.db).then(setStaff);
  }, [platform, dataVersion]);

  const choose = (member: Staff | null) => {
    setSelected(member);
    setPin("");
    setError(null);
  };

  const submit = async (value: string) => {
    if (!selected) return;
    const result = await verifyPin(platform, selected.id, value);
    setPin("");
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    await signIn(result.staff);
  };

  const list = (
    <View style={[styles.list, !compact && styles.listWide]}>
      <View style={{ alignSelf: "flex-start" }}>
        <BrandHeader size={52} />
      </View>
      <Title>{tenant?.settings.businessName ?? settings?.tenantName}</Title>
      <Muted>{settings?.terminalName} · tap your name</Muted>
      {staff.length === 0 ? (
        <View style={{ gap: spacing.md }}>
          <Banner tone="info" message={standalone ? "No staff can sign in. Restore a backup from the Backup screen." : "No staff downloaded yet. Connect to the server and sync."} />
          {standalone ? null : <Button label="Sync now" onPress={() => void engine.syncNow()} busy={syncStatus.running} />}
        </View>
      ) : (
        <View style={styles.grid}>
          {staff.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selected?.id === item.id }}
              onPress={() => choose(item)}
              style={({ pressed }) => [styles.staff, compact && styles.staffCompact, (selected?.id === item.id || pressed) && styles.staffSelected]}
            >
              <Text style={styles.staffName}>{item.name}</Text>
              <Text style={styles.staffRole}>{item.role.replaceAll("_", " ")}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Button label={standalone ? "Backup" : "Sync & settings"} variant="ghost" onPress={props.onOpenSync} style={{ alignSelf: "flex-start" }} />
      {licence && licence.daysLeft !== null && licence.daysLeft <= LICENSE_WARN_DAYS ? (
        <Banner tone="warning" message={`Licence expires in ${licence.daysLeft} day${licence.daysLeft === 1 ? "" : "s"}. Contact your supplier to renew (device code ${license?.deviceCode}).`} />
      ) : null}
      <AboutLine />
      {licence ? (
        <Text style={styles.licence}>
          Licensed to {licence.license.name} · {licence.license.expires ? `valid until ${licence.license.expires}` : "no expiry"} · device {license?.deviceCode}
        </Text>
      ) : null}
    </View>
  );

  const pad = selected ? (
    <View style={styles.pad}>
      {compact ? <Button label="← Choose someone else" variant="ghost" onPress={() => choose(null)} style={{ alignSelf: "flex-start" }} /> : null}
      <Text style={styles.prompt}>PIN for {selected.name}</Text>
      <PinPad value={pin} length={6} onChange={setPin} onSubmit={(value) => void submit(value)} />
      {error ? <Banner tone="danger" message={error} /> : null}
    </View>
  ) : (
    <View style={styles.pad}>
      <Muted>Select your name to sign in</Muted>
    </View>
  );

  if (compact) {
    return <ScrollView contentContainerStyle={styles.compactPage}>{selected ? pad : list}</ScrollView>;
  }

  return (
    <View style={styles.page}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.md }}>{list}</ScrollView>
      <View style={{ flex: 1, justifyContent: "center" }}>{pad}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: colors.background, padding: spacing.xl, gap: spacing.xl },
  compactPage: { flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  list: { gap: spacing.md },
  listWide: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  pad: { alignItems: "center", gap: spacing.lg },
  staff: { flexBasis: "47%", flexGrow: 1, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  staffCompact: { flexBasis: "100%" },
  staffSelected: { borderColor: colors.primary },
  staffName: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  staffRole: { fontSize: font.sm, color: colors.textMuted, textTransform: "capitalize" },
  prompt: { fontSize: font.lg, fontWeight: "600", color: colors.text },
  licence: { fontSize: 12, color: colors.textMuted }
});
