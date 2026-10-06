import { Cloud, KeyRound, Link2, RefreshCcw, Tablet, Trash2, Unplug } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  connectCloudUpstream,
  createSyncPairing,
  disconnectCloudUpstream,
  dismissReplicationConflict,
  fetchReplicationConflicts,
  fetchReplicationStatus,
  revokeSyncNode,
  runCloudUpstreamSync,
  setCloudUpstreamEnabled,
  type ReplicationConflict,
  type ReplicationStatus,
  type SyncNodeInfo,
  type TerminalOption
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function nodeTone(node: SyncNodeInfo): "success" | "warning" | "danger" | "info" {
  if (node.status === "revoked") return "danger";
  if (node.status === "pending") return "warning";
  return node.lastSeenAt && Date.now() - new Date(node.lastSeenAt).getTime() < 10 * 60_000 ? "success" : "info";
}

/**
 * Replication setup: this server's role, the optional office -> cloud link, tablets
 * and offices paired with this server, and rows that could not be merged.
 */
export function ReplicationPanel({ terminals }: { terminals: TerminalOption[] }) {
  const [status, setStatus] = useState<ReplicationStatus | null>(null);
  const [conflicts, setConflicts] = useState<ReplicationConflict[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cloudForm, setCloudForm] = useState({ url: "", pairingCode: "" });
  const [pairForm, setPairForm] = useState<{ kind: "device" | "office"; name: string; terminalId: string }>({ kind: "device", name: "", terminalId: "" });
  const [issuedCode, setIssuedCode] = useState<{ code: string; name: string; expiresAt?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextConflicts] = await Promise.all([fetchReplicationStatus(), fetchReplicationConflicts()]);
      setStatus(nextStatus);
      setConflicts(nextConflicts.conflicts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Replication status unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await work();
      if (result) setMessage(result);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const connect = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await connectCloudUpstream(cloudForm.url.trim(), cloudForm.pairingCode.trim());
      setCloudForm({ url: "", pairingCode: "" });
      return "Connected to the cloud. The first sync is running in the background.";
    });
  };

  const issueCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await createSyncPairing({
        kind: pairForm.kind,
        name: pairForm.name.trim(),
        terminalId: pairForm.kind === "device" ? pairForm.terminalId : undefined
      });
      setIssuedCode({ code: result.pairingCode, name: result.node.name, expiresAt: result.node.pairingExpiresAt });
      setPairForm((current) => ({ ...current, name: "" }));
    });
  };

  if (!status) {
    return message ? (
      <section className="panel">
        <div className="panel-header"><h2>Replication</h2></div>
        <p>{message}</p>
      </section>
    ) : null;
  }

  const isOffice = status.identity.role === "office";
  const upstream = status.upstream;
  const terminalName = (id?: string) => terminals.find((terminal) => terminal.id === id)?.name ?? id ?? "";

  return (
    <>
      <section className="settings-workflow">
        <section className="panel">
          <div className="panel-header">
            <h2>{isOffice ? "Cloud connection" : "This cloud server"}</h2>
            <Cloud size={20} />
          </div>
          <div className="settings-form">
            <p className="wide-field">
              Server <strong>{status.identity.nodeId}</strong> · role <strong>{status.identity.role}</strong>
              {status.identity.nodeCode ? <> · document prefix <strong>INV-{status.identity.nodeCode}</strong></> : null}
            </p>
            {!isOffice ? (
              <p className="wide-field">
                Office servers and tablets connect to this server with a pairing code. Issue one below; an office enters it under Sync → Cloud connection.
              </p>
            ) : upstream ? (
              <>
                <p className="wide-field">
                  Linked to <strong>{upstream.url}</strong> as <strong>{upstream.nodeId}</strong>{" "}
                  <StatusBadge label={!upstream.enabled ? "Paused (offline only)" : upstream.lastError ? "Error" : "Syncing"} tone={!upstream.enabled ? "warning" : upstream.lastError ? "danger" : "success"} />
                </p>
                <p className="wide-field">
                  Last sent: {formatTime(upstream.lastPushAt)} · Last received: {formatTime(upstream.lastPullAt)}
                  {upstream.lastError ? <><br /><small>{upstream.lastError} ({formatTime(upstream.lastErrorAt)})</small></> : null}
                </p>
                <div className="form-summary wide-field">
                  <span>Turn syncing off to run this office fully offline. Nothing is lost; changes are sent when it is turned back on.</span>
                  <div className="button-group">
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => {
                      const { result } = await runCloudUpstreamSync();
                      return result.error ? `Sync failed: ${result.error}` : `Sent ${result.pushed} changes, received ${result.pulled.applied}${result.pulled.conflicts ? ` (${result.pulled.conflicts} need review)` : ""}.`;
                    })}><RefreshCcw size={18} /> Sync now</button>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => { await setCloudUpstreamEnabled(!upstream.enabled); })}>
                      {upstream.enabled ? "Pause" : "Resume"}
                    </button>
                    <button className="danger-button" type="button" disabled={busy} onClick={() => {
                      if (window.confirm("Disconnect from the cloud? This office keeps all its data and continues offline.")) void run(async () => { await disconnectCloudUpstream(); });
                    }}><Unplug size={18} /> Disconnect</button>
                  </div>
                </div>
              </>
            ) : (
              <form className="settings-form wide-field" onSubmit={connect}>
                <p className="wide-field">This office runs offline only. To also sync online, create an office pairing code on your cloud server (Sync → Pair) and enter it here.</p>
                <label className="wide-field">
                  Cloud server URL
                  <input type="url" required value={cloudForm.url} onChange={(event) => setCloudForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://pos.yourbusiness.com" />
                </label>
                <label>
                  Pairing code
                  <input required value={cloudForm.pairingCode} onChange={(event) => setCloudForm((current) => ({ ...current, pairingCode: event.target.value.toUpperCase() }))} placeholder="ABCD-EFGH" />
                </label>
                <div className="form-summary wide-field">
                  <span>The first connection uploads this office's data and downloads the cloud's.</span>
                  <button className="primary-button" type="submit" disabled={busy}><Link2 size={18} /> Connect</button>
                </div>
              </form>
            )}
          </div>
        </section>

        <form className="panel" onSubmit={issueCode}>
          <div className="panel-header">
            <h2>Pair a tablet{isOffice ? "" : " or office"}</h2>
            <KeyRound size={20} />
          </div>
          <div className="settings-form">
            {!isOffice ? (
              <label>
                Type
                <select value={pairForm.kind} onChange={(event) => setPairForm((current) => ({ ...current, kind: event.target.value as "device" | "office" }))}>
                  <option value="device">Tablet</option>
                  <option value="office">Office server</option>
                </select>
              </label>
            ) : null}
            <label>
              Name
              <input required minLength={2} value={pairForm.name} onChange={(event) => setPairForm((current) => ({ ...current, name: event.target.value }))} placeholder={pairForm.kind === "device" ? "Front counter tablet" : "Ikeja office"} />
            </label>
            {pairForm.kind === "device" ? (
              <label>
                Acts as terminal
                <select required value={pairForm.terminalId} onChange={(event) => setPairForm((current) => ({ ...current, terminalId: event.target.value }))}>
                  <option value="">Terminal</option>
                  {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
                </select>
              </label>
            ) : null}
            <div className="form-summary wide-field">
              <span>
                {pairForm.kind === "device"
                  ? "For a tablet that uses both the office server and the cloud, issue a code on each server for the same terminal."
                  : "Codes are single use and expire after 24 hours."}
              </span>
              <button className="primary-button" type="submit" disabled={busy}><KeyRound size={18} /> Create code</button>
            </div>
            {issuedCode ? (
              <p className="wide-field">
                Code for <strong>{issuedCode.name}</strong>: <strong style={{ fontSize: "1.4em", letterSpacing: "0.1em" }}>{issuedCode.code}</strong>
                <br /><small>Shown once. Expires {formatTime(issuedCode.expiresAt)}.</small>
              </p>
            ) : null}
          </div>
        </form>
      </section>

      {message ? <p className="panel" role="status">{message}</p> : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Paired tablets and offices</h2>
          <span>{status.nodes.filter((node) => node.status === "active").length} active · change log #{status.changeLogHead}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Terminal / scope</th><th>Last seen</th><th>Last upload</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {status.nodes.length === 0 ? (
                <tr><td colSpan={7}>Nothing paired yet.</td></tr>
              ) : status.nodes.map((node) => (
                <tr key={node.id}>
                  <td><strong>{node.name}</strong><br /><small>{node.id}</small></td>
                  <td>{node.kind === "device" ? <><Tablet size={14} /> Tablet</> : <><Cloud size={14} /> Office</>}</td>
                  <td>{node.kind === "device" ? terminalName(node.terminalId) : node.branchIds.length ? node.branchIds.join(", ") : "All branches"}</td>
                  <td>{formatTime(node.lastSeenAt)}{node.appVersion ? <><br /><small>{node.appVersion}</small></> : null}</td>
                  <td>{formatTime(node.lastPushAt)}</td>
                  <td><StatusBadge label={node.status === "pending" ? `Code issued` : node.status} tone={nodeTone(node)} /></td>
                  <td className="row-actions">
                    {node.status !== "revoked" ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => {
                        if (window.confirm(`Revoke ${node.name}? It will stop syncing immediately.`)) void run(async () => { await revokeSyncNode(node.id); });
                      }}><Trash2 size={16} /> Revoke</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {conflicts.length ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Replication conflicts</h2>
            <span>{conflicts.length} rows could not be merged; they are retried on every sync</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Record</th><th>From</th><th>Problem</th><th>Attempts</th><th>Last tried</th><th>Actions</th></tr></thead>
              <tbody>
                {conflicts.map((conflict) => (
                  <tr key={conflict.id}>
                    <td><strong>{conflict.tableName}</strong><br /><small>{conflict.rowId}</small></td>
                    <td>{conflict.source}</td>
                    <td><small>{conflict.error}</small></td>
                    <td>{conflict.attempts}</td>
                    <td>{formatTime(conflict.updatedAt)}</td>
                    <td className="row-actions">
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => { await dismissReplicationConflict(conflict.id); })}>Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
