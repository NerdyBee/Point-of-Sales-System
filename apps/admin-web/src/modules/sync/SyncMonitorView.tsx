import { Check, Cloud, CloudOff, RefreshCcw, RotateCcw, ShieldAlert } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  fetchBranchOptions,
  fetchSyncQueue,
  queueSyncRecord,
  readStoredAuth,
  updateSyncRecordStatus,
  type SyncQueuePayload,
  type SyncQueueRecord,
  type SyncRecordStatus,
  type SyncRecordType,
  type BranchOption,
  type TerminalOption
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { StatCard } from "../../shared/components/StatCard";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";

const fallbackBranches: BranchOption[] = [];

function blankRecord(branchId = ""): SyncQueuePayload {
  return {
    branchId,
    terminalId: "",
    recordType: "" as SyncRecordType,
    operation: "create",
    idempotencyKey: "",
    payload: {}
  };
}

function statusTone(status: SyncRecordStatus): "success" | "warning" | "danger" | "info" {
  if (status === "synced") return "success";
  if (status === "queued" || status === "processing") return "warning";
  if (status === "failed" || status === "conflict") return "danger";
  return "info";
}

function payloadPreview(payload: Record<string, unknown>) {
  const text = JSON.stringify(payload);
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

export function SyncMonitorView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const initialBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const [records, setRecords] = useState<SyncQueueRecord[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [terminalFilter, setTerminalFilter] = useState("");
  const [form, setForm] = useState<SyncQueuePayload>(blankRecord(initialBranchId));
  const [payloadText, setPayloadText] = useState('{"source":"manual sync test"}');
  const [status, setStatus] = useState("Ready");

  const queuedCount = useMemo(() => records.filter((record) => record.status === "queued").length, [records]);
  const issueCount = useMemo(() => records.filter((record) => record.status === "failed" || record.status === "conflict").length, [records]);
  const syncedCount = useMemo(() => records.filter((record) => record.status === "synced").length, [records]);
  const recordsPage = usePaginatedRows(records, 10);

  async function loadSync(nextStatus = statusFilter, nextTerminal = terminalFilter, nextBranchId = branchId) {
    setStatus("Syncing queue...");

    try {
      const branchResponse = await fetchBranchOptions();
      const nextBranches = branchResponse.branches;
      const branchTerminals = branchResponse.terminals.filter((terminal) => terminal.branchId === nextBranchId);
      const terminalStillVisible = nextTerminal ? branchTerminals.some((terminal) => terminal.id === nextTerminal) : true;
      setBranches(nextBranches);
      setTerminals(branchTerminals);
      if (!terminalStillVisible) setTerminalFilter("");
      setForm((current) => ({
        ...current,
        branchId: nextBranchId,
        terminalId: current.terminalId || branchTerminals.find((terminal) => terminal.status === "online")?.id || branchTerminals[0]?.id || ""
      }));

      if (!nextBranchId) {
        setRecords([]);
        setStatus("Select a branch to load sync queue");
        return;
      }

      const queueResponse = await fetchSyncQueue(nextBranchId, nextStatus || "all", nextTerminal, activeUserId);
      setRecords(queueResponse.records);
      setStatus("Sync queue loaded");
    } catch (error) {
      setBranches(fallbackBranches);
      setRecords([]);
      setStatus(error instanceof Error ? error.message : "Unable to load sync queue");
    }
  }

  useEffect(() => {
    void loadSync();
  }, []);

  function updateForm<K extends keyof SyncQueuePayload>(key: K, value: SyncQueuePayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitQueuedRecord(event: FormEvent) {
    event.preventDefault();

    if (!form.terminalId || !form.recordType) {
      setStatus("Select terminal and record type");
      return;
    }

    if (!branchId) {
      setStatus("Select a branch before queueing records");
      return;
    }

    if (!activeUserId) {
      setStatus("Sign in before queueing sync records");
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      setStatus("Payload must be valid JSON");
      return;
    }

    setStatus("Queueing record...");

    try {
      const response = await queueSyncRecord({
        ...form,
        branchId,
        payload,
        idempotencyKey: form.idempotencyKey || `${form.terminalId}-${form.recordType}-${Date.now()}`
      }, activeUserId);
      setRecords((current) => [response.record, ...current.filter((record) => record.id !== response.record.id)]);
      setForm((current) => ({ ...blankRecord(branchId), terminalId: current.terminalId }));
      setPayloadText('{"source":"manual sync test"}');
      setStatus(response.status === "replayed" ? "Duplicate queue record replayed" : "Record queued");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to queue record");
    }
  }

  async function changeRecordStatus(record: SyncQueueRecord, nextStatus: Exclude<SyncRecordStatus, "processing">) {
    if (!activeUserId) {
      setStatus("Sign in before updating sync records");
      return;
    }

    setStatus(`Updating ${record.id}...`);

    try {
      const response = await updateSyncRecordStatus(
        record.id,
        nextStatus,
        nextStatus === "synced" ? record.serverEntityId || `server-${record.id}` : record.serverEntityId,
        nextStatus === "failed" ? "Retry failed during manual review" : undefined,
        record.branchId,
        activeUserId
      );
      setRecords((current) => current.map((item) => (item.id === response.record.id ? response.record : item)));
      setStatus(`Sync record ${nextStatus}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update sync record");
    }
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setTerminalFilter("");
    setForm(blankRecord(nextBranchId));
    void loadSync(statusFilter, "", nextBranchId);
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Offline operation</p>
          <h1>Sync monitor</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Branch
            <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <select className="compact-select" value={statusFilter} onChange={(event) => {
            setStatusFilter(event.target.value);
            void loadSync(event.target.value, terminalFilter);
          }}>
            <option value="">Status</option>
            <option value="all">All</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="synced">Synced</option>
            <option value="failed">Failed</option>
            <option value="conflict">Conflict</option>
          </select>
          <select className="compact-select" value={terminalFilter} onChange={(event) => {
            setTerminalFilter(event.target.value);
            void loadSync(statusFilter, event.target.value);
          }}>
            <option value="">Terminal</option>
            {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
          </select>
          <button className="secondary-button" onClick={() => loadSync()}><RefreshCcw size={18} /> Sync</button>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Queued records" value={String(queuedCount)} detail={status} icon={Cloud} tone="dark" />
        <StatCard label="Needs review" value={String(issueCount)} detail="Failed or conflict" icon={ShieldAlert} />
        <StatCard label="Synced records" value={String(syncedCount)} detail="Confirmed by server" icon={Check} />
      </section>

      <section className="settings-workflow">
        <form className="panel" onSubmit={submitQueuedRecord}>
          <div className="panel-header">
            <h2>Queue test record</h2>
            <CloudOff size={20} />
          </div>
          <div className="settings-form">
            <label>
              Terminal
              <select value={form.terminalId} onChange={(event) => updateForm("terminalId", event.target.value)} required>
                <option value="">Terminal</option>
                {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name} - {terminal.status}</option>)}
              </select>
            </label>
            <label>
              Record type
              <select value={form.recordType} onChange={(event) => updateForm("recordType", event.target.value as SyncRecordType)} required>
                <option value="">Record type</option>
                <option value="sale">Sale</option>
                <option value="table_order">Table order</option>
                <option value="payment">Payment</option>
                <option value="cash_movement">Cash movement</option>
                <option value="stock_adjustment">Stock adjustment</option>
                <option value="receipt_action">Receipt action</option>
              </select>
            </label>
            <label>
              Operation
              <select value={form.operation} onChange={(event) => updateForm("operation", event.target.value as SyncQueuePayload["operation"])} required>
                <option value="">Operation</option>
                <option value="create">Create</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
              </select>
            </label>
            <label className="wide-field">
              Idempotency key
              <input value={form.idempotencyKey} onChange={(event) => updateForm("idempotencyKey", event.target.value)} placeholder="Generated if empty" />
            </label>
            <label className="wide-field">
              Payload JSON
              <textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} rows={4} />
            </label>
            <div className="form-summary wide-field">
              <span>Queued records can be retried without creating duplicates.</span>
              <button className="primary-button" type="submit"><Cloud size={18} /> Queue record</button>
            </div>
          </div>
        </form>

        <section className="panel">
          <div className="panel-header">
            <h2>Queue health</h2>
            <span>{records.length} records</span>
          </div>
          <div className="settings-chip-list">
            {terminals.map((terminal) => {
              const terminalRecords = records.filter((record) => record.terminalId === terminal.id);
              return (
                <span key={terminal.id}>
                  <strong>{terminal.name}</strong>
                  <small>{terminal.status} - {terminalRecords.length} records</small>
                </span>
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Offline sync queue</h2>
          <span>{records.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Created</th><th>Terminal</th><th>Type</th><th>Key</th><th>Payload</th><th>Attempts</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {recordsPage.pageRows.length === 0 ? (
                <tr><td colSpan={9}>No queued sync records.</td></tr>
              ) : recordsPage.pageRows.map((record, index) => (
                <tr key={record.id}>
                  <td className="number-cell">{recordsPage.startIndex + index + 1}</td>
                  <td>{new Date(record.createdAt).toLocaleTimeString()}</td>
                  <td>{record.terminalId}</td>
                  <td><strong>{record.recordType.replace("_", " ")}</strong><br /><small>{record.operation}</small></td>
                  <td>{record.idempotencyKey}</td>
                  <td><small>{record.error || payloadPreview(record.payload)}</small></td>
                  <td>{record.attempts}</td>
                  <td><StatusBadge label={record.status} tone={statusTone(record.status)} /></td>
                  <td className="row-actions">
                    <button disabled={record.status === "synced"} onClick={() => changeRecordStatus(record, "queued")}><RotateCcw size={14} /> Retry</button>
                    <button disabled={record.status === "synced"} onClick={() => changeRecordStatus(record, "synced")}><Check size={14} /> Resolve</button>
                    <button disabled={record.status === "synced" || record.status === "conflict"} onClick={() => changeRecordStatus(record, "conflict")}>Conflict</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={recordsPage.page}
          pageCount={recordsPage.pageCount}
          pageSize={recordsPage.pageSize}
          totalRows={recordsPage.totalRows}
          startIndex={recordsPage.startIndex}
          visibleCount={recordsPage.pageRows.length}
          onPageChange={recordsPage.setPage}
          onPageSizeChange={recordsPage.setPageSize}
        />
      </section>
    </div>
  );
}
