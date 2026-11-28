"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { type EmbedMessage, normalizeOrigin } from "@/lib/embed";

/*
 * The booking page inside the website widget (/b/<slug>?embed=1&host=<origin>,
 * see embed/embed.ts). Remembers it's embedded for this tab (the booking flow
 * moves on to other pages), and tells the host page three things, only ever
 * to the host's own origin: how tall it is (inline mode), "close" on Escape
 * (one press, even with the chat open),
 * and "booked" once a booking is made. Never anything about the customer.
 */

const KEY = "slotwren:embed-host";

/** The host page's origin when this page is the widget's iframe, else null. */
export function embedHost(): string | null {
  if (typeof window === "undefined" || window.parent === window) return null;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("embed") === "1" ? normalizeOrigin(params.get("host")) : null;
  try {
    if (fromUrl) sessionStorage.setItem(KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(KEY);
  } catch {
    return fromUrl;
  }
}

/** Where a booking or chat came from: the website widget, or the booking page itself. */
export function bookingSource(): "widget" | "page" {
  return embedHost() ? "widget" : "page";
}

function post(host: string, message: EmbedMessage) {
  window.parent.postMessage(message, host);
}

export function EmbedBridge() {
  const pathname = usePathname();

  useEffect(() => {
    const host = embedHost();
    if (!host) return;
    document.documentElement.dataset.embed = "1";

    // Inline mode sizes the iframe to the page.
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height !== last) post(host, { type: "slotwren:resize", height: (last = height) });
    });
    observer.observe(document.body);

    // Escape closes the widget in one press, the chat open or not (it closes with
    // it). Only another dialog on the page (a sheet, an alert) takes Escape first.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      if ([...dialogs].some((d) => !d.hasAttribute("data-chat-panel"))) return;
      post(host, { type: "slotwren:close" });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const host = embedHost();
    if (host && /^\/b\/[^/]+\/booked\/[^/]+$/.test(pathname))
      post(host, { type: "slotwren:booked" });
  }, [pathname]);

  return null;
}
