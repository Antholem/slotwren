import {
  AppointmentCard,
  Badge,
  Body2,
  EmailShell,
  type EmailBusiness,
  Lead,
  PrimaryButton,
  Title,
} from "./components/email-shell";

export type OwnerNewBookingEmailProps = {
  business: EmailBusiness;
  customer: { name: string; email: string; phone: string | null };
  notes: string | null;
  serviceName: string;
  durationMin: number;
  staffName: string;
  price: string;
  code: string;
  /** On the business's clock. */
  date: string;
  range: string;
  /** "Booking page", "Website widget", "AI receptionist" */
  source: string;
  dashboardUrl: string;
};

/** For the owner: who booked what, so they can plan their day. */
export function OwnerNewBookingEmail(props: OwnerNewBookingEmailProps) {
  const { business, customer } = props;
  return (
    <EmailShell
      business={business}
      preview={`${customer.name} booked ${props.serviceName} with ${props.staffName}, ${props.date} ${props.range}.`}
      footerNote="You're getting this because you own this business on Slotwren."
    >
      <Badge brandColor={business.brandColor}>New booking</Badge>
      <Title>{customer.name} booked</Title>
      <Lead>
        {props.serviceName} with {props.staffName}, via {props.source.toLowerCase()}.
      </Lead>
      <AppointmentCard
        date={props.date}
        range={props.range}
        zoneNote={null}
        rows={[
          { label: "Service", value: `${props.serviceName} · ${props.durationMin} min` },
          { label: "With", value: props.staffName },
          { label: "Customer", value: customer.name },
          { label: "Email", value: customer.email },
          ...(customer.phone ? [{ label: "Phone", value: customer.phone }] : []),
          ...(props.notes ? [{ label: "Notes", value: props.notes }] : []),
          { label: "Price", value: props.price },
          { label: "Booking code", value: props.code, mono: true },
        ]}
      />
      <PrimaryButton href={props.dashboardUrl} brandColor={business.brandColor}>
        Open your dashboard
      </PrimaryButton>
      <Body2>Reply to this email to reach {customer.name} directly.</Body2>
    </EmailShell>
  );
}
