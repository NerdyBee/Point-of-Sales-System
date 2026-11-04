import { Check, Store } from "lucide-react";
import { type FormEvent, useState } from "react";
import { createFirstBusiness, loginWithPassword, storeAuth } from "../../shared/api/client";
import { currencies, formatMoney } from "../../shared/utils/money";

interface SetupViewProps {
  /** False when this browser is not on the server computer: creating is refused there. */
  local: boolean;
}

const emptyForm = {
  businessName: "",
  currency: "USD",
  vatPercent: "0",
  branchName: "Main",
  city: "",
  ownerName: "",
  email: "",
  phone: "",
  password: "",
  passwordAgain: "",
  pin: "",
  pinAgain: ""
};

/**
 * First-run page of an offline install: creates the business and its owner, then signs the
 * owner in. Shown instead of the sign-in screen while the installation has no business.
 */
export function SetupView({ local }: SetupViewProps) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ staffId: string; tenantId: string } | null>(null);

  const currency = currencies.find((item) => item.code === form.currency);
  const update = (field: keyof typeof emptyForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (form.password !== form.passwordAgain) return setError("The two passwords do not match.");
    if (form.pin !== form.pinAgain) return setError("The two PINs do not match.");
    if (form.pin && /^(\d)\1{5}$|^123456$|^654321$/.test(form.pin)) return setError("Choose a PIN that is harder to guess.");

    setBusy(true);
    try {
      const { business } = await createFirstBusiness({
        businessName: form.businessName,
        currency: form.currency,
        vatPercent: Number(form.vatPercent) || 0,
        branchName: form.branchName,
        city: form.city,
        ownerName: form.ownerName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        pin: form.pin
      });
      setCreated({ staffId: business.staffId, tenantId: business.tenantId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function continueSignedIn() {
    if (!created) return;
    setBusy(true);
    try {
      storeAuth(await loginWithPassword({ identifier: created.staffId, password: form.password }));
    } catch {
      // Fall back to the normal sign-in screen.
      window.location.reload();
    }
  }

  return (
    <div className="auth-terminal-view">
      <section className="samba-login-window setup-window">
        <header className="samba-login-titlebar">
          <div className="brand-mark">AP</div>
          <div>
            <strong>Welcome to Ajoke POS</strong>
            <span>Create your business to get started</span>
          </div>
        </header>

        {!local ? (
          <div className="setup-body">
            <div className="setup-note">
              <Store size={28} />
              <strong>Finish setup on the shop computer</strong>
              <span>Open Ajoke POS on the computer where it was installed (the desktop shortcut, or http://localhost:4000) to create the business. Then come back here and sign in.</span>
            </div>
          </div>
        ) : created ? (
          <div className="setup-body">
            <div className="setup-note setup-done">
              <Check size={28} />
              <strong>{form.businessName} is ready</strong>
              <span>Your staff ID is</span>
              <b className="setup-staff-id">{created.staffId}</b>
              <span>Write it down: you sign in with this staff ID and your password{form.pin ? ", or the staff ID and your PIN" : ""}.</span>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void continueSignedIn()}>
                {busy ? "Signing in..." : "Continue"}
              </button>
            </div>
          </div>
        ) : (
          <form className="setup-body setup-form" onSubmit={(event) => void submit(event)}>
            <fieldset>
              <legend>Your business</legend>
              <label className="setup-wide">
                Business name
                <input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="e.g. Bella Foods" required minLength={2} autoFocus />
              </label>
              <label>
                Currency
                <select value={form.currency} onChange={(event) => update("currency", event.target.value)}>
                  {currencies.map((item) => <option key={item.code} value={item.code}>{item.code} - {item.name}</option>)}
                </select>
              </label>
              <label>
                VAT / sales tax %
                <input type="number" min={0} max={99} step={0.01} value={form.vatPercent} onChange={(event) => update("vatPercent", event.target.value)} required />
              </label>
              <p className="setup-hint setup-wide">
                Prices will look like {currency?.decimals ? formatMoney(499, form.currency, currency.decimals) : formatMoney(1500, form.currency, 0)}. The currency cannot be changed later.
              </p>
              <label>
                Shop / branch name
                <input value={form.branchName} onChange={(event) => update("branchName", event.target.value)} required />
              </label>
              <label>
                City
                <input value={form.city} onChange={(event) => update("city", event.target.value)} placeholder="Optional" />
              </label>
            </fieldset>

            <fieldset>
              <legend>Owner account</legend>
              <label className="setup-wide">
                Your name
                <input value={form.ownerName} onChange={(event) => update("ownerName", event.target.value)} required minLength={2} autoComplete="name" />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required autoComplete="email" />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="Optional" autoComplete="tel" />
              </label>
              <label>
                Password
                <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              <label>
                Repeat password
                <input type="password" value={form.passwordAgain} onChange={(event) => update("passwordAgain", event.target.value)} required autoComplete="new-password" />
              </label>
              <label>
                6-digit PIN (for quick sign-in)
                <input inputMode="numeric" pattern="\d{6}" maxLength={6} value={form.pin} onChange={(event) => update("pin", event.target.value.replace(/\D/g, ""))} placeholder="Optional" />
              </label>
              <label>
                Repeat PIN
                <input inputMode="numeric" pattern="\d{6}" maxLength={6} value={form.pinAgain} onChange={(event) => update("pinAgain", event.target.value.replace(/\D/g, ""))} />
              </label>
            </fieldset>

            {error ? <p className="setup-error">{error}</p> : null}
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Creating your business..." : "Create business"}</button>
          </form>
        )}

        <footer className="setup-footer">Ajoke Code Sphere</footer>
      </section>
    </div>
  );
}
