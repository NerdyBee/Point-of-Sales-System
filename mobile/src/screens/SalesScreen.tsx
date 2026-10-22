import RNDateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Image, Platform as RNPlatform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { daySummary, listSales, type LocalSale, type SaleRecord } from "../pos/actions";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import { voidSale } from "../standalone/business";
import { isStandalone } from "../sync/settings";
import { EmptyState, Sheet } from "../ui/appKit";
import { printReceipt, printingAvailable, receiptFromSale } from "../print/printer";
import { ReceiptShareSheet } from "../print/ReceiptShareSheet";
import { loadReceiptBranding } from "../print/branding";
import type { ReceiptBranding } from "../print/receipt";
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

const PAGE_SIZE = 100;

type Filter = "today" | "yesterday" | "day" | "all" | "voided";

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const sameDay = (left: Date, right: Date) => startOfDay(left).getTime() === startOfDay(right).getTime();

function parseRecord(sale: LocalSale) {
  try {
    return { ...sale, record: JSON.parse(sale.data) } as SaleWithRecord;
  } catch {
    // A damaged record must not take the whole list down.
    return { ...sale, record: { summary: { lines: [], subtotal: 0, discount: 0, vat: 0, serviceCharge: 0, total: sale.total }, payments: [], staffName: "?" } } as unknown as SaleWithRecord;
  }
}

