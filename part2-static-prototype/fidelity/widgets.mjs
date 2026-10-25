// widgets.mjs — static renderers for the widgets on the site's pages, fed by Headless
// Delivery data instead of portlet requests. Each reproduces the markup (and therefore the
// theme styling) of the widget's default display, and reads its settings from the
// widgetConfig in the page definition. The current view (list page n, tag filter, one
// item) comes from ctx.view; build.mjs renders each view as its own static page.
import { esc, portlet } from './render.mjs';

const AP = 'com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet';
const BLOGS = 'com_liferay_blogs_web_portlet_BlogsPortlet';
const SEARCH_BAR = 'com_liferay_portal_search_web_search_bar_portlet_SearchBarPortlet';
const SEARCH_RESULTS = 'com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet';
const SEARCH_OPTIONS = 'com_liferay_portal_search_web_search_options_portlet_SearchOptionsPortlet';

export const WIDGETS = { AP, BLOGS, SEARCH_BAR, SEARCH_RESULTS, SEARCH_OPTIONS };

const stripTags = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const shorten = (s, n = 200) => (s.length > n ? s.slice(0, n) + '...' : s);
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function icon(ctx, name, extra = '') {
  ctx.icons.add(name);
  return `<svg class="lexicon-icon lexicon-icon-${name}${extra}" role="presentation" ><use href="${ctx.urls.icons}#${name}" /></svg>`;
}

/** Liferay's reading time: words / 265 per minute; "A Minute Read" for 1–2 minutes. */
export function readingTime(html) {
  const words = stripTags(html).split(' ').filter(Boolean).length;
  const secs = Math.round((words / 265) * 60);
  const min = Math.floor(secs / 60);
  return { secs, label: min < 1 ? 'Less Than a Minute Read' : min === 1 ? 'A Minute Read' : `${min} Minutes Read` };
}

function pagination(ctx, total, delta, page, urlFor) {
  const pages = Math.ceil(total / delta);
  if (pages <= 1) return '';
  const from = (page - 1) * delta + 1;
  const to = Math.min(total, page * delta);
  const item = (n) => `
				<li class="page-item ${n === page ? 'active' : ''}">
					<a ${n === page ? 'aria-current="page" ' : ''}aria-label="Page ${n}" class="page-link" href="${urlFor(n)}">${n}</a>
				</li>`;
  const edge = (n, label, iconName) => (n < 1 || n > pages
    ? `<li class="page-item disabled"><div aria-disabled="true" aria-label="${label}" class="page-link" role="link" tabindex="-1">${icon(ctx, iconName)}</div></li>`
    : `<li class="page-item"><a aria-label="${label}" class="page-link" href="${urlFor(n)}">${icon(ctx, iconName)}</a></li>`);
  return `
	<div class="pagination-bar" data-qa-id="paginator">
		<p class="pagination-results">Showing ${from} to ${to} of ${total} entries.</p>
		<nav aria-label="Pagination">
			<ul class="pagination">${edge(page - 1, 'Previous Page', 'angle-left')}${Array.from({ length: pages }, (_, i) => item(i + 1)).join('')}${edge(page + 1, 'Next Page', 'angle-right')}
			</ul>
		</nav>
	</div>`;
}

const tagLabels = (tags, urlFor) => (tags?.length ? `
	<span class="taglib-asset-tags-summary">${tags.map((t) => `
		<a class="label label-lg label-secondary text-uppercase" href="${urlFor(t)}">${esc(t)}</a>`).join('')}
	</span>` : '');

function socialBookmarks(ctx, title, url) {
  const e = encodeURIComponent;
  const links = [
    ['twitter', 'Twitter', 'twitter-x', `https://twitter.com/intent/tweet?text=${e(title)}&amp;url=${e(url)}`],
    ['facebook', 'Facebook', 'social-facebook', `https://www.facebook.com/sharer.php?u=${e(url)}`],
    ['linkedin', 'LinkedIn', 'social-linkedin', `https://www.linkedin.com/shareArticle?mini=true&amp;title=${e(title)}&amp;url=${e(url)}`],
  ];
  return `
<div class="taglib-social-bookmarks">
	<ul class="list-unstyled inline">${links.map(([k, label, ic, href]) => `
		<li class="taglib-social-bookmark taglib-social-bookmark-${k}"><div><a class="btn btn-outline-borderless btn-monospaced btn-sm btn-outline-secondary lfr-portal-tooltip" href="${href}" title="${label}" aria-label="${label}" rel="noopener" target="_blank">${icon(ctx, ic)}</a></div></li>`).join('')}
	</ul>
</div>`;
}

