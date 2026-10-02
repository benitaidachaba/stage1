import { expect, test } from "@playwright/test";
import { emptyPersistedState, STORAGE_KEY } from "../src/lib/defaults";

const ACCOUNT_KEY = `${STORAGE_KEY}:account:account-ui`;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/get-session")) {
      const timestamp = new Date().toISOString();
      await route.fulfill({ json: {
        user: { id: "account-ui", email: "ui@example.invalid", name: "Test", emailVerified: true, createdAt: timestamp, updatedAt: timestamp },
        session: { id: "session-ui", token: "test-session", userId: "account-ui", expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: timestamp, updatedAt: timestamp },
      } });
    } else await route.fulfill({ json: { success: true } });
  });
  const records = new Map<string, Record<string, unknown>>();
  await page.route("**/api/sync", async (route) => {
    const body = route.request().postDataJSON() as { changes: Array<Record<string, unknown>> };
    for (const change of body.changes) {
      const key = `${change.kind}:${change.id}`;
      records.set(key, { ...change, version: Number(records.get(key)?.version ?? 0) + 1 });
    }
    await route.fulfill({ json: { accountId: "account-ui", records: [...records.values()] } });
  });
  const state = emptyPersistedState();
  state.settings.onboarded = true;
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: STORAGE_KEY,
    value: JSON.stringify(state),
  });
});

test("phone capture saves a due time, note and chosen reminder", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main sections" });
  await expect(nav.getByRole("button", { name: "Tasks" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".captureDialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Add a task" }).click();
  const form = page.locator(".captureDialog form");
  await form.getByLabel("What is on your mind?").fill("Call Alex");
  await form.getByLabel("Notes").fill("Ask about the mockup");
  await form.getByLabel("Due date and time").fill("2026-10-15T15:30");
  await form.getByLabel("Remind me").selectOption("15");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".captureDialog")).toHaveCount(0);
  await expect(page.getByText("Call Alex", { exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    return stored.tasks?.[0]?.reminder?.leadMinutes;
  }, ACCOUNT_KEY)).toBe(15);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), ACCOUNT_KEY);
  expect(stored.tasks[0].note).toBe("Ask about the mockup");
  expect(stored.tasks[0].dueAt).toBeTruthy();
  expect(stored.tasks[0].createdAt).toBeTruthy();

  await page.getByRole("button", { name: "Add a task" }).click();
  await form.getByLabel("What is on your mind?").fill("Email landlord tomorrow at 4pm");
  await form.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").tasks?.length, ACCOUNT_KEY)).toBe(2);
  const withParsedDate = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").tasks[1], ACCOUNT_KEY);
  expect(withParsedDate.dueAt).toBeTruthy();
});

test("desktop navigation sits beside the content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main sections" });
  await expect(nav.getByRole("button", { name: "Cards" })).toBeVisible();
  const navBox = await nav.boundingBox();
  const contentBox = await page.locator("#main-content").boundingBox();
  expect(navBox && contentBox && navBox.x + navBox.width < contentBox.x).toBeTruthy();
  expect(navBox && Math.abs(navBox.y + navBox.height - 800) < 2).toBeTruthy();
  await page.locator(".headerAdd").click();
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New task" })).toHaveCount(0);
  await page.getByRole("button", { name: "How to use Pocket" }).first().click();
  await expect(page.getByRole("dialog", { name: "How Pocket works" })).toBeVisible();
});

test("overdue tasks stay visible and cards move them to tomorrow or Done", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add a task" }).click();
  const form = page.locator(".captureDialog form");
  await form.getByLabel("What is on your mind?").fill("Send report");
  await form.getByLabel("Due date and time").fill("2020-01-01T09:00");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Later" })).toBeVisible();
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Main sections" });
  await nav.getByRole("button", { name: "Cards" }).click();
  await expect(page.getByRole("heading", { name: "Send report" })).toBeVisible();
  await page.locator(".decisionStackMobile").getByRole("button", { name: "Tomorrow" }).click();
  await nav.getByRole("button", { name: "Tasks" }).click();
  await expect(page.getByText("Overdue", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Later" })).toBeVisible();

  await nav.getByRole("button", { name: "Cards" }).click();
  await page.locator(".decisionStackMobile").getByRole("button", { name: "Done" }).click();
  await nav.getByRole("button", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Completed" })).toBeVisible();
});
