import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { readModel, type Product } from "../data/readModel";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import {
  cancelInflow,
  listInflows,
  periodRange,
  recordInflow,
  stockReport,
  stockReportCsv,
  type Inflow,
  type ReportPeriod,
  type StockReport
} from "../standalone/inventory";
import { EmptyState, Fab, Icon, IconButton, ListItem, Sheet } from "../ui/appKit";
import { Badge, Banner, Button, Field, Muted } from "../ui/components";
import { useLayout } from "../ui/layout";
import { colors, font, radius, spacing } from "../ui/theme";

const digits = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0;
const isService = (product: Product) => product.category.trim().toLowerCase() === "services";

// ----- inflow list -------------------------------------------------------------------

export function InflowSection() {
  const { platform, tenant, dataVersion } = useApp();
  const [inflows, setInflows] = useState<Inflow[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Inflow | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    void listInflows(platform).then(setInflows);
  }, [platform, dataVersion]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        <Muted>Record goods you receive (deliveries, purchases). Each inflow adds to the products' quantities.</Muted>
      </View>
      <FlatList
        data={inflows}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={<EmptyState icon="download-outline" title="No inflows yet" message="When stock arrives, record it here to add it to your quantities." action={<Button label="Record inflow" onPress={() => setCreating(true)} />} />}
        renderItem={({ item }) => (
          <ListItem
            icon="download-outline"
            title={`${item.number}${item.supplier ? ` · ${item.supplier}` : ""}`}
            subtitle={`${new Date(item.createdAt).toLocaleString()} · ${item.lines.length} product${item.lines.length === 1 ? "" : "s"} · ${item.totalQuantity} units${item.totalCost ? ` · ${formatMoney(item.totalCost, currency)}` : ""}`}
            muted={Boolean(item.cancelled)}
            onPress={() => setOpen(item)}
            right={item.cancelled ? <Badge label="Cancelled" tone="neutral" /> : <Badge label={`+${item.totalQuantity}`} tone="success" />}
          />
        )}
      />
      <Fab label="Inflow" icon="add" onPress={() => setCreating(true)} />
      {creating ? <InflowSheet onClose={() => setCreating(false)} /> : null}
      {open ? <InflowDetailSheet inflow={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

interface DraftLine {
  product: Product;
  quantity: string;
  unitCost: string;
}

function InflowSheet(props: { onClose(): void; initialProduct?: Product }) {
  const { platform, settings, staff, tenant, refresh, permissions } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(props.initialProduct ? [{ product: props.initialProduct, quantity: "", unitCost: props.initialProduct.cost ? String(props.initialProduct.cost) : "" }] : []);
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";
  const showCosts = permissions.has("reports.profit.view") || permissions.has("catalog.manage");

  useEffect(() => {
    if (settings) void readModel.products(platform.db, settings.branchId, { includeArchived: true }).then((all) => setProducts(all.filter((product) => !isService(product))));
  }, [platform, settings]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => !lines.some((line) => line.product.id === product.id))
      .filter((product) => product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term) || product.barcode.includes(term))
      .slice(0, 8);
  }, [products, search, lines]);

  const add = (product: Product) => {
    setLines((current) => [...current, { product, quantity: "", unitCost: product.cost ? String(product.cost) : "" }]);
    setSearch("");
  };
  const update = (productId: string, patch: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.product.id === productId ? { ...line, ...patch } : line)));

  const units = lines.reduce((sum, line) => sum + digits(line.quantity), 0);
  const cost = lines.reduce((sum, line) => sum + digits(line.quantity) * digits(line.unitCost), 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordInflow(platform, {
        supplier,
        reference,
        note,
        updateCost,
        staffId: staff!.id,
        lines: lines.map((line) => ({ productId: line.product.id, quantity: digits(line.quantity), unitCost: line.unitCost.trim() ? digits(line.unitCost) : undefined }))
      });
      await refresh();
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Record inflow"
      onClose={props.onClose}
      footer={<Button label={units ? `Add ${units} unit${units === 1 ? "" : "s"} to stock` : "Add to stock"} busy={busy} disabled={!lines.length} onPress={() => void save()} style={{ flex: 1 }} />}
    >
      <View style={styles.searchWrap}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Find a product to add" placeholderTextColor={colors.textMuted} style={styles.search} />
      </View>
      {matches.map((product) => (
        <Pressable key={product.id} onPress={() => add(product)} style={styles.match}>
          <Icon name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.matchName}>{product.name}</Text>
          <Text style={styles.matchMeta}>{product.stock} in stock</Text>
        </Pressable>
      ))}
      {search.trim() && !matches.length ? <Muted>No matching products. Add new products under Manage → Products first.</Muted> : null}

      {lines.length === 0 ? <Muted>Search above and tap products to add them to this inflow.</Muted> : null}
      {lines.map((line) => (
        <View key={line.product.id} style={styles.line}>
          <View style={styles.lineHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{line.product.name}</Text>
              <Text style={styles.matchMeta}>Now {line.product.stock}{digits(line.quantity) ? ` → ${line.product.stock + digits(line.quantity)}` : ""}</Text>
            </View>
            <IconButton icon="trash-outline" label={`Remove ${line.product.name}`} tone="danger" onPress={() => setLines((current) => current.filter((item) => item.product.id !== line.product.id))} />
          </View>
          <View style={styles.twoColumns}>
            <View style={styles.column}><Field label="Quantity received" value={line.quantity} onChangeText={(value) => update(line.product.id, { quantity: value })} keyboardType="number-pad" /></View>
            {showCosts ? <View style={styles.column}><Field label="Cost per unit" value={line.unitCost} onChangeText={(value) => update(line.product.id, { unitCost: value })} keyboardType="number-pad" placeholder="Optional" /></View> : null}
          </View>
        </View>
      ))}

      {lines.length ? (
        <>
          <View style={styles.twoColumns}>
            <View style={styles.column}><Field label="Supplier" value={supplier} onChangeText={setSupplier} placeholder="Optional" /></View>
            <View style={styles.column}><Field label="Invoice / waybill no." value={reference} onChangeText={setReference} placeholder="Optional" /></View>
          </View>
          <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
          {showCosts ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Update products' cost price</Text>
              <Switch value={updateCost} onValueChange={setUpdateCost} />
            </View>
          ) : null}
          <View style={styles.totals}>
            <Text style={styles.totalText}>{lines.length} product{lines.length === 1 ? "" : "s"} · {units} units</Text>
            {showCosts && cost ? <Text style={styles.totalText}>{formatMoney(cost, currency)}</Text> : null}
          </View>
        </>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

function InflowDetailSheet(props: { inflow: Inflow; onClose(): void }) {
  const { platform, staff, tenant, refresh } = useApp();
  const { inflow } = props;
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";

  const cancel = () =>
    Alert.alert("Cancel this inflow?", "The quantities it added are taken back out of stock.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel inflow",
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await cancelInflow(platform, inflow.id, staff!.id, reason);
              await refresh();
              props.onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
              setBusy(false);
            }
          })()
      }
    ]);

  return (
    <Sheet
      title={inflow.number}
      onClose={props.onClose}
      footer={
        inflow.cancelled ? undefined : cancelling ? (
          <>
            <Button label="Back" variant="secondary" onPress={() => setCancelling(false)} />
            <Button label="Cancel inflow" variant="danger" busy={busy} disabled={reason.trim().length < 3} onPress={cancel} style={{ flex: 1 }} />
          </>
        ) : (
          <Button label="Cancel inflow" variant="danger" onPress={() => setCancelling(true)} style={{ flex: 1 }} />
        )
      }
    >
      <Muted>
        {new Date(inflow.createdAt).toLocaleString()}
        {inflow.supplier ? ` · ${inflow.supplier}` : ""}
        {inflow.reference ? ` · Ref ${inflow.reference}` : ""}
      </Muted>
      {inflow.note ? <Text style={styles.lineName}>{inflow.note}</Text> : null}
      {inflow.lines.map((line) => (
        <View key={line.productId} style={styles.detailRow}>
          <Text style={[styles.lineName, { flex: 1 }]}>{line.productName}</Text>
          <Text style={styles.detailQty}>+{line.quantity}</Text>
          {line.unitCost !== null ? <Text style={styles.matchMeta}>@ {formatMoney(line.unitCost, currency)}</Text> : null}
        </View>
      ))}
      <View style={styles.totals}>
        <Text style={styles.totalText}>{inflow.totalQuantity} units</Text>
        {inflow.totalCost ? <Text style={styles.totalText}>{formatMoney(inflow.totalCost, currency)}</Text> : null}
      </View>
      {inflow.cancelled ? <Banner tone="info" message={`Cancelled ${new Date(inflow.cancelled.at).toLocaleString()}: ${inflow.cancelled.reason}`} /> : null}
      {cancelling ? <Field label="Reason for cancelling" value={reason} onChangeText={setReason} placeholder="e.g. Entered twice" autoFocus /> : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

// ----- report ---------------------------------------------------------------------------

const periods: { key: ReportPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
  { key: "all", label: "All time" }
];

export function StockReportSection() {
  const { platform, tenant, permissions, dataVersion } = useApp();
  const { compact } = useLayout();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [report, setReport] = useState<StockReport | null>(null);
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";
  const showMoney = permissions.has("reports.profit.view");

  useEffect(() => {
    setError(null);
    stockReport(platform, periodRange(period)).then(setReport, (cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [platform, period, dataVersion]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (report?.rows ?? [])
      .filter((row) => !onlyActive || row.inflow || row.sold || row.adjusted)
      .filter((row) => !term || row.name.toLowerCase().includes(term) || row.category.toLowerCase().includes(term));
  }, [report, search, onlyActive]);

  const share = () => {
    if (!report) return;
    const label = periods.find((item) => item.key === period)?.label ?? period;
    void Share.share({ title: `Stock report - ${label}`, message: `${tenant?.settings.businessName ?? ""} stock report (${label})\n\n${stockReportCsv(report, { includeCosts: showMoney })}` });
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {periods.map((item) => (
          <Pressable key={item.key} onPress={() => setPeriod(item.key)} style={[styles.chip, period === item.key && styles.chipActive]}>
            <Text style={[styles.chipLabel, period === item.key && { color: colors.primaryText }]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {error ? <Banner tone="danger" message={error} /> : null}
      {report ? (
        <>
          <View style={styles.cards}>
            <Card label="Inflow" value={`+${report.totals.inflow}`} detail="units in" tone="success" />
            <Card label="Sold" value={`${report.totals.sold}`} detail="units out" tone="primary" />
            <Card label="Adjusted" value={`${report.totals.adjusted > 0 ? "+" : ""}${report.totals.adjusted}`} detail="damaged / recounts" tone="neutral" />
            {showMoney ? <Card label="Inflow cost" value={formatMoney(report.totals.inflowCost, currency)} detail="value received" tone="neutral" /> : null}
            {showMoney ? <Card label="Sales value" value={formatMoney(report.totals.salesValue, currency)} detail="before tax" tone="neutral" /> : null}
            {showMoney ? <Card label="Stock value" value={formatMoney(report.totals.stockValue, currency)} detail="at cost, end of period" tone="neutral" /> : null}
          </View>
          {report.mismatched.length ? (
            <Banner tone="warning" message={`Stock history does not add up for: ${report.mismatched.join(", ")}. Do a stock count and correct with Stock → Remove/Received.`} />
          ) : null}

          <View style={styles.reportTools}>
            <View style={[styles.searchWrap, { flex: 1, minWidth: 180 }]}>
              <Icon name="search" size={18} color={colors.textMuted} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Filter products" placeholderTextColor={colors.textMuted} style={styles.search} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Only with activity</Text>
              <Switch value={onlyActive} onValueChange={setOnlyActive} />
            </View>
            <Button label="Share" variant="secondary" onPress={share} />
          </View>

          {rows.length === 0 ? (
            <EmptyState icon="bar-chart-outline" title="Nothing to show" message={onlyActive ? "No inflow, sales or adjustments in this period. Turn off “Only with activity” to see all stock." : "No products yet."} />
          ) : compact ? (
            <View style={styles.table}>
              {rows.map((row) => (
                <View key={row.productId} style={styles.cardRow}>
                  <View style={styles.cardRowHeader}>
                    <Text style={styles.lineName} numberOfLines={1}>{row.name}</Text>
                    {row.tracked ? <Text style={styles.closing}>{row.closing}</Text> : <Badge label="Service" tone="info" />}
                  </View>
                  <View style={styles.flow}>
                    {row.tracked ? <Flow label="Open" value={row.opening} /> : null}
                    <Flow label="In" value={row.inflow} sign="+" color={colors.success} />
                    <Flow label="Sold" value={row.sold} sign="−" color={colors.primary} />
                    {row.tracked ? <Flow label="Adj" value={row.adjusted} sign={row.adjusted > 0 ? "+" : ""} color={colors.warning} /> : null}
                    {row.tracked ? <Flow label="Close" value={row.closing} strong /> : null}
                  </View>
                  {showMoney && (row.inflowCost || row.salesValue) ? (
                    <Text style={styles.matchMeta}>In {formatMoney(row.inflowCost, currency)} · Sales {formatMoney(row.salesValue, currency)}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHead]}>
                <Text style={[styles.cellName, styles.headText]}>Product</Text>
                {["Opening", "Inflow", "Sold", "Adjusted", "Closing"].map((label) => <Text key={label} style={[styles.cell, styles.headText]}>{label}</Text>)}
                {showMoney ? <Text style={[styles.cellMoney, styles.headText]}>Inflow cost</Text> : null}
                {showMoney ? <Text style={[styles.cellMoney, styles.headText]}>Sales value</Text> : null}
              </View>
              {rows.map((row) => (
                <View key={row.productId} style={styles.tableRow}>
                  <Text style={styles.cellName} numberOfLines={1}>{row.name}{row.archived ? " (archived)" : ""}</Text>
                  <Text style={styles.cell}>{row.tracked ? row.opening : "–"}</Text>
                  <Text style={[styles.cell, { color: colors.success }]}>{row.inflow ? `+${row.inflow}` : 0}</Text>
                  <Text style={styles.cell}>{row.sold}</Text>
                  <Text style={styles.cell}>{row.tracked ? row.adjusted : "–"}</Text>
                  <Text style={[styles.cell, { fontWeight: "700" }]}>{row.tracked ? row.closing : "–"}</Text>
                  {showMoney ? <Text style={styles.cellMoney}>{formatMoney(row.inflowCost, currency)}</Text> : null}
                  {showMoney ? <Text style={styles.cellMoney}>{formatMoney(row.salesValue, currency)}</Text> : null}
                </View>
              ))}
              <View style={[styles.tableRow, styles.tableHead]}>
                <Text style={[styles.cellName, styles.headText]}>Total</Text>
                <Text style={styles.cell} />
                <Text style={[styles.cell, styles.headText]}>+{report.totals.inflow}</Text>
                <Text style={[styles.cell, styles.headText]}>{report.totals.sold}</Text>
                <Text style={[styles.cell, styles.headText]}>{report.totals.adjusted}</Text>
                <Text style={styles.cell} />
                {showMoney ? <Text style={[styles.cellMoney, styles.headText]}>{formatMoney(report.totals.inflowCost, currency)}</Text> : null}
                {showMoney ? <Text style={[styles.cellMoney, styles.headText]}>{formatMoney(report.totals.salesValue, currency)}</Text> : null}
              </View>
            </View>
          )}
          <Muted>Closing = opening + inflow − sold ± adjustments. Sold is net of voided sales. Opening stock entered when a product is created counts as inflow.</Muted>
        </>
      ) : null}
    </ScrollView>
  );
}

function Card(props: { label: string; value: string; detail: string; tone: "success" | "primary" | "neutral" }) {
  const accent = props.tone === "success" ? colors.success : props.tone === "primary" ? colors.primary : colors.text;
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{props.label}</Text>
      <Text style={[styles.cardValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>{props.value}</Text>
      <Text style={styles.cardDetail}>{props.detail}</Text>
    </View>
  );
}

function Flow(props: { label: string; value: number; sign?: string; color?: string; strong?: boolean }) {
  return (
    <View style={styles.flowItem}>
      <Text style={styles.flowLabel}>{props.label}</Text>
      <Text style={[styles.flowValue, props.color ? { color: props.color } : null, props.strong && { fontWeight: "800" }]}>
        {props.value && props.sign && props.sign !== "+" ? `${props.sign}${Math.abs(props.value)}` : props.value && props.sign === "+" ? `+${props.value}` : props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  toolbar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  separator: { height: 1, backgroundColor: colors.surfaceMuted, marginLeft: spacing.lg },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  search: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: spacing.sm },
  match: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  matchName: { flex: 1, fontSize: font.md, color: colors.text },
  matchMeta: { fontSize: font.sm, color: colors.textMuted },
  line: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  lineHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lineName: { fontSize: font.md, fontWeight: "600", color: colors.text },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  column: { flex: 1, minWidth: 130 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  switchLabel: { fontSize: font.md, color: colors.text },
  totals: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.surfaceMuted, padding: spacing.md, borderRadius: radius.md },
  totalText: { fontSize: font.md, fontWeight: "700", color: colors.text },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  detailQty: { fontSize: font.md, fontWeight: "700", color: colors.success },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { flexGrow: 1, flexBasis: 140, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  cardLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: "600" },
  cardValue: { fontSize: font.xl, fontWeight: "800" },
  cardDetail: { fontSize: 12, color: colors.textMuted },
  reportTools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  table: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  cardRow: { padding: spacing.md, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  cardRowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  closing: { fontSize: font.lg, fontWeight: "800", color: colors.text },
  flow: { flexDirection: "row", gap: spacing.sm },
  flowItem: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingVertical: 4 },
  flowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  flowValue: { fontSize: font.md, fontWeight: "700", color: colors.text },
  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  tableHead: { backgroundColor: colors.surfaceMuted },
  headText: { fontWeight: "700", color: colors.text },
  cellName: { flex: 3, fontSize: font.md, color: colors.text },
  cell: { flex: 1, textAlign: "right", fontSize: font.md, color: colors.text },
  cellMoney: { flex: 1.6, textAlign: "right", fontSize: font.md, color: colors.text }
});
