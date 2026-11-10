import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Without RESEND_API_KEY, sendEmail skips sending. The links it would have
 * sent (invite and manage links are bearer tokens) may be logged in
 * development only, never in production logs.
 */

const env = { NODE_ENV: "production", RESEND_API_KEY: undefined, EMAIL_FROM: "x <x@example.com>" };
vi.mock("@/env", () => ({ env }));

const { sendEmail } = await import("@/server/email/send");

const email = {
  to: "sam@example.com",
  subject: "Join Lumen Studio on Slotwren",
  react: null as never,
  logLines: ["Invite link for sam@example.com: https://slotwren.com/invite/secret-token"],
};

describe("sendEmail without Resend", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never logs the link outside development", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    for (const mode of ["production", "test"]) {
      env.NODE_ENV = mode;
      expect(await sendEmail(email)).toEqual({ delivered: false, reason: "not_configured" });
    }
    const logged = info.mock.calls.flat().join("\n");
    expect(logged).toContain("not sending");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("sam@example.com");
  });

  it("logs it in development so local flows can follow it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    env.NODE_ENV = "development";
    await sendEmail(email);
    expect(info.mock.calls.flat().join("\n")).toContain("secret-token");
  });
});
