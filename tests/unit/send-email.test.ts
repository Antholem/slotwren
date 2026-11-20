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

describe("fromAddress", () => {
  it("sends as the business, from Slotwren's address", async () => {
    const { fromAddress } = await import("@/server/email/send");
    env.EMAIL_FROM = "Slotwren <bookings@slotwren.com>";
    expect(fromAddress("Lumen Studio")).toBe('"Lumen Studio" <bookings@slotwren.com>');
    expect(fromAddress()).toBe("Slotwren <bookings@slotwren.com>");
    // Nothing that could break out of the header.
    expect(fromAddress('Evil" <x@y.z>\r\nBcc: a@b.c')).toBe(
      '"Evil x@y.zBcc: a@b.c" <bookings@slotwren.com>',
    );
    expect(fromAddress('"<>"')).toBe("Slotwren <bookings@slotwren.com>");
  });
});

describe("sendEmail with Resend", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes reply-to and attachments through", async () => {
    vi.resetModules();
    const send = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send };
      },
    }));
    const keyed = { ...env, RESEND_API_KEY: "re_test", EMAIL_FROM: "Slotwren <b@slotwren.com>" };
    vi.doMock("@/env", () => ({ env: keyed }));
    const fresh = await import("@/server/email/send");
    const result = await fresh.sendEmail({
      ...email,
      fromName: "Lumen Studio",
      replyTo: "hello@lumen.example",
      attachments: [
        { filename: "booking.ics", content: "BEGIN:VCALENDAR", contentType: "text/calendar" },
      ],
    });
    expect(result).toEqual({ delivered: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Lumen Studio" <b@slotwren.com>',
        replyTo: "hello@lumen.example",
        attachments: [
          {
            filename: "booking.ics",
            content: Buffer.from("BEGIN:VCALENDAR"),
            contentType: "text/calendar",
          },
        ],
      }),
    );
  });

  it("reports a failure instead of throwing", async () => {
    vi.resetModules();
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send: vi.fn().mockRejectedValue(new Error("network")) };
      },
    }));
    vi.doMock("@/env", () => ({ env: { ...env, RESEND_API_KEY: "re_test" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fresh = await import("@/server/email/send");
    expect(await fresh.sendEmail(email)).toEqual({ delivered: false, reason: "failed" });
  });
});
