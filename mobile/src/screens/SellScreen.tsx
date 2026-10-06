import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { readModel, type Customer, type Product } from "../data/readModel";
import {
  createCustomer,
  currentShift,
  pendingStockDeductions,
  PosError,
  recordSale,
  referenceRequired,
  type LocalShift,
  type PaymentMethod
} from "../pos/actions";
import { calculateSale, formatMoney, type CartLine, type SaleSummary } from "../pos/pricing";
import { Badge, Banner, Button, Field, Muted, Title } from "../ui/components";
import { useLayout } from "../ui/layout";
import { EmptyState } from "../ui/appKit";
import { SafeAreaView } from "react-native-safe-area-context";
import { isStandalone } from "../sync/settings";
import { colors, font, radius, spacing } from "../ui/theme";

const methodLabels: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", bank_transfer: "Transfer", mobile_money: "Mobile money" };
const methodSetting: Record<PaymentMethod, "cash" | "card" | "bankTransfer" | "mobileMoney"> = {
  cash: "cash",
  card: "card",
  bank_transfer: "bankTransfer",
  mobile_money: "mobileMoney"
};

interface Receipt {
  number: string;
  summary: SaleSummary;
  method: PaymentMethod;
  tendered: number;
  createdAt: string;
  customer?: string;
}

