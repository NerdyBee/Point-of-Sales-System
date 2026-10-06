import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useApp } from "../shell/AppContext";
import { recentSales, type LocalSale, type SaleRecord } from "../pos/actions";
import { formatMoney } from "../pos/pricing";
import { Badge, Muted } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

export function SalesScreen() {
  const { platform, tenant, dataVersion } = useApp();
  const [sales, setSales] = useState<LocalSale[]>([]);
  const currency = tenant?.settings.currency ?? "NGN";

  useEffect(() => {
    void recentSales(platform).then(setSales);
  }, [platform, dataVersion]);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={sales}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={<Muted>No sales on this tablet yet.</Muted>}
      renderItem={({ item }) => {
        const record = JSON.parse(item.data) as SaleRecord;
        return (
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.number}>{item.serverId ?? item.number}</Text>
              <Text style={styles.meta}>
                {new Date(item.createdAt).toLocaleString()} · {record.staffName}
                {record.customer ? ` · ${record.customer.name}` : ""} · {record.summary.lines.reduce((sum, line) => sum + line.quantity, 0)} items
              </Text>
            </View>
            <Text style={styles.total}>{formatMoney(item.total, currency)}</Text>
            <Badge
              label={item.status === "synced" ? "Synced" : item.status === "conflict" ? "Needs review" : "Waiting to sync"}
              tone={item.status === "synced" ? "success" : item.status === "conflict" ? "danger" : "warning"}
            />
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.xl, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  number: { fontSize: font.md, fontWeight: "700", color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted },
  total: { fontSize: font.lg, fontWeight: "700", color: colors.text, minWidth: 110, textAlign: "right" }
});
