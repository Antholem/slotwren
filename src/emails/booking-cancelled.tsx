import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type BookingCancelledEmailProps = {
  businessName: string;
  customerName: string;
  serviceName: string;
  staffName: string;
  /** "Thu 12 Nov · 10:00 GMT+8" in the customer's timezone (or the business's). */
  when: string;
  code: string;
  /** Shown when the business gave one: "Mia is away that day." */
  reason: string | null;
  bookAgainUrl: string;
};

// Email clients need literal colours; these mirror docs/design/globals.css.
const ink = "#1C1917";
const muted = "#57534E";
const border = "#E7E5E4";
const primary = "#0F766E";

/** "Lumen Studio cancelled your Haircut on Thu 12 Nov." Fuller version in step 2.5. */
export function BookingCancelledEmail({
  businessName,
  customerName,
  serviceName,
  staffName,
  when,
  code,
  reason,
  bookAgainUrl,
}: BookingCancelledEmailProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
      </Head>
      <Preview>{`${businessName} cancelled your ${serviceName} on ${when}`}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#FAFAF9",
          fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: ink,
        }}
      >
        <Container style={{ maxWidth: 480, margin: "0 auto", padding: "40px 16px" }}>
          <Text style={{ fontSize: 20, fontWeight: 600, margin: "0 0 24px" }}>{businessName}</Text>
          <Section
            style={{
              backgroundColor: "#FFFFFF",
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: 32,
            }}
          >
            <Heading as="h1" style={{ fontSize: 24, lineHeight: "32px", margin: "0 0 8px" }}>
              Your booking was cancelled
            </Heading>
            <Text style={{ fontSize: 16, lineHeight: "24px", color: muted, margin: "0 0 16px" }}>
              Hi {customerName}. {businessName} had to cancel your {serviceName} with {staffName} on{" "}
              {when}. Sorry for the change of plans.
            </Text>
            {reason && (
              <Text style={{ fontSize: 16, lineHeight: "24px", margin: "0 0 16px" }}>
                Note from {businessName}: {reason}
              </Text>
            )}
            <Text
              style={{
                fontSize: 14,
                lineHeight: "20px",
                color: muted,
                margin: "0 0 24px",
                fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              }}
            >
              Booking {code}
            </Text>
            <Button
              href={bookAgainUrl}
              style={{
                backgroundColor: primary,
                color: "#FFFFFF",
                borderRadius: 10,
                padding: "12px 20px",
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Book another time
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
