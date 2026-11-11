import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { formatMoney } from "../pos/pricing";
import { EmptyState, Sheet } from "../ui/appKit";
import { Badge, Banner, Button, Card, Field, Muted } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";
import { approveApproval, countedCashFromReason, ownerPeriods, periodWindow, rejectApproval, reportQuery, type OwnerApproval, type OwnerPeriod } from "./api";
import { useOwner } from "./OwnerApp";

// ----- shared pieces ------------------------------------------------------------------

function Chips<T extends string>(props: { options: { key: T; label: string }[]; value: T; onChange(value: T): void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {props.options.map((option) => {
        const active = option.key === props.value;
        return (
          <Pressable key={option.key} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => props.onChange(option.key)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "All branches" plus each branch; hidden when there is only one. */
function BranchChips(props: { value: string; onChange(value: string): void }) {
  const { branches } = useOwner();
  if (branches.length < 2) return null;
  return <Chips options={[{ key: "", label: "All branches" }, ...branches.map((branch) => ({ key: branch.id, label: branch.name }))]} value={props.value} onChange={props.onChange} />;
}

/** Loads with `load`, again on pull-down, and again when `deps` change. */
function useLive<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

function Stat(props: { label: string; value: string; detail?: string; strong?: boolean }) {
  return (
    <View style={[styles.stat, props.strong && styles.statStrong]}>
      <Text style={[styles.statLabel, props.strong && { color: colors.primaryText }]}>{props.label}</Text>
      <Text style={[styles.statValue, props.strong && { color: colors.primaryText }]} numberOfLines={1} adjustsFontSizeToFit>{props.value}</Text>
      {props.detail ? <Text style={[styles.statDetail, props.strong && { color: colors.primaryText }]}>{props.detail}</Text> : null}
    </View>
  );
}

function Row(props: { left: string; right: string; detail?: string; onPress?: () => void; tone?: "warning" }) {
  const body = (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{props.left}</Text>
        {props.detail ? <Text style={styles.rowDetail} numberOfLines={1}>{props.detail}</Text> : null}
      </View>
      <Text style={[styles.rowValue, props.tone === "warning" && { color: colors.warning }]}>{props.right}</Text>
    </View>
  );
  return props.onPress ? <Pressable onPress={props.onPress}>{body}</Pressable> : body;
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.children}
    </Card>
  );
}

function shortTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const paymentLabels: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Transfer", mobile_money: "Mobile money", customer_credit: "On account", voucher: "Voucher" };

// ----- Overview -----------------------------------------------------------------------

interface Dashboard {
  periodLabel: string;
  summary: { totalSales: number; vatTotal: number; orderCount: number; averageTransaction: number; grossProfit: number; expenseTotal: number; netProfit: number; lowStockCount: number; pendingApprovalCount: number; discountTotal: number };
  paymentMix: Record<string, number>;
  topProducts: { id: string; name: string; quantity: number; sales: number }[];
  lowStock: { id: string; name: string; stock: number; reorderPoint: number }[];
}

export function OverviewScreen(props: { onOpenApprovals(): void }) {
  const { api, currency, branches, can, setPendingCount } = useOwner();
  const [branchId, setBranchId] = useState("");
  const [period, setPeriod] = useState<OwnerPeriod>("today");
  const money = (amount: number) => formatMoney(amount, currency);
  const showProfit = can("reports.profit.view");

  const { data, error, loading, reload } = useLive(async () => {
    const report = await api.request<Dashboard>(`/reports/dashboard${reportQuery(period, branchId)}`, { branchId: branchId || undefined });
    // With every branch selected, also compare the branches side by side.
    const perBranch = !branchId && branches.length > 1
      ? await Promise.all(branches.map(async (branch) => ({ branch, report: await api.request<Dashboard>(`/reports/dashboard${reportQuery(period, branch.id)}`, { branchId: branch.id }) })))
      : [];
    return { report, perBranch };
  }, [api, branchId, period, branches]);

  useEffect(() => {
    if (data && !branchId) setPendingCount(data.report.summary.pendingApprovalCount);
  }, [data, branchId, setPendingCount]);

  const summary = data?.report.summary;
  return (
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}>
      <BranchChips value={branchId} onChange={setBranchId} />
      <Chips<OwnerPeriod> options={ownerPeriods} value={period} onChange={setPeriod} />
      {error ? <Banner tone="danger" message={error} /> : null}
      {summary ? (
        <>
          <View style={styles.stats}>
            <Stat strong label="Sales" value={money(summary.totalSales)} detail={`${summary.orderCount} sale${summary.orderCount === 1 ? "" : "s"}`} />
            {showProfit ? <Stat label="Net profit" value={money(summary.netProfit)} detail={`after ${money(summary.expenseTotal)} expenses`} /> : null}
            <Stat label="Average sale" value={money(summary.averageTransaction)} />
            <Stat label="VAT collected" value={money(summary.vatTotal)} detail={summary.discountTotal ? `${money(summary.discountTotal)} discounts` : undefined} />
          </View>

          {summary.pendingApprovalCount ? (
            <Pressable onPress={props.onOpenApprovals}>
              <Banner tone="warning" message={`${summary.pendingApprovalCount} request${summary.pendingApprovalCount === 1 ? "" : "s"} waiting for your approval. Tap to review.`} />
            </Pressable>
          ) : null}

          {data.perBranch.length ? (
            <Section title="By branch">
              {data.perBranch.map(({ branch, report }) => (
                <Row key={branch.id} left={branch.name} right={money(report.summary.totalSales)} detail={`${report.summary.orderCount} sales${showProfit ? ` · profit ${money(report.summary.netProfit)}` : ""}`} onPress={() => setBranchId(branch.id)} />
              ))}
            </Section>
          ) : null}

          <Section title="Payments">
            {Object.entries(data.report.paymentMix).filter(([, amount]) => amount).length ? (
              Object.entries(data.report.paymentMix).filter(([, amount]) => amount).map(([method, amount]) => <Row key={method} left={paymentLabels[method] ?? method} right={money(amount)} />)
            ) : (
              <Muted>No payments in this period.</Muted>
            )}
          </Section>

          <Section title="Best sellers">
            {data.report.topProducts.length ? (
              data.report.topProducts.map((product) => <Row key={product.id} left={product.name} detail={`${product.quantity} sold`} right={money(product.sales)} />)
            ) : (
              <Muted>No sales in this period.</Muted>
            )}
          </Section>

          <Section title={`Low stock (${summary.lowStockCount})`}>
            {data.report.lowStock.length ? (
              data.report.lowStock.slice(0, 8).map((product) => <Row key={product.id} left={product.name} detail={`reorder at ${product.reorderPoint}`} right={`${product.stock} left`} tone="warning" />)
            ) : (
              <Muted>Everything is above its reorder level.</Muted>
            )}
          </Section>
          <Muted>{data.report.periodLabel} · pull down to refresh</Muted>
        </>
      ) : loading ? (
        <Muted>Loading...</Muted>
      ) : null}
    </ScrollView>
  );
}

// ----- Sales --------------------------------------------------------------------------

interface Sale {
  id: string;
  branchId: string;
  cashierId: string;
  status: string;
  createdAt: string;
  refundTotal: number;
  customer?: { name: string };
  summary: { total: number; subtotal: number; discount: number; vat: number; serviceCharge: number; lines: { productId: string; name: string; quantity: number; subtotal: number; total: number }[] };
  receipt: { cashierName?: string };
}

interface SaleWithPayments extends Sale {
  payments?: { method: string; amount: number; reference?: string }[];
}

export function SalesScreen() {
  const { api, currency, branchName, staffNames } = useOwner();
  const [branchId, setBranchId] = useState("");
  const [period, setPeriod] = useState<OwnerPeriod>("today");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<SaleWithPayments | null>(null);
  const money = (amount: number) => formatMoney(amount, currency);

  const { data, error, loading, reload } = useLive(
    () => api.request<{ sales: SaleWithPayments[] }>(`/sales${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { branchId: branchId || undefined }),
    [api, branchId]
  );

  const sales = useMemo(() => {
    const window = periodWindow(period);
    const term = search.trim().toLowerCase();
    return (data?.sales ?? [])
      .filter((sale) => {
        const at = new Date(sale.createdAt);
        return at >= window.start && at <= window.end;
      })
      .filter((sale) => !term || sale.id.toLowerCase().includes(term) || (sale.customer?.name ?? "").toLowerCase().includes(term))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [data, period, search]);
  const total = sales.filter((sale) => sale.status !== "voided").reduce((sum, sale) => sum + sale.summary.total - sale.refundTotal, 0);
  const cashier = (sale: Sale) => sale.receipt?.cashierName ?? staffNames.get(sale.cashierId) ?? sale.cashierId;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}>
        <BranchChips value={branchId} onChange={setBranchId} />
        <Chips<OwnerPeriod> options={ownerPeriods} value={period} onChange={setPeriod} />
        <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Search receipt number or customer" placeholderTextColor={colors.textMuted} />
        {error ? <Banner tone="danger" message={error} /> : null}
        <Muted>{sales.length} sale{sales.length === 1 ? "" : "s"} · {money(total)}</Muted>
        {sales.length ? (
          <Card>
            {sales.slice(0, 300).map((sale) => (
              <Row key={sale.id} left={`${sale.id}${sale.status === "voided" ? " (voided)" : ""}`} detail={`${shortTime(sale.createdAt)} · ${branchName(sale.branchId)} · ${cashier(sale)}`} right={money(sale.summary.total)} onPress={() => setOpen(sale)} />
            ))}
          </Card>
        ) : !loading ? (
          <EmptyState icon="receipt-outline" title="No sales" message="No sales match this branch and period." />
        ) : null}
      </ScrollView>
      {open ? (
        <Sheet title={open.id} onClose={() => setOpen(null)}>
          <Muted>{shortTime(open.createdAt)} · {branchName(open.branchId)} · sold by {cashier(open)}{open.customer ? ` · ${open.customer.name}` : ""}</Muted>
          {open.status === "voided" ? <Badge label="Voided" tone="danger" /> : open.refundTotal ? <Badge label={`Refunded ${money(open.refundTotal)}`} tone="warning" /> : null}
          {open.summary.lines.map((line) => <Row key={`${line.productId}-${line.name}`} left={line.name} detail={`${line.quantity} x ${money(Math.round(line.subtotal / line.quantity))}`} right={money(line.subtotal)} />)}
          <Row left="Subtotal" right={money(open.summary.subtotal)} />
          {open.summary.discount ? <Row left="Discount" right={`-${money(open.summary.discount)}`} /> : null}
          {open.summary.serviceCharge ? <Row left="Service charge" right={money(open.summary.serviceCharge)} /> : null}
          {open.summary.vat ? <Row left="VAT" right={money(open.summary.vat)} /> : null}
          <Row left="Total" right={money(open.summary.total)} />
          {(open.payments ?? []).map((payment, index) => <Row key={index} left={paymentLabels[payment.method] ?? payment.method} detail={payment.reference} right={money(payment.amount)} />)}
        </Sheet>
      ) : null}
    </View>
  );
}

// ----- Stock --------------------------------------------------------------------------

interface StockProduct {
  id: string;
  branchId: string;
  name: string;
  sku: string;
  category: string;
  stock: number;
  reorderPoint: number;
  price: number;
}

export function StockScreen() {
  const { api, currency, branchName, branches } = useOwner();
  const [branchId, setBranchId] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [search, setSearch] = useState("");

  const { data, error, loading, reload } = useLive(
    () => api.request<{ products: StockProduct[] }>(`/inventory/stock${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { branchId: branchId || undefined }),
    [api, branchId]
  );
  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.products ?? [])
      .filter((product) => !lowOnly || product.stock <= product.reorderPoint)
      .filter((product) => !term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [data, lowOnly, search]);
  const lowCount = (data?.products ?? []).filter((product) => product.stock <= product.reorderPoint).length;

  return (
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}>
      <BranchChips value={branchId} onChange={setBranchId} />
      <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Search product or SKU" placeholderTextColor={colors.textMuted} />
      <View style={styles.switchRow}>
        <Text style={styles.rowTitle}>Low stock only ({lowCount})</Text>
        <Switch value={lowOnly} onValueChange={setLowOnly} />
      </View>
      {error ? <Banner tone="danger" message={error} /> : null}
      {products.length ? (
        <Card>
          {products.map((product) => (
            <Row
              key={product.id}
              left={product.name}
              detail={`${branches.length > 1 ? `${branchName(product.branchId)} · ` : ""}${product.sku} · ${formatMoney(product.price, currency)}`}
              right={`${product.stock}`}
              tone={product.stock <= product.reorderPoint ? "warning" : undefined}
            />
          ))}
        </Card>
      ) : !loading ? (
        <EmptyState icon="cube-outline" title={lowOnly ? "Nothing is low" : "No products"} message={lowOnly ? "Every product is above its reorder level." : undefined} />
      ) : null}
    </ScrollView>
  );
}

// ----- Approvals ----------------------------------------------------------------------

const approvalLabels: Record<string, string> = {
  discount: "Discount",
  void: "Void a sale",
  refund: "Refund",
  cash_movement: "Cash in / out",
  register_close: "Close a till",
  stock_adjustment: "Stock adjustment",
  customer_credit: "Customer credit",
  expense: "Expense"
};

export function ApprovalsScreen() {
  const { api, currency, branchName, staffNames, can, setPendingCount } = useOwner();
  const [deciding, setDeciding] = useState<{ approval: OwnerApproval; decision: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger" | "warning"; text: string } | null>(null);
  const money = (amount: number) => formatMoney(amount, currency);

  const { data, error, loading, reload } = useLive(() => api.request<{ approvals: OwnerApproval[] }>("/approvals?status=pending"), [api]);
  const approvals = useMemo(() => [...(data?.approvals ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [data]);
  useEffect(() => {
    if (data) setPendingCount(approvals.length);
  }, [data, approvals.length, setPendingCount]);

  const decide = async () => {
    if (!deciding) return;
    const { approval, decision } = deciding;
    const text = note.trim().length >= 3 ? note.trim() : decision === "approved" ? "Approved from the owner phone" : "Rejected from the owner phone";
    setBusy(true);
    setMessage(null);
    try {
      if (decision === "rejected") {
        await rejectApproval(api, approval, text);
        setMessage({ tone: "info", text: `${approvalLabels[approval.type] ?? approval.type} rejected.` });
      } else {
        const result = await approveApproval(api, approval, text);
        setMessage({ tone: "info", text: result.closed ? `Approved, and the till at ${branchName(approval.branchId)} is closed.` : `${approvalLabels[approval.type] ?? approval.type} approved.` });
      }
    } catch (cause) {
      setMessage({ tone: "warning", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
      setDeciding(null);
      setNote("");
      void reload();
    }
  };

  if (!can("approval.manage")) {
    return <EmptyState icon="lock-closed-outline" title="Not allowed" message="Your role cannot approve requests. Ask the owner." />;
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}>
        {message ? <Banner tone={message.tone} message={message.text} /> : null}
        {error ? <Banner tone="danger" message={error} /> : null}
        {approvals.length ? (
          approvals.map((approval) => {
            const counted = approval.type === "register_close" ? countedCashFromReason(approval.reason) : null;
            return (
              <Card key={approval.id}>
                <View style={styles.approvalHead}>
                  <Text style={styles.sectionTitle}>{approvalLabels[approval.type] ?? approval.type}</Text>
                  {approval.amount && approval.type !== "register_close" ? <Text style={styles.rowValue}>{money(approval.amount)}</Text> : null}
                </View>
                <Muted>{branchName(approval.branchId)} · {staffNames.get(approval.requestedBy) ?? approval.requestedBy} · {shortTime(approval.createdAt)}</Muted>
                {counted !== null ? <Text style={styles.rowTitle}>Counted cash {money(counted)}{approval.amount ? ` · difference ${money(approval.amount)}` : " · no difference"}</Text> : null}
                <Text style={styles.reason}>{approval.reason}</Text>
                <View style={styles.actions}>
                  <Button label="Reject" variant="secondary" onPress={() => setDeciding({ approval, decision: "rejected" })} style={{ flex: 1 }} />
                  <Button label={counted !== null ? "Approve & close till" : "Approve"} onPress={() => setDeciding({ approval, decision: "approved" })} style={{ flex: 1 }} />
                </View>
              </Card>
            );
          })
        ) : !loading ? (
          <EmptyState icon="checkmark-done-outline" title="Nothing waiting" message="Requests from your shops appear here." />
        ) : null}
      </ScrollView>
      {deciding ? (
        <Sheet
          title={`${deciding.decision === "approved" ? "Approve" : "Reject"}: ${approvalLabels[deciding.approval.type] ?? deciding.approval.type}`}
          onClose={() => setDeciding(null)}
          footer={<Button label={busy ? "Saving..." : deciding.decision === "approved" ? "Approve" : "Reject"} variant={deciding.decision === "approved" ? "primary" : "danger"} busy={busy} onPress={() => void decide()} large />}
        >
          <Muted>{deciding.approval.reason}</Muted>
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Checked with the cashier" />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  chipLabelActive: { color: colors.primaryText },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flexGrow: 1, flexBasis: "45%", backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  statStrong: { backgroundColor: colors.primary, borderColor: colors.primary },
  statLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: "600" },
  statValue: { fontSize: font.xl, fontWeight: "800", color: colors.text },
  statDetail: { fontSize: font.sm, color: colors.textMuted },
  sectionTitle: { fontSize: font.md, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: font.md, color: colors.text, fontWeight: "600" },
  rowDetail: { fontSize: font.sm, color: colors.textMuted },
  rowValue: { fontSize: font.md, fontWeight: "700", color: colors.text },
  search: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.md, color: colors.text },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  approvalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reason: { fontSize: font.md, color: colors.text },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }
});
