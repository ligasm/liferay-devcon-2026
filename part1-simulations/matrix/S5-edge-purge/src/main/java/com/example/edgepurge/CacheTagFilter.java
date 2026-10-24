package com.example.edgepurge;

import com.liferay.portal.kernel.model.Layout;
import com.liferay.portal.kernel.theme.ThemeDisplay;
import com.liferay.portal.kernel.util.WebKeys;

import java.io.IOException;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.osgi.service.component.annotations.Component;

/**
 * S5 — put the surrogate keys on the page response so the edge can purge by tag.
 *
 * Emits (for a rendered layout):
 *   Cache-Tag:     site-<groupId>,layout-<plid>            (Cloudflare spelling)
 *   Surrogate-Key: site-<groupId> layout-<plid>            (Fastly / xkey spelling)
 * The Varnish VCL accepts either. Adding article-/blog- tags for the content
 * actually rendered on the page requires hooking the render (e.g. a
 * DynamicInclude / a JournalContent wrapper that appends to a request
 * attribute) — left as the obvious next step. Without it, purge on article
 * publish falls back to the site-<groupId> key (whole site, still correct).
 *
 * SKETCH: ThemeDisplay is only available after MainServlet has run; register
 * this as a portal servlet filter (`servlet-filter` in liferay-web.xml, or an
 * OSGi HTTP whiteboard filter with osgi.http.whiteboard.filter.regex=/web/.*)
 * and wrap the response so headers are added before the body is committed.
 * DXP 2025.Q3+ is Jakarta EE: change javax.servlet.* to jakarta.servlet.*.
 */
@Component(
	property = {
		"osgi.http.whiteboard.context.select=(osgi.http.whiteboard.context.name=default)",
		"osgi.http.whiteboard.filter.regex=/(web|group)/.*",
		"service.ranking:Integer=1000"
	},
	service = Filter.class
)
public class CacheTagFilter implements Filter {

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
		throws IOException, ServletException {

		HttpServletRequest req = (HttpServletRequest)request;
		HttpServletResponse res = (HttpServletResponse)response;

		chain.doFilter(request, response);

		ThemeDisplay themeDisplay = (ThemeDisplay)req.getAttribute(WebKeys.THEME_DISPLAY);
		if ((themeDisplay == null) || res.isCommitted() || themeDisplay.isSignedIn()) {
			return; // no tags on signed-in responses: they are never cached
		}
		Layout layout = themeDisplay.getLayout();
		String site = "site-" + themeDisplay.getScopeGroupId();
		String page = (layout == null) ? "" : "layout-" + layout.getPlid();

		res.setHeader("Cache-Tag", page.isEmpty() ? site : site + "," + page);
		res.setHeader("Surrogate-Key", page.isEmpty() ? site : site + " " + page);
	}
}
