/**
 * Lumen Studio: the demo business behind "Try the live demo". Values match the
 * mockups in docs/design/ (names, services, prices, hours, time off, notes).
 */

export const BUSINESS = {
  slug: "lumen-studio",
  name: "Lumen Studio",
  timezone: "Asia/Manila", // mockups: "Times shown in your timezone (GMT+8)"
  currency: "USD",
  brandColor: "#0F766E",
  address: "[Street address], [City]",
  phone: null,
  contactEmail: "hello@lumen-studio.example.com",
  minNoticeMin: 120,
  maxDaysAhead: 60,
  slotIntervalMin: 30,
  cancellationWindowHours: 24, // "Free cancellation up to 24 h before"
  plan: "pro",
  aiEnabled: true,
  isDemo: true,
  settings: {
    embed: { buttonText: "Book now", position: "bottom-right", showChat: true },
    notifications: { ownerNewBookingEmail: true },
  },
} as const;

/** The demo owner signs in as Mia (Senior stylist · Admin). */
export const DEMO_OWNER = {
  email: "demo-owner@lumen-studio.example.com",
  fullName: "Mia",
} as const;

export type StaffKey = "mia" | "jonah" | "aiko";
export type ServiceKey = "haircut" | "colour" | "scalp" | "blowout" | "bridal" | "consultation";

export const STAFF: { key: StaffKey; name: string; title: string; email: string }[] = [
  { key: "mia", name: "Mia", title: "Senior stylist", email: "mia@lumen-studio.example.com" },
  { key: "jonah", name: "Jonah", title: "Stylist", email: "jonah@lumen-studio.example.com" },
  {
    key: "aiko",
    name: "Aiko",
    title: "Stylist · scalp care",
    email: "aiko@lumen-studio.example.com",
  },
];

export type ServiceSeed = {
  key: ServiceKey;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staff: StaffKey[];
  /** Relative popularity for generated bookings. */
  weight: number;
};

// Mia offers 5 services, Jonah 4, Aiko 5 (staff cards in the Staff mockup).
export const SERVICES: ServiceSeed[] = [
  {
    key: "haircut",
    name: "Haircut & Style",
    description: "Wash, cut and finish",
    durationMin: 45,
    priceCents: 3500,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staff: ["mia", "jonah", "aiko"],
    weight: 10,
  },
  {
    key: "colour",
    name: "Colour Refresh",
    description: "Root touch-up or gloss",
    durationMin: 90,
    priceCents: 8000,
    bufferBeforeMin: 0,
    bufferAfterMin: 15,
    staff: ["mia", "jonah"],
    weight: 4,
  },
  {
    key: "scalp",
    name: "Scalp Treatment",
    description: "Exfoliate, mask, massage",
    durationMin: 30,
    priceCents: 2500,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staff: ["aiko"],
    weight: 4,
  },
  {
    key: "blowout",
    name: "Blowout",
    description: "Wash and blow-dry",
    durationMin: 30,
    priceCents: 2200,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staff: ["mia", "jonah", "aiko"],
    weight: 5,
  },
  {
    key: "bridal",
    name: "Bridal Trial",
    description: "Hair and styling run-through",
    durationMin: 120,
    priceCents: 12000,
    bufferBeforeMin: 0,
    bufferAfterMin: 15,
    staff: ["mia", "aiko"],
    weight: 1,
  },
  {
    key: "consultation",
    name: "Consultation",
    description: "Talk through a new look",
    durationMin: 15,
    priceCents: 0,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staff: ["mia", "jonah", "aiko"],
    weight: 2,
  },
];