export function SellScreen(props: { onOpenRegister: () => void; onOpenManage?: () => void }) {
  const { platform, settings, tenant, staff, permissions, dataVersion, refresh, engine, touch } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [deductions, setDeductions] = useState<Map<string, number>>(new Map());
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const { compact, productColumns } = useLayout();

  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    if (!settings) return;
    void (async () => {
      setProducts(await readModel.products(platform.db, settings.branchId));
      setDeductions(await pendingStockDeductions(platform));
      setShift(await currentShift(platform));
    })();
  }, [platform, settings, dataVersion]);

  const categories = useMemo(() => [...new Set(products.map((product) => product.category))].sort(), [products]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((product) => !category || product.category === category)
      .filter((product) => !term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term) || product.barcode.includes(term))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [products, search, category]);

  const summary = useMemo(() => (tenant ? calculateSale(cart, tenant.settings) : null), [cart, tenant]);
  const available = (product: Product) => product.stock - (deductions.get(product.id) ?? 0) - (cart.find((line) => line.product.id === product.id)?.quantity ?? 0);
  const tracksStock = (product: Product) => product.category.trim().toLowerCase() !== "services";

  const add = (product: Product) => {
    touch();
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, { product, quantity: 1, discount: 0 }];
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    touch();
    setCart((current) => current.map((line) => (line.product.id === productId ? { ...line, quantity: line.quantity + delta } : line)).filter((line) => line.quantity > 0));
  };

  if (!shift || shift.status !== "open") {
    return (
      <View style={styles.empty}>
        <Title>{shift?.status === "closing" ? "Register is closing" : "Register is closed"}</Title>
        <Muted>{shift?.status === "closing" ? "Waiting for a manager to approve the cash count." : "Open the register with your starting float to begin selling."}</Muted>
        {!shift && permissions.has("register.manage") ? <Button label="Open register" onPress={props.onOpenRegister} /> : null}
      </View>
    );
  }

  if (!permissions.has("sale.create")) {
    return (
      <View style={styles.empty}>
        <Banner tone="warning" message="Your role cannot record sales here." />
      </View>
    );
  }

  const cartPanel = (
    <View style={compact ? styles.cartCompact : styles.cart}>
      <View style={styles.cartHeader}>
        <Text style={styles.cartTitle}>Current sale</Text>
        <Button
          label={customer ? customer.name : "Add customer"}
          variant="secondary"
          onPress={() => {
            setCartOpen(false);
            setCustomerOpen(true);
          }}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.sm }}>
        {cart.length === 0 ? <Muted>Tap products to add them.</Muted> : null}
        {cart.map((line) => (
          <View key={line.product.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{line.product.name}</Text>
              <Text style={styles.lineMeta}>{formatMoney(line.product.price, currency)} each</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable accessibilityLabel="Remove one" onPress={() => changeQuantity(line.product.id, -1)} style={styles.stepButton}><Text style={styles.stepLabel}>−</Text></Pressable>
              <Text style={styles.quantity}>{line.quantity}</Text>
              <Pressable accessibilityLabel="Add one" onPress={() => changeQuantity(line.product.id, 1)} style={styles.stepButton}><Text style={styles.stepLabel}>+</Text></Pressable>
            </View>
            <Text style={[styles.lineTotal, compact && { width: 80 }]}>{formatMoney(line.product.price * line.quantity, currency)}</Text>
          </View>
        ))}
      </ScrollView>
      {summary ? (
        <View style={styles.totals}>
          <TotalRow label="Subtotal" value={formatMoney(summary.subtotal, currency)} />
          {summary.discount ? <TotalRow label="Discount" value={`−${formatMoney(summary.discount, currency)}`} /> : null}
          <TotalRow label="VAT" value={formatMoney(summary.vat, currency)} />
          {summary.serviceCharge ? <TotalRow label="Service charge" value={formatMoney(summary.serviceCharge, currency)} /> : null}
          <TotalRow label="Total" value={formatMoney(summary.total, currency)} strong />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {compact ? <Button label="Back" variant="secondary" onPress={() => setCartOpen(false)} /> : null}
        <Button label="Clear" variant="secondary" onPress={() => { setCart([]); setCustomer(null); setCartOpen(false); }} disabled={!cart.length} />
        <Button
          label="Charge"
          onPress={() => {
            setCartOpen(false);
            setCheckoutOpen(true);
          }}
          disabled={!cart.length}
          style={{ flex: 1 }}
          large
        />
      </View>
    </View>
  );

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <View style={[styles.page, compact && { flexDirection: "column" }]}>
      <View style={[styles.catalog, compact && styles.catalogCompact]}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search name, SKU or scan barcode" placeholderTextColor={colors.textMuted} style={styles.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} style={{ flexGrow: 0 }}>
          {[null, ...categories].map((item) => (
            <Pressable key={item ?? "all"} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}>
              <Text style={[styles.chipLabel, category === item && { color: colors.primaryText }]}>{item ?? "All"}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <FlatList
          key={`columns-${productColumns}`}
          data={visible}
          keyExtractor={(item) => item.id}
          numColumns={productColumns}
          columnWrapperStyle={{ gap: compact ? spacing.sm : spacing.md }}
          contentContainerStyle={{ gap: compact ? spacing.sm : spacing.md, paddingBottom: spacing.xl }}
          ListEmptyComponent={
            products.length ? (
              <EmptyState icon="search" title="No matching products" message="Try another name, SKU or category." />
            ) : (
              <EmptyState
                icon="cube-outline"
                title="No products yet"
                message={
                  isStandalone(settings)
                    ? props.onOpenManage
                      ? "Add what you sell, with its price and how many you have."
                      : "Ask an owner or manager to add products."
                    : "Sync to download the catalogue for this branch."
                }
                action={props.onOpenManage ? <Button label="Add products" onPress={props.onOpenManage} /> : undefined}
              />
            )
          }
          renderItem={({ item }) => {
            const left = available(item);
            const out = tracksStock(item) && left <= 0;
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => add(item)}
                style={({ pressed }) => [styles.product, { maxWidth: `${Math.floor(100 / productColumns) - 1}%` }, compact && styles.productCompact, pressed && { borderColor: colors.primary }]}
              >
                <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.productPrice}>{formatMoney(item.price, currency)}</Text>
                {tracksStock(item) ? <Badge label={out ? "Out of stock" : `${left} left`} tone={out ? "danger" : left <= 5 ? "warning" : "neutral"} /> : null}
              </Pressable>
            );
          }}
        />
      </View>

      {compact ? (
        cart.length ? (
          <Pressable accessibilityRole="button" onPress={() => setCartOpen(true)} style={styles.cartBar}>
            <Text style={styles.cartBarLabel}>View sale · {itemCount} item{itemCount === 1 ? "" : "s"}</Text>
            <Text style={styles.cartBarLabel}>{summary ? formatMoney(summary.total, currency) : ""}</Text>
          </Pressable>
        ) : null
      ) : (
        cartPanel
      )}

      {compact && cartOpen ? (
        <Modal animationType="slide" onRequestClose={() => setCartOpen(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>{cartPanel}</SafeAreaView>
        </Modal>
      ) : null}

      {checkoutOpen && summary && tenant && settings && staff ? (
        <CheckoutModal
          total={summary.total}
          currency={currency}
          enabled={(Object.keys(methodLabels) as PaymentMethod[]).filter((method) => tenant.settings.paymentMethods?.[methodSetting[method]] !== false)}
          onCancel={() => setCheckoutOpen(false)}
          onConfirm={async (method, tendered, reference) => {
            const sale = await recordSale(platform, {
              settings,
              tenantSettings: tenant.settings,
              staff,
              cart,
              customer,
              payments: [{ method, amount: summary.total, reference }]
            });
            setReceipt({ number: sale.number, summary: sale.summary, method, tendered, createdAt: sale.createdAt, customer: customer?.name });
            setCart([]);
            setCustomer(null);
            setCheckoutOpen(false);
            await refresh();
            void engine.syncNow().then(refresh);
          }}
        />
      ) : null}

      {customerOpen && staff ? (
        <CustomerModal
          canCreate={permissions.has("customer.manage")}
          onClose={() => setCustomerOpen(false)}
          onPick={(picked) => { setCustomer(picked); setCustomerOpen(false); if (compact) setCartOpen(true); }}
          onCreate={async (input) => {
            const created = await createCustomer(platform, staff, input);
            setCustomer(created);
            setCustomerOpen(false);
            if (compact) setCartOpen(true);
            await refresh();
          }}
        />
      ) : null}

      {receipt ? <ReceiptModal receipt={receipt} businessName={tenant?.settings.businessName ?? ""} footer={tenant?.settings.receiptFooter} currency={currency} onClose={() => setReceipt(null)} /> : null}
    </View>
  );
}

function TotalRow(props: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={[styles.totalLabel, props.strong && styles.totalStrong]}>{props.label}</Text>
      <Text style={[styles.totalLabel, props.strong && styles.totalStrong]}>{props.value}</Text>
    </View>
  );
}

