"use client";

import { ChevronDown, MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { embedHost } from "@/components/booking/embed-bridge";

import { cn } from "@/lib/utils";

import type { ChatPanelProps } from "./chat-panel";

/*
 * "Ask us anything": the AI receptionist's button on the booking page (only
 * when the business has AI on and is on Pro). This is the only chat code in
 * the page's bundle; the panel, the AI SDK client and the cards load on the
 * first tap (or on hover/focus, a moment earlier), so the booking page's
 * Lighthouse score doesn't pay for the chat.
 */

const loadPanel = () => import("./chat-panel");
const ChatPanel = dynamic<ChatPanelProps>(() => loadPanel().then((m) => m.ChatPanel), {
  ssr: false,
});

export type ChatLauncherProps = Omit<
  ChatPanelProps,
  "open" | "onOpenChange" | "launcherRef" | "onUnread"
>;

export function ChatLauncher(props: ChatLauncherProps) {
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    setOpened(true);
    setUnread(false);
    setOpen((value) => !value);
  }

  // The website widget's chat bubble opens the page with ?chat=1: straight into the chat.
  useEffect(() => {
    if (!embedHost() || new URLSearchParams(window.location.search).get("chat") !== "1") return;
    const frame = requestAnimationFrame(() => {
      setOpened(true);
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={toggle}
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          // Above the phone's sticky Continue bar; bottom-right on desktop.
          "fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-label text-primary-foreground shadow-lg hover:bg-primary-hover lg:right-6 lg:bottom-6",
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "motion-safe:transition-colors",
          open && "max-lg:hidden",
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-5" />
        ) : (
          <MessageCircle aria-hidden className="size-5" />
        )}
        {open ? "Hide chat" : "Ask us anything"}
        {unread && !open && (
          <span className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-highlight">
            <span className="sr-only"> (new reply)</span>
          </span>
        )}
      </button>
      {opened && (
        <ChatPanel
          {...props}
          open={open}
          onOpenChange={setOpen}
          launcherRef={launcherRef}
          onUnread={() => setUnread(true)}
        />
      )}
    </>
  );
}
