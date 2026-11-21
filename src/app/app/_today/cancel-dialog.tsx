"use client";

import { useId, useState } from "react";

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
import { zoneClock } from "@/lib/zone-clock";

import type { BoardAppointment } from "./today-board";

/** "Cancel this appointment?", with the choice to email the customer (on by default). */
export function CancelDialog({
  appointment,
  zone,
  onClose,
  onConfirm,
}: {
  appointment: BoardAppointment | null;
  zone: string;
  onClose: () => void;
  onConfirm: (appointment: BoardAppointment, notify: boolean) => void;
}) {
  const [notify, setNotify] = useState(true);
  const checkboxId = useId();
  // Keep the text while the dialog animates closed; a new appointment resets the choice.
  const [shown, setShown] = useState(appointment);
  if (appointment && appointment !== shown) {
    setShown(appointment);
    setNotify(true);
  }

  const a = appointment ?? shown;
  const time = a ? zoneClock(zone).parts(a.startsAt.getTime()).time : "";

  return (
    <Dialog open={!!appointment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-6 sm:max-w-md">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-title">Cancel this appointment?</DialogTitle>
          <DialogDescription className="text-body text-muted-foreground">
            {a && (
              <>
                {a.customerName}, {a.serviceName} with {a.staffName} at{" "}
                <span className="font-mono tabular-nums">{time}</span>. The time opens up for
                booking again.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={checkboxId} className="flex min-h-11 cursor-pointer items-center gap-3">
          <Checkbox
            id={checkboxId}
            className="size-5"
            checked={notify}
            onCheckedChange={(on) => setNotify(on === true)}
          />
          <span className="text-body">
            Email {a?.customerName ?? "the customer"} to let them know
          </span>
        </label>
        <DialogFooter className="gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="h-11 px-5 text-label"
          >
            Keep it
          </Button>
          <Button
            type="button"
            onClick={() => a && onConfirm(a, notify)}
            className="h-11 bg-destructive px-5 text-label text-destructive-foreground hover:bg-destructive-hover"
          >
            Cancel appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
