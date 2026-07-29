import { Check, Plus, RefreshCcw, Search, ShieldCheck, Users, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  assignStaffRole,
  createRole,
  fetchBranchOptions,
  fetchRoles,
  fetchStaff,
  readStoredAuth,
  refreshCurrentAuth,
  updateRole,
  updateRolePermissions,
  type AccessPermission,
  type AccessRole,
  type BranchOption,
  type RolePayload,
  type StaffMember
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";

const blankRole: RolePayload = { name: "", label: "", description: "" };
const fallbackBranches: BranchOption[] = [];

export function RolesView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const activeRole = storedAuth?.staff.role ?? "";
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleForm, setRoleForm] = useState<RolePayload>(blankRole);
  const [assignment, setAssignment] = useState({ staffId: "", role: "" });
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleTypeFilter, setRoleTypeFilter] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [permissionGroupFilter, setPermissionGroupFilter] = useState("");
  const [status, setStatus] = useState("Ready");

  const selectedRole = useMemo(() => roles.find((role) => role.id === selectedRoleId) ?? roles[0], [roles, selectedRoleId]);
  const filteredRoles = useMemo(() => {
    const normalizedQuery = roleQuery.trim().toLowerCase();

    return roles.filter((role) => {
      const matchesQuery = !normalizedQuery || `${role.name} ${role.label} ${role.description ?? ""}`.toLowerCase().includes(normalizedQuery);
      const matchesType = !roleTypeFilter
        || (roleTypeFilter === "system" && role.system)
        || (roleTypeFilter === "custom" && !role.system);

      return matchesQuery && matchesType;
    });
  }, [roleQuery, roleTypeFilter, roles]);
  const filteredPermissions = useMemo(() => {
    const normalizedQuery = permissionQuery.trim().toLowerCase();

    return permissions.filter((permission) => {
      const matchesGroup = !permissionGroupFilter || permission.group === permissionGroupFilter;
      const matchesQuery = !normalizedQuery
        || `${permission.action} ${permission.label} ${permission.group} ${permission.description}`.toLowerCase().includes(normalizedQuery);

      return matchesGroup && matchesQuery;
    });
  }, [permissionGroupFilter, permissionQuery, permissions]);
  const permissionGroups = useMemo(() => [...new Set(permissions.map((permission) => permission.group))].sort(), [permissions]);
  const groupedPermissions = useMemo(() => filteredPermissions.reduce<Record<string, AccessPermission[]>>((groups, permission) => {
    groups[permission.group] = [...(groups[permission.group] ?? []), permission];
    return groups;
  }, {}), [filteredPermissions]);
  const permissionGroupEntries = useMemo(() => Object.entries(groupedPermissions), [groupedPermissions]);
  const rolePage = usePaginatedRows(filteredRoles, 10);
  const permissionGroupPage = usePaginatedRows(permissionGroupEntries, 4);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);

  async function loadAccessControl(nextBranchId = branchId) {
    setStatus("Syncing roles...");
    try {
      const [roleResponse, branchResponse] = await Promise.all([
        fetchRoles(),
        fetchBranchOptions()
      ]);
      const staffResponse = nextBranchId ? await fetchStaff(nextBranchId, activeUserId) : { staff: [] };
      setRoles(roleResponse.roles);
      setPermissions(roleResponse.permissions);
      setStaff(staffResponse.staff);
      setBranches(branchResponse.branches);
      setSelectedRoleId((current) => current || roleResponse.roles[0]?.id || "");
      setStatus(nextBranchId ? "Roles synced" : "Select a branch to load staff assignments");
    } catch (error) {
      setBranches(fallbackBranches);
      setStaff([]);
      setStatus(error instanceof Error ? error.message : "Unable to load roles");
    }
  }

  useEffect(() => {
    void loadAccessControl();
  }, []);

  function upsertRole(role: AccessRole) {
    setRoles((current) => current.some((item) => item.id === role.id) ? current.map((item) => (item.id === role.id ? role : item)) : [...current, role]);
    setSelectedRoleId(role.id);
  }

  function permissionsForRole(roleName: string, roleList = roles) {
    return roleList.find((role) => role.name === roleName)?.permissions ?? [];
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault();
    if (!roleForm.name || !roleForm.label) {
      setStatus("Enter role name and label");
      return;
    }

    setStatus("Creating role...");
    try {
      const response = await createRole(roleForm);
      upsertRole(response.role);
      setRoleForm(blankRole);
      setRoleModalOpen(false);
      setStatus("Role created");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create role");
    }
  }

  async function renameRole(event: FormEvent) {
    event.preventDefault();
    if (!selectedRole) return;

    setStatus("Updating role...");
    try {
      const response = await updateRole(selectedRole.id, { label: selectedRole.label, description: selectedRole.description ?? "" });
      upsertRole(response.role);
      setStatus("Role updated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update role");
    }
  }

  async function togglePermission(action: string) {
    if (!selectedRole) return;
    const nextPermissions = selectedRole.permissions.includes(action)
      ? selectedRole.permissions.filter((permission) => permission !== action)
      : [...selectedRole.permissions, action];

    setStatus("Saving permissions...");
    try {
      const response = await updateRolePermissions(selectedRole.id, nextPermissions);
      upsertRole(response.role);
      setStaff((current) => current.map((member) => member.role === response.role.name ? { ...member, permissions: response.role.permissions } : member));
      if (response.role.name === activeRole) {
        void refreshCurrentAuth();
      }
      setStatus("Permissions saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save permissions");
    }
  }

  async function saveAssignment(event: FormEvent) {
    event.preventDefault();
    if (!assignment.staffId) {
      setStatus("Select a staff member");
      return;
    }

    if (!assignment.role) {
      setStatus("Select a role");
      return;
    }

    if (!branchId) {
      setStatus("Select a branch before assigning roles");
      return;
    }

    setStatus("Assigning role...");
    try {
      const response = await assignStaffRole(assignment.staffId, assignment.role, branchId);
      setStaff((current) => current.map((member) => member.id === response.staffId ? { ...member, role: response.role, permissions: permissionsForRole(response.role) } : member));
      if (response.staffId === activeUserId) {
        void refreshCurrentAuth();
      }
      setAssignment({ staffId: "", role: "" });
      setStatus("Staff role assigned");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to assign role");
    }
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setAssignment({ staffId: "", role: "" });
    void loadAccessControl(nextBranchId);
  }

  function closeRoleModal() {
    setRoleModalOpen(false);
    setRoleForm(blankRole);
  }

  function clearRoleFilters() {
    setRoleQuery("");
    setRoleTypeFilter("");
  }

  function clearPermissionFilters() {
    setPermissionQuery("");
    setPermissionGroupFilter("");
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>Roles and permissions</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Staff branch
            {branchLocked ? (
              <span className="locked-select-value locked-select-value-compact">
                <strong>{selectedBranch?.name ?? branchId}</strong>
                <small>{selectedBranch?.city ?? "assigned"}</small>
              </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                <option value="">Staff branch</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
          </label>
          <button className="secondary-button" onClick={() => void loadAccessControl()}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={() => setRoleModalOpen(true)}><Plus size={18} /> Create role</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Roles</span><ShieldCheck size={20} /></div>
          <strong>{roles.length}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Permissions</span></div>
          <strong>{permissions.length}</strong>
          <small>Grouped by workflow</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Assigned staff</span><Users size={20} /></div>
          <strong>{staff.filter((member) => member.role).length}</strong>
          <small>Role based users</small>
        </article>
      </section>

      <div className="roles-workflow">
        <section className="panel">
          <div className="panel-header">
            <h2>Roles</h2>
            <span>{filteredRoles.length} of {roles.length} records</span>
          </div>
          <div className="table-toolbar role-filter-toolbar">
            <div className="search-box compact-search">
              <Search size={16} />
              <input
                value={roleQuery}
                onChange={(event) => setRoleQuery(event.target.value)}
                placeholder="Search roles"
              />
              {roleQuery ? (
                <button type="button" onClick={() => setRoleQuery("")} aria-label="Clear role search"><X size={14} /></button>
              ) : null}
            </div>
            <select value={roleTypeFilter} onChange={(event) => setRoleTypeFilter(event.target.value)}>
              <option value="">Role type</option>
              <option value="system">System</option>
              <option value="custom">Custom</option>
            </select>
            {(roleQuery || roleTypeFilter) ? (
              <button className="secondary-button" type="button" onClick={clearRoleFilters}>Clear filters</button>
            ) : null}
          </div>
          <div className="stack">
            {rolePage.pageRows.length === 0 ? (
              <div className="empty-state">No roles found.</div>
            ) : rolePage.pageRows.map((role, index) => (
              <button className={`role-row ${selectedRole?.id === role.id ? "role-row-active" : ""}`} key={role.id} onClick={() => setSelectedRoleId(role.id)}>
                <span>
                  <strong><span className="number-cell">{rolePage.startIndex + index + 1}</span>{role.label}</strong>
                  <small>{role.name} - {role.staffCount} staff</small>
                </span>
                <StatusBadge label={role.system ? "system" : "custom"} tone={role.system ? "info" : "success"} />
              </button>
            ))}
          </div>
          <TablePagination
            page={rolePage.page}
            pageCount={rolePage.pageCount}
            pageSize={rolePage.pageSize}
            totalRows={rolePage.totalRows}
            startIndex={rolePage.startIndex}
            visibleCount={rolePage.pageRows.length}
            onPageChange={rolePage.setPage}
            onPageSizeChange={rolePage.setPageSize}
          />
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>{selectedRole?.label ?? "Role permissions"}</h2>
            <span>{selectedRole?.permissions.length ?? 0} enabled</span>
          </div>
          {selectedRole ? (
            <>
              <form className="settings-form role-edit-form" onSubmit={renameRole}>
                <label>
                  Label
                  <input value={selectedRole.label} onChange={(event) => upsertRole({ ...selectedRole, label: event.target.value })} />
                </label>
                <label>
                  Description
                  <input value={selectedRole.description ?? ""} onChange={(event) => upsertRole({ ...selectedRole, description: event.target.value })} />
                </label>
                <button className="secondary-button wide-field" type="submit"><Check size={18} /> Save role details</button>
              </form>
              <div className="table-toolbar permission-filter-toolbar">
                <div className="search-box compact-search">
                  <Search size={16} />
                  <input
                    value={permissionQuery}
                    onChange={(event) => setPermissionQuery(event.target.value)}
                    placeholder="Search permissions"
                  />
                  {permissionQuery ? (
                    <button type="button" onClick={() => setPermissionQuery("")} aria-label="Clear permission search"><X size={14} /></button>
                  ) : null}
                </div>
                <select value={permissionGroupFilter} onChange={(event) => setPermissionGroupFilter(event.target.value)}>
                  <option value="">Permission group</option>
                  {permissionGroups.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
                <span>{filteredPermissions.length} of {permissions.length} permissions</span>
                {(permissionQuery || permissionGroupFilter) ? (
                  <button className="secondary-button" type="button" onClick={clearPermissionFilters}>Clear filters</button>
                ) : null}
              </div>
              <div className="permission-groups">
                {permissionGroupPage.pageRows.length === 0 ? (
                  <div className="empty-state">No permissions match the current search.</div>
                ) : permissionGroupPage.pageRows.map(([group, groupPermissions], groupIndex) => (
                  <div className="permission-group" key={group}>
                    <h3><span className="number-cell">{permissionGroupPage.startIndex + groupIndex + 1}</span>{group}</h3>
                    {groupPermissions.map((permission, permissionIndex) => (
                      <label className="permission-row" key={permission.action}>
                        <input
                          type="checkbox"
                          checked={selectedRole.permissions.includes(permission.action)}
                          disabled={selectedRole.name === "owner"}
                          onChange={() => togglePermission(permission.action)}
                        />
                        <span>
                          <strong><span className="number-cell">{permissionIndex + 1}</span>{permission.label}</strong>
                          <small>{permission.description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <TablePagination
                page={permissionGroupPage.page}
                pageCount={permissionGroupPage.pageCount}
                pageSize={permissionGroupPage.pageSize}
                totalRows={permissionGroupPage.totalRows}
                startIndex={permissionGroupPage.startIndex}
                visibleCount={permissionGroupPage.pageRows.length}
                onPageChange={permissionGroupPage.setPage}
                onPageSizeChange={permissionGroupPage.setPageSize}
              />
            </>
          ) : <p>No role selected.</p>}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Assign staff role</h2>
            <Users size={20} />
          </div>
          <form className="settings-form" onSubmit={saveAssignment}>
            <label className="wide-field">
              Staff member
              <select value={assignment.staffId} onChange={(event) => setAssignment((current) => ({ ...current, staffId: event.target.value }))} required>
                <option value="">Staff member</option>
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name} - {member.role}</option>)}
              </select>
            </label>
            <label className="wide-field">
              Role
              <select value={assignment.role} onChange={(event) => setAssignment((current) => ({ ...current, role: event.target.value }))} required>
                <option value="">Role</option>
                {roles.map((role) => <option key={role.id} value={role.name}>{role.label}</option>)}
              </select>
            </label>
            <button className="primary-button wide-field" type="submit"><Check size={18} /> Assign role</button>
          </form>
        </section>
      </div>
      {roleModalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeRoleModal}>
          <section className="modal-panel staff-modal" role="dialog" aria-modal="true" aria-labelledby="role-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Create access role</p>
                <h2 id="role-modal-title">Add role</h2>
              </div>
              <button className="icon-button" onClick={closeRoleModal} aria-label="Close role modal"><X size={18} /></button>
            </div>
            <form className="settings-form" onSubmit={saveRole}>
              <label>
                Role slug
                <input value={roleForm.name} onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value.toLowerCase().replace(/\s+/g, "_") }))} placeholder="floor_manager" required />
              </label>
              <label>
                Label
                <input value={roleForm.label} onChange={(event) => setRoleForm((current) => ({ ...current, label: event.target.value }))} placeholder="Floor Manager" required />
              </label>
              <label className="wide-field">
                Description
                <input value={roleForm.description ?? ""} onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <div className="form-summary">
                <span>{roleForm.name || "role_slug"}</span>
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
