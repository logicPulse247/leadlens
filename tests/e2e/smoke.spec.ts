import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * One end-to-end pass over the core promise of the product: import a company, find it in the
 * workspace, export it, and prove an opt-out is enforced at export time.
 */
test("import → find → export, with an opt-out enforced", async ({ page, request }) => {
  const run = Date.now().toString(36);
  const company = `Smoke Test Plumbing ${run}`;
  const domain = `smoke-${run}.example`;

  // The app shell and dashboard render.
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  // Import by pasting a list.
  await page.getByRole("link", { name: "Import & Discover" }).first().click();
  await page.getByLabel("Or paste a list (one company per line)").fill(`${company}, ${domain}`);
  await page.getByRole("button", { name: "Import companies" }).click();
  await expect(page.getByText("Import complete")).toBeVisible();
  await expect(page.getByText("New leads")).toBeVisible();

  // Find it in the leads table.
  await page.getByRole("link", { name: "View leads" }).click();
  await page.getByLabel("Search leads").fill(company);
  const row = page.getByRole("row", { name: new RegExp(company) });
  await expect(row).toBeVisible();

  // Export the selected lead as CSV.
  await page.getByLabel(`Select ${company}`).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export selected CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^leadlens-leads-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Company name");
  expect(csv).toContain(company);

  // Opt the domain out on the compliance page.
  await page.getByRole("link", { name: "Ethics & Compliance" }).first().click();
  await page.getByLabel("Domains or emails").fill(domain);
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("cell", { name: domain, exact: true })).toBeVisible();

  // The same export now leaves the company out (checked through the API the button uses).
  const id = (await (await request.get(`/api/leads?q=${encodeURIComponent(domain)}`)).json()).items[0].id as string;
  const blocked = await request.post("/api/export", { data: { format: "csv", ids: [id] } });
  expect(blocked.status()).toBe(200);
  expect(blocked.headers()["x-suppressed-leads"]).toBe("1");
  expect(blocked.headers()["x-exported-count"]).toBe("0");
  expect(await blocked.text()).not.toContain(company);

  // Clean up so the test is repeatable: remove the opt-out and the lead.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Remove ${domain}` }).click();
  await expect(page.getByRole("cell", { name: domain, exact: true })).toHaveCount(0);
  await request.delete(`/api/leads/${id}`);
});
