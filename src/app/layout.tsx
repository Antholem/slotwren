import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeWatcher } from "@/components/shared/theme";
import { THEME_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Slotwren — Your front desk, open 24/7",
    template: "%s · Slotwren",
  },
  description:
    "Booking, reminders and an AI receptionist for small service businesses. Set up in 10 minutes, embed anywhere.",
  // Brand assets live in public/brand/. The SVG favicon is the simplified mark
  // (no eye) that stays legible at 16 px; PNGs cover browsers without SVG icons.
  icons: {
    icon: [
      { url: "/brand/slotwren-favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: { url: "/brand/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets class="dark" before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
