import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Focus ring for a label wrapping a visually hidden radio. */
export const FOCUS_RING =
  "has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background";

/**
 * A selectable card that is a native radio button underneath: arrow keys move
 * through the group, the label is the whole card, and focus shows a ring.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  children,
  trailing,
  leading,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-20 cursor-pointer items-center gap-4 rounded-2xl border bg-card px-5 py-4 transition-colors",
        FOCUS_RING,
        checked ? "border-2 border-primary bg-primary-tint px-[19px]" : "hover:border-input",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-1">{children}</span>
      {trailing}
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          checked ? "bg-primary text-primary-foreground" : "border-2 border-input",
        )}
      >
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
    </label>
  );
}
