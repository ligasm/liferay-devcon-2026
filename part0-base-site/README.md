# Part 0 — the base site every measurement runs against

A 10-page Proventeq-style marketing site, rebuilt in a stock Liferay DXP as a
**site initializer**. It is the "realistic customer site" for the Part 1 load tests
and the Part 2 static prototype: content pages built from fragments, a Blogs widget,
an Asset Publisher, a search page and Documents & Media — the page types the talk
compares.

Not pixel-perfect and not the production site: the structure and offerings follow
proventeq.com, the copy is rewritten, the images are generated (`assets/gen_images.py`).

```
part0-base-site/
├── build.ts               content.json + fragments/ + assets/ → dist/site-initializer/** → zip → PUT
├── content/content.json   pages (section lists), 14 blog posts, 10 news items, 8 case studies
├── fragments/pq-*/        16 fragments (header carries the design system CSS)
└── assets/                generated images, the logo, a 210 KB brochure PDF (dl-download.js)
```

## Build and deploy

```bash
cd part0-base-site
python3 assets/gen_images.py          # only if you change the art (outputs are committed)
LIFERAY_URL=http://localhost:8086 LIFERAY_USER=test@liferay.com LIFERAY_PASSWORD=t \
  bun build.ts --deploy
```

`--deploy` sends the zip to `PUT /o/headless-admin-site/v1.0/sites/PROVENTEQ/site-initializer`
(multipart: `file` = zip whose root holds `site-initializer/`, `site` = Site JSON as a
plain form field). The call is add-or-update, so re-running it re-applies everything
to the same site. It also writes `dist/k6.env` with the site id, the document URL and
the page paths for `part1-simulations` (`source ../part0-base-site/dist/k6.env`).

## What is in the site

| Page | URL | Built from | Used by |
|---|---|---|---|
| Home | `/web/proventeq/home` | fragments (hero, logos, cards, steps, stats, quote, CTA) | `guest-browse`, `mix` |
| Proventeq365, Migration Solutions, Services, Digital Experience, About, Contact | `/web/proventeq/<key>` | fragments | `CONTENT_PAGES` |
| Case Studies | `/web/proventeq/case-studies` | 8 case-study card fragments | browse |
| News | `/web/proventeq/news` | **Asset Publisher** (10 Basic Web Content articles, dynamic, newest first) | `asset-publisher` (`AP_PAGE`) |
| Blog | `/web/proventeq/blog` | **Blogs widget** (14 posts) | `BLOG_PATH`, `headless-api` |
| Search (hidden) | `/web/proventeq/search?q=…` | Search Bar + Search Results + Search Options widgets | `search` |
| Documents | `/documents/d/proventeq/<file>-<ext>` | 8 JPEGs, logo, brochure PDF | `dl-download` (`DL_URL`) |

## Site-initializer lessons from DXP 2026.Q1 (all hit while building this)

* **Upload API:** the zip root must contain `site-initializer/`; the `site` part must be
  a plain form field — sent as a file part the API answers `Missing JSON property with the key: site`.
* **Document friendly URLs** keep the extension: `hero-ai.jpg` → `/documents/d/proventeq/hero-ai-jpg`.
* **`html` editables** take `{"html": {"value_i18n": …}}` in `fragmentFields`, not the `text` shape
  (the text shape is silently ignored and the fragment default shows).
* **Classic's own header/footer** are switched off with `layout-set/public/metadata.json`
  `settings`: `lfr-theme:regular:show-header=false`, `…show-footer=false`.
* **Master page import** from an uploaded initializer did not create the master in this
  build (no error logged). The header/footer fragments are therefore placed on every
  page (same render cost); `USE_MASTER=1 bun build.ts --deploy` keeps the master-page variant.
* **Headless for guests:** `/o/headless-delivery` answers `403 { }` to anonymous calls —
  no default Service Access Policy opens it. `headless-api.js` therefore signs in once
  (`API_AUTH=session`); HTTP Basic would re-verify the password hash on every call (~0.5 s).
* **Fragment "Cacheable"** is not a `fragment.json` key in this version — it is set per
  fragment in the UI (S2 in the matrix).
* **Journal articles** from an initializer are always published "now"; blog postings keep
  their `datePublished`.
