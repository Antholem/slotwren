import { Text } from "@react-email/components";

import { type BookingEmailData, detailRows, firstName } from "./components/booking-details";
import {
  AppointmentCard,
  Badge,
  Body2,
  BrandLink,
  EmailShell,
  Lead,
  Notice,
  PrimaryButton,
  Title,
} from "./components/email-shell";

export type BookingReminderEmailProps = BookingEmailData & {
  /** "Tomorrow", "Today", "Sat 31 Oct" on the customer's clock. */
  dayWord: string;
  /** A freshly minted manage link (reschedule or cancel). */
  manageUrl: string;
  /** "Free cancellation until Fri 30 Oct, 10:30 (up to 24 h before). …" */
  policy: string;
};

/** "See you tomorrow, Ana" (docs/design/emails/2-reminder-day-before). */
export function BookingReminderEmail(props: BookingReminderEmailProps) {
  const { business } = props;
  const relative = props.dayWord === "Today" || props.dayWord === "Tomorrow";
  const when = relative ? props.dayWord.toLowerCase() : `on ${props.dayWord}`;
  return (
    <EmailShell
      business={business}
      preview={`${props.date}, ${props.range} at ${business.name}. ${props.policy.split(".")[0]}.`}
      footerNote={`You're getting this reminder because you booked with ${business.name}.`}
    >
      <Badge brandColor={business.brandColor}>{props.dayWord}</Badge>
      <Title>
        See you {when}, {firstName(props.customerName)}
      </Title>
      <Lead>A quick reminder of your appointment at {business.name}.</Lead>
      <AppointmentCard
        date={relative ? `${props.dayWord} · ${props.date}` : props.date}
        range={props.range}
        zoneNote={props.zoneNote}
        rows={detailRows(props)}
      />
      {props.mapsUrl ? (
        <PrimaryButton href={props.mapsUrl} brandColor={business.brandColor}>
          Get directions
        </PrimaryButton>
      ) : (
        <PrimaryButton href={props.manageUrl} brandColor={business.brandColor}>
          Manage booking
        </PrimaryButton>
      )}
      <Text className="sw-text" style={{ fontSize: 15, margin: "20px 0 0" }}>
        Plans changed?{" "}
        <BrandLink href={props.manageUrl} brandColor={business.brandColor}>
          Reschedule
        </BrandLink>{" "}
        or{" "}
        <BrandLink href={props.manageUrl} brandColor={business.brandColor}>
          Cancel
        </BrandLink>
      </Text>
      <Notice>{props.policy}</Notice>
      {props.canReply && (
        <Body2>Running late? Reply to this email and {business.name} will see it.</Body2>
      )}
    </EmailShell>
  );
}
