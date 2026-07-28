import { Banknote, Check, Clock3, LockKeyhole, Plus, Printer, RefreshCcw, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  closeRegisterShift,
  createApproval,
  createCashMovement,
  fetchBranchOptions,
  fetchCurrentRegister,
  openRegisterShift,
  readStoredAuth,
  reconcilePayment,
  type CashMovement,
  type CashMovementPayload,
  type PaymentRecord,
  type RegisterShift,
  type ApprovalRequest,
  type BranchOption,
  type TerminalOption
} from "../../shared/api/client";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { TablePagination, usePaginatedRows } from "../../shared/components/TablePagination";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import { applyManagerApproval } from "../sales/pricing";

const fallbackBranches: BranchOption[] = [];

const defaultMovement: Omit<CashMovementPayload, "shiftId"> = {
  type: "" as CashMovement["type"],
  amount: 0,
  reason: ""
};

interface RegisterViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function RegisterView({ approvalHandoff, onApprovalHandoffConsumed }: RegisterViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const activePermissions = storedAuth?.staff.permissions ?? [];
  const canCloseRegister = activePermissions.includes("register.close");
  const [branchId, setBranchId] = useState(storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "");
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [terminalId, setTerminalId] = useState(storedAuth?.session.terminalId ?? "");
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [shift, setShift] = useState<RegisterShift | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [movement, setMovement] = useState(defaultMovement);
  const [movementApprovalId, setMovementApprovalId] = useState("");
  const [countedCash, setCountedCash] = useState(0);
  const [managerNote, setManagerNote] = useState("");
  const [closeApprovalId, setCloseApprovalId] = useState("");
  const [status, setStatus] = useState("Ready");
  const { settings, displayMoney } = useTenantSettings();
  const handledApprovalIdRef = useRef<string | null>(null);

  const cashPayments = useMemo(() => payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0), [payments]);
  const nonCashPayments = useMemo(() => payments.filter((payment) => payment.method !== "cash").reduce((sum, payment) => sum + payment.amount, 0), [payments]);
  const pendingNonCashPayments = useMemo(
    () => payments.filter((payment) => payment.method !== "cash" && payment.reconciliationStatus === "pending"),
    [payments]
  );
  const movementTotal = useMemo(
    () =>
      movements.reduce((sum, item) => {
        const signedAmount = item.type === "cash_in" || item.type === "paid_in" ? item.amount : -item.amount;
        return sum + signedAmount;
      }, 0),
    [movements]
  );
  const variance = shift ? countedCash - shift.expectedCash : 0;
  const hardware = settings?.hardware;
  const printerReady = Boolean(hardware?.printer.trim());
  const drawerReady = Boolean(hardware?.cashDrawer);
  const branchTerminals = useMemo(() => terminals.filter((terminal) => terminal.branchId === branchId), [branchId, terminals]);
  const selectedTerminal = useMemo(() => terminals.find((terminal) => terminal.id === terminalId), [terminalId, terminals]);
  const paymentsPage = usePaginatedRows(payments, 10);
  const movementsPage = usePaginatedRows(movements, 10);

  function movementSign(type: CashMovement["type"]) {
    return type === "cash_in" || type === "paid_in" ? "+" : "-";
  }

  function closeShiftButtonLabel() {
    if (closeApprovalId.trim() && canCloseRegister) return "Apply close";
    if (!canCloseRegister || (shift && applyManagerApproval("register-close", Math.abs(variance)))) return "Request close approval";
    return "Close shift";
  }

  function updateMovementForm<K extends keyof typeof movement>(key: K, value: (typeof movement)[K]) {
    setMovement((current) => ({ ...current, [key]: value }));
    setMovementApprovalId("");
  }

  function updateCountedCash(value: number) {
    setCountedCash(value);
    setCloseApprovalId("");
  }

  function updateManagerNote(value: string) {
    setManagerNote(value);
    setCloseApprovalId("");
  }

  async function loadRegister(nextTerminalId = terminalId, nextBranchId = branchId) {
    setStatus("Syncing register...");

    if (!nextBranchId || !nextTerminalId) {
      setShift(null);
      setPayments([]);
      setMovements([]);
      setStatus("Select a branch and terminal to load register");
      return;
    }

    try {
      const response = await fetchCurrentRegister(nextBranchId, nextTerminalId);
      setShift(response.shift);
      setPayments(response.payments);
      setMovements(response.movements);
      setCountedCash(response.shift?.expectedCash ?? openingBalance);
      setStatus(response.shift ? "Register synced" : "No open shift for this terminal");
    } catch (error) {
      setShift(null);
      setPayments([]);
      setMovements([]);
      setStatus(error instanceof Error ? error.message : "Unable to sync register");
    }
  }

  useEffect(() => {
    void loadTerminals(branchId, terminalId);
  }, []);

  async function loadTerminals(nextBranchId = branchId, preferredTerminalId = terminalId) {
    try {
      const response = await fetchBranchOptions();
      setBranches(response.branches);
      setTerminals(response.terminals);

      if (!nextBranchId) {
        setTerminalId("");
        setShift(null);
        setPayments([]);
        setMovements([]);
        setStatus("Select a branch to load terminals");
        return;
      }

      const branchTerminalList = response.terminals.filter((terminal) => terminal.branchId === nextBranchId);
      const defaultTerminal =
        branchTerminalList.find((terminal) => terminal.id === preferredTerminalId && terminal.status === "online") ??
        branchTerminalList.find((terminal) => terminal.status === "online") ??
        branchTerminalList[0];

      if (defaultTerminal) {
        setTerminalId(defaultTerminal.id);
        await loadRegister(defaultTerminal.id, nextBranchId);
      } else {
        setTerminalId("");
        setShift(null);
        setPayments([]);
        setMovements([]);
        setStatus("No terminals found for this branch");
      }
    } catch (error) {
      setBranches(fallbackBranches);
      setStatus(error instanceof Error ? error.message : "Unable to load terminals");
    }
  }

  function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setShift(null);
    setPayments([]);
    setMovements([]);
    setMovementApprovalId("");
    setCloseApprovalId("");
    void loadTerminals(nextBranchId, "");
  }

  useEffect(() => {
    if (!approvalHandoff || approvalHandoff.entityType !== "registerShift" || approvalHandoff.status !== "approved" || handledApprovalIdRef.current === approvalHandoff.id) {
      return;
    }

    if (!shift) {
      setStatus(`Waiting for register shift ${approvalHandoff.entityId}`);
      return;
    }

    if (approvalHandoff.entityId !== shift.id) {
      setStatus(`Approval ${approvalHandoff.id} belongs to ${approvalHandoff.entityId}`);
      return;
    }

    handledApprovalIdRef.current = approvalHandoff.id;

    if (approvalHandoff.type === "cash_movement") {
      setMovementApprovalId(approvalHandoff.id);
      setMovement((current) => ({
        ...current,
        amount: approvalHandoff.amount || current.amount,
        reason: approvalHandoff.reason
      }));
      setStatus(`Cash movement approval ready: ${approvalHandoff.id}`);
    }

    if (approvalHandoff.type === "register_close") {
      setCloseApprovalId(approvalHandoff.id);
      setManagerNote(approvalHandoff.reason);
      setStatus(`Register close approval ready: ${approvalHandoff.id}`);
    }
    onApprovalHandoffConsumed?.();
  }, [approvalHandoff?.id, shift?.id]);

  async function submitOpenShift(event: FormEvent) {
    event.preventDefault();

    if (!terminalId) {
      setStatus("Select a terminal");
      return;
    }

    if (!branchId) {
      setStatus("Select a branch");
      return;
    }

    if (!selectedTerminal) {
      setStatus("Selected terminal was not found");
      return;
    }

    if (selectedTerminal.status !== "online") {
      setStatus("Register can only open on an online terminal");
      return;
    }

    setStatus("Opening register...");

    try {
      const response = await openRegisterShift({ branchId, terminalId, openingBalance }, activeUserId);
      setShift(response.shift);
      setPayments([]);
      setMovements([]);
      setCountedCash(response.shift.expectedCash);
      setStatus("Register opened");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to open register");
    }
  }

  async function submitMovement(event: FormEvent) {
    event.preventDefault();

    if (!shift) {
      setStatus("Open a register before recording cash movement");
      return;
    }

    if (!branchId) {
      setStatus("Select a branch before recording cash movement");
      return;
    }

    if (!movement.type) {
      setStatus("Select a movement type");
      return;
    }

    if (!movement.amount || movement.amount <= 0) {
      setStatus("Enter a cash movement amount");
      return;
    }

    if (!movement.reason.trim()) {
      setStatus("Enter a cash movement reason");
      return;
    }

    if (!movementApprovalId.trim()) {
      setStatus("Requesting movement approval...");

      try {
        const response = await createApproval({
          branchId,
          type: "cash_movement",
          entityType: "registerShift",
          entityId: shift.id,
          amount: movement.amount,
          reason: `${movement.type.replace("_", " ")}: ${movement.reason}`
        });
        setMovementApprovalId(response.approval.id);
        setStatus(`Approval requested: ${response.approval.id}. Approve it, then apply movement.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to request movement approval");
      }
      return;
    }

    setStatus("Applying approved cash movement...");

    try {
      const approvalResponse = await applyApproval(
        movementApprovalId.trim(),
        "registerShift",
        shift.id,
        "cash_movement",
        movement.amount,
        movement.reason,
        activeUserId,
        branchId
      );
      const response = await createCashMovement({ ...movement, shiftId: shift.id, approvalId: approvalResponse.approval.id }, branchId, activeUserId);
      setShift(response.shift);
      setMovements((current) => [response.movement, ...current]);
      setCountedCash(response.shift.expectedCash);
      setMovement(defaultMovement);
      setMovementApprovalId("");
      setStatus(`Cash movement recorded with ${approvalResponse.approval.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to record movement");
    }
  }

  async function submitCloseShift(event: FormEvent) {
    event.preventDefault();

    if (!shift) {
      setStatus("No open register to close");
      return;
    }

    if (!branchId) {
      setStatus("Select a branch before closing register");
      return;
    }

    if (pendingNonCashPayments.length > 0) {
      setStatus("Reconcile pending non-cash payments before closing");
      return;
    }

    if ((!canCloseRegister || applyManagerApproval("register-close", Math.abs(variance))) && !closeApprovalId.trim()) {
      setStatus("Requesting close approval...");

      try {
        const response = await createApproval({
          branchId,
          type: "register_close",
          entityType: "registerShift",
          entityId: shift.id,
        amount: Math.abs(variance),
        reason: managerNote || `Close shift with variance ${displayMoney(variance)}`
      });
        setCloseApprovalId(response.approval.id);
        setStatus(`Close approval requested: ${response.approval.id}. Approve it, then apply close.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to request close approval");
      }
      return;
    }

    if (!canCloseRegister) {
      setStatus("Your role can request close approval, but cannot close the register");
      return;
    }

    setStatus("Closing register...");

    try {
      if (closeApprovalId.trim()) {
        const approvalResponse = await applyApproval(
          closeApprovalId.trim(),
          "registerShift",
          shift.id,
          "register_close",
          Math.abs(variance),
          managerNote || `Closed with variance ${displayMoney(variance)}`,
          activeUserId,
          branchId
        );
        await closeRegisterShift(
          { shiftId: shift.id, countedCash, managerNote: managerNote || undefined, approvalId: approvalResponse.approval.id },
          branchId,
          activeUserId
        );
      } else {
        await closeRegisterShift({ shiftId: shift.id, countedCash, managerNote: managerNote || undefined }, branchId, activeUserId);
      }
      setShift(null);
      setPayments([]);
      setMovements([]);
      setManagerNote("");
      setCloseApprovalId("");
      setStatus("Register closed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to close register");
    }
  }

  async function matchPayment(payment: PaymentRecord) {
    if (!branchId) {
      setStatus("Select a branch before reconciling payments");
      return;
    }

    setStatus(`Reconciling ${payment.method.replace("_", " ")} payment...`);

    try {
      const response = await reconcilePayment(payment.id, "Matched with processor settlement", branchId, activeUserId);
      setPayments((current) => current.map((item) => (item.id === response.payment.id ? response.payment : item)));
      setStatus(`Payment matched: ${payment.saleId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reconcile payment");
    }
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Cash drawer and reconciliation</p>
          <h1>Register control</h1>
        </div>
        <div className="button-group">
          <label className="toolbar-select">
            Branch
            <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button" onClick={() => loadRegister()}><RefreshCcw size={18} /> Sync</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card stat-card-dark">
          <div className="stat-card-top"><span>Expected cash</span><WalletCards size={20} /></div>
          <strong>{shift ? displayMoney(shift.expectedCash) : displayMoney(0)}</strong>
          <small>{status}</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Cash sales</span><Banknote size={20} /></div>
          <strong>{displayMoney(cashPayments)}</strong>
          <small>{payments.length} payment records</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Non-cash payments</span></div>
          <strong>{displayMoney(nonCashPayments)}</strong>
          <small>{pendingNonCashPayments.length} pending reconciliation</small>
        </article>
        <article className="stat-card">
          <div className="stat-card-top"><span>Cash movement net</span></div>
          <strong>{displayMoney(movementTotal)}</strong>
          <small>{movements.length} drawer movements</small>
        </article>
      </section>

      <div className="register-workflow">
        <section className="panel register-form-panel">
          <div className="panel-header">
            <h2>{shift ? "Open shift" : "Open register"}</h2>
            <StatusBadge label={shift ? "Open" : "Closed"} tone={shift ? "success" : "warning"} />
          </div>
          <form className="register-form" onSubmit={submitOpenShift}>
            <label>
              Terminal
              <select value={terminalId} onChange={(event) => {
                setTerminalId(event.target.value);
                if (event.target.value) void loadRegister(event.target.value, branchId);
              }} required>
                <option value="">Terminal</option>
                {branchTerminals.map((terminal) => (
                  <option key={terminal.id} value={terminal.id} disabled={terminal.status !== "online"}>
                    {terminal.name} - {terminal.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Opening cash
              <input type="number" min={0} value={openingBalance} onChange={(event) => setOpeningBalance(Number(event.target.value))} required />
            </label>
            <div className="form-summary">
              <span>{shift ? `Opened ${new Date(shift.openedAt).toLocaleString()}` : "Ready to start a new drawer"}</span>
              <b>{shift ? shift.cashierId : selectedTerminal?.deviceCode ?? terminalId}</b>
            </div>
            <button className="primary-button wide-field" disabled={Boolean(shift)} type="submit"><Plus size={18} /> Open shift</button>
          </form>

          <form className="register-form register-section" onSubmit={submitMovement}>
            <div className="panel-header wide-field">
              <h2>Cash movement</h2>
              <span>Paid in/out</span>
            </div>
            <label>
              Type
              <select value={movement.type} onChange={(event) => updateMovementForm("type", event.target.value as CashMovement["type"])}>
                <option value="" disabled>Type</option>
                <option value="cash_in">Cash in</option>
                <option value="cash_out">Cash out</option>
                <option value="paid_in">Paid in</option>
                <option value="paid_out">Paid out</option>
              </select>
            </label>
            <label>
              Amount
              <input type="number" min={1} value={movement.amount} onChange={(event) => updateMovementForm("amount", Number(event.target.value))} required />
            </label>
            <label className="wide-field">
              Reason
              <input value={movement.reason} onChange={(event) => updateMovementForm("reason", event.target.value)} required />
            </label>
            <label className="wide-field">
              Approved request ID
              <input value={movementApprovalId} onChange={(event) => setMovementApprovalId(event.target.value)} placeholder="Leave blank to request manager approval" />
            </label>
            <div className="approval-warning wide-field">
              <span>{movement.type.replace("_", " ")} requires approval</span>
              <strong>{displayMoney(movement.amount)}</strong>
              <small>{movementApprovalId.trim() ? "Approved movement will be recorded" : "Manager approval request will be created"}</small>
            </div>
            <button className="secondary-button wide-field" disabled={!shift} type="submit"><Check size={18} /> {movementApprovalId.trim() ? "Apply movement" : "Request approval"}</button>
          </form>

          <form className="register-form register-section" onSubmit={submitCloseShift}>
            <div className="panel-header wide-field">
              <h2>Close shift</h2>
              <span>{shift ? `Variance ${displayMoney(variance)}` : "No open shift"}</span>
            </div>
            <label>
              Counted cash
              <input type="number" min={0} value={countedCash} onChange={(event) => updateCountedCash(Number(event.target.value))} required />
            </label>
            <label>
              Variance
              <input value={displayMoney(variance)} readOnly />
            </label>
            <label className="wide-field">
              Manager note
              <input value={managerNote} onChange={(event) => updateManagerNote(event.target.value)} placeholder="Optional reconciliation note" />
            </label>
            {canCloseRegister ? (
              <label className="wide-field">
                Approved request ID
                <input value={closeApprovalId} onChange={(event) => setCloseApprovalId(event.target.value)} placeholder="Leave blank to request manager approval" />
              </label>
            ) : null}
            <div className="approval-warning wide-field">
              <span>{pendingNonCashPayments.length > 0 ? "Reconciliation required" : canCloseRegister ? "Register close control" : "Manager close approval required"}</span>
              <strong>{pendingNonCashPayments.length > 0 ? `${pendingNonCashPayments.length} pending` : displayMoney(Math.abs(variance))}</strong>
              <small>{pendingNonCashPayments.length > 0 ? "Match card, bank transfer, and mobile money payments first" : closeApprovalId.trim() && canCloseRegister ? "Approved close will lock the drawer" : "Manager approval request will be created"}</small>
            </div>
            <button className="danger-button wide-field" disabled={!shift || pendingNonCashPayments.length > 0 || (closeApprovalId.trim().length > 0 && !canCloseRegister)} type="submit">
              <LockKeyhole size={18} /> {closeShiftButtonLabel()}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Payment reconciliation</h2>
            <span>{payments.length} payments</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Sale</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {paymentsPage.pageRows.length === 0 ? (
                  <tr><td colSpan={7}>No payments recorded for this shift.</td></tr>
                ) : (
                  paymentsPage.pageRows.map((payment, index) => (
                    <tr key={payment.id}>
                      <td className="number-cell">{paymentsPage.startIndex + index + 1}</td>
                      <td>{payment.saleId}</td>
                      <td>{payment.method.replace("_", " ")}</td>
                      <td>{displayMoney(payment.amount)}</td>
                      <td>{payment.reference ?? "None"}</td>
                      <td><StatusBadge label={payment.reconciliationStatus} tone={payment.reconciliationStatus === "matched" ? "success" : "warning"} /></td>
                      <td>
                        <button
                          className="table-action-button"
                          disabled={payment.method === "cash" || payment.reconciliationStatus === "matched"}
                          onClick={() => matchPayment(payment)}
                        >
                          <Check size={14} /> Match
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={paymentsPage.page}
            pageCount={paymentsPage.pageCount}
            pageSize={paymentsPage.pageSize}
            totalRows={paymentsPage.totalRows}
            startIndex={paymentsPage.startIndex}
            visibleCount={paymentsPage.pageRows.length}
            onPageChange={paymentsPage.setPage}
            onPageSizeChange={paymentsPage.setPageSize}
          />

          <div className="panel-header register-history-header">
            <h2>Drawer movements</h2>
            <span>{movements.length} records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Created</th><th>Type</th><th>Reason</th><th>Amount</th><th>Expected after</th><th>Created by</th></tr></thead>
              <tbody>
                {movementsPage.pageRows.length === 0 ? (
                  <tr><td colSpan={7}>No cash movement recorded.</td></tr>
                ) : (
                  movementsPage.pageRows.map((item, index) => (
                    <tr key={item.id}>
                      <td className="number-cell">{movementsPage.startIndex + index + 1}</td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                      <td><StatusBadge label={item.type.replace("_", " ")} tone={movementSign(item.type) === "+" ? "success" : "warning"} /></td>
                      <td>{item.reason}</td>
                      <td><strong>{movementSign(item.type)}{displayMoney(item.amount)}</strong></td>
                      <td>{typeof item.expectedCashAfter === "number" ? displayMoney(item.expectedCashAfter) : "Not captured"}</td>
                      <td>{item.createdBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={movementsPage.page}
            pageCount={movementsPage.pageCount}
            pageSize={movementsPage.pageSize}
            totalRows={movementsPage.totalRows}
            startIndex={movementsPage.startIndex}
            visibleCount={movementsPage.pageRows.length}
            onPageChange={movementsPage.setPage}
            onPageSizeChange={movementsPage.setPageSize}
          />
        </section>
      </div>

      <section className="panel register-timeline">
        <Clock3 size={18} />
        <span>{shift ? `${shift.id} is open on ${shift.terminalId}` : "No active drawer. POS payments are blocked until a register is opened."}</span>
        <div className="hardware-status hardware-status-inline">
          <div className={`hardware-status-row ${drawerReady ? "" : "off"}`}>
            <Banknote size={15} />
            <span>{drawerReady ? "Cash drawer connected" : "Manual cash handling"}</span>
          </div>
          <div className={`hardware-status-row ${printerReady ? "" : "off"}`}>
            <Printer size={15} />
            <span>{printerReady ? hardware?.printer : "No receipt printer"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
