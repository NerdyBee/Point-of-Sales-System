import { Ban, Check, Eye, KeyRound, MailPlus, Pencil, RefreshCcw, Search, ShieldCheck, UserPlus, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createStaff,
  fetchBranchOptions,
  fetchRoleOptions,
  fetchStaff,
  readStoredAuth,
  resendStaffInvite,
  revokeStaffInvite,
  updateStaff,
  updateStaffSecurity,
  updateStaffStatus,
  type BranchOption,
  type StaffMember,
  type StaffPayload,
  type AccessRole,
  type StaffRole
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";

const fallbackBranches: BranchOption[] = [];

function blankStaff(branchId = ""): StaffPayload {
  return {
    branchId,
    name: "",
    email: "",
    phone: "",
    role: "" as StaffRole,
    pinEnabled: true,
    active: true
  };
}

const fallbackRoles: AccessRole[] = [];

function inviteTone(status: StaffMember["inviteStatus"]): "success" | "warning" | "danger" | "info" {
  if (status === "accepted") return "success";
  if (status === "pending") return "warning";
  if (status === "expired") return "info";
  return "danger";
}

export function StaffView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [detailStaff, setDetailStaff] = useState<StaffMember | null>(null);
  const [form, setForm] = useState<StaffPayload>(blankStaff(initialBranchId));
  const [roles, setRoles] = useState<AccessRole[]>(fallbackRoles);
  const [modalOpen, setModalOpen] = useState(false);
  const [staffQuery, setStaffQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [inviteFilter, setInviteFilter] = useState("");
  const [accessFilter, setAccessFilter] = useState("");
  const [securityForm, setSecurityForm] = useState({
    temporaryPassword: "",
    pin: "",
    pinEnabled: true,
    reason: "Manager credential reset"
  });
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();

  const activeCount = useMemo(() => staff.filter((member) => member.active).length, [staff]);
  const pinCount = useMemo(() => staff.filter((member) => member.pinEnabled).length, [staff]);
  const pendingInviteCount = useMemo(() => staff.filter((member) => member.inviteStatus === "pending").length, [staff]);
  const branchNameById = useMemo(() => new Map(branches.map((branch) => [branch.id, `${branch.name}, ${branch.city}`])), [branches]);
  const roleLabelByName = useMemo(() => new Map(roles.map((role) => [role.name, role.label])), [roles]);
  const filteredStaff = useMemo(() => {
    const normalizedQuery = staffQuery.trim().toLowerCase();

    return staff.filter((member) => {
      const haystack = [
        member.name,
        member.email,
        member.phone,
        member.role,
        roleLabelByName.get(member.role),
        member.inviteStatus,
        branchNameById.get(member.branchId)
      ].filter(Boolean).join(" ").toLowerCase();

      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
      const matchesRole = !roleFilter || member.role === roleFilter;
      const matchesInvite = !inviteFilter || member.inviteStatus === inviteFilter;
      const matchesAccess = !accessFilter
        || (accessFilter === "active" && member.active)
        || (accessFilter === "inactive" && !member.active)
        || (accessFilter === "pin_enabled" && member.pinEnabled)
        || (accessFilter === "pin_disabled" && !member.pinEnabled);

      return matchesQuery && matchesRole && matchesInvite && matchesAccess;
    });
  }, [accessFilter, branchNameById, inviteFilter, roleFilter, roleLabelByName, staff, staffQuery]);
  const staffPage = usePaginatedRows(filteredStaff, 10);
  const permissionPage = usePaginatedRows(detailStaff?.permissions ?? [], 12);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const selectedFormBranch = useMemo(() => branches.find((branch) => branch.id === form.branchId) ?? null, [branches, form.branchId]);
  const branchLocked = Boolean(branchId && branches.length === 1);

  async function loadStaff(nextBranchId = branchId) {
    setStatus("Syncing staff...");

    try {
      const [branchResponse, roleResponse] = await Promise.all([
        fetchBranchOptions(),
        fetchRoleOptions()
      ]);
      setBranches(branchResponse.branches);
      setRoles(roleResponse.roles);

      if (!nextBranchId && !canUseAllBranches) {
        setStaff([]);
        setStatus("Select a branch to load staff");
        return;
      }

      const response = await fetchStaff(nextBranchId, activeUserId);
      setStaff(response.staff);
      setStatus(nextBranchId ? "Staff synced" : "Staff synced across accessible branches");
    } catch (error) {
      setBranches(fallbackBranches);
      setStaff([]);
      setRoles(fallbackRoles);
      setStatus(error instanceof Error ? error.message : "Unable to load staff");
    }
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  function updateForm<K extends keyof StaffPayload>(key: K, value: StaffPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function editStaff(member: StaffMember) {
    setDetailStaff(null);
    setSelectedStaff(member);
    setForm({
      branchId: member.branchId,
      name: member.name,
      email: member.email,
      phone: member.phone,
      role: member.role,
      pinEnabled: member.pinEnabled,
      active: member.active
    });
    setModalOpen(true);
  }

  function resetForm() {
    setDetailStaff(null);
    setSelectedStaff(null);
    setForm(blankStaff(branchId));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedStaff(null);
    setForm(blankStaff(branchId));
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setSelectedStaff(null);
    setDetailStaff(null);
    setForm(blankStaff(nextBranchId));
    void loadStaff(nextBranchId);
  }

  function closeDetailModal() {
    setDetailStaff(null);
    setSecurityForm({ temporaryPassword: "", pin: "", pinEnabled: true, reason: "Manager credential reset" });
  }

  function viewStaff(member: StaffMember) {
    setDetailStaff(member);
    setSecurityForm({
      temporaryPassword: "",
      pin: "",
      pinEnabled: member.pinEnabled,
      reason: "Manager credential reset"
    });
  }

  function clearStaffFilters() {
    setStaffQuery("");
    setRoleFilter("");
    setInviteFilter("");
    setAccessFilter("");
  }

  async function saveStaff(event: FormEvent) {
    event.preventDefault();

    if (!form.branchId) {
      setStatus("Select a branch");
      return;
    }

    if (!form.role) {
      setStatus("Select a role");
      return;
    }

    setStatus(selectedStaff ? "Updating staff..." : "Inviting staff...");

    try {
      const response = selectedStaff
        ? await updateStaff(selectedStaff.id, form, selectedStaff.branchId || branchId, activeUserId)
        : await createStaff(form, activeUserId);
      if (response.staff.branchId === branchId) {
        applyStaffUpdate(response.staff);
      } else {
        await loadStaff(branchId);
      }
      setStatus(selectedStaff ? "Staff updated" : "Staff invite sent");
      closeModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save staff");
    }
  }

  function applyStaffUpdate(updatedStaff: StaffMember) {
    setStaff((current) => {
      const existing = current.some((member) => member.id === updatedStaff.id);
      return existing
        ? current.map((member) => (member.id === updatedStaff.id ? updatedStaff : member))
        : [updatedStaff, ...current];
    });
    setDetailStaff((current) => (current?.id === updatedStaff.id ? updatedStaff : current));
  }

  async function toggleStatus(member: StaffMember) {
    setStatus(member.active ? "Deactivating staff..." : "Reactivating staff...");

    try {
      const response = await updateStaffStatus(
        member.id,
        !member.active,
        member.active ? "Manager deactivated access" : "Manager restored access",
        member.branchId,
        activeUserId
      );
      applyStaffUpdate(response.staff);
      setStatus(response.staff.active ? "Staff reactivated" : "Staff deactivated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update staff status");
    }
  }

  async function resendInvite(member: StaffMember) {
    setStatus("Resending invite...");

    try {
      const response = await resendStaffInvite(member.id, member.branchId, activeUserId);
      applyStaffUpdate(response.staff);
      setStatus("Invite resent");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to resend invite");
    }
  }

  async function revokeInvite(member: StaffMember) {
    setStatus("Revoking invite...");

    try {
      const response = await revokeStaffInvite(member.id, member.branchId, activeUserId);
      applyStaffUpdate(response.staff);
      setStatus("Invite revoked");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to revoke invite");
    }
  }

  async function saveStaffSecurity(event: FormEvent) {
    event.preventDefault();
    if (!detailStaff) return;

    if (securityForm.temporaryPassword && securityForm.temporaryPassword.length < 8) {
      setStatus("Temporary password must be at least 8 characters");
      return;
    }

    if (securityForm.pin && !/^\d{6}$/.test(securityForm.pin)) {
      setStatus("PIN must be 6 digits");
      return;
    }

    setStatus("Resetting staff credentials...");

    try {
      const response = await updateStaffSecurity(
        detailStaff.id,
        {
          temporaryPassword: securityForm.temporaryPassword || undefined,
          pin: securityForm.pin || undefined,
          pinEnabled: securityForm.pinEnabled,
          reason: securityForm.reason
        },
        detailStaff.branchId
      );
      applyStaffUpdate(response.staff);
      setSecurityForm({
        temporaryPassword: "",
        pin: "",
        pinEnabled: response.staff.pinEnabled,
        reason: "Manager credential reset"
      });
      setStatus("Staff credentials updated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reset credentials");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Users, roles and approvals</p>
          <h1>Staff management</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Branch
            {branchLocked ? (
              <span className="locked-select-value locked-select-value-compact">
                <strong>{selectedBranch?.name ?? branchId}</strong>
                <small>{selectedBranch?.city ?? "assigned"}</small>
              </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                <option value="">{canUseAllBranches ? "All accessible branches" : "Branch"}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
          </label>
          <button className="secondary-button" onClick={() => void loadStaff()}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={resetForm}><UserPlus size={18} /> Invite staff</button>
        </div>
      </div>
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top"><span>Active staff</span></div>
          <strong>{activeCount}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>PIN enabled</span></div>
          <strong>{pinCount}</strong>
          <small>Quick terminal access</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Branch sales</span></div>
          <strong>{displayMoney(staff.reduce((sum, member) => sum + member.salesTotal, 0))}</strong>
          <small>Assigned staff total</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Pending invites</span></div>
          <strong>{pendingInviteCount}</strong>
          <small>Awaiting acceptance</small>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Branch staff</h2>
          <span>{filteredStaff.length} of {staff.length} users</span>
        </div>
        <div className="table-toolbar staff-filter-toolbar">
          <div className="search-box compact-search">
            <Search size={16} />
            <input
              value={staffQuery}
              onChange={(event) => setStaffQuery(event.target.value)}
              placeholder="Search staff, email, phone or role"
            />
            {staffQuery ? <button type="button" onClick={() => setStaffQuery("")} aria-label="Clear staff search"><X size={14} /></button> : null}
          </div>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">Role</option>
            {roles.map((role) => <option key={role.id} value={role.name}>{role.label}</option>)}
          </select>
          <select value={inviteFilter} onChange={(event) => setInviteFilter(event.target.value)}>
            <option value="">Invite status</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}>
            <option value="">Access status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="pin_enabled">PIN enabled</option>
            <option value="pin_disabled">PIN disabled</option>
          </select>
          {(staffQuery || roleFilter || inviteFilter || accessFilter) ? (
            <button className="secondary-button" type="button" onClick={clearStaffFilters}>Clear filters</button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Employee</th><th>Role</th><th>Branch sales</th><th>Status</th><th>Invite</th><th>PIN</th><th>Permissions</th><th>Actions</th></tr></thead>
            <tbody>
              {staffPage.pageRows.length === 0 ? (
                <tr><td colSpan={9}>No staff found for this branch.</td></tr>
              ) : staffPage.pageRows.map((member, index) => (
                <tr key={member.id}>
                  <td className="number-cell">{staffPage.startIndex + index + 1}</td>
                  <td>{member.name}</td>
                  <td>{roleLabelByName.get(member.role) ?? member.role}</td>
                  <td>{displayMoney(member.salesTotal)}</td>
                  <td><StatusBadge label={member.active ? "Active" : "Inactive"} tone={member.active ? "success" : "danger"} /></td>
                  <td><StatusBadge label={member.inviteStatus} tone={inviteTone(member.inviteStatus)} /></td>
                  <td>{member.pinEnabled ? "Enabled" : "Off"}</td>
                  <td><button className="permission-count" onClick={() => viewStaff(member)}>{member.permissions.length} permissions</button></td>
                  <td className="row-actions">
                    <button onClick={() => viewStaff(member)} aria-label={`View ${member.name} access`}><Eye size={16} /></button>
                    <button onClick={() => editStaff(member)} aria-label={`Edit ${member.name}`}><Pencil size={16} /></button>
                    <button onClick={() => toggleStatus(member)}>{member.active ? "Disable" : "Enable"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={staffPage.page}
          pageCount={staffPage.pageCount}
          pageSize={staffPage.pageSize}
          totalRows={staffPage.totalRows}
          startIndex={staffPage.startIndex}
          visibleCount={staffPage.pageRows.length}
          onPageChange={staffPage.setPage}
          onPageSizeChange={staffPage.setPageSize}
        />
      </section>
      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <section className="modal-panel staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{selectedStaff ? "Update staff access" : "Create staff access"}</p>
                <h2 id="staff-modal-title">{selectedStaff ? "Edit staff" : "Invite staff"}</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Close staff modal"><X size={18} /></button>
            </div>
            <form className="staff-form" onSubmit={saveStaff}>
              <label>
                Name
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} required />
              </label>
              <label>
                Branch
                {branchLocked ? (
                  <span className="locked-select-value">
                    <strong>{selectedFormBranch?.name ?? form.branchId}</strong>
                    <small>{selectedFormBranch?.city ?? "assigned"}</small>
                  </span>
                ) : (
                  <select value={form.branchId} onChange={(event) => updateForm("branchId", event.target.value)} required>
                    <option value="">Branch</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                )}
              </label>
              <label>
                Role
                <select value={form.role} onChange={(event) => updateForm("role", event.target.value as StaffRole)}>
                  <option value="">Role</option>
                  {roles.map((role) => <option key={role.id} value={role.name}>{role.label}</option>)}
                </select>
              </label>
              <label className="toggle-line">
                <input type="checkbox" checked={form.pinEnabled} onChange={(event) => updateForm("pinEnabled", event.target.checked)} />
                PIN login
              </label>
              {selectedStaff ? (
                <label className="toggle-line">
                  <input type="checkbox" checked={form.active} onChange={(event) => updateForm("active", event.target.checked)} />
                  Active access
                </label>
              ) : (
                <div className="invite-note"><MailPlus size={16} /> New staff receive a pending invite before access is activated.</div>
              )}
              <div className="form-summary">
                <span>{roleLabelByName.get(selectedStaff?.role ?? form.role) ?? selectedStaff?.role ?? form.role}</span>
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {detailStaff ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeDetailModal}>
          <section className="modal-panel staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Staff access profile</p>
                <h2 id="staff-detail-title">{detailStaff.name}</h2>
              </div>
              <button className="icon-button" onClick={closeDetailModal} aria-label="Close staff detail modal"><X size={18} /></button>
            </div>
            <div className="staff-detail-summary">
              <span><ShieldCheck size={16} /> {roleLabelByName.get(detailStaff.role) ?? detailStaff.role}</span>
              <StatusBadge label={detailStaff.active ? "Active" : "Inactive"} tone={detailStaff.active ? "success" : "danger"} />
              <StatusBadge label={detailStaff.inviteStatus} tone={inviteTone(detailStaff.inviteStatus)} />
              <span>{detailStaff.pinEnabled ? "PIN enabled" : "PIN disabled"}</span>
            </div>
            <div className="staff-detail-grid">
              <div>
                <span>Email</span>
                <strong>{detailStaff.email}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{detailStaff.phone}</strong>
              </div>
              <div>
                <span>Branch sales</span>
                <strong>{displayMoney(detailStaff.salesTotal)}</strong>
              </div>
              <div>
                <span>Last seen</span>
                <strong>{detailStaff.lastSeenAt ? new Date(detailStaff.lastSeenAt).toLocaleString() : "Not recorded"}</strong>
              </div>
              <div>
                <span>Created</span>
                <strong>{new Date(detailStaff.createdAt).toLocaleDateString()}</strong>
              </div>
              <div>
                <span>Invite expiry</span>
                <strong>{detailStaff.inviteExpiresAt ? new Date(detailStaff.inviteExpiresAt).toLocaleString() : "Not applicable"}</strong>
              </div>
              <div>
                <span>Branch</span>
                <strong>{branchNameById.get(detailStaff.branchId) ?? detailStaff.branchId}</strong>
              </div>
              <div>
                <span>Invited by</span>
                <strong>{detailStaff.invitedBy ?? "Not recorded"}</strong>
              </div>
            </div>
            <div className="permission-list">
              {permissionPage.pageRows.length === 0 ? (
                <div className="empty-state">No permissions assigned to this role.</div>
              ) : permissionPage.pageRows.map((permission, index) => (
                <span className="permission-chip" key={permission}>
                  <span className="number-cell">{permissionPage.startIndex + index + 1}</span>{permission}
                </span>
              ))}
            </div>
            <TablePagination
              page={permissionPage.page}
              pageCount={permissionPage.pageCount}
              pageSize={permissionPage.pageSize}
              totalRows={permissionPage.totalRows}
              startIndex={permissionPage.startIndex}
              visibleCount={permissionPage.pageRows.length}
              onPageChange={permissionPage.setPage}
              onPageSizeChange={permissionPage.setPageSize}
            />
            <form className="staff-security-form" onSubmit={saveStaffSecurity}>
              <div className="panel-header">
                <h2>Credential reset</h2>
                <KeyRound size={18} />
              </div>
              <label>
                Temporary password
                <input
                  minLength={8}
                  type="password"
                  value={securityForm.temporaryPassword}
                  onChange={(event) => setSecurityForm((current) => ({ ...current, temporaryPassword: event.target.value }))}
                />
              </label>
              <label>
                6-digit PIN
                <input
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  type="password"
                  value={securityForm.pin}
                  onChange={(event) => setSecurityForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
                />
              </label>
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={securityForm.pinEnabled}
                  onChange={(event) => setSecurityForm((current) => ({ ...current, pinEnabled: event.target.checked }))}
                />
                Enable PIN login
              </label>
              <label>
                Reason
                <input
                  value={securityForm.reason}
                  onChange={(event) => setSecurityForm((current) => ({ ...current, reason: event.target.value }))}
                  required
                />
              </label>
              <button className="secondary-button wide-field" type="submit"><KeyRound size={18} /> Save credentials</button>
            </form>
            <div className="modal-footer-actions">
              {detailStaff.inviteStatus !== "accepted" ? (
                <button className="secondary-button" onClick={() => resendInvite(detailStaff)}><MailPlus size={18} /> Resend invite</button>
              ) : null}
              {detailStaff.inviteStatus === "pending" || detailStaff.inviteStatus === "expired" ? (
                <button className="danger-button" onClick={() => revokeInvite(detailStaff)}><Ban size={18} /> Revoke invite</button>
              ) : null}
              <button className="secondary-button" onClick={() => editStaff(detailStaff)}><Pencil size={18} /> Edit access</button>
              <button className={detailStaff.active ? "danger-button" : "primary-button"} onClick={() => toggleStatus(detailStaff)}>
                {detailStaff.active ? "Disable access" : "Enable access"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
