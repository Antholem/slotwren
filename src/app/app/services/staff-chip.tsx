import { cn } from "@/lib/utils";
import type { StaffOption } from "@/server/db/queries/services";

const DOT = { teal: "bg-staff-teal", violet: "bg-staff-violet", pink: "bg-staff-pink" } as const;
const AVATAR = {
  teal: "bg-staff-teal-soft text-staff-teal-text",
  violet: "bg-staff-violet-soft text-staff-violet-text",
  pink: "bg-staff-pink-soft text-staff-pink-text",
} as const;

/** Colour dot plus name: the colour is never the only cue. */
export function StaffNames({ staff, className }: { staff: StaffOption[]; className?: string }) {
  if (staff.length === 0) return <span className="text-muted-foreground">Nobody yet</span>;
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {staff.map((member) => (
        <span key={member.id} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[member.color])} />
          {member.name}
        </span>
      ))}
    </span>
  );
}

export function StaffAvatar({ member }: { member: StaffOption }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full text-label",
        AVATAR[member.color],
      )}
    >
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