// ---- Asset Publisher (dynamic selection of web content, "abstracts" display) ------------
// Two sort keys as in the widget's configuration; the second defaults to title ASC, which
// decides the order when items share a publish date (as a site initializer's do).
const ORDER_FIELD = { publishDate: (n) => new Date(n.datePublished).getTime(), title: (n) => n.title.toLowerCase(), modifiedDate: (n) => new Date(n.dateModified ?? n.datePublished).getTime() };
function assetOrder(cfg) {
  const keys = [[cfg.orderByColumn1 ?? 'publishDate', cfg.orderByType1 ?? 'DESC'], [cfg.orderByColumn2 ?? 'title', cfg.orderByType2 ?? 'ASC']];
  return (a, b) => {
    for (const [col, dir] of keys) {
      const f = ORDER_FIELD[col] ?? ORDER_FIELD.publishDate;
      const x = f(a);
      const y = f(b);
      if (x !== y) return (x < y ? -1 : 1) * (dir === 'DESC' ? -1 : 1);
    }
    return 0;
  };
}
function assetPublisher(widget, ctx) {
  const cfg = widget.widgetConfig ?? {};
  const meta = String(cfg.metadataFields ?? '').split(',');
  const showDate = meta.includes('publish-date');
  const showTags = meta.includes('tags');
  const view = ctx.view ?? {};
  const dateLine = (item) => (showDate ? `
			<div class="autofit-row mb-4 metadata-author">
				<div class="autofit-col autofit-col-expand">
					<div class="asset-user-info text-secondary">
						<span class="date-info">Published ${shortDate.format(new Date(item.datePublished))}</span>
					</div>
				</div>
			</div>` : '');
  const tags = (item) => (showTags && item.keywords?.length ? `
			<div class="asset-tags mb-3">${tagLabels(item.keywords, ctx.urls.newsTag)}
			</div>` : '');

  if (view.newsItem) {
    const item = view.newsItem;
    return portlet(`${AP}_INSTANCE_static`, 'portlet-asset-publisher', `
<div class="asset-full-content clearfix mb-5  show-asset-title ">
		<div class="align-items-center d-flex mb-2">
			<p class="component-title h4">
					<a class="header-back-to lfr-portal-tooltip" rel="nofollow" href="${ctx.urls.page(ctx.pagePath)}" title="Back" aria-label="Back" >${icon(ctx, 'angle-left')}</a>
					<span class="asset-title d-inline">${esc(item.title)}</span>
			</p>
		</div>${dateLine(item)}
	<div class="asset-content mb-3">
		<div class="journal-content-article ">
			<dl>${item.fields.map((f) => `<dt class="text-capitalize">${esc(f.label)}</dt><dd>${f.html}</dd>`).join('')}</dl>
		</div>
	</div>${tags(item)}
</div>`);
  }

  const delta = Number(cfg.delta ?? 20);
  const all = ctx.data.news.filter((n) => !view.tag || n.keywords?.includes(view.tag)).sort(assetOrder(cfg));
  const page = view.page ?? 1;
  const items = all.slice((page - 1) * delta, page * delta);
  const body = items.map((item) => `
		<div class="asset-abstract mb-5  " >
			<div class="align-items-center d-flex mb-2">
				<p class="component-title h4">
					<a class="asset-title d-inline" href="${ctx.urls.newsItem(item)}">${esc(item.title)}</a>
				</p>
			</div>${dateLine(item)}
			<div class="asset-content mb-3">
<div class="asset-summary">
			${esc(item.fields[0]?.label ?? '')}
	${esc(item.description || shorten(stripTags(item.fields[0]?.html)))}
</div>
			</div>${tags(item)}
		</div>`).join('');
  const heading = view.tag ? `\n\t\t<p class="h5 text-secondary mb-4">Tagged <strong>${esc(view.tag)}</strong> · <a href="${ctx.urls.page(ctx.pagePath)}">all news</a></p>` : '';
  return portlet(`${AP}_INSTANCE_static`, 'portlet-asset-publisher',
    heading + body + pagination(ctx, all.length, delta, page, (n) => ctx.urls.listPage(ctx.pagePath, n, view.tag)));
}

