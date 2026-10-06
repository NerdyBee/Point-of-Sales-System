import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { readModel, type ServerShift } from "../data/readModel";
import { currentShift, openShift, requestCloseShift, shiftHistory, type LocalShift, type ShiftHistoryRow } from "../pos/actions";
import { formatMoney } from "../pos/pricing";
import { isStandalone } from "../sync/settings";
import { Badge, Banner, Button, Card, Field, Muted, Title } from "../ui/components";
import { Icon } from "../ui/appKit";
import { colors, font, radius, spacing } from "../ui/theme";

export function RegisterScreen(props: { onOpened: () => void }) {
  const { platform, settings, staff, tenant, permissions, dataVersion, refresh, engine } = useApp();
  const standalone = isStandalone(settings);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
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

  const run = async (work: () => Promise<unknown>) => {
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
          {closedMessage ? <Banner tone="info" message={closedMessage} /> : null}
          <Title>Open register</Title>
          <Muted>Count the float in the drawer before you start.</Muted>
          <Field label="Opening float" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0" />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button label="Open register" busy={busy} disabled={!amount} large onPress={() => void run(async () => { await openShift(platform, staff, value); props.onOpened(); })} />
        </Card>
        <ShiftHistory currency={currency} />
      </ScrollView>
    );
  }

  // The server's expected cash includes every sale it has processed; until then use the local tally.
  const cashIn = Number(shift.cashIn ?? 0);
  const expected = serverShift ? Number(serverShift.expectedCash) : shift.openingBalance + shift.cashSales + cashIn;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Title>Register</Title>
          <Badge label={shift.status === "closing" ? "Awaiting manager" : shift.serverId ? "Open" : "Open (not yet synced)"} tone={shift.status === "closing" ? "warning" : shift.serverId ? "success" : "info"} />
        </View>
        <Line label="Opened" value={new Date(shift.openedAt).toLocaleString()} />
        <Line label="Opening float" value={formatMoney(shift.openingBalance, currency)} />
        <Line label="Cash sales on this device" value={formatMoney(shift.cashSales, currency)} />
        {cashIn ? <Line label="Customer payments (cash)" value={formatMoney(cashIn, currency)} /> : null}
        <Line label="Expected cash in drawer" value={formatMoney(expected, currency)} strong />

        {shift.status === "closing" ? (
          <Banner tone="info" message={`Count of ${formatMoney(shift.countedCash ?? 0, currency)} sent. A manager approves and closes the shift in the web app; this tablet updates on the next sync.`} />
        ) : (
          <>
            <Field label="Counted cash" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="Count the drawer" />
            {amount ? <Muted>Difference: {formatMoney(value - expected, currency)}</Muted> : null}
            <Field label="Note (optional)" value={note} onChangeText={setNote} />
            {error ? <Banner tone="danger" message={error} /> : null}
            <Button
              label={standalone ? "Close register" : "Submit count and close"}
              variant="danger"
              busy={busy}
              disabled={!amount || (standalone && !permissions.has("register.close"))}
              onPress={() =>
                void run(async () => {
                  const result = await requestCloseShift(platform, staff, value, note);
                  if (result.closed) {
                    const difference = value - result.expected;
                    setClosedMessage(`Register closed. Expected ${formatMoney(result.expected, currency)}, counted ${formatMoney(value, currency)}${difference ? ` (${difference > 0 ? "over" : "short"} by ${formatMoney(Math.abs(difference), currency)})` : " - balanced"}.`);
                  }
                })
              }
            />
            {standalone && !permissions.has("register.close") ? <Muted>Ask an owner or manager to close the register.</Muted> : null}
          </>
        )}
      </Card>
      <ShiftHistory currency={currency} excludeId={shift.id} />
    </ScrollView>
  );
}

/** Closed shifts on this device with their over/short result. */
function ShiftHistory(props: { currency: string; excludeId?: string }) {
  const { platform, dataVersion } = useApp();
  const [shifts, setShifts] = useState<ShiftHistoryRow[]>([]);

  useEffect(() => {
    void shiftHistory(platform).then((rows) => setShifts(rows.filter((row) => row.id !== props.excludeId)));
  }, [platform, dataVersion, props.excludeId]);

  if (!shifts.length) return null;
  return (
    <View style={styles.history}>
      <Text style={styles.historyTitle}>Past shifts</Text>
      {shifts.map((row) => {
        const expected = row.openingBalance + row.cashSales + Number(row.cashIn ?? 0);
        const difference = row.countedCash === null ? null : row.countedCash - expected;
        return (
          <View key={row.id} style={styles.historyRow}>
            <Icon name="cash-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.historyMain}>{new Date(row.openedAt).toLocaleDateString()} · {row.sales} sales · {formatMoney(row.salesTotal, props.currency)}</Text>
              <Text style={styles.historyMeta}>
                {new Date(row.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {row.closedAt ? ` – ${new Date(row.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""} · float {formatMoney(row.openingBalance, props.currency)}
              </Text>
            </View>
            {row.status === "closed" && difference !== null ? (
              <Badge
                label={difference === 0 ? "Balanced" : `${difference > 0 ? "Over" : "Short"} ${formatMoney(Math.abs(difference), props.currency)}`}
                tone={difference === 0 ? "success" : difference > 0 ? "info" : "danger"}
              />
            ) : (
              <Badge label={row.status === "closing" ? "Awaiting manager" : row.status} tone="warning" />
            )}
          </View>
        );
      })}
    </View>
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
  page: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, alignItems: "center", backgroundColor: colors.background },
  history: { width: "100%", maxWidth: 560, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  historyTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.surfaceMuted },
  historyMain: { fontSize: font.md, color: colors.text, fontWeight: "600" },
  historyMeta: { fontSize: font.sm, color: colors.textMuted },
  card: { width: "100%", maxWidth: 560 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  label: { fontSize: font.md, color: colors.textMuted },
  strong: { fontSize: font.lg, fontWeight: "700", color: colors.text }
});
