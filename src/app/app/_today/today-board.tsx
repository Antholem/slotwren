"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import type { Span } from "@/lib/timeline";
import type { AppointmentStatus } from "@/lib/today";
import type { TodayAppointment, TodayStaff } from "@/server/db/queries/today";

import { cancelFromTodayAction, recordOutcomeAction } from "../actions";
import { CancelDialog } from "./cancel-dialog";
import { NowAndNext } from "./now-and-next";
import { Timeline } from "./timeline";

export type BoardAppointment = TodayAppointment & {
  staffName: string;
  staffColor: TodayStaff["color"];
};

type Change = { id: string; status: AppointmentStatus };

const TICK_MS = 30_000;

/**
 * The live part of Today: a clock that ticks every 30 seconds (the "now" line
 * and each appointment's state follow it), and the quick actions, applied
 * optimistically and settled by the server's refresh (or rolled back with a
 * toast when the booking service refuses).
 */
export function TodayBoard({
  zone,
  now: serverNow,
  dayStart,
  dayEnd,
  grid,
  staff,
  appointments,
  mine,
  aside,
}: {
  zone: string;
  now: Date;
  dayStart: Date;
  dayEnd: Date;
  grid: Span;
  staff: TodayStaff[];
  appointments: BoardAppointment[];
  mine: boolean;
  aside: ReactNode;
}) {
  const now = useNow(serverNow);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, apply] = useOptimistic(appointments, (state, change: Change) =>
    state.map((a) => (a.id === change.id ? { ...a, status: change.status } : a)),
  );
  const [cancelling, setCancelling] = useState<BoardAppointment | null>(null);

  // The day is over: load the next one.
  useEffect(() => {
    if (now.getTime() >= dayEnd.getTime()) router.refresh();
  }, [now, dayEnd, router]);

  function mark(appointment: BoardAppointment, outcome: "completed" | "no_show") {
    startTransition(async () => {
      apply({ id: appointment.id, status: outcome });
      const result = await recordOutcomeAction(appointment.id, outcome);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        outcome === "completed"
          ? `${appointment.customerName}: marked complete`
          : `${appointment.customerName}: marked no-show`,
      );
    });
  }

  function cancel(appointment: BoardAppointment, notify: boolean) {
    setCancelling(null);
    startTransition(async () => {
      apply({ id: appointment.id, status: "cancelled" });
      const result = await cancelFromTodayAction(appointment.id, notify);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${appointment.customerName}'s appointment is cancelled`, {
        description:
          result.data.notified === null
            ? undefined
            : result.data.notified
              ? "We've emailed them."
              : "Email isn't set up yet, so they weren't emailed.",
      });
    });
  }

  const shown = optimistic.filter((a) => a.status !== "cancelled");

  return (
    <>
      <Timeline
        zone={zone}
        now={now}
        day={{ dayStart, dayEnd }}
        grid={grid}
        staff={staff}
        appointments={shown}
        mine={mine}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <NowAndNext
          zone={zone}
          now={now}
          staff={staff}
          appointments={shown}
          onMark={mark}
          onCancel={setCancelling}
          className={aside ? undefined : "lg:col-span-2"}
        />
        {aside}
      </div>
      <CancelDialog
        appointment={cancelling}
        zone={zone}
        onClose={() => setCancelling(null)}
        onConfirm={cancel}
      />
    </>
  );
}

/** The current time: the server's clock first (so hydration matches), then ticking. */
function useNow(initial: Date): Date {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
