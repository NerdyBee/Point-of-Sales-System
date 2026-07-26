import { ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, RefreshCcw, ShieldCheck, Smartphone, Store, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  fetchAuthBootstrap,
  fetchAuthSessions,
  fetchBranchOptions,
  fetchStaff,
  clearStoredAuth,
  loginWithPassword,
  loginWithPin,
  refreshAuth,
  revokeAuthSession,
  storeAuth,
  type AuthResponse,
  type AuthSession,
  type BranchOption,
  type StaffMember,
  type TerminalOption
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";

const lastTenantKey = "naijapos:last-tenant-id";
const fallbackBranches: BranchOption[] = [];
type PinStaffOption = Pick<StaffMember, "id" | "tenantId" | "branchId" | "name" | "role" | "pinEnabled" | "active">;

interface SecurityViewProps {
  auth: AuthResponse | null;
  onAuthChange: (auth: AuthResponse | null) => void;
}

function sessionTone(session: AuthSession): "success" | "warning" | "danger" | "info" {
  if (session.revokedAt) return "danger";
  if (new Date(session.expiresAt).getTime() < Date.now()) return "warning";
  return "success";
}

function sessionLabel(session: AuthSession) {
  if (session.revokedAt) return "revoked";
  if (new Date(session.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

function rememberTenantId(tenantId: string) {
  try {
    localStorage.setItem(lastTenantKey, tenantId);
  } catch {
    // Ignore storage errors so private/offline browser modes can still sign in.
  }
}

function normalizeLoginText(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

export function SecurityView({ auth, onAuthChange }: SecurityViewProps) {
  const activeUserId = auth?.staff.id ?? "";
  const [tenantId, setTenantId] = useState(auth?.staff.tenantId ?? "tenant-lagos-foods");
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [staff, setStaff] = useState<PinStaffOption[]>([]);
  const [branchId, setBranchId] = useState(auth?.session.branchId ?? auth?.staff.branchId ?? "");
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [allLoginTerminals, setAllLoginTerminals] = useState<TerminalOption[]>([]);
  const [loginForm, setLoginForm] = useState({ email: auth?.staff.email ?? "adaeze@example.com", password: "", terminalId: auth?.session.terminalId ?? "" });
  const [pinForm, setPinForm] = useState({ staffId: "", terminalId: "", pin: "" });
  const [rememberDevice, setRememberDevice] = useState(true);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [status, setStatus] = useState("Ready");

  const activeSessions = useMemo(() => sessions.filter((session) => sessionLabel(session) === "active").length, [sessions]);
  const pinEnabledStaff = useMemo(() => staff.filter((member) => member.pinEnabled && member.active).length, [staff]);
  const sessionsPage = usePaginatedRows(sessions, 10);

  async function loadSecurity(nextBranchId = branchId, nextTenantId = tenantId) {
    setStatus("Syncing security...");

    try {
      if (!auth) {
        const loginTenantId = nextTenantId.trim();

        if (!loginTenantId) {
          setBranches([]);
          setSessions([]);
          setStaff([]);
          setTerminals([]);
          setStatus("Enter tenant ID to load login options");
          return;
        }

        rememberTenantId(loginTenantId);
        const bootstrap = await fetchAuthBootstrap(loginTenantId, nextBranchId || undefined);
        const preferredStaff = bootstrap.staff.find((member) => member.role === "cashier" || member.role === "teller")
          ?? bootstrap.staff.find((member) => member.pinEnabled && member.active);
        const effectiveBranchId = nextBranchId || preferredStaff?.branchId || bootstrap.branches[0]?.id || "";
        const branchTerminals = effectiveBranchId
          ? bootstrap.terminals.filter((terminal) => terminal.branchId === effectiveBranchId)
          : [];
        const effectiveTerminalId = (branchTerminals.find((terminal) => terminal.status === "online") ?? branchTerminals[0])?.id || "";
        setBranches(bootstrap.branches);
        setAllLoginTerminals(bootstrap.terminals);
        setSessions([]);
        setStaff(bootstrap.staff);
        setTerminals(branchTerminals);
        setBranchId(effectiveBranchId);
        setLoginForm((current) => ({
          ...current,
          terminalId: branchTerminals.some((terminal) => terminal.id === current.terminalId) ? current.terminalId : effectiveTerminalId
        }));
        setPinForm((current) => ({
          ...current,
          staffId: bootstrap.staff.some((member) => member.id === current.staffId && member.pinEnabled && member.branchId === effectiveBranchId)
            ? current.staffId
            : preferredStaff?.id ?? "",
          terminalId: branchTerminals.some((terminal) => terminal.id === current.terminalId) ? current.terminalId : effectiveTerminalId
        }));
        setStatus(effectiveBranchId ? "Ready for PIN" : "Select a branch");
        return;
      }

      const branchResponse = await fetchBranchOptions();
      const branchTerminals = branchResponse.terminals.filter((terminal) => terminal.branchId === nextBranchId);
      setBranches(branchResponse.branches);
      setAllLoginTerminals(branchResponse.terminals);
      setTerminals(branchTerminals);

      if (!nextBranchId) {
        setSessions([]);
        setStaff([]);
        setStatus("Select a branch to load security sessions");
        return;
      }

      const [sessionResponse, staffResponse] = await Promise.all([
        fetchAuthSessions(activeUserId, nextBranchId),
        fetchStaff(nextBranchId, activeUserId)
      ]);
      setSessions(sessionResponse.sessions);
      setStaff(staffResponse.staff);
      setLoginForm((current) => ({
        ...current,
        terminalId: branchTerminals.some((terminal) => terminal.id === current.terminalId) ? current.terminalId : ""
      }));
      setPinForm((current) => ({
        ...current,
        staffId: staffResponse.staff.some((member) => member.id === current.staffId && member.pinEnabled) ? current.staffId : "",
        terminalId: branchTerminals.some((terminal) => terminal.id === current.terminalId) ? current.terminalId : ""
      }));
      setStatus("Security synced");
    } catch (error) {
      setBranches((current) => (current.length > 0 ? current : fallbackBranches));
      setStaff([]);
      setTerminals([]);
      setStatus(error instanceof Error ? error.message : "Unable to load security");
    }
  }

  useEffect(() => {
    void loadSecurity(branchId);
  }, [auth?.session.id]);

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setLoginForm((current) => ({ ...current, terminalId: "" }));
    setPinForm((current) => ({ ...current, staffId: "", terminalId: "" }));
    void loadSecurity(nextBranchId);
  }

  function changeTenant(nextTenantId: string) {
    setTenantId(nextTenantId);
    setBranchId("");
    setBranches([]);
    setTerminals([]);
    setAllLoginTerminals([]);
    setStaff([]);
    setLoginForm((current) => ({ ...current, terminalId: "" }));
    setPinForm((current) => ({ ...current, staffId: "", terminalId: "" }));
  }

  function selectedStaffInitials(name: string) {
    return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  }

  function seededEmailForStaff(staffId: string, name: string) {
    const seededEmails: Record<string, string> = {
      "owner-1": "adaeze@example.com",
      "staff-1": "chinelo@example.com",
      "staff-2": "musa@example.com",
      "staff-3": "sarah@example.com",
      "staff-4": "tunde@example.com"
    };
    return seededEmails[staffId] ?? `${name.split(" ")[0].toLowerCase()}@example.com`;
  }

  function displayRole(role: string) {
    if (role === "cashier" || role === "teller") return "Cashier / Teller";
    return role.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
  }

  function selectPinStaff(member: PinStaffOption) {
    const memberTerminals = allLoginTerminals.filter((terminal) => terminal.branchId === member.branchId);
    const selectedTerminal = memberTerminals.find((terminal) => terminal.status === "online") ?? memberTerminals[0];
    setBranchId(member.branchId);
    setTerminals(memberTerminals);
    setPinForm((current) => ({
      ...current,
      staffId: member.id,
      terminalId: selectedTerminal?.id ?? current.terminalId,
      pin: ""
    }));
    setLoginForm((current) => ({
      ...current,
      email: seededEmailForStaff(member.id, member.name),
      terminalId: selectedTerminal?.id ?? current.terminalId
    }));
    setStatus(`${displayRole(member.role)} selected for ${member.branchId}`);
  }

  function appendPinDigit(digit: string) {
    setPinForm((current) => current.pin.length >= 4 ? current : { ...current, pin: `${current.pin}${digit}` });
  }

  function clearPin() {
    setPinForm((current) => ({ ...current, pin: "" }));
  }

  function backspacePin() {
    setPinForm((current) => ({ ...current, pin: current.pin.slice(0, -1) }));
  }

  async function submitPasswordLogin(event: FormEvent) {
    event.preventDefault();

    const submittedTenantId = normalizeLoginText(tenantId);
    const submittedEmail = normalizeLoginText(loginForm.email).toLowerCase();
    const submittedPassword = normalizeLoginText(loginForm.password).replace(/^["'](.+)["']$/, "$1");

    if (!submittedTenantId) {
      setStatus("Enter tenant ID");
      return;
    }

    if (!submittedEmail || !submittedPassword) {
      setStatus("Enter email and password");
      return;
    }

    setStatus(`Signing in ${submittedEmail}...`);

    try {
      const response = await loginWithPassword({
        tenantId: submittedTenantId,
        email: submittedEmail,
        password: submittedPassword,
        terminalId: loginForm.terminalId || pinForm.terminalId || undefined
      });
      storeAuth(response, rememberDevice);
      rememberTenantId(response.staff.tenantId);
      onAuthChange(response);
      setSessions((current) => [response.session, ...current]);
      setStatus(`Signed in as ${response.staff.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? `${error.message} for ${submittedEmail} / ${submittedTenantId}` : "Unable to sign in");
    }
  }

  async function submitPinLogin(event: FormEvent) {
    event.preventDefault();

    if (!tenantId.trim()) {
      setStatus("Enter tenant ID");
      return;
    }

    if (!branchId || !pinForm.terminalId || !pinForm.staffId) {
      setStatus("Select branch, staff, and terminal");
      return;
    }

    setStatus("Checking PIN...");

    try {
      const response = await loginWithPin({ tenantId: normalizeLoginText(tenantId), branchId: normalizeLoginText(branchId), ...pinForm, pin: normalizeLoginText(pinForm.pin) });
      storeAuth(response, rememberDevice);
      rememberTenantId(response.staff.tenantId);
      onAuthChange(response);
      setSessions((current) => [response.session, ...current]);
      setStatus(`PIN login: ${response.staff.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in with PIN");
    }
  }

  async function refreshCurrentSession() {
    if (!auth?.refreshToken) {
      setStatus("Sign in before refreshing");
      return;
    }

    setStatus("Refreshing token...");

    try {
      const response = await refreshAuth(auth.refreshToken);
      storeAuth(response);
      onAuthChange(response);
      setSessions((current) => current.map((session) => (session.id === response.session.id ? response.session : session)));
      setStatus("Access token refreshed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refresh token");
    }
  }

  async function revokeSession(session: AuthSession) {
    setStatus(`Revoking ${session.id}...`);

    try {
      const response = await revokeAuthSession(session.id, activeUserId, branchId);
      setSessions((current) => current.map((item) => (item.id === response.session.id ? response.session : item)));
      if (auth?.session.id === response.session.id) {
        clearStoredAuth();
        onAuthChange(null);
      }
      setStatus("Session revoked");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to revoke session");
    }
  }

  if (!auth) {
    const pinStaff = staff.filter((member) => member.pinEnabled && member.active);
    const tellerStaff = pinStaff.find((member) => member.role === "cashier" || member.role === "teller");
    const selectedPinStaff = pinStaff.find((member) => member.id === pinForm.staffId);
    const pinReady = Boolean(tenantId.trim() && branchId && pinForm.terminalId && pinForm.staffId && pinForm.pin.length >= 4);
    const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

    return (
      <div className="auth-terminal-view">
        <section className="samba-login-window">
          <header className="samba-login-titlebar">
            <div className="brand-mark">NP</div>
            <div>
              <strong>Cashier / Teller Login</strong>
              <span>{status}</span>
            </div>
            <button type="button" onClick={() => void loadSecurity("", tenantId)}><RefreshCcw size={16} /> Refresh</button>
          </header>

          <div className="samba-login-body">
            <aside className="samba-user-pane">
              <div className="samba-pane-heading">
                <strong>Select teller</strong>
                <span>{pinStaff.length} terminal users</span>
              </div>

              {tellerStaff ? (
                <button className="auth-teller-shortcut" type="button" onClick={() => selectPinStaff(tellerStaff)}>
                  <span className="auth-staff-avatar">{selectedStaffInitials(tellerStaff.name)}</span>
                  <span>
                    <strong>Start as {tellerStaff.name}</strong>
                    <small>Cashier/Teller PIN: 1234</small>
                  </span>
                </button>
              ) : null}

              <div className="auth-staff-list">
                {pinStaff.length === 0 ? (
                  <div className="auth-empty-staff">Load tenant to show PIN users.</div>
                ) : pinStaff.map((member) => (
                  <button
                    className={`auth-staff-card${pinForm.staffId === member.id ? " is-selected" : ""}`}
                    key={member.id}
                    type="button"
                    onClick={() => selectPinStaff(member)}
                  >
                    <span className="auth-staff-avatar">{selectedStaffInitials(member.name)}</span>
                    <span>
                      <strong>{member.name}</strong>
                      <small>{displayRole(member.role)}</small>
                    </span>
                  </button>
                ))}
              </div>

              <details className="auth-password-panel" open>
                <summary>Password login</summary>
                <form className="auth-password-form" onSubmit={submitPasswordLogin}>
                  <label>
                    Email
                    <input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} required />
                  </label>
                  <label>
                    Password
                    <span className="auth-password-field">
                      <input type={passwordVisible ? "text" : "password"} value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} required />
                      <button type="button" onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                    </span>
                  </label>
                  <label className="auth-remember">
                    <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
                    Remember this device
                  </label>
                  <button className="primary-button" type="submit">Login <ArrowRight size={16} /></button>
                </form>
              </details>
            </aside>

            <main className="auth-pin-stage">
              <form className="auth-pin-terminal" onSubmit={submitPinLogin}>
                <div className="auth-pin-heading">
                  <h1>{selectedPinStaff ? selectedPinStaff.name : "Choose a teller"}</h1>
                  <span>{selectedPinStaff ? `${displayRole(selectedPinStaff.role)} terminal PIN` : "Enter security PIN"}</span>
                </div>

                <div className="auth-pin-dots" aria-label={`${pinForm.pin.length} PIN digits entered`}>
                  {[0, 1, 2, 3].map((index) => <span className={index < pinForm.pin.length ? "is-filled" : ""} key={index} />)}
                </div>

                <div className="auth-keypad">
                  {keypadDigits.map((digit) => (
                    <button key={digit} type="button" onClick={() => appendPinDigit(digit)}>{digit}</button>
                  ))}
                  <button className="auth-key-clear" type="button" onClick={clearPin}>CLEAR</button>
                  <button type="button" onClick={() => appendPinDigit("0")}>0</button>
                  <button className="auth-key-back" type="button" aria-label="Backspace" onClick={backspacePin}><X size={18} /></button>
                </div>

                <button className="auth-start-shift" disabled={!pinReady} type="submit">
                  Login <ArrowRight size={20} />
                </button>
              </form>
            </main>
          </div>

          <footer className="samba-login-footer">
            <label>
              Tenant
              <div className="auth-terminal-inline">
                <input value={tenantId} onChange={(event) => changeTenant(event.target.value)} onBlur={() => void loadSecurity("", tenantId)} required />
                <button type="button" onClick={() => void loadSecurity("", tenantId)}><RefreshCcw size={16} /></button>
              </div>
            </label>
            <label>
              Branch
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)} required>
                <option value="">Branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label>
              Terminal
              <select value={pinForm.terminalId} onChange={(event) => {
                const terminalId = event.target.value;
                setPinForm((current) => ({ ...current, terminalId }));
                setLoginForm((current) => ({ ...current, terminalId }));
              }} required>
                <option value="">Terminal</option>
                {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
              </select>
            </label>
            <label className="auth-remember auth-pin-remember">
              <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
              Remember this device
            </label>
            <a className="auth-support-link" href="mailto:support@naijapos.local">Support</a>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Security and access</p>
          <h1>Authentication</h1>
        </div>
        <div className="button-group">
          <button className="secondary-button" onClick={() => loadSecurity(branchId)}><RefreshCcw size={18} /> Sync</button>
          <button className="secondary-button" onClick={refreshCurrentSession}><KeyRound size={18} /> Refresh token</button>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Active sessions" value={String(activeSessions)} detail={status} icon={ShieldCheck} tone="dark" />
        <StatCard label="PIN users" value={String(pinEnabledStaff)} detail="Terminal-ready staff" icon={Smartphone} />
        <StatCard label="Current login" value={auth?.staff.role ?? "None"} detail={auth?.staff.name ?? "No token issued"} icon={LockKeyhole} />
      </section>

      <section className="settings-workflow">
        <form className="panel" onSubmit={submitPasswordLogin}>
          <div className="panel-header">
            <h2>Password login</h2>
            <LockKeyhole size={20} />
          </div>
          <div className="settings-form">
            <label className="wide-field">
              Email
              <input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} required />
            </label>
            <label className="wide-field">
              Password
              <input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} required />
            </label>
            <label className="wide-field">
              Branch
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)} required>
                <option value="">Branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label className="wide-field">
              Terminal
              <select value={loginForm.terminalId} onChange={(event) => setLoginForm((current) => ({ ...current, terminalId: event.target.value }))} required>
                <option value="">Terminal</option>
                {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name} - {terminal.status}</option>)}
              </select>
            </label>
            <label className="toggle-line wide-field">
              <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
              Remember this device
            </label>
            <div className="form-summary wide-field">
              <span>{status}</span>
              <button className="primary-button" type="submit"><Check size={18} /> Sign in</button>
            </div>
          </div>
        </form>

        <form className="panel" onSubmit={submitPinLogin}>
          <div className="panel-header">
            <h2>Terminal PIN</h2>
            <Smartphone size={20} />
          </div>
          <div className="settings-form">
            <label>
              Branch
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)} required>
                <option value="">Branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label>
              Staff
              <select value={pinForm.staffId} onChange={(event) => setPinForm((current) => ({ ...current, staffId: event.target.value }))} required>
                <option value="">Staff</option>
                {staff.filter((member) => member.pinEnabled).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label>
              Terminal
              <select value={pinForm.terminalId} onChange={(event) => setPinForm((current) => ({ ...current, terminalId: event.target.value }))} required>
                <option value="">Terminal</option>
                {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
              </select>
            </label>
            <label className="wide-field">
              PIN
              <input type="password" value={pinForm.pin} onChange={(event) => setPinForm((current) => ({ ...current, pin: event.target.value }))} required />
            </label>
            <label className="toggle-line wide-field">
              <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
              Remember this device
            </label>
            <div className="form-summary wide-field">
              <span>{status}</span>
              <button className="primary-button" type="submit"><Check size={18} /> Unlock terminal</button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Sessions</h2>
          <span>{sessions.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Created</th><th>Staff</th><th>Role</th><th>Terminal</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {sessionsPage.pageRows.length === 0 ? (
                <tr><td colSpan={8}>No sessions created.</td></tr>
              ) : sessionsPage.pageRows.map((session, index) => (
                <tr key={session.id}>
                  <td className="number-cell">{sessionsPage.startIndex + index + 1}</td>
                  <td>{new Date(session.createdAt).toLocaleString()}</td>
                  <td>{session.staffId}</td>
                  <td>{session.role}</td>
                  <td>{session.terminalId ?? "None"}</td>
                  <td>{new Date(session.expiresAt).toLocaleDateString()}</td>
                  <td><StatusBadge label={sessionLabel(session)} tone={sessionTone(session)} /></td>
                  <td className="row-actions">
                    <button disabled={Boolean(session.revokedAt)} onClick={() => revokeSession(session)}><X size={14} /> Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={sessionsPage.page}
          pageCount={sessionsPage.pageCount}
          pageSize={sessionsPage.pageSize}
          totalRows={sessionsPage.totalRows}
          startIndex={sessionsPage.startIndex}
          visibleCount={sessionsPage.pageRows.length}
          onPageChange={sessionsPage.setPage}
          onPageSizeChange={sessionsPage.setPageSize}
        />
      </section>
    </div>
  );
}
