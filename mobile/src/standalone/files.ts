import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Writes the backup to the cache and opens the share sheet (Drive, WhatsApp, email, USB...). */
export async function shareBackupFile(fileName: string, content: string) {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device");
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save Ajoke POS backup" });
}

/** Lets the user pick a backup file; returns its text, or null if cancelled. */
export async function pickBackupFile() {
  const result = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "*/*"], copyToCacheDirectory: true });
  if (result.canceled || !result.assets.length) return null;
  return new File(result.assets[0].uri).text();
}
