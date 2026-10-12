import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * Regenerates the README screenshots. Needs the worker running (`npm run worker`) so leads get
 * enriched and scored. Skipped unless SCREENSHOTS=1:
 *
 *   SCREENSHOTS=1 npx playwright test screenshots
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate docs/screenshots");
test.setTimeout(15 * 60_000);

const OUT = "docs/screenshots";

test("capture README screenshots", async ({ page, request }) => {
  await mkdir(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Make sure there is an ICP, then discover, enrich and score the seed dataset.
  let icps = (await (await request.get("/api/icps")).json()).items as { id: string }[];
  if (!icps.length) {
    await request.post("/api/icps", { data: { name: "Owner-operated trades, Southeast", industries: ["HVAC", "Plumbing", "Roofing"], locations: ["NC", "SC", "GA", "TN"], minEmployees: 8, maxEmployees: 80, includeKeywords: ["family-owned", "residential"], excludeKeywords: ["franchise", "venture"], signals: { ownerOperated: true, longEstablished: true, noRecentFunding: true, hiringSlowdown: false } } });
    icps = (await (await request.get("/api/icps")).json()).items;
  }
  const icpId = icps[0].id;
  await request.post("/api/discover", { data: { sourceId: "seed", icpId, enrich: true } });

  await expect
    .poll(async () => (await (await request.get("/api/jobs")).json()).active.length, { timeout: 12 * 60_000, intervals: [3000] })
    .toBe(0);

  const shot = async (name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

  await page.goto("/dashboard");
  await expect(page.getByText("Leads by tier")).toBeVisible();
  await page.waitForTimeout(1200); // chart animation
  await shot("dashboard");

  await page.goto("/icps");
  await expect(page.getByRole("heading", { name: "Ideal Customer Profiles" })).toBeVisible();
  await shot("icps");

  await page.goto("/leads");
  await expect(page.getByRole("table")).toBeVisible();
  await shot("leads");

  const firstCompany = page.locator("tbody tr").first().locator("button").first();
  await firstCompany.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(600);
  await shot("lead-drawer");
  await page.keyboard.press("Escape");

  await page.goto("/compliance");
  await expect(page.getByRole("heading", { name: "Ethics & Compliance" })).toBeVisible();
  await shot("compliance");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard");
  await page.waitForTimeout(1200);
  await shot("dashboard-dark");
});
