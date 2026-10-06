import { Check, Cloud, CloudOff, Eye, RefreshCcw, RotateCcw, Search, ShieldAlert, X } from "lucide-react";
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
import { dateRangeErrorMessage, hasInvertedDateRange } from "../../shared/utils/dateFilters";

const fallbackBranches: BranchOption[] = [];

function blankRecord(branchId = ""): SyncQueuePayload {
  return {
    branchId,
    terminalId: "",
    recordType: "" as SyncRecordType,
    operation: "" as SyncQueuePayload["operation"],
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
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const [records, setRecords] = useState<SyncQueueRecord[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [terminalFilter, setTerminalFilter] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [recordTypeFilter, setRecordTypeFilter] = useState<SyncRecordType | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [form, setForm] = useState<SyncQueuePayload>(blankRecord(initialBranchId));
  const [payloadText, setPayloadText] = useState('{"source":"manual sync test"}');
  const [reviewRecord, setReviewRecord] = useState<SyncQueueRecord | null>(null);
  const [reviewForm, setReviewForm] = useState<{
    status: Exclude<SyncRecordStatus, "processing"> | "";
    serverEntityId: string;
    error: string;
  }>({ status: "", serverEntityId: "", error: "" });
  const [status, setStatus] = useState("Ready");

  const queuedCount = useMemo(() => records.filter((record) => record.status === "queued").length, [records]);
  const issueCount = useMemo(() => records.filter((record) => record.status === "failed" || record.status === "conflict").length, [records]);
  const syncedCount = useMemo(() => records.filter((record) => record.status === "synced").length, [records]);
  const filteredRecords = useMemo(() => {
    const normalizedQuery = recordQuery.trim().toLowerCase();

    return records.filter((record) => {
      const haystack = [
        record.id,
        record.terminalId,
        record.recordType,
        record.operation,
        record.idempotencyKey,
        record.status,
        record.error,
        record.serverEntityId,
        JSON.stringify(record.payload)
      ].filter(Boolean).join(" ").toLowerCase();

      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
      const matchesType = !recordTypeFilter || record.recordType === recordTypeFilter;

      return matchesQuery && matchesType;
    });
  }, [recordQuery, recordTypeFilter, records]);
  const recordsPage = usePaginatedRows(filteredRecords, 10);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);

  async function loadSync(nextStatus = statusFilter, nextTerminal = terminalFilter, nextBranchId = branchId, nextStartDate = startDate, nextEndDate = endDate) {
    if (hasInvertedDateRange(nextStartDate, nextEndDate)) {
      setStatus(dateRangeErrorMessage());
      return;
    }

    setStatus("Syncing queue...");

    try {
      const branchResponse = await fetchBranchOptions();
      const nextBranches = branchResponse.branches;
      const branchTerminals = nextBranchId ? branchResponse.terminals.filter((terminal) => terminal.branchId === nextBranchId) : branchResponse.terminals;
      const terminalStillVisible = nextTerminal ? branchTerminals.some((terminal) => terminal.id === nextTerminal) : true;
      setBranches(nextBranches);
      setTerminals(branchTerminals);
      if (!terminalStillVisible) setTerminalFilter("");
      setForm((current) => ({
        ...current,
        branchId: nextBranchId || current.branchId,
        terminalId: current.terminalId || branchTerminals.find((terminal) => terminal.status === "online")?.id || branchTerminals[0]?.id || ""
      }));

      if (!nextBranchId && !canUseAllBranches) {
        setRecords([]);
        setStatus("Select a branch to load sync queue");
        return;
      }

      const queueResponse = await fetchSyncQueue(nextBranchId, nextStatus || "all", nextTerminal, activeUserId, nextStartDate, nextEndDate);
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

    if (!form.terminalId || !form.recordType || !form.operation) {
      setStatus("Select terminal, record type and operation");
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
      const nextServerEntityId = nextStatus === "synced" ? record.serverEntityId || `server-${record.id}` : record.serverEntityId;
      const nextError = nextStatus === "failed"
        ? "Retry failed during manual review"
        : nextStatus === "conflict"
          ? "Marked as conflict during manual review"
          : undefined;
      const response = await updateSyncRecordStatus(
        record.id,
        nextStatus,
        nextServerEntityId,
        nextError,
        record.branchId,
        activeUserId
      );
      setRecords((current) => current.map((item) => (item.id === response.record.id ? response.record : item)));
      setStatus(`Sync record ${nextStatus}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update sync record");
    }
  }

  function openReviewRecord(record: SyncQueueRecord) {
    setReviewRecord(record);
    setReviewForm({
      status: record.status === "processing" ? "queued" : record.status,
      serverEntityId: record.serverEntityId ?? "",
      error: record.error ?? ""
    });
  }

  function closeReviewRecord() {
    setReviewRecord(null);
    setReviewForm({ status: "", serverEntityId: "", error: "" });
  }

  async function saveReviewRecord(event: FormEvent) {
    event.preventDefault();

    if (!reviewRecord || !reviewForm.status) {
      setStatus("Select a sync status");
      return;
    }

    if (reviewForm.status === "synced" && !reviewForm.serverEntityId.trim()) {
      setStatus("Server entity ID is required for synced records");
      return;
    }

    if ((reviewForm.status === "failed" || reviewForm.status === "conflict") && !reviewForm.error.trim()) {
      setStatus("Review note is required for failed or conflict records");
      return;
    }

    if (!activeUserId) {
      setStatus("Sign in before updating sync records");
      return;
    }

    setStatus(`Updating ${reviewRecord.id}...`);

    try {
      const response = await updateSyncRecordStatus(
        reviewRecord.id,
        reviewForm.status,
        reviewForm.serverEntityId.trim() || undefined,
        reviewForm.error.trim() || undefined,
        reviewRecord.branchId,
        activeUserId
      );
      setRecords((current) => current.map((item) => (item.id === response.record.id ? response.record : item)));
      closeReviewRecord();
      setStatus("Sync record updated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update sync record");
    }
  }

  async function retryIssueRecords() {
    const issueRecords = records.filter((record) => record.status === "failed" || record.status === "conflict");

    if (issueRecords.length === 0) {
      setStatus("No failed or conflict records to retry");
      return;
    }

    if (!activeUserId) {
      setStatus("Sign in before retrying sync records");
      return;
    }

    setStatus(`Retrying ${issueRecords.length} issue records...`);

    try {
      const responses = await Promise.all(issueRecords.map((record) => updateSyncRecordStatus(
        record.id,
        "queued",
        record.serverEntityId,
        undefined,
        record.branchId,
        activeUserId
      )));
      const updatedById = new Map(responses.map((response) => [response.record.id, response.record]));
      setRecords((current) => current.map((record) => updatedById.get(record.id) ?? record));
      setStatus(`${responses.length} records queued for retry`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to retry issue records");
    }
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setTerminalFilter("");
    setForm(blankRecord(nextBranchId));
    void loadSync(statusFilter, "", nextBranchId);
  }

  function clearRecordFilters() {
    setRecordQuery("");
    setRecordTypeFilter("");
    setStartDate("");
    setEndDate("");
    void loadSync(statusFilter, terminalFilter, branchId, "", "");
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
            {branchLocked ? (
              <span className="locked-select-value locked-select-value-compact">
                <strong>{selectedBranch?.name ?? branchId}</strong>
                <small>{selectedBranch?.city ?? "assigned"}</small>
              </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                <option value="">All accessible branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
          </label>
          <select className="compact-select" value={statusFilter} onChange={(event) => {
            setStatusFilter(event.target.value);
            void loadSync(event.target.value, terminalFilter);
          }}>
            <option value="">Status</option>
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
          <button className="secondary-button" onClick={retryIssueRecords}><RotateCcw size={18} /> Retry issues</button>
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
          <span>{filteredRecords.length} of {records.length} records</span>
        </div>
        <div className="table-toolbar sync-record-toolbar">
          <div className="search-box compact-search">
            <Search size={16} />
            <input
              value={recordQuery}
              onChange={(event) => setRecordQuery(event.target.value)}
              placeholder="Search ID, key, server ID, error or payload"
            />
            {recordQuery ? (
              <button type="button" onClick={() => setRecordQuery("")} aria-label="Clear sync search"><X size={14} /></button>
            ) : null}
          </div>
          <select value={recordTypeFilter} onChange={(event) => setRecordTypeFilter(event.target.value as SyncRecordType | "")}>
            <option value="">Record type</option>
            <option value="sale">Sale</option>
            <option value="table_order">Table order</option>
            <option value="payment">Payment</option>
            <option value="cash_movement">Cash movement</option>
            <option value="stock_adjustment">Stock adjustment</option>
            <option value="receipt_action">Receipt action</option>
          </select>
          <div className="date-range-filter sync-date-range-filter">
            <label>
              <span>Start</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <span>End</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>
          <button className="secondary-button" type="button" onClick={() => loadSync(statusFilter, terminalFilter, branchId, startDate, endDate)}>Apply dates</button>
          {(recordQuery || recordTypeFilter || startDate || endDate) ? (
            <button className="secondary-button" type="button" onClick={clearRecordFilters}>Clear filters</button>
          ) : null}
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
                    <button onClick={() => openReviewRecord(record)}><Eye size={14} /> Review</button>
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
      {reviewRecord ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeReviewRecord}>
          <section className="modal-panel sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-review-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Offline reconciliation</p>
                <h2 id="sync-review-title">Review sync record</h2>
              </div>
              <button className="icon-button" onClick={closeReviewRecord} aria-label="Close sync review modal"><X size={18} /></button>
            </div>
            <form className="settings-form" onSubmit={saveReviewRecord}>
              <label>
                Record
                <span className="locked-select-value">
                  <strong>{reviewRecord.recordType.replace("_", " ")}</strong>
                  <small>{reviewRecord.id}</small>
                </span>
              </label>
              <label>
                Terminal
                <span className="locked-select-value">
                  <strong>{reviewRecord.terminalId}</strong>
                  <small>{reviewRecord.operation}</small>
                </span>
              </label>
              <label>
                Status
                <select value={reviewForm.status} onChange={(event) => setReviewForm((current) => ({ ...current, status: event.target.value as Exclude<SyncRecordStatus, "processing"> }))} required>
                  <option value="">Status</option>
                  <option value="queued">Queued</option>
                  <option value="synced">Synced</option>
                  <option value="failed">Failed</option>
                  <option value="conflict">Conflict</option>
                </select>
              </label>
              <label>
                Server entity ID
                <input value={reviewForm.serverEntityId} onChange={(event) => setReviewForm((current) => ({ ...current, serverEntityId: event.target.value }))} placeholder={`server-${reviewRecord.id}`} required={reviewForm.status === "synced"} />
              </label>
              <label className="wide-field">
                Error or review note
                <input value={reviewForm.error} onChange={(event) => setReviewForm((current) => ({ ...current, error: event.target.value }))} placeholder="Mismatch, duplicate record, retry reason" required={reviewForm.status === "failed" || reviewForm.status === "conflict"} />
              </label>
              <label className="wide-field">
                Payload
                <textarea readOnly value={JSON.stringify(reviewRecord.payload, null, 2)} rows={8} />
              </label>
              <div className="form-summary wide-field">
                <span>{reviewRecord.attempts} attempts - {reviewRecord.idempotencyKey}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save review</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
