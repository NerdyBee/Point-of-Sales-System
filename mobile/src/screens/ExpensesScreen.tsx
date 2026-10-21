import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Share, StyleSheet, Switch, Text, View } from "react-native";
import { currentShift, type LocalShift } from "../pos/actions";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import { listStaff } from "../standalone/business";
import {
  expenseCategories,
  expensePaymentLabels,
  expenseTotals,
  listExpenses,
  recordExpense,
  voidExpense,
  type Expense,
  type ExpensePaymentMethod
} from "../standalone/expenses";
import { periodRange } from "../standalone/inventory";
import { EmptyState, Fab, ListItem, Sheet } from "../ui/appKit";
import { Badge, Banner, Button, Field, Muted, NumberField } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

type Period = "today" | "week" | "month";
const periodLabels: Record<Period, string> = { today: "Today", week: "This week", month: "This month" };

const categoryIcons: Record<string, "cart-outline" | "car-outline" | "flash-outline" | "home-outline" | "construct-outline" | "people-outline" | "megaphone-outline" | "ellipsis-horizontal-circle-outline"> = {
  Supplies: "cart-outline",
  Transport: "car-outline",
  Utilities: "flash-outline",
  Rent: "home-outline",
  Repairs: "construct-outline",
  "Staff welfare": "people-outline",
  Marketing: "megaphone-outline",
  Other: "ellipsis-horizontal-circle-outline"
};

