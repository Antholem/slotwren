"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { FieldError } from "@/components/onboarding/step-footer";
import { NativeSelect } from "@/components/shared/native-select";
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
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import { blockedTimeSummary, formatMinutes } from "@/lib/durations";
import { centsToInput, formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  BUFFER_CHOICES,
  DURATION_CHOICES,
  type ServiceFormInput,
  serviceFormSchema,
  type ServiceFormValues,
} from "@/lib/validation/services";
import type { DashboardService, StaffOption } from "@/server/db/queries/services";

import { StaffAvatar, StaffNames } from "./staff-chip";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The service being edited, or null for a new one. */
  service: DashboardService | null;
  /** Values to restore after a failed save. */
  draft?: ServiceFormInput;
  serverError?: string;
  staff: StaffOption[];
  canEdit: boolean;
  currency: string;
  currencySymbol: string;
  slotIntervalMin: number;
  onSave: (raw: ServiceFormInput, values: ServiceFormValues) => void;
  onRemove: (service: DashboardService) => void;
};

function initialValues(service: DashboardService | null, staff: StaffOption[]): ServiceFormInput {
  if (!service) {
    return {
      name: "",
      description: "",
      durationMin: 45,
      price: "",
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      active: true,
      // A one-person business shouldn't have to tick themselves.
      staffIds: staff.length === 1 ? [staff[0]!.id] : [],
    };
  }
  return {
    name: service.name,
    description: service.description ?? "",
    durationMin: service.durationMin,
    price: centsToInput(service.priceCents),
    bufferBeforeMin: service.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin,
    active: service.active,
    staffIds: service.staffIds,
  };
}

