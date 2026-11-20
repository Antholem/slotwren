import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import { brandTheme } from "@/lib/brand-theme";
import { initialsOf } from "@/lib/color";

/*
 * The frame every booking email shares (docs/design/emails): the business's
 * tile and name, a white card, and a footer. Email clients need literal
 * colours, so these mirror docs/design/globals.css; the brand colour comes
 * through the same AA-checked palette as the booking page. Dark mail clients
 * that honour prefers-color-scheme (Apple Mail, iOS) get the dark tokens.
 */

export type EmailBusiness = {
  name: string;
  brandColor: string;
  address: string | null;
  logoUrl: string | null;
};

export const ink = "#1C1917";
export const muted = "#57534E";
export const border = "#E7E5E4";
export const panel = "#FAFAF9";
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/** Brand colours for an email: the booking page's light tokens. */
export function emailPalette(brandColor: string) {
  const theme = brandTheme(brandColor)?.light;
  return {
    primary: theme?.primary ?? "#0F766E",
    onPrimary: theme?.primaryForeground ?? "#FFFFFF",
    tint: theme?.primaryTint ?? "#CCFBF1",
    onTint: theme?.primaryTintForeground ?? "#115E59",
  };
}

/** Dark mail clients: the design's dark tokens, links in the brand's dark-mode colour. */
const darkCss = (brandColor: string) => `
@media (prefers-color-scheme: dark) {
  body, .sw-body { background-color: #0C0A09 !important; }
  .sw-link { color: ${brandTheme(brandColor)?.dark.primary ?? "#2DD4BF"} !important; }
  .sw-frame { background-color: #1C1917 !important; }
  .sw-card { background-color: #1C1917 !important; border-color: #292524 !important; }
  .sw-panel { background-color: #292524 !important; border-color: #44403C !important; }
  .sw-text { color: #FAFAF9 !important; }
  .sw-muted { color: #A8A29E !important; }
  .sw-line { border-color: #44403C !important; }
}`;

