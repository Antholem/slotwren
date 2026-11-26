/*
 * Slotwren's website widget. Plain TypeScript, no dependencies; built by
 * scripts/build-embed.ts into a versioned bundle (public/embed/v/<hash>.js)
 * that the short-cached loader (public/embed.js) fetches.
 *
 *   <script src="https://<app>/embed.js" data-business="<slug>" async></script>
 *
 * Options (data-*): mode="inline" + target="#id" (render into a div instead
 * of a floating button), position="bottom-right|bottom-left", label="Book
 * now", chat="on|off", open="chat". Anything not given comes from the
 * business's own settings (GET /api/embed/<slug>).
 *
 * Isolation: everything lives in a Shadow DOM; the only global is
 * window.__slotwren (the loader's queue). The booking page runs in an iframe
 * (/b/<slug>?embed=1): a side panel on desktop, a full-screen sheet on phones.
 * Messages from it are accepted only from the app's origin and that iframe,
 * and carry no customer data (resize, close, booked).
 */

type Config = {
  name: string;
  buttonText: string;
  position: "bottom-right" | "bottom-left" | "inline";
  chat: boolean;
  open: "booking" | "chat";
  colors: { background: string; foreground: string; hover: string };
};

type Queue = { q: HTMLScriptElement[]; ready?: boolean; push?: (s: HTMLScriptElement) => void };