export function SalesScreen() {
  const { platform, tenant, dataVersion } = useApp();
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof daySummary>> | null>(null);
  const [filter, setFilter] = useState<Filter>("today");
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [search, setSearch] = useState("");
  const [more, setMore] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);
  const [open, setOpen] = useState<SaleWithRecord | null>(null);
  const loadingMore = useRef(false);
  const currency = tenant?.settings.currency ?? "NGN";

  const query = useMemo(
    () => ({ day: filter === "all" || filter === "voided" ? null : day, voidedOnly: filter === "voided", search }),
    [filter, day, search]
  );

  // First page whenever the filter changes or data is saved.
  useEffect(() => {
    let current = true;
    void listSales(platform, { ...query, limit: PAGE_SIZE }).then((page) => {
      if (!current) return;
      setSales(page);
      setMore(page.length === PAGE_SIZE);
    }, () => undefined);
    if (query.day) void daySummary(platform, query.day).then((value) => current && setSummary(value), () => undefined);
    else setSummary(null);
    return () => {
      current = false;
    };
  }, [platform, dataVersion, query]);

  const loadMore = useCallback(async () => {
    if (!more || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await listSales(platform, { ...query, limit: PAGE_SIZE, offset: sales.length });
      setSales((current) => [...current, ...page]);
      setMore(page.length === PAGE_SIZE);
    } finally {
      loadingMore.current = false;
    }
  }, [more, platform, query, sales.length]);

  const rows = useMemo(() => sales.map(parseRecord), [sales]);

  const chooseDay = (date: Date) => {
    const picked = startOfDay(date);
    setDay(picked);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    setFilter(sameDay(picked, today) ? "today" : sameDay(picked, yesterday) ? "yesterday" : "day");
  };

  const choose = (item: Filter) => {
    if (item === "today") chooseDay(new Date());
    else if (item === "yesterday") {
      const today = new Date();
      chooseDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
    } else if (item === "day") {
      if (RNPlatform.OS === "android") {
        DateTimePickerAndroid.open({ value: day, mode: "date", maximumDate: new Date(), onValueChange: (_event, date) => chooseDay(date) });
      } else {
        setPickingDay(true);
      }
    } else setFilter(item);
  };

  const dayLabel = filter === "today" ? "Today" : filter === "yesterday" ? "Yesterday" : day.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const filterLabels: Record<Filter, string> = {
    today: "Today",
    yesterday: "Yesterday",
    day: filter === "day" ? dayLabel : "Pick a day…",
    all: "All",
    voided: "Voided"
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {summary && query.day ? (
              <View style={styles.summary}>
                <Summary label={dayLabel} value={formatMoney(summary.total, currency)} strong />
                <Summary label="Sales" value={String(summary.count)} />
                <Summary label="Items" value={String(summary.items)} />
                {Object.entries(summary.byMethod).map(([method, amount]) => (
                  <Summary key={method} label={methodNames[method] ?? method} value={formatMoney(amount, currency)} />
                ))}
              </View>
            ) : null}
            <View style={styles.filters}>
              {(["today", "yesterday", "day", "all", "voided"] as const).map((item) => (
                <Pressable key={item} onPress={() => choose(item)} style={[styles.filter, filter === item && styles.filterActive]}>
                  <Text style={[styles.filterLabel, filter === item && { color: colors.primaryText }]}>{filterLabels[item]}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search receipt no. or customer"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              style={styles.search}
            />
          </View>
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={more ? <Muted>Loading more sales…</Muted> : null}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title={search.trim() ? "No matching sales" : filter === "voided" ? "No voided sales" : query.day ? `No sales ${filter === "today" ? "today" : filter === "yesterday" ? "yesterday" : `on ${dayLabel}`}` : "No sales yet"}
            message={filter === "all" && !search.trim() ? "Sales you complete on this device appear here." : undefined}
          />
        }
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
      {pickingDay ? (
        <Sheet title="Show sales for" onClose={() => setPickingDay(false)} footer={<Button label="Done" onPress={() => setPickingDay(false)} style={{ flex: 1 }} />}>
          <RNDateTimePicker value={day} mode="date" display="inline" maximumDate={new Date()} onValueChange={(_event, date) => chooseDay(date)} />
        </Sheet>
      ) : null}
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
  const [branding, setBranding] = useState<ReceiptBranding>({});
  useEffect(() => {
    void loadReceiptBranding(platform, settings).then(setBranding);
  }, [platform, settings]);
  const receiptData = tenant ? receiptFromSale(sale, sale.record, tenant.settings, { reprint: true, branding }) : null;
  const [sharing, setSharing] = useState(false);

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

  if (sharing && receiptData) return <ReceiptShareSheet receipt={receiptData} onClose={() => setSharing(false)} />;

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
        {branding.logoPng ? <Image source={{ uri: `data:image/png;base64,${branding.logoPng}` }} style={styles.receiptLogo} resizeMode="contain" /> : null}
        <Text style={styles.receiptTitle}>{tenant?.settings.businessName}</Text>
        {branding.address ? <Text style={styles.receiptMeta}>{branding.address}</Text> : null}
        {branding.phone ? <Text style={styles.receiptMeta}>Tel: {branding.phone}</Text> : null}
        <Text style={styles.receiptMeta}>{new Date(sale.createdAt).toLocaleString()} · {staffName}</Text>
        {customer ? <Text style={styles.receiptMeta}>Customer: {customer.name} ({customer.phone})</Text> : null}
        <View style={styles.divider} />
        {summary.lines.map((line, index) => (
          <View key={`${line.productId}-${index}`} style={styles.lineRow}>
            <Text style={styles.lineText} numberOfLines={2}>{line.quantity} × {line.name}{line.clearance ? " (clearance)" : ""}</Text>
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
        {sale.record.credit || sale.record.customerBalance !== undefined ? <Row label="Account balance after" value={formatMoney(sale.record.credit?.balanceAfter ?? sale.record.customerBalance ?? 0, currency)} /> : null}
      </View>
      {receiptData ? (
        <View style={styles.printRow}>
          {printingAvailable() ? <Button label="Print receipt" variant="secondary" busy={printing} onPress={() => void print()} style={{ flex: 1 }} /> : null}
          <Button label="Send (WhatsApp)" variant="secondary" onPress={() => setSharing(true)} style={{ flex: 1 }} />
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
  search: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.md, color: colors.text },
  list: { padding: spacing.lg, gap: spacing.sm },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryItem: { flexGrow: 1, minWidth: 100, gap: 2, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  summaryStrong: { backgroundColor: colors.primary, borderColor: colors.primary, minWidth: 160 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filter: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  number: { fontSize: font.md, fontWeight: "700", color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
  total: { fontSize: font.md, fontWeight: "700", color: colors.text },
  struck: { textDecorationLine: "line-through", color: colors.textMuted },
  receipt: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  receiptLogo: { width: 140, height: 72, alignSelf: "center" },
  receiptTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text, textAlign: "center" },
  receiptMeta: { fontSize: font.sm, color: colors.textMuted, textAlign: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  lineRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  lineText: { fontSize: font.md, color: colors.text, flexShrink: 1 },
  strong: { fontWeight: "700", fontSize: font.lg },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  printRow: { flexDirection: "row", gap: spacing.sm }
});