export function EmailShell({
  business,
  preview,
  footerNote,
  children,
}: {
  business: EmailBusiness;
  preview: string;
  /** Why they got it: "You're getting this because you made a booking." */
  footerNote: string;
  children: ReactNode;
}) {
  const colours = emailPalette(business.brandColor);
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{darkCss(business.brandColor)}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="sw-body"
        style={{ margin: 0, backgroundColor: "#E7E5E4", fontFamily: FONT, color: ink }}
      >
        <Container style={{ maxWidth: 600, margin: "0 auto", padding: "24px 12px" }}>
          <Section
            className="sw-frame"
            style={{ backgroundColor: panel, borderRadius: 16, padding: "28px 24px" }}
          >
            <Row style={{ marginBottom: 20 }}>
              <Column style={{ width: 48 }}>
                {business.logoUrl ? (
                  <Img
                    src={business.logoUrl}
                    alt=""
                    width={40}
                    height={40}
                    style={{ borderRadius: 10, objectFit: "contain" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      lineHeight: "40px",
                      borderRadius: 10,
                      textAlign: "center",
                      fontWeight: 600,
                      fontSize: 15,
                      backgroundColor: colours.tint,
                      color: colours.onTint,
                    }}
                  >
                    {initialsOf(business.name)}
                  </div>
                )}
              </Column>
              <Column>
                <Text className="sw-text" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                  {business.name}
                </Text>
              </Column>
            </Row>

            <Section
              className="sw-card"
              style={{
                backgroundColor: "#FFFFFF",
                border: `1px solid ${border}`,
                borderRadius: 14,
                padding: "28px 24px",
              }}
            >
              {children}
            </Section>

            <Text
              className="sw-muted"
              style={{ textAlign: "center", fontSize: 13, color: muted, margin: "24px 0 4px" }}
            >
              {[business.name, business.address].filter(Boolean).join(" · ")}
            </Text>
            <Text
              className="sw-muted"
              style={{ textAlign: "center", fontSize: 13, color: muted, margin: "0 0 12px" }}
            >
              {footerNote}
            </Text>
            <Text
              className="sw-muted"
              style={{ textAlign: "center", fontSize: 13, color: muted, margin: 0 }}
            >
              Powered by <strong>Slotwren</strong>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function Badge({ children, brandColor }: { children: ReactNode; brandColor: string }) {
  const colours = emailPalette(brandColor);
  return (
    <Text
      style={{
        display: "inline-block",
        margin: "0 0 12px",
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        backgroundColor: colours.tint,
        color: colours.onTint,
      }}
    >
      {children}
    </Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      className="sw-text"
      style={{ fontSize: 26, lineHeight: "32px", margin: "0 0 8px", color: ink }}
    >
      {children}
    </Heading>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <Text
      className="sw-muted"
      style={{ fontSize: 16, lineHeight: "24px", color: muted, margin: "0 0 20px" }}
    >
      {children}
    </Text>
  );
}

export function Body2({ children }: { children: ReactNode }) {
  return (
    <Text className="sw-text" style={{ fontSize: 15, lineHeight: "22px", margin: "20px 0 0" }}>
      {children}
    </Text>
  );
}

export type DetailRow = { label: string; value: ReactNode; mono?: boolean };

/** The appointment: date, big time range, then labelled rows. */
export function AppointmentCard({
  date,
  range,
  zoneNote,
  rows,
  struck = false,
}: {
  date: string;
  range: string;
  zoneNote: string | null;
  rows: DetailRow[];
  /** A cancelled booking's time is struck through. */
  struck?: boolean;
}) {
  return (
    <Section
      className="sw-panel"
      style={{
        backgroundColor: panel,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: "20px 20px 8px",
      }}
    >
      <Text className="sw-muted" style={{ margin: 0, fontSize: 14, color: muted }}>
        {date}
      </Text>
      <Text
        className="sw-text"
        style={{
          margin: "4px 0 0",
          fontFamily: MONO,
          fontSize: 32,
          fontWeight: 700,
          lineHeight: "40px",
          textDecoration: struck ? "line-through" : undefined,
        }}
      >
        {range}
      </Text>
      {zoneNote && (
        <Text className="sw-muted" style={{ margin: "2px 0 0", fontSize: 13, color: muted }}>
          {zoneNote}
        </Text>
      )}
      <Section style={{ marginTop: 12 }}>
        {rows.map((row) => (
          <Row key={row.label} className="sw-line" style={{ borderTop: `1px solid ${border}` }}>
            <Column
              className="sw-muted"
              style={{ width: "38%", padding: "10px 0", fontSize: 14, color: muted }}
            >
              {row.label}
            </Column>
            <Column
              className="sw-text"
              style={{
                padding: "10px 0",
                fontSize: 15,
                fontFamily: row.mono ? MONO : undefined,
              }}
            >
              {row.value}
            </Column>
          </Row>
        ))}
      </Section>
    </Section>
  );
}

export function PrimaryButton({
  href,
  brandColor,
  children,
}: {
  href: string;
  brandColor: string;
  children: ReactNode;
}) {
  const colours = emailPalette(brandColor);
  return (
    <Button
      href={href}
      style={{
        display: "inline-block",
        marginTop: 24,
        backgroundColor: colours.primary,
        color: colours.onPrimary,
        borderRadius: 10,
        padding: "12px 22px",
        fontSize: 16,
        fontWeight: 600,
      }}
    >
      {children}
    </Button>
  );
}

export function BrandLink({
  href,
  brandColor,
  children,
}: {
  href: string;
  brandColor: string;
  children: ReactNode;
}) {
  // The tint's text colour passes AA on white as well as on the tint.
  return (
    <Link
      href={href}
      className="sw-link"
      style={{ color: emailPalette(brandColor).onTint, textDecoration: "underline" }}
    >
      {children}
    </Link>
  );
}

/** Google, Apple and .ics, as outlined buttons. */
export function CalendarLinks({ googleUrl, icsUrl }: { googleUrl: string; icsUrl: string }) {
  const cell = {
    display: "block",
    textAlign: "center" as const,
    border: `1px solid ${border}`,
    borderRadius: 10,
    padding: "10px 0",
    fontSize: 15,
    color: ink,
    textDecoration: "none",
  };
  return (
    <Section style={{ marginTop: 24 }}>
      <Text className="sw-text" style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600 }}>
        Add to calendar
      </Text>
      <Row>
        <Column style={{ paddingRight: 6 }}>
          <Link href={googleUrl} className="sw-text sw-line" style={cell}>
            Google
          </Link>
        </Column>
        <Column style={{ padding: "0 3px" }}>
          <Link href={icsUrl} className="sw-text sw-line" style={cell}>
            Apple
          </Link>
        </Column>
        <Column style={{ paddingLeft: 6 }}>
          <Link href={icsUrl} className="sw-text sw-line" style={cell}>
            .ics file
          </Link>
        </Column>
      </Row>
    </Section>
  );
}

/** A soft panel for the cancellation policy and similar notes. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <Section
      className="sw-panel"
      style={{
        marginTop: 24,
        backgroundColor: panel,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <Text className="sw-text" style={{ margin: 0, fontSize: 14, lineHeight: "21px" }}>
        {children}
      </Text>
    </Section>
  );
}
