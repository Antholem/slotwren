"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";

import { BookingPreview, type PreviewProps } from "@/components/onboarding/booking-preview";
import { StepFooter } from "@/components/onboarding/step-footer";
import { STEP_FORM_ID, StepShell } from "@/components/onboarding/step-shell";
import { BrandColorField, LogoField } from "@/components/shared/brand-fields";
import { HEX_COLOR } from "@/lib/color";
import { type BrandInput, brandSchema } from "@/lib/validation/onboarding";

import { saveBrandAction } from "../actions";
import { useStepSubmit } from "../use-step-submit";

type Props = {
  businessId: string;
  initial: BrandInput;
  preview: PreviewProps;
};

export function BrandForm({ businessId, initial, preview }: Props) {
  const form = useForm<BrandInput>({
    resolver: zodResolver(brandSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { register, setValue, control, formState } = form;
  const { onSubmit, pending, formError } = useStepSubmit(form, saveBrandAction);
  const [brandColor, logoUrl] = useWatch({ control, name: ["brandColor", "logoUrl"] });
  const validColor = HEX_COLOR.test(brandColor) ? brandColor.toUpperCase() : null;

  const ids = { hex: useId(), hexError: useId(), contrast: useId(), logoHelp: useId() };

  return (
    <StepShell
      step={2}
      title="Make it look like yours"
      description="Your logo and colour appear on your booking page, emails and the website widget."
      preview={
        <BookingPreview
          {...preview}
          brandColor={validColor ?? preview.brandColor}
          logoUrl={logoUrl}
        />
      }
    >
      <form id={STEP_FORM_ID} noValidate onSubmit={onSubmit} className="flex flex-col gap-8">
        {formError && (
          <p role="alert" className="text-body-sm text-danger-text">
            {formError}
          </p>
        )}

        <LogoField
          businessId={businessId}
          name={preview.name}
          logoUrl={logoUrl}
          error={formState.errors.logoUrl?.message}
          helpId={ids.logoHelp}
          onChange={(url) => setValue("logoUrl", url, { shouldDirty: true, shouldValidate: true })}
        />

        <BrandColorField
          color={brandColor}
          onPick={(hex) => setValue("brandColor", hex, { shouldDirty: true, shouldValidate: true })}
          hexProps={register("brandColor", {
            setValueAs: (value: string) => (value.startsWith("#") ? value : `#${value}`),
          })}
          error={formState.errors.brandColor?.message}
          ids={ids}
        />

        <StepFooter back="/onboarding/basics" pending={pending} />
      </form>
    </StepShell>
  );
}
