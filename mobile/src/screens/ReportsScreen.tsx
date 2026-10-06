import RNDateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useEffect, useMemo, useState } from "react";
import { Platform as RNPlatform, Pressable, ScrollView, SectionList, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import {
  dayRange,
  periodRange,
  productMovements,
  stockReport,
  stockReportCsv,
  type ProductMovement,
  type ReportPeriod,
  type StockReport,
  type StockReportRow
} from "../standalone/inventory";
import { EmptyState, Icon, Sheet } from "../ui/appKit";
import { Banner, Button, Muted } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

const quickRanges: { key: Exclude<ReportPeriod, "all">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" }
];

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Stock movement report: opening, out, in and closing quantity per product for any dates. */
export function ReportsScreen() {
  const { platform, tenant, permissions, dataVersion } = useApp();
  const [fromDay, setFromDay] = useState(startOfToday);
  const [toDay, setToDay] = useState(startOfToday);
  const [quick, setQuick] = useState<string | null>("today");
  const [report, setReport] = useState<StockReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [detail, setDetail] = useState<StockReportRow | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";
  const showMoney = permissions.has("reports.profit.view");
  const range = useMemo(() => dayRange(fromDay, toDay), [fromDay, toDay]);

  useEffect(() => {
    setError(null);
    stockReport(platform, range).then(setReport, (cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [platform, range, dataVersion]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (report?.rows ?? [])
      .filter((row) => row.tracked)
      .filter((row) => !onlyActive || row.stockIn || row.stockOut)
      .filter((row) => !term || row.name.toLowerCase().includes(term) || row.category.toLowerCase().includes(term));
  }, [report, search, onlyActive]);

  const totals = useMemo(
    () => rows.reduce((sum, row) => ({ opening: sum.opening + row.opening, out: sum.out + row.stockOut, in: sum.in + row.stockIn, closing: sum.closing + row.closing }), { opening: 0, out: 0, in: 0, closing: 0 }),
    [rows]
  );

  const applyQuick = (key: Exclude<ReportPeriod, "all">) => {
    const { from, to } = periodRange(key);
    const last = new Date(to.getTime() - 1);
    setQuick(key);
    setFromDay(new Date(from.getFullYear(), from.getMonth(), from.getDate()));
    setToDay(new Date(last.getFullYear(), last.getMonth(), last.getDate()));
  };

  const setDay = (which: "from" | "to", date: Date) => {
    setQuick(null);
    if (which === "from") setFromDay(date);
    else setToDay(date);
  };

  const openPicker = (which: "from" | "to") => {
    const value = which === "from" ? fromDay : toDay;
    if (RNPlatform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode: "date",
        maximumDate: new Date(),
        onValueChange: (_event, date) => setDay(which, date)
      });
    } else {
      setPicking(which);
    }
  };

  const share = () => {
    if (!report) return;
    const title = `Stock report ${formatDay(fromDay)} - ${formatDay(toDay)}`;
    void Share.share({ title, message: `${tenant?.settings.businessName ?? ""} - ${title}\n\n${stockReportCsv(report, { includeCosts: showMoney })}` });
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.dates}>
        <DateButton label="From" value={formatDay(fromDay)} onPress={() => openPicker("from")} />
        <Icon name="arrow-forward" size={18} color={colors.textMuted} />
        <DateButton label="To" value={formatDay(toDay)} onPress={() => openPicker("to")} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {quickRanges.map((item) => (
          <Pressable key={item.key} onPress={() => applyQuick(item.key)} style={[styles.chip, quick === item.key && styles.chipActive]}>
            <Text style={[styles.chipLabel, quick === item.key && { color: colors.primaryText }]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {error ? <Banner tone="danger" message={error} /> : null}
      {report ? (
        <>
          <View style={styles.summary}>
            <Summary label="Opening" value={totals.opening} />
            <Summary label="Out" value={totals.out} color={colors.danger} />
            <Summary label="In" value={totals.in} color={colors.success} />
            <Summary label="Closing" value={totals.closing} strong />
          </View>
          {showMoney ? (
            <Muted>
              Received {formatMoney(report.totals.inflowCost, currency)} at cost · Sales {formatMoney(report.totals.salesValue, currency)} · Stock value {formatMoney(report.totals.stockValue, currency)}
            </Muted>
          ) : null}
          {report.mismatched.length ? <Banner tone="warning" message={`History does not add up for: ${report.mismatched.join(", ")}. Do a stock count.`} /> : null}
        </>
      ) : null}

      <View style={styles.tools}>
        <View style={styles.searchWrap}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Filter products" placeholderTextColor={colors.textMuted} style={styles.search} />
        </View>
        <View style={styles.toggle}>
          <Text style={styles.toggleLabel}>Moved only</Text>
          <Switch value={onlyActive} onValueChange={setOnlyActive} />
        </View>
        <Button label="Share" variant="secondary" onPress={share} disabled={!report} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionList
        sections={[{ key: "products", data: rows }]}
        keyExtractor={(item) => item.productId}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        renderSectionHeader={() => (
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.nameCell, styles.headText]}>Product</Text>
            <Text style={[styles.numCell, styles.headText]}>Opening</Text>
            <Text style={[styles.numCell, styles.headText]}>Out</Text>
            <Text style={[styles.numCell, styles.headText]}>In</Text>
            <Text style={[styles.numCell, styles.headText]}>Closing</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => setDetail(item)} style={({ pressed }) => [styles.row, index % 2 === 1 && styles.zebra, pressed && { backgroundColor: colors.surfaceMuted }]} accessibilityRole="button">
            <View style={styles.nameCell}>
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              {item.archived ? <Text style={styles.sub}>archived</Text> : null}
            </View>
            <Text style={styles.numCell}>{item.opening}</Text>
            <Text style={[styles.numCell, item.stockOut ? { color: colors.danger } : styles.zero]}>{item.stockOut}</Text>
            <Text style={[styles.numCell, item.stockIn ? { color: colors.success } : styles.zero]}>{item.stockIn}</Text>
            <Text style={[styles.numCell, styles.closing, item.closing <= 0 && { color: colors.danger }]}>{item.closing}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          report ? (
            <EmptyState icon="bar-chart-outline" title="No products to show" message={onlyActive ? "Nothing moved in these dates. Turn off “Moved only” to see all stock." : "Add products under Manage to see them here."} />
          ) : null
        }
        ListFooterComponent={
          rows.length ? (
            <View>
              <View style={[styles.row, styles.headRow]}>
                <Text style={[styles.nameCell, styles.headText]}>Total ({rows.length})</Text>
                <Text style={[styles.numCell, styles.headText]}>{totals.opening}</Text>
                <Text style={[styles.numCell, styles.headText]}>{totals.out}</Text>
                <Text style={[styles.numCell, styles.headText]}>{totals.in}</Text>
                <Text style={[styles.numCell, styles.headText]}>{totals.closing}</Text>
              </View>
              <View style={styles.footnote}>
                <Muted>Closing = Opening + In − Out. In: inflows, opening stock of new products, recounts up. Out: sales (voided sales put back), damaged/missing, cancelled inflows. Tap a product to see its movements. Services have no stock and are not listed.</Muted>
              </View>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      />

      {picking ? (
        <Sheet title={picking === "from" ? "From date" : "To date"} onClose={() => setPicking(null)} footer={<Button label="Done" onPress={() => setPicking(null)} style={{ flex: 1 }} />}>
          <RNDateTimePicker
            value={picking === "from" ? fromDay : toDay}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            onValueChange={(_event, date) => setDay(picking, date)}
          />
        </Sheet>
      ) : null}
      {detail ? <MovementSheet row={detail} range={range} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

function DateButton(props: { label: string; value: string; onPress(): void }) {
  return (
    <Pressable onPress={props.onPress} style={({ pressed }) => [styles.dateButton, pressed && { backgroundColor: colors.surfaceMuted }]} accessibilityRole="button" accessibilityLabel={`${props.label} date ${props.value}`}>
      <Icon name="calendar-outline" size={18} color={colors.primary} />
      <View>
        <Text style={styles.dateLabel}>{props.label}</Text>
        <Text style={styles.dateValue}>{props.value}</Text>
      </View>
    </Pressable>
  );
}

function Summary(props: { label: string; value: number; color?: string; strong?: boolean }) {
  return (
    <View style={[styles.summaryItem, props.strong && styles.summaryStrong]}>
      <Text style={[styles.summaryLabel, props.strong && { color: colors.primaryText }]}>{props.label}</Text>
      <Text style={[styles.summaryValue, props.color ? { color: props.color } : null, props.strong && { color: colors.primaryText }]}>{props.value}</Text>
    </View>
  );
}

const movementLabels: Record<string, string> = {
  count: "Opening stock",
  receipt: "Inflow",
  issue: "Sale",
  return: "Voided sale",
  adjustment: "Adjustment"
};

function MovementSheet(props: { row: StockReportRow; range: { from: Date; to: Date }; onClose(): void }) {
  const { platform } = useApp();
  const [moves, setMoves] = useState<ProductMovement[] | null>(null);

  useEffect(() => {
    void productMovements(platform, props.row.productId, props.range).then(setMoves);
  }, [platform, props.row.productId, props.range]);

  return (
    <Sheet title={props.row.name} onClose={props.onClose}>
      <View style={styles.summary}>
        <Summary label="Opening" value={props.row.opening} />
        <Summary label="Out" value={props.row.stockOut} color={colors.danger} />
        <Summary label="In" value={props.row.stockIn} color={colors.success} />
        <Summary label="Closing" value={props.row.closing} strong />
      </View>
      {moves === null ? null : moves.length === 0 ? (
        <Muted>No stock movements in these dates.</Muted>
      ) : (
        moves.map((move) => (
          <View key={move.id} style={styles.moveRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{move.reason || movementLabels[move.type] || move.type}</Text>
              <Text style={styles.sub}>{new Date(move.createdAt).toLocaleString()} · {movementLabels[move.type] ?? move.type}</Text>
            </View>
            <Text style={[styles.moveDelta, { color: move.quantityDelta > 0 ? colors.success : colors.danger }]}>
              {move.quantityDelta > 0 ? "+" : ""}{move.quantityDelta}
            </Text>
            <Text style={styles.moveBalance}>{move.balanceAfter}</Text>
          </View>
        ))
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  dates: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dateLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  dateValue: { fontSize: font.md, color: colors.text, fontWeight: "700" },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  summary: { flexDirection: "row", gap: spacing.sm },
  summaryItem: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  summaryStrong: { backgroundColor: colors.primary, borderColor: colors.primary },
  summaryLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  summaryValue: { fontSize: font.lg, fontWeight: "800", color: colors.text },
  tools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  searchWrap: { flex: 1, minWidth: 160, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  search: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: spacing.sm },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  toggleLabel: { fontSize: font.sm, color: colors.text },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted, gap: spacing.xs },
  zebra: { backgroundColor: "#FAFBFC" },
  headRow: { backgroundColor: colors.surfaceMuted, paddingVertical: spacing.sm, borderBottomColor: colors.border },
  headText: { fontWeight: "700", color: colors.text, fontSize: font.sm },
  nameCell: { flex: 2.4 },
  numCell: { flex: 1, textAlign: "right", fontSize: font.md, color: colors.text, fontVariant: ["tabular-nums"] },
  zero: { color: colors.textMuted },
  closing: { fontWeight: "800" },
  name: { fontSize: font.md, color: colors.text, fontWeight: "600" },
  sub: { fontSize: 12, color: colors.textMuted },
  footnote: { padding: spacing.lg },
  moveRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  moveDelta: { fontSize: font.md, fontWeight: "700", minWidth: 44, textAlign: "right" },
  moveBalance: { fontSize: font.sm, color: colors.textMuted, minWidth: 40, textAlign: "right" }
});
