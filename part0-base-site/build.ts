/**
 * build.ts — turn content/content.json + fragments/ + assets/ into a Liferay
 * site-initializer zip and (optionally) push it to a running portal.
 *
 *   bun build.ts              # writes dist/site-initializer/** and dist/proventeq-site.zip
 *   bun build.ts --deploy     # …and PUTs it to /o/headless-admin-site/v1.0/sites/<ERC>/site-initializer
 *
 * Env: LIFERAY_URL (http://localhost:8086), LIFERAY_USER (test@liferay.com),
 *      LIFERAY_PASSWORD (t), SITE_ERC (PROVENTEQ), SITE_FRIENDLY_URL (/proventeq).
 *
 * The PUT is "add or update": re-running it re-applies fragments, pages, documents,
 * articles and blog posts to the same site (matched by external reference codes).
 */
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const DIST = join(HERE, "dist");
const SI = join(DIST, "site-initializer");

const LIFERAY_URL = (process.env.LIFERAY_URL ?? "http://localhost:8086").replace(/\/$/, "");
const LIFERAY_USER = process.env.LIFERAY_USER ?? "test@liferay.com";
const LIFERAY_PASSWORD = process.env.LIFERAY_PASSWORD ?? "t";
const SITE_ERC = process.env.SITE_ERC ?? "PROVENTEQ";
const SITE_FRIENDLY_URL = process.env.SITE_FRIENDLY_URL ?? "/proventeq";
const SITE = `/web${SITE_FRIENDLY_URL.replace(/^\/web/, "")}`;
const DOCS = `/documents/d${SITE_FRIENDLY_URL}`; // D&M friendly URLs: /documents/d/<site>/<file-friendly-url>

type Link = { label: string; page: string };
type Section = Record<string, any> & { type: string };
type Page = { key: string; name: string; title: string; description: string; sections: Section[] };
const content = JSON.parse(readFileSync(join(HERE, "content", "content.json"), "utf8"));
const pages: Page[] = content.pages;

const NAV_PAGES = ["proventeq365", "migration-solutions", "services", "digital-experience", "case-studies", "news", "blog", "about"];
const HIDDEN_PAGES = new Set(["home", "contact", "search"]); // reachable, just not in the top nav
const href = (page: string) => (page.startsWith("http") || page.startsWith("/") ? page : `${SITE}/${page}`);
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const write = (path: string, data: unknown) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data, null, "\t") + "\n");
};

// ---------------------------------------------------------------------------
// page-definition helpers
// ---------------------------------------------------------------------------
const text = (id: string, value: string) => ({ id, value: { fragmentLink: {}, text: { value_i18n: { en_US: value ?? "" } } } });
// data-lfr-editable-type="html" editables take a FragmentFieldHTML value, not a text one
const html = (id: string, value: string) => ({ id, value: { html: { value_i18n: { en_US: value ?? "" } } } });
const link = (id: string, l?: Link) => ({
	id,
	value: { fragmentLink: { href_i18n: { en_US: l ? href(l.page) : "" } }, text: { value_i18n: { en_US: l?.label ?? "" } } },
});

const frag = (key: string, fields: object[] = [], config: Record<string, string> = {}) => ({
	type: "Fragment",
	definition: { fragment: { key }, fragmentConfig: config, fragmentFields: fields, fragmentViewports: [] },
});

const section = (classes: string[], children: object[]) => ({
	type: "Section",
	definition: { cssClasses: classes, fragmentStyle: {}, layout: { widthType: "Fluid" } },
	pageElements: children,
});

const band = (tone: string | undefined, children: object[], extra: string[] = []) =>
	section(["pq-band", ...(tone ? [`pq-band--${tone}`] : []), ...extra], [section(["pq-wrap"], children)]);

const viewports = (mobileSize = 12) => [
	{ id: "landscapeMobile", columnViewportDefinition: { size: mobileSize } },
	{ id: "portraitMobile", columnViewportDefinition: { size: 12 } },
	{ id: "tablet", columnViewportDefinition: { size: mobileSize === 12 ? 6 : mobileSize } },
];