export function ServiceSheet(props: Props) {
  const { open, onOpenChange, service } = props;
  const desktop = useMediaQuery("(min-width: 768px)", true);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        // Sizes are variant-prefixed to beat SheetContent's own data-[side=…] ones.
        className={cn(
          "gap-0 overflow-x-hidden p-0",
          desktop
            ? "data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
            : "rounded-t-2xl data-[side=bottom]:h-[92dvh]",
        )}
      >
        {/* Remount per service so the form starts from that service's values. */}
        {open && (
          <SheetBody
            key={`${service?.id ?? "new"}-${props.draft ? "draft" : "saved"}`}
            {...props}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody(props: Props) {
  const { service, canEdit } = props;
  const eyebrow = !canEdit ? "Service" : service ? "Edit service" : "New service";
  const title = service?.name ?? "Add a service";

  return (
    <>
      <SheetHeader className="gap-1 border-b px-6 py-5 pr-14">
        <p className="text-body-sm text-muted-foreground">{eyebrow}</p>
        <SheetTitle className="text-heading">{title}</SheetTitle>
        <SheetDescription className="sr-only">
          {canEdit
            ? "Name, length, price, buffers and who offers this service."
            : "Details of this service. Only owners can change it."}
        </SheetDescription>
      </SheetHeader>
      {canEdit ? <EditForm {...props} /> : service && <ReadOnly {...props} service={service} />}
    </>
  );
}

function ReadOnly({
  service,
  staff,
  currency,
  slotIntervalMin,
  onOpenChange,
}: Props & { service: DashboardService }) {
  const rows: [string, React.ReactNode][] = [
    ["Description", service.description ?? "–"],
    ["Duration", formatMinutes(service.durationMin)],
    ["Price", formatPrice(service.priceCents, currency)],
    [
      "Buffers",
      `${service.bufferBeforeMin ? `${service.bufferBeforeMin} min` : "None"} before · ${
        service.bufferAfterMin ? `${service.bufferAfterMin} min` : "none"
      } after`,
    ],
    [
      "Staff who offer it",
      <StaffNames key="staff" staff={staff.filter((m) => service.staffIds.includes(m.id))} />,
    ],
    ["Bookable online", service.active ? "Yes" : "No, hidden from the booking page"],
  ];
  return (
    <>
      <div className="flex flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-6 py-6">
        <dl className="flex flex-col gap-5">
          {rows.map(([term, detail]) => (
            <div key={term}>
              <dt className="text-body-sm text-muted-foreground">{term}</dt>
              <dd className="mt-1 text-body">{detail}</dd>
            </div>
          ))}
        </dl>
        <p className="text-body-sm text-muted-foreground">
          {blockedTimeSummary({ ...service, slotIntervalMin })}
        </p>
      </div>
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
  const { service, staff, draft, serverError, currencySymbol, slotIntervalMin } = props;
  const form = useForm<ServiceFormInput, unknown, ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: draft ?? initialValues(service, staff),
    mode: "onTouched",
  });
  const { register, control, formState, handleSubmit, getValues } = form;
  const { errors } = formState;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [durationMin, bufferBeforeMin, bufferAfterMin] = useWatch({
    control,
    name: ["durationMin", "bufferBeforeMin", "bufferAfterMin"],
  });

  // A failed save reopens the sheet: put the server's field errors back.
  useEffect(() => {
    if (serverError && draft) void form.trigger();
  }, [serverError, draft, form]);

  const ids = {
    name: useId(),
    nameError: useId(),
    description: useId(),
    descriptionError: useId(),
    duration: useId(),
    price: useId(),
    priceError: useId(),
    before: useId(),
    after: useId(),
    buffersHint: useId(),
    staffError: useId(),
    active: useId(),
    activeHint: useId(),
  };
  // Keep an unusual saved duration selectable.
  const durations = [...new Set([...DURATION_CHOICES, Number(durationMin)])].sort((a, b) => a - b);
  const removing = service && service.bookingCount > 0 ? "archive" : "delete";

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => props.onSave(getValues(), values))}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-6 py-6">
        {serverError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-danger-soft px-4 py-3 text-body-sm text-danger-text"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {serverError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.name} className="text-label">
            Name
          </Label>
          <Input
            id={ids.name}
            autoComplete="off"
            placeholder="Colour Refresh"
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? ids.nameError : undefined}
            className="h-11 px-3 text-body md:text-body"
            {...register("name")}
          />
          <FieldError id={ids.nameError} message={errors.name?.message} />
        </div>

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

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.duration} className="text-label">
              Duration
            </Label>
            <NativeSelect
              id={ids.duration}
              className="[&_select]:font-mono [&_select]:tabular-nums"
              {...register("durationMin", { valueAsNumber: true })}
            >
              {durations.map((min) => (
                <option key={min} value={min}>
                  {min} min
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
        </div>

        <fieldset className="flex flex-col gap-2" aria-describedby={ids.buffersHint}>
          <legend className="mb-2 text-label">Buffers</legend>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                ["bufferBeforeMin", "Before", ids.before],
                ["bufferAfterMin", "After", ids.after],
              ] as const
            ).map(([name, label, id]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <Label htmlFor={id} className="text-body-sm font-normal text-muted-foreground">
                  {label}
                </Label>
                <NativeSelect id={id} {...register(name, { valueAsNumber: true })}>
                  {BUFFER_CHOICES.map((min) => (
                    <option key={min} value={min}>
                      {min === 0 ? "None" : `${min} min`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
          <p id={ids.buffersHint} className="text-body-sm text-muted-foreground">
            {blockedTimeSummary({
              durationMin: Number(durationMin) || 0,
              bufferBeforeMin: Number(bufferBeforeMin) || 0,
              bufferAfterMin: Number(bufferAfterMin) || 0,
              slotIntervalMin,
            })}
          </p>
        </fieldset>

        <fieldset
          className="flex flex-col"
          aria-invalid={!!errors.staffIds || undefined}
          aria-describedby={errors.staffIds ? ids.staffError : undefined}
        >
          <legend className="mb-2 text-label">Staff who offer it</legend>
          <Controller
            control={control}
            name="staffIds"
            render={({ field }) => (
              <ul className="divide-y border-y">
                {staff.map((member) => {
                  const checked = field.value.includes(member.id);
                  const checkboxId = `${ids.staffError}-${member.id}`;
                  return (
                    <li key={member.id}>
                      <label
                        htmlFor={checkboxId}
                        className="flex min-h-16 cursor-pointer items-center gap-4 py-3"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onBlur={field.onBlur}
                          onCheckedChange={(on) =>
                            field.onChange(
                              on
                                ? [...field.value, member.id]
                                : field.value.filter((id) => id !== member.id),
                            )
                          }
                          className="size-6"
                        />
                        <StaffAvatar member={member} />
                        <span className="min-w-0">
                          <span className="block text-label">{member.name}</span>
                          {member.title && (
                            <span className="block text-body-sm text-muted-foreground">
                              {member.title}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          />
          <FieldError
            id={ids.staffError}
            message={errors.staffIds?.message ?? errors.staffIds?.root?.message}
          />
        </fieldset>

        <div className="flex items-center justify-between gap-4 rounded-xl border bg-background px-5 py-4">
          <div>
            <Label htmlFor={ids.active} className="text-label">
              Bookable online
            </Label>
            <p id={ids.activeHint} className="text-body-sm text-muted-foreground">
              Shown on your booking page and to the AI receptionist.
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
                onCheckedChange={field.onChange}
                aria-describedby={ids.activeHint}
              />
            )}
          />
        </div>
      </div>

      <SheetFooter className="flex-row flex-wrap items-center gap-3 border-t px-6 py-4">
        {confirmingRemove && service ? (
          <div role="alert" className="flex w-full flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-body-sm">
              {removing === "archive"
                ? `Archive ${service.name}? It has ${service.bookingCount} ${service.bookingCount === 1 ? "booking" : "bookings"}, so it's kept for history and taken off your booking page.`
                : `Delete ${service.name}? Nobody has booked it, so it's removed for good.`}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-4 text-label"
              onClick={() => setConfirmingRemove(false)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              className="h-11 bg-destructive px-4 text-label text-destructive-foreground hover:bg-destructive-hover"
              onClick={() => props.onRemove(service)}
            >
              {removing === "archive" ? "Archive" : "Delete"}
            </Button>
          </div>
        ) : (
          <>
            {service && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto h-11 px-3 text-label text-danger-text hover:bg-danger-soft hover:text-danger-text"
                onClick={() => setConfirmingRemove(true)}
              >
                {removing === "archive" ? "Archive" : "Delete"}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className={cn("h-11 px-5 text-label", !service && "ml-auto")}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 px-5 text-label">
              {service ? "Save changes" : "Add service"}
            </Button>
          </>
        )}
      </SheetFooter>
    </form>
  );
}
