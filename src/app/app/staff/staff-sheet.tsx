"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Mail } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { FieldError } from "@/components/onboarding/step-footer";
import { CopyField } from "@/components/shared/copy-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatInZone } from "@/lib/dates";
import type { Result } from "@/lib/result";
import { cn } from "@/lib/utils";
import { type StaffFormInput, staffFormSchema, type StaffFormValues } from "@/lib/validation/staff";
import type { DashboardStaff } from "@/server/db/queries/staff";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { inviteExistingStaffAction, resendInviteAction, revokeInviteAction } from "./actions";
import { HoursPanel, type ScheduleContext, TimeOffPanel } from "./schedule";
import { hoursLabel, type ServiceOption, StaffAvatar, StatusBadge } from "./staff-view";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: adding someone new. */
  person: DashboardStaff | null;
  draft?: StaffFormInput;
  serverError?: string;
  services: ServiceOption[];
  canEdit: boolean;
  context: ScheduleContext;
  /** Which tab to open on (e.g. "hours" for your own card). */
  initialTab?: "details" | "hours" | "time-off";
  onSave: (raw: StaffFormInput, values: StaffFormValues) => void;
};

export function StaffSheet(props: Props) {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        // Variant-prefixed to beat SheetContent's own data-[side=…] sizes.
        className={cn(
          "gap-0 overflow-x-hidden p-0",
          desktop
            ? "data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
            : "rounded-t-2xl data-[side=bottom]:h-[92dvh]",
        )}
      >
        {props.open && (
          <Body
            key={`${props.person?.id ?? "new"}-${props.draft ? "draft" : "saved"}`}
            {...props}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body(props: Props) {
  const { person, canEdit } = props;
  return (
    <>
      <SheetHeader className="flex-row items-center gap-4 border-b px-6 py-5 pr-14">
        {person && <StaffAvatar person={person} />}
        <div className="min-w-0">
          <p className="text-body-sm text-muted-foreground">
            {!canEdit ? "Team member" : person ? "Edit team member" : "Add team member"}
          </p>
          <SheetTitle className="truncate text-heading">
            {person?.name ?? "New team member"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {canEdit
              ? "Name, title, the services they offer, and whether they take bookings."
              : "Details of this team member. Only owners can change them."}
          </SheetDescription>
        </div>
      </SheetHeader>
      {person ? <PersonTabs {...props} person={person} /> : <EditForm {...props} />}
    </>
  );
}

/**
 * Details, weekly hours and time off. Owners edit everything; a staff member
 * edits only their own hours and time off.
 */
function PersonTabs(props: Props & { person: DashboardStaff }) {
  const { person, canEdit, context } = props;
  const canEditSchedule = canEdit || person.isMe;
  const panel = "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-6";
  return (
    <Tabs
      defaultValue={props.initialTab ?? "details"}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <TabsList variant="line" className="mx-6 mt-3 h-11 w-auto justify-start gap-4 border-b p-0">
        <TabsTrigger value="details" className="h-11 flex-none px-1 text-label">
          Details
        </TabsTrigger>
        <TabsTrigger value="hours" className="h-11 flex-none px-1 text-label">
          Hours
        </TabsTrigger>
        <TabsTrigger value="time-off" className="h-11 flex-none px-1 text-label">
          Time off
        </TabsTrigger>
      </TabsList>
      <TabsContent value="details" className="flex min-h-0 flex-1 flex-col">
        {canEdit ? <EditForm {...props} /> : <ReadOnly {...props} />}
      </TabsContent>
      <TabsContent value="hours" className={panel}>
        <HoursPanel person={person} canEdit={canEditSchedule} context={context} />
      </TabsContent>
      <TabsContent value="time-off" className={panel}>
        <TimeOffPanel person={person} canEdit={canEditSchedule} context={context} />
      </TabsContent>
    </Tabs>
  );
}

function ReadOnly({ person, services, onOpenChange }: Props & { person: DashboardStaff }) {
  const offered = services.filter((s) => person.serviceIds.includes(s.id));
  const rows: [string, React.ReactNode][] = [
    ["Title", person.title ?? "–"],
    ["Status", <StatusBadge key="status" person={person} />],
    [
      "Hours",
      <span key="hours" className="font-mono text-mono tabular-nums">
        {hoursLabel(person)}
      </span>,
    ],
    ["Services", offered.length ? offered.map((s) => s.name).join(", ") : "None yet"],
  ];
  return (
    <>
      <dl className="flex flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-6 py-6">
        {rows.map(([term, detail]) => (
          <div key={term}>
            <dt className="text-body-sm text-muted-foreground">{term}</dt>
            <dd className="mt-1 text-body">{detail}</dd>
          </div>
        ))}
      </dl>
      <SheetFooter className="border-t px-6 py-4">
        <Button
          variant="secondary"
          className="h-11 px-5 text-label"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      </SheetFooter>
    </>
  );
}

function EditForm(props: Props) {
  const { person, services, draft, serverError } = props;
  const form = useForm<StaffFormInput, unknown, StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: draft ?? {
      name: person?.name ?? "",
      title: person?.title ?? "",
      active: person ? person.active : true,
      serviceIds: person?.serviceIds ?? [],
    },
    mode: "onTouched",
  });
  const { register, control, formState, handleSubmit, getValues } = form;
  const { errors } = formState;
  const ids = {
    name: useId(),
    nameError: useId(),
    title: useId(),
    titleError: useId(),
    active: useId(),
    activeHint: useId(),
    services: useId(),
  };
  // An invited person switches on when they accept.
  const awaitingInvite = !!person?.invite;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        id="staff-form"
        noValidate
        onSubmit={handleSubmit((values) => props.onSave(getValues(), values))}
        className="flex flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-6 py-6"
      >
        {serverError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-danger-soft px-4 py-3 text-body-sm text-danger-text"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {serverError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.name} className="text-label">
              Name
            </Label>
            <Input
              id={ids.name}
              autoComplete="off"
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? ids.nameError : undefined}
              className="h-11 px-3 text-body md:text-body"
              {...register("name")}
            />
            <FieldError id={ids.nameError} message={errors.name?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={ids.title} className="text-label">
                Title
              </Label>
              <span className="text-body-sm text-muted-foreground">Optional</span>
            </div>
            <Input
              id={ids.title}
              placeholder="Senior stylist"
              autoComplete="off"
              aria-invalid={!!errors.title || undefined}
              aria-describedby={errors.title ? ids.titleError : undefined}
              className="h-11 px-3 text-body md:text-body"
              {...register("title")}
            />
            <FieldError id={ids.titleError} message={errors.title?.message} />
          </div>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-label">Services they offer</legend>
          {services.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">
              Add services first, then assign them here.
            </p>
          ) : (
            <Controller
              control={control}
              name="serviceIds"
              render={({ field }) => (
                <ul className="grid gap-x-4 sm:grid-cols-2">
                  {services.map((service) => {
                    const id = `${ids.services}-${service.id}`;
                    const checked = field.value.includes(service.id);
                    return (
                      <li key={service.id}>
                        <label
                          htmlFor={id}
                          className="flex min-h-11 cursor-pointer items-center gap-3"
                        >
                          <Checkbox
                            id={id}
                            checked={checked}
                            className="size-5"
                            onCheckedChange={(on) =>
                              field.onChange(
                                on
                                  ? [...field.value, service.id]
                                  : field.value.filter((s) => s !== service.id),
                              )
                            }
                          />
                          <span className="text-body">{service.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            />
          )}
        </fieldset>

        <div className="flex items-center justify-between gap-4 rounded-xl border bg-background px-5 py-4">
          <div>
            <Label htmlFor={ids.active} className="text-label">
              Takes bookings
            </Label>
            <p id={ids.activeHint} className="text-body-sm text-muted-foreground">
              {awaitingInvite
                ? "Switches on when they accept their invite."
                : "Off: they disappear from booking. Their bookings and history stay."}
            </p>
          </div>
          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <Switch
                id={ids.active}
                size="lg"
                checked={field.value}
                disabled={awaitingInvite}
                onCheckedChange={field.onChange}
                aria-describedby={ids.activeHint}
              />
            )}
          />
        </div>

        {person && !person.isOwner && (
          <SignInSection person={person} timezone={props.context.timezone} />
        )}
      </form>

      <SheetFooter className="flex-row justify-end gap-3 border-t px-6 py-4">
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-5 text-label"
          onClick={() => props.onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" form="staff-form" className="h-11 px-5 text-label">
          {person ? "Save changes" : "Add to team"}
        </Button>
      </SheetFooter>
    </div>
  );
}

/** Whether they sign in: their pending invite, or a way to send one. */
function SignInSection({ person, timezone }: { person: DashboardStaff; timezone: string }) {
  // In the business timezone, so the server render and the browser agree.
  const day = (date: Date) => formatInZone(date, timezone, "d MMM");
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(person.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const emailId = useId();
  const errorId = useId();

  function run(
    action: () => Promise<
      Result<{ inviteUrl: string; emailSent: boolean } | { id: string }, string>
    >,
    success: string,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const sent = "inviteUrl" in result.data ? result.data : null;
      if (sent) setLink(sent.inviteUrl);
      toast.success(success, {
        description:
          sent && !sent.emailSent
            ? "Email isn't set up yet, so copy the link and send it yourself."
            : undefined,
      });
    });
  }

  function sendInvite() {
    run(() => inviteExistingStaffAction(person.id, { email }), `Invite sent to ${email}`);
  }

  if (person.linked) {
    return (
      <section
        aria-label="Sign-in"
        className="flex items-center gap-3 rounded-xl border bg-background px-5 py-4"
      >
        <Mail aria-hidden className="size-5 text-muted-foreground" />
        <p className="text-body-sm">
          Signs in as <span className="font-medium">{person.email ?? "their account"}</span>.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${emailId}-title`}
      className="flex flex-col gap-3 rounded-xl border bg-background px-5 py-4"
    >
      <h3 id={`${emailId}-title`} className="text-label">
        {person.invite ? "Invite pending" : "Invite to sign in"}
      </h3>
      {person.invite ? (
        <>
          <p className="text-body-sm text-muted-foreground">
            Sent to <span className="font-medium text-foreground">{person.invite.email}</span> on{" "}
            {day(person.invite.sentAt)}.{" "}
            {person.invite.expired
              ? "It has expired."
              : `It expires on ${day(person.invite.expiresAt)}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              className="h-11 px-4 text-label"
              onClick={() =>
                run(
                  () => resendInviteAction(person.invite!.id),
                  `Invite resent to ${person.invite!.email}`,
                )
              }
            >
              Resend invite
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              className="h-11 px-4 text-label text-danger-text hover:bg-danger-soft hover:text-danger-text"
              onClick={() => run(() => revokeInviteAction(person.invite!.id), "Invite revoked")}
            >
              Revoke invite
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body-sm text-muted-foreground">
            They&rsquo;ll see the team calendar and manage their own bookings and hours.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor={emailId} className="text-label">
              Their email
            </Label>
            <div className="flex gap-2">
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends the invite rather than submitting the staff form.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (email && !pending) sendInvite();
                }}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-11 min-w-0 flex-1 px-3 text-body md:text-body"
              />
              <Button
                type="button"
                disabled={pending || !email}
                className="h-11 px-4 text-label"
                onClick={sendInvite}
              >
                Send invite
              </Button>
            </div>
          </div>
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-body-sm text-danger-text">
          {error}
        </p>
      )}
      {link && <CopyField label="Invite link" value={link} />}
    </section>
  );
}
