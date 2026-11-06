"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { BookingPreview, type PreviewProps } from "@/components/onboarding/booking-preview";
import { StepFooter } from "@/components/onboarding/step-footer";
import { STEP_FORM_ID, StepShell } from "@/components/onboarding/step-shell";
import { dayErrorMessages, WeekEditor } from "@/components/shared/week-editor";
import { type DayHours, openingSummary, summarizeWeek } from "@/lib/hours";
import { type HoursInput, hoursSchema } from "@/lib/validation/onboarding";

import { saveHoursAction } from "../actions";
import { useStepSubmit } from "../use-step-submit";

type Props = { initial: { days: DayHours[] }; preview: PreviewProps };

export function HoursForm({ initial, preview }: Props) {
  const form = useForm<HoursInput>({
    resolver: zodResolver(hoursSchema),
    defaultValues: initial,
  });
  const { control, setValue, formState } = form;
  const { onSubmit, pending, formError } = useStepSubmit(form, saveHoursAction);
  const days = useWatch({ control, name: "days" }) as DayHours[];
  const errors = dayErrorMessages(formState.errors.days, days.length);
  const weekError = errors.week ?? formError;

  return (
    <StepShell
      step={4}
      title="When are you open?"
      description="Customers can only book inside these hours. Times start on the half hour."
      preview={<BookingPreview {...preview} hoursLabel={openingSummary(days)} />}
    >
      <form id={STEP_FORM_ID} noValidate onSubmit={onSubmit}>
        <WeekEditor
          days={days}
          errors={errors.days}
          onChange={(next) =>
            setValue("days", next, { shouldDirty: true, shouldValidate: formState.isSubmitted })
          }
        />

        <p className="mt-6 text-body-sm text-muted-foreground">{summarizeWeek(days)}</p>
        {weekError && (
          <p role="alert" className="mt-3 text-body-sm text-danger-text">
            {weekError}
          </p>
        )}

        <StepFooter back="/onboarding/service" submitLabel="Finish and go live" pending={pending} />
      </form>
    </StepShell>
  );
}
