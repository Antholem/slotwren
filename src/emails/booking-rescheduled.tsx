import { Text } from "@react-email/components";

import { type BookingEmailData, detailRows, firstName } from "./components/booking-details";
import {
  AppointmentCard,
  Badge,
  Body2,
  CalendarLinks,
  EmailShell,
  Lead,
  muted,
  Notice,
  PrimaryButton,
  Title,
} from "./components/email-shell";

export type BookingRescheduledEmailProps = BookingEmailData & {
  /** "Tue 27 Oct, 14:30" */
  previous: string;
  /** A fresh manage link (every reschedule email carries one). */
  manageUrl: string;
  googleUrl: string;
  icsUrl: string;
  policy: string;
  movedByBusiness: boolean;
};

/** "Your booking has moved": the new time, the old one, and an updated .ics. */
export function BookingRescheduledEmail(props: BookingRescheduledEmailProps) {
  const { business } = props;
  return (
    <EmailShell
      business={business}
      preview={`Now ${props.date}, ${props.range} with ${props.staffName} (was ${props.previous}).`}
      footerNote="You're getting this because your booking changed."
    >
      <Badge brandColor={business.brandColor}>Rescheduled</Badge>
      <Title>Your booking has moved, {firstName(props.customerName)}</Title>
      <Lead>
        {props.movedByBusiness
          ? `${business.name} moved your appointment. Here's the new time.`
          : "Done. Here's your new time."}{" "}
        It was {props.previous}.
      </Lead>
      <AppointmentCard
        date={props.date}
        range={props.range}
        zoneNote={props.zoneNote}
        rows={detailRows(props)}
      />
      <PrimaryButton href={props.manageUrl} brandColor={business.brandColor}>
        Manage booking
      </PrimaryButton>
      <Text className="sw-muted" style={{ fontSize: 14, color: muted, margin: "10px 0 0" }}>
        {props.movedByBusiness
          ? "Reschedule or cancel from the same page."
          : "This link replaces the ones in your earlier emails."}
      </Text>
      <CalendarLinks googleUrl={props.googleUrl} icsUrl={props.icsUrl} />
      <Notice>{props.policy}</Notice>
      <Body2>Questions? Reply to this email and {business.name} will get back to you.</Body2>
    </EmailShell>
  );
}
