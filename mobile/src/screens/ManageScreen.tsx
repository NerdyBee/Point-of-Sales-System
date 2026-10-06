import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { readModel, type Customer, type Product, type Staff } from "../data/readModel";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import {
  adjustStock,
  customerGroups,
  customerSales,
  deleteCustomer,
  deleteProduct,
  listCustomers,
  listStaff,
  roleLabels,
  saveCustomer,
  saveProduct,
  saveStaff,
  setProductArchived,
  setStaffActive,
  stockHistory,
  updateBusinessSettings,
  type StandaloneRole,
  type StockMovementRow
} from "../standalone/business";
import { EmptyState, Fab, Icon, ListItem, Sheet } from "../ui/appKit";
import { recordInflow } from "../standalone/inventory";
import {
  availableCredit,
  customerLedger,
  debtorsSummary,
  hasCreditAccount,
  ledgerLabels,
  receivePayment,
  statementText,
  type LedgerEntry,
  type PaymentChannel
} from "../standalone/credit";
import { InflowSection } from "./InventoryScreens";
import { Badge, Banner, Button, Card, Field, Muted } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

type Section = "products" | "inflow" | "customers" | "staff" | "business";

/** Back office for a standalone device: products & stock, customers, staff, settings. */
export function ManageScreen() {
  const { permissions } = useApp();
  const sections = ([
    ["products", "Products", "catalog.manage"],
    ["inflow", "Inflow", "inventory.adjust"],
    ["customers", "Customers", "customer.manage"],
    ["staff", "Staff", "staff.manage"],
    ["business", "Business", "settings.manage"]
  ] as const).filter(([, , permission]) => permissions.has(permission));
  const [section, setSection] = useState<Section>(sections[0]?.[0] ?? "products");

  if (!sections.length) {
    return <View style={styles.page}><Banner tone="warning" message="Your role cannot manage this shop." /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.segments}>
        {sections.map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: section === key }} onPress={() => setSection(key)} style={[styles.segment, section === key && styles.segmentActive]}>
            <Text style={[styles.segmentLabel, section === key && { color: colors.primaryText }]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {section === "products" ? <ProductsSection /> : null}
      {section === "inflow" ? <InflowSection /> : null}
      {section === "customers" ? <CustomersSection /> : null}
      {section === "staff" ? <StaffSection /> : null}
      {section === "business" ? <BusinessSection /> : null}
    </View>
  );
}

function useRunner() {
  const { refresh } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
      after?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run, setError };
}

function confirm(title: string, message: string, action: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: onConfirm }
  ]);
}

const digitsOnly = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0;

function SearchBar(props: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <View style={styles.searchWrap}>
      <Icon name="search" size={18} color={colors.textMuted} />
      <TextInput value={props.value} onChangeText={props.onChange} placeholder={props.placeholder} placeholderTextColor={colors.textMuted} style={styles.search} />
    </View>
  );
}

// ----- products -------------------------------------------------------------------

