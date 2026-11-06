import { expect, test } from "@playwright/test";

import {
  collectConsoleErrors,
  expectNoAxeViolations,
  onThisServer,
  signInWithMagicLink,
  uniqueEmail,
} from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

test("invite → accept in a second browser → staff sees read-only Services", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const ownerErrors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "staff");
  const businessName = fixture.business.name;

  // Owner invites Sam, offering Haircut
  await page.goto("/app/staff");
  await expect(page.getByRole("heading", { level: 1, name: "Staff" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Invite staff" }).click();
  const dialog = page.getByRole("dialog");
  const samEmail = uniqueEmail("sam");
  await dialog.getByLabel("Email").fill(samEmail);
  await dialog.getByLabel("Name").fill("Sam");
  await dialog.getByRole("checkbox", { name: "Haircut" }).click();
  await expectNoAxeViolations(page);
  await dialog.getByRole("button", { name: "Send invite" }).click();

  // No Resend key locally: the dialog says so and hands over the link once.
  await expect(dialog.getByRole("heading", { name: "Invite ready" })).toBeVisible();
  await expect(dialog.getByText(/Email isn.t set up yet/)).toBeVisible();
  const inviteUrl = await dialog.getByLabel("Invite link").inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[\w-]{40,}$/);
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  const samCard = page.getByRole("button", { name: "Edit Sam" });
  await expect(samCard).toContainText("Invited");
  await expect(samCard).toContainText(`Invite sent to ${samEmail}`);

  // Sam opens the link in another browser, signs up and accepts
  const samContext = await browser.newContext();
  const sam = await samContext.newPage();
  const samErrors = collectConsoleErrors(sam);
  await sam.goto(onThisServer(inviteUrl));
  await expect(sam.getByRole("heading", { level: 1, name: `Join ${businessName}` })).toBeVisible();
  // Masked: enough to spot the right account (uniqueEmail starts with "e2e-").
  await expect(sam.getByText("e••@example.com")).toBeVisible();
  await expectNoAxeViolations(sam);
  await sam.getByRole("link", { name: "Sign in to accept" }).click();
  await expect(sam).toHaveURL(/\/sign-in\?next=/);
  await signInWithMagicLink(sam, samEmail, { onCurrentPage: true });

  // Back on the invite after signing in
  await expect(sam).toHaveURL(/\/invite\//);
  await expect(sam.getByText(`Signed in as ${samEmail}`)).toBeVisible();
  await expectNoAxeViolations(sam);
  await sam.getByRole("button", { name: `Accept and join ${businessName}` }).click();
  await expect(sam).toHaveURL(/\/app$/);

  // Staff see Services read-only
  await sam.goto("/app/services");
  await expect(sam.getByText("Only owners can change them.")).toBeVisible();
  await expect(sam.getByRole("button", { name: "New service" })).toHaveCount(0);
  await sam.getByRole("button", { name: "View Haircut" }).click();
  await expect(sam.getByRole("dialog").getByRole("textbox")).toHaveCount(0);
  await sam.keyboard.press("Escape");

  // ...and the team read-only, with themselves now active
  await sam.goto("/app/staff");
  await expect(sam.getByText("Only owners can add people")).toBeVisible();
  await expect(sam.getByRole("button", { name: "Invite staff" })).toHaveCount(0);
  await expect(sam.getByRole("button", { name: "View Sam" })).toContainText("Active");
  await expectNoAxeViolations(sam);

  // The link is spent
  await sam.goto(onThisServer(inviteUrl));
  await expect(
    sam.getByRole("heading", { level: 1, name: "This invite has been used" }),
  ).toBeVisible();
  await samContext.close();

  // Owner sees Sam active, signed in, offering Haircut
  await page.reload();
  await expect(samCard).toContainText("Active");
  await samCard.click();
  await expect(page.getByRole("dialog").getByText(`Signs in as ${samEmail}`)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("checkbox", { name: "Haircut" })).toBeChecked();

  expect(ownerErrors).toEqual([]);
  expect(samErrors).toEqual([]);
});

test("an owner revokes a pending invite and the link stops working", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await businesses.signInWithBusiness(page, "owner", "revoke");
  await page.goto("/app/staff");

  await page.getByRole("button", { name: "Invite staff" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(uniqueEmail("revoked"));
  await dialog.getByLabel("Name").fill("Riley");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  const inviteUrl = await dialog.getByLabel("Invite link").inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Edit Riley" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Invite pending" })).toBeVisible();
  // Keyboard, not a click: in mobile emulation Playwright's click retries pan
  // the visual viewport under the fixed bottom sheet, so the pointer never
  // lands. Enter on the focused button is the same action (and checks it's
  // keyboard-reachable).
  const revoke = sheet.getByRole("button", { name: "Revoke invite" });
  await revoke.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Invite revoked")).toBeVisible();
  // The placeholder it created goes too.
  await expect(page.getByRole("button", { name: "Edit Riley" })).toHaveCount(0);

  const other = await browser.newContext();
  const visitor = await other.newPage();
  await visitor.goto(onThisServer(inviteUrl));
  await expect(
    visitor.getByRole("heading", { level: 1, name: "This invite link isn't valid" }),
  ).toBeVisible();
  await other.close();
});
