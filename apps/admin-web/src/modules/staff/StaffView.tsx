import { Ban, Check, Eye, MailPlus, Pencil, RefreshCcw, ShieldCheck, UserPlus, X } from "lucide-react";
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
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [detailStaff, setDetailStaff] = useState<StaffMember | null>(null);
  const [form, setForm] = useState<StaffPayload>(blankStaff(initialBranchId));
  const [roles, setRoles] = useState<AccessRole[]>(fallbackRoles);
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState("Ready");
  const { displayMoney } = useTenantSettings();

  const activeCount = useMemo(() => staff.filter((member) => member.active).length, [staff]);
  const pinCount = useMemo(() => staff.filter((member) => member.pinEnabled).length, [staff]);
  const pendingInviteCount = useMemo(() => staff.filter((member) => member.inviteStatus === "pending").length, [staff]);
  const branchNameById = useMemo(() => new Map(branches.map((branch) => [branch.id, `${branch.name}, ${branch.city}`])), [branches]);
  const staffPage = usePaginatedRows(staff, 10);
  const permissionPage = usePaginatedRows(detailStaff?.permissions ?? [], 12);

  async function loadStaff(nextBranchId = branchId) {
    setStatus("Syncing staff...");

    try {
      const [branchResponse, roleResponse] = await Promise.all([
        fetchBranchOptions(),
        fetchRoleOptions()
      ]);
      setBranches(branchResponse.branches);
      setRoles(roleResponse.roles);

      if (!nextBranchId) {
        setStaff([]);
        setStatus("Select a branch to load staff");
        return;
      }

      const response = await fetchStaff(nextBranchId, activeUserId);
      setStaff(response.staff);
      setStatus("Staff synced");
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
        ? await updateStaff(selectedStaff.id, form, branchId, activeUserId)
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
            <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
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
          <span>{staff.length} users</span>
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
                  <td>{member.role}</td>
                  <td>{displayMoney(member.salesTotal)}</td>
                  <td><StatusBadge label={member.active ? "Active" : "Inactive"} tone={member.active ? "success" : "danger"} /></td>
                  <td><StatusBadge label={member.inviteStatus} tone={inviteTone(member.inviteStatus)} /></td>
                  <td>{member.pinEnabled ? "Enabled" : "Off"}</td>
                  <td><button className="permission-count" onClick={() => setDetailStaff(member)}>{member.permissions.length} permissions</button></td>
                  <td className="row-actions">
                    <button onClick={() => setDetailStaff(member)} aria-label={`View ${member.name} access`}><Eye size={16} /></button>
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
                <select value={form.branchId} onChange={(event) => updateForm("branchId", event.target.value)} required>
                  <option value="" disabled>Branch</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              <label>
                Role
                <select value={form.role} onChange={(event) => updateForm("role", event.target.value as StaffRole)}>
                  <option value="" disabled>Role</option>
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
                <span>{selectedStaff?.role ?? form.role}</span>
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
              <span><ShieldCheck size={16} /> {detailStaff.role}</span>
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
              {permissionPage.pageRows.map((permission, index) => (
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
