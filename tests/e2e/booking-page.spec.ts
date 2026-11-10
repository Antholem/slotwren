import { expect, test } from "@playwright/test";

import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

test("a shared booking link opens a branded page, not a 404", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "public");

  // A customer: no session.
  const customer = await (await browser.newContext()).newPage();
  const errors = collectConsoleErrors(customer);
  const response = await customer.goto(`/b/${fixture.business.slug}`);
  expect(response?.status()).toBe(200);
  await expect(
    customer.getByRole("heading", { level: 1, name: fixture.business.name }),
  ).toBeVisible();
  await expect(customer.getByRole("main").getByText("Online booking opens soon")).toBeVisible();
  await expect(customer).toHaveTitle(`${fixture.business.name} — online booking opens soon`);
  await expectNoAxeViolations(customer);
  expect(errors).toEqual([]);
});

test("unknown pages and booking links get the branded 404", async ({ page }) => {
  for (const path of ["/b/no-such-business-here", "/b/NOT_A_SLUG", "/nowhere"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "We can’t find that page" }),
    ).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
    "href",
    "/",
  );
  await expectNoAxeViolations(page);
});
