// Builds an editable IndexFi-pitch-deck.pptx (imports into Google Slides via File › Import slides).
// Mirrors the slides in ./source; speaker notes are read from each slide's <aside>.
// Needs pptxgenjs + sharp, e.g.:  npm i --prefix /tmp/deckdeps pptxgenjs@3.12.0 sharp@0.33.5
//   NODE_PATH=/tmp/deckdeps/node_modules node docs/pitch-deck/build-pptx.cjs
// Optional: APPLY_THEME=<path to apply_theme.js> writes the palette into the deck's theme.
const fs = require('node:fs');
const path = require('node:path');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');

const HERE = __dirname;
const SRC = path.join(HERE, 'source', 'slides');
const OUT = path.join(HERE, 'IndexFi-pitch-deck.pptx');

// 1920×1080 px design canvas → 13.333×7.5 in (LAYOUT_WIDE): 144 px per inch, 2 px per pt.
const X = (px) => px / 144;
const T = (px) => px / 2;

const C = {
  ink: '0F1218', dark: '1C2230', light: 'FDFCF8', paper: 'F5F2EA',
  cardL: 'F1ECE1', cardD: '283043', borderD: '3A4459', coreD: '332C17',
  amber: 'F2B632', amberD: '7A4F00', blue: '6E9BFF', blueT: '8FB3FF',
  mutedD: 'A9B1BF', textD: 'C9CFDA', mutedL: '4E5563', textL: '3E4451', itemL: '22262E', ruleL: 'CFC7B4',
};
const HEAD = 'Space Grotesk';
const BODY = 'Inter';
const FOOT = 'IndexFi · BNB Bangkok 2026';

