// Captures the README screenshots and the hero GIF frames from the real
// iureditor frontend (Vite dev server) with a mocked Tauri backend (mock.ts).
//
//   node scripts/readme-media/capture.mjs [en|es|all] [shots|gif|all]
//
// Output: docs/media/<topic>-<lang>.png (raw, see build.sh for the final
// downscale/compression) and scripts/readme-media/out/gif-<lang>/ frames.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const MEDIA = path.join(ROOT, 'docs/media');
const OUT = path.join(HERE, 'out');
const BASE = process.env.BASE_URL || 'http://localhost:5302';
const CHROME =
  process.env.CHROME || process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const langs = (process.argv[2] || 'all') === 'all' ? ['en', 'es'] : [process.argv[2]];
const what = process.argv[3] || 'all';
fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = {
  en: { contract: 'Service agreement.md', memo: 'Late-payment interest.md' },
  es: { contract: 'Contrato de servicios.md', memo: 'Intereses moratorios.md' },
};

// No caret, transitions, animations or the selection bubble menu while shooting.
const STILL_CSS = `
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
  div.rounded-lg.shadow-lg.gap-0\\.5.p-1 { visibility: hidden !important; }
`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--font-render-hinting=none', '--lang=en-US'],
});

async function open(query, { theme = 'light', sidebar = null, zoom = 1, width = 1280, height = 800, scale = 1.5 } = {}) {
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.setViewport({ width, height, deviceScaleFactor: scale });
  await p.evaluateOnNewDocument(
    (theme, sidebar, zoom) => {
      localStorage.setItem('iur-theme', theme);
      localStorage.setItem('iur-zoom', String(zoom));
      localStorage.setItem('iur-spellcheck', 'false');
      localStorage.setItem('iur-sidebar', JSON.stringify(sidebar ?? { visible: false, view: 'outline' }));
    },
    theme,
    sidebar,
    zoom
  );
  await p.goto(`${BASE}/scripts/readme-media/app.html?${query}`, { waitUntil: 'networkidle0' });
  await p.addStyleTag({ content: STILL_CSS });
  await p.waitForSelector('.ProseMirror');
  await wait(2500); // mermaid + KaTeX render
  return p;
}

/** Scrolls the active editor so the heading containing `text` sits near the top. */
async function scrollToHeading(p, text, offset = 24) {
  await p.evaluate(
    (text, offset) => {
      const hs = [...document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')].filter(
        (h) => h.offsetParent !== null
      );
      const h = hs.find((x) => x.textContent.includes(text));
      if (!h) throw new Error('heading not found: ' + text);
      let sc = h.parentElement;
      while (sc && !(sc.scrollHeight > sc.clientHeight && getComputedStyle(sc).overflowY !== 'visible')) sc = sc.parentElement;
      sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset;
    },
    text,
    offset
  );
  await wait(500);
}

/** Puts the cursor at the end of the first visible heading matching
 *  `selector` and `text` (the outline highlights it). Default: the H1 title. */
async function clickTitle(p, selector = 'h1', text = '') {
  const box = await p.evaluate((selector, text) => {
    const h = [...document.querySelectorAll('.ProseMirror ' + selector)].find(
      (x) => x.offsetParent !== null && x.textContent.includes(text)
    );
    const r = h.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + r.height / 2 };
  }, selector, text);
  await p.mouse.click(box.x, box.y);
  await p.keyboard.press('End');
  await wait(400);
}

async function shots(lang) {
  const n = NAMES[lang];
  const outline = { visible: true, view: 'outline' };
  // 1) Realistic document: headings, table and a live Mermaid diagram.
  let p = await open(`lang=${lang}&active=${encodeURIComponent(n.contract)}`, { sidebar: outline, zoom: 0.8 });
  await clickTitle(p);
  await p.screenshot({ path: `${MEDIA}/document-${lang}.png` });
  await p.close();

  // 2) LaTeX formulas and footnotes.
  p = await open(`lang=${lang}&active=${encodeURIComponent(n.memo)}`, { sidebar: outline });
  await clickTitle(p);
  await p.screenshot({ path: `${MEDIA}/math-${lang}.png` });
  await p.close();

  // 3) Menu with export (PDF/DOCX/HTML), over the tabs and the outline.
  p = await open(`lang=${lang}&active=${encodeURIComponent(n.contract)}`, { sidebar: outline });
  await p.click('button[title="' + (lang === 'es' ? 'Menú' : 'Menu') + '"]').catch(async () => {
    // Fallback: the hamburger is the second button of the title bar.
    const btns = await p.$$('[data-tauri-drag-region] button');
    await btns[1].click();
  });
  await wait(400);
  await p.screenshot({ path: `${MEDIA}/export-${lang}.png` });
  await p.close();

  // 4) Dark theme: the agreement's fees table and Mermaid workflow (the
  //    diagram is rendered with Mermaid's dark theme).
  p = await open(`lang=${lang}&active=${encodeURIComponent(n.contract)}`, { theme: 'dark', sidebar: outline });
  await scrollToHeading(p, '2. ');
  await clickTitle(p, 'h2', '2. ');
  await p.screenshot({ path: `${MEDIA}/dark-${lang}.png` });
  await p.close();
}

