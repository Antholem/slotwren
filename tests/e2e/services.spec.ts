import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack and DATABASE_URL (read from .env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

async function signInWithBusiness(page: Page, role: "owner" | "staff") {
  const { fixture } = await businesses.signInWithBusiness(page, role, "services");
  await page.goto("/app/services");
  await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible();
  return fixture;
}

test("add, edit and archive a service", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signInWithBusiness(page, "owner");
  const dialog = page.getByRole("dialog");
  await expect(page.getByText("1 service, all bookable online.")).toBeVisible();
  await expectNoAxeViolations(page);

  // Add, after being told that someone has to offer it
  await page.getByRole("button", { name: "New service" }).click();
  await expect(dialog.getByRole("heading", { name: "Add a service" })).toBeVisible();
  await dialog.getByLabel("Name").fill("Scalp Treatment");
  await dialog.getByLabel("Duration").selectOption("30");
  await dialog.getByLabel("Price").fill("25");
  await dialog.getByLabel("After").selectOption("15");
  await expect(
    dialog.getByText("Blocks 45 min in the calendar (30 min + 15 min clean-up)."),
  ).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Mia/ }).click(); // ticked by default as the only staff
  await dialog.getByRole("button", { name: "Add service" }).click();
  await expect(dialog.getByText("Pick at least one person who offers this service.")).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByRole("checkbox", { name: /Mia/ }).click();
  await dialog.getByRole("button", { name: "Add service" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit Scalp Treatment" })).toBeVisible();
  await expect(page.getByText("Added Scalp Treatment")).toBeVisible();
  await expect(page.getByText("2 services, all bookable online.")).toBeVisible();

  // Edit: new price, hidden from the booking page; survives a reload
  await page.getByRole("button", { name: "Edit Scalp Treatment" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Scalp Treatment");
  await dialog.getByLabel("Price").fill("30");
  await dialog.getByRole("switch", { name: "Bookable online" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved Scalp Treatment")).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 services, 1 bookable online.")).toBeVisible();
  const scalp = page.getByRole("button", { name: "Edit Scalp Treatment" });
  await scalp.click();
  await expect(dialog.getByLabel("Price")).toHaveValue("30");
  await expect(dialog.getByRole("switch", { name: "Bookable online" })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Archive: Haircut has a booking, so it's archived rather than deleted
  await page.getByRole("button", { name: "Edit Haircut" }).click();
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(dialog.getByText(/It has 1 booking, so it's kept for history/)).toBeVisible();
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Archived Haircut")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Haircut" })).toHaveCount(0);
  await page.getByText("Archived (1)").click();
  await expect(page.getByRole("button", { name: "Restore Haircut" })).toBeVisible();

  // Delete: nobody booked Scalp Treatment, so it's removed for good
  await page.getByRole("button", { name: "Edit Scalp Treatment" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted Scalp Treatment")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No services yet" })).toBeVisible();
  await expectNoAxeViolations(page);

  // Restore brings the archived one back, still hidden
  await page.getByRole("button", { name: "Restore Haircut" }).click();
  await expect(page.getByRole("button", { name: "Edit Haircut" })).toBeVisible();
  await expect(page.getByText("1 service, 0 bookable online.")).toBeVisible();

  expect(errors).toEqual([]);
});

test("staff see services read-only", async ({ page }) => {
  test.setTimeout(90_000);
  await signInWithBusiness(page, "staff");

  await expect(page.getByText("Only owners can change them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New service" })).toHaveCount(0);
  await page.getByRole("button", { name: "View Haircut" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("45 min", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Save|Archive|Delete/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
