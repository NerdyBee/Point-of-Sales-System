import { Banknote, Check, Clock3, LockKeyhole, Plus, Printer, RefreshCcw, Search, WalletCards, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyApproval,
  closeRegisterShift,
  createApproval,
  createCashMovement,
  fetchBranchOptions,
  fetchCurrentRegister,
  fetchRegisterShiftHistory,
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

function paymentNeedsExternalReconciliation(method: PaymentRecord["method"]) {
  return method === "card" || method === "bank_transfer" || method === "mobile_money";
}

interface RegisterViewProps {
  approvalHandoff?: ApprovalRequest | null;
  onApprovalHandoffConsumed?: () => void;
}

export function RegisterView({ approvalHandoff, onApprovalHandoffConsumed }: RegisterViewProps) {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeUserId = storedAuth?.staff.id ?? "";
  const activePermissions = storedAuth?.staff.permissions ?? [];
  const canUseAllBranches = storedAuth?.staff.role === "owner" || storedAuth?.staff.role === "state_manager";
  const canCloseRegister = activePermissions.includes("register.close");
  const initialBranchId = canUseAllBranches ? "" : storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const initialTerminalId = canUseAllBranches ? "" : storedAuth?.session.terminalId ?? "";
  const [branchId, setBranchId] = useState(initialBranchId);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const [terminalId, setTerminalId] = useState(initialTerminalId);
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [shift, setShift] = useState<RegisterShift | null>(null);
  const [shiftHistory, setShiftHistory] = useState<RegisterShift[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [movement, setMovement] = useState(defaultMovement);
  const [movementApprovalId, setMovementApprovalId] = useState("");
  const [countedCash, setCountedCash] = useState(0);
  const [managerNote, setManagerNote] = useState("");
  const [closeApprovalId, setCloseApprovalId] = useState("");
  const [paymentQuery, setPaymentQuery] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentRecord["reconciliationStatus"] | "">("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentRecord["method"] | "">("");
  const [movementQuery, setMovementQuery] = useState("");
  const [movementTypeFilter, setMovementTypeFilter] = useState<CashMovement["type"] | "">("");
  const [historyTerminalFilter, setHistoryTerminalFilter] = useState("");
  const [shiftStatusFilter, setShiftStatusFilter] = useState<RegisterShift["status"] | "">("");
  const [status, setStatus] = useState("Ready");
  const { settings, displayMoney } = useTenantSettings();
  const handledApprovalIdRef = useRef<string | null>(null);

  const cashPayments = useMemo(() => payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0), [payments]);
  const nonCashPayments = useMemo(() => payments.filter((payment) => payment.method !== "cash").reduce((sum, payment) => sum + payment.amount, 0), [payments]);
  const pendingNonCashPayments = useMemo(
    () => payments.filter((payment) => paymentNeedsExternalReconciliation(payment.method) && payment.reconciliationStatus === "pending"),
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
  const historyTerminalOptions = useMemo(() => branchId ? branchTerminals : terminals, [branchId, branchTerminals, terminals]);
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === branchId) ?? null, [branchId, branches]);
  const branchNameById = useMemo(() => new Map(branches.map((branch) => [branch.id, `${branch.name} - ${branch.city}`])), [branches]);
  const branchLocked = Boolean(branchId && branches.length === 1);
  const selectedTerminal = useMemo(() => terminals.find((terminal) => terminal.id === terminalId), [terminalId, terminals]);
  const allBranchHistoryMode = canUseAllBranches && !branchId;
  const filteredPayments = useMemo(() => {
    const query = paymentQuery.trim().toLowerCase();
    return payments
      .filter((payment) => !paymentStatusFilter || payment.reconciliationStatus === paymentStatusFilter)
      .filter((payment) => !paymentMethodFilter || payment.method === paymentMethodFilter)
      .filter((payment) => {
        if (!query) return true;
        return [payment.saleId, payment.method, payment.reference ?? "", payment.reconciliationStatus].some((value) => value.toLowerCase().includes(query));
      });
  }, [paymentMethodFilter, paymentQuery, paymentStatusFilter, payments]);
  const filteredMovements = useMemo(() => {
    const query = movementQuery.trim().toLowerCase();
    return movements
      .filter((item) => !movementTypeFilter || item.type === movementTypeFilter)
      .filter((item) => {
        if (!query) return true;
        return [item.type, item.reason, item.createdBy].some((value) => value.toLowerCase().includes(query));
      });
  }, [movementQuery, movementTypeFilter, movements]);
  const filteredShiftHistory = useMemo(
    () => shiftHistory.filter((item) => !shiftStatusFilter || item.status === shiftStatusFilter),
    [shiftHistory, shiftStatusFilter]
  );
  const paymentsPage = usePaginatedRows(filteredPayments, 10);
  const movementsPage = usePaginatedRows(filteredMovements, 10);
  const shiftsPage = usePaginatedRows(filteredShiftHistory, 10);

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

  function clearPaymentFilters() {
    setPaymentQuery("");
    setPaymentMethodFilter("");
    setPaymentStatusFilter("");
  }

  function clearMovementFilters() {
    setMovementQuery("");
    setMovementTypeFilter("");
  }

  async function loadShiftHistory(nextBranchId = branchId, nextHistoryTerminalId = historyTerminalFilter) {
    if (!nextBranchId && !canUseAllBranches) {
      setShiftHistory([]);
      return;
    }

    const historyResponse = await fetchRegisterShiftHistory(nextBranchId, nextHistoryTerminalId);
    setShiftHistory(historyResponse.shifts);
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
      const [response] = await Promise.all([
        fetchCurrentRegister(nextBranchId, nextTerminalId),
        loadShiftHistory(nextBranchId)
      ]);
      setShift(response.shift);
      setPayments(response.payments);
      setMovements(response.movements);
      setCountedCash(response.shift?.expectedCash ?? openingBalance);
      setStatus(response.shift ? "Register synced" : "No open shift for this terminal");
    } catch (error) {
      setShift(null);
      setPayments([]);
      setMovements([]);
      setShiftHistory([]);
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
      const effectiveBranchId = nextBranchId || (canUseAllBranches ? "" : response.branches[0]?.id || "");

      if (!effectiveBranchId && !canUseAllBranches) {
        setTerminalId("");
        setShift(null);
        setPayments([]);
        setMovements([]);
        setStatus("Select a branch to load terminals");
        return;
      }

      if (effectiveBranchId !== branchId) {
        setBranchId(effectiveBranchId);
      }

      if (!effectiveBranchId) {
        setTerminalId("");
        setShift(null);
        setPayments([]);
        setMovements([]);
        await loadShiftHistory("", historyTerminalFilter);
        setStatus("Shift history synced across accessible branches");
        return;
      }

      const branchTerminalList = response.terminals.filter((terminal) => terminal.branchId === effectiveBranchId);
      const defaultTerminal =
        branchTerminalList.find((terminal) => terminal.id === preferredTerminalId && terminal.status === "online") ??
        branchTerminalList.find((terminal) => terminal.status === "online") ??
        branchTerminalList[0];

      if (defaultTerminal) {
        setTerminalId(defaultTerminal.id);
        await loadRegister(defaultTerminal.id, effectiveBranchId);
      } else {
        setTerminalId("");
        setShift(null);
        setPayments([]);
        setMovements([]);
        await loadShiftHistory(effectiveBranchId, historyTerminalFilter);
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
    setShiftHistory([]);
    setHistoryTerminalFilter("");
    setMovementApprovalId("");
    setCloseApprovalId("");
    void loadTerminals(nextBranchId, "");
  }

  function changeHistoryTerminal(nextTerminalId: string) {
    setHistoryTerminalFilter(nextTerminalId);
    void loadShiftHistory(branchId, nextTerminalId);
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
      await loadShiftHistory(branchId, historyTerminalFilter);
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

    const shiftBranchId = shift.branchId || branchId;

    if (!shiftBranchId) {
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
          branchId: shiftBranchId,
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
        shiftBranchId
      );
      const response = await createCashMovement({ ...movement, shiftId: shift.id, approvalId: approvalResponse.approval.id }, shiftBranchId, activeUserId);
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

    const shiftBranchId = shift.branchId || branchId;

    if (!shiftBranchId) {
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
          branchId: shiftBranchId,
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
          shiftBranchId
        );
        await closeRegisterShift(
          { shiftId: shift.id, countedCash, managerNote: managerNote || undefined, approvalId: approvalResponse.approval.id },
          shiftBranchId,
          activeUserId
        );
      } else {
        await closeRegisterShift({ shiftId: shift.id, countedCash, managerNote: managerNote || undefined }, shiftBranchId, activeUserId);
      }
      setShift(null);
      await loadShiftHistory(branchId || shiftBranchId, historyTerminalFilter);
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
    const paymentBranchId = payment.branchId || shift?.branchId || branchId;

    if (!paymentBranchId) {
      setStatus("Select a branch before reconciling payments");
      return;
    }

    setStatus(`Reconciling ${payment.method.replace("_", " ")} payment...`);

    try {
      const response = await reconcilePayment(payment.id, "Matched with processor settlement", paymentBranchId, activeUserId);
      setPayments((current) => current.map((item) => (item.id === response.payment.id ? response.payment : item)));
      setStatus(`Payment matched: ${payment.saleId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reconcile payment");
    }
  }

  async function matchPendingPayments() {
    const unresolvedPayment = pendingNonCashPayments.find((payment) => !(payment.branchId || shift?.branchId || branchId));

    if (unresolvedPayment) {
      setStatus("Select a branch before reconciling payments");
      return;
    }

    if (pendingNonCashPayments.length === 0) {
      setStatus("No pending non-cash payments to match");
      return;
    }

    setStatus(`Reconciling ${pendingNonCashPayments.length} pending payments...`);

    try {
      const responses = await Promise.all(
        pendingNonCashPayments.map((payment) =>
          reconcilePayment(payment.id, "Matched in batch settlement", payment.branchId || shift?.branchId || branchId, activeUserId)
        )
      );
      const matchedPayments = new Map(responses.map((response) => [response.payment.id, response.payment]));
      setPayments((current) => current.map((payment) => matchedPayments.get(payment.id) ?? payment));
      setStatus(`${responses.length} payments matched`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reconcile pending payments");
      void loadRegister();
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
            {branchLocked ? (
              <span className="locked-select-value locked-select-value-compact">
                <strong>{selectedBranch?.name ?? branchId}</strong>
                <small>{selectedBranch?.city ?? "assigned"}</small>
              </span>
            ) : (
              <select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                <option value="">{canUseAllBranches ? "All accessible branches" : "Branch"}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name} - {branch.city}</option>
                ))}
              </select>
            )}
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
        <section className={`panel register-form-panel ${allBranchHistoryMode ? "register-history-mode" : ""}`}>
          <div className="panel-header">
            <h2>{allBranchHistoryMode ? "Shift overview" : shift ? "Active shift" : "Open register"}</h2>
            <StatusBadge label={allBranchHistoryMode ? "History" : shift ? "Open" : "Closed"} tone={allBranchHistoryMode ? "info" : shift ? "success" : "warning"} />
          </div>
          <form className="register-form" onSubmit={submitOpenShift}>
            <label>
              Terminal
              <select value={terminalId} onChange={(event) => {
                setTerminalId(event.target.value);
                if (event.target.value) void loadRegister(event.target.value, branchId);
              }} disabled={allBranchHistoryMode} required>
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
              <input type="number" min={0} value={openingBalance} onChange={(event) => setOpeningBalance(Number(event.target.value))} disabled={allBranchHistoryMode} required />
            </label>
            <div className="form-summary">
              <span>{allBranchHistoryMode ? `${shiftHistory.length} shifts across accessible branches` : shift ? `Opened ${new Date(shift.openedAt).toLocaleString()}` : "Ready to start a new drawer"}</span>
              <b>{shift ? shift.cashierId : selectedTerminal?.deviceCode ?? terminalId}</b>
            </div>
            <button className="primary-button wide-field" disabled={allBranchHistoryMode || Boolean(shift)} type="submit"><Plus size={18} /> Open shift</button>
          </form>

          <form className="register-form register-section" onSubmit={submitMovement}>
            <div className="panel-header wide-field">
              <h2>Cash movement</h2>
              <span>Paid in/out</span>
            </div>
            <label>
              Type
              <select value={movement.type} onChange={(event) => updateMovementForm("type", event.target.value as CashMovement["type"])}>
                <option value="">Type</option>
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
            <button className="secondary-button wide-field" disabled={allBranchHistoryMode || !shift} type="submit"><Check size={18} /> {movementApprovalId.trim() ? "Apply movement" : "Request approval"}</button>
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
            <button className="danger-button wide-field" disabled={allBranchHistoryMode || !shift || pendingNonCashPayments.length > 0 || (closeApprovalId.trim().length > 0 && !canCloseRegister)} type="submit">
              <LockKeyhole size={18} /> {closeShiftButtonLabel()}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Payment reconciliation</h2>
            <div className="button-group">
              <span>{filteredPayments.length} of {payments.length} payments</span>
              <button className="secondary-button" disabled={pendingNonCashPayments.length === 0} onClick={matchPendingPayments}>
                <Check size={16} /> Match pending
              </button>
            </div>
          </div>
          <div className="table-toolbar register-payment-toolbar">
            <div className="search-box compact-search">
              <Search size={16} />
              <input value={paymentQuery} onChange={(event) => setPaymentQuery(event.target.value)} placeholder="Search sale, method or reference" />
              {paymentQuery ? (
                <button type="button" onClick={() => setPaymentQuery("")} aria-label="Clear payment search"><X size={14} /></button>
              ) : null}
            </div>
            <select value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value as PaymentRecord["method"] | "")}>
              <option value="">Payment method</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_money">Mobile money</option>
              <option value="customer_credit">Customer credit</option>
              <option value="voucher">Voucher</option>
            </select>
            <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value as PaymentRecord["reconciliationStatus"] | "")}>
              <option value="">Reconciliation status</option>
              <option value="pending">Pending</option>
              <option value="matched">Matched</option>
            </select>
            {(paymentQuery || paymentMethodFilter || paymentStatusFilter) ? (
              <button className="secondary-button" type="button" onClick={clearPaymentFilters}>Clear filters</button>
            ) : null}
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
                          disabled={!paymentNeedsExternalReconciliation(payment.method) || payment.reconciliationStatus === "matched"}
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
            <span>{filteredMovements.length} of {movements.length} records</span>
          </div>
          <div className="table-toolbar register-movement-toolbar">
            <div className="search-box compact-search">
              <Search size={16} />
              <input value={movementQuery} onChange={(event) => setMovementQuery(event.target.value)} placeholder="Search movement reason or user" />
              {movementQuery ? (
                <button type="button" onClick={() => setMovementQuery("")} aria-label="Clear movement search"><X size={14} /></button>
              ) : null}
            </div>
            <select value={movementTypeFilter} onChange={(event) => setMovementTypeFilter(event.target.value as CashMovement["type"] | "")}>
              <option value="">Movement type</option>
              <option value="cash_in">Cash in</option>
              <option value="cash_out">Cash out</option>
              <option value="paid_in">Paid in</option>
              <option value="paid_out">Paid out</option>
            </select>
            {(movementQuery || movementTypeFilter) ? (
              <button className="secondary-button" type="button" onClick={clearMovementFilters}>Clear filters</button>
            ) : null}
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

      <section className="panel">
        <div className="panel-header">
          <h2>Shift history</h2>
          <div className="button-group">
            <span>{filteredShiftHistory.length} of {shiftHistory.length} shifts</span>
            <select value={historyTerminalFilter} onChange={(event) => changeHistoryTerminal(event.target.value)}>
              <option value="">All terminals</option>
              {historyTerminalOptions.map((terminal) => (
                <option key={terminal.id} value={terminal.id}>{terminal.name} - {branchNameById.get(terminal.branchId) ?? terminal.branchId}</option>
              ))}
            </select>
            <select value={shiftStatusFilter} onChange={(event) => setShiftStatusFilter(event.target.value as RegisterShift["status"] | "")}>
              <option value="">Shift status</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Shift</th><th>Branch</th><th>Terminal</th><th>Cashier</th><th>Opened</th><th>Closed</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Status</th></tr></thead>
            <tbody>
              {shiftsPage.pageRows.length === 0 ? (
                <tr><td colSpan={11}>No shift history for this branch and terminal.</td></tr>
              ) : (
                shiftsPage.pageRows.map((item, index) => (
                  <tr key={item.id}>
                    <td className="number-cell">{shiftsPage.startIndex + index + 1}</td>
                    <td>{item.id}</td>
                    <td>{branchNameById.get(item.branchId) ?? item.branchId}</td>
                    <td>{item.terminalId}</td>
                    <td>{item.cashierId}</td>
                    <td>{new Date(item.openedAt).toLocaleString()}</td>
                    <td>{item.closedAt ? new Date(item.closedAt).toLocaleString() : "Still open"}</td>
                    <td>{displayMoney(item.expectedCash)}</td>
                    <td>{typeof item.countedCash === "number" ? displayMoney(item.countedCash) : "Not counted"}</td>
                    <td>{typeof item.variance === "number" ? displayMoney(item.variance) : "Not closed"}</td>
                    <td><StatusBadge label={item.status} tone={item.status === "open" ? "success" : "info"} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={shiftsPage.page}
          pageCount={shiftsPage.pageCount}
          pageSize={shiftsPage.pageSize}
          totalRows={shiftsPage.totalRows}
          startIndex={shiftsPage.startIndex}
          visibleCount={shiftsPage.pageRows.length}
          onPageChange={shiftsPage.setPage}
          onPageSizeChange={shiftsPage.setPageSize}
        />
      </section>

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
