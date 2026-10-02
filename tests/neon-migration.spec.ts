import { test, expect } from "@playwright/test";
import { emptyPersistedState, makeTask, STORAGE_KEY } from "../src/lib/defaults";
import type { CloudRecord, RecordChange } from "../src/lib/cloud-records";

// Auth delivery is mocked: these tests exercise the real Neon browser SDK,
// the account UI, local migration, and sync scheduling without sending emails.
test.use({ viewport: { width: 375, height: 667 } });

test("email-code sign-in migrates local data once and keeps accounts isolated", async ({ page }) => {
  const state = emptyPersistedState();
  state.settings.onboarded = true;
  state.tasks = [makeTask({ id: "tsk_legacy", title: "Keep this local task" }, "2026-09-30T10:00:00.000Z")];
  await page.addInitScript(({ state, key }) => {
    if (!localStorage.getItem(`${key}:seeded`)) {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(`${key}:seeded`, "true");
    }
  }, { state, key: STORAGE_KEY });
  let signedIn: string | null = null;
  const session = () => signedIn ? {
    user: { id: signedIn === "a@example.invalid" ? "account-a" : "account-b", email: signedIn, name: "Test", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    session: { id: "session", token: "test-session", userId: signedIn === "a@example.invalid" ? "account-a" : "account-b", expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  } : null;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sign-in/email-otp")) signedIn = route.request().postDataJSON().email;
    if (path.endsWith("/sign-out")) signedIn = null;
    await route.fulfill({ json: path.endsWith("/get-session") || path.endsWith("/sign-in/email-otp") ? session() : { success: true } });
  });
  const byAccount = new Map<string, CloudRecord[]>();
  let syncCount = 0;
  await page.route("**/api/sync", async (route) => {
    syncCount++;
    const { accountId, changes } = route.request().postDataJSON() as { accountId: string; changes: RecordChange[] };
    const records = new Map((byAccount.get(accountId) ?? []).map((r) => [`${r.kind}:${r.id}`, r]));
    for (const change of changes) {
      const key = `${change.kind}:${change.id}`;
      records.set(key, { ...change, version: (records.get(key)?.version ?? 0) + 1 });
    }
    byAccount.set(accountId, [...records.values()]);
    await route.fulfill({ json: { accountId, records: [...records.values()] } });
  });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  // This APIRequestContext bypasses page.route mocks and reaches the real route.
  const signedOut = await page.request.post("/api/sync", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { accountId: "nobody", changes: [] },
  });
  expect(signedOut.status()).toBe(401);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A place for everything you need to do." })).toBeVisible();

  async function signIn(email: string) {
    await page.getByRole("link", { name: "I already have an account" }).click();
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    await page.getByLabel("Sign-in code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
  }
  await signIn("a@example.invalid");
  await expect.poll(() => byAccount.get("account-a")?.find((r) => r.kind === "task")?.id).toBe("tsk_legacy");
  await expect.poll(() => page.evaluate((key) => !!localStorage.getItem(`${key}:pre-neon-backup`), STORAGE_KEY)).toBe(true);
  await page.waitForTimeout(6500);
  expect(syncCount).toBeLessThan(4); // A completed sync must not schedule itself forever.

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "A place for everything you need to do." })).toBeVisible();
  await signIn("b@example.invalid");
  await expect.poll(() => byAccount.has("account-b")).toBe(true);
  expect(byAccount.get("account-b")?.filter((r) => r.kind === "task")).toEqual([]);
  expect(browserErrors).toEqual([]);
});