const row = (cols: number, items: object[]) => {
	const size = Math.floor(12 / cols);
	const rows: object[] = [];
	for (let i = 0; i < items.length; i += cols) {
		const chunk = items.slice(i, i + cols);
		rows.push({
			type: "Row",
			definition: {
				gutters: true,
				modulesPerRow: cols,
				numberOfColumns: cols,
				rowViewports: [
					{ id: "landscapeMobile", rowViewportDefinition: { modulesPerRow: 1 } },
					{ id: "portraitMobile", rowViewportDefinition: { modulesPerRow: 1 } },
					{ id: "tablet", rowViewportDefinition: { modulesPerRow: Math.min(cols, 2) } },
				],
			},
			pageElements: Array.from({ length: cols }, (_, c) => ({
				type: "Column",
				definition: { size, columnViewports: viewports() },
				pageElements: chunk[c] ? [chunk[c]] : [],
			})),
		});
	}
	return rows;
};

const heading = (s: { eyebrow?: string; title?: string; intro?: string }, align = "center") =>
	s.title ? [frag("pq-heading", [text("eyebrow", s.eyebrow ?? ""), text("title", s.title), text("intro", s.intro ?? "")], { align })] : [];

const ul = (items: string[], cls: string) => `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

const HERO_IMAGES: Record<string, string> = {
	home: "hero-migrate", proventeq365: "hero-govern", "migration-solutions": "hero-migrate", services: "hero-ai",
	"digital-experience": "hero-portal", "case-studies": "hero-govern", news: "hero-ai", blog: "hero-portal", about: "hero-ai", contact: "split-cloud",
};
const SPLIT_IMAGES = ["split-team", "split-data", "split-cloud", "split-liferay"];
let splitCounter = 0;

function renderSection(page: Page, s: Section, index: number): object[] {
	switch (s.type) {
		case "hero":
			return [frag("pq-hero",
				[text("eyebrow", s.eyebrow), text("title", s.title), text("lead", s.lead), link("cta1", s.primaryCta), link("cta2", s.secondaryCta)],
				{ variant: s.variant === "light" ? "light" : "dark", image: s.variant === "light" ? "split-cloud" : HERO_IMAGES[page.key] ?? "hero-migrate", size: page.key === "home" ? "large" : "compact" })];
		case "logos":
			return [band(undefined, [frag("pq-logos", [text("title", s.title), html("items", ul(s.items, "pq-logos__list"))])], ["pq-band--tight"])];
		case "cards": {
			const cols = Math.min(Math.max(Number(s.columns) || 3, 2), 4);
			const cards = (s.items ?? []).map((c: any) => frag("pq-card", [text("title", c.title), text("text", c.text), link("link", c.link)], { icon: c.icon ?? "sparkle" }));
			return [band(index % 2 ? "paper" : undefined, [...heading(s), ...row(cols, cards)])];
		}
		case "stats": {
			const stats = s.items.map((i: any) => frag("pq-stat", [text("value", i.value), text("label", i.label)]));
			return [band("navy", [...heading(s), ...row(Math.min(s.items.length, 4), stats)])];
		}
		case "split": {
			const img = SPLIT_IMAGES[splitCounter++ % SPLIT_IMAGES.length];
			return [band(index % 2 ? "paper" : undefined, [frag("pq-split",
				[text("eyebrow", s.eyebrow ?? ""), text("title", s.title), text("text", s.text ?? ""), html("bullets", s.bullets?.length ? ul(s.bullets, "pq-ticks") : ""), link("cta", s.cta)],
				{ imageSide: s.imageSide === "left" ? "left" : "right", image: img })])];
		}
		case "steps": {
			const steps = s.items.map((i: any, n: number) => frag("pq-step", [text("num", String(n + 1).padStart(2, "0")), text("title", i.title), text("text", i.text)]));
			return [band("paper", [...heading(s), ...row(Math.min(s.items.length, 4) === 3 ? 3 : Math.min(s.items.length, 4), steps)])];
		}
		case "quote":
			return [band("dark", [frag("pq-quote", [text("text", s.text), text("role", s.role)])])];
		case "chips":
			return [band(index % 2 ? "paper" : undefined, [frag("pq-chips", [text("title", s.title), html("items", ul(s.items, "pq-chips__list"))])], ["pq-band--tight"])];
		case "faq":
			return [band(index % 2 ? "paper" : undefined, [...heading(s), ...s.items.map((i: any) => frag("pq-faq", [text("q", i.q), text("a", `<p>${esc(i.a)}</p>`)]))])];
		case "cta":
			return [band(undefined, [frag("pq-cta", [text("title", s.title), text("text", s.text), link("cta", s.cta)])], ["pq-band--tight"])];
		case "contact": {
			const offices = (s.offices ?? []).map((o: any) => frag("pq-office", [text("city", o.city), text("address", o.address), text("phone", o.phone)]));
			const form = frag("pq-contact-form", [text("title", "Send us a message"), text("note", s.text ?? "")]);
			return [band(undefined, [
				...heading({ title: s.title, intro: s.email ? `Email ${s.email}` : "" }),
				{
					type: "Row",
					definition: { gutters: true, modulesPerRow: 2, numberOfColumns: 2, rowViewports: [
						{ id: "landscapeMobile", rowViewportDefinition: { modulesPerRow: 1 } },
						{ id: "portraitMobile", rowViewportDefinition: { modulesPerRow: 1 } },
						{ id: "tablet", rowViewportDefinition: { modulesPerRow: 1 } }] },
					pageElements: [
						{ type: "Column", definition: { size: 5, columnViewports: viewports() }, pageElements: [section(["pq-stack"], offices)] },
						{ type: "Column", definition: { size: 7, columnViewports: viewports() }, pageElements: [form] },
					],
				},
			])];
		}
		default:
			console.warn(`  ! unknown section type "${s.type}" on ${page.key} — skipped`);
			return [];
	}
}

// Liferay widgets: what makes the News, Blog and Search pages "real portal" pages
// (Asset Publisher ≈ 2.3× a content page in Liferay's own benchmark).
// widgetConfig values become portlet preferences and must be strings (or string arrays)
const widget = (widgetName: string, widgetConfig: Record<string, unknown> = {}, fragmentStyle: object = {}) => ({
	type: "Widget",
	definition: { fragmentStyle, widgetInstance: { widgetName, widgetConfig } },
});
const BLOGS = "com_liferay_blogs_web_portlet_BlogsPortlet";
const ASSET_PUBLISHER = "com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet";
const SEARCH_BAR = "com_liferay_portal_search_web_search_bar_portlet_SearchBarPortlet";
const SEARCH_RESULTS = "com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet";
const SEARCH_OPTIONS = "com_liferay_portal_search_web_search_options_portlet_SearchOptionsPortlet";
// search widget preferences as used by Liferay's own teaser-showcase site initializer
const SEARCH_BAR_CONFIG = {
	destination: "", displayStyle: "default", displayStyleGroupId: "[$GROUP_ID$]", invisible: "false",
	keywordsParameterName: "q", scopeParameterName: "scope", searchScope: "this-site", showStagedResults: "false",
	suggestionsEnabled: "false", useAdvancedSearchSyntax: "false",
};
const SEARCH_RESULTS_CONFIG = {
	displayInDocumentForm: "false", displayStyle: "ddmTemplate_SEARCH-RESULTS-COMPACT-FTL", displayStyleGroupId: "[$GROUP_ID$]",
	displayStyleGroupKey: "[$GROUP_KEY$]", highlightEnabled: "true", paginationDelta: "10", paginationDeltaParameterName: "delta",
	paginationStartParameterName: "start", showEmptyResultMessage: "true", showPagination: "true", viewInContext: "true",
};
const SEARCH_OPTIONS_CONFIG = { allowEmptySearches: "true", basicFacetSelection: "false", displayStyleGroupId: "[$GROUP_ID$]", retainFacetSelections: "true" };

function extraElements(page: Page): object[] {
	switch (page.key) {
		case "case-studies":
			return [band("paper", row(2, content.caseStudies.map((c: any) => frag("pq-case-card", [
				text("industry", c.industry), text("route", `${c.source} → ${c.target}`), text("title", c.title), text("client", c.client),
				text("summary", c.summary), html("results", ul(c.results ?? [], "pq-ticks")), text("quote", `“${c.endorsement?.text ?? ""}” — ${c.endorsement?.role ?? ""}`),
			]))))];
		case "news":
			return [band(undefined, [section(["pq-widgets"], [widget(ASSET_PUBLISHER, AP_CONFIG)])])];
		case "blog":
			return [band(undefined, [section(["pq-widgets"], [widget(BLOGS, { displayStyle: "abstract", pageDelta: "10", enableComments: "false", enableRatings: "false", enableReadingTime: "true" })])])];
		default:
			return [];
	}
}

const AP_CONFIG: Record<string, unknown> = {
	// Dynamic selection: latest web content of the "News" structure in this site, 10 per page.
	selectionStyle: "dynamic",
	classNameIds: ["[$CLASS_NAME_ID:com.liferay.journal.model.JournalArticle$]"],
	anyAssetType: "false",
	delta: "10",
	displayStyle: "abstracts",
	orderByColumn1: "publishDate",
	orderByType1: "DESC",
	showMetadataDescriptions: "true",
	metadataFields: "publish-date,tags",
	paginationType: "simple",
};

// USE_MASTER=1: header/footer come from the "Proventeq Master" master page.
// Default: header/footer fragments are placed on every page directly (same render cost,
// no dependency on master-page import).
const USE_MASTER = process.env.USE_MASTER === "1";
const chromeHeader = () => frag("pq-header", [link("cta", { label: "Talk to us", page: "contact" })]);
const chromeFooter = () => frag("pq-footer", [text("about", content.site.footer.about)]);

function pageDefinition(children: object[]) {
	return {
		pageElement: { type: "Root", pageElements: USE_MASTER ? children : [chromeHeader(), ...children, chromeFooter()] },
		...(USE_MASTER ? { settings: { masterPage: { key: "proventeq-master" } } } : {}),
		version: 1.1,
	};
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(SI, { recursive: true });

// fragments ------------------------------------------------------------------
const navHtml = NAV_PAGES.map((k) => {
	const p = pages.find((x) => x.key === k)!;
	return `\t\t\t<a href="${SITE}/${k}">${esc(p.name)}</a>`;
}).join("\n");
const footer = content.site.footer;
const footerColumns = (footer.columns ?? []).slice(0, 4).map((col: any) =>
	`\t\t<div>\n\t\t\t<h4>${esc(col.title)}</h4>\n\t\t\t<ul>${col.links.map((l: Link) => `<li><a href="${href(l.page)}">${esc(l.label)}</a></li>`).join("")}</ul>\n\t\t</div>`).join("\n");

const substitute = (s: string) => s
	.replaceAll("{{SITE}}", SITE)
	.replaceAll("{{DOCS}}", DOCS)
	.replaceAll("{{LOGO_URL}}", `${DOCS}/proventeq-logo-png`)
	.replaceAll("{{NAV}}", navHtml)
	.replaceAll("{{FOOTER_ABOUT}}", esc(footer.about))
	.replaceAll("{{FOOTER_CONTACT}}", `${esc(footer.address)}<br />${esc(footer.email)} &middot; ${esc(footer.phone)}`)
	.replaceAll("{{FOOTER_COLUMNS}}", footerColumns);

const FRAG_SRC = join(HERE, "fragments");
const FRAG_OUT = join(SI, "fragments", "group", "proventeq");
write(join(FRAG_OUT, "collection.json"), { name: "Proventeq", description: "Proventeq base-site fragments (part0-base-site/fragments)." });
for (const key of readdirSync(FRAG_SRC)) {
	const out = join(FRAG_OUT, key);
	for (const f of ["index.html", "index.css", "index.js", "configuration.json"]) {
		write(join(out, f), substitute(readFileSync(join(FRAG_SRC, key, f), "utf8")));
	}
	const name = key.replace(/^pq-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
	write(join(out, "fragment.json"), {
		configurationPath: "configuration.json", cssPath: "index.css", htmlPath: "index.html", jsPath: "index.js",
		icon: "square-hole", key, name: `PQ ${name}`, type: "component",
	});
}

const THEME_SETTINGS = {
	"lfr-theme:regular:show-footer": "false",
	"lfr-theme:regular:show-header": "false",
	"lfr-theme:regular:show-header-search": "false",
	"lfr-theme:regular:show-maximize-minimize-application-links": "false",
	"lfr-theme:regular:wrap-widget-page-content": "false",
};

// master page ------------------------------------------------------------------
const MASTER = join(SI, "layout-page-templates", "master-pages", "proventeq-master");
write(join(MASTER, "master-page.json"), { name: "Proventeq Master" });
write(join(MASTER, "page-definition.json"), {
	pageElement: {
		type: "Root",
		pageElements: [
			{ type: "Section", definition: { name: "Page Header", indexed: true, layout: {} }, pageElements: [chromeHeader()] },
			{ type: "Section", definition: { name: "Main", layout: {} }, pageElements: [{ type: "DropZone" }] },
			{ type: "Section", definition: { name: "Page Footer", layout: {} }, pageElements: [chromeFooter()] },
		],
	},
	settings: { themeSettings: THEME_SETTINGS },
	version: 1.1,
});

// layout set: Classic stays the theme, but its own header/footer are switched off ------
write(join(SI, "layout-set", "public", "metadata.json"), { settings: THEME_SETTINGS, themeName: "Classic" });

// blog postings: Blogs widget on /blog, also what headless-api.js lists ------------
write(join(SI, "blog-postings.json"), content.blogPosts.map((b: any) => ({
	externalReferenceCode: `PQ-BLOG-${b.slug}`.toUpperCase().slice(0, 75),
	headline: b.title,
	alternativeHeadline: b.description,
	description: b.description,
	articleBody: b.body,
	encodingFormat: "text/html",
	friendlyUrlPath: b.slug,
	datePublished: `${b.date}T09:00:00Z`,
	keywords: b.tags ?? [],
	viewableBy: "Anyone",
})));

// news: Basic Web Content articles, listed by the Asset Publisher on /news ------------
for (const n of content.news) {
	const dir = join(SI, "journal-articles", "News");
	const id = `PQ-NEWS-${n.slug}`.toUpperCase().slice(0, 75);
	write(join(dir, `${n.slug}.json`), { articleId: id, ddmStructureKey: "BASIC-WEB-CONTENT", name: n.title, assetTagNames: n.tags ?? [] });
	const body = `<p><strong>${esc(n.summary)}</strong></p>${n.body}`;
	write(join(dir, `${n.slug}.xml`), `<?xml version="1.0"?>

