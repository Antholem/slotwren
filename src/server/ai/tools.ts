import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  checkAvailability,
  listServices,
  lookUpBooking,
  proposeBooking,
  proposeCancel,
  proposeReschedule,
  type ReceptionistScope,
} from "./receptionist";

/*
 * The AI receptionist's tools (CLAUDE.md, rule 7: the AI never writes). Three
 * read, three propose; none creates, moves or cancels a booking. Only the
 * customer's Confirm tap does that (/api/chat/[slug]/confirm).
 *
 * The scope is bound here from the route. No tool takes a business, a
 * conversation, a price or a status: arguments the model invents for those
 * are stripped by the schemas before anything runs.
 */

const serviceRef = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("The service's id from listServices (or its exact name).");
const staffRef = z
  .string()
  .trim()
  .max(120)
  .optional()
  .describe("A staff member's id or name. Omit when the customer has no preference.");
const startsAt = z.iso
  .datetime({ offset: true })
  .describe("The exact startsAt of a time returned by checkAvailability. Never make one up.");
const code = z.string().trim().min(4).max(20).describe('The booking code, e.g. "SW-8K3D-27".');
const email = z.string().trim().min(3).max(254).describe("The email the booking was made with.");

export function receptionistTools(scope: ReceptionistScope) {
  return {
    listServices: tool({
      description: "List the bookable services with their ids, durations, prices and staff.",
      inputSchema: z.object({}),
      execute: () => listServices(scope),
    }),
    checkAvailability: tool({
      description:
        "Free start times for a service. Dates are in the business's timezone (resolve words like " +
        '"Saturday" from the calendar in your instructions); times come back in the customer\'s ' +
        "timezone. Always call this before offering or proposing a time.",
      inputSchema: z.object({
        service: serviceRef,
        staff: staffRef,
        date: z.iso.date().describe("First day to check, YYYY-MM-DD."),
        days: z.number().int().min(1).max(7).optional().describe("Days to check (1–7)."),
        partOfDay: z
          .enum(["morning", "afternoon", "evening", "any"])
          .optional()
          .describe("Only morning (before 12:00), afternoon (12–17) or evening (17:00 on)."),
      }),
      execute: (input) => checkAvailability(scope, input),
    }),
    lookUpBooking: tool({
      description:
        "Find the customer's own booking. Needs both its code and the email it was booked with.",
      inputSchema: z.object({ code, email }),
      execute: (input) => lookUpBooking(scope, input),
    }),
    proposeBooking: tool({
      description:
        "Propose a booking for the customer to confirm. Books nothing: the customer must tap " +
        "Confirm on the card. Needs a time from checkAvailability plus the customer's name and email.",
      inputSchema: z.object({
        service: serviceRef,
        staff: staffRef,
        startsAt,
        name: z.string().trim().min(1).max(80).describe("The customer's name."),
        email: z.string().trim().min(3).max(254).describe("The customer's email."),
        phone: z.string().trim().max(40).optional().describe("Optional phone number."),
      }),
      execute: (input) => proposeBooking(scope, input),
    }),
    proposeReschedule: tool({
      description:
        "Propose moving the customer's booking to a new time. Changes nothing until the customer " +
        "taps Confirm. Needs the code, the email and a time from checkAvailability.",
      inputSchema: z.object({ code, email, startsAt, staff: staffRef }),
      execute: (input) => proposeReschedule(scope, input),
    }),
    proposeCancel: tool({
      description:
        "Propose cancelling the customer's booking. Cancels nothing until the customer taps Confirm.",
      inputSchema: z.object({ code, email }),
      execute: (input) => proposeCancel(scope, input),
    }),
  };
}

export type ReceptionistTools = ReturnType<typeof receptionistTools>;
