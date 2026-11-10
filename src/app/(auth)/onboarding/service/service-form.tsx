"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";

import { BookingPreview, type PreviewProps } from "@/components/onboarding/booking-preview";
import { FieldError, StepFooter } from "@/components/onboarding/step-footer";
import { STEP_FORM_ID, StepShell } from "@/components/onboarding/step-shell";
import { NativeSelect } from "@/components/shared/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parsePriceToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  BUFFER_OPTIONS,
  DURATION_OPTIONS,
  type ServiceInput,
  serviceSchemaFor,
  type ServiceValues,
} from "@/lib/validation/onboarding";

import { saveServiceAction } from "../actions";
import { useStepSubmit } from "../use-step-submit";

type Props = {
  currency: string;
  currencySymbol: string;
  initial: ServiceInput;
  preview: PreviewProps;
};

const durationLabel = (min: number) =>
  min < 60 || min % 60 !== 0 ? `${min} min` : `${min / 60} h`;

export function ServiceForm({ currency, currencySymbol, initial, preview }: Props) {
  const form = useForm<ServiceInput, unknown, ServiceValues>({
    resolver: zodResolver(serviceSchemaFor(currency)),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { register, control, formState } = form;
  const { errors } = formState;
  const { onSubmit, pending, formError } = useStepSubmit(form, saveServiceAction);
  const [name, durationMin, price] = useWatch({
    control,
    name: ["name", "durationMin", "price"],
  });

  const ids = {
    name: useId(),
    nameError: useId(),
    duration: useId(),
    price: useId(),
    priceError: useId(),
    buffer: useId(),
    bufferHint: useId(),
    description: useId(),
    descriptionError: useId(),
  };

  return (
    <StepShell
      step={3}
      title="Add your first service"
      description="What can customers book? Start with your most popular service."
      preview={
        <BookingPreview
          {...preview}
          service={{
            name,
            durationMin: Number(durationMin) || null,
            priceCents: price === "" ? null : parsePriceToCents(String(price), currency),
          }}
        />
      }
    >
      <form id={STEP_FORM_ID} noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        {formError && (
          <p role="alert" className="text-body-sm text-danger-text">
            {formError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.name} className="text-label">
            Service name
          </Label>
          <Input
            id={ids.name}
            placeholder="Haircut & Style"
            autoComplete="off"
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? ids.nameError : undefined}
            className="h-11 px-3 text-body md:text-body"
            {...register("name")}
          />
          <FieldError id={ids.nameError} message={errors.name?.message} />
        </div>

        <div className="grid gap-6 sm:grid-cols-3 sm:gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.duration} className="text-label">
              Duration
            </Label>
            <NativeSelect
              id={ids.duration}
              className="[&_select]:font-mono [&_select]:tabular-nums"
              {...register("durationMin", { valueAsNumber: true })}
            >
              {DURATION_OPTIONS.map((min) => (
                <option key={min} value={min}>
                  {durationLabel(min)}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.price} className="text-label">
              Price
            </Label>
            <div
              className={cn(
                "flex h-11 items-center gap-2 rounded-lg border border-input px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
                errors.price && "border-destructive ring-3 ring-destructive/20",
              )}
            >
              <span aria-hidden className="text-muted-foreground">
                {currencySymbol}
              </span>
              <input
                id={ids.price}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={!!errors.price || undefined}
                aria-describedby={errors.price ? ids.priceError : undefined}
                className="h-full min-w-0 flex-1 bg-transparent font-mono text-body tabular-nums outline-none"
                {...register("price")}
              />
            </div>
            <FieldError id={ids.priceError} message={errors.price?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.buffer} className="text-label">
              Buffer after
            </Label>
            <NativeSelect
              id={ids.buffer}
              aria-describedby={ids.bufferHint}
              {...register("bufferAfterMin", { valueAsNumber: true })}
            >
              {BUFFER_OPTIONS.map((min) => (
                <option key={min} value={min}>
                  {min === 0 ? "None" : `${min} min`}
                </option>
              ))}
            </NativeSelect>
            <p id={ids.bufferHint} className="sr-only">
              Time kept free after each booking for cleanup or notes.
            </p>
          </div>
        </div>
        <p className="-mt-3 text-body-sm text-muted-foreground">
          Leave the price empty or 0 to show it as Free.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={ids.description} className="text-label">
              Description
            </Label>
            <span className="text-body-sm text-muted-foreground">Optional</span>
          </div>
          <Textarea
            id={ids.description}
            rows={2}
            placeholder="What's included, in one line"
            aria-invalid={!!errors.description || undefined}
            aria-describedby={errors.description ? ids.descriptionError : undefined}
            className="min-h-20 px-3 py-2.5 text-body md:text-body"
            {...register("description")}
          />
          <FieldError id={ids.descriptionError} message={errors.description?.message} />
        </div>

        <p className="flex items-start gap-3 rounded-lg bg-info-soft px-4 py-3 text-body-sm text-info-text">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          One is enough to go live. Add the rest of your menu and your team after setup.
        </p>

        <StepFooter back="/onboarding/brand" pending={pending} />
      </form>
    </StepShell>
  );
}
