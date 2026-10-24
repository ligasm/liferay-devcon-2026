package com.example.edgepurge;

import com.liferay.portal.kernel.log.Log;
import com.liferay.portal.kernel.log.LogFactoryUtil;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Set;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.ConfigurationPolicy;

/**
 * S5 — Varnish implementation, matching matrix/varnish/default*.vcl:
 *
 *   BAN   <varnish>/   X-Cache-Tags: article-123        (default.vcl: ban; default-xkey.vcl: xkey.softpurge)
 *   PURGE <varnish>/web/guest/news                      (exact URL)
 *
 * Send it to EVERY Varnish node (list them in the config); Varnish does not
 * replicate bans. The Liferay nodes' IPs must be in the VCL `acl purge`.
 *
 * OSGi config (osgi/configs/com.example.edgepurge.VarnishEdgePurger.config):
 *   varnishUrls=["http://varnish-1:80","http://varnish-2:80"]
 *   xkey=B"true"        → send one BAN per purge with space-separated tags (xkey) …
 *                         false → one BAN per tag (default.vcl regex ban)
 */
@Component(
	configurationPid = "com.example.edgepurge.VarnishEdgePurger",
	configurationPolicy = ConfigurationPolicy.OPTIONAL,
	property = "edge=varnish",
	service = EdgePurger.class
)
public class VarnishEdgePurger implements EdgePurger {

	@Override
	public void softPurgeByTags(Set<String> tags) throws Exception {
		for (String base : _varnishUrls) {
			if (_xkey) {
				_send(base, "BAN", "/", Map.of("X-Cache-Tags", String.join(" ", tags)));
			}
			else {
				for (String tag : tags) {
					_send(base, "BAN", "/", Map.of("X-Cache-Tags", tag));
				}
			}
		}
	}

	@Override
	public void purgeUrl(String path) throws Exception {
		for (String base : _varnishUrls) {
			_send(base, "PURGE", path, Map.of());
		}
	}

	private void _send(String base, String method, String path, Map<String, String> headers) throws Exception {
		HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
			.timeout(Duration.ofSeconds(3))
			.method(method, HttpRequest.BodyPublishers.noBody());
		headers.forEach(b::header);
		HttpResponse<String> r = _client.send(b.build(), HttpResponse.BodyHandlers.ofString());
		if (r.statusCode() >= 300) {
			throw new IllegalStateException(method + " " + base + path + " → " + r.statusCode() + " " + r.body());
		}
		if (_log.isDebugEnabled()) {
			_log.debug(method + " " + base + path + " " + headers + " → " + r.statusCode());
		}
	}

	@Activate
	protected void activate(Map<String, Object> properties) {
		Object urls = properties.getOrDefault("varnishUrls", new String[] {"http://localhost:6081"});
		_varnishUrls = (urls instanceof String[]) ? (String[])urls : new String[] {String.valueOf(urls)};
		_xkey = Boolean.parseBoolean(String.valueOf(properties.getOrDefault("xkey", "true")));
	}

	private static final Log _log = LogFactoryUtil.getLog(VarnishEdgePurger.class);

	private final HttpClient _client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
	private String[] _varnishUrls;
	private boolean _xkey;
}
