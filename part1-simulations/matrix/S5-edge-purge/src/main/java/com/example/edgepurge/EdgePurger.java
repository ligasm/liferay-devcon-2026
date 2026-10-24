package com.example.edgepurge;

import java.util.Set;

/** Abstraction over "the edge": Varnish (self-hosted) or a CDN API. */
public interface EdgePurger {

	/**
	 * Mark every cached object carrying any of these tags as stale. A SOFT purge
	 * keeps serving the stale copy while the edge refetches in the background
	 * (Varnish xkey.softpurge, Fastly soft purge); Cloudflare tag purge is hard.
	 */
	void softPurgeByTags(Set<String> tags) throws Exception;

	/** Exact-URL purge fallback (Varnish PURGE, Cloudflare purge files). */
	void purgeUrl(String url) throws Exception;
}
