import { type BookingEmailData, detailRows, firstName } from "./components/booking-details";
import {
  AppointmentCard,
  Badge,
  Body2,
  EmailShell,
  Lead,
  Notice,
  PrimaryButton,
  Title,
} from "./components/email-shell";

export type BookingCancelledEmailProps = BookingEmailData & {
  /** The business cancelled it (time off, the dashboard), or the customer did. */
  byBusiness: boolean;
  /** Shown when the business cancelled: never the team-only reason. */
  message: string | null;
  bookAgainUrl: string;
};

/** "Your booking was cancelled", by the business or as the customer's own receipt. */
export function BookingCancelledEmail(props: BookingCancelledEmailProps) {
  const { business } = props;
  return (
    <EmailShell
      business={business}
      preview={`${props.serviceName} on ${props.date} at ${props.range.split(" ")[0]} is cancelled.`}
      footerNote="You're getting this because your booking changed."
    >
      <Badge brandColor={business.brandColor}>Cancelled</Badge>
      <Title>
        {props.byBusiness
          ? `Your booking was cancelled, ${firstName(props.customerName)}`
          : `You’ve cancelled your booking, ${firstName(props.customerName)}`}
      </Title>
      <Lead>
        {props.byBusiness
          ? `${business.name} had to cancel your appointment. Sorry for the change of plans.`
          : `This confirms your cancellation. The time is free again in ${business.name}'s calendar.`}
      </Lead>
      <AppointmentCard
        date={props.date}
        range={props.range}
        zoneNote={props.zoneNote}
        rows={detailRows(props)}
        struck
      />
      {props.byBusiness && props.message && (
        <Notice>
          Note from {business.name}: {props.message}
        </Notice>
      )}
      <PrimaryButton href={props.bookAgainUrl} brandColor={business.brandColor}>
        Book another time
      </PrimaryButton>
      {props.canReply && (
        <Body2>Questions? Reply to this email and {business.name} will get back to you.</Body2>
      )}
    </EmailShell>
  );
}
