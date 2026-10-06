import { Image, StyleSheet, Text, View } from "react-native";
import { aboutLine, BRAND } from "../brand";
import { colors, font, spacing } from "./theme";

const logo = require("../../assets/logo.png") as number;

/** App logo with the product name. */
export function BrandHeader(props: { size?: number }) {
  const size = props.size ?? 72;
  return (
    <View style={styles.header}>
      <Image source={logo} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors accessibilityLabel={`${BRAND.appName} logo`} />
      <Text style={styles.name}>{BRAND.appName}</Text>
    </View>
  );
}

/** "Ajoke POS vX · Developed by Ajoke Code Sphere" credit line. */
export function AboutLine() {
  return <Text style={styles.about}>{aboutLine}</Text>;
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: spacing.xs },
  name: { fontSize: font.lg, fontWeight: "800", color: colors.text, letterSpacing: 0.5 },
  about: { fontSize: 12, color: colors.textMuted, textAlign: "center" }
});
