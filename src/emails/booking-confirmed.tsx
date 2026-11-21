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

export type BookingConfirmedEmailProps = BookingEmailData & {
  manageUrl: string;
  googleUrl: string;
  icsUrl: string;
  /** "Free cancellation until Fri 30 Oct, 10:30 (up to 24 h before)." */
  policy: string;
  /** "Booked online on Sun 25 Oct at 16:13." */
  bookedVia: string;
};

/** "You're booked, Ana" (docs/design/emails/1-booking-confirmed). The .ics is attached. */
export function BookingConfirmedEmail(props: BookingConfirmedEmailProps) {
  const { business } = props;
  return (
    <EmailShell
      business={business}
      preview={`${props.date}, ${props.range} with ${props.staffName}. Booking code ${props.code}.`}
      footerNote={`${props.bookedVia} You're getting this because you made a booking.`}
    >
      <Badge brandColor={business.brandColor}>Confirmed</Badge>
      <Title>You&rsquo;re booked, {firstName(props.customerName)}</Title>
      <Lead>
        Thanks for booking with {business.name}. Keep this email: it has everything you need.
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
        Reschedule or cancel from the same page.
      </Text>
      <CalendarLinks googleUrl={props.googleUrl} icsUrl={props.icsUrl} />
      <Notice>{props.policy}</Notice>
      {props.canReply && (
        <Body2>Questions? Reply to this email and {business.name} will get back to you.</Body2>
      )}
    </EmailShell>
  );
}
