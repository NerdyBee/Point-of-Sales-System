import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { daySummary, recentSales, type LocalSale, type SaleRecord } from "../pos/actions";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import { voidSale } from "../standalone/business";
import { isStandalone } from "../sync/settings";
import { EmptyState, Sheet } from "../ui/appKit";
import { printReceipt, printingAvailable, receiptFromSale, shareReceipt } from "../print/printer";
import { Badge, Banner, Button, Field, Muted } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

const methodNames: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Transfer", mobile_money: "Mobile money", customer_credit: "On account" };

type SaleWithRecord = LocalSale & { record: SaleRecord & { voided?: { at: string; reason: string } } };

function statusBadge(status: LocalSale["status"]) {
  switch (status) {
    case "saved":
      return <Badge label="Saved" tone="success" />;
    case "synced":
      return <Badge label="Synced" tone="success" />;
    case "voided":
      return <Badge label="Voided" tone="neutral" />;
    case "conflict":
      return <Badge label="Needs review" tone="danger" />;
    default:
      return <Badge label="Waiting to sync" tone="warning" />;
  }
}

export function SalesScreen() {
  const { platform, tenant, dataVersion } = useApp();
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [today, setToday] = useState<Awaited<ReturnType<typeof daySummary>> | null>(null);
  const [filter, setFilter] = useState<"all" | "today" | "voided">("all");
  const [open, setOpen] = useState<SaleWithRecord | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    void recentSales(platform, 200).then(setSales);
    void daySummary(platform).then(setToday);
  }, [platform, dataVersion]);

  const rows = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return sales
      .filter((sale) => (filter === "voided" ? sale.status === "voided" : filter === "today" ? Date.parse(sale.createdAt) >= startOfDay.getTime() : true))
      .map((sale) => ({ ...sale, record: JSON.parse(sale.data) }) as SaleWithRecord);
  }, [sales, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {today ? (
              <View style={styles.summary}>
                <Summary label="Today" value={formatMoney(today.total, currency)} strong />
                <Summary label="Sales" value={String(today.count)} />
                <Summary label="Items" value={String(today.items)} />
                {Object.entries(today.byMethod).map(([method, amount]) => (
                  <Summary key={method} label={methodNames[method] ?? method} value={formatMoney(amount, currency)} />
                ))}
              </View>
            ) : null}
            <View style={styles.filters}>
              {(["all", "today", "voided"] as const).map((item) => (
                <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.filterActive]}>
                  <Text style={[styles.filterLabel, filter === item && { color: colors.primaryText }]}>{item === "all" ? "All" : item === "today" ? "Today" : "Voided"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="receipt-outline" title={filter === "voided" ? "No voided sales" : "No sales yet"} message={filter === "all" ? "Sales you complete on this device appear here." : undefined} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpen(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]} accessibilityRole="button">
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.number, item.status === "voided" && styles.struck]}>{item.serverId ?? item.number}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {new Date(item.createdAt).toLocaleString()} · {item.record.staffName}
                {item.record.customer ? ` · ${item.record.customer.name}` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={[styles.total, item.status === "voided" && styles.struck]}>{formatMoney(item.total, currency)}</Text>
              {statusBadge(item.status)}
            </View>
          </Pressable>
        )}
      />
      {open ? <SaleSheet sale={open} currency={currency} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

function SaleSheet(props: { sale: SaleWithRecord; currency: string; onClose(): void }) {
  const { platform, settings, staff, permissions, refresh, tenant } = useApp();
  const { sale, currency } = props;
  const { summary, payments, customer, staffName, voided } = sale.record;
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canVoid = isStandalone(settings) && sale.status === "saved" && permissions.has("sale.void");
  const [printStatus, setPrintStatus] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [printing, setPrinting] = useState(false);
  const receiptData = tenant ? receiptFromSale(sale, sale.record, tenant.settings, { reprint: true }) : null;

  const print = async () => {
    if (!receiptData) return;
    setPrinting(true);
    setPrintStatus(null);
    try {
      await printReceipt(platform, receiptData);
      setPrintStatus({ tone: "info", text: "Receipt sent to the printer." });
    } catch (cause) {
      setPrintStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPrinting(false);
    }
  };

  const doVoid = () =>
    Alert.alert("Void this sale?", "Stock is put back and the sale no longer counts in totals. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Void sale",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await voidSale(platform, sale.id, staff!.id, reason);
              await refresh();
              props.onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setBusy(false);
            }
          })()
      }
    ]);

  return (
    <Sheet
      title={`Sale ${sale.serverId ?? sale.number}`}
      onClose={props.onClose}
      footer={
        canVoid ? (
          voiding ? (
            <>
              <Button label="Back" variant="secondary" onPress={() => setVoiding(false)} />
              <Button label="Void sale" variant="danger" busy={busy} disabled={reason.trim().length < 3} onPress={doVoid} style={{ flex: 1 }} />
            </>
          ) : (
            <Button label="Void sale" variant="danger" onPress={() => setVoiding(true)} style={{ flex: 1 }} />
          )
        ) : undefined
      }
    >
      <View style={styles.receipt}>
        <Text style={styles.receiptTitle}>{tenant?.settings.businessName}</Text>
        <Text style={styles.receiptMeta}>{new Date(sale.createdAt).toLocaleString()} · {staffName}</Text>
        {customer ? <Text style={styles.receiptMeta}>Customer: {customer.name} ({customer.phone})</Text> : null}
        <View style={styles.divider} />
        {summary.lines.map((line) => (
          <View key={line.productId} style={styles.lineRow}>
            <Text style={styles.lineText} numberOfLines={2}>{line.quantity} × {line.name}</Text>
            <Text style={styles.lineText}>{formatMoney(line.subtotal, currency)}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        {summary.discount ? <Row label="Discount" value={`−${formatMoney(summary.discount, currency)}`} /> : null}
        <Row label="VAT" value={formatMoney(summary.vat, currency)} />
        {summary.serviceCharge ? <Row label="Service charge" value={formatMoney(summary.serviceCharge, currency)} /> : null}
        <Row label="Total" value={formatMoney(summary.total, currency)} strong />
        {payments.map((payment, index) => (
          <Row key={index} label={`${methodNames[payment.method] ?? payment.method}${payment.reference ? ` (${payment.reference})` : ""}`} value={formatMoney(payment.amount, currency)} />
        ))}
        {sale.record.credit ? <Row label="Account balance after" value={formatMoney(sale.record.credit.balanceAfter, currency)} /> : null}
      </View>
      {receiptData ? (
        <View style={styles.printRow}>
          {printingAvailable() ? <Button label="Print receipt" variant="secondary" busy={printing} onPress={() => void print()} style={{ flex: 1 }} /> : null}
          <Button label="Share" variant="secondary" onPress={() => void shareReceipt(receiptData)} style={{ flex: 1 }} />
        </View>
      ) : null}
      {printStatus ? <Banner tone={printStatus.tone} message={printStatus.text} /> : null}
      <View style={styles.statusRow}>
        <Muted>Status</Muted>
        {statusBadge(sale.status)}
      </View>
      {voided ? <Banner tone="info" message={`Voided ${new Date(voided.at).toLocaleString()}: ${voided.reason}`} /> : null}
      {sale.status === "conflict" ? <Banner tone="danger" message="The server could not record this sale. A manager can review it in the web app's Sync monitor." /> : null}
      {!isStandalone(settings) && sale.status !== "voided" ? <Muted>Voids and refunds for synced sales are done by a manager in the web app.</Muted> : null}
      {voiding ? <Field label="Reason for voiding" value={reason} onChangeText={setReason} placeholder="e.g. Wrong item rung up" autoFocus /> : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

function Summary(props: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.summaryItem, props.strong && styles.summaryStrong]}>
      <Text style={[styles.meta, props.strong && { color: colors.primaryText }]}>{props.label}</Text>
      <Text style={[styles.number, props.strong && { color: colors.primaryText, fontSize: font.lg }]}>{props.value}</Text>
    </View>
  );
}

function Row(props: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.lineRow}>
      <Text style={[styles.lineText, props.strong && styles.strong]}>{props.label}</Text>
      <Text style={[styles.lineText, props.strong && styles.strong]}>{props.value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryItem: { flexGrow: 1, minWidth: 100, gap: 2, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  summaryStrong: { backgroundColor: colors.primary, borderColor: colors.primary, minWidth: 160 },
  filters: { flexDirection: "row", gap: spacing.sm },
  filter: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  number: { fontSize: font.md, fontWeight: "700", color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
  total: { fontSize: font.md, fontWeight: "700", color: colors.text },
  struck: { textDecorationLine: "line-through", color: colors.textMuted },
  receipt: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  receiptTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text, textAlign: "center" },
  receiptMeta: { fontSize: font.sm, color: colors.textMuted, textAlign: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  lineRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  lineText: { fontSize: font.md, color: colors.text, flexShrink: 1 },
  strong: { fontWeight: "700", fontSize: font.lg },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  printRow: { flexDirection: "row", gap: spacing.sm }
});
