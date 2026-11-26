"use client";

import { CalendarDays, Check, Copy, Loader2, MessageCircle } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { brandTheme } from "@/lib/brand-theme";
import {
  type EmbedPosition,
  type EmbedSettings,
  embedSnippet,
  MAX_ALLOWED_ORIGINS,
  MAX_BUTTON_TEXT,
} from "@/lib/embed";
import { cn } from "@/lib/utils";

import { saveEmbedSettingsAction } from "./actions";

const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const POSITIONS: { value: EmbedPosition; label: string; note: string }[] = [
  {
    value: "bottom-right",
    label: "Bottom right",
    note: "The button floats over every page, bottom right, 24 px from the edges.",
  },
  {
    value: "bottom-left",
    label: "Bottom left",
    note: "The button floats over every page, bottom left, 24 px from the edges.",
  },
  {
    value: "inline",
    label: "Inline",
    note: "The booking page sits inside your page, where you put the code's <div>.",
  },
];

const GUIDES: { title: string; steps: string[] }[] = [
  {
    title: "Plain HTML",
    steps: [
      "Open the page (or the template every page uses) in your editor.",
      "Paste the code just before </body>. For inline, put the <div> where the booking page should appear.",
      "Publish, then open your site and tap the button to check.",
    ],
  },
  {
    title: "WordPress",
    steps: [
      "Floating button: Appearance → Theme File Editor → footer.php, paste before </body>; or use a plugin like WPCode (“Footer” location).",
      "Inline: edit the page, add a Custom HTML block where the booking page goes, and paste the code.",
      "Update the page and check it in a private window.",
    ],
  },
  {
    title: "Wix",
    steps: [
      "Floating button: Settings → Custom code → Add custom code, paste it, choose “All pages” and “Body – end”.",
      "Inline: Add → Embed code → Embed HTML, then paste the code into the box.",
      "Publish your site. (Custom code needs a Wix premium plan.)",
    ],
  },
  {
    title: "Squarespace",
    steps: [
      "Floating button: Website → Pages → Custom code → Code injection, paste into Footer.",
      "Inline: edit the page, add a Code block where the booking page goes, and paste the code.",
      "Save. (Code injection needs a Business plan or higher.)",
    ],
  },
];

