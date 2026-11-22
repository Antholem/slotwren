import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";

import { collectConsoleErrors } from "../support/e2e";
import { liveBusinesses } from "../support/e2e-business";

// Needs the local Supabase stack (Auth, Mailpit) and DATABASE_URL (.env.local).

const businesses = liveBusinesses();
test.afterAll(() => businesses.cleanup());

/**
 * Makes the dashboard's session lookup (getDashboardMember: memberships under
 * RLS) fail for one user only: a restrictive select policy that raises for
 * their rows. No test hook in the app; the database really errors. The
 * division can't be folded at plan time (it depends on the row), so other
 * users' queries are untouched.
 */
async function breakSessionLookupFor(userId: string) {
  const policy = `e2e_fail_${userId.replaceAll("-", "")}`;
  await businesses.db.execute(
    sql.raw(`
      create policy ${policy} on public.memberships as restrictive for select to authenticated
      using (case when user_id = '${userId}'::uuid
        then 1 / (length(user_id::text) - 36) = 1 else true end)
    `),
  );
  return () =>
    businesses.db.execute(sql.raw(`drop policy if exists ${policy} on public.memberships`));
}

test("a failed session lookup keeps the dashboard shell and shows the error state", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const { email } = await businesses.signInWithBusiness(page, "owner", "errors");
  // Load once while it works: the proxy remembers the account is ready and stops asking.
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const [user] = await businesses.db.execute<{ id: string }>(
    sql`select id from auth.users where email = ${email}`,
  );
  const restore = await breakSessionLookupFor(user!.id);
  try {
    await page.reload();

    // The page's error state, inside the dashboard shell
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
    // The plain top bar instead of the app-wide error page
    const bar = page.getByTestId("top-bar-fallback");
    await expect(bar).toBeVisible();
    await expect(bar.getByText("Couldn’t load your account details.")).toBeVisible();

    if (info.project.name === "mobile") {
      await bar.getByRole("button", { name: "Open menu" }).click();
    }
    await expect(
      page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Calendar" }),
    ).toBeVisible();
  } finally {
    await restore();
  }

  // Once the database answers again, retrying brings the dashboard back.
  if (info.project.name === "mobile") await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("top-bar-fallback")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The failure itself is logged on purpose: the boundaries' console.error of the
  // (redacted, production) Server Components error, React #441, and React
  // switching that Suspense boundary to client rendering, #419. Nothing else.
  const expected = /Minified React error #(441|419);/;
  expect(errors.some((e) => expected.test(e))).toBe(true);
  expect(errors.filter((e) => !expected.test(e))).toEqual([]);
});