<root available-locales="en_US" default-locale="en_US" version="1.0">
	<dynamic-element field-reference="content" index-type="text" instance-id="${Math.random().toString(36).slice(2, 10)}" name="content" type="rich_text">
		<dynamic-content language-id="en_US"><![CDATA[${body}]]></dynamic-content>
	</dynamic-element>
</root>
`);
}
write(join(SI, "journal-articles", "News.metadata.json"), { externalReferenceCode: "PQ-NEWS-FOLDER", name: "News", description: "Press and company news", viewableBy: "Anyone" });

// layouts -----------------------------------------------------------------------
pages.forEach((page, i) => {
	splitCounter = 0;
	const dir = join(SI, "layouts", `${String(i + 1).padStart(2, "0")}-${page.key}`);
	write(join(dir, "page.json"), {
		friendlyURL: `/${page.key}`,
		hidden: HIDDEN_PAGES.has(page.key),
		name: page.name,
		name_i18n: { en_US: page.name },
		title_i18n: { en_US: page.title },
		description_i18n: { en_US: page.description },
		private: false,
		system: false,
		type: "content",
	});
	const children = page.sections.flatMap((s, n) => renderSection(page, s, n));
	// widget/list blocks go right after the hero (first section)
	const extra = extraElements(page);
	children.splice(1, 0, ...extra);
	write(join(dir, "page-definition.json"), pageDefinition(children));
});

// search page (hidden): what k6/search.js hits as $SITE_PATH/search?q=…
{
	const dir = join(SI, "layouts", "99-search");
	write(join(dir, "page.json"), {
		friendlyURL: "/search", hidden: true, name: "Search", name_i18n: { en_US: "Search" },
		private: false, system: false, type: "content",
	});
	write(join(dir, "page-definition.json"), pageDefinition([
		frag("pq-hero", [text("eyebrow", "Search"), text("title", "Search proventeq"), text("lead", "Blogs, news and pages across the site."), link("cta1"), link("cta2")], { variant: "dark", image: "hero-govern", size: "compact" }),
		band(undefined, [section(["pq-widgets"], [widget(SEARCH_BAR, SEARCH_BAR_CONFIG), widget(SEARCH_RESULTS, SEARCH_RESULTS_CONFIG), widget(SEARCH_OPTIONS, SEARCH_OPTIONS_CONFIG, { hidden: true })])]),
	]));
}

// documents -----------------------------------------------------------------------
const DOCS_OUT = join(SI, "documents", "group");
mkdirSync(DOCS_OUT, { recursive: true });
for (const f of readdirSync(join(HERE, "assets")).filter((f) => /\.(jpg|png|pdf)$/.test(f))) {
	cpSync(join(HERE, "assets", f), join(DOCS_OUT, f));
}

writeFileSync(join(DIST, "build-info.json"), JSON.stringify({ SITE, DOCS, SITE_ERC, pages: pages.map((p) => p.key) }, null, 2));
console.log(`built ${SI}`);

// zip: root must contain the site-initializer/ folder
const ZIP = join(DIST, "proventeq-site.zip");
await $`cd ${DIST} && zip -qr ${ZIP} site-initializer`;
console.log(`zipped ${ZIP}`);

if (process.argv.includes("--deploy")) {
	const form = new FormData();
	form.append("file", new Blob([readFileSync(ZIP)], { type: "application/zip" }), "proventeq-site.zip");
	// a plain form field (not a Blob — a Blob part becomes a file and the API ignores it)
	form.append("site", JSON.stringify({
		name: content.site.name ?? "Proventeq",
		friendlyUrlPath: SITE_FRIENDLY_URL,
		externalReferenceCode: SITE_ERC,
		description: content.site.tagline ?? "",
	}));
	const auth = "Basic " + Buffer.from(`${LIFERAY_USER}:${LIFERAY_PASSWORD}`).toString("base64");
	const started = Date.now();
	const res = await fetch(`${LIFERAY_URL}/o/headless-admin-site/v1.0/sites/${SITE_ERC}/site-initializer`, {
		method: "PUT", headers: { Authorization: auth, Accept: "application/json" }, body: form,
	});
	const body = await res.text();
	console.log(`PUT site-initializer → ${res.status} in ${Date.now() - started} ms`);
	if (!res.ok) {
		console.error(body.slice(0, 2000));
		process.exit(1);
	}
	const site = JSON.parse(body);
	console.log(`site ${site.name} id=${site.id} friendlyUrlPath=${site.friendlyUrlPath}`);

	// k6.env: everything part1-simulations needs to target this site (source it before ./run.sh)
	const docs = await (await fetch(`${LIFERAY_URL}/o/headless-delivery/v1.0/sites/${site.id}/documents?pageSize=50&fields=fileName,contentUrl`, { headers: { Authorization: auth } })).json();
	const pdf = docs.items.find((d: any) => d.fileName.endsWith(".pdf"));
	const dlUrl = pdf.contentUrl.replace(/\?.*$/, ""); // /documents/<groupId>/<folderId>/<file>/<uuid>
	const env = [
		`# generated by part0-base-site/build.ts --deploy — source before ./run.sh`,
		// k6 (Go resolver) may send "localhost" to the network DNS server — use the loopback IP
		`export BASE_URL=${LIFERAY_URL.replace("//localhost", "//127.0.0.1")}`,
		`export SITE_PATH=${SITE}`,
		`export HOME_PATH=${SITE}/home`,
		`export CONTENT_PAGES=${SITE}/about,${SITE}/services,${SITE}/proventeq365,${SITE}/digital-experience`,
		`export AP_PAGE=${SITE}/news`,
		`export BLOG_PATH=${SITE}/blog`,
		`export SEARCH_PATH=${SITE}/search`,
		`export SEARCH_TERMS=liferay,migration,sharepoint,copilot,governance,azure,documentum,portal`,
		`export DL_URL=${dlUrl}`,
		`export SITE_ID=${site.id}`,
		`export LOGIN_USER=${LIFERAY_USER}`,
		`export LOGIN_PASS=${LIFERAY_PASSWORD}`,
		// headless-delivery is not open to guests by default (Service Access Policy) — call it as an API client
		`export API_USER=${LIFERAY_USER}`,
		`export API_PASS=${LIFERAY_PASSWORD}`,
		// session: sign in once, reuse the cookie (Basic re-hashes the password on every call)
		`export API_AUTH=session`,
		// the custom header has no /c/portal/logout link; Liferay's ThemeDisplay JS is theme-independent
		"export SIGNED_IN_MARKER='isSignedIn: () => true'",
		"",
	].join("\n");
	writeFileSync(join(DIST, "k6.env"), env);
	console.log(`wrote ${join(DIST, "k6.env")}`);
}
