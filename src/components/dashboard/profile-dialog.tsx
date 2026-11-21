"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FieldError } from "@/components/onboarding/step-footer";
import { Button } from "@/components/ui/button";
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
import type { Result } from "@/lib/result";
import { profileSchema, type ProfileValues } from "@/lib/validation/profile";

export type SaveProfile = (input: ProfileValues) => Promise<Result<{ name: string }, string>>;

/** "Your profile": the name the dashboard shows for you (account menu). */
export function ProfileDialog({
  open,
  onOpenChange,
  name,
  email,
  saveProfile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string | null;
  email: string | null;
  saveProfile: SaveProfile;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 sm:max-w-md">
        {open && (
          <ProfileForm
            name={name}
            email={email}
            saveProfile={saveProfile}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({
  name,
  email,
  saveProfile,
  onDone,
}: {
  name: string | null;
  email: string | null;
  saveProfile: SaveProfile;
  onDone: () => void;
}) {
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: name ?? "" },
    mode: "onTouched",
  });
  const { register, handleSubmit, formState, setError } = form;
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { name: useId(), error: useId(), hint: useId() };

  const submit = handleSubmit((values) =>
    startTransition(async () => {
      setFormError(null);
      const result = await saveProfile(values);
      if (result.ok) {
        toast.success("Profile saved");
        onDone();
        return;
      }
      const message = result.error.fieldErrors?.name?.[0];
      if (message) setError("name", { message }, { shouldFocus: true });
      else setFormError(result.error.message);
    }),
  );

  const error = formState.errors.name?.message;
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <DialogHeader className="gap-2">
        <DialogTitle className="text-title">Your profile</DialogTitle>
        <DialogDescription className="text-body text-muted-foreground">
          {email ? <>Signed in as {email}.</> : null} Your name shows in the dashboard for you and
          your team.
        </DialogDescription>
      </DialogHeader>
      {formError && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-4 py-3 text-body-sm text-danger-text"
        >
          {formError}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.name} className="text-label">
          Name
        </Label>
        <Input
          id={ids.name}
          autoComplete="name"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${ids.error} ${ids.hint}` : ids.hint}
          className="h-11 px-3 text-body md:text-body"
          {...register("name")}
        />
        <FieldError id={ids.error} message={error} />
        <p id={ids.hint} className="text-body-sm text-muted-foreground">
          Customers see the name on your staff profile, which you change on the Staff page.
        </p>
      </div>
      <DialogFooter className="gap-3">
        <Button type="button" variant="secondary" onClick={onDone} className="h-11 px-5 text-label">
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="h-11 px-5 text-label">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
