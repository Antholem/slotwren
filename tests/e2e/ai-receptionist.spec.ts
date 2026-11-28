import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { CHAT_OFF_MESSAGE } from "@/lib/chat";
import * as schema from "@/server/db/schema";

import { asNewVisitor, type Fixture } from "../support/booking-flow";
import { bookingValues } from "../support/db";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

/*
 * The AI receptionist page (/app/ai): switching the receptionist off (the
 * booking page's button goes, an open chat says so), editing the FAQ, reading
 * a transcript and answering a question; axe in light and dark. With the mock
 * AI provider (AI_PROVIDER=mock). Needs the local Supabase stack.
 */

const businesses = liveBusinesses();
const { db } = businesses;
test.afterAll(() => businesses.cleanup());
test.use({ timezoneId: "Asia/Manila" });
test.beforeEach(({ page }) => asNewVisitor(page));

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

test("switching the receptionist off hides the button and stops an open chat", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "ai-switch");
  await withReceptionist(fixture);

  // A customer has the chat open in another tab.
  const customer = await context.newPage();
  // Its own visitor IP too: the hand-off and chat limits count per IP.
  await asNewVisitor(customer);
  await customer.goto(`/b/${fixture.business.slug}`);
  await customer.getByRole("button", { name: "Ask us anything" }).click();
  const chat = customer.getByRole("dialog");
  await expect(chat.getByRole("textbox", { name: "Ask a question or book" })).toBeFocused();

  await page.goto("/app/ai");
  await expect(page.getByRole("heading", { level: 1, name: "AI receptionist" })).toBeVisible();
  await expectNoAxeViolations(page);
  const toggle = page.getByRole("switch");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByText("The AI receptionist is off")).toBeVisible();
  await expect(toggle).not.toBeChecked();

  // The open chat now says so instead of answering.
  await chat.getByRole("textbox", { name: "Ask a question or book" }).fill("Are you open?");
  await chat.getByRole("textbox", { name: "Ask a question or book" }).press("Enter");
  await expect(chat.getByRole("status").filter({ hasText: CHAT_OFF_MESSAGE })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Retry" })).toHaveCount(0);

  // A fresh visit has no chat button at all.
  await customer.reload();
  await expect(customer.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  await expect(customer.getByRole("button", { name: "Ask us anything" })).toHaveCount(0);

  // On again: the button is back.
  await toggle.click();
  await expect(page.getByText("The AI receptionist is on")).toBeVisible();
  await expect(toggle).toBeChecked();
  await customer.reload();
  await expect(customer.getByRole("button", { name: "Ask us anything" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the FAQ: add, edit, reorder and delete, by keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "ai-faq");
  await withReceptionist(fixture);
  await page.goto("/app/ai");
  const panel = page.getByRole("region", { name: "What the assistant knows" });
  await expect(panel.getByText("Changes apply to new chats right away.")).toBeVisible();

  const add = async (question: string, answer: string) => {
    await panel.getByRole("button", { name: "Add question" }).click();
    const form = panel.getByRole("form", { name: "New answer" });
    await expect(form.getByLabel("Question")).toBeFocused();
    await page.keyboard.type(question);
    await form.getByLabel("Answer").fill(answer);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Answer added")).toBeVisible();
    await expect(form).toHaveCount(0);
  };
  await add("Is there parking?", "Yes, behind the studio.");
  await add("Can I pay by card?", "Yes, all major cards.");
  const answers = panel.getByRole("list", { name: "Answers" }).getByRole("heading");
  await expect(answers).toHaveText(["Is there parking?", "Can I pay by card?"]);
  await expectNoAxeViolations(page);

  // Edit: the answer changes, and it's what the assistant gets.
  await panel.getByRole("button", { name: "Edit: Is there parking?" }).click();
  const edit = panel.getByRole("form", { name: "Edit answer" });
  await edit.getByLabel("Answer").fill("Free parking on Sundays.");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Answer saved")).toBeVisible();
  await expect(edit).toHaveCount(0);
  await expect(
    panel.getByRole("listitem").filter({ hasText: "Free parking on Sundays." }),
  ).toBeVisible();
  const [stored] = await db
    .select()
    .from(schema.faqs)
    .where(
      and(
        eq(schema.faqs.businessId, fixture.business.id),
        eq(schema.faqs.question, "Is there parking?"),
      ),
    );
  expect(stored).toMatchObject({
    businessId: fixture.business.id,
    answer: "Free parking on Sundays.",
  });

  // Reorder by keyboard.
  await panel.getByRole("button", { name: "Move down: Is there parking?" }).focus();
  await page.keyboard.press("Enter");
  await expect(answers).toHaveText(["Can I pay by card?", "Is there parking?"]);

  // Limits: the counter, and the server's message for an empty answer.
  await panel.getByRole("button", { name: "Edit: Can I pay by card?" }).click();
  const second = panel.getByRole("form", { name: "Edit answer" });
  await expect(second.getByText(/^\d+\/1000$/)).toBeVisible();

  // Delete, with a confirm.
  await second.getByRole("button", { name: "Delete" }).click();
  await second.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Answer deleted")).toBeVisible();
  await expect(answers).toHaveText(["Is there parking?"]);
  expect(errors).toEqual([]);
});

test("a transcript with its tool rows, and a question answered from the profile", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "ai-transcript");
  await withReceptionist(fixture);
  const businessId = fixture.business.id;

  // A conversation as the chat stores it: a check, a proposal, a confirmation.
  const [conversation] = await db
    .insert(schema.aiConversations)
    .values({ businessId, channel: "page" })
    .returning();
  const conversationId = conversation!.id;
  const [booking] = await db
    .insert(schema.bookings)
    .values(
      bookingValues(fixture, new Date(Date.now() + 3 * 86_400_000), {
        source: "ai",
        aiConversationId: conversationId,
      }),
    )
    .returning();
  const t0 = Date.now();
  const at = (s: number) => new Date(t0 + s * 1000);
  await db.insert(schema.aiMessages).values([
    { businessId, conversationId, role: "user", content: "Anything Saturday?", createdAt: at(0) },
    {
      businessId,
      conversationId,
      role: "assistant",
      content: "Here are the times.",
      createdAt: at(1),
      parts: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "checkAvailability",
              input: { service: "Haircut", date: "2026-11-28" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              toolName: "checkAvailability",
              output: { type: "json", value: { status: "ok", times: [{ time: "10:00" }] } },
            },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "Here are the times." }] },
      ],
    },
    {
      businessId,
      conversationId,
      role: "assistant",
      content: `Booked ${booking!.code}`,
      createdAt: at(2),
      parts: [
        { type: "text", text: `Booked ${booking!.code}` },
        {
          type: "data-confirmation",
          data: {
            proposalId: "p1",
            kind: "book",
            confirmed: true,
            card: {
              kind: "book",
              code: booking!.code,
              bookingId: booking!.id,
              day: "Sat 28 Nov",
              time: "10:00 – 10:45",
            },
          },
        },
      ],
    },
  ]);
  const question = `Can I bring my dog? ${randomBytes(2).toString("hex")}`;
  await db.insert(schema.handoffRequests).values({
    businessId,
    conversationId,
    customerId: fixture.customer.id,
    name: "Ana Santos",
    email: fixture.customer.email,
    message: question,
  });

  await page.goto("/app/ai");
  await page.getByRole("link", { name: /Ana Santos.*Anything Saturday\?/ }).click();
  await expect(page).toHaveURL(new RegExp(`c=${conversationId}`));
  const transcript = page.getByRole("region", { name: "Transcript" });
  await expect(transcript.getByText("Booked", { exact: true })).toBeVisible();
  const check = transcript.getByText("Checked availability", { exact: true });
  await expect(check).toBeVisible();
  await expect(transcript.getByText("Customer confirmed · Booked")).toBeVisible();
  await expect(
    transcript.getByText("From the AI chat · email not verified", { exact: false }),
  ).toBeVisible();

  // Expand a tool row by keyboard: its arguments and result.
  await check.locator("xpath=ancestor::summary").focus();
  await page.keyboard.press("Enter");
  await expect(transcript.getByText('"date": "2026-11-28"')).toBeVisible();
  await expectNoAxeViolations(page);

  // Its booking opens from the confirmation row.
  await transcript.getByText("Customer confirmed · Booked").click();
  await expect(
    transcript.getByRole("link", { name: `Open booking ${booking!.code}` }),
  ).toBeVisible();

  // The customer's profile shows the question; the owner marks it answered.
  await page.goto(`/app/customers/${fixture.customer.id}`);
  const open = page.getByRole("region", { name: "Question for the team" });
  await expect(open).toContainText(question);
  await expect(open).toContainText("From the AI chat · email not verified");
  await open.getByRole("button", { name: "Mark answered" }).click();
  await expect(page.getByText("Marked as answered")).toBeVisible();
  await expect(page.getByRole("region", { name: "Question for the team" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a used-up budget: the chat rests politely, questions still reach the team", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "ai-budget");
  await withReceptionist(fixture);
  const businessId = fixture.business.id;
  await db
    .update(schema.businesses)
    .set({ aiMonthlyTokenBudget: 1000 })
    .where(eq(schema.businesses.id, businessId));
  const [conversation] = await db
    .insert(schema.aiConversations)
    .values({ businessId, channel: "page" })
    .returning();
  await db.insert(schema.aiMessages).values({
    businessId,
    conversationId: conversation!.id,
    role: "assistant",
    content: "Earlier",
    inputTokens: 1000,
    outputTokens: 0,
  });

  const customer = await context.newPage();
  // Its own visitor IP too: the hand-off and chat limits count per IP.
  await asNewVisitor(customer);
  await customer.goto(`/b/${fixture.business.slug}`);
  await customer.getByRole("button", { name: "Ask us anything" }).click();
  const chat = customer.getByRole("dialog");
  await chat
    .getByRole("textbox", { name: "Ask a question or book" })
    .fill("Do you sell gift cards?");
  await chat.getByRole("textbox", { name: "Ask a question or book" }).press("Enter");
  await expect(
    chat.getByRole("status").filter({ hasText: "The assistant is resting for this month" }),
  ).toBeVisible();
  const form = chat.getByRole("form", { name: "Message the team" });
  await expect(form.getByLabel("Your question")).toHaveValue("Do you sell gift cards?");
  await expectNoAxeViolations(customer);
  await form.getByLabel("Name").fill("Noor");
  await form.getByLabel("Email").fill(`noor-${randomBytes(3).toString("hex")}@example.com`);
  await form.getByRole("button", { name: "Send to the team" }).click();
  await expect(chat.getByText("Sent to the team")).toBeVisible();

  await page.goto("/app/ai");
  await expect(
    page.getByRole("progressbar", { name: "AI budget used this month" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("Resting for the rest of the month.")).toBeVisible();
  await expect(page.getByText(/Last guardrail event: Monthly budget used up/)).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});