function ProductsSection() {
  const { platform, settings, tenant, dataVersion } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    if (settings) void readModel.products(platform.db, settings.branchId, { includeArchived: true }).then(setProducts);
  }, [platform, settings, dataVersion]);

  const archivedCount = products.filter((product) => product.archived).length;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((product) => showArchived || !product.archived)
      .filter((product) => !term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term) || product.category.toLowerCase().includes(term))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [products, search, showArchived]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search products" />
        {archivedCount ? (
          <View style={styles.toggle}>
            <Text style={styles.toggleLabel}>Show archived ({archivedCount})</Text>
            <Switch value={showArchived} onValueChange={setShowArchived} />
          </View>
        ) : null}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={
          products.length ? (
            <EmptyState icon="search" title="No matching products" />
          ) : (
            <EmptyState icon="cube-outline" title="No products yet" message="Add what you sell with its price and how many you have." action={<Button label="Add product" onPress={() => setEditing("new")} />} />
          )
        }
        renderItem={({ item }) => {
          const tracked = item.category.trim().toLowerCase() !== "services";
          const low = tracked && item.stock <= Number(item.reorderPoint ?? 0);
          return (
            <ListItem
              title={item.name}
              subtitle={`${formatMoney(item.price, currency)} · ${item.category}`}
              muted={item.archived}
              onPress={() => setEditing(item)}
              right={
                item.archived ? (
                  <Badge label="Archived" tone="neutral" />
                ) : tracked ? (
                  <Badge label={`${item.stock} left`} tone={item.stock <= 0 ? "danger" : low ? "warning" : "neutral"} />
                ) : (
                  <Badge label="Service" tone="info" />
                )
              }
            />
          );
        }}
      />
      <Fab label="Product" onPress={() => setEditing("new")} />
      {editing ? <ProductSheet product={editing === "new" ? null : editing} categories={tenant?.settings.productCategories ?? []} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

function ProductSheet(props: { product: Product | null; categories: string[]; onClose(): void }) {
  const { platform, permissions } = useApp();
  const { error, busy, run, setError } = useRunner();
  const existing = props.product;
  const [mode, setMode] = useState<"details" | "stock">("details");
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing?.category ?? props.categories[0] ?? "General");
  const [price, setPrice] = useState(existing ? String(existing.price) : "");
  const [cost, setCost] = useState(existing?.cost ? String(existing.cost) : "");
  const [stock, setStock] = useState("");
  const [reorder, setReorder] = useState(existing?.reorderPoint ? String(existing.reorderPoint) : "");
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const tracked = (existing?.category ?? category).trim().toLowerCase() !== "services";
  const canAdjust = Boolean(existing && tracked && permissions.has("inventory.adjust") && !existing.archived);

  const save = () =>
    void run(
      () => saveProduct(platform, { id: existing?.id, name, category, price: digitsOnly(price), cost: digitsOnly(cost), stock: digitsOnly(stock), reorderPoint: digitsOnly(reorder), barcode: barcode.trim() || undefined }),
      props.onClose
    );

  const remove = () =>
    confirm("Delete product?", "If it has been sold before it is archived instead, so past receipts keep their details.", "Delete", () =>
      void run(async () => {
        const outcome = await deleteProduct(platform, existing!.id);
        if (outcome === "archived") Alert.alert("Archived", `${existing!.name} has sales on record, so it was archived. Turn on "Show archived" to restore it.`);
      }, props.onClose)
    );

  return (
    <Sheet
      title={existing ? existing.name : "New product"}
      onClose={props.onClose}
      footer={
        mode === "details" ? (
          <>
            {existing ? (
              existing.archived ? (
                <Button label="Restore" variant="secondary" onPress={() => void run(() => setProductArchived(platform, existing.id, false), props.onClose)} />
              ) : (
                <Button label="Delete" variant="danger" onPress={remove} />
              )
            ) : null}
            <Button label="Save" busy={busy} onPress={save} style={{ flex: 1 }} />
          </>
        ) : undefined
      }
    >
      {existing && canAdjust ? (
        <View style={styles.tabsRow}>
          <Button label="Details" variant={mode === "details" ? "primary" : "secondary"} onPress={() => setMode("details")} style={{ flex: 1 }} />
          <Button label={`Stock (${existing.stock})`} variant={mode === "stock" ? "primary" : "secondary"} onPress={() => { setError(null); setMode("stock"); }} style={{ flex: 1 }} />
        </View>
      ) : null}

      {mode === "stock" && existing ? (
        <StockPanel product={existing} onDone={props.onClose} />
      ) : (
        <>
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Category" value={category} onChangeText={setCategory} hint='Use "Services" for things without stock (e.g. delivery).' />
          {props.categories.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {props.categories.map((item) => (
                <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}>
                  <Text style={[styles.chipLabel, category === item && { color: colors.primaryText }]}>{item}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.twoColumns}>
            <View style={styles.column}><Field label="Selling price" value={price} onChangeText={setPrice} keyboardType="number-pad" /></View>
            <View style={styles.column}><Field label="Cost price" value={cost} onChangeText={setCost} keyboardType="number-pad" placeholder="Optional" /></View>
          </View>
          <View style={styles.twoColumns}>
            {existing ? null : <View style={styles.column}><Field label="Quantity in stock" value={stock} onChangeText={setStock} keyboardType="number-pad" /></View>}
            <View style={styles.column}><Field label="Low-stock warning at" value={reorder} onChangeText={setReorder} keyboardType="number-pad" placeholder="0" /></View>
          </View>
          <Field label="Barcode" value={barcode} onChangeText={setBarcode} autoCapitalize="none" placeholder="Optional" />
          {existing && tracked ? <Muted>To change the quantity use the Stock tab, so every change is recorded.</Muted> : null}
          {error ? <Banner tone="danger" message={error} /> : null}
        </>
      )}
    </Sheet>
  );
}

function StockPanel(props: { product: Product; onDone(): void }) {
  const { platform, dataVersion, staff } = useApp();
  const [unitCost, setUnitCost] = useState(props.product.cost ? String(props.product.cost) : "");
  const { error, busy, run } = useRunner();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<StockMovementRow[]>([]);
  const amount = digitsOnly(quantity);

  useEffect(() => {
    void stockHistory(platform, props.product.id).then(setHistory);
  }, [platform, props.product.id, dataVersion]);

  return (
    <>
      <View style={styles.tabsRow}>
        <Button label="Received (+)" variant={direction === "in" ? "primary" : "secondary"} onPress={() => setDirection("in")} style={{ flex: 1 }} />
        <Button label="Remove (−)" variant={direction === "out" ? "danger" : "secondary"} onPress={() => setDirection("out")} style={{ flex: 1 }} />
      </View>
      <View style={styles.twoColumns}>
        <View style={styles.column}><Field label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" /></View>
        {direction === "in" ? <View style={styles.column}><Field label="Cost per unit" value={unitCost} onChangeText={setUnitCost} keyboardType="number-pad" placeholder="Optional" /></View> : null}
        <View style={[styles.column, { flex: 2 }]}><Field label={direction === "in" ? "Supplier / note" : "Reason"} value={reason} onChangeText={setReason} placeholder={direction === "in" ? "Optional" : "Damaged / expired / recount"} /></View>
      </View>
      {amount ? <Muted>New quantity: {props.product.stock + (direction === "in" ? amount : -amount)}</Muted> : null}
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button
        label="Save stock change"
        busy={busy}
        onPress={() =>
          void run(
            () =>
              direction === "in"
                ? recordInflow(platform, { staffId: staff!.id, supplier: reason, lines: [{ productId: props.product.id, quantity: amount, unitCost: unitCost.trim() ? digitsOnly(unitCost) : undefined }] })
                : adjustStock(platform, props.product.id, -amount, reason),
            props.onDone
          )
        }
      />
      {direction === "in" ? <Muted>Recorded as an inflow, so it appears in Manage → Inflow and the stock report.</Muted> : null}

      <Text style={styles.subheading}>History</Text>
      {history.length === 0 ? <Muted>No stock changes yet.</Muted> : null}
      {history.map((move) => (
        <View key={move.id} style={styles.historyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.historyReason}>{move.reason}</Text>
            <Text style={styles.historyMeta}>{new Date(move.createdAt).toLocaleString()}</Text>
          </View>
          <Text style={[styles.historyDelta, { color: move.quantityDelta > 0 ? colors.success : colors.danger }]}>
            {move.quantityDelta > 0 ? "+" : ""}{move.quantityDelta}
          </Text>
          <Text style={styles.historyBalance}>→ {move.balanceAfter}</Text>
        </View>
      ))}
    </>
  );
}

// ----- customers -------------------------------------------------------------------

function CustomersSection() {
  const { platform, tenant, dataVersion } = useApp();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "owing" | "accounts">("all");
  const [summary, setSummary] = useState<{ owed: number; debtors: number; accounts: number } | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    void listCustomers(platform, search).then(setCustomers);
    void debtorsSummary(platform).then(setSummary);
  }, [platform, search, dataVersion]);

  const visible = customers
    .filter((customer) => (filter === "owing" ? Number(customer.outstandingBalance ?? 0) > 0 : filter === "accounts" ? hasCreditAccount(customer) : true))
    .sort((left, right) => (filter === "owing" ? Number(right.outstandingBalance ?? 0) - Number(left.outstandingBalance ?? 0) : 0));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        {summary && summary.accounts ? (
          <View style={styles.debtors}>
            <View style={{ flex: 1 }}>
              <Text style={styles.debtorsLabel}>Owed to you</Text>
              <Text style={styles.debtorsValue}>{formatMoney(summary.owed, currency)}</Text>
            </View>
            <Text style={styles.debtorsMeta}>{summary.debtors} of {summary.accounts} credit customer{summary.accounts === 1 ? "" : "s"} owe</Text>
          </View>
        ) : null}
        <SearchBar value={search} onChange={setSearch} placeholder="Search name or phone" />
        <View style={styles.wrapRow}>
          {([["all", "All"], ["owing", "Owing"], ["accounts", "Credit accounts"]] as const).map(([key, label]) => (
            <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, filter === key && styles.chipActive]}>
              <Text style={[styles.chipLabel, filter === key && { color: colors.primaryText }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={
          search || filter !== "all" ? (
            <EmptyState icon="search" title={filter === "owing" ? "Nobody owes you" : filter === "accounts" ? "No credit accounts yet" : "No matching customers"} message={filter === "accounts" ? "Open a customer and set a credit limit to let them buy on account." : undefined} />
          ) : (
            <EmptyState icon="people-outline" title="No customers yet" message="Customers you add here or at checkout appear in this list." />
          )
        }
        renderItem={({ item }) => {
          const owes = Number(item.outstandingBalance ?? 0);
          return (
            <ListItem
              title={item.name}
              subtitle={`${item.phone} · ${item.group}${hasCreditAccount(item) ? ` · limit ${formatMoney(Number(item.creditLimit), currency)}` : ""}`}
              onPress={() => setEditing(item)}
              right={owes > 0 ? <Badge label={`Owes ${formatMoney(owes, currency)}`} tone="danger" /> : <Badge label={`${item.loyaltyPoints ?? 0} pts`} tone="info" />}
            />
          );
        }}
      />
      <Fab label="Customer" icon="person-add-outline" onPress={() => setEditing("new")} />
      {editing ? <CustomerSheet customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

function CustomerSheet(props: { customer: Customer | null; onClose(): void }) {
  const { platform, tenant, permissions, staff, dataVersion } = useApp();
  const { error, busy, run, setError } = useRunner();
  const [existing, setExisting] = useState<Customer | null>(props.customer);
  const [tab, setTab] = useState<"details" | "account">(props.customer && Number(props.customer.outstandingBalance ?? 0) > 0 ? "account" : "details");
  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [group, setGroup] = useState(existing?.group ?? "Walk-in");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [creditLimit, setCreditLimit] = useState(existing?.creditLimit ? String(existing.creditLimit) : "");
  const [history, setHistory] = useState<{ count: number; total: number } | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentChannel>("cash");
  const [payReference, setPayReference] = useState("");
  const [payNote, setPayNote] = useState("");
  const currency = tenant?.settings.currency ?? "NGN";
  const money = (amount: number) => formatMoney(amount, currency);
  const canSetCredit = permissions.has("customer.credit");
  const owes = Number(existing?.outstandingBalance ?? 0);

  useEffect(() => {
    if (!props.customer) return;
    void readModel.customer(platform.db, props.customer.id).then((fresh) => fresh && setExisting(fresh));
    void customerSales(platform, props.customer.id).then(setHistory);
    void customerLedger(platform, props.customer.id).then(setLedger);
  }, [platform, props.customer, dataVersion]);

  const save = () =>
    void run(
      () => saveCustomer(platform, { id: existing?.id, name, phone, email: email ?? "", group, notes: notes ?? "", creditLimit: canSetCredit ? digitsOnly(creditLimit) : undefined }),
      props.onClose
    );

  const pay = () =>
    void run(async () => {
      await receivePayment(platform, { customerId: existing!.id, amount: digitsOnly(payAmount), method: payMethod, reference: payReference, note: payNote, staffId: staff!.id });
      setPaying(false);
      setPayAmount("");
      setPayReference("");
      setPayNote("");
    });

  const shareStatement = () => {
    if (!existing) return;
    void Share.share({ title: `Statement - ${existing.name}`, message: statementText({ businessName: tenant?.settings.businessName ?? "", customer: existing, entries: ledger, money }) });
  };

  const detailsFooter = (
    <>
      {existing ? (
        <Button
          label="Delete"
          variant="danger"
          onPress={() => confirm("Delete customer?", `${existing.name} will be removed.`, "Delete", () => void run(() => deleteCustomer(platform, existing.id), props.onClose))}
        />
      ) : null}
      <Button label="Save" busy={busy} style={{ flex: 1 }} onPress={save} />
    </>
  );

  const accountFooter = paying ? (
    <>
      <Button label="Back" variant="secondary" onPress={() => { setPaying(false); setError(null); }} />
      <Button label={`Receive ${digitsOnly(payAmount) ? money(digitsOnly(payAmount)) : "payment"}`} busy={busy} style={{ flex: 1 }} onPress={pay} />
    </>
  ) : (
    <>
      <Button label="Share statement" variant="secondary" onPress={shareStatement} disabled={!ledger.length} />
      <Button label="Receive payment" style={{ flex: 1 }} disabled={owes <= 0} onPress={() => { setPaying(true); setPayAmount(String(owes)); setError(null); }} />
    </>
  );

  return (
    <Sheet title={existing ? existing.name : "New customer"} onClose={props.onClose} footer={tab === "details" ? detailsFooter : accountFooter}>
      {existing ? (
        <View style={styles.tabsRow}>
          <Button label="Details" variant={tab === "details" ? "primary" : "secondary"} onPress={() => { setTab("details"); setError(null); }} style={{ flex: 1 }} />
          <Button label={owes > 0 ? `Account (owes ${money(owes)})` : "Account"} variant={tab === "account" ? "primary" : "secondary"} onPress={() => { setTab("account"); setError(null); }} style={{ flex: 1 }} />
        </View>
      ) : null}

      {tab === "account" && existing ? (
        <>
          <View style={styles.stats}>
            <Stat label="Owes" value={money(owes)} />
            <Stat label="Credit limit" value={hasCreditAccount(existing) ? money(Number(existing.creditLimit)) : "None"} />
            <Stat label="Available" value={money(availableCredit(existing))} />
          </View>
          {!hasCreditAccount(existing) ? (
            <Muted>{canSetCredit ? "No credit account. Set a credit limit on the Details tab to let this customer buy on account." : "No credit account. Ask an owner or manager to set a credit limit."}</Muted>
          ) : null}

          {paying ? (
            <>
              <Field label="Amount received" value={payAmount} onChangeText={setPayAmount} keyboardType="number-pad" hint={`Owes ${money(owes)}`} />
              <View style={styles.wrapRow}>
                {(Object.keys(payLabels) as PaymentChannel[]).map((item) => (
                  <Pressable key={item} onPress={() => setPayMethod(item)} style={[styles.chip, payMethod === item && styles.chipActive]}>
                    <Text style={[styles.chipLabel, payMethod === item && { color: colors.primaryText }]}>{payLabels[item]}</Text>
                  </Pressable>
                ))}
              </View>
              {payMethod !== "cash" ? <Field label="Payment reference" value={payReference} onChangeText={setPayReference} autoCapitalize="characters" /> : <Muted>Cash is added to the open register's expected cash.</Muted>}
              <Field label="Note" value={payNote} onChangeText={setPayNote} placeholder="Optional" />
            </>
          ) : (
            <>
              <Text style={styles.subheading}>Statement</Text>
              {ledger.length === 0 ? <Muted>No credit sales or payments yet.</Muted> : null}
              {[...ledger].reverse().map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyReason}>{ledgerLabels[entry.type] ?? entry.type}{entry.reference ? ` · ${entry.reference}` : ""}</Text>
                    <Text style={styles.historyMeta}>
                      {new Date(entry.createdAt).toLocaleString()}
                      {entry.paymentMethod ? ` · ${payLabels[entry.paymentMethod]}${entry.paymentReference ? ` ${entry.paymentReference}` : ""}` : ""}
                      {entry.type === "payment" && entry.note && entry.note !== "Payment received" ? ` · ${entry.note}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.historyDelta, { color: entry.amount > 0 ? colors.danger : colors.success, minWidth: 90 }]}>
                    {entry.amount > 0 ? "+" : "−"}{money(Math.abs(entry.amount))}
                  </Text>
                  <Text style={[styles.historyBalance, { minWidth: 80 }]}>{money(entry.balanceAfter)}</Text>
                </View>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          {existing && history ? (
            <View style={styles.stats}>
              <Stat label="Purchases" value={String(history.count)} />
              <Stat label="Spent" value={money(history.total)} />
              <Stat label="Points" value={String(existing.loyaltyPoints ?? 0)} />
            </View>
          ) : null}
          <Field label="Name" value={name} onChangeText={setName} />
          <View style={styles.twoColumns}>
            <View style={styles.column}><Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></View>
            <View style={styles.column}><Field label="Email" value={email ?? ""} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="Optional" /></View>
          </View>
          <Text style={styles.fieldLabel}>Group</Text>
          <View style={styles.wrapRow}>
            {customerGroups.map((item) => (
              <Pressable key={item} onPress={() => setGroup(item)} style={[styles.chip, group === item && styles.chipActive]}>
                <Text style={[styles.chipLabel, group === item && { color: colors.primaryText }]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          {canSetCredit ? (
            <Field
              label="Credit limit"
              value={creditLimit}
              onChangeText={setCreditLimit}
              keyboardType="number-pad"
              placeholder="0 = no credit"
              hint="The most this customer may owe at any time. Leave 0 for cash-only customers."
            />
          ) : existing && hasCreditAccount(existing) ? (
            <Muted>Credit limit: {money(Number(existing.creditLimit))}</Muted>
          ) : null}
          <Field label="Notes" value={notes ?? ""} onChangeText={setNotes} placeholder="Optional" multiline />
        </>
      )}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

const payLabels: Record<PaymentChannel, string> = { cash: "Cash", bank_transfer: "Transfer", card: "Card", mobile_money: "Mobile money" };

function Stat(props: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{props.value}</Text>
      <Text style={styles.statLabel}>{props.label}</Text>
    </View>
  );
}

// ----- staff -------------------------------------------------------------------------

function StaffSection() {
  const { platform, dataVersion, staff: signedIn } = useApp();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);

  useEffect(() => {
    void listStaff(platform).then(setStaff);
  }, [platform, dataVersion]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        <Muted>Everyone signs in with their own PIN so each sale is recorded against them.</Muted>
      </View>
      <FlatList
        data={staff}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => (
          <ListItem
            title={`${item.name}${item.id === signedIn?.id ? " (you)" : ""}`}
            subtitle={`${roleLabels[item.role as StandaloneRole] ?? item.role} · ${item.id}`}
            muted={!item.active}
            onPress={() => setEditing(item)}
            right={<Badge label={item.active ? "Active" : "Disabled"} tone={item.active ? "success" : "neutral"} />}
          />
        )}
      />
      <Fab label="Staff" icon="person-add-outline" onPress={() => setEditing("new")} />
      {editing ? <StaffSheet staff={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

function StaffSheet(props: { staff: Staff | null; onClose(): void }) {
  const { platform } = useApp();
  const { error, busy, run, setError } = useRunner();
  const existing = props.staff;
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<StandaloneRole>((existing?.role as StandaloneRole) ?? "cashier");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

  const save = () => {
    if (pin !== pinAgain) return setError("The two PINs do not match");
    void run(() => saveStaff(platform, { id: existing?.id, name, role, pin: pin || undefined }), props.onClose);
  };

  return (
    <Sheet
      title={existing ? existing.name : "New staff member"}
      onClose={props.onClose}
      footer={
        <>
          {existing ? (
            <Button
              label={existing.active ? "Disable" : "Enable"}
              variant={existing.active ? "danger" : "secondary"}
              onPress={() =>
                existing.active
                  ? confirm("Disable staff member?", `${existing.name} will no longer be able to sign in. Their past sales are kept.`, "Disable", () => void run(() => setStaffActive(platform, existing.id, false), props.onClose))
                  : void run(() => setStaffActive(platform, existing.id, true), props.onClose)
              }
            />
          ) : null}
          <Button label="Save" busy={busy} style={{ flex: 1 }} onPress={save} />
        </>
      }
    >
      <Field label="Name" value={name} onChangeText={setName} />
      <Text style={styles.fieldLabel}>Role</Text>
      <View style={styles.tabsRow}>
        {(Object.keys(roleLabels) as StandaloneRole[]).map((item) => (
          <Button key={item} label={roleLabels[item]} variant={role === item ? "primary" : "secondary"} onPress={() => setRole(item)} style={{ flex: 1 }} />
        ))}
      </View>
      <Muted>
        {role === "owner" ? "Full access, including staff, settings and backup." : role === "manager" ? "Sells, voids sales, manages products and stock, closes the register." : "Sells, adds customers, opens the register."}
      </Muted>
      <View style={styles.twoColumns}>
        <View style={styles.column}><Field label={existing ? "New PIN" : "6-digit PIN"} value={pin} onChangeText={(value) => setPin(digits(value))} keyboardType="number-pad" secureTextEntry placeholder={existing ? "Leave empty to keep" : undefined} /></View>
        <View style={styles.column}><Field label="Repeat PIN" value={pinAgain} onChangeText={(value) => setPinAgain(digits(value))} keyboardType="number-pad" secureTextEntry /></View>
      </View>
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

// ----- business ----------------------------------------------------------------------

function BusinessSection() {
  const { platform, tenant } = useApp();
  const { error, busy, run } = useRunner();
  const current = tenant?.settings;
  const [businessName, setBusinessName] = useState(current?.businessName ?? "");
  const [vat, setVat] = useState(String(Math.round((current?.defaultTaxRate ?? 0) * 10000) / 100));
  const [serviceCharge, setServiceCharge] = useState(current?.serviceChargeEnabled ? String(Math.round((current.serviceChargeRate ?? 0) * 10000) / 100) : "0");
  const [footer, setFooter] = useState(current?.receiptFooter ?? "");
  const [methods, setMethods] = useState({
    cash: current?.paymentMethods?.cash !== false,
    card: current?.paymentMethods?.card !== false,
    bankTransfer: current?.paymentMethods?.bankTransfer !== false,
    mobileMoney: Boolean(current?.paymentMethods?.mobileMoney)
  });
  const [saved, setSaved] = useState(false);
  const labels: Record<keyof typeof methods, string> = { cash: "Cash", card: "Card (POS terminal)", bankTransfer: "Bank transfer", mobileMoney: "Mobile money" };

  return (
    <ScrollView contentContainerStyle={[styles.page, { alignItems: "center" }]} keyboardShouldPersistTaps="handled">
      <Card style={{ width: "100%", maxWidth: 640 }}>
        <Field label="Business name (shown on receipts)" value={businessName} onChangeText={setBusinessName} />
        <View style={styles.twoColumns}>
          <View style={styles.column}><Field label="VAT %" value={vat} onChangeText={setVat} keyboardType="decimal-pad" /></View>
          <View style={styles.column}><Field label="Service charge %" value={serviceCharge} onChangeText={setServiceCharge} keyboardType="decimal-pad" hint="0 = none" /></View>
        </View>
        <Field label="Receipt footer" value={footer} onChangeText={setFooter} />
        <Text style={styles.fieldLabel}>Payment methods</Text>
        {(Object.keys(methods) as (keyof typeof methods)[]).map((key) => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.toggleLabel}>{labels[key]}</Text>
            <Switch value={methods[key]} onValueChange={(value) => { setSaved(false); setMethods((currentMethods) => ({ ...currentMethods, [key]: value })); }} />
          </View>
        ))}
        {error ? <Banner tone="danger" message={error} /> : null}
        {saved ? <Banner tone="info" message="Saved. New charges apply from the next sale." /> : null}
        <Button
          label="Save settings"
          busy={busy}
          onPress={() =>
            void run(
              () => updateBusinessSettings(platform, { businessName, vatPercent: Number(vat) || 0, serviceChargePercent: Number(serviceCharge) || 0, receiptFooter: footer, paymentMethods: methods }),
              () => setSaved(true)
            )
          }
        />
      </Card>
    </ScrollView>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  segments: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  segment: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentLabel: { fontSize: font.md, fontWeight: "600", color: colors.text },
  toolbar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  search: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: spacing.sm },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontSize: font.md, color: colors.text },
  separator: { height: 1, backgroundColor: colors.surfaceMuted, marginLeft: spacing.lg },
  tabsRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  column: { flex: 1, minWidth: 140 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  fieldLabel: { color: colors.text, fontSize: font.sm, fontWeight: "600" },
  subheading: { fontSize: font.md, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  historyReason: { fontSize: font.md, color: colors.text },
  historyMeta: { fontSize: font.sm, color: colors.textMuted },
  historyDelta: { fontSize: font.md, fontWeight: "700", minWidth: 44, textAlign: "right" },
  historyBalance: { fontSize: font.sm, color: colors.textMuted, minWidth: 44, textAlign: "right" },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, alignItems: "center", gap: 2 },
  statValue: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  debtors: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.md },
  debtorsLabel: { fontSize: font.sm, color: colors.danger, fontWeight: "600" },
  debtorsValue: { fontSize: font.xl, color: colors.danger, fontWeight: "800" },
  debtorsMeta: { fontSize: font.sm, color: colors.danger, textAlign: "right", flexShrink: 1 },
  statLabel: { fontSize: font.sm, color: colors.textMuted },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
});
