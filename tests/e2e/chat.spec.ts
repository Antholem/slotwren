import { randomBytes } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import * as schema from "@/server/db/schema";

import { asNewVisitor, bookableBusinesses, type Fixture } from "../support/booking-flow";
import { collectConsoleErrors, expectNoAxeViolations, uniqueEmail } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

/*
 * The AI receptionist on the booking page, with the mock AI provider
 * (AI_PROVIDER=mock; src/server/ai/mock-model.ts): ask → slot chips → Confirm
 * → booked, then the booking on the owner's dashboard; the hand-off to the
 * team on the customer's profile; error and timeout with Retry; a refresh
 * keeps the chat; Escape; axe in light and dark. Desktop (side panel) and
 * phone (bottom sheet). Needs the local Supabase stack and DATABASE_URL.
 */

const businesses = liveBusinesses();
const pages = bookableBusinesses();
const { db } = businesses;
test.afterAll(() => Promise.all([businesses.cleanup(), pages.cleanup()]));
test.use({ timezoneId: "Asia/Manila" });
test.beforeEach(({ page }) => asNewVisitor(page));

/** A booking page with the receptionist, no signed-in owner needed. */
async function receptionistPage() {
  const fixture = await pages.create();
  await db
    .update(schema.businesses)
    .set({ aiEnabled: true, plan: "pro" })
    .where(eq(schema.businesses.id, fixture.business.id));
  return fixture;
}

/** AI on, Pro, and Mia working every day so the chat has times to offer. */
async function withReceptionist(fixture: Fixture) {
  const businessId = fixture.business.id;
  await db
    .update(schema.businesses)
    .set({ aiEnabled: true, plan: "pro", minNoticeMin: 0 })
    .where(eq(schema.businesses.id, businessId));
  await db.insert(schema.availabilityRules).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      businessId,
      staffId: fixture.staff.id,
      weekday,
      startTime: "08:00",
      endTime: "20:00",
    })),
  );
}

async function openChat(page: Page, slug: string) {
  await page.goto(`/b/${slug}`);
  await page.getByRole("button", { name: "Ask us anything" }).click();
  const chat = page.getByRole("dialog", { name: /./ });
  await expect(chat.getByRole("textbox", { name: "Ask a question or book" })).toBeFocused();
  return chat;
}

async function ask(page: Page, text: string) {
  const chat = page.getByRole("dialog");
  await chat.getByRole("textbox", { name: "Ask a question or book" }).fill(text);
  // Sending waits for the previous reply to finish.
  await expect(chat.getByRole("button", { name: "Send" })).toBeEnabled();
  await chat.getByRole("textbox", { name: "Ask a question or book" }).press("Enter");
}

