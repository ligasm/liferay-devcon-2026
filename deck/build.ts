/**
 * Build a standalone, offline copy of the deck from the slide files.
 *
 *   bun build.ts            → index.html (present with ← → / space, N toggles notes, F fullscreen)
 *                           → speaker-notes.md
 *   bun render-fallbacks.ts → assets/charts/*.png (the images shown where charts.js cannot run)
 *
 * The slide files under project/ are the source of truth, in the format the
 * Claude Slides artifact uses: one <section> per slide, images referenced as
 * /_blob/<id>. This script maps those ids to the files in assets/ and turns the
 * artifact-only <x-shape> arrows into inline SVG so plain browsers render them.
 * Measured charts are drawn by charts.js (Chart.js, vendored in assets/vendor/); each
 * chart slide keeps a PNG of the same chart as its fallback.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;

// /_blob/<id> in the artifact → local file in assets/
const BLOBS: Record<string, string> = {
  "5f5a3bf18299c6cb72deb5c98e80e944": "assets/speaker-miroslav-ligas.png",
  "1070ed81b1eff62e532caab3aebcde9a": "assets/proventeq-logo.png",
  "4153a55345d2d6cae0c4e39efc3408b9": "assets/trails.jpg",
  "92409000d05f018b363b9d3c7f3c166a": "assets/wall.jpg",
  "d13a5b9a6c5993d14dd563cfbc600104": "assets/pages.jpg",
  "daae0f910dac30168a6b7fb4555047fe": "assets/tokens.jpg",
  // chart fallbacks (bun render-fallbacks.ts); re-upload to the artifact when they change
  "3667191d17718d39f03467a17bd6d7ef": "assets/charts/stages-content.png",
  "32b20ebbae09c9b60f17c8d847b9ccd7": "assets/charts/stages-ap.png",
  "ab81ae9c4864faa198df3e70d00e69a2": "assets/charts/stages-search.png",
  "dfa39dae09ef6e3d69cbaa129ff9e416": "assets/charts/stages-signin.png",
  "481928c006392bd3b318da69cc156ccb": "assets/charts/capacity.png",
  "b020eda8caf6cf211acef7edfda25e69": "assets/charts/cost.png",
  "0eccc07c7af3041826509a02e3d064c6": "assets/charts/vs-requests.png",
  "9259776431d8e675fa7e09b46ebeb686": "assets/charts/vs-bytes.png",
  "fbda50afd3cc112a576731029c147057": "assets/charts/vs-cpu.png",
  "b90a92a6be53900a0b922c17d36fbc68": "assets/charts/vs-latency.png",
};

interface Deck {
  title: string;
  order: string[];
  faces: Record<string, { family: string; href?: string }>;
}

const deck = JSON.parse(readFileSync(join(ROOT, "project/deck.json"), "utf8")) as Deck;

function arrowSvg(style: string): string {
  const w = Number(/width:(\d+)px/.exec(style)?.[1] ?? 64);
  const h = Number(/height:(\d+)px/.exec(style)?.[1] ?? 32);
  const fill = /background:(#[0-9a-fA-F]{3,8})/.exec(style)?.[1] ?? "#34a1a0";
  const head = w * 0.4;
  const shaft = h * 0.4;
  const pts = [
    [0, (h - shaft) / 2], [w - head, (h - shaft) / 2], [w - head, 0], [w, h / 2],
    [w - head, h], [w - head, (h + shaft) / 2], [0, (h + shaft) / 2],
  ].map(([x, y]) => `${x},${y}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex:none"><polygon points="${pts}" fill="${fill}"/></svg>`;
}

const notes: string[] = [];
const sections = deck.order.map((id, i) => {
  let html = readFileSync(join(ROOT, "project/slides", `${id}.html`), "utf8");
  html = html.replace(/\/_blob\/([0-9a-f]{32})/g, (m, blob: string) => BLOBS[blob] ?? m);
  html = html.replace(/<x-shape kind="arrow-right" style="([^"]*)"><\/x-shape>/g, (_m, s: string) => arrowSvg(s));
  const aside = /<aside>([\s\S]*?)<\/aside>/.exec(html)?.[1]?.trim() ?? "";
  const title = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(html)?.[1]?.replace(/<br>/g, " ").replace(/<[^>]+>/g, "") ?? id;
  // the Slides editor saves line breaks in notes as <br> and &nbsp;
  notes.push(`## ${i + 1}. ${title}\n\n${aside.replace(/&nbsp;/g, " ").replace(/ *<br\s*\/?>/g, "  \n")}\n`);
  return html.replace(/<aside>([\s\S]*?)<\/aside>/, (_m, text: string) => `<aside class="notes">${text.replace(/<br\s*\/?>/g, "\n")}</aside>`);
});

const chartsJs = readFileSync(join(ROOT, "charts.js"), "utf8");

const fontLinks = Object.values(deck.faces)
  .filter((f) => f.href)
  .map((f) => `<link rel="stylesheet" href="${f.href}">`)
  .join("\n");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${deck.title}</title>
${fontLinks}
<style>
  html, body { margin: 0; height: 100%; background: #081621; overflow: hidden; }
  #stage { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px; transform-origin: 0 0; }
  /* inline styles set display:flex on every slide, so hiding needs !important */
  #stage > section { position: absolute; inset: 0; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; }
  #stage > section:not(.on) { display: none !important; }
  .export #stage > section { display: flex !important; }
  /* the artifact paints flow content over pinned backdrops listed first; plain CSS needs a stacking hint */
  #stage > section > *:not([style*="position:absolute"]) { position: relative; z-index: 1; }
  section p, section h1, section h2, section h3, section ul { margin: 0; }
  section ul { padding-left: 1.2em; }
  section table { border-collapse: collapse; width: 100%; }
  section th, section td { padding: 0.35em 0.6em; border-bottom: 1px solid #d8e0e2; text-align: left; }
  aside.notes { display: none; }
  #notes { position: fixed; left: 0; right: 0; bottom: 0; max-height: 30vh; overflow: auto; background: #f4f7f7; color: #0f2838;
           font: 16px/1.5 'IBM Plex Sans', sans-serif; padding: 12px 20px; display: none; white-space: pre-line; }
  #notes.on { display: block; }
  #count { position: fixed; right: 12px; top: 8px; color: #6a7a84; font: 13px sans-serif; }
