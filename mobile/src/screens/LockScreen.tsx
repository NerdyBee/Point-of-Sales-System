import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { verifyPin } from "../auth/pin";
import { readModel, type Staff } from "../data/readModel";
import { Banner, Button, Muted, PinPad, Title } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

/** Staff pick their name and enter their 6-digit PIN. Works fully offline. */
export function LockScreen(props: { onOpenSync: () => void }) {
  const { platform, settings, tenant, signIn, dataVersion, syncStatus, engine } = useApp();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readModel.signInStaff(platform.db).then(setStaff);
  }, [platform, dataVersion]);

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

  return (
    <View style={styles.page}>
      <View style={styles.left}>
        <Title>{tenant?.settings.businessName ?? settings?.tenantName}</Title>
        <Muted>{settings?.terminalName} · tap your name</Muted>
        {staff.length === 0 ? (
          <View style={{ gap: spacing.md }}>
            <Banner tone="info" message="No staff downloaded yet. Connect to the server and sync." />
            <Button label="Sync now" onPress={() => void engine.syncNow()} busy={syncStatus.running} />
          </View>
        ) : (
          <FlatList
            data={staff}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={{ gap: spacing.md }}
            contentContainerStyle={{ gap: spacing.md }}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSelected(item);
                  setPin("");
                  setError(null);
                }}
                style={[styles.staff, selected?.id === item.id && styles.staffSelected]}
              >
                <Text style={styles.staffName}>{item.name}</Text>
                <Text style={styles.staffRole}>{item.role.replaceAll("_", " ")}</Text>
              </Pressable>
            )}
          />
        )}
        <Button label="Sync & settings" variant="ghost" onPress={props.onOpenSync} style={{ alignSelf: "flex-start" }} />
      </View>
      <View style={styles.right}>
        {selected ? (
          <>
            <Text style={styles.prompt}>PIN for {selected.name}</Text>
            <PinPad value={pin} length={6} onChange={setPin} onSubmit={(value) => void submit(value)} />
            {error ? <Banner tone="danger" message={error} /> : null}
          </>
        ) : (
          <Muted>Select your name to sign in</Muted>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.background, padding: spacing.xl, gap: spacing.xl },
  left: { flex: 1, minWidth: 320, gap: spacing.md },
  right: { flex: 1, minWidth: 320, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  staff: { flex: 1, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  staffSelected: { borderColor: colors.primary },
  staffName: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  staffRole: { fontSize: font.sm, color: colors.textMuted, textTransform: "capitalize" },
  prompt: { fontSize: font.lg, fontWeight: "600", color: colors.text }
});
