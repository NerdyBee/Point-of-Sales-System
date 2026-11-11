import type { Platform } from "../data/db";

/**
 * Owner mode: the boss's phone reads live from the business's server (usually the cloud)
 * with the same sign-in and API as the web app, across all branches. Unlike a shop tablet
 * it keeps no copy of the shop's records and cannot sell; it needs internet.
 */
export interface OwnerStaff {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface OwnerSession {
  url: string;
  accessToken: string;
  refreshToken: string;
  staff: OwnerStaff;
}

export class OwnerError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

const sessionKey = "ajokepos.owner.session";
const timeoutMs = 20_000;

/** Permissions that make owner mode worth having: profit reports or approving requests. */
export function canUseOwnerMode(staff: Pick<OwnerStaff, "permissions">) {
  return staff.permissions.includes("reports.profit.view") || staff.permissions.includes("approval.manage");
}

/** Adds https:// to a cloud address, or http:// to a shop-network one (192.168.1.20:4000). */
export function normalizeServerUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(trimmed);
  return `${local ? "http" : "https"}://${trimmed}`;
}

export async function loadOwnerSession(platform: Platform) {
  const raw = await platform.secrets.get(sessionKey);
  return raw ? (JSON.parse(raw) as OwnerSession) : null;
}

export async function saveOwnerSession(platform: Platform, session: OwnerSession | null) {
  if (session) await platform.secrets.set(sessionKey, JSON.stringify(session));
  else await platform.secrets.remove(sessionKey);
}

async function call<T>(platform: Platform, url: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await platform.fetch(`${url}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "x-app-version": platform.appVersion, ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new OwnerError(payload.error ?? `The server answered ${response.status}`, response.status);
    return payload as T;
  } catch (cause) {
    if (cause instanceof OwnerError) throw cause;
    throw new OwnerError("Could not reach the server. Check the internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  staff: OwnerStaff;
}

/** Signs in with a staff ID (or email) and password, as on the web. */
export async function ownerSignIn(platform: Platform, serverUrl: string, identifier: string, password: string): Promise<OwnerSession> {
  const url = normalizeServerUrl(serverUrl);
  const hello = await call<{ product?: string }>(platform, url, "/sync/hello").catch(() => {
    throw new OwnerError("That address is not an Ajoke POS server. Check it with your provider.");
  });
  if (hello.product !== "naijapos") throw new OwnerError("That address is not an Ajoke POS server. Check it with your provider.");
  const auth = await call<AuthResponse>(platform, url, "/auth/login", { method: "POST", body: { identifier: identifier.trim(), password } }).catch((cause: OwnerError) => {
    throw cause.status === 401 ? new OwnerError("Wrong staff ID or password.", 401) : cause;
  });
  if (!canUseOwnerMode(auth.staff)) {
    throw new OwnerError("This account cannot see reports or approve requests. Sign in as the owner or a manager.", 403);
  }
  return { url, accessToken: auth.accessToken, refreshToken: auth.refreshToken, staff: auth.staff };
}

/** Authenticated calls for one signed-in session; refreshes the access token once on 401. */
export class OwnerApi {
  constructor(private readonly platform: Platform, private session: OwnerSession, private readonly onSession: (session: OwnerSession | null) => void) {}

  get staff() {
    return this.session.staff;
  }

  async request<T>(path: string, init: { method?: string; body?: unknown; branchId?: string } = {}): Promise<T> {
    const send = () =>
      call<T>(this.platform, this.session.url, path, {
        method: init.method,
        body: init.body,
        headers: {
          authorization: `Bearer ${this.session.accessToken}`,
          "x-tenant-id": this.session.staff.tenantId,
          ...(init.branchId ? { "x-branch-id": init.branchId } : {})
        }
      });
    try {
      return await send();
    } catch (cause) {
      if (!(cause instanceof OwnerError) || cause.status !== 401) throw cause;
      await this.refresh();
      return send();
    }
  }

  private async refresh() {
    try {
      const auth = await call<AuthResponse>(this.platform, this.session.url, "/auth/refresh", { method: "POST", body: { refreshToken: this.session.refreshToken } });
      this.session = { ...this.session, accessToken: auth.accessToken, refreshToken: auth.refreshToken, staff: auth.staff };
      await saveOwnerSession(this.platform, this.session);
      this.onSession(this.session);
    } catch {
      await saveOwnerSession(this.platform, null);
      this.onSession(null);
      throw new OwnerError("Your sign-in has expired. Sign in again.", 401);
    }
  }
}

// ----- report periods ------------------------------------------------------------------

export type OwnerPeriod = "today" | "yesterday" | "week" | "month";

export const ownerPeriods: { key: OwnerPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" }
];

/** The period as exact times from the phone's own midnight, so "today" is the boss's today. */
export function periodWindow(period: OwnerPeriod, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86_400_000;
  if (period === "yesterday") return { start: new Date(midnight.getTime() - day), end: new Date(midnight.getTime() - 1) };
  if (period === "week") {
    const sinceMonday = (midnight.getDay() + 6) % 7;
    return { start: new Date(midnight.getTime() - sinceMonday * day), end: now };
  }
  if (period === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  return { start: midnight, end: now };
}

export function reportQuery(period: OwnerPeriod, branchId: string, now = new Date()) {
  const window = periodWindow(period, now);
  const params = new URLSearchParams({ period: "all", startDate: window.start.toISOString(), endDate: window.end.toISOString() });
  if (branchId) params.set("branchId", branchId);
  return `?${params.toString()}`;
}

// ----- approvals ------------------------------------------------------------------------

export interface OwnerApproval {
  id: string;
  branchId: string;
  type: string;
  entityType: string;
  entityId: string;
  amount: number;
  reason: string;
  status: string;
  requestedBy: string;
  createdAt: string;
}

/** The counted cash in a tablet's register-close request ("Tablet count 45000..."). */
export function countedCashFromReason(reason: string) {
  const match = /^Tablet count (\d+)/.exec(reason);
  return match ? Number(match[1]) : null;
}

export async function rejectApproval(api: OwnerApi, approval: OwnerApproval, note: string) {
  return api.request(`/approvals/${approval.id}/decision`, { method: "PATCH", branchId: approval.branchId, body: { decision: "rejected", note } });
}

/**
 * Approves a request. A register close from a tablet is also carried out: the approval is
 * applied and the till closed with the cashier's count, as a manager would in the web app.
 */
export async function approveApproval(api: OwnerApi, approval: OwnerApproval, note: string) {
  await api.request(`/approvals/${approval.id}/decision`, { method: "PATCH", branchId: approval.branchId, body: { decision: "approved", note } });
  if (approval.type !== "register_close") return { closed: false };

  const countedCash = countedCashFromReason(approval.reason);
  if (countedCash === null) return { closed: false };
  await api.request(`/approvals/${approval.id}/apply`, {
    method: "POST",
    branchId: approval.branchId,
    body: { entityType: approval.entityType, entityId: approval.entityId, type: approval.type, amount: approval.amount, note }
  });
  try {
    await api.request("/registers/close", { method: "POST", branchId: approval.branchId, body: { shiftId: approval.entityId, countedCash, approvalId: approval.id, managerNote: note } });
  } catch (cause) {
    if (cause instanceof OwnerError && /reconcile/i.test(cause.message)) {
      throw new OwnerError("Approved, but the till could not close yet: card or transfer payments still need checking against the bank. Do that in the web app under Register, then close the till there.", cause.status);
    }
    throw cause;
  }
  return { closed: true };
}