export function EmbedView({
  appUrl,
  slug,
  businessName,
  brandColor,
  chatAvailable,
  canEdit,
  initial,
}: {
  appUrl: string;
  slug: string;
  businessName: string;
  brandColor: string;
  /** The AI receptionist is on and the business is on Pro. */
  chatAvailable: boolean;
  canEdit: boolean;
  initial: EmbedSettings;
}) {
  const id = useId();
  const [settings, setSettings] = useState(initial);
  const [sites, setSites] = useState(initial.allowedOrigins.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<EmbedSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const snippet = embedSnippet(appUrl, slug, {
    ...settings,
    showChat: settings.showChat && chatAvailable,
  });
  const position = POSITIONS.find((p) => p.value === settings.position)!;
  const dirty =
    JSON.stringify({ ...settings, allowedOrigins: [] }) !==
      JSON.stringify({ ...initial, allowedOrigins: [] }) ||
    sites.trim() !== initial.allowedOrigins.join("\n");

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveEmbedSettingsAction({
        ...settings,
        allowedOrigins: sites
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (result.ok) {
        setSites(result.data.allowedOrigins.join("\n"));
        toast.success("Widget options saved");
      } else {
        setError(result.error.message);
      }
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the code and copy it instead.");
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <form
          onSubmit={save}
          aria-labelledby={`${id}-options`}
          className="flex flex-col gap-6 rounded-xl border bg-card p-6"
        >
          <h2 id={`${id}-options`} className="text-title">
            Widget options
          </h2>
          {!canEdit && (
            <p className="rounded-lg border p-3 text-body-sm text-muted-foreground">
              Only owners can change these. You can copy the code.
            </p>
          )}
          <fieldset disabled={!canEdit || pending} className="flex flex-col gap-6">
            {settings.position !== "inline" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-label`}>Button text</Label>
                <Input
                  id={`${id}-label`}
                  value={settings.buttonText}
                  maxLength={MAX_BUTTON_TEXT}
                  onChange={(e) => set({ buttonText: e.target.value })}
                  className="h-11 text-body md:text-body"
                  aria-describedby={`${id}-label-count`}
                />
                <p id={`${id}-label-count`} className="text-body-sm text-muted-foreground">
                  {settings.buttonText.length} of {MAX_BUTTON_TEXT} characters
                </p>
              </div>
            )}

            <div
              role="radiogroup"
              aria-labelledby={`${id}-position`}
              className="flex flex-col gap-2"
            >
              <span id={`${id}-position`} className="text-label">
                Position
              </span>
              <div className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1">
                {POSITIONS.map((p) => (
                  <label
                    key={p.value}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-label has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      settings.position === p.value
                        ? "border-primary bg-primary-tint text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-position`}
                      value={p.value}
                      checked={settings.position === p.value}
                      onChange={() => set({ position: p.value })}
                      className="sr-only"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
              <p className="text-body-sm text-muted-foreground">{position.note}</p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${id}-chat`}>Show chat</Label>
                <p id={`${id}-chat-note`} className="text-body-sm text-muted-foreground">
                  {chatAvailable
                    ? "Adds the AI receptionist bubble. It answers questions and books after the customer confirms."
                    : "Needs the AI receptionist (Pro) switched on."}
                </p>
              </div>
              <Switch
                id={`${id}-chat`}
                size="lg"
                checked={settings.showChat && chatAvailable}
                disabled={!chatAvailable || !canEdit || pending}
                onCheckedChange={(on) => set({ showChat: on })}
                aria-describedby={`${id}-chat-note`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-open`}>The button opens</Label>
              <select
                id={`${id}-open`}
                value={chatAvailable ? settings.open : "booking"}
                onChange={(e) => set({ open: e.target.value === "chat" ? "chat" : "booking" })}
                className={cn(
                  "h-11 rounded-lg border border-input bg-card px-3 text-body",
                  focusRing,
                )}
              >
                <option value="booking">Booking</option>
                <option value="chat" disabled={!chatAvailable}>
                  The AI chat
                </option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-sites`}>Allowed websites</Label>
              <Textarea
                id={`${id}-sites`}
                value={sites}
                onChange={(e) => setSites(e.target.value)}
                rows={3}
                placeholder="www.your-website.com"
                className="font-mono text-body-sm md:text-body-sm"
                aria-describedby={`${id}-sites-note`}
              />
              <p id={`${id}-sites-note`} className="text-body-sm text-muted-foreground">
                One per line, up to {MAX_ALLOWED_ORIGINS}. Empty: any website can show your widget.
                With a list, other sites can&apos;t.
              </p>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-body-sm text-danger-text">
              {error}
            </p>
          )}
          {canEdit && (
            <Button
              type="submit"
              className="h-11 w-fit px-5 text-label"
              disabled={pending || !dirty}
            >
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Save options
            </Button>
          )}
        </form>

        <section
          aria-labelledby={`${id}-code`}
          className="flex flex-col gap-4 rounded-xl border bg-card p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id={`${id}-code`} className="text-title">
              Embed code
            </h2>
            <Button type="button" className="h-11 px-4 text-label" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy code"}
            </Button>
          </div>
          <p className="text-body text-muted-foreground">
            Paste this just before &lt;/body&gt; on every page of your site
            {settings.position === "inline" ? ", with the <div> where the booking page goes" : ""}.
            {dirty && canEdit ? " Save your options first: the code reads them." : ""}
          </p>
          <pre
            aria-label="Embed code"
            tabIndex={0}
            className={cn(
              "overflow-x-auto rounded-lg bg-foreground p-4 font-mono text-body-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-background",
              focusRing,
            )}
          >
            {snippet}
          </pre>
          <span aria-live="polite" className="sr-only">
            {copied ? "Embed code copied" : ""}
          </span>
        </section>

        <section
          aria-labelledby={`${id}-guides`}
          className="flex flex-col gap-3 rounded-xl border bg-card p-6"
        >
          <h2 id={`${id}-guides`} className="text-title">
            Install guides
          </h2>
          {GUIDES.map((guide) => (
            <details key={guide.title} className="group rounded-lg border">
              <summary
                className={cn(
                  "flex min-h-11 cursor-pointer items-center px-4 text-label marker:content-none",
                  focusRing,
                )}
              >
                {guide.title}
              </summary>
              <ol className="list-decimal flex-col gap-2 px-4 pb-4 pl-9 text-body-sm">
                {guide.steps.map((step) => (
                  <li key={step} className="py-1">
                    {step}
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </section>
      </div>

      <section aria-labelledby={`${id}-preview`} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${id}-preview`} className="text-title">
            Live preview
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Sample website · updates as you change options
          </p>
        </div>
        <Preview
          name={businessName}
          brandColor={brandColor}
          settings={{ ...settings, showChat: settings.showChat && chatAvailable }}
        />
      </section>
    </div>
  );
}

