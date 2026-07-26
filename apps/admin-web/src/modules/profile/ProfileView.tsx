import { Check, KeyRound, Mail, Phone, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { StatCard } from "../../shared/components/StatCard";

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
  const [profile, setProfile] = useState(user);
  const [preferences, setPreferences] = useState({
    emailReceipts: true,
    approvalAlerts: true,
    compactTables: false
  });
  const [status, setStatus] = useState("Ready");
  const initials = useMemo(
    () => profile.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    [profile.name]
  );

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    setStatus("Profile saved");
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h1>Profile</h1>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Signed in as" value={profile.role} detail={status} icon={UserRound} tone="dark" />
        <StatCard label="Branch" value={profile.branch} detail="Default workspace" icon={ShieldCheck} />
        <StatCard label="Alerts" value={preferences.approvalAlerts ? "On" : "Off"} detail="Approval notifications" icon={KeyRound} />
      </section>

      <section className="settings-workflow">
        <form className="panel" onSubmit={saveProfile}>
          <div className="panel-header">
            <h2>Personal details</h2>
            <span className="avatar">{initials}</span>
          </div>
          <div className="settings-form">
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
              <input value={profile.role} readOnly />
            </label>
            <div className="form-summary wide-field">
              <span>{profile.email}</span>
              <button className="primary-button" type="submit"><Check size={18} /> Save profile</button>
            </div>
          </div>
        </form>

        <section className="panel">
          <div className="panel-header">
            <h2>Preferences</h2>
            <Mail size={20} />
          </div>
          <div className="settings-form">
            <label className="toggle-line wide-field">
              <input type="checkbox" checked={preferences.emailReceipts} onChange={(event) => setPreferences((current) => ({ ...current, emailReceipts: event.target.checked }))} />
              Email receipt copies
            </label>
            <label className="toggle-line wide-field">
              <input type="checkbox" checked={preferences.approvalAlerts} onChange={(event) => setPreferences((current) => ({ ...current, approvalAlerts: event.target.checked }))} />
              Approval alerts
            </label>
            <label className="toggle-line wide-field">
              <input type="checkbox" checked={preferences.compactTables} onChange={(event) => setPreferences((current) => ({ ...current, compactTables: event.target.checked }))} />
              Compact table density
            </label>
            <div className="profile-contact-list wide-field">
              <span><Mail size={16} /> {profile.email}</span>
              <span><Phone size={16} /> {profile.phone}</span>
              <span><ShieldCheck size={16} /> {profile.branch}</span>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
