import { Copy, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { activateServerLicense, type LicenseStatus } from "../../shared/api/client";
import { LICENSE_VENDOR } from "../../shared/vendor";

interface LicenseViewProps {
  status: LicenseStatus;
  onActivated(status: LicenseStatus): void;
}

/** Shown instead of everything else until this installation has a valid activation code. */
export function LicenseView({ status, onActivated }: LicenseViewProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const expired = Boolean(status.licensedTo);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      onActivated(await activateServerLicense(code));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyDeviceCode() {
    try {
      await navigator.clipboard.writeText(status.deviceCode);
      setCopied(true);
    } catch {
      // Clipboard needs a secure page; the code is on screen to copy by hand.
    }
  }

  return (
    <div className="auth-terminal-view">
      <section className="samba-login-window setup-window">
        <header className="samba-login-titlebar">
          <div className="brand-mark">AP</div>
          <div>
            <strong>{expired ? "Renew Ajoke POS" : "Activate Ajoke POS"}</strong>
            <span>{status.message ?? "This copy of Ajoke POS is not activated yet."}</span>
          </div>
        </header>

        <form className="setup-body setup-form" onSubmit={(event) => void submit(event)}>
          <div className="setup-note license-note">
            <KeyRound size={28} />
            <span>Send this computer's code to {LICENSE_VENDOR.name}{LICENSE_VENDOR.phone ? ` (WhatsApp ${LICENSE_VENDOR.phone})` : ""} to get your activation code.</span>
            <b className="setup-staff-id">{status.deviceCode}</b>
            <button type="button" className="secondary-button" onClick={() => void copyDeviceCode()}>
              <Copy size={16} /> {copied ? "Copied" : "Copy code"}
            </button>
            {expired ? <span>Licensed to {status.licensedTo}{status.expires ? `, valid until ${status.expires}` : ""}. Your data is safe and comes back as soon as you enter a new code.</span> : null}
          </div>

          <label className="setup-wide">
            Activation code
            <textarea value={code} onChange={(event) => setCode(event.target.value)} rows={4} placeholder="Paste the whole code you were sent" required />
          </label>
          {error ? <p className="setup-error">{error}</p> : null}
          <button type="submit" className="primary-button" disabled={busy || !code.trim()}>{busy ? "Checking..." : "Activate"}</button>
        </form>

        <footer className="setup-footer">Ajoke Code Sphere</footer>
      </section>
    </div>
  );
}
