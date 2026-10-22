import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { Product } from "../data/readModel";
import { activeClearance } from "../pos/clearance";
import { formatMoney } from "../pos/pricing";
import { useApp } from "../shell/AppContext";
import {
  daysUntil,
  endClearance,
  expiringSoon,
  priceForPercent,
  productLots,
  productsOnClearance,
  setClearance,
  type ExpiringRow,
  type LotWithRemaining
} from "../standalone/expiry";
import { EmptyState, ListItem, Sheet } from "../ui/appKit";
import { Badge, Banner, Button, Muted, NumberField } from "../ui/components";
import { DateField, formatIsoDate } from "../ui/DateField";
import { colors, font, radius, spacing } from "../ui/theme";

const windows = [7, 30, 60, 90] as const;

export function expiryText(daysLeft: number) {
  if (daysLeft < 0) return `Expired ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "Expires tomorrow";
  return `Expires in ${daysLeft} days`;
}

const tone = (daysLeft: number) => (daysLeft < 0 ? "danger" : daysLeft <= 7 ? "danger" : daysLeft <= 30 ? "warning" : "neutral");

/** Manage → Expiring: batches close to expiry, and products on clearance. */
export function ExpiringSection() {
  const { platform, tenant, dataVersion, permissions } = useApp();
  const [within, setWithin] = useState<(typeof windows)[number]>(30);
  const [rows, setRows] = useState<ExpiringRow[]>([]);
  const [onClearance, setOnClearance] = useState<Product[]>([]);
  const [clearing, setClearing] = useState<{ product: Product; lot?: LotWithRemaining } | null>(null);
  const currency = tenant?.settings.currency ?? "NGN";
  const money = (amount: number) => formatMoney(amount, currency);
  const canClear = permissions.has("catalog.manage");

  useEffect(() => {
    let current = true;
    void expiringSoon(platform, { withinDays: within }).then((value) => current && setRows(value), () => undefined);
    void productsOnClearance(platform).then((value) => current && setOnClearance(value), () => undefined);
    return () => {
      current = false;
    };
  }, [platform, within, dataVersion]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.lot.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        ListHeaderComponent={
          <View style={styles.header}>
            {onClearance.length ? (
              <View style={styles.box}>
                <Text style={styles.boxTitle}>On clearance now</Text>
                {onClearance.map((product) => {
                  const clearance = activeClearance(product)!;
                  return (
                    <View key={product.id} style={styles.clearanceRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{product.name}</Text>
                        <Text style={styles.meta}>
                          {money(clearance.price)} instead of {money(product.price)} (−{clearance.percent}%) · {clearance.remaining} left
                          {clearance.endsAt ? ` · until ${formatIsoDate(clearance.endsAt)}` : ""}
                        </Text>
                      </View>
                      {canClear ? <Button label="Change" variant="ghost" onPress={() => setClearing({ product })} /> : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
            <Text style={styles.label}>Show batches expiring within</Text>
            <View style={styles.chips}>
              {windows.map((days) => (
                <Pressable key={days} onPress={() => setWithin(days)} style={[styles.chip, within === days && styles.chipActive]}>
                  <Text style={[styles.chipLabel, within === days && { color: colors.primaryText }]}>{days} days</Text>
                </Pressable>
              ))}
            </View>
            <Muted>Expiry dates come from inflows and opening stock. Units left are worked out from current stock, oldest first.</Muted>
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="calendar-outline" title={`Nothing expiring within ${within} days`} message="Add expiry dates when you record inflows so the app can warn you here." />
        }
        renderItem={({ item }) => {
          const clearance = activeClearance(item.product);
          return (
            <ListItem
              icon="calendar-outline"
              title={item.product.name}
              subtitle={`${item.lot.remaining} unit${item.lot.remaining === 1 ? "" : "s"} · ${formatIsoDate(item.lot.expiryDate!)}${item.lot.reference ? ` · ${item.lot.reference}` : ""}${clearance ? ` · on clearance at ${money(clearance.price)}` : ""}`}
              onPress={canClear ? () => setClearing({ product: item.product, lot: item.lot }) : undefined}
              right={<Badge label={expiryText(item.lot.daysLeft!)} tone={tone(item.lot.daysLeft!)} />}
            />
          );
        }}
      />
      {clearing ? <ClearanceSheet product={clearing.product} lot={clearing.lot} onClose={() => setClearing(null)} /> : null}
    </View>
  );
}

/** Put a number of units on clearance: percent off and new price stay in step. */
export function ClearanceSheet(props: { product: Product; lot?: LotWithRemaining; onClose(): void }) {
  const { platform, staff, tenant, refresh } = useApp();
  const current = activeClearance(props.product);
  const price = props.product.price;
  const [percent, setPercent] = useState(current ? String(current.percent) : "30");
  const [newPrice, setNewPrice] = useState(String(current ? current.price : priceForPercent(price, 30)));
  const [units, setUnits] = useState(String(current?.remaining ?? props.lot?.remaining ?? props.product.stock));
  const [endsAt, setEndsAt] = useState<string | null>(current?.endsAt ?? props.lot?.expiryDate ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (amount: number) => formatMoney(amount, tenant?.settings.currency ?? "NGN");
  const expiry = props.lot?.expiryDate ?? current?.expiry ?? null;

  const changePercent = (value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 2);
    setPercent(clean);
    setNewPrice(clean ? String(priceForPercent(price, Number(clean))) : "");
    setError(null);
  };
  const changePrice = (value: string) => {
    setNewPrice(value);
    setPercent(value && Number(value) < price ? String(Math.round(((price - Number(value)) / price) * 100)) : "");
    setError(null);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setClearance(platform, { productId: props.product.id, clearancePrice: Number(newPrice || "0"), units: Number(units || "0"), endsAt, expiryDate: expiry, staffId: staff!.id });
      await refresh();
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await endClearance(platform, props.product.id);
      await refresh();
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={current ? `Clearance: ${props.product.name}` : `Put on clearance`}
      onClose={props.onClose}
      footer={
        <>
          {current ? <Button label="Stop clearance" variant="danger" onPress={() => void stop()} disabled={busy} /> : <Button label="Cancel" variant="secondary" onPress={props.onClose} />}
          <Button label={current ? "Save changes" : "Start clearance"} busy={busy} onPress={() => void save()} style={{ flex: 1 }} />
        </>
      }
    >
      <Text style={styles.name}>{props.product.name}</Text>
      <Muted>
        Normal price {money(price)} · {props.product.stock} in stock{expiry ? ` · batch expires ${formatIsoDate(expiry)} (${expiryText(daysUntil(expiry)).toLowerCase()})` : ""}
      </Muted>
      <View style={styles.twoColumns}>
        <View style={styles.column}><NumberField label="Percent off" value={percent} onChangeText={changePercent} /></View>
        <View style={styles.column}><NumberField label="Clearance price" value={newPrice} onChangeText={changePrice} /></View>
      </View>
      <NumberField label="Units on clearance" value={units} onChangeText={setUnits} hint={props.lot ? `${props.lot.remaining} left from this batch` : undefined} />
      <DateField label="Clearance ends on" value={endsAt} onChange={setEndsAt} placeholder="No end date" minimumDate={new Date()} hint="Usually the expiry date. After it, the normal price comes back." />
      {Number(newPrice) < price && Number(units) > 0 ? (
        <Banner tone="info" message={`The next ${Number(units)} sold go at ${money(Number(newPrice))} each (save ${money(price - Number(newPrice))}); then ${money(price)} again.`} />
      ) : null}
      <Muted>Cashiers can sell clearance units even if they are not allowed to give discounts. Receipts show them as clearance.</Muted>
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}

/** Product sheet → Expiry tab: the product's batches and its clearance. */
export function ProductExpiryPanel(props: { product: Product }) {
  const { platform, dataVersion, tenant, permissions } = useApp();
  const [lots, setLots] = useState<LotWithRemaining[]>([]);
  const [clearing, setClearing] = useState<LotWithRemaining | "product" | null>(null);
  const clearance = activeClearance(props.product);
  const money = (amount: number) => formatMoney(amount, tenant?.settings.currency ?? "NGN");
  const canClear = permissions.has("catalog.manage");

  useEffect(() => {
    void productLots(platform, props.product).then(setLots, () => undefined);
  }, [platform, props.product, dataVersion]);

  const onShelf = lots.filter((lot) => lot.remaining > 0);

  return (
    <>
      {clearance ? (
        <Banner
          tone="warning"
          message={`On clearance: ${money(clearance.price)} instead of ${money(props.product.price)} (−${clearance.percent}%), ${clearance.remaining} unit${clearance.remaining === 1 ? "" : "s"} left${clearance.endsAt ? `, until ${formatIsoDate(clearance.endsAt)}` : ""}.`}
        />
      ) : null}
      {canClear ? <Button label={clearance ? "Change or stop clearance" : "Put on clearance"} variant="secondary" onPress={() => setClearing("product")} /> : null}
      <Text style={styles.label}>Batches on the shelf</Text>
      {onShelf.length === 0 ? <Muted>No batches recorded. Expiry dates are added when you record an inflow (or opening stock).</Muted> : null}
      {onShelf.map((lot) => (
        <Pressable key={lot.id} disabled={!canClear || !lot.expiryDate} onPress={() => setClearing(lot)} style={styles.lotRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{lot.remaining} of {lot.quantity} left</Text>
            <Text style={styles.meta}>
              Received {new Date(lot.createdAt).toLocaleDateString()}
              {lot.reference ? ` · ${lot.reference}` : ""}
            </Text>
          </View>
          {lot.expiryDate && lot.daysLeft !== null ? <Badge label={`${formatIsoDate(lot.expiryDate)} · ${expiryText(lot.daysLeft)}`} tone={tone(lot.daysLeft)} /> : <Badge label="No expiry date" tone="neutral" />}
        </Pressable>
      ))}
      {clearing ? <ClearanceSheet product={props.product} lot={clearing === "product" ? undefined : clearing} onClose={() => setClearing(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  separator: { height: 1, backgroundColor: colors.surfaceMuted, marginLeft: spacing.lg },
  box: { backgroundColor: "#FFF7E6", borderRadius: radius.md, borderWidth: 1, borderColor: "#F5C46B", padding: spacing.md, gap: spacing.sm },
  boxTitle: { fontSize: font.md, fontWeight: "700", color: colors.text },
  clearanceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { fontSize: font.md, fontWeight: "600", color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
  label: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  column: { flex: 1, minWidth: 130 },
  lotRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceMuted }
});
