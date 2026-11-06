"use server";

import { refresh } from "next/cache";

import type { Result } from "@/lib/result";
import { getDashboardContext } from "@/server/auth/dashboard";
import {
  addTimeOff,
  editTimeOff,
  removeTimeOff,
  saveStaffHours,
  type ScheduleActor,
} from "@/server/catalog/schedule";
import type { Actor } from "@/server/catalog/services";
import {
  inviteExistingStaff,
  inviteStaff,
  resendInvite,
  revokeInvite,
  saveStaff,
  type StaffActor,
} from "@/server/catalog/staff";
import { myStaffName } from "@/server/db/queries/staff";

/*
 * Staff page actions: who is acting comes from the session, never the client;
 * the work is in src/server/catalog/staff.ts. Success refreshes the page so
 * optimistic changes settle on saved data.
 */

async function actor(): Promise<Actor> {
  const { claims, business, role } = await getDashboardContext();
  return { claims, businessId: business.id, role };
}

async function inviter(): Promise<StaffActor> {
  const { claims, business, role } = await getDashboardContext();
  return {
    claims,
    businessId: business.id,
    role,
    businessName: business.name,
    actorName: await myStaffName(claims, business.id),
  };
}

function settle<T extends Result<unknown, string>>(result: T): T {
  if (result.ok) refresh();
  return result;
}

export async function saveStaffAction(input: unknown, staffId?: string) {
  return settle(await saveStaff(await actor(), input, staffId));
}

export async function inviteStaffAction(input: unknown) {
  return settle(await inviteStaff(await inviter(), input));
}

export async function inviteExistingStaffAction(staffId: string, input: unknown) {
  return settle(await inviteExistingStaff(await inviter(), staffId, input));
}

export async function resendInviteAction(inviteId: string) {
  return settle(await resendInvite(await inviter(), inviteId));
}

export async function revokeInviteAction(inviteId: string) {
  return settle(await revokeInvite(await actor(), inviteId));
}

// ── Weekly hours and time off (owners: anyone; staff: themselves) ───────

async function scheduler(): Promise<ScheduleActor> {
  const { claims, business, role } = await getDashboardContext();
  return {
    claims,
    businessId: business.id,
    role,
    timezone: business.timezone,
    slotIntervalMin: business.slotIntervalMin,
    openingHours: business.openingHours,
  };
}

export async function saveStaffHoursAction(staffId: string, input: unknown) {
  return settle(await saveStaffHours(await scheduler(), staffId, input));
}

export async function addTimeOffAction(staffId: string, input: unknown) {
  return settle(await addTimeOff(await scheduler(), staffId, input));
}

export async function editTimeOffAction(timeOffId: string, input: unknown) {
  return settle(await editTimeOff(await scheduler(), timeOffId, input));
}

export async function removeTimeOffAction(timeOffId: string) {
  return settle(await removeTimeOff(await scheduler(), timeOffId));
}
