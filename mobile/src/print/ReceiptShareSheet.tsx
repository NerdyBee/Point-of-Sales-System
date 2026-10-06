import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { Sheet } from "../ui/appKit";
import { Banner, Button, Muted } from "../ui/components";
import { spacing } from "../ui/theme";
import { shareReceipt } from "./printer";
import type { ReceiptData } from "./receipt";
import { ReceiptCard } from "./ReceiptCard";

/** Renders the receipt card and shares it as a PNG image (pick WhatsApp in the share sheet). */
export async function shareReceiptImage(view: View, receipt: ReceiptData) {
  const uri = await captureRef(view, { format: "png", quality: 1, result: "tmpfile", fileName: `receipt-${receipt.number.replace(/[^A-Za-z0-9-]/g, "")}` });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device");
  await Sharing.shareAsync(uri.startsWith("file://") ? uri : `file://${uri}`, { mimeType: "image/png", UTI: "public.png", dialogTitle: `Receipt ${receipt.number}` });
}

/**
 * Shows the receipt image and opens the share sheet as soon as it has been drawn, so a cashier
 * taps Share once and picks WhatsApp. The card is captured on screen because Android can return
 * a blank image for views that are hidden or off-screen.
 */
export function ReceiptShareSheet(props: { receipt: ReceiptData; onClose(): void }) {
  const card = useRef<View>(null);
  const started = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    if (!card.current) return;
    setBusy(true);
    setError(null);
    try {
      await shareReceiptImage(card.current, props.receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onLayout = () => {
    if (started.current) return;
    started.current = true;
    // Let the logo image finish drawing before capturing.
    setTimeout(() => void share(), props.receipt.logoPng ? 400 : 150);
  };

  return (
    <Sheet
      title="Send receipt"
      onClose={props.onClose}
      footer={
        <>
          <Button label="Send as text" variant="secondary" onPress={() => void shareReceipt(props.receipt)} />
          <Button label="Share receipt image" busy={busy} onPress={() => void share()} style={{ flex: 1 }} />
        </>
      }
    >
      <Muted>Choose WhatsApp (or any app) in the share menu to send this receipt as a picture.</Muted>
      {error ? <Banner tone="danger" message={`Could not create the image: ${error}. You can send it as text instead.`} /> : null}
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: spacing.sm }}>
        <View style={{ borderWidth: 1, borderColor: "#D9DEE4", borderRadius: 4, overflow: "hidden" }} onLayout={onLayout}>
          <ReceiptCard ref={card} receipt={props.receipt} />
        </View>
      </ScrollView>
    </Sheet>
  );
}
