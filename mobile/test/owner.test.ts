import { describe, expect, it } from "vitest";
import { OwnerApi, OwnerError, approveApproval, countedCashFromReason, loadOwnerSession, normalizeServerUrl, ownerSignIn, periodWindow, reportQuery, type OwnerApproval, type OwnerSession } from "../src/owner/api";
import { nodePlatform } from "./nodePlatform";

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** A pretend server: answers by "METHOD path" and records every call. */
async function fakeServer(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const platform = await nodePlatform();
  const calls: Call[] = [];
  platform.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const call = { url: input, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const route = routes[`${call.method} ${url.pathname}`];
    const answer = route ? route(call) : { status: 404, body: { error: "not found" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { platform, calls };
}

const owner = { id: "GRE-DOW-MAR", tenantId: "tenant-green", branchId: "branch-1", name: "Maria Lopez", role: "owner", permissions: ["reports.profit.view", "approval.manage"] };
const hello = () => ({ body: { product: "naijapos", role: "cloud", nodeId: "cloud-1" } });

describe("owner mode", () => {
  it("signs in the owner, but not staff who cannot see reports or approve", async () => {
    const { platform } = await fakeServer({
      "GET /api/v1/sync/hello": hello,
      "POST /api/v1/auth/login": (call) =>
        (call.body as { identifier: string }).identifier === "GRE-DOW-MAR"
          ? { body: { accessToken: "a1", refreshToken: "r1", staff: owner } }
          : { body: { accessToken: "a2", refreshToken: "r2", staff: { ...owner, id: "GRE-DOW-AIS", role: "cashier", permissions: ["sale.create"] } } }
    });

    const session = await ownerSignIn(platform, "pos.greenbasket.example", " GRE-DOW-MAR ", "secret");
    expect(session).toMatchObject({ url: "https://pos.greenbasket.example", accessToken: "a1", staff: { name: "Maria Lopez" } });
    await expect(ownerSignIn(platform, "pos.greenbasket.example", "GRE-DOW-AIS", "secret")).rejects.toThrow(/owner or a manager/);
  });

  it("explains a wrong password and an address that is not Ajoke POS", async () => {
    const { platform } = await fakeServer({ "GET /api/v1/sync/hello": hello, "POST /api/v1/auth/login": () => ({ status: 401, body: { error: "Invalid credentials" } }) });
    await expect(ownerSignIn(platform, "pos.greenbasket.example", "GRE-DOW-MAR", "nope")).rejects.toThrow("Wrong staff ID or password.");

    const other = await fakeServer({ "GET /api/v1/sync/hello": () => ({ body: { hello: "world" } }) });
    await expect(ownerSignIn(other.platform, "example.com", "x", "y")).rejects.toThrow(/not an Ajoke POS server/);
  });

  it("uses http for shop-network addresses and https for the cloud", () => {
    expect(normalizeServerUrl("192.168.1.20:4000/")).toBe("http://192.168.1.20:4000");
    expect(normalizeServerUrl("pos.shop.com")).toBe("https://pos.shop.com");
    expect(normalizeServerUrl("http://pos.shop.com")).toBe("http://pos.shop.com");
  });

  it("refreshes an expired access token once and keeps the new session", async () => {
    let tokenOk = "a1";
    const { platform, calls } = await fakeServer({
      "GET /api/v1/reports/dashboard": (call) => (call.headers.authorization === `Bearer ${tokenOk}` ? { body: { summary: { totalSales: 1 } } } : { status: 401, body: { error: "expired" } }),
      "POST /api/v1/auth/refresh": () => ({ body: { accessToken: "a2", refreshToken: "r2", staff: owner } })
    });
    const session: OwnerSession = { url: "https://pos.shop.com", accessToken: "a1", refreshToken: "r1", staff: owner };
    let latest: OwnerSession | null = session;
    const api = new OwnerApi(platform, session, (next) => {
      latest = next;
    });

    tokenOk = "a2";
    await expect(api.request("/reports/dashboard")).resolves.toEqual({ summary: { totalSales: 1 } });
    expect(latest).toMatchObject({ accessToken: "a2", refreshToken: "r2" });
    expect((await loadOwnerSession(platform))?.accessToken).toBe("a2");
    expect(calls.map((call) => call.method + " " + new URL(call.url).pathname)).toEqual([
      "GET /api/v1/reports/dashboard",
      "POST /api/v1/auth/refresh",
      "GET /api/v1/reports/dashboard"
    ]);
    expect(calls[2].headers["x-tenant-id"]).toBe("tenant-green");
  });

  it("asks for sign-in again when the refresh token is no longer valid", async () => {
    const { platform } = await fakeServer({
      "GET /api/v1/reports/dashboard": () => ({ status: 401, body: { error: "expired" } }),
      "POST /api/v1/auth/refresh": () => ({ status: 401, body: { error: "revoked" } })
    });
    let latest: OwnerSession | null = { url: "https://x", accessToken: "a", refreshToken: "r", staff: owner };
    const api = new OwnerApi(platform, latest, (next) => {
      latest = next;
    });
    await expect(api.request("/reports/dashboard")).rejects.toThrow("Your sign-in has expired. Sign in again.");
    expect(latest).toBeNull();
  });

  it("measures periods from the phone's own midnight", () => {
    const now = new Date(2026, 10, 12, 15, 30); // Thursday 12 Nov 2026, 15:30 local
    expect(periodWindow("today", now).start).toEqual(new Date(2026, 10, 12));
    expect(periodWindow("yesterday", now)).toEqual({ start: new Date(2026, 10, 11), end: new Date(new Date(2026, 10, 12).getTime() - 1) });
    expect(periodWindow("week", now).start).toEqual(new Date(2026, 10, 9)); // Monday
    expect(periodWindow("month", now).start).toEqual(new Date(2026, 10, 1));
    const query = new URLSearchParams(reportQuery("today", "branch-2", now).slice(1));
    expect(query.get("branchId")).toBe("branch-2");
    expect(query.get("startDate")).toBe(new Date(2026, 10, 12).toISOString());
  });

  it("approves a tablet's register close and closes the till with the cashier's count", async () => {
    const { platform, calls } = await fakeServer({
      "PATCH /api/v1/approvals/appr-1/decision": () => ({ body: { approval: {} } }),
      "POST /api/v1/approvals/appr-1/apply": () => ({ body: { approval: {} } }),
      "POST /api/v1/registers/close": () => ({ body: { shift: {} } })
    });
    const api = new OwnerApi(platform, { url: "https://x", accessToken: "a", refreshToken: "r", staff: owner }, () => undefined);
    const approval: OwnerApproval = { id: "appr-1", branchId: "branch-2", type: "register_close", entityType: "registerShift", entityId: "shift-9", amount: 500, reason: "Tablet count 45500: short by 5", status: "pending", requestedBy: "AIS", createdAt: "" };

    await expect(approveApproval(api, approval, "Checked")).resolves.toEqual({ closed: true });
    expect(calls.map((call) => call.headers["x-branch-id"])).toEqual(["branch-2", "branch-2", "branch-2"]);
    expect(calls[0].body).toEqual({ decision: "approved", note: "Checked" });
    expect(calls[2].body).toEqual({ shiftId: "shift-9", countedCash: 45500, approvalId: "appr-1", managerNote: "Checked" });
  });

  it("says why a till could not close while card payments are unchecked", async () => {
    const { platform } = await fakeServer({
      "PATCH /api/v1/approvals/appr-1/decision": () => ({ body: {} }),
      "POST /api/v1/approvals/appr-1/apply": () => ({ body: {} }),
      "POST /api/v1/registers/close": () => ({ status: 409, body: { error: "Reconcile pending non-cash payments before closing this register" } })
    });
    const api = new OwnerApi(platform, { url: "https://x", accessToken: "a", refreshToken: "r", staff: owner }, () => undefined);
    const approval: OwnerApproval = { id: "appr-1", branchId: "b", type: "register_close", entityType: "registerShift", entityId: "s", amount: 0, reason: "Tablet count 100", status: "pending", requestedBy: "x", createdAt: "" };
    await expect(approveApproval(api, approval, "ok")).rejects.toThrow(/checking against the bank/);
  });

  it("reads the cashier's count only from tablet close requests", () => {
    expect(countedCashFromReason("Tablet count 45500: short")).toBe(45500);
    expect(countedCashFromReason("Loyal customer discount")).toBeNull();
    expect(new OwnerError("x", 409).status).toBe(409);
  });
});
