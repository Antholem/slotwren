"use client";

import { type FormEvent, useState, useTransition } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import type { Result } from "@/lib/result";

import { leaveSetup } from "./actions";

type Intent = "continue" | "later";
type StepAction = (values: unknown, intent: Intent) => Promise<Result<never, string>>;

/**
 * Submit a wizard step: validate on the client, send the *raw* values to the
 * server action (which validates again and redirects on success), and map
 * server field errors back onto the form.
 *
 * "Save and finish later" (top bar) submits the same form with intent=later.
 * If the step isn't valid yet, it signs out without saving this step;
 * earlier steps are already saved.
 */
export function useStepSubmit<T extends FieldValues>(form: UseFormReturn<T>, action: StepAction) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent: Intent = submitter?.value === "later" ? "later" : "continue";

    void form.handleSubmit(
      () =>
        startTransition(async () => {
          setFormError(null);
          const result = await action(form.getValues(), intent);
          if (result.ok) return;
          const fieldErrors = Object.entries(result.error.fieldErrors ?? {});
          fieldErrors.forEach(([name, messages], i) =>
            form.setError(name as Path<T>, { message: messages[0] }, { shouldFocus: i === 0 }),
          );
          if (fieldErrors.length === 0) setFormError(result.error.message);
        }),
      () => {
        if (intent === "later") {
          startTransition(async () => {
            await leaveSetup();
          });
        }
      },
    )(event);
  }

  return { onSubmit, pending, formError };
}
