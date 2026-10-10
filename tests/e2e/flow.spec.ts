import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Serious/critical axe violations on the current page (NFR-3.1). */
async function axe(page: Page) {
  // Scroll through the page so scroll-triggered reveals finish before contrast is measured.
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  await page.waitForTimeout(1500);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

async function startAsGuest(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Practice out loud");
  await page.getByTestId("start-practicing").click();
  await page.waitForURL("**/studio");
}

/** Waits for the explainer or the stage; clicks "Enable" only when it's actionable. */
async function clickEnableIfShown(page: Page) {
  const control = page.getByTestId("record-control");
  const enable = page.getByTestId("enable-media");
  await expect(control.or(enable)).toBeVisible({ timeout: 20_000 });
  if ((await enable.isVisible()) && (await enable.isEnabled())) await enable.click();
}

async function reachReady(page: Page) {
  await clickEnableIfShown(page);
  await expect(page.getByTestId("record-control")).toHaveAttribute("data-mode", "ready", { timeout: 20_000 });
}

test("landing page is accessible and explains data handling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Video stays on your device.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeAttached();
  expect(await axe(page)).toEqual([]);
});

test("record → processing → report with mocked AI", async ({ page }) => {
  await startAsGuest(page);
  await reachReady(page);
  expect(await axe(page)).toEqual([]);

  await page.getByLabel("Speech title (optional)").fill("E2E pitch");
  await page.getByTestId("audience-teen").click();
  await page.getByTestId("record-control").click();
  await expect(page.getByTestId("countdown")).toBeVisible();
  await expect(page.getByTestId("recording-badge")).toContainText("Recording", { timeout: 10_000 });
  await page.waitForTimeout(15_000);
  await page.getByTestId("record-control").click();

  await page.waitForURL("**/processing", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Analyzing your speech" })).toBeVisible();
  await expect(page.getByTestId("processing-complete")).toBeVisible({ timeout: 60_000 });
  await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 15_000 });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E pitch");
  await expect(page.getByText("Teen audience").first()).toBeVisible();
  await expect(page.getByTestId("tile-audience")).toContainText("Grade");
  await expect(page.getByRole("heading", { name: /Top 3 things to work on/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
  await expect(page.getByTestId("filler-notice")).toBeVisible();
  await expect(page.getByText(/Coached by mock\/llama/)).toBeVisible();
  await page.getByRole("button", { name: "Show data as table" }).first().click();
  expect(await axe(page)).toEqual([]);
});

test("too-short recordings stay in the studio", async ({ page }) => {
  await startAsGuest(page);
  await reachReady(page);
  await page.getByTestId("record-control").click();
  await expect(page.getByTestId("recording-badge")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_000);
  await page.getByTestId("record-control").click();
  await expect(page.getByTestId("too-short")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/studio$/);
});

test("rules fallback shows the notice and retry action", async ({ page }) => {
  await startAsGuest(page);
  await reachReady(page);
  await page.getByLabel("Speech title (optional)").fill("Fallback [mock-llm-fail]");
  await page.getByTestId("record-control").click();
  await expect(page.getByTestId("recording-badge")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(12_000);
  await page.getByTestId("record-control").click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  await expect(page.getByTestId("rules-notice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry AI coaching" })).toBeVisible();
  await expect(page.getByTestId("tile-clarity")).toContainText("Not available");
});

test("permission denied shows recovery steps", async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await startAsGuest(page);
  const recovery = page.getByTestId("permission-recovery");
  const enable = page.getByTestId("enable-media");
  await expect(recovery.or(enable)).toBeVisible({ timeout: 20_000 });
  if (await enable.isVisible()) await enable.click();
  await expect(recovery).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with microphone only" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await context.close();
});

test("sample history, audience filter, and settings validation", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("see-sample").click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Sample", { exact: true }).first()).toBeVisible();

  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Progress over time" })).toBeVisible();
  await expect(page.getByTestId("trend")).not.toHaveText("Not enough sessions yet");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("radio", { name: "Young" }).click();
  await page.waitForURL(/audience=young/);
  await expect(page.getByRole("link", { name: "Science club: why the sky is blue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "First hackathon pitch" })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByLabel("Minimum words per minute").fill("190");
  await page.getByLabel("Maximum words per minute").fill("150");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Must be greater than the minimum")).toBeVisible();
  await expect(page.getByLabel("Maximum words per minute")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Minimum words per minute").fill("120");
  await page.getByLabel("Maximum words per minute").fill("150");
  await page.getByTestId("audience-senior").click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." }).first()).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await page.goto("/studio");
  await reachReady(page);
  await expect(page.getByTestId("audience-senior")).toHaveAttribute("data-state", "checked");
});

test("reduced motion renders final states immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("delete all data returns to the landing page", async ({ page }) => {
  await startAsGuest(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Continue as a guest" })).toBeVisible();
});
