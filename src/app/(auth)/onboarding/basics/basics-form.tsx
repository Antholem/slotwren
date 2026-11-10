"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Link2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { BookingPreview, type PreviewProps } from "@/components/onboarding/booking-preview";
import { FieldError, StepFooter } from "@/components/onboarding/step-footer";
import { STEP_FORM_ID, StepShell } from "@/components/onboarding/step-shell";
import { NativeSelect } from "@/components/shared/native-select";
import { SlugField, useSlugStatus } from "@/components/shared/slug-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";
import { timeZoneLabel } from "@/lib/timezones";
import { type BasicsInput, basicsSchema } from "@/lib/validation/onboarding";

import { checkSlug, saveBasicsAction } from "../actions";
import { useStepSubmit } from "../use-step-submit";

type Props = {
  timeZones: { value: string; label: string }[];
  /** Prefilled from Google or an earlier visit. */
  ownerName: string;
  initial: BasicsInput | null;
  preview: PreviewProps;
};

export function BasicsForm({ timeZones, ownerName, initial, preview }: Props) {
  const form = useForm<BasicsInput>({
    resolver: zodResolver(basicsSchema),
    defaultValues: initial ?? { ownerName, name: "", slug: "", timezone: "" },
    mode: "onTouched",
  });
  const { register, setValue, control, formState } = form;
  const { onSubmit, pending, formError } = useStepSubmit(form, saveBasicsAction);
  const [name, slug, timezone] = useWatch({ control, name: ["name", "slug", "timezone"] });

  // Suggest a slug from the name until the owner edits the slug themselves.
  const [slugEdited, setSlugEdited] = useState(initial !== null);
  const nameField = register("name", {
    onChange: (event) => {
      if (!slugEdited) setValue("slug", slugify(event.target.value));
    },
  });
  const slugField = register("slug", { onChange: () => setSlugEdited(true) });

  // Default the timezone to the browser's, which is almost always right.
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value, read after hydration
    setDetected(zone);
    if (!initial) setValue("timezone", zone);
  }, [initial, setValue]);
  const zones =
    detected && !timeZones.some((zone) => zone.value === detected)
      ? [{ value: detected, label: timeZoneLabel(detected) }, ...timeZones]
      : timeZones;

  const slugStatus = useSlugStatus(slug, checkSlug);
  const ids = {
    ownerName: useId(),
    ownerNameError: useId(),
    ownerNameHint: useId(),
    name: useId(),
    nameError: useId(),
    slug: useId(),
    slugStatus: useId(),
    timezone: useId(),
    timezoneHint: useId(),
    timezoneError: useId(),
  };
  const slugError = formState.errors.slug?.message;

  return (
    <StepShell
      step={1}
      title="Tell us about your business"
      description="This is what customers see first. You can change any of it later."
      preview={<BookingPreview {...preview} name={name} slug={slug} />}
    >
      <form id={STEP_FORM_ID} noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        {formError && (
          <p role="alert" className="text-body-sm text-danger-text">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.ownerName} className="text-label">
            Your name
          </Label>
          <Input
            id={ids.ownerName}
            autoComplete="name"
            placeholder="Mia Santos"
            aria-invalid={!!formState.errors.ownerName || undefined}
            aria-describedby={
              formState.errors.ownerName
                ? `${ids.ownerNameError} ${ids.ownerNameHint}`
                : ids.ownerNameHint
            }
            className="h-11 px-3 text-body md:text-body"
            {...register("ownerName")}
          />
          <FieldError id={ids.ownerNameError} message={formState.errors.ownerName?.message} />
          <p id={ids.ownerNameHint} className="text-body-sm text-muted-foreground">
            Shown to your team, and to customers when they book with you.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.name} className="text-label">
            Business name
          </Label>
          <Input
            id={ids.name}
            autoComplete="organization"
            placeholder="Lumen Studio"
            aria-invalid={!!formState.errors.name || undefined}
            aria-describedby={formState.errors.name ? ids.nameError : undefined}
            className="h-11 px-3 text-body md:text-body"
            {...nameField}
          />
          <FieldError id={ids.nameError} message={formState.errors.name?.message} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.slug} className="text-label">
            Booking link
          </Label>
          <SlugField
            id={ids.slug}
            statusId={ids.slugStatus}
            host={preview.host}
            status={slugStatus}
            error={slugError}
            inputProps={slugField}
          />
          {slug && (
            <p className="flex items-start gap-3 rounded-lg bg-muted px-4 py-3 text-body-sm">
              <Link2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Customers book at{" "}
                <span className="font-mono text-mono font-semibold break-all">
                  {preview.host}/b/{slug}
                </span>
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={ids.timezone} className="text-label">
              Timezone
            </Label>
            {detected && timezone === detected && (
              <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-caption text-primary-tint-foreground">
                Detected
              </span>
            )}
          </div>
          <NativeSelect
            id={ids.timezone}
            aria-invalid={!!formState.errors.timezone || undefined}
            aria-describedby={
              formState.errors.timezone
                ? `${ids.timezoneError} ${ids.timezoneHint}`
                : ids.timezoneHint
            }
            {...register("timezone")}
          >
            <option value="" disabled>
              Choose a timezone
            </option>
            {zones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError id={ids.timezoneError} message={formState.errors.timezone?.message} />
          <p id={ids.timezoneHint} className="text-body-sm text-muted-foreground">
            From your browser. Customers always see times in their own timezone.
          </p>
        </div>

        <StepFooter pending={pending} />
      </form>
    </StepShell>
  );
}