const SCRIPT = {
  en: {
    heading: '# Kick-off checklist',
    para: 'Hearing set for **May 12**. Before then:',
    items: ['Signed contract', 'Emails and invoices'],
    slash: '/diag',
    mermaid: ['flowchart LR', '  A[Claim] --> B[Answer]', '  B --> C[Hearing]', '  C --> D((Ruling))'],
  },
  es: {
    heading: '# Lista de arranque',
    para: 'Audiencia fijada para el **12 de mayo**. Antes:',
    items: ['Contrato firmado', 'Correos y facturas'],
    slash: '/diag',
    mermaid: ['flowchart LR', '  A[Demanda] --> B[Contestación]', '  B --> C[Audiencia]', '  C --> D((Sentencia))'],
  },
};

async function gif(lang) {
  const s = SCRIPT[lang];
  const dir = path.join(OUT, `gif-${lang}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const p = await open(`lang=${lang}&docs=0`, { width: 1060, height: 640, scale: 1 });
  // The caret helps to read the typing: keep it visible (no blink in screenshots).
  await p.addStyleTag({ content: '.ProseMirror { caret-color: auto !important; }' });
  await p.click('.ProseMirror');
  const frames = []; // { file, dur }
  const shot = async (dur) => {
    const file = `f${String(frames.length).padStart(4, '0')}.png`;
    await p.screenshot({ path: path.join(dir, file) });
    frames.push({ file, dur });
  };
  const FRAME = 1 / 15;
  const type = async (text, every = 2) => {
    let i = 0;
    for (const ch of text) {
      await p.keyboard.type(ch);
      if (++i % every === 0) await shot(FRAME);
    }
    await shot(FRAME);
  };

  await shot(0.6);
  await type(s.heading, 3);
  await p.keyboard.press('Enter');
  await shot(0.3);
  await type(s.para, 5);
  await p.keyboard.press('Enter');
  await type('- ' + s.items[0], 4);
  await p.keyboard.press('Enter');
  await type(s.items[1], 4);
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter'); // leave the list
  await shot(0.5);

  await type(s.slash, 2);
  await wait(300);
  await shot(0.6);
  await p.keyboard.press('Enter');
  await wait(600);
  if (!(await p.$('.iur-mermaid-node textarea'))) {
    await p.click('.iur-mermaid-node');
    await wait(400);
  }
  await shot(0.3);
  for (const [i, line] of s.mermaid.entries()) {
    if (i) await p.keyboard.press('Enter');
    await type(line, 5);
    await wait(900);
    await shot(i === 0 ? 0.2 : 0.45);
  }
  await p.keyboard.down('Control');
  await p.keyboard.press('Enter');
  await p.keyboard.up('Control');
  await wait(1200);
  await p.mouse.move(5, 300);
  await wait(300);
  await shot(1.2);

  // It is still plain Markdown: source view, then back.
  await p.keyboard.down('Control');
  await p.keyboard.down('Shift');
  await p.keyboard.press('KeyM');
  await p.keyboard.up('Shift');
  await p.keyboard.up('Control');
  await wait(600);
  await shot(1.5);
  await p.keyboard.down('Control');
  await p.keyboard.down('Shift');
  await p.keyboard.press('KeyM');
  await p.keyboard.up('Shift');
  await p.keyboard.up('Control');
  await wait(1500);
  await p.mouse.move(5, 300);
  await shot(1.8);

  const list = frames.map((f) => `file '${f.file}'\nduration ${f.dur.toFixed(3)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'frames.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
  const total = frames.reduce((a, f) => a + f.dur, 0);
  console.log(`gif-${lang}: ${frames.length} frames, ${total.toFixed(1)} s`);
  await p.close();
}

for (const lang of langs) {
  if (what === 'all' || what === 'shots') await shots(lang);
  if (what === 'all' || what === 'gif') await gif(lang);
}
await browser.close();
