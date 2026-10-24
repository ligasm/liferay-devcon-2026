# S2 — JVM caches: what is a file and what is a checkbox

| Change | Where | File here |
|---|---|---|
| Entity / finder cache sizing (Ehcache 3 schema) | classpath XML + `ehcache.multi.vm.config.location` | `liferay-multi-vm-override.xml`, `portal-ext.properties` |
| Cluster Link on, invalidation not replication, JDBC_PING | `portal-ext.properties`, JGroups XML | `portal-ext.properties`, `jgroups/jdbc_ping.xml` |
| HikariCP ≈ 2 × `maxThreads` | `portal-ext.properties` | `portal-ext.properties` |
| Tomcat `maxThreads` / `acceptCount` | `tomcat/conf/server.xml` | `server.xml.snippet` |
| G1 vs Generational ZGC | `tomcat/bin/setenv.sh` | `setenv.sh` (`GC=g1` / `GC=zgc`) |
| **Page fragment "Cacheable"** | UI: Site Builder → Fragments → fragment → Actions → *Mark as Cacheable* | — (per fragment, not a file) |
| **Web content template "Cacheable"** | UI: Web Content → Templates → template → *Cacheable* checkbox | — (per DDM template) |

The two checkboxes are the highest-leverage, lowest-effort items in this stage,
and they are deliberately not files: caching a fragment or template that renders
anything user- or segment-specific serves the first requester's output to
everyone (the `JournalContent` cache key has no user/role/segment). Cache the
chrome, not the personalised hole.

There are no OSGi `.config` files in this stage on purpose:
`FreeMarkerEngineConfiguration.resourceModificationCheck` is inert since
`portal-template-freemarker` 7.0.55 (~2024.Q3), and cache listeners can no longer
be declared in XML (LPD-43563).

## What to measure

Run the same scenarios as S1 and look at:

* `headless-api/headless_by_id` p95 (entity cache) vs `headless_list` (Elasticsearch — should not move).
* `asset-publisher/ap_page` vs `content_page` — the gap narrows a little, it does not close (that needs S4).
* JMX `org.ehcache:type=CacheStatistics` hit ratio and `com.zaxxer.hikari` `PendingThreads` during the run.
* p99 with `GC=g1` vs `GC=zgc` on the `mix` scenario.
