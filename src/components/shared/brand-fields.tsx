"use client";

import { CircleAlert, CircleCheck, Loader2, Upload } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { FieldError } from "@/components/onboarding/step-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AA_TEXT,
  BRAND_SWATCHES,
  contrastRatio,
  formatRatio,
  HEX_COLOR,
  INK,
  initialsOf,
  WHITE,
} from "@/lib/color";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { LOGO_MAX_BYTES, LOGO_MIN_PX, LOGO_TYPES } from "@/lib/validation/onboarding";

/*
 * Logo upload and brand colour. Shared by onboarding's brand step and
 * Settings → Business.
 */

const EXTENSIONS: Record<(typeof LOGO_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

type BrandColorProps = {
  /** The current value of the hex field. */
  color: string;
  onPick: (hex: string) => void;
  hexProps: UseFormRegisterReturn;
  error?: string;
  ids: { hex: string; hexError: string; contrast: string };
};

/** Swatches, a hex field and the AA contrast note. */
export function BrandColorField({ color, onPick, hexProps, error, ids }: BrandColorProps) {
  const validColor = HEX_COLOR.test(color) ? color.toUpperCase() : null;
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-4 text-label">Brand colour</legend>
      <div className="flex flex-wrap gap-3">
        {BRAND_SWATCHES.map((swatch) => {
          const selected = validColor === swatch.hex;
          return (
            <label key={swatch.hex} className="relative size-12 cursor-pointer">
              <input
                type="radio"
                name="brand-swatch"
                value={swatch.hex}
                checked={selected}
                onChange={() => onPick(swatch.hex)}
                className="peer sr-only"
              />
              <span className="sr-only">
                {swatch.name} {swatch.hex}
              </span>
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full ring-offset-2 ring-offset-card peer-checked:ring-3 peer-checked:ring-current peer-focus-visible:outline-3 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
                style={{ backgroundColor: swatch.hex, color: swatch.hex }}
              >
                {selected && <CircleCheck className="size-6 text-white" strokeWidth={2.5} />}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label htmlFor={ids.hex} className="text-body text-muted-foreground">
          Hex
        </Label>
        <Input
          id={ids.hex}
          spellCheck={false}
          autoCapitalize="characters"
          maxLength={7}
          aria-invalid={!!error || undefined}
          aria-describedby={`${ids.contrast} ${error ? ids.hexError : ""}`}
          className="h-11 w-36 px-3 font-mono text-mono-lg uppercase tabular-nums md:text-mono-lg"
          {...hexProps}
        />
        <ContrastNote id={ids.contrast} color={validColor} />
      </div>
      <FieldError id={ids.hexError} message={error} />
    </fieldset>
  );
}

/** "White text on this colour: 5.47:1 · passes AA", or what we'll do instead. */
function ContrastNote({ id, color }: { id: string; color: string | null }) {
  if (!color) return <span id={id} />;
  const white = contrastRatio(color, WHITE);
  if (white >= AA_TEXT) {
    return (
      <p id={id} className="flex items-center gap-1.5 text-body-sm text-success-text">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        <span>
          White text on this colour:{" "}
          <span className="font-mono text-mono tabular-nums">{formatRatio(white)}</span> · passes AA
        </span>
      </p>
    );
  }
  const ink = contrastRatio(color, INK);
  return (
    <p id={id} className="flex items-center gap-1.5 text-body-sm text-warning-text">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span>
        White text: <span className="font-mono text-mono tabular-nums">{formatRatio(white)}</span>,
        below AA.{" "}
        {ink >= AA_TEXT
          ? `Buttons will use dark text (${formatRatio(ink)}).`
          : "Pick a darker or lighter colour so button text stays readable."}
      </span>
    </p>
  );
}

type LogoFieldProps = {
  businessId: string;
  name: string;
  logoUrl: string | null;
  error?: string;
  helpId: string;
  onChange: (url: string | null) => void;
};

/** Drop or pick a logo; it uploads straight to the business's folder in Storage. */
export function LogoField({ businessId, name, logoUrl, error, helpId, onChange }: LogoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    { state: "idle" } | { state: "uploading" } | { state: "error"; message: string }
  >({ state: "idle" });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    const problem = await checkLogo(file);
    if (problem) {
      setStatus({ state: "error", message: problem });
      return;
    }
    setStatus({ state: "uploading" });
    const supabase = createSupabaseBrowserClient();
    const ext = EXTENSIONS[file.type as keyof typeof EXTENSIONS];
    const path = `${businessId}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("logos")
      .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (uploadError) {
      setStatus({ state: "error", message: "That upload didn't work. Try again in a moment." });
      return;
    }
    onChange(supabase.storage.from("logos").getPublicUrl(path).data.publicUrl);
    setStatus({ state: "idle" });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  const message =
    status.state === "error" ? status.message : status.state === "uploading" ? null : error;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-label" id={`${helpId}-label`}>
        Logo
      </p>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col gap-4 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center",
          dragging ? "border-primary bg-primary-tint/40" : "border-input bg-background",
        )}
      >
        <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-tint text-heading text-primary-tint-foreground">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user upload on Supabase Storage
            <img
              src={logoUrl}
              alt={`${name || "Your"} logo`}
              className="size-full object-contain"
            />
          ) : (
            <span aria-hidden>{initialsOf(name) || "SW"}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label">{logoUrl ? "Logo uploaded" : "Drop your logo here"}</p>
          <p id={helpId} className="mt-1 text-body-sm text-muted-foreground">
            Square PNG, JPG, WebP or SVG, at least {LOGO_MIN_PX} px, up to 2 MB.
            {!logoUrl && " Until then we show your initials."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={status.state === "uploading"}
            onClick={() => inputRef.current?.click()}
            aria-describedby={helpId}
            className="h-11 px-4 text-label"
          >
            {status.state === "uploading" ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : (
              <Upload aria-hidden />
            )}
            {status.state === "uploading" ? "Uploading…" : logoUrl ? "Replace" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(null)}
              className="h-11 px-4 text-label"
            >
              Remove
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={LOGO_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      <p aria-live="polite" className="text-body-sm text-danger-text empty:hidden">
        {message}
      </p>
    </div>
  );
}

/** Client-side checks before uploading. Storage enforces type and size again. */
async function checkLogo(file: File): Promise<string | null> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
    return "Use a PNG, JPG, WebP or SVG file.";
  }
  if (file.size > LOGO_MAX_BYTES) return "That file is over 2 MB. Try a smaller export.";
  if (file.type === "image/svg+xml") return null; // vector: any size is sharp
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    if (width < LOGO_MIN_PX || height < LOGO_MIN_PX) {
      return `That image is ${width}×${height} px. Use at least ${LOGO_MIN_PX}×${LOGO_MIN_PX} so it stays sharp.`;
    }
  } catch {
    return "We couldn't read that image. Try exporting it again.";
  }
  return null;
}
