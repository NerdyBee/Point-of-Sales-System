import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { Staff } from "../data/readModel";
import { LICENSE_VENDOR } from "../license/config";
import { useApp } from "../shell/AppContext";
import { checkPinResetCode, completePinReset, pinResetRequest, PIN_RESET_REQUEST_DAYS } from "../standalone/pinRecovery";
import { Banner, Button, Field, Muted, PinPad, Title } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

type Step = "request" | "pin" | "confirm";

/**
 * Forgot PIN for an owner: show a one-time request code, the vendor sends back a signed
 * reset code, then the owner chooses a new PIN. Nothing else on the device changes.
 */
export function PinRecovery(props: { owner: Staff; onCancel(): void; onDone(owner: Staff): void }) {
  const { platform, settings, tenant } = useApp();
  const [requestCode, setRequestCode] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState("");
  const [step, setStep] = useState<Step>("request");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const businessName = tenant?.settings.businessName ?? settings?.tenantName ?? "";

  useEffect(() => {
    pinResetRequest(platform, props.owner.id)
      .then((request) => setRequestCode(request.requestCode))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [platform, props.owner.id]);

  const shareRequest = () => {
    if (!requestCode) return;
    void Share.share({
      title: "PIN reset request",
      message: `Ajoke POS owner PIN reset request\nShop: ${businessName}\nOwner: ${props.owner.name}\nRequest code: ${requestCode}`
    });
  };

  const checkCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkPinResetCode(platform, props.owner.id, resetCode);
      setStep("pin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const choosePin = (value: string) => {
    setFirstPin(value);
    setPin("");
    setError(null);
    setStep("confirm");
  };

  const confirmPin = async (value: string) => {
    setPin("");
    if (value !== firstPin) {
      setError("The PINs do not match. Enter the new PIN again.");
      setFirstPin("");
      setStep("pin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      props.onDone(await completePinReset(platform, { staffId: props.owner.id, resetCode, pin: value }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setFirstPin("");
      setStep("pin");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <Button label="← Back to sign in" variant="ghost" onPress={props.onCancel} style={{ alignSelf: "flex-start" }} />
        <Title>Reset {props.owner.name}'s PIN</Title>

        {step === "request" ? (
          <>
            <Muted>
              1. Send this request code to {LICENSE_VENDOR.name}
              {LICENSE_VENDOR.phone ? ` (${LICENSE_VENDOR.phone})` : ""}. They will check that you are the owner and send back a reset code.
            </Muted>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Request code</Text>
              <Text style={styles.code} selectable>{requestCode ?? "…"}</Text>
            </View>
            <Button label="Share request code" variant="secondary" onPress={shareRequest} disabled={!requestCode} />
            <Muted>2. Paste the reset code you receive below. It works once, on this phone only, within {PIN_RESET_REQUEST_DAYS} days.</Muted>
            <Field label="Reset code" value={resetCode} onChangeText={setResetCode} placeholder="Paste the reset code here" autoCapitalize="none" autoCorrect={false} multiline />
            <Button label="Continue" busy={busy} disabled={!resetCode.trim() || !requestCode} onPress={() => void checkCode()} large />
            <Muted>Only the shop's owner can reset their PIN this way. Other staff: ask an owner to set a new PIN in Manage → Staff.</Muted>
          </>
        ) : (
          <View style={styles.pad}>
            <Banner tone="info" message="Reset code accepted. Choose a new 6-digit PIN." />
            <Text style={styles.prompt}>{step === "pin" ? "New PIN" : "Enter the new PIN again"}</Text>
            <PinPad
              key={step}
              value={pin}
              length={6}
              onChange={setPin}
              disabled={busy}
              onSubmit={(value) => (step === "pin" ? choosePin(value) : void confirmPin(value))}
            />
          </View>
        )}
        {error ? <Banner tone="danger" message={error} /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: spacing.md },
  codeBox: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary, alignItems: "center", gap: spacing.xs },
  codeLabel: { fontSize: font.sm, color: colors.textMuted },
  code: { fontSize: font.xl, fontWeight: "800", color: colors.text, letterSpacing: 1.5, textAlign: "center" },
  pad: { alignItems: "center", gap: spacing.lg },
  prompt: { fontSize: font.lg, fontWeight: "600", color: colors.text }
});