test("ask → slot chips → Confirm → booked, and it's on the dashboard", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "chat");
  await withReceptionist(fixture);
  const before = (
    await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(eq(schema.bookings.businessId, fixture.business.id))
  ).length;

  const chat = await openChat(page, fixture.business.slug);
  await expectNoAxeViolations(page);

  // A suggestion asks for a haircut; the mock checks availability.
  await chat.getByRole("button", { name: "Book a haircut" }).click();
  await expect(chat.getByText(/^Checked \w+day \d+ \w{3}$/)).toBeVisible();
  const chips = chat.getByRole("list", { name: "Times you can pick" }).getByRole("button");
  await expect(chips.first()).toBeVisible();
  // The reply is announced once, when it has finished.
  await expect(page.locator("[aria-live=polite]")).toHaveText(/Which suits you\?/);

  // Keyboard only: pick the second time.
  const second = chips.nth(1);
  const picked = (await second.textContent())!;
  await second.focus();
  await page.keyboard.press("Enter");
  const card = chat.getByRole("region", { name: "Check and confirm" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Not booked yet");
  await expect(card).toContainText("Haircut");
  await expect(card).toContainText("Mia");
  await expect(card).toContainText("$35");
  await expect(card).toContainText(picked.match(/\d{2}:\d{2}/)![0]);
  await expectNoAxeViolations(page);
  // Nothing is booked yet.
  expect(
    (
      await db
        .select({ id: schema.bookings.id })
        .from(schema.bookings)
        .where(eq(schema.bookings.businessId, fixture.business.id))
    ).length,
  ).toBe(before);

  const email = uniqueEmail("chat-guest");
  await card.getByLabel("Name").fill("Rosa Chat");
  await card.getByLabel("Email").fill(email);
  await card.getByRole("button", { name: "Confirm booking" }).focus();
  await page.keyboard.press("Enter");

  const booked = chat.getByRole("region", { name: "You're booked" });
  await expect(booked).toBeVisible();
  const code = (await booked.getByText(/^SW-[A-Z0-9]{4}-\d{2}$/).textContent())!;
  await expect(booked.getByRole("link", { name: "Manage booking" })).toBeVisible();
  await expect(booked.getByRole("link", { name: /Google/ })).toBeVisible();
  await expect(chat.getByText("Confirmed by you")).toBeVisible();
  await expectNoAxeViolations(page);

  const [row] = await db
    .select()
    .from(schema.bookings)
    .where(
      and(eq(schema.bookings.businessId, fixture.business.id), eq(schema.bookings.code, code)),
    );
  expect(row).toMatchObject({ source: "ai", customerName: "Rosa Chat" });

  // A refresh keeps the conversation (the id is in sessionStorage, the rest on the server).
  await page.reload();
  const again = await openChat(page, fixture.business.slug);
  await expect(again.getByRole("region", { name: "You're booked" })).toContainText(code);
  await expect(again.getByText(/^Checked /)).toBeVisible();

  // Escape closes it and focus goes back to the button.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Ask us anything" })).toBeFocused();

  // The owner sees it on the dashboard.
  await page.goto("/app/bookings");
  await expect(page.getByText("Rosa Chat").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("hand-off: the question reaches the customer's profile", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "handoff");
  await withReceptionist(fixture);

  const chat = await openChat(page, fixture.business.slug);
  const question = `Is there parking near you? ${randomBytes(3).toString("hex")}`;
  await ask(page, question);
  await expect(chat.getByText("I'm not sure — I can pass this to the team.")).toBeVisible();
  const form = chat.getByRole("form", { name: "Message the team" });
  await expect(form.getByLabel("Your question")).toHaveValue(question);
  await expectNoAxeViolations(page);

  // Ana is already a customer (by email): the question lands on her profile.
  await form.getByLabel("Name").fill("Ana Santos");
  await form.getByLabel("Email").fill(fixture.customer.email);
  await form.getByRole("button", { name: "Send to the team" }).click();
  await expect(chat.getByText("Sent to the team")).toBeVisible();
  await expect(chat.getByRole("log").getByText(/passed your question to the team/)).toBeVisible();

  const [handoff] = await db
    .select()
    .from(schema.handoffRequests)
    .where(eq(schema.handoffRequests.businessId, fixture.business.id));
  expect(handoff).toMatchObject({
    status: "open",
    customerId: fixture.customer.id,
    message: question,
  });

  await page.goto(`/app/customers/${fixture.customer.id}`);
  const open = page.getByRole("region", { name: "Question for the team" });
  await expect(open).toContainText(question);
  expect(errors).toEqual([]);
});

test("a failed reply and a timed-out one both come back with Retry", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await receptionistPage();
  const chat = await openChat(page, fixture.business.slug);

  for (const marker of ["[fail]", "[stall]"]) {
    await ask(page, `Hello ${marker} ${randomBytes(3).toString("hex")}`);
    const alert = chat.getByRole("alert");
    // The stall ends at the mock's 3 s timeout.
    await expect(alert).toContainText("Sorry, something went wrong", { timeout: 20_000 });
    await expectNoAxeViolations(page);
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(
      chat.getByText("Sorry about that. I'm here now: how can I help?").last(),
    ).toBeVisible();
    await expect(chat.getByRole("alert")).toBeHidden();
  }
  // Retry didn't store the message twice.
  const rows = await db
    .select({ content: schema.aiMessages.content })
    .from(schema.aiMessages)
    .where(
      and(
        eq(schema.aiMessages.businessId, fixture.business.id),
        eq(schema.aiMessages.role, "user"),
      ),
    );
  expect(rows).toHaveLength(2);
});

test("readable in dark mode (axe) with a Confirm card open", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: "dark" });
  const fixture = await receptionistPage();
  const chat = await openChat(page, fixture.business.slug);
  await expectNoAxeViolations(page);
  await chat.getByRole("button", { name: "Book a haircut" }).click();
  await chat.getByRole("list", { name: "Times you can pick" }).getByRole("button").first().click();
  await expect(chat.getByRole("region", { name: "Check and confirm" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("phones: the sheet keeps focus inside", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The desktop panel is not modal.");
  const fixture = await receptionistPage();
  const chat = await openChat(page, fixture.business.slug);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await chat.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  // Every control in the sheet is at least 44 px tall.
  const small = await chat.evaluate(
    (el) =>
      [...el.querySelectorAll("button, input, a")]
        .map((c) => (c as HTMLElement).getBoundingClientRect())
        .filter((r) => r.height > 0 && r.height < 44).length,
  );
  expect(small).toBe(0);
});
