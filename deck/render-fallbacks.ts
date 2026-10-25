/**
 * Render the charts in index.html to assets/charts/<id>.png: the images a chart slide
 * shows where charts.js cannot run. Run after `bun build.ts`:
 *
 *   bun render-fallbacks.ts          (CHROMIUM=/path/to/chrome to pick the browser)
 *
 * Headless Chromium opens index.html?export, charts.js draws every chart without
 * animation and writes their PNG data URLs into <pre id="chart-export">.
 *
 * The Slides artifact shows these PNGs (it runs no scripts): after a change, upload them to
 * the artifact again and put the new /_blob ids in the slides and in build.ts BLOBS.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const browser = process.env.CHROMIUM ?? "chromium";
const url = `file://${join(ROOT, "index.html")}?export#1`;

const run = spawnSync(browser, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
  "--window-size=1920,1080", "--virtual-time-budget=15000", "--dump-dom", url,
], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (run.status !== 0) throw new Error(`${browser} failed: ${run.stderr || run.error}`);

const json = /<pre id="chart-export">([\s\S]*?)<\/pre>/.exec(run.stdout)?.[1];
if (!json) throw new Error("no <pre id=\"chart-export\"> in the page: did charts.js or Chart.js fail to load?");
const charts = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, string>;

mkdirSync(join(ROOT, "assets/charts"), { recursive: true });
for (const [id, dataUrl] of Object.entries(charts)) {
  const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  writeFileSync(join(ROOT, "assets/charts", `${id}.png`), png);
  console.log(`assets/charts/${id}.png  ${(png.length / 1024).toFixed(0)} KB`);
}
