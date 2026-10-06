import { Check, IdCard, KeyRound, Mail, MapPin, MonitorSmartphone, Phone, Settings, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchBranchOptions, fetchMyProfile, readStoredAuth, updateMyProfile, updateMySecurity, updateStoredAuthStaff, type AuthResponse, type BranchOption } from "../../shared/api/client";

interface ProfileViewProps {
  user: {
    name: string;
    role: string;
    email: string;
    phone: string;
    branch: string;
  };
}

export function ProfileView({ user }: ProfileViewProps) {
  const [storedAuth, setStoredAuth] = useState<AuthResponse | null>(() => readStoredAuth());
  const [profile, setProfile] = useState(user);
  const [profileMeta, setProfileMeta] = useState({
    staffId: storedAuth?.staff.id ?? "",
    branchId: storedAuth?.staff.branchId ?? "",
    inviteStatus: "accepted",
    pinEnabled: false,
    active: true,
    salesTotal: 0,
    createdAt: "",
    lastSeenAt: ""
  });
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [securityForm, setSecurityForm] = useState({
    currentPassword: "",
    newPassword: "",
    newPin: "",
    pinEnabled: storedAuth?.staff ? false : false
  });
  const [status, setStatus] = useState("Ready");
  const permissions = storedAuth?.staff.permissions ?? [];
  const session = storedAuth?.session;
  const branchName = useMemo(() => {
    const branch = branches.find((item) => item.id === profileMeta.branchId);
    return branch ? `${branch.name}, ${branch.city}` : profile.branch || profileMeta.branchId || "No branch assigned";
  }, [branches, profile.branch, profileMeta.branchId]);
  const initials = useMemo(
    () => profile.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    [profile.name]
  );
  const roleLabel = profile.role.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
  const sessionExpiry = session?.expiresAt ? new Date(session.expiresAt).toLocaleString() : "No active session";
  const displayPermission = (permission: string) => permission
    .split(".")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

  useEffect(() => {
    setProfile(user);
  }, [user.email, user.name, user.phone, user.role, user.branch]);

  useEffect(() => {
    function syncAuth(event: Event) {
      setStoredAuth((event as CustomEvent<AuthResponse | null>).detail ?? readStoredAuth());
    }

    window.addEventListener("naijapos-auth-changed", syncAuth);
    return () => window.removeEventListener("naijapos-auth-changed", syncAuth);
  }, []);

  useEffect(() => {
    let mounted = true;
    setStatus("Loading profile...");
    Promise.all([fetchMyProfile(), fetchBranchOptions().catch(() => ({ branches: [] as BranchOption[], terminals: [] }))])
      .then(([response, branchResponse]) => {
        if (!mounted) return;
        const nextBranch = branchResponse.branches.find((branch) => branch.id === response.staff.branchId);
        setBranches(branchResponse.branches);
        setProfile((current) => ({
          ...current,
          name: response.staff.name,
          email: response.staff.email,
          phone: response.staff.phone,
          role: response.staff.role,
          branch: nextBranch ? `${nextBranch.name}, ${nextBranch.city}` : response.staff.branchId
        }));
        setProfileMeta({
          staffId: response.staff.id,
          branchId: response.staff.branchId,
          inviteStatus: response.staff.inviteStatus,
          pinEnabled: response.staff.pinEnabled,
          active: response.staff.active,
          salesTotal: response.staff.salesTotal,
          createdAt: response.staff.createdAt,
          lastSeenAt: response.staff.lastSeenAt ?? ""
        });
        setSecurityForm((current) => ({ ...current, pinEnabled: response.staff.pinEnabled }));
        updateStoredAuthStaff({
          name: response.staff.name,
          email: response.staff.email,
          phone: response.staff.phone,
          role: response.staff.role,
          branchId: response.staff.branchId,
          permissions: response.staff.permissions
        });
        setStatus("Profile synced");
      })
      .catch((error) => {
        if (mounted) setStatus(error instanceof Error ? error.message : "Unable to load profile");
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setStatus("Saving profile...");

    try {
      const response = await updateMyProfile({
        name: profile.name,
        email: profile.email,
        phone: profile.phone
      });
      setProfile((current) => ({
        ...current,
        name: response.staff.name,
        email: response.staff.email,
        phone: response.staff.phone,
        role: response.staff.role
      }));
      setProfileMeta({
        staffId: response.staff.id,
        branchId: response.staff.branchId,
        inviteStatus: response.staff.inviteStatus,
        pinEnabled: response.staff.pinEnabled,
        active: response.staff.active,
        salesTotal: response.staff.salesTotal,
        createdAt: response.staff.createdAt,
        lastSeenAt: response.staff.lastSeenAt ?? ""
      });
      updateStoredAuthStaff({
        name: response.staff.name,
        email: response.staff.email,
        phone: response.staff.phone,
        role: response.staff.role,
        branchId: response.staff.branchId,
        permissions: response.staff.permissions
      });
      setStatus("Profile saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save profile");
    }
  }

  async function saveSecurity(event: FormEvent) {
    event.preventDefault();

    if (securityForm.newPassword && securityForm.newPassword.length < 8) {
      setStatus("New password must be at least 8 characters");
      return;
    }

    if (securityForm.newPin && !/^\d{6}$/.test(securityForm.newPin)) {
      setStatus("PIN must be 6 digits");
      return;
    }

    setStatus("Updating security...");

    try {
      const response = await updateMySecurity({
        currentPassword: securityForm.currentPassword,
        newPassword: securityForm.newPassword || undefined,
        newPin: securityForm.newPin || undefined,
        pinEnabled: securityForm.pinEnabled
      });
      setProfileMeta({
        staffId: response.staff.id,
        branchId: response.staff.branchId,
        inviteStatus: response.staff.inviteStatus,
        pinEnabled: response.staff.pinEnabled,
        active: response.staff.active,
        salesTotal: response.staff.salesTotal,
        createdAt: response.staff.createdAt,
        lastSeenAt: response.staff.lastSeenAt ?? ""
      });
      setSecurityForm({
        currentPassword: "",
        newPassword: "",
        newPin: "",
        pinEnabled: response.staff.pinEnabled
      });
      setStatus("Security updated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update security");
    }
  }

  return (
    <div className="module-view">
      <section className="profile-hero">
        <div className="profile-avatar-large">{initials || "NP"}</div>
        <div className="profile-hero-copy">
          <span>{status}</span>
          <h2>{profile.name || "Current user"}</h2>
          <p>{roleLabel || "Staff"} at {branchName}</p>
        </div>
        <div className="profile-hero-meta">
          <span><IdCard size={16} /> {profileMeta.staffId || "No staff ID"}</span>
          <span><ShieldCheck size={16} /> {permissions.length} permissions</span>
        </div>
      </section>

      <section className="profile-workflow">
        <form className="panel profile-details-panel" onSubmit={saveProfile}>
          <div className="profile-details-header">
            <span><UserRound size={14} /> Personal details</span>
            <UserRound size={20} />
          </div>
          <div className="profile-form">
            <label className="wide-field">
              Full name
              <input value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="wide-field">
              Email
              <input type="email" value={profile.email} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} required />
            </label>
            <label>
              Phone
              <input value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} required />
            </label>
            <label>
              Role
              <input value={roleLabel || profile.role} readOnly />
            </label>
            <label>
              Staff ID
              <input value={profileMeta.staffId} readOnly />
            </label>
            <label>
              Assigned branch
              <input value={branchName} readOnly />
            </label>
            <label>
              Active status
              <input value={profileMeta.active ? "Active" : "Inactive"} readOnly />
            </label>
            <label>
              Terminal session
              <input value={session?.terminalId ?? "No terminal session"} readOnly />
            </label>
            <div className="form-summary wide-field">
              <em>{profileMeta.staffId ? `${profileMeta.staffId} - ${profile.email}` : profile.email}</em>
              <button className="primary-button" type="submit"><Check size={18} /> Save profile</button>
            </div>
          </div>
        </form>

        <section className="panel profile-side-panel profile-account-panel">
          <div className="panel-header">
            <h2>Account</h2>
            <KeyRound size={20} />
          </div>
          <div className="profile-info-list">
            <span><Mail size={16} /> {profile.email || "No email"}</span>
            <span><Phone size={16} /> {profile.phone || "No phone"}</span>
            <span><MapPin size={16} /> {branchName}</span>
            <span><MonitorSmartphone size={16} /> {session?.terminalId ?? "No terminal session"}</span>
          </div>
          <div className="profile-account-grid">
            <div>
              <small>Status</small>
              <strong>{profileMeta.active ? profileMeta.inviteStatus : "inactive"}</strong>
            </div>
            <div>
              <small>PIN access</small>
              <strong>{profileMeta.pinEnabled ? "Enabled" : "Off"}</strong>
            </div>
            <div>
              <small>Joined</small>
              <strong>{profileMeta.createdAt ? new Date(profileMeta.createdAt).toLocaleDateString() : "Not recorded"}</strong>
            </div>
            <div>
              <small>Last seen</small>
              <strong>{profileMeta.lastSeenAt ? new Date(profileMeta.lastSeenAt).toLocaleDateString() : "Not recorded"}</strong>
            </div>
          </div>
          <div className="profile-session-card">
            <small>Session expires</small>
            <strong>{sessionExpiry}</strong>
          </div>
          <div className="profile-session-card">
            <small>Sales total</small>
            <strong>NGN {profileMeta.salesTotal.toLocaleString()}</strong>
          </div>
        </section>

        <form className="panel profile-security-panel" onSubmit={saveSecurity}>
          <div className="panel-header">
            <h2>Security</h2>
            <ShieldCheck size={18} />
          </div>
          <div className="profile-security-form">
            <label className="wide-field">
              Current password
              <input
                autoComplete="current-password"
                type="password"
                value={securityForm.currentPassword}
                onChange={(event) => setSecurityForm((current) => ({ ...current, currentPassword: event.target.value }))}
                required
              />
            </label>
            <label>
              New password
              <input
                autoComplete="new-password"
                minLength={8}
                type="password"
                value={securityForm.newPassword}
                onChange={(event) => setSecurityForm((current) => ({ ...current, newPassword: event.target.value }))}
              />
            </label>
            <label>
              6-digit PIN
              <input
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                type="password"
                value={securityForm.newPin}
                onChange={(event) => setSecurityForm((current) => ({ ...current, newPin: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
              />
            </label>
            <label className="auth-remember wide-field">
              <input
                type="checkbox"
                checked={securityForm.pinEnabled}
                onChange={(event) => setSecurityForm((current) => ({ ...current, pinEnabled: event.target.checked }))}
              />
              Enable PIN login
            </label>
            <div className="form-summary wide-field">
              <span>{profileMeta.pinEnabled ? "PIN login is enabled for this profile" : "PIN login is currently disabled"}</span>
              <button className="primary-button" type="submit"><Check size={18} /> Save security</button>
            </div>
          </div>
        </form>

        <section className="panel profile-permissions-panel">
          <div className="panel-header">
            <h2>Access</h2>
            <Settings size={18} />
          </div>
          <div className="profile-permission-grid">
            {permissions.length === 0 ? (
              <span className="profile-empty">No permissions assigned.</span>
            ) : permissions.map((permission) => (
              <span key={permission}>{displayPermission(permission)}</span>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
