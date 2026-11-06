"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, Info, Loader2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Controller, type Path, useForm } from "react-hook-form";

import { FieldError } from "@/components/onboarding/step-footer";
import { CopyField } from "@/components/shared/copy-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type InviteFormInput,
  inviteFormSchema,
  type InviteFormValues,
  INVITE_TTL_DAYS,
} from "@/lib/validation/staff";

import { inviteStaffAction } from "./actions";
import type { ServiceOption } from "./staff-view";

type Sent = { email: string; inviteUrl: string; emailSent: boolean };

/** "Invite a team member" (docs/design/setup-settings/4-staff-invite-dialog). */
export function InviteDialog({
  open,
  onOpenChange,
  services,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceOption[];
}) {
  const [sent, setSent] = useState<Sent | null>(null);

  function change(next: boolean) {
    onOpenChange(next);
    if (!next) setSent(null);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-2xl">
        {sent ? (
          <SentView sent={sent} onDone={() => change(false)} />
        ) : (
          open && <InviteForm services={services} onSent={setSent} onCancel={() => change(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  services,
  onSent,
  onCancel,
}: {
  services: ServiceOption[];
  onSent: (sent: Sent) => void;
  onCancel: () => void;
}) {
  const form = useForm<InviteFormInput, unknown, InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: "", name: "", serviceIds: [] },
    mode: "onTouched",
  });
  const { register, control, formState, handleSubmit, getValues, setError } = form;
  const { errors } = formState;
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { email: useId(), emailError: useId(), name: useId(), services: useId() };

  const submit = handleSubmit((values) =>
    startTransition(async () => {
      setFormError(null);
      const result = await inviteStaffAction(getValues());
      if (result.ok) {
        onSent({ email: values.email, ...result.data });
        return;
      }
      const fields = Object.entries(result.error.fieldErrors ?? {});
      fields.forEach(([name, messages], i) =>
        setError(name as Path<InviteFormInput>, { message: messages[0] }, { shouldFocus: i === 0 }),
      );
      if (fields.length === 0) setFormError(result.error.message);
    }),
  );

  return (
    <form noValidate onSubmit={submit}>
      <DialogHeader className="gap-1 px-6 pt-6 pr-14 sm:px-8 sm:pt-8">
        <DialogTitle className="text-heading">Invite a team member</DialogTitle>
        <DialogDescription className="text-body text-muted-foreground">
          They&rsquo;ll get an email with a link to join. They show up for booking once they accept.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-6 px-6 py-6 sm:px-8">
        {formError && (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-4 py-3 text-body-sm text-danger-text"
          >
            {formError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.email} className="text-label">
              Email
            </Label>
            <Input
              id={ids.email}
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="sam@example.com"
              aria-invalid={!!errors.email || undefined}
              aria-describedby={errors.email ? ids.emailError : undefined}
              className="h-11 px-3 text-body md:text-body"
              {...register("email")}
            />
            <FieldError id={ids.emailError} message={errors.email?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={ids.name} className="text-label">
                Name
              </Label>
              <span className="text-body-sm text-muted-foreground">Optional</span>
            </div>
            <Input
              id={ids.name}
              autoComplete="off"
              placeholder="Sam"
              className="h-11 px-3 text-body md:text-body"
              {...register("name")}
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-3 text-label">Role</legend>
          <div className="flex items-start gap-3 rounded-xl border-2 border-primary bg-primary-tint px-4 py-3 text-primary-tint-foreground">
            <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-label">Staff</p>
              <p className="text-body-sm">
                Sees the team calendar and manages their own bookings and hours.
              </p>
            </div>
          </div>
        </fieldset>

        {services.length > 0 && (
          <fieldset>
            <legend className="mb-3 text-label">Services they offer</legend>
            <Controller
              control={control}
              name="serviceIds"
              render={({ field }) => (
                <ul className="grid gap-x-4 sm:grid-cols-3">
                  {services.map((service) => {
                    const id = `${ids.services}-${service.id}`;
                    return (
                      <li key={service.id}>
                        <label
                          htmlFor={id}
                          className="flex min-h-11 cursor-pointer items-center gap-3"
                        >
                          <Checkbox
                            id={id}
                            className="size-5"
                            checked={field.value.includes(service.id)}
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
          </fieldset>
        )}

        <p className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-body-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Their hours start as yours and their calendar colour is assigned automatically. You can
          change both later. The invite link lasts {INVITE_TTL_DAYS} days.
        </p>
      </div>

      <DialogFooter className="flex-row justify-end gap-3 px-6 pb-6 sm:px-8 sm:pb-8">
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-5 text-label"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="h-11 px-5 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Send invite
        </Button>
      </DialogFooter>
    </form>
  );
}

function SentView({ sent, onDone }: { sent: Sent; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <DialogHeader className="gap-2 pr-8">
        <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-text">
          <CircleCheck aria-hidden className="size-6" />
        </span>
        <DialogTitle className="text-heading">Invite ready</DialogTitle>
        <DialogDescription className="text-body text-muted-foreground">
          {sent.emailSent ? (
            <>
              We emailed <span className="font-medium text-foreground">{sent.email}</span> a link to
              join. You can also copy it below.
            </>
          ) : (
            <>
              Email isn&rsquo;t set up yet, so nothing was sent. Copy the link and send it to{" "}
              <span className="font-medium text-foreground">{sent.email}</span> yourself.
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <CopyField label="Invite link" value={sent.inviteUrl} />
      <p className="text-body-sm text-muted-foreground">
        This is the only time the link is shown. If it gets lost, resend the invite from their card.
      </p>
      <DialogFooter>
        <Button className="h-11 px-5 text-label" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
