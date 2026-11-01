# fidelity/ — Liferay as a headless CMS, the same site as static HTML

`build.mjs` rebuilds the Part 0 Proventeq site as plain HTML files that look exactly like the
pages Liferay renders. It works from **Liferay's APIs, not from scraped pages**:

* the page structure from Headless Delivery;
* the fragment templates;
* the content: web content, blogs and documents.

URLs stay the portal's (`/web/proventeq/<page>`, `/web/proventeq/blog/-/blogs/<slug>`,
`/documents/d/proventeq/<file>`), so the static output can replace the portal behind the same
hostname.

The pipeline one level up (`pipeline/`) is a different idea. It takes Liferay's *rendered*
page body and drops it into its own Astro layout, so it does not look like the portal. This
folder reproduces the portal's look.

```sh
cd part2-static-prototype
ENV_FILE=.env.local-proventeq node fidelity/build.mjs      # → dist-fidelity/, ~6 s
docker compose -f fidelity/docker-compose.yml up -d        # nginx on :8091
open http://127.0.0.1:8091/web/proventeq/home
node tools/check-links.mjs dist-fidelity                   # 76 pages, 0 broken links
```

## Where each piece comes from

| what | API | rendered by |
|---|---|---|
| page tree: sections, rows, columns, fragments, widgets, CSS classes, editable values, fragment configuration | `GET /o/headless-delivery/v1.0/sites/{id}/site-pages/{path}?nestedFields=pageDefinition` | `render.mjs` produces Liferay's container and grid markup |
| fragment HTML / CSS / JS / configuration | `GET /api/jsonws/fragment.fragmententry/get-fragment-entries` (per collection of the site) | `freemarker.mjs` (the FreeMarker subset fragments use), then the editable values are written into `data-lfr-editable-id` elements |
| News (Asset Publisher): list, tags, detail | `GET …/structured-contents?flatten=true` | `widgets.mjs`, in Asset Publisher "abstracts" markup, with the widget's `delta`, sort keys and metadata fields |
| Blog (Blogs widget): list pages, tags, entry, "More Blog Entries" | `GET …/blog-postings` | `widgets.mjs`, in Blogs markup, with `pageDelta` and Liferay's reading time (words ÷ 265 per minute) |
| Search page | the same data, as `assets/search-index.<hash>.json` | in the browser: search bar, "N Results for", 10 per page, highlighting |
| images and files | `GET …/documents?flatten=true`, then each referenced file's `contentUrl` | copied only when the output references them, under the same path |
| theme and widget CSS | the theme's and widgets' static CSS (`/o/classic-theme/css/clay.css`, …) | `css.mjs` combines it with the used fragments' CSS in Liferay's cascade order and prunes it to the selectors the pages can match |
| theme design tokens (`:root { --font-size-base … }`) | none: they are generated per request from the theme's token definition and inlined into the head | taken from **one** rendered page (the home page), as the only thing read from rendered HTML |

One build makes **34 requests** to Liferay. The output is:

* 75 pages: 11 site pages, 10 news items, 14 blog posts, 40 list and tag pages;
* one CSS file;
* one icon sprite;
* the search index;
* 7 documents;
* a `.gz` next to every HTML, CSS, JS, JSON and SVG file, which nginx sends as is
  (`gzip_static`), with a `Content-Length` and no compression per request;
* `_server/nginx.conf`, which gives extension-less document URLs their real `Content-Type`.

The CSS goes from **905 KB → 68 KB**; Clay alone goes from 791 KB to 41 KB.

## How it was checked against Liferay

Each pair was loaded in Chrome at the same viewport, the static page from :8091 and the
portal page from :8086.

* **The 8 fragment-only pages** (home, Proventeq365, Migration Solutions, Services, Digital
  Experience, Case Studies, About, Contact): every `pq-*` element was compared. Position, size,
  font, colour, margins, padding and display were **identical** (0 differences across 1,782
  elements), and so was the page height.
* **News, News detail, Blog list, Blog post:** the widget elements were compared selector by
  selector. Computed styles and page heights are **identical**.
* **Search:** the same layout and the same page height. The result counts are equal or
  within 2:

  | term | static | Liferay |
  |---|---:|---:|
  | azure | 8 | 8 |
  | copilot | 14 | 14 |
  | sharepoint | 11 | 11 |
  | migration | 26 | 28 |
  | governance | 20 | 22 |
  | liferay | 24 | 26 |

  The ranking differs: Elasticsearch scores relevance, and the static search scores term
  frequency.

## Deliberate differences

* **Dates are absolute.** The Blogs widget prints "7 Hours Ago", which a static file cannot
  keep true. Static pages show "Oct 13, 2026" (and "13 Oct" in the entry cards).
* **News detail URLs** are `/web/proventeq/w/<friendlyUrlPath>`, Liferay's display-page URL
  pattern. The portal's URL is `/news/-/asset_publisher/<instance>/content/<slug>`, but the
  widget's instance id is not in the headless page definition.
* **List pagination and tag filters** are pre-rendered pages: `<page>/-/page/<n>` and
  `<page>/-/tag/<tag>`. The portal uses query parameters for them.
* **Portal-only actions are left out.** The "Report" flag button, the share dropdown and the
  items-per-page selector need the portal. Share is rendered as plain links instead. *Sign in*
  (`/c/portal/login`) points back to the portal.
* **The contact form** is the fragment's markup. Sending it would need a form endpoint; that
  was out of scope.

## Limits

* **The FreeMarker evaluator supports exactly what these fragments use:** `[#assign]`, `${…}`,
  `!` defaults, hash literals and lookups. Anything else (`[#if]`, `[#list]`, `?builtins`)
  **fails the build** and names the fragment, rather than rendering wrongly.
* **Widgets without a static renderer fail the build too:** Web Content Display, Navigation
  Menu, Forms and others are not implemented yet.
* **The theme is assumed to be Classic** (`THEME_CSS`, `THEME_ICONS`). Fragment collections
  are read from the site's own group.
* **`LIFERAY_AUTH=basic` re-hashes the password on every call** (≈ 0.5 s, see
  `part1-simulations/results/STRESS-RESULTS.md`). That is most of the 6 s build. OAuth2
  client credentials (`LIFERAY_AUTH=oauth2`) avoids it.

## Same traffic, measured

`part1-simulations/static-vs-edge.sh` runs the same guests against this site on nginx and
against Liferay behind Varnish (S4), on the same box. The results are in
`part1-simulations/results/STATIC-VS-EDGE.md`.

* **HTML only:** a tie. Both serve ≈ 25,000 req/s, and both stop because k6 runs out of CPU.
  nginx used 1.1 cores, Varnish 2.6.
* **Whole first-visit page views** (the HTML plus every file a browser fetches for it):

  | at 1,000 page views/s | static | Liferay via Varnish |
  |---|---:|---:|
  | requests per page view | 4.6 | 56 |
  | bytes on the wire | 99 MB/s | 545 MB/s |
  | server CPU | 0.3 cores | 3.1 cores |
  | page-view p95 | 2 ms | 13 ms |

* **Capacity:** 10,000 page views/s static (k6-bound), 1,200 through Varnish (the box runs out
  of CPU at 1,500).
