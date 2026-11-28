import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { zonedParts, nextDate } from "@/lib/time-off";
import * as schema from "@/server/db/schema";

import type { Fixture } from "../support/booking-flow";
import { collectConsoleErrors, expectNoAxeViolations } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

/*
 * The website widget (public/embed.js) on a plain HTML site served from
 * another origin (tests/support/embed-host.mjs, port 3200): book through it
 * on desktop and phone and see the booking on the dashboard as "Widget";
 * Escape and focus; inline mode; the "Allowed websites" list; framing refused
 * everywhere else; axe with the widget open.
 */

const HOST = "http://localhost:3200";
const ZONE = "Asia/Manila";

const businesses = liveBusinesses();
const { db } = businesses;
test.afterAll(() => businesses.cleanup());
test.use({ timezoneId: ZONE });
/**
 * A fresh visitor IP on the app's requests only (rate limits), added below
 * the browser's CORS check: as a page header it would make the widget's
 * cross-origin fetch a preflighted request, which real visitors never send.
 */
async function visitor(page: Page, app: string) {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const ip = `203.1.${octet()}.${octet()}`;
  await page.route(`${new URL(app).origin}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  );
}
test.beforeEach(async ({ page, baseURL }) => visitor(page, baseURL!));

async function bookable(fixture: Fixture, embed: Record<string, unknown> = {}) {
  const businessId = fixture.business.id;
  await db
    .update(schema.businesses)
    .set({ minNoticeMin: 0, settings: { embed } })
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

/** The booking flow inside the widget's iframe, up to the confirmation. */
async function bookInFrame(frame: FrameLocator, name: string) {
  const choose = async (label: RegExp | string) => {
    const radio = frame.getByRole("radio", { name: label }).first();
    await radio.locator("xpath=ancestor::label[1]").click();
    await expect(radio).toBeChecked();
  };
  const next = async () => {
    const button = frame.locator("button:visible", { hasText: "Continue" }).first();
    await expect(button).toBeEnabled();
    await button.press("Enter");
  };
  await choose(/Haircut/);
  await next();
  await expect(frame.getByRole("heading", { level: 1 })).toBeVisible();
  await next();
  // Tomorrow, in the business's timezone: always a full day of times.
  const tomorrow = nextDate(zonedParts(new Date(), ZONE).date);
  const day = frame.locator(`input[name="day"][value="${tomorrow}"]`);
  await day.locator("xpath=ancestor::label[1]").click();
  const chip = frame.getByRole("radio", { name: /^\d{2}:\d{2}$/ }).nth(1);
  await chip.locator("xpath=ancestor::label[1]").click();
  await next();
  await frame.getByLabel("Full name").fill(name);
  await frame.getByLabel("Email").fill(`widget-${Date.now()}@example.com`);
  await frame.locator("button:visible", { hasText: "Confirm booking" }).first().click();
  await expect(frame.getByRole("heading", { name: /You're booked|Booked/i }).first()).toBeVisible();
}

const widgetButton = (page: Page) => page.getByRole("button", { name: "Book now" });
const panel = (page: Page) => page.getByRole("dialog", { name: /^Book with/ });

test("book through the widget; it shows on the dashboard as Widget", async ({ page, context }) => {
  test.setTimeout(150_000);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget");
  await bookable(fixture);

  const site = await context.newPage();
  await visitor(site, page.url());
  const errors = collectConsoleErrors(site);
  await site.goto(`${HOST}/?business=${fixture.business.slug}`);
  await expect(widgetButton(site)).toBeVisible();
  await expectNoAxeViolations(site);

  await widgetButton(site).click();
  await expect(panel(site)).toBeVisible();
  const frame = site.frameLocator(`iframe[title^="Book with"]`);
  await expect(frame.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  await expectNoAxeViolations(site);

  // A booked event reaches the site (for its analytics), with nothing in it.
  const booked = site.evaluate(
    () =>
      new Promise<unknown>((resolve) =>
        document.addEventListener(
          "slotwren:booked",
          (e) => resolve((e as CustomEvent).detail ?? null),
          {
            once: true,
          },
        ),
      ),
  );
  await bookInFrame(frame, "Rosa Widget");
  expect(await booked).toBeNull();

  const [row] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.customerName, "Rosa Widget"));
  expect(row).toMatchObject({ businessId: fixture.business.id, source: "widget" });

  await page.goto("/app/bookings?range=all&q=Rosa%20Widget");
  const listed = page.getByRole("row", { name: /Rosa Widget/ });
  await expect(listed).toBeVisible();
  await expect(listed.getByRole("cell", { name: "Booked through: Widget" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Escape closes the widget and returns focus to its button", async ({ page }) => {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget-esc");
  await bookable(fixture);
  await page.goto(`${HOST}/?business=${fixture.business.slug}`);
  const button = widgetButton(page);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  const frame = page.frameLocator(`iframe[title^="Book with"]`);
  await expect(frame.getByRole("heading", { name: "Choose a service" })).toBeVisible();

  // From inside the booking page (focus is in the iframe).
  await frame.getByRole("radio", { name: /Haircut/ }).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(button).toBeFocused();

  // And from the panel's own close button.
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(button).toBeFocused();
});

test("with the chat open, one Escape closes the widget; the site behind is inert meanwhile", async ({
  page,
}) => {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget-chat-esc");
  await bookable(fixture);
  await db
    .update(schema.businesses)
    .set({ aiEnabled: true, plan: "pro" })
    .where(eq(schema.businesses.id, fixture.business.id));
  await page.goto(`${HOST}/?business=${fixture.business.slug}`);
  const bubble = page.getByRole("button", { name: `Chat with ${fixture.business.name}` });
  await bubble.focus();
  await page.keyboard.press("Enter");
  const chatPanel = page.getByRole("dialog", { name: /^Chat with/ });
  await expect(chatPanel).toBeVisible();
  const frame = page.frameLocator(`iframe[title^="Chat with"]`);
  const input = frame.getByRole("textbox", { name: "Ask a question or book" });
  await expect(input).toBeFocused();

  // The website behind can't be reached while the widget is open.
  const inert = () => page.evaluate(() => document.querySelector("main")?.inert ?? null);
  expect(await inert()).toBe(true);

  await page.keyboard.press("Escape");
  await expect(chatPanel).toBeHidden();
  await expect(bubble).toBeFocused();
  expect(await inert()).toBe(false);
});

test("inline mode renders the booking page inside the site", async ({ page }) => {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget-inline");
  await bookable(fixture);
  await page.goto(`${HOST}/?business=${fixture.business.slug}&mode=inline`);
  const frame = page.frameLocator(`iframe[title^="Book with"]`);
  await expect(frame.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  await expect(widgetButton(page)).toHaveCount(0);
  // Sized to its content by the page's resize messages.
  const iframe = page.locator(`iframe[title^="Book with"]`);
  await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0).toBeGreaterThan(320);
  await expectNoAxeViolations(page);
});

test("with an allowed-websites list, other sites get no widget and can't frame the page", async ({
  page,
  baseURL,
}) => {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget-allowed");
  await bookable(fixture, { allowedOrigins: ["https://www.example.com"] });
  const slug = fixture.business.slug;

  const config = page.waitForResponse((r) => r.url().includes(`/api/embed/${slug}`));
  await page.goto(`${HOST}/?business=${slug}`);
  expect((await config).status()).toBe(403);
  await expect(widgetButton(page)).toHaveCount(0);

  const embedded = await page.request.get(`/b/${slug}?embed=1&host=${HOST}`);
  expect(embedded.headers()["content-security-policy"]).toBe(
    "frame-ancestors https://www.example.com",
  );
  // In a real browser, framed from this (not allowed) site, it stays blank.
  await page.goto(
    `${HOST}/frame?src=${encodeURIComponent(`${baseURL}/b/${slug}?embed=1&host=${HOST}`)}`,
  );
  await page.waitForLoadState("load");
  const frame = page.frames().find((f) => f.url().startsWith(baseURL!));
  expect(
    frame
      ? await frame
          .locator("h1")
          .count()
          .catch(() => 0)
      : 0,
  ).toBe(0);
});

test("only the embedded booking page can be framed", async ({ page, baseURL }) => {
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget-frame");
  await bookable(fixture);
  const slug = fixture.business.slug;
  const app = baseURL!;

  for (const path of ["/app", "/app/settings/embed", `/b/${slug}`, "/sign-in", "/"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.headers()["x-frame-options"], path).toBe("DENY");
    expect(response.headers()["content-security-policy"], path).toBe("frame-ancestors 'none'");
  }

  // In a real browser: the dashboard and the plain booking page stay blank in a frame…
  for (const path of ["/app", `/b/${slug}`]) {
    await page.goto(`${HOST}/frame?src=${encodeURIComponent(app + path)}`);
    await page.waitForLoadState("load");
    const frame = page.frames().find((f) => f.url().startsWith(app));
    const heading = frame
      ? await frame
          .locator("h1")
          .count()
          .catch(() => 0)
      : 0;
    expect(heading, path).toBe(0);
  }
  // …while the embedded one loads.
  await page.goto(
    `${HOST}/frame?src=${encodeURIComponent(`${app}/b/${slug}?embed=1&host=${HOST}`)}`,
  );
  await expect(
    page.frameLocator("#frame").getByRole("heading", { name: "Choose a service" }),
  ).toBeVisible();
});

test("Settings → Embed: options, snippet and allowed websites", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { fixture } = await businesses.signInWithBusiness(page, "owner", "widget-settings");
  await bookable(fixture);
  await page.goto("/app/settings/embed");
  const code = page.locator(`pre[aria-label="Embed code"]`);
  await expect(code).toContainText(`data-business="${fixture.business.slug}"`);
  await expectNoAxeViolations(page);

  await page.getByLabel("Button text").fill("Book a visit");
  await page.getByText("Bottom left", { exact: true }).click();
  await expect(code).toContainText('data-position="bottom-left"');
  await expect(code).toContainText('data-label="Book a visit"');
  await page.getByLabel("Allowed websites").fill("www.harbor.example\nnot a website");
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not a website" })).toContainText(
    `"not a website" isn't a website address.`,
  );
  await page.getByLabel("Allowed websites").fill("www.harbor.example");
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Widget options saved")).toBeVisible();

  const [row] = await db
    .select({ settings: schema.businesses.settings })
    .from(schema.businesses)
    .where(eq(schema.businesses.id, fixture.business.id));
  expect(row!.settings.embed).toMatchObject({
    buttonText: "Book a visit",
    position: "bottom-left",
    allowedOrigins: ["https://www.harbor.example"],
  });
  expect(errors).toEqual([]);
});
