import { useEffect, useMemo, useState } from "react";
import { FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
  type Payment,
  type PaymentMethod
} from "../pos/actions";
import { calculateSale, formatMoney, type CartLine, type SaleSummary } from "../pos/pricing";
import { Badge, Banner, Button, Field, Muted, Title } from "../ui/components";
import { useLayout } from "../ui/layout";
import { EmptyState, Icon } from "../ui/appKit";
import { loadPrinterSettings, printReceipt, printingAvailable, receiptFromSale } from "../print/printer";
import { ReceiptShareSheet } from "../print/ReceiptShareSheet";
import { loadReceiptBranding } from "../print/branding";
import type { ReceiptData } from "../print/receipt";
import { PrinterSheet } from "./PrinterSheet";
import { SafeAreaView } from "react-native-safe-area-context";
import { isStandalone } from "../sync/settings";
import { availableCredit, hasCreditAccount } from "../standalone/credit";
import { colors, font, radius, spacing } from "../ui/theme";

const methodLabels: Record<PaymentMethod, string> = { cash: "Cash", card: "Card", bank_transfer: "Transfer", mobile_money: "Mobile money", customer_credit: "On account" };
type ImmediateMethod = Exclude<PaymentMethod, "customer_credit">;
const methodSetting: Record<ImmediateMethod, "cash" | "card" | "bankTransfer" | "mobileMoney"> = {
  cash: "cash",
  card: "card",
  bank_transfer: "bankTransfer",
  mobile_money: "mobileMoney"
};

