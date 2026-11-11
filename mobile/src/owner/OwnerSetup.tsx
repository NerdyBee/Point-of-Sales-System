import { useState } from "react";
import { useApp } from "../shell/AppContext";
import { saveSettings, setKv } from "../sync/settings";
import { Banner, Button, Card, Field, Muted } from "../ui/components";
import { OwnerApi, ownerSignIn, saveOwnerSession } from "./api";

/** First-run form for the boss's phone: server address, then the owner's staff ID and password. */
export function OwnerSetup() {
  const { platform, refresh } = useApp();
  const [url, setUrl] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = await ownerSignIn(platform, url, identifier, password);
      const api = new OwnerApi(platform, session, () => undefined);
      const { tenant } = await api.request<{ tenant: { id: string; name: string } }>("/tenants/current");
      await saveOwnerSession(platform, session);
      await setKv(platform, "owner.lastStaffId", session.staff.id);
      await saveSettings(platform, {
        mode: "owner",
        tenantId: tenant.id,
        tenantName: tenant.name,
        terminalId: "",
        terminalName: "",
        branchId: session.staff.branchId,
        deviceCode: "",
        servers: { cloud: { url: session.url, nodeId: "", role: "cloud", pairedAt: new Date().toISOString() } }
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Card>
      <Field label="Server address" value={url} onChangeText={setUrl} keyboardType="url" autoCapitalize="none" autoCorrect={false} placeholder="e.g. pos.yourbusiness.com" hint="The cloud address your provider gave you." />
      <Field label="Staff ID" value={identifier} onChangeText={(text) => setIdentifier(text.toUpperCase())} autoCapitalize="characters" autoCorrect={false} placeholder="e.g. BEL-MAI-GRA" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      <Muted>Sign in as the owner or a manager. Your web app sign-in works here too.</Muted>
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button label={busy ? "Connecting..." : "Connect"} onPress={() => void connect()} busy={busy} disabled={!url.trim() || !identifier.trim() || !password} large />
    </Card>
  );
}
