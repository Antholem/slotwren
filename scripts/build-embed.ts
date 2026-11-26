/**
 * Builds the website widget (embed/embed.ts) for public/:
 * - public/embed/v/<hash>.js: the widget, named by its content, cached forever
 * - public/embed.js: the loader sites paste, cached for minutes, pointing at
 *   the current bundle, so an update reaches every site within minutes
 *
 * Plain TypeScript transpiled by `typescript` (no bundler: the widget has no
 * imports). Fails if the loader and bundle together are 10 kB or more
 * gzipped: CI runs it (`pnpm embed:build`), and so do `pnpm dev` and `build`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import ts from "typescript";

const LIMIT_BYTES = 10 * 1024;
const root = process.cwd();
const source = readFileSync(join(root, "embed/embed.ts"), "utf8");

const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.None,
    removeComments: true,
    strict: true,
  },
  reportDiagnostics: true,
});
if (diagnostics?.length) {
  console.error(ts.formatDiagnostics(diagnostics, ts.createCompilerHost({})));
  process.exit(1);
}

// Light minification: no leading indentation or blank lines (no renaming).
const bundle = `${outputText
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .join("\n")}\n`;
const hash = createHash("sha256").update(bundle).digest("hex").slice(0, 12);

const loader = `/* Slotwren website widget loader: https://slotwren.app */
(function(){var s=document.currentScript;if(!s)return;var g=window.__slotwren=window.__slotwren||{q:[]};if(g.push){g.push(s);return}g.q.push(s);if(g.loading)return;g.loading=1;var b=document.createElement("script");b.src=new URL("/embed/v/${hash}.js",s.src).href;b.async=true;document.head.appendChild(b)})();
`;

const versions = join(root, "public/embed/v");
rmSync(versions, { recursive: true, force: true });
mkdirSync(versions, { recursive: true });
writeFileSync(join(versions, `${hash}.js`), bundle);
writeFileSync(join(root, "public/embed.js"), loader);

const gz = (text: string) => gzipSync(text, { level: 9 }).length;
const total = gz(bundle) + gz(loader);
const kb = (n: number) => `${(n / 1024).toFixed(2)} kB`;
console.log(
  `[embed] public/embed/v/${hash}.js ${kb(bundle.length)} (${kb(gz(bundle))} gzipped) · ` +
    `loader ${kb(gz(loader))} gzipped · total ${kb(total)} of ${kb(LIMIT_BYTES)}`,
);
if (readdirSync(versions).length !== 1) process.exit(1);
if (total >= LIMIT_BYTES) {
  console.error(`[embed] Too big: ${kb(total)} gzipped (limit ${kb(LIMIT_BYTES)}).`);
  process.exit(1);
}
