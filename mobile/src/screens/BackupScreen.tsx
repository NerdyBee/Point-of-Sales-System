import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { resetLocalData } from "../data/schema";
import { useApp } from "../shell/AppContext";
import { exportBackup, lastBackupAt, restoreBackup } from "../standalone/business";
import { pickBackupFile, shareBackupFile } from "../standalone/files";
import { Banner, Button, Card, Muted, Title } from "../ui/components";
import { colors, font, spacing } from "../ui/theme";

export const backupReminderDays = 7;

export function backupAgeDays(at: string | null) {
  return at ? Math.floor((Date.now() - Date.parse(at)) / 86_400_000) : null;
}

/** Standalone tablets keep the only copy of the shop's records, so backups matter. */
export function BackupScreen() {
  const { platform, settings, dataVersion, refresh, permissions, staff, signOut } = useApp();
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const canManage = !staff || permissions.has("settings.manage");

  useEffect(() => {
    void lastBackupAt(platform).then(setLastAt);
  }, [platform, dataVersion]);

  const age = backupAgeDays(lastAt);

  const backUp = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const backup = await exportBackup(platform);
      await shareBackupFile(backup.fileName, backup.content);
      setMessage({ tone: "info", text: `Backup ${backup.fileName} created. Save it somewhere off this device (Google Drive, email, WhatsApp to yourself).` });
      await refresh();
    } catch (cause) {
      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  };

  const restore = () => {
    Alert.alert("Restore a backup?", "Everything on this device is replaced by the backup. Sales made since that backup are lost.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Choose file",
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              const content = await pickBackupFile();
              if (!content) return;
              await restoreBackup(platform, content);
              signOut();
              await refresh();
              setMessage({ tone: "info", text: "Backup restored." });
            } catch (cause) {
              setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
            }
          })()
      }
    ]);
  };

  const reset = () => {
    Alert.alert("Erase this device?", "All products, staff, sales and settings are deleted. Make a backup first if you may need them.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Erase",
        style: "destructive",
        onPress: () =>
          void (async () => {
            await resetLocalData(platform.db);
            signOut();
            await refresh();
          })()
      }
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.column}>
        <Title>Backup</Title>
        <Muted>{settings?.tenantName} runs on this device only. The records exist nowhere else until you make a backup.</Muted>
        {age === null || age >= backupReminderDays ? (
          <Banner tone="warning" message={age === null ? "No backup has been made yet." : `Last backup was ${age} days ago.`} />
        ) : null}
        {message ? <Banner tone={message.tone} message={message.text} /> : null}

        <Card>
          <Text style={styles.heading}>Make a backup</Text>
          <Muted>Last backup: {lastAt ? new Date(lastAt).toLocaleString() : "never"}</Muted>
          <Button label="Back up now" busy={busy} onPress={() => void backUp()} large />
        </Card>

        {canManage ? (
          <Card>
            <Text style={styles.heading}>Restore or move to a new device</Text>
            <Muted>On a new device, choose "This device only" and then "Restore from a backup file". Here you can replace this device's records with a backup.</Muted>
            <Button label="Restore from backup file" variant="secondary" onPress={restore} />
            <Button label="Erase this device" variant="danger" onPress={reset} />
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, alignItems: "center", backgroundColor: colors.background, flexGrow: 1 },
  column: { width: "100%", maxWidth: 680, gap: spacing.lg },
  heading: { fontSize: font.lg, fontWeight: "700", color: colors.text }
});
