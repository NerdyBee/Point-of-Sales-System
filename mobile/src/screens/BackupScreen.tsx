import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { resetLocalData } from "../data/schema";
import { useApp } from "../shell/AppContext";
import { exportBackup, hasBackupPassword, inspectBackup, lastBackupAt, restoreBackup, setBackupPassword } from "../standalone/business";
import { BackupPasswordSheet, type BackupPasswordMode } from "./BackupPassword";
import { pickBackupFile, shareBackupFile } from "../standalone/files";
import { Banner, Button, Card, Muted, Title } from "../ui/components";
import { PrinterCard } from "./PrinterSheet";
import { AboutLine } from "../ui/BrandMark";
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
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [sheet, setSheet] = useState<{ mode: BackupPasswordMode; description?: string; onSubmit(password: string): Promise<void> } | null>(null);
  const canManage = !staff || permissions.has("settings.manage");

  useEffect(() => {
    void lastBackupAt(platform).then(setLastAt, () => undefined);
    void hasBackupPassword(platform).then(setHasPassword, () => setHasPassword(false));
  }, [platform, dataVersion]);

  const age = backupAgeDays(lastAt);

  const backUp = async () => {
    setMessage(null);
    if (!(await hasBackupPassword(platform))) {
      // First backup on this phone: choose the password, then carry on with the backup.
      setSheet({
        mode: "set",
        onSubmit: async (password) => {
          await setBackupPassword(platform, password);
          setHasPassword(true);
          setSheet(null);
          await backUp();
        }
      });
      return;
    }
    setBusy(true);
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
              const finish = async (password?: string) => {
                await restoreBackup(platform, content, password);
                setSheet(null);
                signOut();
                await refresh();
                setMessage({ tone: "info", text: "Backup restored." });
              };
              const info = inspectBackup(content);
              if (info.locked) {
                const made = info.exportedAt ? ` made on ${new Date(info.exportedAt).toLocaleString()}` : "";
                setSheet({ mode: "unlock", description: `${info.businessName ?? "Backup"}${made}.`, onSubmit: finish });
              } else {
                await finish();
              }
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

        <PrinterCard />

        <Card>
          <Text style={styles.heading}>Make a backup</Text>
          <Muted>Last backup: {lastAt ? new Date(lastAt).toLocaleString() : "never"}</Muted>
          <Button label="Back up now" busy={busy} onPress={() => void backUp()} large />
          <Muted>
            {hasPassword
              ? "Backups are locked with your backup password. You need it to restore on a new phone."
              : "Your first backup asks you to set a backup password, so the file stays private."}
          </Muted>
          {hasPassword && canManage ? (
            <Button
              label="Change backup password"
              variant="ghost"
              onPress={() =>
                setSheet({
                  mode: "change",
                  description: "New backups will use the new password. Backups made before keep their old password.",
                  onSubmit: async (password) => {
                    await setBackupPassword(platform, password);
                    setSheet(null);
                    setMessage({ tone: "info", text: "Backup password changed. Make a new backup now so it uses the new password." });
                  }
                })
              }
            />
          ) : null}
        </Card>

        {canManage ? (
          <Card>
            <Text style={styles.heading}>Restore or move to a new device</Text>
            <Muted>On a new device, choose "This device only" and then "Restore from a backup file". Here you can replace this device's records with a backup.</Muted>
            <Button label="Restore from backup file" variant="secondary" onPress={restore} />
            <Button label="Erase this device" variant="danger" onPress={reset} />
          </Card>
        ) : null}
        <AboutLine />
      </View>
      {sheet ? <BackupPasswordSheet mode={sheet.mode} description={sheet.description} onSubmit={sheet.onSubmit} onClose={() => setSheet(null)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, alignItems: "center", backgroundColor: colors.background, flexGrow: 1 },
  column: { width: "100%", maxWidth: 680, gap: spacing.lg },
  heading: { fontSize: font.lg, fontWeight: "700", color: colors.text }
});
