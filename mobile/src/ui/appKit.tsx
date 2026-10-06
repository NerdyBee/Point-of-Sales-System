import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform as RNPlatform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "./layout";
import { colors, font, radius, spacing } from "./theme";

/** App-style building blocks: icons, list rows, floating action button, bottom sheets. */

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={props.name} size={props.size ?? 22} color={props.color ?? colors.text} />;
}

export function IconButton(props: { icon: IconName; label: string; onPress: () => void; tone?: "default" | "danger"; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.surfaceMuted }, props.disabled && { opacity: 0.4 }]}
    >
      <Icon name={props.icon} color={props.tone === "danger" ? colors.danger : colors.text} />
    </Pressable>
  );
}

export function ListItem(props: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; muted?: boolean; icon?: IconName }) {
  return (
    <Pressable
      accessibilityRole={props.onPress ? "button" : undefined}
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: colors.surfaceMuted }, props.muted && { opacity: 0.6 }]}
    >
      {props.icon ? (
        <View style={styles.listIcon}>
          <Icon name={props.icon} size={20} color={colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.listTitle} numberOfLines={1}>{props.title}</Text>
        {props.subtitle ? <Text style={styles.listSubtitle} numberOfLines={2}>{props.subtitle}</Text> : null}
      </View>
      {props.right}
      {props.onPress ? <Icon name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

/** Floating "add" button, bottom-right, like most mobile apps. */
export function Fab(props: { label: string; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.primaryPressed }]}
    >
      <Icon name={props.icon ?? "add"} size={24} color={colors.primaryText} />
      <Text style={styles.fabLabel}>{props.label}</Text>
    </Pressable>
  );
}

export function EmptyState(props: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={props.icon} size={34} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{props.title}</Text>
      {props.message ? <Text style={styles.emptyMessage}>{props.message}</Text> : null}
      {props.action}
    </View>
  );
}

/**
 * Bottom sheet on phones (slides up, full width) and a centred dialog on tablets.
 * Content scrolls and stays above the keyboard.
 */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; style?: ViewStyle }) {
  const { compact } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType={compact ? "slide" : "fade"} onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={RNPlatform.OS === "ios" ? "padding" : undefined} style={[styles.backdrop, compact ? styles.backdropCompact : styles.backdropWide]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={props.onClose} />
        <View style={[styles.sheet, compact ? [styles.sheetCompact, { paddingBottom: Math.max(insets.bottom, spacing.lg) }] : styles.sheetWide, props.style]}>
          {compact ? <View style={styles.grabber} /> : null}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{props.title}</Text>
            <IconButton icon="close" label="Close" onPress={props.onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            {props.children}
          </ScrollView>
          {props.footer ? <View style={styles.sheetFooter}>{props.footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  listItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, minHeight: 64 },
  listIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#E7F5F0", alignItems: "center", justifyContent: "center" },
  listTitle: { fontSize: font.md, fontWeight: "600", color: colors.text },
  listSubtitle: { fontSize: font.sm, color: colors.textMuted },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    height: 52,
    borderRadius: 26,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }
  },
  fabLabel: { color: colors.primaryText, fontSize: font.md, fontWeight: "700" },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E7F5F0", alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  emptyTitle: { fontSize: font.lg, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyMessage: { fontSize: font.md, color: colors.textMuted, textAlign: "center", maxWidth: 420 },
  backdrop: { flex: 1, backgroundColor: "rgba(16, 24, 32, 0.45)" },
  backdropCompact: { justifyContent: "flex-end" },
  backdropWide: { justifyContent: "center", alignItems: "center", padding: spacing.xl },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  sheetCompact: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
  sheetWide: { width: "100%", maxWidth: 600, maxHeight: "90%", borderRadius: radius.lg },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  sheetTitle: { flex: 1, fontSize: font.xl, fontWeight: "700", color: colors.text },
  sheetFooter: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }
});