/** Weekly hours in business-local time. Weekday 0 = Sunday. Studio closed Mondays. */
export const HOURS: Record<StaffKey, { weekday: number; start: string; end: string }[]> = {
  mia: [2, 3, 4, 5, 6, 0].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
  jonah: [2, 3, 4, 5, 6, 0].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
  aiko: [
    ...[2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
    { weekday: 0, start: "09:00", end: "13:00" },
  ],
};

/**
 * Time off, relative to the seed date so the nightly demo reset always shows
 * upcoming entries (Staff mockup: Aiko has a training day and a holiday).
 * A numeric `when` is a day offset from today in the business timezone.
 */
export type TimeOffRule = {
  staff: StaffKey;
  reason: string;
  days: number;
  /** "next-friday-after-a-week" | "christmas" | a day offset from today */
  when: "next-friday-after-a-week" | "christmas" | number;
};

export const TIME_OFF: TimeOffRule[] = [
  { staff: "aiko", reason: "Training", days: 1, when: "next-friday-after-a-week" },
  { staff: "aiko", reason: "Holiday", days: 3, when: "christmas" }, // 24–26 Dec
  { staff: "jonah", reason: "Family visit", days: 2, when: 18 },
];

export const FAQS: { question: string; answer: string }[] = [
  {
    question: "What are your opening hours?",
    answer: "Tuesday to Sunday, 9:00 – 18:00. Closed on Mondays.",
  },
  {
    question: "How much is a haircut?",
    answer: "Haircut & Style is $35 and takes 45 minutes.",
  },
  {
    question: "Do you offer consultations?",
    answer: "Yes, a free 15-minute consultation with any of our stylists.",
  },
  { question: "Where are you?", answer: "[Street address], [City]." },
  {
    question: "Can I cancel or reschedule?",
    answer:
      "Yes. Free cancellation up to 24 h before your appointment. Use the Manage booking link in your confirmation email.",
  },
  {
    question: "Is there parking nearby?",
    answer: "Yes, there's a public car park two minutes' walk away. Street parking is limited.",
  },
  {
    question: "Do you do keratin treatments?",
    answer:
      "Not at the moment. Our Scalp Treatment and Colour Refresh are the closest options; book a free consultation to talk it through.",
  },
  {
    question: "How can I pay?",
    answer: "Card, cash or GCash at the studio after your appointment. Nothing is charged online.",
  },
];

/** 40 customers. Ana Santos and her private note come from the customer-profile mockup. */
export const CUSTOMERS: {
  name: string;
  phone?: string;
  notes?: string;
  timezone?: string;
  /** Relative visit frequency: regulars book more. */
  weight?: number;
}[] = [
  {
    name: "Ana Santos",
    notes:
      "Sensitive scalp: patch test 48 h before any colour. Prefers a quiet chair near the window.",
    weight: 4,
  },
  { name: "Liam Ortiz", phone: "+63 917 555 0102", weight: 3 },
  { name: "Hana Ito", timezone: "Asia/Tokyo", weight: 2 },
  { name: "Mei Wong", phone: "+63 917 555 0104", weight: 3 },
  { name: "Carlos Reyes", phone: "+63 917 555 0105", weight: 2 },
  { name: "Sofia Cruz", notes: "Likes a strong espresso while she waits.", weight: 3 },
  { name: "Daniel Lim", phone: "+63 917 555 0107" },
  { name: "Isabel Garcia", weight: 2 },
  { name: "Noah Tan", phone: "+63 917 555 0109" },
  {
    name: "Grace Villanueva",
    notes: "Allergic to some fragrances; use unscented products.",
    weight: 2,
  },
  { name: "Ethan Mendoza" },
  { name: "Chloe Bautista", phone: "+63 917 555 0112", weight: 2 },
  { name: "Lucas Navarro" },
  { name: "Aria Domingo", phone: "+63 917 555 0114" },
  { name: "Mateo Ramos", weight: 2 },
  { name: "Emma Fernandez", timezone: "Europe/London" },
  { name: "Kai Nakamura", phone: "+63 917 555 0117", timezone: "Asia/Tokyo" },
  { name: "Olivia Aquino", weight: 2 },
  { name: "Gabriel Castillo", phone: "+63 917 555 0119" },
  { name: "Mia Torres" },
  { name: "Leo Santiago", phone: "+63 917 555 0121" },
  { name: "Zoe Mercado", notes: "Growing hair out; trims only." },
  { name: "Ryan Chua", phone: "+63 917 555 0123", weight: 2 },
  { name: "Lily Pascual" },
  { name: "Adrian Soriano", phone: "+63 917 555 0125" },
  { name: "Nina Herrera", timezone: "Australia/Sydney" },
  { name: "Marco Dela Cruz", phone: "+63 917 555 0127" },
  { name: "Camille Rivera", weight: 2 },
  { name: "Joshua Ong", phone: "+63 917 555 0129" },
  { name: "Bea Salazar", notes: "Bridal party in December; book trial with Mia." },
  { name: "Paolo Gutierrez" },
  { name: "Andrea Valdez", phone: "+63 917 555 0132" },
  { name: "Sam Patel", timezone: "Europe/London" },
  { name: "Erin Walsh", timezone: "Australia/Sydney" },
  { name: "Tomas Morales", phone: "+63 917 555 0135" },
  { name: "Jasmine Sy" },
  { name: "Miguel Robles", phone: "+63 917 555 0137" },
  { name: "Clara Lopez" },
  { name: "Ben Hughes", timezone: "Europe/London" },
  { name: "Rina Kobayashi", phone: "+63 917 555 0140", timezone: "Asia/Tokyo" },
];

export const PAST_BOOKING_TARGET = 120;
export const UPCOMING_BOOKING_TARGET = 30;
/** Past bookings spread over this many days before today. */
export const PAST_WINDOW_DAYS = 56;
/** Upcoming bookings spread over this many days from today. */
export const UPCOMING_WINDOW_DAYS = 21;
