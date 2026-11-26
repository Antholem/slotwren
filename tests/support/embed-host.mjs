// A plain "customer website" on its own origin, for the widget's Playwright
// tests (tests/e2e/embed.spec.ts). No framework: just HTML with the snippet.
//
//   node tests/support/embed-host.mjs        (EMBED_APP_URL, EMBED_HOST_PORT)
//
//   /?business=<slug>[&mode=inline][&open=chat][&chat=off][&position=bottom-left]
//       a page with the widget
//   /frame?src=<url>
//       a page that just frames <url> (framing refusals)

import { createServer } from "node:http";

const app = (process.env.EMBED_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const port = Number(process.env.EMBED_HOST_PORT ?? 3200);

const escape = (value) =>
  String(value).replace(
    /[&"<>]/g,
    (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
  );

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
body{margin:0;font-family:Georgia,serif;color:#1c1917;background:#fbfaf9}
header{padding:20px 24px;border-bottom:1px solid #e7e5e4}
main{padding:32px 24px;max-width:56rem}
h1{font-size:2rem;margin:0 0 12px}
a{color:#0f766e}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/frame") {
    const src = url.searchParams.get("src") ?? "";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      page(
        "Framing test",
        `<main><h1>Framing test</h1><iframe id="frame" title="Framed page" src="${escape(src)}" width="600" height="400"></iframe></main>`,
      ),
    );
    return;
  }
  if (url.pathname !== "/") {
    response.writeHead(404).end("Not found");
    return;
  }
  const business = url.searchParams.get("business") ?? "";
  const attrs = [`data-business="${escape(business)}"`];
  for (const key of ["mode", "open", "chat", "position", "label"]) {
    const value = url.searchParams.get(key);
    if (value) attrs.push(`data-${key}="${escape(value)}"`);
  }
  const inline = url.searchParams.get("mode") === "inline";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    page(
      "Harbor Wellness",
      `<header><strong>Harbor Wellness</strong></header>
<main>
<h1>Feel better, on your schedule.</h1>
<p>A sample website with the Slotwren widget. <a href="#about">About us</a></p>
${inline ? '<div id="slotwren-booking"></div>' : ""}
</main>
<script src="${app}/embed.js" ${attrs.join(" ")} async></script>`,
    ),
  );
}).listen(port, () => console.log(`[embed-host] http://localhost:${port} → ${app}`));
