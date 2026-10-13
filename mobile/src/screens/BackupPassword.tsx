import { useState } from "react";
import { LICENSE_VENDOR } from "../license/config";
import { MIN_BACKUP_PASSWORD } from "../standalone/business";
import { Sheet } from "../ui/appKit";
import { Banner, Button, Field, Muted } from "../ui/components";

export type BackupPasswordMode = "set" | "change" | "unlock";

const titles: Record<BackupPasswordMode, string> = {
  set: "Set a backup password",
  change: "Change backup password",
  unlock: "Backup password"
};

/**
 * Asks for the backup password: to set it before the first backup, to change it, or to
 * unlock a backup file when restoring. onSubmit does the work and may throw (shown here).
 */
export function BackupPasswordSheet(props: { mode: BackupPasswordMode; description?: string; onSubmit(password: string): Promise<void>; onClose(): void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choosing = props.mode !== "unlock";

  const submit = async () => {
    setError(null);
    if (choosing) {
      if (password.length < MIN_BACKUP_PASSWORD) return setError(`Use at least ${MIN_BACKUP_PASSWORD} characters.`);
      if (password !== again) return setError("The two passwords are different. Type them again.");
    } else if (!password) {
      return setError("Enter the backup password.");
    }
    setBusy(true);
    try {
      await props.onSubmit(password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={titles[props.mode]}
      onClose={props.onClose}
      footer={
        <>
          <Button label="Cancel" variant="secondary" onPress={props.onClose} disabled={busy} />
          <Button label={props.mode === "unlock" ? "Unlock and restore" : "Save password"} busy={busy} onPress={() => void submit()} style={{ flex: 1 }} />
        </>
      }
    >
      {props.description ? <Muted>{props.description}</Muted> : null}
      {choosing ? (
        <Muted>
          Backup files are locked with this password, so customer details and records stay private if a file is shared or lost. You need it to restore a backup on a new
          phone. Write it down and keep it safe. If it is ever lost, {LICENSE_VENDOR.name} can unlock your backup for you.
        </Muted>
      ) : (
        <Muted>This backup is locked. Enter the backup password that was set on the phone that made it.</Muted>
      )}
      <Field label={choosing ? "New backup password" : "Backup password"} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      {choosing ? <Field label="Type it again" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} /> : null}
      {busy ? <Muted>{props.mode === "unlock" ? "Unlocking… this can take a few seconds." : "Saving…"}</Muted> : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </Sheet>
  );
}
