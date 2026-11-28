import {
  Badge,
  Body2,
  BrandLink,
  EmailShell,
  type EmailBusiness,
  Lead,
  Notice,
  PrimaryButton,
  Title,
} from "./components/email-shell";

export type AiHandoffQuestionEmailProps = {
  business: EmailBusiness;
  name: string;
  /** As typed in the chat: never verified. */
  email: string;
  question: string;
  /** "Thu 26 Nov, 14:05" in the business's timezone. */
  sentAt: string;
  /** The transcript on /app/ai. */
  dashboardUrl: string;
};

/** For the owners: a customer asked the AI receptionist something it couldn't answer. */
export function AiHandoffQuestionEmail(props: AiHandoffQuestionEmailProps) {
  const { business } = props;
  return (
    <EmailShell
      business={business}
      preview={`${props.name} asked: ${props.question.slice(0, 80)}`}
      footerNote="You're getting this because you own this business on Slotwren. At most a few of these an hour; the rest wait on your dashboard."
    >
      <Badge brandColor={business.brandColor}>Question for the team</Badge>
      <Title>{props.name} has a question</Title>
      <Lead>&ldquo;{props.question}&rdquo;</Lead>
      <Body2>
        From the AI chat on your booking page, {props.sentAt}. Reply to {props.email}: replying to
        this email goes there.
      </Body2>
      <Notice>
        The email address wasn&apos;t verified. Don&apos;t share booking details or anything
        personal until you know it&apos;s really them.
      </Notice>
      <PrimaryButton href={props.dashboardUrl} brandColor={business.brandColor}>
        Open the chat
      </PrimaryButton>
      <Body2>
        Mark it answered on your dashboard once you&apos;ve replied, or{" "}
        <BrandLink href={`mailto:${props.email}`} brandColor={business.brandColor}>
          write to {props.email}
        </BrandLink>
        .
      </Body2>
    </EmailShell>
  );
}