(() => {
  const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const COLOR = /^#[0-9a-fA-F]{6}$/;
  const w = window as unknown as { __slotwren?: Queue };
  const queue: Queue = (w.__slotwren ??= { q: [] });
  if (queue.ready) return;
  queue.ready = true;

  const CALENDAR =
    '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  const CHAT =
    '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  const CLOSE =
    '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  const css = (c: Config) => `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.dock{position:fixed;bottom:24px;z-index:2147483000;display:flex;gap:12px;align-items:center}
.dock.right{right:24px}.dock.left{left:24px;flex-direction:row-reverse}
button{cursor:pointer;border:0;font:600 16px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.book{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 20px;border-radius:999px;background:${c.colors.background};color:${c.colors.foreground};box-shadow:0 8px 24px rgba(0,0,0,.18)}
.book:hover{background:${c.colors.hover}}
.bubble{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:999px;background:#fff;color:${c.colors.background};box-shadow:0 8px 24px rgba(0,0,0,.18)}
button:focus-visible{outline:3px solid ${c.colors.background};outline-offset:3px}
.book:focus-visible{outline-color:#1c1917}
.overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(28,25,23,.45)}
.panel{position:fixed;z-index:2147483002;inset:0;display:flex;flex-direction:column;background:#fff;box-shadow:-8px 0 32px rgba(0,0,0,.2)}
@media (min-width:640px){.panel{left:auto;width:min(460px,100vw)}}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 8px 8px 16px;border-bottom:1px solid #e7e5e4;color:#1c1917;font:600 16px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.close{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:10px;background:transparent;color:#1c1917}
.close:hover{background:#f5f5f4}.close:focus-visible{outline-color:#1c1917}
iframe{display:block;width:100%;border:0;color-scheme:normal}
.panel iframe{flex:1}
@media (prefers-reduced-motion:no-preference){.panel{animation:in .18s ease-out}@keyframes in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}}
`;

  function frameUrl(origin: string, slug: string, chat: boolean): string {
    const url = new URL(`/b/${slug}`, origin);
    url.searchParams.set("embed", "1");
    url.searchParams.set("host", location.origin);
    if (chat) url.searchParams.set("chat", "1");
    return url.toString();
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    html = "",
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (html) node.innerHTML = html;
    return node;
  }

  async function init(script: HTMLScriptElement) {
    const data = script.dataset;
    const slug = data.business ?? "";
    let origin: string;
    try {
      origin = new URL(script.src).origin;
    } catch {
      return;
    }
    if (!SLUG.test(slug)) {
      console.warn("[Slotwren] data-business must be your booking page's slug.");
      return;
    }
    let config: Config;
    try {
      const response = await fetch(`${origin}/api/embed/${slug}`, { credentials: "omit" });
      if (!response.ok) {
        console.warn(
          response.status === 403
            ? "[Slotwren] This website isn't in the business's allowed websites."
            : "[Slotwren] Booking page not found.",
        );
        return;
      }
      config = (await response.json()) as Config;
    } catch {
      return;
    }
    for (const c of Object.values(config.colors)) if (!COLOR.test(c)) return;

    const mode =
      data.mode === "inline" || (!data.mode && config.position === "inline")
        ? "inline"
        : "floating";
    const openChat = (data.open ?? config.open) === "chat" && config.chat;

    if (mode === "inline") {
      const target = document.querySelector(data.target || "#slotwren-booking");
      if (!target) {
        console.warn("[Slotwren] Inline mode: data-target matches nothing on this page.");
        return;
      }
      const root = target.attachShadow ? target.attachShadow({ mode: "open" }) : target;
      const style = el("style");
      style.textContent = css(config);
      const frame = el("iframe", {
        src: frameUrl(origin, slug, openChat),
        title: `Book with ${config.name}`,
        loading: "lazy",
      });
      frame.style.height = "720px";
      root.append(style, frame);
      listen(origin, frame, script, {
        resize: (h) => (frame.style.height = `${Math.min(Math.max(h, 320), 4000)}px`),
        close: () => {},
      });
      return;
    }

    const host = el("div", { "data-slotwren": "" });
    const root = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = css(config);
    const side = (data.position ?? config.position) === "bottom-left" ? "left" : "right";
    const dock = el("div", { class: `dock ${side}` });
    const label = (data.label || config.buttonText).slice(0, 40);
    const book = el("button", { type: "button", class: "book", "aria-haspopup": "dialog" });
    book.innerHTML = CALENDAR;
    book.append(label);
    dock.append(book);
    const wantsChat = (data.chat ?? (config.chat ? "on" : "off")) !== "off" && config.chat;
    let bubble: HTMLButtonElement | null = null;
    if (wantsChat) {
      bubble = el(
        "button",
        {
          type: "button",
          class: "bubble",
          "aria-label": `Chat with ${config.name}`,
          "aria-haspopup": "dialog",
        },
        CHAT,
      );
      dock.append(bubble);
    }
    root.append(style, dock);
    document.body.append(host);

    let open: { close: () => void } | null = null;

    function show(chat: boolean, opener: HTMLButtonElement) {
      if (open) return;
      const overlay = el("div", { class: "overlay" });
      const panel = el("div", {
        class: "panel",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": chat ? `Chat with ${config.name}` : `Book with ${config.name}`,
      });
      const bar = el("div", { class: "bar" });
      const title = el("span");
      title.textContent = config.name;
      const close = el("button", { type: "button", class: "close", "aria-label": "Close" }, CLOSE);
      bar.append(title, close);
      const frame = el("iframe", {
        src: frameUrl(origin, slug, chat),
        title: chat ? `Chat with ${config.name}` : `Book with ${config.name}`,
      });
      panel.append(bar, frame);
      root.append(overlay, panel);

      const stopListening = listen(origin, frame, script, {
        resize: () => {},
        close: () => done(),
      });
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          done();
        } else if (event.key === "Tab") {
          // Keep focus in the panel: the close button and the booking page.
          event.preventDefault();
          (root.activeElement === close ? frame : close).focus();
        }
      };
      // Focus wandering out (to the host page) comes back to the panel.
      const onFocus = (event: FocusEvent) => {
        if (event.target !== host) close.focus();
      };
      root.addEventListener("keydown", onKey as EventListener);
      document.addEventListener("focusin", onFocus);
      overlay.addEventListener("click", () => done());
      close.addEventListener("click", () => done());

      function done() {
        stopListening();
        root.removeEventListener("keydown", onKey as EventListener);
        document.removeEventListener("focusin", onFocus);
        overlay.remove();
        panel.remove();
        open = null;
        opener.focus();
      }
      open = { close: done };
      frame.focus();
    }

    book.addEventListener("click", () => show(openChat, book));
    bubble?.addEventListener("click", () => show(true, bubble!));
  }

  /** Messages from our iframe only (origin and window), with known types only. */
  function listen(
    origin: string,
    frame: HTMLIFrameElement,
    script: HTMLScriptElement,
    on: { resize: (height: number) => void; close: () => void },
  ): () => void {
    const handler = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      const msg = event.data as { type?: unknown; height?: unknown } | null;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "slotwren:resize" && typeof msg.height === "number") on.resize(msg.height);
      else if (msg.type === "slotwren:close") on.close();
      else if (msg.type === "slotwren:booked") {
        // For the site's own analytics: that a booking happened, nothing about it.
        script.dispatchEvent(new CustomEvent("slotwren:booked", { bubbles: true }));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }

  const start = (script: HTMLScriptElement) => void init(script);
  for (const script of queue.q.splice(0)) start(script);
  queue.push = start;
})();
