import {
  Badge,
  Body2,
  EmailShell,
  type EmailBusiness,
  Lead,
  PrimaryButton,
  Title,
} from "./components/email-shell";

export type AiBudgetWarningEmailProps = {
  business: EmailBusiness;
  /** "80%" */
  share: string;
  used: string;
  budget: string;
  /** "1 December", when it starts again. */
  resetsOn: string;
  dashboardUrl: string;
};

/** For the owner, once a month: the AI receptionist has used most of its budget. */
export function AiBudgetWarningEmail(props: AiBudgetWarningEmailProps) {
  const { business } = props;
  return (
    <EmailShell
      business={business}
      preview={`Your AI receptionist has used ${props.share} of this month's budget.`}
      footerNote="You're getting this because you own this business on Slotwren. We send it once a month at most."
    >
      <Badge brandColor={business.brandColor}>AI receptionist</Badge>
      <Title>{props.share} of this month&apos;s AI budget used</Title>
      <Lead>
        Your assistant has used {props.used} of {props.budget} tokens this month. When it reaches
        the limit it rests until {props.resetsOn}: customers can still book on your page and send
        questions to the team.
      </Lead>
      <PrimaryButton href={props.dashboardUrl} brandColor={business.brandColor}>
        See usage
      </PrimaryButton>
      <Body2>Nothing to do if that&apos;s fine. Bookings are never affected.</Body2>
    </EmailShell>
  );
}
