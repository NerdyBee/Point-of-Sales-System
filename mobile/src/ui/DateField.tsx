import RNDateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform as RNPlatform, Pressable, StyleSheet, Text, View } from "react-native";
import { Sheet } from "./appKit";
import { Button } from "./components";
import { colors, font, radius, spacing } from "./theme";

/** YYYY-MM-DD in device local time. */
export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function fromIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatIsoDate(value: string) {
  return fromIsoDate(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** A date chosen from a calendar (Android dialog, iOS sheet), stored as YYYY-MM-DD; optional. */
export function DateField(props: { label: string; value: string | null; onChange(value: string | null): void; placeholder?: string; minimumDate?: Date; hint?: string }) {
  const [picking, setPicking] = useState(false);
  const current = props.value ? fromIsoDate(props.value) : new Date();

  const open = () => {
    if (RNPlatform.OS === "android") {
      DateTimePickerAndroid.open({ value: current, mode: "date", minimumDate: props.minimumDate, onValueChange: (_event, date) => props.onChange(toIsoDate(date)) });
    } else {
      setPicking(true);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.label}: ${props.value ? formatIsoDate(props.value) : "not set"}`} onPress={open} style={styles.button}>
          <Text style={[styles.value, !props.value && styles.placeholder]}>{props.value ? formatIsoDate(props.value) : props.placeholder ?? "Choose date"}</Text>
        </Pressable>
        {props.value ? <Button label="Clear" variant="ghost" onPress={() => props.onChange(null)} /> : null}
      </View>
      {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
      {picking ? (
        <Sheet title={props.label} onClose={() => setPicking(false)} footer={<Button label="Done" onPress={() => setPicking(false)} style={{ flex: 1 }} />}>
          <RNDateTimePicker value={current} mode="date" display="inline" minimumDate={props.minimumDate} onValueChange={(_event, date) => props.onChange(toIsoDate(date))} />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  button: { flex: 1, minHeight: 46, justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  value: { fontSize: font.md, color: colors.text },
  placeholder: { color: colors.textMuted },
  hint: { fontSize: font.sm, color: colors.textMuted }
});
