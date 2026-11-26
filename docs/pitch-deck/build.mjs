// Builds a standalone, browser-viewable pitch-deck.html from ./source.
// Usage: node docs/pitch-deck/build.mjs
// Then (optional) PDF: google-chrome --headless --no-pdf-header-footer \
//   --print-to-pdf=docs/pitch-deck/IndexFi-pitch-deck.pdf docs/pitch-deck/pitch-deck.html
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'source');
const deck = JSON.parse(readFileSync(join(src, 'deck.json'), 'utf8'));
const css = readFileSync(join(src, 'deck.css'), 'utf8');

// Slides-only custom elements → plain inline SVG so the file renders in any browser.
const ICONS = {
  Tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  Users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  Chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  Globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
};

function convert(html) {
  return html
    .replace(/<x-icon name="(\w+)"([^>]*)><\/x-icon>/g, (_, name, attrs) =>
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${attrs}>${ICONS[name] ?? ''}</svg>`)
    .replace(/<x-shape kind="arrow-right" class="flow-arrow"><\/x-shape>/g,
      '<svg class="flow-arrow-svg" viewBox="0 0 48 24" width="48" height="24" aria-hidden="true"><path d="M0 7h29V0l19 12-19 12v-7H0z" fill="#7A4F00"/></svg>');
}

const slides = deck.order
  .map((id) => convert(readFileSync(join(src, 'slides', `${id}.html`), 'utf8').trim()))
  .map((s) => `<div class="frame">${s}</div>`)
  .join('\n');

const fonts = Object.values(deck.faces).map((f) => `<link rel="stylesheet" href="${f.href}">`).join('\n');

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${deck.title}</title>
${fonts}
<style>
html, body { margin: 0; background: #0B0D12; }
body { counter-reset: page; --s: 1; }
.deck { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 0; }
.frame { width: calc(1920px * var(--s)); height: calc(1080px * var(--s)); overflow: hidden; position: relative; }
.frame > section { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform: scale(var(--s)); transform-origin: 0 0; overflow: hidden; }
section aside { display: none; }
section p, section h1, section h2, section h3 { margin: 0; }
.flow-arrow-svg { align-self: center; flex: none; }
table { border-collapse: collapse; }
td, th { padding: 0.35em 0.6em; text-align: left; }
tr + tr td { border-top: 1px solid rgba(169, 177, 191, 0.25); }
@page { size: 1920px 1080px; margin: 0; }
@media print {
  body { --s: 1 !important; background: none; }
  .deck { padding: 0; gap: 0; }
  .frame { break-after: page; }
  .in { animation: none !important; }
}
/* ---- deck.css ---- */
${css}
</style>
</head>
<body>
<div class="deck">
${slides}
</div>
<script>
function fit() { if (!matchMedia('print').matches) document.body.style.setProperty('--s', Math.min(1, (innerWidth - 48) / 1920)); }
addEventListener('resize', fit); fit();
</script>
</body>
</html>
`;

writeFileSync(join(here, 'pitch-deck.html'), out);
console.log(`wrote pitch-deck.html (${deck.order.length} slides)`);
