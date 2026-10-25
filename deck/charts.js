/*
 * Measured Part 1 charts, drawn with Chart.js (assets/vendor/chart-4.4.1.umd.js).
 *
 * A slide carries <canvas data-chart="<id>"> next to an <img data-chart-fallback> of the
 * same chart. When Chart.js loads, the canvas replaces the image; without it (no JS, the
 * script missing, the Slides artifact) the image stays. `bun render-fallbacks.ts` renders
 * these same configs to assets/charts/<id>.png, so the fallback is never out of date.
 *
 * Numbers: part1-simulations/results/LAB-RESULTS.md and STRESS-RESULTS.md (2026-10-24).
 */
(function () {
  const INK = '#0f2838', INK2 = '#4a5a66', MUTED = '#6a7a84', GRID = '#d8e0e2';
  const TEAL = '#34a1a0';
  const FONT = "'IBM Plex Sans', Arial, sans-serif";
  const fmt = (n) => n.toLocaleString('en-US');

  // Text next to each bar or at the end of each line, in ink, never in the series colour
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.format) return;
      const { ctx } = chart;
      ctx.save();
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const text = opts.format(ds.data[i], i, ds);
          if (!text) return;
          const lines = [].concat(text);
          const horizontal = chart.options.indexAxis === 'y';
          const line = meta.type === 'line';
          if (line && i !== meta.data.length - 1) return;
          ctx.textBaseline = 'middle';
          ctx.textAlign = horizontal || line ? 'left' : 'center';
          const x = horizontal ? el.x + 20 : line ? el.x + 24 : el.x;
          const y0 = horizontal || line ? el.y - (lines.length - 1) * 19 : el.y - (opts.size || 34) * 0.75 - (lines.length - 1) * 38;
          lines.forEach((t, k) => {
            ctx.font = `${k === 0 ? 600 : 400} ${k === 0 ? opts.size || 34 : 26}px ${FONT}`;
            ctx.fillStyle = k === 0 ? INK : INK2;
            ctx.fillText(t, x, y0 + k * 38);
          });
        });
      });
      ctx.restore();
    },
  };

  const axisTicks = { color: INK2, font: { family: FONT, size: 28 } };
  const axisTitle = (text) => ({ display: true, text, color: MUTED, font: { family: FONT, size: 26 } });
  const base = (extra) => ({
    responsive: false,
    devicePixelRatio: 2,
    animation: { duration: 900, easing: 'easeOutQuart' },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    ...extra,
  });

  const CHARTS = {
    // LAB-RESULTS.md "Load pass": p95 ms per flow, mix at ≈ 120 req/s; one panel per flow
    ...Object.fromEntries([
      ['content', 'Content page', [49, 35, 21, 21, 2], true],
      ['ap', 'Asset Publisher', [76, 55, 34, 36, 2], true],
      ['search', 'Search', [994, 792, 639, 653, 2], true],
      ['signin', 'Sign-in · bypassed', [1106, 992, 890, 921, 537], false],
    ].map(([id, title, data, cached]) => [`stages-${id}`, () => ({
      type: 'bar',
      data: {
        labels: ['S0', 'S1', 'S2', 'S3', 'S4'],
        datasets: [{
          data,
          backgroundColor: data.map((_v, i) => (i === 4 && cached ? TEAL : INK)),
          borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start',
          barPercentage: 0.74, categoryPercentage: 1, minBarLength: 4,
        }],
      },
      options: base({
        layout: { padding: { top: 8 } },
        scales: {
          x: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, font: { family: FONT, size: 26 } } },
          y: { display: false, min: 0, max: Math.max(...data) * 1.18 },
        },
        plugins: {
          legend: { display: false }, tooltip: { enabled: false },
          title: { display: true, text: title, align: 'start', color: INK, font: { family: FONT, size: 32, weight: 600 }, padding: { bottom: 8 } },
          subtitle: { display: true, text: 'p95 ms', align: 'start', color: MUTED, font: { family: FONT, size: 24 }, padding: { bottom: 24 } },
          valueLabels: { size: 26, format: (v) => fmt(v) },
        },
      }),
    })])),

    // STRESS-RESULTS.md "Headline numbers": clean capacity, guest pages
    capacity: () => ({
      type: 'bar',
      data: {
        labels: ['S0 stock origin', 'S3 tuned origin', 'S4 Varnish edge'],
        datasets: [{
          data: [400, 1200, 24800],
          backgroundColor: [INK, INK, TEAL],
          borderRadius: { topRight: 6, bottomRight: 6 }, borderSkipped: 'start',
          barPercentage: 0.62, categoryPercentage: 1,
        }],
      },
      options: base({
        indexAxis: 'y',
        layout: { padding: { right: 340 } },
        scales: {
          x: {
            min: 0, max: 25000, grid: { color: GRID }, border: { display: false },
            ticks: { ...axisTicks, stepSize: 5000, callback: (v) => fmt(v) },
            title: axisTitle('guest page views per second, < 1 % errors, every p95 < 2 s'),
          },
          y: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, color: INK, font: { family: FONT, size: 32, weight: 600 } } },
        },
        plugins: {
          legend: { display: false }, tooltip: { enabled: false },
          valueLabels: { format: (v, i) => [`${fmt(v)} req/s`, ['', '3× stock', '62× stock · 20× tuned'][i]].filter(Boolean) },
        },
      }),
    }),

    // STRESS-RESULTS.md "What each step costs": Liferay container CPU per unit of work
    cost: () => ({
      type: 'bar',
      data: {
        labels: ['Page from Varnish', 'Page, tuned origin', 'Search', 'Sign-in'],
        datasets: [{
          data: [0.1, 9, 425, 875],
          backgroundColor: [TEAL, TEAL, INK, INK],
          borderRadius: { topRight: 6, bottomRight: 6 }, borderSkipped: 'start',
          barPercentage: 0.62, categoryPercentage: 1, minBarLength: 4,
        }],
      },
      options: base({
        indexAxis: 'y',
        layout: { padding: { right: 360 } },
        scales: {
          x: {
            min: 0, max: 1000, grid: { color: GRID }, border: { display: false },
            ticks: { ...axisTicks, stepSize: 250, callback: (v) => `${fmt(v)} ms` },
            title: axisTitle('Liferay CPU per unit of work'),
          },
          y: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, color: INK, font: { family: FONT, size: 32, weight: 600 } } },
        },
        plugins: {
          legend: { display: false }, tooltip: { enabled: false },
          valueLabels: {
            format: (_v, i) => [
              ['≈ 0.1 ms', '1/80 of a page'],
              ['≈ 9 ms', '1 page view'],
              ['350–500 ms', '≈ 50 page views'],
              ['650–1,100 ms', '≈ 100 page views'],
            ][i],
          },
        },
      }),
    }),
  };

  const live = new Map();

  function render(canvas, animate) {
    const make = CHARTS[canvas.dataset.chart];
    if (!make || !window.Chart) return null;
    live.get(canvas)?.destroy();
    canvas.style.display = 'block';
    const fallback = canvas.parentElement.querySelector('[data-chart-fallback]');
    if (fallback) fallback.style.display = 'none';
    const config = make();
    if (!animate) config.options.animation = false;
    const chart = new window.Chart(canvas, { ...config, plugins: [valueLabels] });
    live.set(canvas, chart);
    return chart;
  }

  function renderSlide(section) {
    section?.querySelectorAll('canvas[data-chart]').forEach((c) => render(c, true));
  }

  window.deckCharts = { CHARTS, render };

  if (!window.Chart) return; // keep the fallback images
  window.Chart.defaults.font.family = FONT;

  const ready = document.fonts ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    if (new URLSearchParams(location.search).has('export')) {
      // render-fallbacks.ts: draw every chart without animation and hand back PNG data URLs
      document.documentElement.classList.add('export');
      const out = {};
      document.querySelectorAll('canvas[data-chart]').forEach((c) => {
        render(c, false);
        out[c.dataset.chart] = c.toDataURL('image/png');
      });
      const pre = document.createElement('pre');
      pre.id = 'chart-export';
      pre.textContent = JSON.stringify(out);
      document.body.appendChild(pre);
      return;
    }
    renderSlide(document.querySelector('#stage > section.on'));
    document.addEventListener('deck:slide', (e) => renderSlide(e.detail));
  });
})();
