"use client";

import { Check, Copy, Download, ExternalLink, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    copied,
    flash() {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    },
  };
}

/** Read-only booking link with a Copy button. */
export function CopyLinkField({ url, display }: { url: string; display: string }) {
  const { copied, flash } = useCopied();
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (permissions, insecure origin): select it for a manual copy.
      inputRef.current?.select();
      return;
    }
    flash();
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="booking-link">
        Booking link
      </label>
      <input
        ref={inputRef}
        id="booking-link"
        readOnly
        value={display}
        onFocus={(event) => event.target.select()}
        className="h-12 min-w-0 flex-1 rounded-lg border border-input bg-muted px-4 font-mono text-body tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Button onClick={copy} className="h-12 px-5 text-label">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Booking link copied" : ""}
      </span>
    </div>
  );
}

/** Open the booking page, and share it (or copy it where sharing isn't supported). */
export function LinkActions({ url, name }: { url: string; name: string }) {
  const { copied, flash } = useCopied();

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Book with ${name}`, url });
      } catch {
        // Cancelled by the user.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    flash();
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild variant="secondary" className="h-11 px-4 text-label">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink aria-hidden />
          Open booking page
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
      <Button variant="secondary" onClick={share} className="h-11 px-4 text-label">
        {copied ? <Check aria-hidden /> : <Share2 aria-hidden />}
        {copied ? "Link copied" : "Share"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Booking link copied to share" : ""}
      </span>
    </div>
  );
}

/** Download the QR code as a print-ready PNG or as SVG. */
export function QrDownloads({ url, svg, slug }: { url: string; svg: string; slug: string }) {
  function save(href: string, filename: string) {
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.click();
  }

  async function downloadPng() {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 1200,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    save(dataUrl, `${slug}-booking-qr.png`);
  }

  function downloadSvg() {
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    save(blobUrl, `${slug}-booking-qr.svg`);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Button variant="secondary" onClick={downloadPng} className="h-11 px-4 text-label">
        <Download aria-hidden />
        Download PNG
      </Button>
      <Button variant="secondary" onClick={downloadSvg} className="h-11 px-4 text-label">
        <Download aria-hidden />
        Download SVG
      </Button>
    </div>
  );
}