// ---- Blogs (abstract display, entry detail) --------------------------------------------
function blogMetadata(ctx, post, large = '') {
  const rt = readingTime(post.articleBody);
  return `
			<div class="autofit-row widget-metadata">
				<div class="autofit-col inline-item-before">
					<span class="sticker sticker-circle sticker-light${large} user-icon-color-2"><span class="inline-item">${icon(ctx, 'user')}</span></span>
				</div>
				<div class="autofit-col autofit-col-expand">
					<div class="autofit-row">
						<div class="autofit-col autofit-col-expand">
							<div class="text-truncate-inline">
								<span class="text-truncate username">${esc(post.creator?.name ?? '')}</span>
							</div>
							<div class="text-secondary">
								<span class="hide-accessible sr-only">Published Date</span>${longDate.format(new Date(post.datePublished))}
									- <time class="reading-time" datetime="${rt.secs}s">${rt.label}</time>
							</div>
						</div>
					</div>
				</div>
			</div>`;
}

// "More Blog Entries": the older and the newer neighbour of the entry, as cards
function entryNavigation(ctx, post) {
  const i = ctx.data.posts.indexOf(post);
  const near = [ctx.data.posts[i + 1], ctx.data.posts[i - 1]].filter(Boolean);
  if (!near.length) return '';
  return `
<div class="container-fluid container-fluid-max-xl">
		<div class="row">
			<div class="col-md-10 entry-navigation mx-md-auto">
				<h2>
					<strong>More Blog Entries</strong>
				</h2>
				<div class="card-page widget-mode-card">${near.map((p) => {
    const rt = readingTime(p.articleBody);
    return `
	<div class="card-page-item">
		<div class="card">
			<div class="card-header">
				<div class="aspect-ratio aspect-ratio-8-to-3">
					<img alt="thumbnail" class="aspect-ratio-item-center-middle aspect-ratio-item-fluid" src="/o/blogs-web/images/cover_image_placeholder.jpg" />
				</div>
			</div>
			<div class="card-body widget-topbar">
				<div class="card-title">
					<div class="autofit-col autofit-col-expand">
						<h3 class="title"><a class="title-link" href="${ctx.urls.blogPost(p)}">
							${esc(p.headline)}</a>
						</h3>
					</div>
				</div>
				<div class="autofit-row autofit-padded-no-gutters widget-metadata">
					<div class="autofit-col">
						<span class="sticker sticker-circle sticker-light user-icon-color-2"><span class="inline-item">${icon(ctx, 'user')}</span></span>
					</div>
					<div class="autofit-col autofit-col-expand">
						<div class="autofit-section">
							<div class="text-truncate-inline">
								<span class="text-truncate username">${esc(p.creator?.name ?? '')}</span>
							</div>
							<div class="text-secondary">
								${dayMonth.format(new Date(p.datePublished))}
									- <time class="reading-time" datetime="${rt.secs}s">${rt.label}</time>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="card-footer">
<div class="autofit-row autofit-float-end autofit-row-center widget-toolbar">
	<div class="autofit-col autofit-col-end">${socialBookmarks(ctx, p.headline, ctx.urls.absolute(ctx.urls.blogPost(p)))}
	</div>
</div>
			</div>
		</div>
	</div>`;
  }).join('')}
				</div>
			</div>
		</div>
	<div class="row">
		<div class="col-md-8 offset-md-2">
		</div>
	</div>
</div>`;
}

