import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCatalogProducts, fetchPrepTickets, fetchRegisterShiftHistory, fetchRestaurantTables } from "./client";

function createStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };
}

describe("api branch headers", () => {
  beforeEach(() => {
    const localStorage = createStorageMock();
    const sessionStorage = createStorageMock();

    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage,
        sessionStorage,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true
      },
      configurable: true
    });

    window.localStorage.clear();
    window.sessionStorage.clear();

    const auth = {
      staff: {
        id: "staff-1",
        tenantId: "tenant-1",
        branchId: "branch-default",
        name: "Owner",
        email: "owner@example.com",
        phone: "",
        role: "owner",
        permissions: []
      },
      session: {
        id: "session-1",
        tenantId: "tenant-1",
        staffId: "staff-1",
        branchId: "branch-default",
        role: "owner",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      },
      accessToken: "token",
      accessTokenExpiresIn: 60,
      refreshToken: "refresh"
    };

    window.localStorage.setItem("naijapos.auth", JSON.stringify(auth));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  function mockFetch(body: unknown) {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body
    });

    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  function firstRequestHeaders(fetchSpy: ReturnType<typeof vi.fn>) {
    return fetchSpy.mock.calls[0]?.[1]?.headers as Headers | undefined;
  }

  it("does not send the stored branch header when an empty catalog branch filter is requested", async () => {
    const fetchSpy = mockFetch({ products: [] });

    await fetchCatalogProducts("");

    expect(firstRequestHeaders(fetchSpy)?.get("x-branch-id")).toBeNull();
  });

  it("does not send the stored branch header for all-branch floor, kitchen, or register history reads", async () => {
    const fetchSpy = mockFetch({ tables: [], openOrders: [], reservations: [], tickets: [], shifts: [] });

    await fetchRestaurantTables("");
    await fetchPrepTickets("");
    await fetchRegisterShiftHistory("");

    const branchHeaders = fetchSpy.mock.calls.map((call) => (call[1]?.headers as Headers | undefined)?.get("x-branch-id"));
    expect(branchHeaders).toEqual([null, null, null]);
  });

  it("sends an explicit branch header when a branch filter is requested", async () => {
    const fetchSpy = mockFetch({ tickets: [] });

    await fetchPrepTickets("branch-ikeja");

    expect(firstRequestHeaders(fetchSpy)?.get("x-branch-id")).toBe("branch-ikeja");
  });
});
