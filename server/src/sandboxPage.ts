// Builds the HTML page that runs inside the sandboxed iframe (and in the validator).
// GSAP and the runtime are inlined, and a strict CSP blocks all network access.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
].join('; ');

let cached: string | null = null;

export function sandboxHtml(): string {
  // Re-read in dev so runtime edits apply without a restart.
  if (cached && process.env.NODE_ENV === 'production') return cached;
  const gsapJs = readFileSync(require.resolve('gsap/dist/gsap.min.js'), 'utf8');
  const runtimeJs = readFileSync(path.resolve(here, '../../sandbox/runtime.js'), 'utf8');
  cached = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#f8fafc}
  #stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
  #stage svg{width:100%;height:100%;display:block}
  text{user-select:none}
</style></head>
<body><div id="stage"></div>
<script>${gsapJs.replace(/<\/script/gi, '<\\/script')}</script>
<script>${runtimeJs}</script>
</body></html>`;
  return cached;
}