function blogs(widget, ctx) {
  const cfg = widget.widgetConfig ?? {};
  const view = ctx.view ?? {};
  if (view.post) {
    const post = view.post;
    const url = ctx.urls.absolute(ctx.urls.blogPost(post));
    return portlet(BLOGS, 'portlet-blogs', `
	<div class="widget-mode-detail">
		<div class="container-fluid container-fluid-max-xl widget-mode-detail-header">
			<div class="row">
				<div class="col-md-8 mx-auto">
					<div class="autofit-row">
						<div class="autofit-col autofit-col-expand">
							<p class="h3 title">${esc(post.headline)}</p>${post.alternativeHeadline ? `
								<h3 class="h4 sub-title">${esc(post.alternativeHeadline)}</h3>` : ''}
						</div>
					</div>${blogMetadata(ctx, post, ' sticker-lg')}
				</div>
			</div>
		</div>
		<div class="container-fluid container-fluid-max-xl widget-mode-detail-header">
			<div class="row">
				<div class="col-md-8 mx-auto widget-mode-detail-text">
					${post.articleBody}
				</div>
			</div>${post.keywords?.length ? `
				<div class="row">
					<div class="col-md-8 mx-auto widget-mode-detail-text">
						<div class="entry-tags">${tagLabels(post.keywords, ctx.urls.blogTag)}
						</div>
					</div>
				</div>` : ''}
		</div>
		<div class="container-fluid container-fluid-max-xl">
			<div class="row">
				<div class="col-md-8 mx-auto widget-mode-detail-text">
<div class="autofit-row autofit-float-end autofit-row-center widget-toolbar">
	<div class="autofit-col autofit-col-end">${socialBookmarks(ctx, post.headline, url)}
	</div>
</div>
				</div>
			</div>
				<div class="row">
					<div class="col-md-8 mx-auto widget-mode-detail-text">
						<div class="entry-links">
						</div>
					</div>
				</div>
		</div>
	</div>${entryNavigation(ctx, post)}`, { header: `
					<div class="autofit-col">
						<div class="autofit-section">
							<a class="icon-monospaced portlet-icon-back text-default" href="${ctx.urls.page(ctx.pagePath)}" title="Return to Full Page"><span class=""><span class="c-inner" tabindex="-1">${icon(ctx, 'angle-left')}</span></span></a>
						</div>
					</div>` });
  }
  const delta = Number(cfg.pageDelta ?? 20);
  const all = ctx.data.posts.filter((p) => !view.tag || p.keywords?.includes(view.tag));
  const page = view.page ?? 1;
  const items = all.slice((page - 1) * delta, page * delta);
  const heading = view.tag ? `\n\t<p class="h5 text-secondary mb-4">Tagged <strong>${esc(view.tag)}</strong> · <a href="${ctx.urls.page(ctx.pagePath)}">all posts</a></p>` : '';
  return portlet(BLOGS, 'portlet-blogs', `${heading}
	<div class="widget-mode-simple">${items.map((post) => `
		<div class="widget-mode-simple-entry">
			<div class="autofit-row widget-topbar">
				<div class="autofit-col autofit-col-expand">
					<h3 class="title">
						<a href="${ctx.urls.blogPost(post)}" class="title-link" >${esc(post.headline)}</a>
					</h3>
				</div>
			</div>${blogMetadata(ctx, post)}
			<div class="widget-content">
						<p>
							${esc(post.description || shorten(stripTags(post.articleBody), 400))}
						</p>
<div class="autofit-row autofit-float-end autofit-row-center widget-toolbar">
	<div class="autofit-col autofit-col-end">${socialBookmarks(ctx, post.headline, ctx.urls.absolute(ctx.urls.blogPost(post)))}
	</div>
</div>
			</div>
		</div>`).join('')}
	</div>${pagination(ctx, all.length, delta, page, (n) => ctx.urls.listPage(ctx.pagePath, n, view.tag))}`, { header: true });
}

// ---- Search: the bar posts ?q= to the page; results are computed in the browser from
// search-index.json, which build.mjs writes from the same headless data ----------------
function searchBar(widget, ctx) {
  return portlet(`${SEARCH_BAR}_INSTANCE_static`, 'portlet-search-bar', `
		<form action="${ctx.urls.page('/search')}" method="get" role="search">
						<div class="search-bar">
							<div class="input-group search-bar-simple">
										<div class="input-group-item search-bar-keywords-input-wrapper">
											<input aria-label="Search" autocomplete="off" class="form-control input-group-inset input-group-inset-after search-bar-keywords-input" id="static-search-q" name="q" placeholder="Search..." title="Search" type="text" value="" />
											<div class="input-group-inset-item input-group-inset-item-after">
												<button class="btn btn-monospaced btn-unstyled search-bar-submit-button" type="submit" aria-label="Search" ><span class="inline-item">${icon(ctx, 'search')}</span></button>
											</div>
										</div>
							</div>
						</div>
		</form>`);
}

