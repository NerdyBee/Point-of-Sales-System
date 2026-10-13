import { useRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { markActivity } from "./activity";
import { groupDigits } from "./numberFormat";
import { colors, font, radius, spacing } from "./theme";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button(props: { label: string; onPress: () => void; variant?: ButtonVariant; disabled?: boolean; busy?: boolean; style?: ViewStyle; large?: boolean }) {
  const variant = props.variant ?? "primary";
  const disabled = props.disabled || props.busy;
  // Ignore a second tap that lands before the button has redrawn as busy (double tap).
  const lastPress = useRef(0);
  const onPress = () => {
    const now = Date.now();
    if (now - lastPress.current < 700) return;
    lastPress.current = now;
    props.onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        props.large && styles.buttonLarge,
        variant === "primary" && { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        variant === "secondary" && { backgroundColor: pressed ? colors.border : colors.surfaceMuted },
        variant === "danger" && { backgroundColor: pressed ? "#8F1D14" : colors.danger },
        variant === "ghost" && { backgroundColor: pressed ? colors.surfaceMuted : "transparent" },
        disabled && styles.buttonDisabled,
        props.style
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={variant === "primary" || variant === "danger" ? colors.primaryText : colors.text} />
      ) : (
        <Text style={[styles.buttonLabel, (variant === "secondary" || variant === "ghost") && { color: colors.text }, props.large && { fontSize: font.lg }]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string }) {
  const { label, hint, style, onChangeText, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, style]}
        {...input}
        onChangeText={(text) => {
          markActivity();
          onChangeText?.(text);
        }}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Field for amounts and quantities: shows 30,000 while typing, but the value going in and
 * coming out is plain digits ("30000"), so callers parse it exactly as before.
 */
export function NumberField(props: Omit<TextInputProps, "value" | "onChangeText" | "keyboardType"> & { label: string; hint?: string; value: string; onChangeText(digits: string): void }) {
  const { value, onChangeText, ...rest } = props;
  return <Field {...rest} value={groupDigits(value)} onChangeText={(text) => onChangeText(text.replace(/\D/g, ""))} keyboardType="number-pad" />;
}

export function Card(props: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function Title(props: { children: ReactNode }) {
  return <Text style={styles.title}>{props.children}</Text>;
}

export function Muted(props: { children: ReactNode }) {
  return <Text style={styles.muted}>{props.children}</Text>;
}

export function Badge(props: { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }) {
  const palette = {
    success: [colors.successBg, colors.success],
    warning: [colors.warningBg, colors.warning],
    danger: [colors.dangerBg, colors.danger],
    info: [colors.infoBg, colors.info],
    neutral: [colors.surfaceMuted, colors.textMuted]
  }[props.tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette[0] }]}>
      <Text style={[styles.badgeLabel, { color: palette[1] }]}>{props.label}</Text>
    </View>
  );
}

export function Banner(props: { tone: "warning" | "danger" | "info"; message: string }) {
  const background = props.tone === "danger" ? colors.dangerBg : props.tone === "warning" ? colors.warningBg : colors.infoBg;
  const color = props.tone === "danger" ? colors.danger : props.tone === "warning" ? colors.warning : colors.info;
  return (
    <View style={[styles.banner, { backgroundColor: background }]} accessibilityRole="alert">
      <Text style={{ color, fontSize: font.md }}>{props.message}</Text>
    </View>
  );
}

export function PinPad(props: { value: string; length: number; onChange: (value: string) => void; onSubmit: (value: string) => void; disabled?: boolean }) {
  // Fast taps can arrive before the parent redraws with the new value; track it here too.
  const current = useRef(props.value);
  const shown = useRef(props.value);
  if (props.value !== shown.current) {
    shown.current = props.value;
    current.current = props.value;
  }
  const press = (key: string) => {
    if (props.disabled) return;
    const value = current.current;
    const next = key === "back" ? value.slice(0, -1) : key === "clear" ? "" : value.length >= props.length ? value : value + key;
    if (next === value) return;
    current.current = next;
    props.onChange(next);
    if (key !== "back" && key !== "clear" && next.length === props.length) props.onSubmit(next);
  };
  return (
    <View style={{ alignItems: "center", gap: spacing.lg }}>
      <View style={{ flexDirection: "row", gap: spacing.md }} accessibilityLabel={`${props.value.length} of ${props.length} digits entered`}>
        {Array.from({ length: props.length }, (_, index) => (
          <View key={index} style={[styles.pinDot, index < props.value.length && styles.pinDotFilled]} />
        ))}
      </View>
      <View style={styles.pinGrid}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key === "back" ? "Delete digit" : key === "clear" ? "Clear" : key}
            onPress={() => press(key)}
            style={({ pressed }) => [styles.pinKey, pressed && { backgroundColor: colors.border }]}
          >
            <Text style={styles.pinKeyLabel}>{key === "back" ? "⌫" : key === "clear" ? "C" : key}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  buttonLarge: { minHeight: 60 },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: colors.primaryText, fontSize: font.md, fontWeight: "600" },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.text, fontSize: font.sm, fontWeight: "600" },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: font.md, color: colors.text, backgroundColor: colors.surface },
  hint: { color: colors.textMuted, fontSize: font.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  title: { fontSize: font.xl, fontWeight: "700", color: colors.text },
  muted: { fontSize: font.md, color: colors.textMuted },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, alignSelf: "flex-start" },
  badgeLabel: { fontSize: font.sm, fontWeight: "600" },
  banner: { padding: spacing.md, borderRadius: radius.md },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.textMuted },
  pinDotFilled: { backgroundColor: colors.text, borderColor: colors.text },
  pinGrid: { width: 300, flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "center" },
  pinKey: { width: 88, height: 68, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  pinKeyLabel: { fontSize: font.xl, fontWeight: "600", color: colors.text }
});
