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

export type StaffInviteEmailProps = {
  businessName: string;
  inviterName: string | null;
  inviteeName: string;
  acceptUrl: string;
  expiresOn: string; // "13 November"
};

// Email clients need literal colours; these mirror docs/design/globals.css.
const ink = "#1C1917";
const muted = "#57534E";
const border = "#E7E5E4";
const primary = "#0F766E";

/** "Mia invited you to join Lumen Studio on Slotwren." */
export function StaffInviteEmail({
  businessName,
  inviterName,
  inviteeName,
  acceptUrl,
  expiresOn,
}: StaffInviteEmailProps) {
  const who = inviterName ? `${inviterName} invited you` : "You've been invited";
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
      </Head>
      <Preview>{`${who} to join ${businessName} on Slotwren`}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#FAFAF9",
          fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: ink,
        }}
      >
        <Container style={{ maxWidth: 480, margin: "0 auto", padding: "40px 16px" }}>
          <Text style={{ fontSize: 20, fontWeight: 600, margin: "0 0 24px" }}>Slotwren</Text>
          <Section
            style={{
              backgroundColor: "#FFFFFF",
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: 32,
            }}
          >
            <Heading as="h1" style={{ fontSize: 24, lineHeight: "32px", margin: "0 0 8px" }}>
              Join {businessName}
            </Heading>
            <Text style={{ fontSize: 16, lineHeight: "24px", color: muted, margin: "0 0 24px" }}>
              Hi {inviteeName}. {who} to join {businessName} on Slotwren. You&rsquo;ll see the team
              calendar and manage your own bookings and hours.
            </Text>
            <Button
              href={acceptUrl}
              style={{
                backgroundColor: primary,
                color: "#FFFFFF",
                borderRadius: 10,
                padding: "12px 20px",
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Accept invite
            </Button>
            <Text style={{ fontSize: 14, lineHeight: "20px", color: muted, margin: "24px 0 0" }}>
              The link works once and expires on {expiresOn}. Sign in with this email address to
              accept. Not expecting this? You can ignore it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
