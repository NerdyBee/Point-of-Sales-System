import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { LICENSE_VENDOR } from "../license/config";
import { activateLicense } from "../license/licenseStore";
import type { LicenseState } from "../license/licenseStore";
import { useApp } from "../shell/AppContext";
import { Icon } from "../ui/appKit";
import { Banner, Button, Muted, Title } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

/**
 * Shown until this phone has a valid activation code. The device code identifies this
 * phone; the vendor turns it into an activation code that only works here.
 */
export function ActivationScreen(props: { state: LicenseState; onActivated(): void; onSkip?: () => void }) {
  const { platform } = useApp();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previous = props.state.check && !props.state.check.ok ? props.state.check : null;

  const shareDeviceCode = () =>
    void Share.share({
      message: `Please activate NaijaPOS on my device.\nDevice code: ${props.state.deviceCode}${previous?.license ? `\nCurrent licence: ${previous.license.id} (${previous.license.name})` : ""}`
    });

  const activate = async () => {
    setBusy(true);
    setError(null);
    const result = await activateLicense(platform, code);
    setBusy(false);
    if (result.ok) props.onActivated();
    else setError(result.message);
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <View style={styles.badge}>
          <Icon name="key-outline" size={34} color={colors.primary} />
        </View>
        <Title>{previous?.reason === "expired" ? "Renew your licence" : "Activate NaijaPOS"}</Title>
        {previous ? <Banner tone={previous.reason === "expired" ? "warning" : "danger"} message={previous.message} /> : null}
        {previous?.reason === "expired" ? <Muted>Your shop's records are safe on this device. They will be available again as soon as the licence is renewed.</Muted> : null}

        <View style={styles.card}>
          <Text style={styles.step}>1. Send this device code to {LICENSE_VENDOR.name}{LICENSE_VENDOR.phone ? ` (${LICENSE_VENDOR.phone})` : ""}</Text>
          <Text style={styles.deviceCode} selectable accessibilityLabel={`Device code ${props.state.deviceCode.split("").join(" ")}`}>{props.state.deviceCode}</Text>
          <Button label="Share device code" variant="secondary" onPress={shareDeviceCode} />
          <Muted>The app can only be activated on this phone. A copy installed on another phone shows a different code.</Muted>
        </View>

        <View style={styles.card}>
          <Text style={styles.step}>2. Paste the activation code you receive</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Paste the activation code here"
            placeholderTextColor={colors.textMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.codeInput}
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button label="Activate" onPress={() => void activate()} busy={busy} disabled={code.trim().length < 20} large />
        </View>

        {props.onSkip ? (
          <View style={{ gap: spacing.xs }}>
            <Button label="Continue without licence (development build only)" variant="ghost" onPress={props.onSkip} />
            <Muted>This option does not exist in the installable app.</Muted>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  column: { width: "100%", maxWidth: 560, gap: spacing.lg },
  badge: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E7F5F0", alignItems: "center", justifyContent: "center", alignSelf: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  step: { fontSize: font.md, fontWeight: "700", color: colors.text },
  deviceCode: { fontSize: 30, fontWeight: "800", letterSpacing: 2, color: colors.text, textAlign: "center", fontVariant: ["tabular-nums"], paddingVertical: spacing.sm },
  codeInput: { minHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: font.sm, color: colors.text, textAlignVertical: "top", backgroundColor: colors.surface }
});
