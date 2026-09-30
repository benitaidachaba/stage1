import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), sync: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getNeonAuth: mocks.auth }));
vi.mock("@/lib/neon-db", () => ({ syncRecords: mocks.sync }));

function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/sync", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ getSession: mocks.session });
  mocks.session.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  mocks.sync.mockResolvedValue([]);
});

describe("protected Neon sync endpoint", () => {
  it("denies direct signed-out requests", async () => {
    mocks.session.mockResolvedValue({ data: null, error: null });
    expect((await POST(request({ accountId: "user-a", changes: [] }))).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("never accepts another account's identity from the body", async () => {
    expect((await POST(request({ accountId: "user-b", changes: [] }))).status).toBe(409);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations", async () => {
    expect((await POST(request({ accountId: "user-a", changes: [] }, "https://attacker.example"))).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("uses the server-verified owner and prevents response caching", async () => {
    const response = await POST(request({ accountId: "user-a", changes: [] }));
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("user-a", []);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("accepts the public host when Next normalizes its internal request URL", async () => {
    const r = request({ accountId: "user-a", changes: [] }, "http://127.0.0.1:3100");
    r.headers.set("host", "127.0.0.1:3100");
    expect((await POST(r)).status).toBe(200);
  });
  it("rejects duplicate record identities and invalid timestamps", async () => {
    const change = { kind: "task", id: "tsk-a", document: { id: "tsk-a" }, expectedVersion: 0, editedAt: "2026-09-30T10:00:00.000Z" };
    expect((await POST(request({ accountId: "user-a", changes: [change, change] }))).status).toBe(400);
    expect((await POST(request({ accountId: "user-a", changes: [{ ...change, editedAt: "invalid" }] }))).status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("does not leak database error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sync.mockRejectedValue(new Error("database connection credentials"));
    const response = await POST(request({ accountId: "user-a", changes: [] }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("credentials");
    log.mockRestore();
  });
});