/** Money spent by the shop, with how it was paid. Cash from the drawer reduces the register's expected cash. */
export function ExpensesSection() {
  const { platform, tenant, dataVersion } = useApp();
  const [period, setPeriod] = useState<Period>("today");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Expense | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";
  const money = (amount: number) => formatMoney(amount, currency);

  useEffect(() => {
    let current = true;
    void listExpenses(platform, periodRange(period)).then((rows) => current && setExpenses(rows), () => undefined);
    return () => {
      current = false;
    };
  }, [platform, period, dataVersion]);

  const totals = useMemo(() => expenseTotals(expenses), [expenses]);

  const share = () => {
    const lines = [
      `${tenant?.settings.businessName ?? ""} - Expenses ${periodLabels[period].toLowerCase()}`,
      "",
      ...expenses
        .filter((expense) => expense.status !== "voided")
        .map((expense) => `${new Date(expense.spentAt).toLocaleDateString()}  ${expense.number}  ${expense.category}: ${expense.description}  ${money(expense.amount)} (${expensePaymentLabels[expense.paymentMethod]})`),
      "",
      `Total: ${money(totals.total)}`,
      ...Object.entries(totals.byMethod).map(([method, amount]) => `${expensePaymentLabels[method as ExpensePaymentMethod]}: ${money(amount ?? 0)}`)
    ];
    void Share.share({ title: "Expenses", message: lines.join("\n") });
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{ paddingBottom: 96 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.chips}>
              {(Object.keys(periodLabels) as Period[]).map((item) => (
                <Pressable key={item} onPress={() => setPeriod(item)} style={[styles.chip, period === item && styles.chipActive]}>
                  <Text style={[styles.chipLabel, period === item && { color: colors.primaryText }]}>{periodLabels[item]}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                <View>
                  <Text style={styles.summaryLabel}>Spent {periodLabels[period].toLowerCase()}</Text>
                  <Text style={styles.summaryValue}>{money(totals.total)}</Text>
                </View>
                {totals.count ? <Button label="Share" variant="ghost" onPress={share} /> : null}
              </View>
              {totals.count ? (
                <View style={styles.breakdown}>
                  {Object.entries(totals.byMethod).map(([method, amount]) => (
                    <Text key={method} style={styles.breakdownText}>
                      {expensePaymentLabels[method as ExpensePaymentMethod]}: {money(amount ?? 0)}
                    </Text>
                  ))}
                  {totals.fromDrawer ? <Text style={styles.breakdownText}>From the till drawer: {money(totals.fromDrawer)}</Text> : null}
                </View>
              ) : null}
              {totals.count ? (
                <Text style={styles.breakdownText}>
                  {Object.entries(totals.byCategory)
                    .sort((left, right) => right[1] - left[1])
                    .map(([category, amount]) => `${category} ${money(amount)}`)
                    .join(" · ")}
                </Text>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="wallet-outline"
            title={`No expenses ${periodLabels[period].toLowerCase()}`}
            message="Record money the shop spends (transport, fuel, repairs, supplies...) and how it was paid."
            action={<Button label="Record expense" onPress={() => setCreating(true)} />}
          />
        }
        renderItem={({ item }) => (
          <ListItem
            icon={categoryIcons[item.category] ?? "wallet-outline"}
            title={item.description}
            subtitle={`${item.number} · ${new Date(item.spentAt).toLocaleString()} · ${item.category} · ${expensePaymentLabels[item.paymentMethod]}${item.vendor ? ` · ${item.vendor}` : ""}`}
            muted={item.status === "voided"}
            onPress={() => setOpen(item)}
            right={item.status === "voided" ? <Badge label="Voided" tone="neutral" /> : <Badge label={`−${money(item.amount)}`} tone="danger" />}
          />
        )}
      />
      <Fab label="Expense" icon="add" onPress={() => setCreating(true)} />
      {creating ? <ExpenseSheet onClose={() => setCreating(false)} /> : null}
      {open ? <ExpenseDetailSheet expense={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

function ExpenseSheet(props: { onClose(): void }) {
  const { platform, staff, tenant, refresh } = useApp();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Supplies");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [method, setMethod] = useState<ExpensePaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [fromDrawer, setFromDrawer] = useState(true);
  const [note, setNote] = useState("");
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    void currentShift(platform).then((value) => {
      setShift(value && value.status === "open" ? value : null);
      if (!value || value.status !== "open") setFromDrawer(false);
    }, () => undefined);
  }, [platform]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await recordExpense(platform, {
        amount: Number(amount || "0"),
        category,
        description,
        vendor,
        paymentMethod: method,
        reference,
        fromDrawer: method === "cash" && fromDrawer,
        note,
        staffId: staff!.id
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
      title="Record expense"
      onClose={props.onClose}
      footer={
        <>
          <Button label="Cancel" variant="secondary" onPress={props.onClose} />
          <Button label={Number(amount) ? `Save ${formatMoney(Number(amount), currency)}` : "Save expense"} busy={busy} onPress={() => void save()} style={{ flex: 1 }} />
        </>
      }
    >
      <NumberField label="Amount" value={amount} onChangeText={setAmount} placeholder="0" />
      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.chips}>
        {expenseCategories.map((item) => (
          <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}>
            <Text style={[styles.chipLabel, category === item && { color: colors.primaryText }]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="What was it for?" value={description} onChangeText={setDescription} placeholder="e.g. Fuel for generator" />
      <Field label="Paid to" value={vendor} onChangeText={setVendor} placeholder="Optional, e.g. Total filling station" />

      <Text style={styles.fieldLabel}>How was it paid?</Text>
      <View style={styles.chips}>
        {(Object.keys(expensePaymentLabels) as ExpensePaymentMethod[]).map((item) => (
          <Pressable key={item} onPress={() => setMethod(item)} style={[styles.chip, method === item && styles.chipActive]}>
            <Text style={[styles.chipLabel, method === item && { color: colors.primaryText }]}>{expensePaymentLabels[item]}</Text>
          </Pressable>
        ))}
      </View>
      {method === "cash" ? (
        <>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Paid from the till drawer</Text>
            <Switch value={fromDrawer} onValueChange={setFromDrawer} disabled={!shift} />
          </View>
          <Muted>
            {!shift
              ? "The register is closed, so this cash is recorded as paid from elsewhere (e.g. the owner's pocket)."
              : fromDrawer
                ? "Taken off the register's expected cash, so the drawer still balances when you close."
                : "Cash from elsewhere: the register's expected cash is not changed."}
          </Muted>
        </>
      ) : (
        <Field label="Payment reference" value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder="Optional, e.g. transfer or receipt number" />
      )}
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

function ExpenseDetailSheet(props: { expense: Expense; onClose(): void }) {
  const { platform, staff, tenant, refresh, permissions } = useApp();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const { expense } = props;
  const money = (amount: number) => formatMoney(amount, tenant?.settings.currency ?? "NGN");
  const name = (id: string) => names[id] ?? (id === staff?.id ? staff.name : "Staff");

  useEffect(() => {
    void listStaff(platform).then((members) => setNames(Object.fromEntries(members.map((member) => [member.id, member.name]))), () => undefined);
  }, [platform]);

  const confirmVoid = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await voidExpense(platform, expense.id, staff!.id, reason);
      await refresh();
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`${expense.number} · ${money(expense.amount)}`}
      onClose={props.onClose}
      footer={
        expense.status === "voided" || !permissions.has("expense.manage") ? (
          <Button label="Close" variant="secondary" onPress={props.onClose} style={{ flex: 1 }} />
        ) : voiding ? (
          <>
            <Button label="Back" variant="secondary" onPress={() => setVoiding(false)} />
            <Button label="Void expense" variant="danger" busy={busy} onPress={() => void confirmVoid()} style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <Button label="Close" variant="secondary" onPress={props.onClose} />
            <Button label="Void" variant="danger" onPress={() => setVoiding(true)} style={{ flex: 1 }} />
          </>
        )
      }
    >
      {expense.voided ? <Banner tone="info" message={`Voided ${new Date(expense.voided.at).toLocaleString()} by ${name(expense.voided.by)}: ${expense.voided.reason}`} /> : null}
      <Detail label="What for" value={expense.description} />
      <Detail label="Category" value={expense.category} />
      <Detail label="Amount" value={money(expense.amount)} />
      <Detail label="Paid by" value={`${expensePaymentLabels[expense.paymentMethod]}${expense.paymentMethod === "cash" ? (expense.fromDrawer ? " (from the till drawer)" : " (not from the drawer)") : ""}`} />
      {expense.reference ? <Detail label="Reference" value={expense.reference} /> : null}
      {expense.vendor ? <Detail label="Paid to" value={expense.vendor} /> : null}
      <Detail label="Date" value={new Date(expense.spentAt).toLocaleString()} />
      <Detail label="Recorded by" value={name(expense.createdBy)} />
      {expense.note ? <Detail label="Note" value={expense.note} /> : null}
      {voiding ? (
        <>
          <Field label="Reason for voiding" value={reason} onChangeText={setReason} placeholder="e.g. Entered twice" />
          {expense.fromDrawer ? <Muted>The cash goes back into the register's expected cash if that shift is still open.</Muted> : null}
        </>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{props.label}</Text>
      <Text style={styles.detailValue}>{props.value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  separator: { height: 1, backgroundColor: colors.surfaceMuted, marginLeft: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  summary: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: "600" },
  summaryValue: { fontSize: font.xl, fontWeight: "800", color: colors.danger },
  breakdown: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  breakdownText: { fontSize: font.sm, color: colors.textMuted },
  fieldLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  switchLabel: { fontSize: font.md, color: colors.text },
  detail: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  detailLabel: { fontSize: font.sm, color: colors.textMuted },
  detailValue: { flexShrink: 1, textAlign: "right", fontSize: font.md, color: colors.text }
});
