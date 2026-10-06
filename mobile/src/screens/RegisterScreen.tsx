import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { readModel, type ServerShift } from "../data/readModel";
import { currentShift, openShift, requestCloseShift, type LocalShift } from "../pos/actions";
import { formatMoney } from "../pos/pricing";
import { Badge, Banner, Button, Card, Field, Muted, Title } from "../ui/components";
import { colors, font, spacing } from "../ui/theme";

export function RegisterScreen(props: { onOpened: () => void }) {
  const { platform, staff, tenant, permissions, dataVersion, refresh, engine } = useApp();
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [serverShift, setServerShift] = useState<ServerShift | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";
  const canManage = permissions.has("register.manage");

  useEffect(() => {
    void (async () => {
      const local = await currentShift(platform);
      setShift(local);
      setServerShift(local?.serverId ? await readModel.serverShift(platform.db, local.serverId) : null);
    })();
  }, [platform, dataVersion]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setAmount("");
      setNote("");
      await refresh();
      void engine.syncNow().then(refresh);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const value = Number(amount.replace(/[^0-9]/g, ""));

  if (!canManage || !staff) {
    return <View style={styles.page}><Banner tone="warning" message="Your role cannot open or close the register." /></View>;
  }

  if (!shift) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card style={styles.card}>
          <Title>Open register</Title>
          <Muted>Count the float in the drawer before you start.</Muted>
          <Field label="Opening float" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0" />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button label="Open register" busy={busy} disabled={!amount} large onPress={() => void run(async () => { await openShift(platform, staff, value); props.onOpened(); })} />
        </Card>
      </ScrollView>
    );
  }

  // The server's expected cash includes every sale it has processed; until then use the local tally.
  const expected = serverShift ? Number(serverShift.expectedCash) : shift.openingBalance + shift.cashSales;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Title>Register</Title>
          <Badge label={shift.status === "closing" ? "Awaiting manager" : shift.serverId ? "Open" : "Open (not yet synced)"} tone={shift.status === "closing" ? "warning" : shift.serverId ? "success" : "info"} />
        </View>
        <Line label="Opened" value={new Date(shift.openedAt).toLocaleString()} />
        <Line label="Opening float" value={formatMoney(shift.openingBalance, currency)} />
        <Line label="Cash sales on this tablet" value={formatMoney(shift.cashSales, currency)} />
        <Line label="Expected cash in drawer" value={formatMoney(expected, currency)} strong />

        {shift.status === "closing" ? (
          <Banner tone="info" message={`Count of ${formatMoney(shift.countedCash ?? 0, currency)} sent. A manager approves and closes the shift in the web app; this tablet updates on the next sync.`} />
        ) : (
          <>
            <Field label="Counted cash" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="Count the drawer" />
            {amount ? <Muted>Difference: {formatMoney(value - expected, currency)}</Muted> : null}
            <Field label="Note (optional)" value={note} onChangeText={setNote} />
            {error ? <Banner tone="danger" message={error} /> : null}
            <Button label="Submit count and close" variant="danger" busy={busy} disabled={!amount} onPress={() => void run(() => requestCloseShift(platform, staff, value, note))} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

function Line(props: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, props.strong && styles.strong]}>{props.label}</Text>
      <Text style={[styles.label, props.strong && styles.strong]}>{props.value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: spacing.xl, alignItems: "center", backgroundColor: colors.background },
  card: { width: "100%", maxWidth: 560 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  label: { fontSize: font.md, color: colors.textMuted },
  strong: { fontSize: font.lg, fontWeight: "700", color: colors.text }
});
