import { expect, test } from "@playwright/test";
import { emptyPersistedState, STORAGE_KEY } from "../src/lib/defaults";

test.beforeEach(async ({ page }) => {
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
  await expect(nav.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Planner" })).toBeHidden();

  await page.getByRole("button", { name: "Capture a task" }).click();
  const form = page.locator(".captureSheet form");
  await form.getByLabel("What is on your mind?").fill("Call Alex");
  await form.getByLabel("Notes").fill("Ask about the mockup");
  await form.getByLabel("Due date and time").fill("2026-10-15T15:30");
  await form.getByLabel("Remind me").selectOption("15");
  await form.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    return stored.tasks?.[0]?.reminder?.leadMinutes;
  }, STORAGE_KEY)).toBe(15);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), STORAGE_KEY);
  expect(stored.tasks[0].note).toBe("Ask about the mockup");
  expect(stored.tasks[0].dueAt).toBeTruthy();
  expect(stored.tasks[0].createdAt).toBeTruthy();

  await form.getByLabel("What is on your mind?").fill("Email landlord tomorrow at 4pm");
  await form.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").tasks?.length, STORAGE_KEY)).toBe(2);
  const withParsedDate = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").tasks[1], STORAGE_KEY);
  expect(withParsedDate.dueAt).toBeTruthy();
});

test("desktop navigation sits beside the content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main sections" });
  await expect(nav.getByRole("button", { name: "Planner" })).toBeVisible();
  const navBox = await nav.boundingBox();
  const contentBox = await page.locator("#main-content").boundingBox();
  expect(navBox && contentBox && navBox.x + navBox.width < contentBox.x).toBeTruthy();
});