/** A sample website with the widget as it will look (not interactive). */
function Preview({
  name,
  brandColor,
  settings,
}: {
  name: string;
  brandColor: string;
  settings: EmbedSettings;
}) {
  const theme = brandTheme(brandColor);
  const colors = theme
    ? { background: theme.light.primary, color: theme.light.primaryForeground }
    : { background: "#0F766E", color: "#FFFFFF" };
  const left = settings.position === "bottom-left";
  return (
    <div
      aria-hidden="true"
      className="relative flex min-h-[32rem] flex-col overflow-hidden rounded-xl border bg-[#fbfaf9] text-[#1c1917] shadow-sm"
    >
      <div className="flex items-center gap-3 border-b bg-[#f5f5f4] px-4 py-3">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-[#d6d3d1]" />
          ))}
        </span>
        <span className="flex-1 truncate rounded-md bg-white px-3 py-1 font-mono text-[13px] text-[#57534e]">
          [your-website].com
        </span>
      </div>
      <div className="flex items-center justify-between border-b px-6 py-4 font-serif">
        <span className="text-[22px]">{name}</span>
        <span className="hidden gap-6 text-[14px] text-[#57534e] sm:flex">
          <span>Services</span>
          <span>Team</span>
          <span>Visit</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-6 py-8 font-serif">
        <p className="max-w-lg text-[32px] leading-tight">Welcome to {name}.</p>
        <p className="max-w-lg text-[15px] text-[#57534e]">
          Your own website, with booking a tap away.
        </p>
        {settings.position === "inline" ? (
          <div className="mt-2 flex min-h-56 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#d6d3d1] bg-white p-6 text-center font-sans text-[14px] text-[#57534e]">
            <CalendarDays className="size-6" style={{ color: colors.background }} />
            The booking page appears here, inside your page.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-[#e7e5e4]" />
            ))}
          </div>
        )}
      </div>
      {settings.position !== "inline" && (
        <div
          className={cn(
            "absolute bottom-6 flex items-center gap-3 font-sans",
            left ? "left-6 flex-row-reverse" : "right-6",
          )}
        >
          <span
            className="inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-[16px] font-semibold shadow-lg"
            style={colors}
          >
            <CalendarDays className="size-5" />
            {settings.buttonText || "Book now"}
          </span>
          {settings.showChat && (
            <span
              className="inline-flex size-14 items-center justify-center rounded-full bg-white shadow-lg"
              style={{ color: colors.background }}
            >
              <MessageCircle className="size-6" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
