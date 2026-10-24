package com.example.edgepurge;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.ConfigurationPolicy;

/**
 * S5 — Cloudflare implementation.
 *   POST https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache  {"tags":[...]}   (Enterprise)
 *   POST …/purge_cache  {"files":["https://host/path"]}                                  (all plans)
 * Tag purge needs the origin to send  Cache-Tag: article-123,site-20117  (CacheTagFilter).
 * Cloudflare purges are hard (no stale-while-refetch); Fastly's API is the same
 * shape with  POST /service/{id}/purge/{key}  + header Fastly-Soft-Purge: 1.
 *
 * osgi/configs/com.example.edgepurge.CloudflareEdgePurger.config:
 *   zoneId="…"   apiToken="…"   (token scope: Zone → Cache Purge → Purge)
 */
@Component(
	configurationPid = "com.example.edgepurge.CloudflareEdgePurger",
	configurationPolicy = ConfigurationPolicy.REQUIRE,
	property = "edge=cloudflare",
	service = EdgePurger.class
)
public class CloudflareEdgePurger implements EdgePurger {

	@Override
	public void softPurgeByTags(Set<String> tags) throws Exception {
		String json = tags.stream().map(t -> "\"" + t + "\"").collect(Collectors.joining(",", "{\"tags\":[", "]}"));
		_post(json);
	}

	@Override
	public void purgeUrl(String url) throws Exception {
		_post("{\"files\":[\"" + url + "\"]}");
	}

	private void _post(String json) throws Exception {
		HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.cloudflare.com/client/v4/zones/" + _zoneId + "/purge_cache"))
			.timeout(Duration.ofSeconds(5))
			.header("Authorization", "Bearer " + _apiToken)
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(json))
			.build();
		HttpResponse<String> r = _client.send(req, HttpResponse.BodyHandlers.ofString());
		if (r.statusCode() >= 300) {
			throw new IllegalStateException("Cloudflare purge → " + r.statusCode() + " " + r.body());
		}
	}

	@Activate
	protected void activate(Map<String, Object> properties) {
		_zoneId = String.valueOf(properties.get("zoneId"));
		_apiToken = String.valueOf(properties.get("apiToken"));
	}

	private final HttpClient _client = HttpClient.newHttpClient();
	private String _zoneId;
	private String _apiToken;
}