function CheckoutModal(props: {
  total: number;
  currency: string;
  enabled: PaymentMethod[];
  onCancel(): void;
  onConfirm(method: PaymentMethod, tendered: number, reference?: string): Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>(props.enabled[0] ?? "cash");
  const [tendered, setTendered] = useState(String(props.total));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tenderedValue = Number(tendered.replace(/[^0-9]/g, "")) || 0;
  const change = method === "cash" ? tenderedValue - props.total : 0;

  const confirm = async () => {
    setError(null);
    if (method === "cash" && tenderedValue < props.total) return setError("Cash received is less than the total");
    if (referenceRequired.includes(method) && !reference.trim()) return setError("Enter the payment reference");
    setBusy(true);
    try {
      await props.onConfirm(method, method === "cash" ? tenderedValue : props.total, reference.trim() || undefined);
    } catch (cause) {
      setError(cause instanceof PosError || cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Title>Charge {formatMoney(props.total, props.currency)}</Title>
          <View style={styles.methods}>
            {props.enabled.map((item) => (
              <Pressable key={item} accessibilityRole="radio" accessibilityState={{ selected: method === item }} onPress={() => setMethod(item)} style={[styles.method, method === item && styles.methodActive]}>
                <Text style={[styles.methodLabel, method === item && { color: colors.primaryText }]}>{methodLabels[item]}</Text>
              </Pressable>
            ))}
          </View>
          {method === "cash" ? (
            <>
              <Field label="Cash received" value={tendered} onChangeText={setTendered} keyboardType="number-pad" />
              <View style={styles.quickCash}>
                {[props.total, Math.ceil(props.total / 1000) * 1000, Math.ceil(props.total / 5000) * 5000].filter((value, index, all) => all.indexOf(value) === index).map((value) => (
                  <Button key={value} label={formatMoney(value, props.currency)} variant="secondary" onPress={() => setTendered(String(value))} />
                ))}
              </View>
              <Text style={styles.change}>Change: {formatMoney(Math.max(change, 0), props.currency)}</Text>
            </>
          ) : (
            <Field label="Payment reference" value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder="Terminal / transfer reference" />
          )}
          {error ? <Banner tone="danger" message={error} /> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button label="Back" variant="secondary" onPress={props.onCancel} />
            <Button label="Complete sale" onPress={() => void confirm()} busy={busy} style={{ flex: 1 }} large />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CustomerModal(props: { canCreate: boolean; onClose(): void; onPick(customer: Customer): void; onCreate(input: { name: string; phone: string }): Promise<void> }) {
  const { platform } = useApp();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readModel.customers(platform.db, search).then(setResults);
  }, [platform, search]);

  return (
    <Modal transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Title>Customer</Title>
          <Field label="Search" value={search} onChangeText={setSearch} placeholder="Name or phone" />
          <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: spacing.xs }}>
            {results.map((item) => (
              <Pressable key={item.id} onPress={() => props.onPick(item)} style={styles.customerRow}>
                <Text style={styles.lineName}>{item.name}</Text>
                <Text style={styles.lineMeta}>{item.phone} · {item.loyaltyPoints} pts</Text>
              </Pressable>
            ))}
          </ScrollView>
          {props.canCreate ? (
            <>
              <Text style={styles.cartTitle}>New customer</Text>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}><Field label="Name" value={name} onChangeText={setName} /></View>
                <View style={{ flex: 1 }}><Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></View>
              </View>
              {error ? <Banner tone="danger" message={error} /> : null}
              <Button
                label="Save customer"
                variant="secondary"
                onPress={() => void props.onCreate({ name, phone }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}
              />
            </>
          ) : null}
          <Button label="Close" variant="ghost" onPress={props.onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ReceiptModal(props: { receipt: Receipt; businessName: string; footer?: string; currency: string; onClose(): void }) {
  const { receipt } = props;
  return (
    <Modal transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.modal, { maxWidth: 420 }]}>
          <Text style={[styles.cartTitle, { textAlign: "center" }]}>{props.businessName}</Text>
          <Text style={[styles.lineMeta, { textAlign: "center" }]}>Receipt {receipt.number} · {new Date(receipt.createdAt).toLocaleString()}</Text>
          {receipt.customer ? <Text style={styles.lineMeta}>Customer: {receipt.customer}</Text> : null}
          {receipt.summary.lines.map((line) => (
            <View key={line.productId} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.lineMeta}>{line.quantity} × {line.name}</Text>
              <Text style={styles.lineMeta}>{formatMoney(line.subtotal, props.currency)}</Text>
            </View>
          ))}
          <TotalRow label="VAT" value={formatMoney(receipt.summary.vat, props.currency)} />
          {receipt.summary.serviceCharge ? <TotalRow label="Service charge" value={formatMoney(receipt.summary.serviceCharge, props.currency)} /> : null}
          <TotalRow label="Total" value={formatMoney(receipt.summary.total, props.currency)} strong />
          <TotalRow label={methodLabels[receipt.method]} value={formatMoney(receipt.tendered, props.currency)} />
          {receipt.method === "cash" ? <TotalRow label="Change" value={formatMoney(receipt.tendered - receipt.summary.total, props.currency)} /> : null}
          {props.footer ? <Text style={[styles.lineMeta, { textAlign: "center" }]}>{props.footer}</Text> : null}
          <Button label="New sale" onPress={props.onClose} large />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  catalog: { flex: 3, padding: spacing.lg, gap: spacing.md },
  catalogCompact: { flex: 1, padding: spacing.md, gap: spacing.sm },
  productCompact: { minHeight: 96, padding: spacing.sm },
  cartCompact: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface },
  cartBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  cartBarLabel: { color: colors.primaryText, fontSize: font.lg, fontWeight: "700" },
  search: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: font.md, backgroundColor: colors.surface, color: colors.text },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.md, color: colors.text, fontWeight: "600" },
  product: { flex: 1, minHeight: 110, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, gap: spacing.xs, justifyContent: "space-between" },
  productName: { fontSize: font.md, fontWeight: "600", color: colors.text },
  productPrice: { fontSize: font.lg, fontWeight: "700", color: colors.primary },
  cart: { flex: 2, minWidth: 320, backgroundColor: colors.surface, borderLeftWidth: 1, borderLeftColor: colors.border, padding: spacing.lg, gap: spacing.md },
  cartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cartTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted },
  lineName: { fontSize: font.md, fontWeight: "600", color: colors.text },
  lineMeta: { fontSize: font.sm, color: colors.textMuted },
  lineTotal: { width: 96, textAlign: "right", fontSize: font.md, fontWeight: "600", color: colors.text },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  stepButton: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  stepLabel: { fontSize: font.xl, color: colors.text },
  quantity: { minWidth: 28, textAlign: "center", fontSize: font.md, fontWeight: "700", color: colors.text },
  totals: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  totalLabel: { fontSize: font.md, color: colors.textMuted },
  totalStrong: { fontSize: font.xl, fontWeight: "700", color: colors.text },
  backdrop: { flex: 1, backgroundColor: "rgba(16, 24, 32, 0.45)", alignItems: "center", justifyContent: "center", padding: spacing.md },
  modal: { width: "100%", maxWidth: 560, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  method: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  methodActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  methodLabel: { fontSize: font.md, fontWeight: "600", color: colors.text },
  quickCash: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  change: { fontSize: font.lg, fontWeight: "700", color: colors.text },
  customerRow: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted }
});