</style>
</head>
<body>
<div id="stage">
${sections.join("\n")}
</div>
<div id="notes"></div>
<div id="count"></div>
<script>
  const slides = [...document.querySelectorAll('#stage > section')];
  const stage = document.getElementById('stage');
  const notes = document.getElementById('notes');
  const count = document.getElementById('count');
  let i = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1)) || 1) - 1));
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'scale(' + s + ') translate(-50%, -50%)';
  }
  function show() {
    slides.forEach((el, k) => el.classList.toggle('on', k === i));
    const a = slides[i].querySelector('aside.notes');
    notes.textContent = a ? a.textContent : '';
    count.textContent = (i + 1) + ' / ' + slides.length;
    history.replaceState(null, '', location.search + '#' + (i + 1));
    document.dispatchEvent(new CustomEvent('deck:slide', { detail: slides[i] }));
  }
  addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) i = Math.min(slides.length - 1, i + 1);
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = slides.length - 1;
    else if (e.key === 'n' || e.key === 'N') notes.classList.toggle('on');
    else if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.();
    else return;
    e.preventDefault(); show();
  });
  addEventListener('click', (e) => { if (!notes.contains(e.target)) { i = Math.min(slides.length - 1, i + 1); show(); } });
  addEventListener('resize', fit);
  addEventListener('hashchange', () => { const n = parseInt(location.hash.slice(1)); if (n) { i = Math.max(0, Math.min(slides.length - 1, n - 1)); show(); } });
  fit(); show();
</script>
<script src="assets/vendor/chart-4.4.1.umd.js"></script>
<script>
${chartsJs}
</script>
</body>
</html>
`;

writeFileSync(join(ROOT, "index.html"), page);
writeFileSync(join(ROOT, "speaker-notes.md"), `# ${deck.title} — speaker notes\n\n${notes.join("\n")}`);
console.log(`index.html: ${sections.length} slides · speaker-notes.md written`);