interface Receipt {
  number: string;
  summary: SaleSummary;
  tendered?: number;
  createdAt: string;
  customer?: string;
  data: ReceiptData;
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
  // Set when checkout sent the cashier to pick a customer (for a credit sale); checkout reopens after.
  const [resumeCheckout, setResumeCheckout] = useState(false);
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
          enabled={(Object.keys(methodSetting) as ImmediateMethod[]).filter((method) => tenant.settings.paymentMethods?.[methodSetting[method]] !== false)}
          allowCredit={isStandalone(settings)}
          customerId={customer?.id ?? null}
          onPickCustomer={() => {
            setCheckoutOpen(false);
            setResumeCheckout(true);
            setCustomerOpen(true);
          }}
          onCancel={() => setCheckoutOpen(false)}
          onConfirm={async ({ payments, tendered }) => {
            const sale = await recordSale(platform, { settings, tenantSettings: tenant.settings, staff, cart, customer, payments });
            const branding = await loadReceiptBranding(platform, settings);
            setReceipt({
              number: sale.number,
              summary: sale.summary,
              tendered,
              createdAt: sale.createdAt,
              customer: customer?.name,
              data: receiptFromSale({ number: sale.number, createdAt: sale.createdAt }, sale.record, tenant.settings, { tendered, branding })
            });
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
          onClose={() => {
            setCustomerOpen(false);
            if (resumeCheckout) {
              setResumeCheckout(false);
              setCheckoutOpen(true);
            }
          }}
          onPick={(picked) => {
            setCustomer(picked);
            setCustomerOpen(false);
            if (resumeCheckout) {
              setResumeCheckout(false);
              setCheckoutOpen(true);
            } else if (compact) setCartOpen(true);
          }}
          onCreate={async (input) => {
            const created = await createCustomer(platform, staff, input);
            setCustomer(created);
            setCustomerOpen(false);
            if (resumeCheckout) {
              setResumeCheckout(false);
              setCheckoutOpen(true);
            } else if (compact) setCartOpen(true);
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
  enabled: ImmediateMethod[];
  allowCredit: boolean;
  customerId: string | null;
  onPickCustomer(): void;
  onCancel(): void;
  onConfirm(input: { payments: Payment[]; tendered?: number }): Promise<void>;
}) {
  const { platform } = useApp();
  const methods: PaymentMethod[] = [...props.enabled, ...(props.allowCredit ? (["customer_credit"] as const) : [])];
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? "cash");
  const [tendered, setTendered] = useState(String(props.total));
  const [reference, setReference] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [paidNowMethod, setPaidNowMethod] = useState<ImmediateMethod>(props.enabled[0] ?? "cash");
  const [account, setAccount] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (amount: number) => formatMoney(amount, props.currency);
  const amount = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0;
  const tenderedValue = amount(tendered);
  const change = method === "cash" ? tenderedValue - props.total : 0;

  // Fresh balance/limit for the selected customer (the cart may hold an older copy).
  useEffect(() => {
    if (props.customerId) void readModel.customer(platform.db, props.customerId).then(setAccount);
    else setAccount(null);
  }, [platform, props.customerId]);

  const credit = method === "customer_credit";
  const paidNowValue = Math.min(amount(paidNow), props.total);
  const onAccount = props.total - paidNowValue;
  const owed = Number(account?.outstandingBalance ?? 0);
  const canCredit = Boolean(account && hasCreditAccount(account));
  const available = account ? availableCredit(account) : 0;

  const confirm = async () => {
    setError(null);
    let payments: Payment[];
    let cashTendered: number | undefined;
    if (credit) {
      if (!canCredit) return setError("Choose a registered customer with a credit account.");
      if (onAccount <= 0) return setError("Nothing is left to put on account. Choose how the customer is paying instead.");
      if (onAccount > available) return setError(`Only ${money(available)} credit is available for ${account!.name}. Take more payment now.`);
      if (paidNowValue > 0 && referenceRequired.includes(paidNowMethod) && !reference.trim()) return setError("Enter the payment reference");
      payments = [{ method: "customer_credit", amount: onAccount }, ...(paidNowValue > 0 ? [{ method: paidNowMethod, amount: paidNowValue, reference: reference.trim() || undefined }] : [])];
    } else {
      if (method === "cash" && tenderedValue < props.total) return setError("Cash received is less than the total");
      if (referenceRequired.includes(method) && !reference.trim()) return setError("Enter the payment reference");
      payments = [{ method, amount: props.total, reference: reference.trim() || undefined }];
      cashTendered = method === "cash" ? tenderedValue : undefined;
    }
    setBusy(true);
    try {
      await props.onConfirm({ payments, tendered: cashTendered });
    } catch (cause) {
      setError(cause instanceof PosError || cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.backdrop}>
        <ScrollView style={{ width: "100%", maxWidth: 560 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View style={styles.modal}>
            <Title>Charge {money(props.total)}</Title>
            <View style={styles.methods}>
              {methods.map((item) => (
                <Pressable key={item} accessibilityRole="radio" accessibilityState={{ selected: method === item }} onPress={() => { setMethod(item); setError(null); }} style={[styles.method, method === item && styles.methodActive]}>
                  <Text style={[styles.methodLabel, method === item && { color: colors.primaryText }]}>{methodLabels[item]}</Text>
                </Pressable>
              ))}
            </View>

            {credit ? (
              !account ? (
                <>
                  <Banner tone="warning" message="Credit is only for registered customers with a credit account. Choose the customer first." />
                  <Button label="Choose customer" variant="secondary" onPress={props.onPickCustomer} />
                </>
              ) : !canCredit ? (
                <>
                  <Banner tone="warning" message={`${account.name} does not have a credit account. An owner or manager can set a credit limit in Manage → Customers.`} />
                  <Button label="Choose another customer" variant="secondary" onPress={props.onPickCustomer} />
                </>
              ) : (
                <>
                  <View style={styles.creditBox}>
                    <Text style={styles.creditName}>{account.name}</Text>
                    <Text style={styles.lineMeta}>Owes {money(owed)} · Limit {money(Number(account.creditLimit))} · Available {money(available)}</Text>
                  </View>
                  <Field label="Paid now (optional)" value={paidNow} onChangeText={setPaidNow} keyboardType="number-pad" placeholder="0" />
                  {paidNowValue > 0 ? (
                    <>
                      <View style={styles.methods}>
                        {props.enabled.map((item) => (
                          <Pressable key={item} onPress={() => setPaidNowMethod(item)} style={[styles.method, paidNowMethod === item && styles.methodActive]}>
                            <Text style={[styles.methodLabel, paidNowMethod === item && { color: colors.primaryText }]}>{methodLabels[item]}</Text>
                          </Pressable>
                        ))}
                      </View>
                      {referenceRequired.includes(paidNowMethod) ? <Field label="Payment reference" value={reference} onChangeText={setReference} autoCapitalize="characters" /> : null}
                    </>
                  ) : null}
                  <TotalRow label="On account" value={money(onAccount)} strong />
                  <TotalRow label="Balance after this sale" value={money(owed + onAccount)} />
                  {onAccount > available ? <Banner tone="danger" message={`Over the credit limit by ${money(onAccount - available)}.`} /> : null}
                </>
              )
            ) : method === "cash" ? (
              <>
                <Field label="Cash received" value={tendered} onChangeText={setTendered} keyboardType="number-pad" />
                <View style={styles.quickCash}>
                  {[props.total, Math.ceil(props.total / 1000) * 1000, Math.ceil(props.total / 5000) * 5000].filter((value, index, all) => all.indexOf(value) === index).map((value) => (
                    <Button key={value} label={money(value)} variant="secondary" onPress={() => setTendered(String(value))} />
                  ))}
                </View>
                <Text style={styles.change}>Change: {money(Math.max(change, 0))}</Text>
              </>
            ) : (
              <Field label="Payment reference" value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder="Terminal / transfer reference" />
            )}
            {error ? <Banner tone="danger" message={error} /> : null}
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button label="Back" variant="secondary" onPress={props.onCancel} />
              <Button label={credit ? "Complete credit sale" : "Complete sale"} onPress={() => void confirm()} busy={busy} disabled={credit && !canCredit} style={{ flex: 1 }} large />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function CustomerModal(props: { canCreate: boolean; onClose(): void; onPick(customer: Customer): void; onCreate(input: { name: string; phone: string }): Promise<void> }) {
  const { platform, tenant } = useApp();
  const currency = tenant?.settings.currency ?? "NGN";
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
                <Text style={styles.lineMeta}>
                  {item.phone} · {item.loyaltyPoints} pts
                  {hasCreditAccount(item) ? ` · credit: owes ${formatMoney(Number(item.outstandingBalance ?? 0), currency)} of ${formatMoney(Number(item.creditLimit), currency)}` : ""}
                </Text>
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
  const { platform } = useApp();
  const { receipt } = props;
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const canPrint = printingAvailable();

  const print = async () => {
    setPrinting(true);
    setPrintStatus(null);
    try {
      await printReceipt(platform, receipt.data);
      setPrintStatus({ tone: "info", text: "Receipt sent to the printer." });
    } catch (error) {
      setPrintStatus({ tone: "danger", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPrinting(false);
    }
  };

  // Auto-print once when the receipt first appears, if the shop turned it on.
  useEffect(() => {
    if (!canPrint) return;
    void loadPrinterSettings(platform).then((settings) => {
      if (settings.autoPrint && settings.device) void print();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (setupOpen) return <PrinterSheet onClose={() => setSetupOpen(false)} />;
  if (shareOpen) return <ReceiptShareSheet receipt={receipt.data} onClose={() => setShareOpen(false)} />;

  return (
    <Modal transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.modal, { maxWidth: 420 }]}>
          {receipt.data.logoPng ? <Image source={{ uri: `data:image/png;base64,${receipt.data.logoPng}` }} style={styles.receiptLogo} resizeMode="contain" /> : null}
          <Text style={[styles.cartTitle, { textAlign: "center" }]}>{props.businessName}</Text>
          {receipt.data.address ? <Text style={[styles.lineMeta, { textAlign: "center" }]}>{receipt.data.address}</Text> : null}
          {receipt.data.phone ? <Text style={[styles.lineMeta, { textAlign: "center" }]}>Tel: {receipt.data.phone}</Text> : null}
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
          {receipt.data.payments.map((payment, index) => (
            <TotalRow key={index} label={methodLabels[payment.method as PaymentMethod] ?? payment.method} value={formatMoney(payment.method === "cash" && receipt.tendered ? receipt.tendered : payment.amount, props.currency)} />
          ))}
          {receipt.tendered && receipt.tendered > receipt.summary.total ? <TotalRow label="Change" value={formatMoney(receipt.tendered - receipt.summary.total, props.currency)} /> : null}
          {receipt.data.account ? <TotalRow label="Account balance" value={formatMoney(receipt.data.account.balanceAfter, props.currency)} strong /> : null}
          {props.footer ? <Text style={[styles.lineMeta, { textAlign: "center" }]}>{props.footer}</Text> : null}
          {printStatus ? <Banner tone={printStatus.tone} message={printStatus.text} /> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {canPrint ? <Button label="Print" variant="secondary" busy={printing} onPress={() => void print()} style={{ flex: 1 }} /> : null}
            <Button label="Send (WhatsApp)" variant="secondary" onPress={() => setShareOpen(true)} style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Printer settings" onPress={() => setSetupOpen(true)} style={styles.iconSquare}>
              <Icon name="print-outline" size={22} />
            </Pressable>
          </View>
          <Button label="New sale" onPress={props.onClose} large />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
  receiptLogo: { width: 140, height: 72, alignSelf: "center" },
  creditBox: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  creditName: { fontSize: font.md, fontWeight: "700", color: colors.text },
  iconSquare: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
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