const read = (id) => fs.readFileSync(path.join(SRC, `${id}.html`), 'utf8');
const notesOf = (id) => (read(id).match(/<aside>([\s\S]*?)<\/aside>/) || [, ''])[1].trim();
const svgsOf = (id) => (read(id).match(/<svg[\s\S]*?<\/svg>/g) || [])
  .map((s) => s.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
const png = async (svg, scale = 3) =>
  'image/png;base64,' + (await sharp(Buffer.from(svg), { density: 72 * scale }).png().toBuffer()).toString('base64');

const ICONS = {
  Tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  Users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  Chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  Globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
};
const iconSvg = (name) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#${C.amberD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'IndexFi Pitch Deck';
  pres.subject = 'BNB Bangkok hackathon pitch';
  pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };

  // ---- layouts -------------------------------------------------------------
  const content = (name, bg, eyebrow, title, muted) => pres.defineSlideMaster({
    title: name,
    background: { color: bg },
    objects: [
      { text: { text: FOOT, options: { x: X(128), y: X(982), w: X(900), h: X(34), fontFace: BODY, fontSize: 12, color: muted, margin: 0, valign: 'top' } } },
      { placeholder: { options: { name: 'eyebrow', type: 'body', x: X(128), y: X(128), w: X(1500), h: X(34), fontFace: BODY, fontSize: 12, bold: true, color: eyebrow, charSpacing: 1.5, margin: 0, valign: 'top' }, text: '' } },
      { placeholder: { options: { name: 'title', type: 'title', x: X(128), y: X(186), w: X(1540), h: X(170), fontFace: HEAD, fontSize: 36, bold: true, color: title, align: 'left', margin: 0, valign: 'top', lineSpacingMultiple: 1.0 }, text: '' } },
    ],
    slideNumber: { x: X(1592), y: X(982), w: X(200), h: X(34), fontFace: BODY, fontSize: 12, color: muted, align: 'right' },
  });
  content('DARK', C.dark, C.amber, C.paper, C.mutedD);
  content('LIGHT', C.light, C.amberD, C.ink, C.mutedL);
  pres.defineSlideMaster({ title: 'DARK_BARE', background: { color: C.dark } });
  pres.defineSlideMaster({ title: 'ACCENT', background: { color: C.amber } });

  // ---- helpers ---------------------------------------------------------------
  const txt = (s, text, o) => s.addText(text, {
    x: X(o.x), y: X(o.y), w: X(o.w), h: X(o.h),
    fontFace: o.font || BODY, fontSize: T(o.size || 32), color: o.color, bold: !!o.bold,
    align: o.align || 'left', valign: o.valign || 'top', margin: 0, isTextBox: true,
    lineSpacingMultiple: o.ls || 1.2, charSpacing: o.cs, objectName: o.name,
  });
  const box = (s, o) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: X(o.x), y: X(o.y), w: X(o.w), h: X(o.h), rectRadius: X(o.r ?? 20),
    fill: o.fill ? { color: o.fill } : { type: 'none' },
    line: o.line ? { color: o.line, width: o.lw || 0.75 } : { type: 'none' },
    objectName: o.name,
  });
  const rect = (s, x, y, w, h, color) => s.addShape(pres.shapes.RECTANGLE, { x: X(x), y: X(y), w: X(w), h: X(h), fill: { color }, line: { type: 'none' } });
  const head = (s, eyebrow, title) => { s.addText(eyebrow, { placeholder: 'eyebrow' }); s.addText(title, { placeholder: 'title' }); };
  const slideFor = (id, masterName, sectionTitle) => { const s = pres.addSlide({ masterName, sectionTitle }); s.addNotes(notesOf(id)); return s; };
  const cols = (n, gap, x0 = 128, total = 1664) => { const w = (total - gap * (n - 1)) / n; return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), w })); };

  // ---- 1. cover --------------------------------------------------------------
  pres.addSection({ title: 'Why IndexFi' });
  let s = slideFor('cover', 'DARK_BARE', 'Why IndexFi');
  s.addImage({ data: await png(svgsOf('cover')[0]), x: X(1232), y: X(220), w: X(560), h: X(640), altText: 'Six asset circles converging into one token' });
  txt(s, 'BNB BANGKOK HACKATHON', { x: 128, y: 224, w: 1040, h: 34, size: 24, bold: true, color: C.amber, cs: 1.5 });
  txt(s, 'IndexFi', { x: 128, y: 276, w: 1040, h: 184, size: 160, bold: true, font: HEAD, color: C.paper, ls: 1.0 });
  txt(s, 'Many assets. One token.', { x: 128, y: 472, w: 1060, h: 90, size: 72, font: HEAD, color: C.amber, ls: 1.0 });
  txt(s, 'Passive, collateral-backed portfolio tokens with a USDT primary market and PancakeSwap liquidity on BNB Chain.', { x: 128, y: 598, w: 900, h: 110, size: 32, color: C.textD, ls: 1.3 });
  txt(s, 'November 2026', { x: 128, y: 918, w: 600, h: 34, size: 24, color: C.mutedD });

  // ---- 2. problem ------------------------------------------------------------
  s = slideFor('problem', 'LIGHT', 'Why IndexFi');
  head(s, 'THE PROBLEM', 'Diversified on-chain exposure is still a pile of separate positions');
  [['Many swaps', 'A hand-built basket means one swap, one approval and one position to track per asset.'],
   ['Locked shares', 'Fund-style vaults often issue non-transferable positions: no secondary market, no composability.'],
   ['No anchor', 'A basket token that can’t be redeemed for its backing has nothing pulling its price back to value.']]
    .forEach(([t, b], i) => {
      const c = cols(3, 32)[i]; const y = 398;
      box(s, { x: c.x, y, w: c.w, h: 350, fill: C.cardL, name: `Card ${i + 1}` });
      txt(s, t, { x: c.x + 40, y: y + 40, w: c.w - 80, h: 56, size: 44, bold: true, font: HEAD, color: C.ink, ls: 1.0 });
      txt(s, b, { x: c.x + 40, y: y + 112, w: c.w - 80, h: 210, size: 32, color: C.textL, ls: 1.3 });
    });

  // ---- 3. solution -----------------------------------------------------------
  s = slideFor('solution', 'DARK', 'Why IndexFi');
  head(s, 'INDEXFI', 'One transferable token, fully backed by a basket you choose');
  [['01', 'Backed', 'Every share, including the ones in the liquidity pool, is backed by collateral held in the vault.'],
   ['02', 'Redeemable', 'Anyone can deposit USDT for new shares at NAV, or redeem shares for their pro-rata USDT.'],
   ['03', 'Tradable', 'The same token trades on PancakeSwap V2 as soon as the basket is funded.']]
    .forEach(([n, t, b], i) => {
      const c = cols(3, 32)[i]; const y = 398;
      box(s, { x: c.x, y, w: c.w, h: 400, fill: C.cardD, line: C.borderD, name: `Card ${i + 1}` });
      txt(s, n, { x: c.x + 40, y: y + 40, w: 200, h: 50, size: 44, bold: true, font: HEAD, color: C.amber, ls: 1.0 });
      txt(s, t, { x: c.x + 40, y: y + 100, w: c.w - 80, h: 56, size: 44, bold: true, font: HEAD, color: C.paper, ls: 1.0 });
      txt(s, b, { x: c.x + 40, y: y + 168, w: c.w - 80, h: 210, size: 32, color: C.textD, ls: 1.3 });
    });
  txt(s, 'ETF-like mechanics, not a regulated ETF. No guaranteed peg, liquidity or return.', { x: 128, y: 830, w: 1664, h: 40, size: 24, color: C.mutedD });

  // ---- 4. how it works -------------------------------------------------------
  pres.addSection({ title: 'How it works' });
  s = slideFor('how', 'LIGHT', 'How it works');
  head(s, 'HOW IT WORKS', 'From basket to tradable token');
  const steps = [
    ['1', 'Choose', 'Pick assets and fixed starting weights that sum to 100%. Constituents never change.'],
    ['2', 'Fund', 'Put in at least 100 USDT of collateral, plus a separate liquidity amount of at least 1 USDT.'],
    ['3', 'Acquire', 'The vault buys every asset on PancakeSwap. Shares are issued on the value actually acquired, at 1 USDT NAV.'],
    ['4', 'Graduate', 'OpenFour moves the token to a PancakeSwap V2 pool priced at NAV. The creator gets the LP tokens, unlocked.'],
  ];
  const sw = (1664 - 3 * 48 - 6 * 16) / 4; const sy = 320; const sh = 440;
  steps.forEach(([n, t, b], i) => {
    const x = 128 + i * (sw + 80);
    box(s, { x, y: sy, w: sw, h: sh, fill: C.cardL, name: `Step ${n}` });
    txt(s, n, { x: x + 40, y: sy + 40, w: 100, h: 50, size: 44, bold: true, font: HEAD, color: C.amberD, ls: 1.0 });
    txt(s, t, { x: x + 40, y: sy + 98, w: sw - 80, h: 56, size: 44, bold: true, font: HEAD, color: C.ink, ls: 1.0 });
    txt(s, b, { x: x + 40, y: sy + 166, w: sw - 80, h: 250, size: 24, color: C.textL, ls: 1.35 });
    if (i < 3) s.addShape(pres.shapes.RIGHT_ARROW, { x: X(x + sw + 16), y: X(sy + sh / 2 - 12), w: X(48), h: X(24), fill: { color: C.amberD }, line: { type: 'none' } });
  });
  txt(s, 'Creator keeps the backed shares not placed in the pool. No manager, no rebalancing: weights drift with prices.', { x: 128, y: 796, w: 1664, h: 40, size: 24, color: C.mutedL });

  // ---- 5. two markets --------------------------------------------------------
  s = slideFor('markets', 'DARK', 'How it works');
  head(s, 'PRIMARY AND SECONDARY', 'Two ways in, two ways out');
  const rule = { type: 'solid', pt: 0.75, color: C.borderD };
  const none = { type: 'none' };
  const cell = (text, color, extra = {}) => ({ text, options: { color, border: [none, none, rule, none], ...extra } });
  const rows = [
    ['Where', 'IndexFi vault', 'PancakeSwap V2 pool'],
    ['Get in', 'Deposit USDT → new shares', 'Buy shares from the pool'],
    ['Get out', 'Redeem → pro-rata USDT', 'Sell shares into the pool'],
    ['Price', 'Atlas on-chain NAV', 'Whatever the pool clears at'],
    ['Fee', '10 bps to the creator', 'Pool’s standard swap fee'],
    ['Supply', 'Issued and redeemed', 'Unchanged; shares move'],
    ['Oracle', 'Deposit yes, redeem no', 'Not needed'],
  ];
  const hdr = { fill: { color: C.cardD }, bold: true };
  s.addTable([
    [cell('', C.paper, hdr), cell('Primary market', C.amber, hdr), cell('Secondary market', C.blueT, hdr)],
    ...rows.map(([a, b, c]) => [cell(a, C.mutedD), cell(b, C.paper), cell(c, C.paper)]),
  ], { x: X(128), y: X(320), w: X(1664), colW: [X(333), X(666), X(665)], rowH: X(66), fontFace: BODY, fontSize: 16, valign: 'middle', objectName: 'Markets table' });

  // ---- 6. worked example -----------------------------------------------------
  s = slideFor('example', 'LIGHT', 'How it works');
  head(s, 'WORKED EXAMPLE', 'A launch, in numbers');
  [['100', 'USDT collateral', 'Spent on the basket at the creator’s weights'],
   ['10', 'USDT liquidity', 'Funded separately, paired in the pool'],
   ['100', 'backed shares', '90 to the creator, 10 into the pool'],
   ['1.00', 'USDT opening price', 'Pool seeded at NAV, so price = NAV']]
    .forEach(([big, unit, sub], i) => {
      const c = cols(4, 32)[i];
      rect(s, c.x, 320, c.w, 4, C.ink);
      txt(s, big, { x: c.x, y: 344, w: c.w, h: 130, size: 120, bold: true, font: HEAD, color: C.ink, ls: 1.0 });
      txt(s, unit, { x: c.x, y: 480, w: c.w, h: 46, size: 32, bold: true, color: C.ink });
      txt(s, sub, { x: c.x, y: 532, w: c.w, h: 72, size: 24, color: C.mutedL, ls: 1.3 });
    });
  box(s, { x: 128, y: 640, w: 1664, h: 170, fill: C.cardL, name: 'Callout' });
  txt(s, 'Next, a depositor adds 100 USDT: 0.10 USDT goes to the creator, the rest buys the basket, and shares are issued on the value actually acquired.', { x: 176, y: 680, w: 1568, h: 100, size: 32, color: C.ink, ls: 1.3 });
  txt(s, 'Illustrative, frictionless figures. Real issuance uses actual swap results; swap costs fall on the depositor, not existing holders.', { x: 128, y: 840, w: 1664, h: 40, size: 24, color: C.mutedL });

  // ---- 7. arbitrage ----------------------------------------------------------
  s = slideFor('arbitrage', 'DARK', 'How it works');
  head(s, 'ARBITRAGE', 'Arbitrage pulls price toward NAV');
  const arbSvgs = svgsOf('arbitrage');
  const arb = [
    ['Premium: price above NAV', ['Deposit USDT, get new shares at NAV', 'Sell them on PancakeSwap', 'Selling pushes the price down'], 'Market price starts above the dashed NAV line and falls toward it'],
    ['Discount: price below NAV', ['Buy shares on PancakeSwap', 'Redeem them for pro-rata USDT', 'Buying pushes the price up'], 'Market price starts below the dashed NAV line and rises toward it'],
  ];
  for (let i = 0; i < 2; i++) {
    const c = cols(2, 32)[i]; const y = 320; const [t, items, alt] = arb[i];
    box(s, { x: c.x, y, w: c.w, h: 480, fill: C.cardD, line: C.borderD, name: `Card ${i + 1}` });
    txt(s, t, { x: c.x + 40, y: y + 40, w: c.w - 80, h: 56, size: 44, bold: true, font: HEAD, color: C.paper, ls: 1.0 });
    s.addImage({ data: await png(arbSvgs[i]), x: X(c.x + 40), y: X(y + 112), w: X(736), h: X(160), altText: alt });
    s.addText(items.map((it, k) => ({ text: it, options: { bullet: { type: 'number' }, breakLine: k < items.length - 1 } })),
      { x: X(c.x + 40), y: X(y + 300), w: X(c.w - 80), h: X(150), fontFace: BODY, fontSize: 16, color: C.textD, margin: 0, isTextBox: true, valign: 'top', lineSpacingMultiple: 1.25 });
  }
  txt(s, 'Dashed line: NAV. Solid line: pool price. Worth doing only after the 10 bps fee, swap costs, slippage and gas; convergence isn’t guaranteed.', { x: 128, y: 830, w: 1664, h: 40, size: 24, color: C.mutedD });

  // ---- 8. fees ---------------------------------------------------------------
  s = slideFor('fees', 'ACCENT', 'How it works');
  txt(s, 'FEES', { x: 128, y: 262, w: 800, h: 34, size: 24, bold: true, color: '3A2A00', cs: 1.5 });
  txt(s, '10 bps in.\n10 bps out.', { x: 128, y: 310, w: 1500, h: 260, size: 120, bold: true, font: HEAD, color: C.ink, ls: 0.95 });
  txt(s, 'Fixed fees on primary deposits and redemptions, paid to the creator in USDT. Creators can also earn swap fees on their own LP position.', { x: 128, y: 604, w: 1400, h: 190, size: 44, font: HEAD, color: '2A2108', ls: 1.2 });
  let px = 128;
  for (const [label, w] of [['No management fee', 400], ['No performance fee', 420], ['No transfer tax', 360]]) {
    box(s, { x: px, y: 830, w, h: 68, r: 34, line: C.ink, lw: 2.25, name: label });
    txt(s, label, { x: px, y: 830, w, h: 68, size: 32, bold: true, color: C.ink, align: 'center', valign: 'middle', ls: 1.0 });
    px += w + 24;
  }

  // ---- 9. audiences ----------------------------------------------------------
  s = slideFor('audiences', 'LIGHT', 'How it works');
  head(s, 'WHO IT’S FOR', 'Four sides of the same token');
  const aud = [
    ['Tool', 'Creators', 'Launch an immutable basket and earn transparent 10 bps fees, plus LP revenue on your own holdings.'],
    ['Users', 'Investors', 'Hold a whole basket in one transferable token. Enter and exit through the vault or the pool.'],
    ['Chart', 'Arbitrageurs', 'Compare NAV with the pool price and close the gap with permissionless issue and redeem.'],
    ['Globe', 'Ecosystem', 'A composable BNB Chain token built on OpenFour presets, Atlas valuation and PancakeSwap liquidity.'],
  ];
  for (let i = 0; i < 4; i++) {
    const c = cols(4, 32)[i]; const y = 320; const [icon, t, b] = aud[i];
    box(s, { x: c.x, y, w: c.w, h: 440, fill: C.cardL, name: t });
    s.addImage({ data: await png(iconSvg(icon), 12), x: X(c.x + 32), y: X(y + 36), w: X(56), h: X(56), altText: `${t} icon` });
    txt(s, t, { x: c.x + 32, y: y + 112, w: c.w - 56, h: 56, size: 44, bold: true, font: HEAD, color: C.ink, ls: 1.0 });
    txt(s, b, { x: c.x + 32, y: y + 184, w: c.w - 64, h: 230, size: 24, color: C.textL, ls: 1.35 });
  }

  // ---- 10. architecture ------------------------------------------------------
  pres.addSection({ title: 'Build and fit' });
  s = slideFor('architecture', 'DARK', 'Build and fit');
  head(s, 'ARCHITECTURE', 'What IndexFi is built on');
  const layers = [
    [['Web app', 'Next.js, wagmi/viem and RainbowKit. Create, deposit, redeem and trade from one place.'],
     ['Price server', 'Python service streaming 66 live Atlas feeds for the asset browser and charts.']],
    [['IndexFi contracts', 'Factory, multi-asset basket vault and preset validator, with Atlas valuation and PancakeSwap route adapters and fixed 10 bps fees.', true]],
    [['OpenFour', 'Core, Registry, token and V2 migration library, reused as-is.'],
     ['Atlas', 'On-chain reference NAV for issuance and the opening pool price.'],
     ['PancakeSwap V2', 'Executes the basket swaps and hosts the secondary pool.']],
  ];
  layers.forEach((row, r) => {
    const y = 320 + r * 206;
    row.forEach(([t, b, core], i) => {
      const c = cols(row.length, 20)[i];
      box(s, { x: c.x, y, w: c.w, h: 190, r: 16, fill: core ? C.coreD : C.cardD, line: core ? C.amber : C.borderD, lw: core ? 1.5 : 0.75, name: t });
      txt(s, t, { x: c.x + 32, y: y + 24, w: c.w - 64, h: 52, size: 44, bold: true, font: HEAD, color: C.paper, ls: 1.0 });
      txt(s, b, { x: c.x + 32, y: y + 82, w: c.w - 64, h: 96, size: 24, color: C.textD, ls: 1.3 });
    });
  });

  // ---- 11. status ------------------------------------------------------------
  s = slideFor('status', 'LIGHT', 'Build and fit');
  head(s, 'PROGRESS', 'Where the build stands');
  [['Working today', ['Token launch on a real OpenFour Core fork', '66 Atlas price feeds streaming to the app', 'Prototype create, deposit, redeem in browser', '17 Solidity · 27 backend · 88 frontend tests']],
   ['Before testnet launch', ['Transferable-share lifecycle on a Core fork', 'Atlas on-chain valuation adapter', 'Pancake routes and creator-owned LP', 'BSC testnet deploy with public receipts']]]
    .forEach(([h, items], i) => {
      const c = cols(2, 48)[i];
      txt(s, h, { x: c.x, y: 320, w: c.w, h: 56, size: 44, bold: true, font: HEAD, color: C.ink, ls: 1.0 });
      rect(s, c.x, 396, c.w, 3, C.ink);
      items.forEach((it, k) => {
        const y = 404 + k * 80;
        txt(s, it, { x: c.x, y: y + 17, w: c.w, h: 46, size: 32, color: C.itemL });
        rect(s, c.x, y + 79, c.w, 1, C.ruleL);
      });
    });
  txt(s, 'Team-reported results from the latest validation run; the browser flow ran on local mocks with the earlier prototype vault. Nothing is live on BSC testnet yet.', { x: 128, y: 756, w: 1664, h: 80, size: 24, color: C.mutedL, ls: 1.3 });

  // ---- 12. sponsors ----------------------------------------------------------
  s = slideFor('sponsors', 'DARK', 'Build and fit');
  head(s, 'SPONSOR TRACKS', 'How IndexFi fits each track');
  [['OpenFour', 'Official Core and Registry, a custom basket vault and preset, and the upstream V2 migration library.', 'Fork launch working', true],
   ['Atlas × CMC', 'Atlas values each issuance on-chain and sets the opening pool price; 66 live feeds power the asset browser.', 'Testnet feed pending', false],
   ['BNB Chain', 'Targets BSC testnet with public transactions, open-source code and a working demo.', 'Testnet deploy pending', false]]
    .forEach(([t, b, pill, done], i) => {
      const c = cols(3, 32)[i]; const y = 320;
      box(s, { x: c.x, y, w: c.w, h: 420, fill: C.cardD, line: C.borderD, name: t });
      txt(s, t, { x: c.x + 40, y: y + 40, w: c.w - 80, h: 56, size: 44, bold: true, font: HEAD, color: C.paper, ls: 1.0 });
      txt(s, b, { x: c.x + 40, y: y + 112, w: c.w - 80, h: 220, size: 32, color: C.textD, ls: 1.3 });
      const pw = pill.length * 15 + 48;
      box(s, { x: c.x + 40, y: y + 344, w: pw, h: 46, r: 23, fill: done ? C.amber : C.borderD, name: `${t} status` });
      txt(s, pill, { x: c.x + 40, y: y + 344, w: pw, h: 46, size: 24, bold: true, color: done ? C.ink : C.paper, align: 'center', valign: 'middle', ls: 1.0 });
    });
  txt(s, 'Track eligibility still to be confirmed with each sponsor.', { x: 128, y: 772, w: 1664, h: 40, size: 24, color: C.mutedD });

  // ---- 13. roadmap -----------------------------------------------------------
  s = slideFor('roadmap', 'LIGHT', 'Build and fit');
  head(s, 'ROADMAP', 'Passive first, then more');
  [['NOW', 'Passive basket MVP', 'Create, deposit, redeem and trade a backed basket token, proven end to end on a Core fork.'],
   ['NEXT', 'BSC testnet launch', 'Verified Atlas feeds and PancakeSwap routes, a public deployment and more executable assets.'],
   ['LATER', 'Beyond passive', 'Optional active strategies and rebalancing, with their own investor protections, plus richer analytics.']]
    .forEach(([when, t, b], i) => {
      const c = cols(3, 32)[i]; const y = 320;
      box(s, { x: c.x, y, w: c.w, h: 420, fill: C.cardL, name: t });
      txt(s, when, { x: c.x + 40, y: y + 40, w: c.w - 80, h: 34, size: 24, bold: true, color: C.amberD, cs: 1.5 });
      txt(s, t, { x: c.x + 40, y: y + 88, w: c.w - 80, h: 56, size: 44, bold: true, font: HEAD, color: C.ink, ls: 1.0 });
      txt(s, b, { x: c.x + 40, y: y + 160, w: c.w - 80, h: 220, size: 32, color: C.textL, ls: 1.3 });
    });

  // ---- 14. close -------------------------------------------------------------
  s = slideFor('close', 'DARK_BARE', 'Build and fit');
  txt(s, 'INDEXFI', { x: 128, y: 247, w: 800, h: 34, size: 24, bold: true, color: C.amber, cs: 1.5 });
  txt(s, 'Many assets.\nOne token.', { x: 128, y: 300, w: 1600, h: 350, size: 160, bold: true, font: HEAD, color: C.paper, ls: 0.95 });
  ['[GitHub repo]', '[Demo video]', '[Team contact]'].forEach((l, i) =>
    txt(s, l, { x: 128 + i * 300, y: 700, w: 280, h: 46, size: 32, color: C.textD }));
  txt(s, 'Built for BNB Bangkok by Jitter Labs. Testnet software; not audited. ETF-like mechanics, not a regulated ETF; no guaranteed peg, liquidity or return.', { x: 128, y: 786, w: 1400, h: 80, size: 24, color: C.mutedD, ls: 1.3 });

  await pres.writeFile({ fileName: OUT });
  if (process.env.APPLY_THEME) {
    const { applyTheme } = require(process.env.APPLY_THEME);
    await applyTheme(OUT, {
      name: 'IndexFi', headFontFace: HEAD, bodyFontFace: BODY,
      colors: { dk1: C.ink, lt1: C.light, dk2: C.dark, lt2: C.cardL, accent1: C.amber, accent2: C.amberD, accent3: C.blue, accent4: C.cardD, accent5: C.mutedD, accent6: C.mutedL, hlink: '2F5BD3', folHlink: C.amberD },
    });
  }
  console.log('wrote', path.relative(process.cwd(), OUT));
})().catch((e) => { console.error(e); process.exit(1); });
