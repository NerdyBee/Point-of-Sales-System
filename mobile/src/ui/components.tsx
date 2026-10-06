import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { colors, font, radius, spacing } from "./theme";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button(props: { label: string; onPress: () => void; variant?: ButtonVariant; disabled?: boolean; busy?: boolean; style?: ViewStyle; large?: boolean }) {
  const variant = props.variant ?? "primary";
  const disabled = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
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
  const { label, hint, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} style={[styles.input, style]} {...input} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
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
  const press = (key: string) => {
    if (props.disabled) return;
    if (key === "back") return props.onChange(props.value.slice(0, -1));
    if (key === "clear") return props.onChange("");
    const next = (props.value + key).slice(0, props.length);
    props.onChange(next);
    if (next.length === props.length) props.onSubmit(next);
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
