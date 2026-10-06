import { forwardRef } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { BRAND } from "../brand";
import { formatMoney } from "../pos/pricing";
import type { ReceiptData } from "./receipt";

const methodNames: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Transfer", mobile_money: "Mobile money", customer_credit: "On account" };

/** Width of the shared receipt image (points; the PNG is this times the screen density). */
export const RECEIPT_IMAGE_WIDTH = 360;

function Row(props: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.text, props.strong && styles.strong, props.muted && styles.muted, { flexShrink: 1 }]}>{props.label}</Text>
      <Text style={[styles.text, props.strong && styles.strong, props.muted && styles.muted]}>{props.value}</Text>
    </View>
  );
}

/**
 * The receipt as it appears in the shared image (WhatsApp). Black on white like paper, so it
 * reads well in chats and prints cleanly if the customer prints it.
 */
export const ReceiptCard = forwardRef<View, { receipt: ReceiptData }>(function ReceiptCard({ receipt }, ref) {
  const money = (amount: number) => formatMoney(amount, receipt.currency);
  const cashPaid = receipt.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
  const change = receipt.tendered !== undefined && cashPaid > 0 ? Math.max(0, receipt.tendered - cashPaid) : 0;
  const date = new Date(receipt.createdAt);

  return (
    <View ref={ref} collapsable={false} style={styles.paper}>
      {receipt.logoPng ? <Image source={{ uri: `data:image/png;base64,${receipt.logoPng}` }} style={styles.logo} resizeMode="contain" /> : null}
      <Text style={styles.business}>{receipt.businessName}</Text>
      {receipt.address ? <Text style={styles.center}>{receipt.address}</Text> : null}
      {receipt.phone ? <Text style={styles.center}>Tel: {receipt.phone}</Text> : null}
      {receipt.taxId ? <Text style={styles.center}>TIN: {receipt.taxId}</Text> : null}
      {receipt.voided ? <Text style={[styles.center, styles.stamp]}>VOIDED</Text> : null}

      <View style={styles.divider} />
      <Row label="Receipt" value={receipt.number} />
      <Row label="Date" value={`${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} />
      <Row label="Served by" value={receipt.staffName} />
      {receipt.customer ? <Row label="Customer" value={receipt.customer.name} /> : null}
      <View style={styles.divider} />

      {receipt.summary.lines.map((line) => (
        <View key={line.productId} style={styles.item}>
          <Text style={[styles.text, styles.itemName]}>{line.name}</Text>
          <Row label={`${line.quantity} × ${money(line.unitPrice)}`} value={money(line.subtotal)} muted />
          {line.discount ? <Row label="Discount" value={`−${money(line.discount)}`} muted /> : null}
        </View>
      ))}
      <View style={styles.divider} />

      <Row label="Subtotal" value={money(receipt.summary.subtotal)} />
      {receipt.summary.discount ? <Row label="Discount" value={`−${money(receipt.summary.discount)}`} /> : null}
      {receipt.summary.vat ? <Row label="VAT" value={money(receipt.summary.vat)} /> : null}
      {receipt.summary.serviceCharge ? <Row label="Service charge" value={money(receipt.summary.serviceCharge)} /> : null}
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>{money(receipt.summary.total)}</Text>
      </View>

      {receipt.payments.map((payment, index) => (
        <Row key={index} label={`${methodNames[payment.method] ?? payment.method}${payment.reference ? ` (${payment.reference})` : ""}`} value={money(payment.method === "cash" && receipt.tendered ? receipt.tendered : payment.amount)} />
      ))}
      {change ? <Row label="Change" value={money(change)} /> : null}
      {receipt.account ? <Row label="Account balance" value={money(receipt.account.balanceAfter)} strong /> : null}

      <View style={styles.divider} />
      {receipt.footer ? <Text style={[styles.center, styles.footer]}>{receipt.footer}</Text> : null}
      <Text style={styles.powered}>Powered by {BRAND.appName}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  paper: { width: RECEIPT_IMAGE_WIDTH, backgroundColor: "#FFFFFF", paddingHorizontal: 22, paddingVertical: 24, alignSelf: "center" },
  logo: { width: 150, height: 84, alignSelf: "center", marginBottom: 8 },
  business: { fontSize: 20, fontWeight: "800", color: "#000000", textAlign: "center" },
  center: { fontSize: 13, color: "#222222", textAlign: "center", marginTop: 2 },
  stamp: { marginTop: 8, fontSize: 18, fontWeight: "800", color: "#B42318", letterSpacing: 4 },
  divider: { borderBottomWidth: 1, borderStyle: "dashed", borderColor: "#999999", marginVertical: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginVertical: 1 },
  text: { fontSize: 13, color: "#111111" },
  strong: { fontWeight: "800", fontSize: 14 },
  muted: { color: "#555555" },
  item: { marginBottom: 6 },
  itemName: { fontWeight: "600" },
  totalBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#111111", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8 },
  totalLabel: { color: "#FFFFFF", fontWeight: "800", fontSize: 15, letterSpacing: 1 },
  totalValue: { color: "#FFFFFF", fontWeight: "800", fontSize: 18 },
  footer: { fontStyle: "italic" },
  powered: { fontSize: 11, color: "#777777", textAlign: "center", marginTop: 8 }
});
