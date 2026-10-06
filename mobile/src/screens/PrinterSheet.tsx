import { useEffect, useState } from "react";
import { ActivityIndicator, Platform as RNPlatform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { bluetoothSupport, listPrinters, type PrinterDevice, type PrinterTransport } from "../print/bluetooth";
import { defaultPrinterSettings, loadPrinterSettings, printTestPage, savePrinterSettings, type PrinterSettings } from "../print/printer";
import { BRAND } from "../brand";
import { useApp } from "../shell/AppContext";
import { Icon, Sheet } from "../ui/appKit";
import { Banner, Button, Muted } from "../ui/components";
import { colors, font, radius, spacing } from "../ui/theme";

/** Pick and configure the Bluetooth receipt printer used by this device. */
export function PrinterSheet(props: { onClose(): void }) {
  const { platform, tenant } = useApp();
  const support = bluetoothSupport();
  const available = support.classic || support.ble;
  const [settings, setSettings] = useState<PrinterSettings>(defaultPrinterSettings);
  const [transport, setTransport] = useState<PrinterTransport>(support.classic ? "classic" : "ble");
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  useEffect(() => {
    void loadPrinterSettings(platform).then((saved) => {
      setSettings(saved);
      if (saved.device) setTransport(saved.device.transport);
    });
  }, [platform]);

  const update = async (next: PrinterSettings) => {
    setSettings(next);
    await savePrinterSettings(platform, next);
  };

  const search = async () => {
    setSearching(true);
    setMessage(null);
    try {
      const found = await listPrinters(transport);
      setDevices(found);
      if (!found.length) {
        setMessage({
          tone: "info",
          text: transport === "classic" ? "No paired devices. Pair the printer in the phone's Bluetooth settings first (PIN is often 0000 or 1234), then search again." : "No Bluetooth LE devices found. Switch the printer on and keep it close."
        });
      }
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSearching(false);
    }
  };

  const choose = async (device: PrinterDevice) => {
    await update({ ...settings, device });
    setMessage({ tone: "info", text: `${device.name} selected. Print a test page to check it.` });
  };

  const test = async () => {
    if (!settings.device) return;
    setBusy(true);
    setMessage(null);
    try {
      await printTestPage(settings.device, settings.paperWidth, tenant?.settings.businessName ?? BRAND.appName);
      setMessage({ tone: "info", text: "Test page sent." });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Receipt printer"
      onClose={props.onClose}
      footer={
        available ? (
          <>
            {settings.device ? <Button label="Forget printer" variant="secondary" onPress={() => void update({ ...settings, device: null })} /> : null}
            <Button label="Print test page" onPress={() => void test()} busy={busy} disabled={!settings.device} style={{ flex: 1 }} />
          </>
        ) : undefined
      }
    >
      {!available ? (
        <Banner
          tone="warning"
          message="Bluetooth printing needs the installed Ajoke POS app. It is not available in Expo Go. Until then you can share receipts by WhatsApp or SMS from the receipt screen."
        />
      ) : (
        <>
          <View style={styles.current}>
            <Icon name="print-outline" size={26} color={settings.device ? colors.primary : colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.currentName}>{settings.device ? settings.device.name : "No printer selected"}</Text>
              <Text style={styles.currentMeta}>{settings.device ? `${settings.device.transport === "classic" ? "Bluetooth" : "Bluetooth LE"} · ${settings.device.id}` : "Choose one below"}</Text>
            </View>
          </View>

          <Text style={styles.label}>Connection</Text>
          <View style={styles.row}>
            {support.classic ? (
              <Choice label="Bluetooth (paired)" active={transport === "classic"} onPress={() => { setTransport("classic"); setDevices([]); }} />
            ) : null}
            {support.ble ? <Choice label="Bluetooth LE (scan)" active={transport === "ble"} onPress={() => { setTransport("ble"); setDevices([]); }} /> : null}
          </View>
          <Muted>
            {transport === "classic"
              ? "Most 58 mm / 80 mm printers. Pair it once in the phone's Bluetooth settings, then pick it here."
              : RNPlatform.OS === "ios"
                ? "iPhone and iPad can only use printers that support Bluetooth LE."
                : "For printers that advertise Bluetooth LE. Use this if the printer is not in your paired list."}
          </Muted>
          <Button label={searching ? "Searching..." : transport === "classic" ? "Show paired printers" : "Scan for printers"} variant="secondary" onPress={() => void search()} disabled={searching} />
          {searching ? <ActivityIndicator color={colors.primary} /> : null}
          {devices.map((device) => (
            <Pressable key={device.id} onPress={() => void choose(device)} style={[styles.device, settings.device?.id === device.id && styles.deviceActive]}>
              <Icon name="bluetooth" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.currentMeta}>{device.id}</Text>
              </View>
              {settings.device?.id === device.id ? <Icon name="checkmark-circle" size={22} color={colors.primary} /> : null}
            </Pressable>
          ))}

          <Text style={styles.label}>Paper width</Text>
          <View style={styles.row}>
            <Choice label="58 mm (small)" active={settings.paperWidth === 58} onPress={() => void update({ ...settings, paperWidth: 58 })} />
            <Choice label="80 mm (wide)" active={settings.paperWidth === 80} onPress={() => void update({ ...settings, paperWidth: 80 })} />
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Print automatically after each sale</Text>
              <Muted>Otherwise tap Print on the receipt screen.</Muted>
            </View>
            <Switch value={settings.autoPrint} onValueChange={(value) => void update({ ...settings, autoPrint: value })} />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Open cash drawer on cash sales</Text>
              <Muted>Only if a drawer is plugged into the printer.</Muted>
            </View>
            <Switch value={settings.openDrawer} onValueChange={(value) => void update({ ...settings, openDrawer: value })} />
          </View>
        </>
      )}
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
    </Sheet>
  );
}

function Choice(props: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: props.active }} onPress={props.onPress} style={[styles.choice, props.active && styles.choiceActive]}>
      <Text style={[styles.choiceLabel, props.active && { color: colors.primaryText }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  current: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  currentName: { fontSize: font.md, fontWeight: "700", color: colors.text },
  currentMeta: { fontSize: font.sm, color: colors.textMuted },
  label: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceLabel: { fontSize: font.sm, fontWeight: "600", color: colors.text },
  device: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  deviceActive: { borderColor: colors.primary, backgroundColor: "#E7F5F0" },
  deviceName: { fontSize: font.md, fontWeight: "600", color: colors.text },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchLabel: { fontSize: font.md, color: colors.text, fontWeight: "600" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }
});

/** Settings card showing the current printer, opening PrinterSheet. */
export function PrinterCard() {
  const { platform, dataVersion } = useApp();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PrinterSettings | null>(null);

  useEffect(() => {
    void loadPrinterSettings(platform).then(setSettings);
  }, [platform, dataVersion, open]);

  return (
    <View style={styles.card}>
      <Icon name="print-outline" size={26} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.currentName}>Receipt printer</Text>
        <Text style={styles.currentMeta}>
          {settings?.device ? `${settings.device.name} · ${settings.paperWidth} mm${settings.autoPrint ? " · prints automatically" : ""}` : "Not set up"}
        </Text>
      </View>
      <Button label={settings?.device ? "Change" : "Set up"} variant="secondary" onPress={() => setOpen(true)} />
      {open ? <PrinterSheet onClose={() => setOpen(false)} /> : null}
    </View>
  );
}