function searchResults(widget, ctx) {
  const delta = Number(widget.widgetConfig?.paginationDelta ?? 10);
  ctx.scripts.push(SEARCH_JS.replaceAll('__INDEX__', ctx.urls.searchIndex).replaceAll('__DELTA__', delta)
    .replaceAll('__PREV__', JSON.stringify(icon(ctx, 'angle-left'))).replaceAll('__NEXT__', JSON.stringify(icon(ctx, 'angle-right'))));
  return portlet(`${SEARCH_RESULTS}_INSTANCE_static`, 'portlet-search-results', `
	<div class="c-mb-4 c-mt-4 search-total-label" id="static-search-total"></div>
	<div class="display-compact">
		<ul class="list-unstyled" id="static-search-results"></ul>
	</div>
	<div id="static-search-pages"></div>`);
}

const SEARCH_JS = `(function() {
var q = new URLSearchParams(location.search).get('q') || '';
var input = document.getElementById('static-search-q');
if (input) input.value = q;
// a light English stem (governance → govern, migrating → migrat) so that, like Liferay's
// analyzer, a word also finds its other forms
var stem = function(t) { var s = t.replace(/(ations?|ances?|ences?|ments?|ings?|ed|es|s)$/, ''); return s.length >= 4 ? s : t; };
var terms = q.toLowerCase().split(/\\s+/).filter(Boolean).map(stem);
if (!terms.length) return;
var escapeHtml = function(s) { return s.replace(/[&<>"]/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
var mark = function(s) {
	var out = escapeHtml(s);
	terms.forEach(function(t) {
		out = out.replace(new RegExp('(\\\\w*' + t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\w*)', 'gi'), '<span class="highlight mark">$1</span>');
	});
	return out;
};
fetch('__INDEX__').then(function(r) { return r.json(); }).then(function(docs) {
	var hits = docs.map(function(d) {
		var title = d.t.toLowerCase(), text = d.x.toLowerCase(), score = 0;
		terms.forEach(function(t) {
			score += (title.split(t).length - 1) * 5 + (text.split(t).length - 1);
		});
		return { d: d, score: score };
	}).filter(function(h) { return h.score > 0; }).sort(function(a, b) { return b.score - a.score; });
	// pages of __DELTA__ results, ?page=n, with the same pagination bar as the portal's
	var delta = __DELTA__, pages = Math.ceil(hits.length / delta);
	var page = Math.min(Math.max(1, parseInt(new URLSearchParams(location.search).get('page'), 10) || 1), Math.max(1, pages));
	var pageUrl = function(n) { return '?q=' + encodeURIComponent(q) + (n > 1 ? '&page=' + n : ''); };
	document.getElementById('static-search-total').innerHTML = hits.length + ' Result' + (hits.length === 1 ? '' : 's') + ' for <strong>' + escapeHtml(q) + '</strong>';
	document.getElementById('static-search-results').innerHTML = hits.slice((page - 1) * delta, page * delta).map(function(h) {
		return '<li class="align-items-center d-flex"><div class="c-mb-2 c-mt-2"><a class="link-primary single-link" href="' + h.d.u + '">' + mark(h.d.t) + '</a></div></li>';
	}).join('');
	if (pages > 1) {
		var edge = function(n, label, svg) {
			return n < 1 || n > pages
				? '<li class="page-item disabled"><div aria-disabled="true" aria-label="' + label + '" class="page-link" role="link" tabindex="-1">' + svg + '</div></li>'
				: '<li class="page-item"><a aria-label="' + label + '" class="page-link" href="' + pageUrl(n) + '">' + svg + '</a></li>';
		};
		var items = '';
		for (var n = 1; n <= pages; n++) {
			items += '<li class="page-item ' + (n === page ? 'active' : '') + '"><a ' + (n === page ? 'aria-current="page" ' : '') + 'aria-label="Page ' + n + '" class="page-link" href="' + pageUrl(n) + '">' + n + '</a></li>';
		}
		document.getElementById('static-search-pages').innerHTML = '<div class="pagination-bar" data-qa-id="paginator"><p class="pagination-results">Showing ' + ((page - 1) * delta + 1) + ' to ' + Math.min(hits.length, page * delta) + ' of ' + hits.length + ' entries.</p><nav aria-label="Pagination"><ul class="pagination">' + edge(page - 1, 'Previous Page', __PREV__) + items + edge(page + 1, 'Next Page', __NEXT__) + '</ul></nav></div>';
	}
});
})();`;

export const widgetRenderers = {
  [AP]: assetPublisher,
  [BLOGS]: blogs,
  [SEARCH_BAR]: searchBar,
  [SEARCH_RESULTS]: searchResults,
  [SEARCH_OPTIONS]: () => '', // renders nothing in view mode on Liferay either
};
