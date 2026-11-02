# Slide 3 verification: "The advice graveyard"

Checked 2026-11-01 against `deck/project/slides/graveyard.html` and its speaker notes.

Labels used below:

- **[TESTED]** I ran it and recorded the output.
- **[SOURCE]** Read from a pinned tag, commit or binary.
- **[DOC]** Quoted from a published document.
- **[INFERRED]** My reading, not stated by a source.
- **[UNVERIFIED]** I could not confirm it.
- **[WILD]** A web post or public config file. Evidence of what people recommend or do, never of how the product behaves.

Primary sources (source code, tags, binaries, JEPs, official docs, tickets) decide product behaviour. All URLs relied on are listed in section 8.

## 1. Summary

Four things must change before going on stage:

1. The CacheFilter year is wrong (2024, not 2023).
2. CMS was removed in JDK 14, not 15.
3. Liferay's current checklist no longer contains the CMS flag.
4. "Silently" can be challenged, because Liferay's docs carry one table row about the removal.

One more thing to know, though the slide can stay as it is: the GZip default was flipped to close the **BREACH** security issue, not primarily for performance. Expect that question if you say "compress at the edge" (see 2.2).

| Claim as written | Verdict | Reason |
|---|---|---|
| Header: "Still on every checklist" | **NEEDS CORRECTION** | Only the CMS flag is a direct checklist entry, and only in the 2023 editions. The current Go Live Checklist names none of the five. |
| "half of what the internet tells you ... is dead" | **NEEDS CORRECTION** | Nobody measured it, and the source can't prove a proportion. It can prove each of the five items. |
| `minifier.enabled`: Deprecated | **CONFIRMED** | The property comment says so at `2026.q3.0`. It still works, for CSS only. |
| "defaults to false" | **CONFIRMED** | Since 7.4 GA1. It was `true` through 7.3.7-ga8. |
| "minification moved to build time" | **CONFIRMED** | Stated in the LPS-123550 breaking-change entry. |
| `GZipFilter`: Off by default | **CONFIRMED** | `false` since April 2018, first in 7.1 GA1, for BREACH (LPE-16413). Not a recent change. |
| "StripFilter ... off by default" | **CONFIRMED** | `false` since May 2019 (LPS-95552), first in 7.2 GA1. |
| "compress at the edge" | **CONFIRMED** | Liferay's own guidance, though the clearest statements are in a 2023 PDF and a legacy KB article. |
| `layout.parallel.render`: Removed | **CONFIRMED**, tweak | Removed, with a breaking-change entry. It is a property prefix, so write `.*`. |
| "removed in 7.3, LPS-110359" | **CONFIRMED** | March 2020; first tag without it is 7.3.1-ga2. The feature had been hard-disabled since 2015. |
| `-XX:+UseConcMarkSweepGC`: Won't boot | **CONFIRMED** on HotSpot | Tested on JDK 15, 16, 17, 21, 27 and on real DXP 2026.Q3.1. It does boot on OpenJ9, and on HotSpot 14. |
| "CMS ... removed in JDK 15" | **NEEDS CORRECTION** | JEP 363 removed it in **JDK 14**. The flag became fatal in 15. |
| "the JDK 17 or 21 that DXP 2024.Q3 and later require" | **CONFIRMED** | Stated in the JVM Configuration page and matrices. JDK 17 is marked DEPRECATED from the 2025.Q2 matrix through 2026.Q3. |
| "still in Liferay's own Deployment Checklist PDF" | **NEEDS CORRECTION** | The 7.4 checklist URL now serves the *Go Live Checklist 2026.Q1*, which recommends G1. CMS survives in the 7.3 PDF and in the Java 8 section of *Tuning Your JVM*. |
| CacheFilter "deleted at 7.4.3.123" | **CONFIRMED** | 200 at ga122, 404 at ga123, and the commit is an ancestor of ga123 only. |
| "on 28 June 2023" | **NEEDS CORRECTION** | **27 June 2024.** The year is wrong. |
| "the only built-in guest full-page cache" | **CONFIRMED**, inferred | No other full-page cache in the portal filter chain. It only ever applied to widget pages, never content pages. |
| "no breaking-change entry" | **CONFIRMED** | Absent from `readme/BREAKING_CHANGES*` and every Learn breaking-changes page. |
| "Deleted, silently" | **NEEDS CORRECTION** | The 2024.Q1 Default Setting page lists it as "Removed property". "Quietly" holds up; "silently" doesn't. |

## 2. Item by item

### 2.1 `minifier.enabled`: Deprecated

**Evidence**

- [SOURCE] Current comment, [`2026.q3.0` portal.properties L8433-8442](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/portal.properties#L8433-L8442): "This property is deprecated and will be removed in a future release", followed by `minifier.enabled=false`.
- [SOURCE] Default by version:
  - `true` at [7.3.7-ga8 L7848](https://github.com/liferay/liferay-portal/blob/7.3.7-ga8/portal-impl/src/portal.properties#L7848).
  - `false` at [7.4.0-ga1 L7872](https://github.com/liferay/liferay-portal/blob/7.4.0-ga1/portal-impl/src/portal.properties#L7872).
  - DXP 7.3.10-ga1 source also has `true`.
- [DOC] Liferay documents the flip: the [7.4 Default Setting and Feature Flag Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-4-deprecations-and-breaking-changes/default-setting-and-feature-flag-changes-in-7-4) page lists `minifier.enabled | true | false` under "property changes from 7.3 to 7.4".
- [SOURCE] Default flipped in [`4ad0773`](https://github.com/liferay/liferay-portal/commit/4ad0773ed68c15953fbfd8f6e82192efe2e35bd6), deprecation notice added in [`f461631`](https://github.com/liferay/liferay-portal/commit/f461631424502506c0f9215147febb0e9091730f). Both merged 2020-12-09 under LPS-123550. The ticket's fix version is "7.4.13 DXP GA1".

**Why it changed**

[SOURCE] [`readme/BREAKING_CHANGES.md` L249 at `2026.q3.0`](https://github.com/liferay/liferay-portal/blob/2026.q3.0/readme/BREAKING_CHANGES.md#L249): "Moving frontend resource minification from run time to build time reduces server load and facilitates using the latest minification technologies available within the frontend ecosystem."

That entry and the LPD-45984 commit both spell the key `minifier.enable`. The real key is `minifier.enabled`, so don't copy the misspelling.

**Replacement**

Build-time minification. [DOC] [2025.Q2 Breaking Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes/2025-q2-breaking-changes), LPD-45984: "Run any necessary minification of JavaScript files at build time instead of runtime."

**Current state**

- Not removed: it is in the `2026.q3.0` source and in the released 2026.Q3.1 and 2026.Q1.14 LTS WARs, `false` in all of them.
- [SOURCE] It now does less than the old advice assumes. [`51d685f`](https://github.com/liferay/liferay-portal/commit/51d685f8aa904c132c95a581ea2319ac58d38ffe) (Jan 2025) deleted `MinifierUtil.minifyJavaScript`, so on current releases `true` can only minify CSS. The class is `@deprecated As of Cavanaugh (7.4.x), with no direct replacement` ([L32](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/com/liferay/portal/minifier/MinifierUtil.java#L32)).
- The dossier's "you are paying runtime CPU for nothing" is too strong. With `true`, CSS still passes through the compressor.

**Still recommended?**

Mostly the opposite of what the graveyard implies. What I found tells you to set it to `false`, which has been a no-op since 7.4:

- [Liferay frontend guidelines](https://github.com/liferay/liferay-frontend-projects/blob/master/guidelines/dxp/environment.md), "Turning off minification" (developer settings).
- [Legacy KB, Too Many CPU Intensive Tasks](https://learn.liferay.com/kb-article/too-many-cpu-intensive-tasks-a-common-performance-issue-in-dxp-7.0): "Minifier is enabled by default". True only for 7.3 and earlier, but still published on Learn.

More from the web pass [WILD]:

- [Liferay blog, Aug 2010](https://liferay.dev/blogs/-/blogs/turn-off-minifiers-and-html-stripping) gives `js_fast_load=0&css_fast_load=0&strip=0` as a URL trick for debugging. People are still commenting on it because it ranks highly for "liferay disable javascript minifier".
- GitHub code search, `portal-ext.properties` files: `minifier.enabled=false` in 16, `=true` in 1 ([`limaagabriel/liferay-developer-utilities`](https://github.com/limaagabriel/liferay-developer-utilities/blob/main/assets/portal-ext.properties), a developer utility repo, pushed 2026-10-13).

I found no guide telling you to set it to `true` for performance, and it is not in the 7.1, 7.3 or 7.4 PDFs or the Go Live Checklist (case-insensitive search for `minif`: 0 hits).

**Live command**

```bash
curl -s https://raw.githubusercontent.com/liferay/liferay-portal/2026.q3.0/portal-impl/src/portal.properties | sed -n 8433,8442p
```

### 2.2 `GZipFilter` and `StripFilter`: Off by default

**Evidence** [SOURCE]

| Tag | GZipFilter | StripFilter |
|---|---|---|
| 6.2.5-ga6 | true (L8752) | true (L8848) |
| 7.0.0-ga1 | true (L7626) | true (L7723) |
| 7.0.6-ga7 | false (L7898, backported) | true (L7982) |
| 7.1.0-ga1 | false (L7496) | true (L7580) |
| 7.2.0-ga1 | false (L9222) | false (L9340) |
| 2026.q3.0 | [false (L10072)](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/portal.properties#L10072) | [false (L10152)](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/portal.properties#L10152) |

Released WARs agree: every DXP WAR I probed from 2024.Q1.1 through 2026.Q3.1 has both `false`.

- GZip commit: [`1e68624`](https://github.com/liferay/liferay-portal/commit/1e6862493e8da3b422c6d930c8f3dea866519f1f), "LPS-79404 Disable compression by default", merged 2018-04-10.
- Strip commit: [`ee530e0`](https://github.com/liferay/liferay-portal/commit/ee530e0d1daa6a9d4369fde40a557a8cec0d10cd), merged 2019-05-14.

**Why it changed**

- Strip [SOURCE], in the commit message: "The CPU and memory cost for using it is too much for many customers compared to the network savings."
- GZip: **primarily security.** The commit gives no reason and LPS-79404 isn't publicly readable (Jira API returned 404), but:
  - [SOURCE] [LPE-16413 "BREACH attack vulnerability"](https://liferay.atlassian.net/browse/LPE-16413), created 2018-04-11, fix versions 6.2.X EE and 7.0.X EE: "Liferay DXP may be vulnerable to BREACH attacks if Liferay DXP is using HTTPS and compression (GZip) is enabled."
  - [DOC] [Legacy KB, GZIP filter disabled by default](https://learn.liferay.com/kb-article/gzip-filter-disabled-by-default): "This functionality has been disabled due to the potential security risk over HTTPS." It quotes the 7.0 Fix Pack 46 notes: "Updates GZip filter compression to be disabled by default. This will prevent BREACH attack vulnerability when using GZip filter."
  - [INFERRED] LPS-79404 is the master-branch side of that fix. The dates match (merged 2018-04-10, ticket opened 2018-04-11), but no source links them explicitly.
  - [DOC] CPU is a second stated reason. Liferay's [frontend guidelines](https://github.com/liferay/liferay-frontend-projects/blob/master/guidelines/dxp/environment.md) L92: "This one is off by default because of its CPU utilization".

**Replacement**

Compress in front of Liferay. There is no in-product replacement, and the filter itself still works if you enable it.

- [DOC] 2023 Deployment Checklist, reference architecture: "Web Tier: Provides caching, compression, and other capabilities using Apache, Nginx, Varnish, etc."
- [DOC] Same PDF, printed p.21 footnote: "In place of the GZIP and Strip filters, we recommend using the PageSpeed Apache Module".
- [DOC] Legacy KB: "our recommendation is turning the GZipFilter off and relying on other services if possible". The KB carries a banner saying it is not official documentation.
- [DOC] [Legacy KB on gzip for specific endpoints](https://learn.liferay.com/kb-article/is-there-an-out-of-the-box-way-to-set-up-gzip-compression-for-only-specific-endpoints-): "We recommend setting up gzip compression for optimal performance on the web server, not in Liferay." It adds that enabling it means "Liferay will compress everything, including API communication". Don't repeat its "compiled ... interpreted" explanation: the sibling KB's stack trace shows `java.util.zip.Deflater.deflateBytes(Native Method)`.
- [DOC] The current Go Live Checklist only says to review the filters, "Many of these are disabled by default" (PDF p.17). It doesn't explicitly say to compress at the edge.

**Current state**

Still shipped; two GZip filter declarations remain in `liferay-web.xml` (2026.Q3.1 WAR). Not deprecated, and nothing reintroduced. But it no longer covers what it used to:

- [SOURCE] [LPD-109033](https://liferay.atlassian.net/browse/LPD-109033), opened 2026-10-07, status In Progress: with `GZipFilter=true`, "the HTML document is compressed, but `clay_admin.css` is not."
- [SOURCE] [PR #5774](https://github.com/liferay-frontend/liferay-portal/pull/5774) explains why: `FrontendResourceFilter` (LPD-52709, June 2025) sits ahead of GZip Filter and writes `/o/` resources straight to the response. No LPD-109033 commit was on `liferay/liferay-portal` when I searched. I did not reproduce this myself.

So on current releases, turning the filter on may compress your HTML but not your CSS and JS. That strengthens "compress at the edge".

**Watch out for this one**

This row differs from the others. Most advice I found says to turn GZipFilter **off** and use the web server, which is still correct and is the talk's own message. It is only stale because it is already the default. Examples:

- [Surekha Tech, 13 Mar 2016](https://www.surekhatech.com/blog/liferay-performance-tuning-with-apache-web-server)
- [oxybits, 5 Jun 2012](http://oxybits.blogspot.com/2012/06/liferay-how-to-increase-liferay.html)
- [IGNEK](https://www.ignek.com/blog/performance-tuning-with-liferay), with 2025 timestamps in the page metadata

Turning it on is the minority. Examples [WILD]:

- Liferay's guideline for *testing* GZIP behaviour, using `gzip.compression.level=1`.
- [`Deltares/oss` `configs/prod/portal-ext.properties` L58](https://github.com/Deltares/oss/blob/Liferay7.4/configs/prod/portal-ext.properties#L58), a production config on a `Liferay7.4` branch in a repo pushed 2026-10-29, sets `GZipFilter=true`.
- Liferay's own [osb-faro Docker `portal-ext.properties`](https://github.com/liferay/liferay-portal/blob/master/workspaces/liferay-osbfaro-workspace/modules/osb-faro-docker/portal-ext.properties) L63 also sets it to `true`, with `StripFilter=false` at L65.
- GitHub code search, `portal-ext.properties` files: `GZipFilter=false` in 12, `=true` in 5.
- [`GovDataOfficial/GovDataPortal`](https://github.com/GovDataOfficial/GovDataPortal/blob/master/packaging/src/main/resources/portal-ext.properties), pushed 2024-09, sets GZip and Strip to `false`, which is now redundant.
- [AIXTOR on LinkedIn, Nov 2023](https://www.linkedin.com/pulse/what-different-elements-liferay-performance-tuning-aixtor-phxzf), a Liferay partner, still describes filters that "gzip the content, and strip empty or unwanted spaces".

So say "off by default", not "everyone tells you to enable it".

**Expect this question: "Doesn't BREACH follow you to the edge?"** [INFERRED] Yes, in principle. [BREACH](https://www.breachattack.com/) needs HTTP-level compression plus a response body reflecting both user input and a secret such as a CSRF token. Where the compression runs doesn't change those conditions. Liferay's KB offers mod_deflate as an alternative without addressing this. The honest answer: guest HTML carrying no secret isn't exposed, which fits this talk's scope, while logged-in HTML needs its own decision.

**Live command**

```bash
curl -s https://raw.githubusercontent.com/liferay/liferay-portal/2026.q3.0/portal-impl/src/portal.properties | grep -nE '^\s*com\.liferay\.portal\.servlet\.filters\.(gzip|strip)\.'
```

### 2.3 `layout.parallel.render`: Removed

**Evidence**

- [SOURCE] LPS-110359 "Remove parallel rendering", commits dated 2020-03-16. Example: [`25d2435`](https://github.com/liferay/liferay-portal/commit/25d24354665b5579d40da360e2653087946c7f52), by Leon Chi, merged 2020-03-19.
- [SOURCE] First CE tag without the properties is 7.3.1-ga2 (commit 2020-03-27). **7.3.0-ga1 still has them.** DXP 7.3.10-ga1 source has none. So "removed in 7.3" is right, but a pedant could cite 7.3.0-ga1.
- [SOURCE] The breaking-change entry exists: [`readme/BREAKING_CHANGES.markdown` L501 at 7.3.7-ga8](https://github.com/liferay/liferay-portal/blob/7.3.7-ga8/readme/BREAKING_CHANGES.markdown#L501).
- [DOC] [7.3 Breaking Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-3-deprecations-and-breaking-changes/7-3-breaking-changes): "Properties with the prefix layout.parallel.render were removed, which means parallel rendering is only supported when AJAX rendering is enabled."
- **Exact name.** The on/off key was `layout.parallel.render.enable`. The slide's `layout.parallel.render` is the prefix, which is how Liferay's own entry describes it. `layout.parallel.render.*` is the most precise short form.

**The better story: why**

The feature was dead five years before the properties went.

- [SOURCE] [LPS-58748](https://liferay.atlassian.net/browse/LPS-58748), Sep 2015: "Disable server side parallel rendering indefinitely due to the OSGi servlet container thread safety issues."
- [SOURCE] [`7f87aac`](https://github.com/liferay/liferay-portal/commit/7f87aac249b6cbc65317eec590099e54dcb23a9a): "Force turn off server side parallel rendering at code level to prevent user from turning it back on." It changes the constant to `LAYOUT_PARALLEL_RENDER_ENABLE = false`.
- [SOURCE] So the sequence is: default `true` in 6.2, `false` in 7.0 GA1 and hard-coded off, then commented out as "only provided for documentation purposes" by 7.1 GA1, then deleted in 2020. The stated reason for the final removal is only: "This feature has been deprecated."

**Replacement**

Client-side AJAX rendering, not a server thread pool.

- [SOURCE] `layout.ajax.render.enable=true` at [2026.q3.0 L5087](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/portal.properties#L5087).
- [SOURCE] The portlet DTD ([2026.q3.0 L669](https://github.com/liferay/liferay-portal/blob/2026.q3.0/definitions/liferay-portlet-app_7_4_0.dtd#L669)): `render-weight` below 1 with `ajaxable=true` renders in parallel; otherwise serial.

**Current state**

Not reintroduced. No property in 2026.q3.0, master, or any released WAR I probed.

[SOURCE] All seven keys are on the obsolete list, which logs `Portal property "..." is obsolete` ([`PreupgradeVerifyProperties` L1908-1914 and L150 at 2026.q3.0](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/com/liferay/portal/verify/PreupgradeVerifyProperties.java#L1908-L1914); called `VerifyProperties` and run from `DBUpgrader` at 7.4.3.132-ga132). That is the opposite of how CacheFilter was handled, which is on no such list.

**Still recommended?**

Thin evidence, and all of it old [WILD].

- A [2014 comment on the Liferay blog](https://liferay.dev/b/introducing-portal-sandbox-improve-portal-resiliency) points readers at it: "We have a feature called 'server side parallel rendering' for it." That was accurate for 6.2.
- The historical [Sun Web Space Server guide](https://docs.oracle.com/cd/E19316-01/820-7054/girna/index.html) lists `layout.parallel.render.enable=true`, but as a property default rather than as advice.
- A [Liferay blog from Aug 2021](https://liferay.dev/b/portletmvc4spring-async-rest-client) already calls it dead: "This is a feature that used to be available until Liferay 6.x ... Its mention remains until the 7.2 documentation as a remainder that it was removed."
- GitHub code search: `layout.parallel.render.enable=true` has 16 hits; the first nine are all copies of old `portal.properties`. It has **0** hits in `portal-ext.properties` as either `true` or `false`.
- A Liferay KB article on 6.2 `IllegalStateException` errors exists, but I could only see it through search snippets.
- I found **no current** page telling you to enable it, and it is in no checklist edition. This is the weakest "still in circulation" row: it is dead, but hardly anyone still recommends it.

**Live command**

```bash
for t in 7.3.0-ga1 7.3.1-ga2; do echo "$t: $(curl -s https://raw.githubusercontent.com/liferay/liferay-portal/$t/portal-impl/src/portal.properties | grep -c layout.parallel.render)"; done
# 7.3.0-ga1: 7
# 7.3.1-ga2: 0
```

### 2.4 `-XX:+UseConcMarkSweepGC`: Won't boot

**The JDK number is wrong in the notes**

- [DOC] [JEP 363](https://openjdk.org/jeps/363): "Remove the Concurrent Mark Sweep (CMS) Garbage Collector", Release **14**. [JEP 291](https://openjdk.org/jeps/291) deprecated it in 9.
- [SOURCE] `special_jvm_flags` in `arguments.cpp`:
  - [jdk-13-ga L530](https://github.com/openjdk/jdk/blob/jdk-13-ga/src/hotspot/share/runtime/arguments.cpp#L530): deprecated in 9.
  - [jdk-14-ga L548](https://github.com/openjdk/jdk/blob/jdk-14-ga/src/hotspot/share/runtime/arguments.cpp#L548): obsoleted in 14, expires in 15.
  - jdk-15-ga: no entry.
  - `gc/cms/cmsArguments.cpp` returns 200 at jdk-13-ga and 404 at jdk-14-ga.

**[TESTED] Exact results, `java -XX:+UseConcMarkSweepGC -version`**

| JDK | Exit | Output |
|---|---|---|
| OpenJDK 1.8.0_504 | 0 | Normal version banner, no warning |
| OpenJDK 11.0.32.1 | 0 | `warning: Option UseConcMarkSweepGC was deprecated in version 9.0 and will likely be removed in a future release.` |
| Zulu 13.0.14 | 0 | Same deprecation warning |
| Zulu 14.0.2 | **0** | `warning: Ignoring option UseConcMarkSweepGC; support was removed in 14.0` |
| Zulu 15, Zulu 16 | **1** | `Unrecognized VM option 'UseConcMarkSweepGC'` / `Error: Could not create the Java Virtual Machine.` / `Error: A fatal exception has occurred. Program will exit.` |
| OpenJDK 17.0.21.0.2, 21.0.13.0.2, 27.0.1.0.3 | **1** | Same three lines |
| Temurin 17, Temurin 21 (Docker) | **1** | Same three lines |
| **IBM Semeru Open Edition 17.0.20.1, 21.0.12.1 (OpenJ9)** | **0** | Normal banner. The flag is silently ignored. |

**[TESTED] The real product.** `docker run --rm -e LIFERAY_JVM_OPTS="-XX:+UseConcMarkSweepGC" liferay/dxp:2026.q3.1`:

```
[LIFERAY] Using zulu21 JDK. ...
[LIFERAY] Available JDKs: zulu21.
[LIFERAY] Starting Liferay DXP. ...
Unrecognized VM option 'UseConcMarkSweepGC'
Error: Could not create the Java Virtual Machine.
Error: A fatal exception has occurred. Program will exit.
```

The JVM never starts, yet `docker run` itself returned **exit 0**. That is worth knowing if monitoring keys on exit codes.

**[TESTED] The full block real setenv files carry** (`-XX:+UseParNewGC -XX:ParallelGCThreads=16 -XX:+UseConcMarkSweepGC -XX:+CMSParallelRemarkEnabled -XX:+CMSCompactWhenClearAllSoftRefs -XX:CMSInitiatingOccupancyFraction=85 -XX:+CMSScavengeBeforeRemark`):

- JDK 8: exit 0.
- **JDK 11, 17, 21, 27: exit 1, `Unrecognized VM option 'UseParNewGC'`.**

So the block published in the checklist was already fatal on JDK 11, a version DXP 7.4 supported, because of its first flag. This is stronger than the slide's claim, and it is the better answer if someone says "it only broke on 15".

**Escape hatches a Liferay engineer may raise**

- [TESTED] `-XX:+IgnoreUnrecognizedVMOptions` makes HotSpot boot: exit 0 on JDK 17 with the single flag, and on JDK 21 with the full block. Liferay doesn't rescue you with it: master's bundle [`setenv.sh`](https://github.com/liferay/liferay-portal/blob/master/tools/servers/tomcat/bin/setenv.sh) and the liferay-docker bundle `Dockerfile` don't contain it, and the DXP image test above failed.
- [TESTED] OpenJ9 ignores the flag, as shown above. [DOC] The [compatibility matrix](https://support.liferay.com/w/liferay-dxp-7-4-through-dxp-2025-q1-lts-quarterly-release-compatibility-matrix) certifies "All Java Technical Compatibility Kit (TCK) compliant builds of the listed JDK major versions". I did not verify whether Semeru Open Edition qualifies, and I did not boot Liferay on OpenJ9.

The notes therefore say "HotSpot". "Won't boot" stays accurate in the slide cell for every JDK Liferay's docs name (OpenJDK, Oracle, Azul).

**"The JDK 17 or 21 that DXP 2024.Q3 and later require"**: confirmed.

- [DOC] [JVM Configuration](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/jvm-configuration): "As of Liferay DXP 2024.Q3+/Portal GA125+, Liferay DXP/Portal requires a Java JDK 17 or 21 (prior versions support JDKs 8 and 11)".
- [DOC] Matrix: "Compatibility with Java JDK 8 runtime has been removed in 2024.Q2 ... Java JDK 11 runtime was deprecated in 2024.Q1 and removed in 2024.Q3 and later releases. Java JDK 17 and JDK 21 runtimes are certified on 2024.Q2 or later. JDK 21 is the recommended runtime."
- [DOC] Later matrices ([2025.Q2](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/compatibility-matrices/liferay-dxp-2025-q2-compatibility-matrix), 2025.Q3, 2025.Q4, [2026.Q1 LTS](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/compatibility-matrices/liferay-dxp-2026-q1-lts-compatibility-matrix), 2026.Q2, [2026.Q3](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/compatibility-matrices/liferay-dxp-2026-q3-compatibility-matrix)) all list "Oracle JDK 17 DEPRECATED" and "Oracle JDK 21". So "17 or 21" is still accurate, with 21 the direction of travel. The 2026.Q3.1 Docker image ships only `zulu21`.

**"Still in Liferay's own Deployment Checklist PDF"**: this no longer holds as written.

| Document | State | CMS? |
|---|---|---|
| [7.4 checklist URL](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.4+Deployment+Checklist.pdf/f3464a36-c0f0-6708-37dd-efe7b8270403?t=1643744619710) today | Serves **"Liferay DXP Go Live Checklist 2026.Q1"**, 27 pages | **No.** "G1 should be the default choice for Liferay DXP" (PDF p.7), `-XX:+UseG1GC -XX:+DisableExplicitGC` (p.8), "JDK 21 is recommended for 2026.Q1 and later releases" (p.7) |
| [Resource page](https://www.liferay.com/resources/product-info/Liferay+DXP+7.4+Deployment+Checklist) | Slug is still "7.4 Deployment Checklist", title is now "Liferay DXP Go Live Checklist" | n/a |
| Old 7.4 PDF, created 2023-08-04 (`/home/ligasm/Downloads/Liferay DXP 7.4 Deployment Checklist.pdf`) | No longer at that URL. A [third-party Scribd copy](https://www.scribd.com/document/727615239/Liferay-DXP-7-4-Deployment-Checklist) is indexed | **Yes**, printed p.8 and p.10: "Liferay recommends using the concurrent low pause collectors" |
| [7.3 Deployment Checklist URL](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.3+Deployment+Checklist.pdf/bf1b2c5d-39df-94ab-41b9-77120f4543a8?t=1616026802771) | **Still live**, created 2023-06-19 | **Yes**, but 7.3 was a Java 8/11 product |
| [7.1 Deployment Checklist URL](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.1+Deployment+Checklist/cacaac23-9e02-411a-dcc9-adf86f95c513) | **Still live**, created 2020-11-16 | **Yes** |
| [Tuning Your JVM](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-your-jvm) (current Learn) | Live | **Yes**, under "Garbage Collection on Java 8". The Java 11 section says "use the Garbage-First (G1) algorithm". No 17/21 section. |

Fairness point: the 2023 PDF states "We used Oracle's 1.8 JVM for the reference architecture", and the 2024.Q3 JDK requirement came later. It went stale rather than contradicting itself when written. Liferay has since fixed it, and the audience may know that.

**Still recommended?**

Beyond the Liferay documents above [WILD]:

- [Surekha Tech, 13 Feb 2016](https://www.surekhatech.com/blog/liferay-performance-tuning) carries `-XX:+UseParNewGC -XX:+UseConcMarkSweepGC` alongside the even older `-XX:MaxPermSize`.
- GitHub code search, `setenv.sh` files mentioning Liferay: 4 with the flag. Those I checked are old, such as [`mdelapenya/docker-liferay-portal`](https://github.com/mdelapenya/docker-liferay-portal/blob/master/configs/setenv.sh), last pushed 2020.
- Not everyone followed it: [XTIVIA, 9 Aug 2016](https://www.xtivia.com/blog/tuning-basic-jvm-performance-liferay-dxp-7/) already said "XTIVIA recommends that all of our Liferay implementations leverage the G1GC garbage collection policy", seven years before Liferay's 2023 PDF still recommended CMS.
- I found no Liferay-specific page from 2024 or later recommending it.

**Liferay's own repo still carries the block** [SOURCE]. [`osb-faro-docker/local/Dockerfile.ext`](https://github.com/liferay/liferay-portal/blob/2026.q3.0/workspaces/liferay-osbfaro-workspace/modules/osb-faro-docker/local/Dockerfile.ext#L7) L7, at 2026.q3.0 and master, sets `-XX:+UseParNewGC ... -XX:+UseConcMarkSweepGC`, and L14 sets `-XX:+IgnoreUnrecognizedVMOptions` in `JAVA_OPTS`. It is a local-development image for Analytics, not a product default, so treat it as a Q&A aside rather than a slide claim. I did not build it or confirm its JDK.

**Replacement**

G1, per the Go Live Checklist. The older "tests for G1 indicated that it does not improve performance" note survives only in *Tuning Your JVM* (Java 8 section) and a legacy KB.

**Live command**

```bash
docker run --rm eclipse-temurin:21 java -XX:+UseConcMarkSweepGC -version; echo "exit=$?"
```

### 2.5 `CacheFilter`: Deleted

**The date is wrong by a year**

| Fact | Value | Source |
|---|---|---|
| Disabled by default | Merged 2024-06-11 | [`7af5ad9`](https://github.com/liferay/liferay-portal/commit/7af5ad9bc096d082e23ce1672808ca9b2c3bafaa) |
| Deleted (504 + 70 lines, plus `liferay-web.xml` and properties) | Author 2024-06-11, merged **2024-06-13** | [`71dc886`](https://github.com/liferay/liferay-portal/commit/71dc8861df87f0962782e11090d44213291f544b), [PR #151316](https://github.com/brianchandotcom/liferay-portal/pull/151316) |
| 7.4.3.122-ga122 | Tag commit 2024-06-14. File present, `CacheFilter=true` at [L9626](https://github.com/liferay/liferay-portal/blob/7.4.3.122-ga122/portal-impl/src/portal.properties#L9626) | [Release properties, U122](https://releases-cdn.liferay.com/dxp/7.4.13-u122/release.properties): `release.date=2024-06-14` |
| 7.4.3.123-ga123 | Tag commit **2024-06-27T17:21:41Z**, on top of "7.4.3.123 GA123 Release". File 404, property gone | [Release properties, U123](https://releases-cdn.liferay.com/dxp/7.4.13-u123/release.properties): `release.date=2024-06-27`, `git.hash.liferay-portal-ee=28071b9f...` (the same commit as the tag) |

- [SOURCE] GitHub compare: both commits are ancestors of ga123 and diverge from ga122.
- [SOURCE] The history alone rules out 2023: `CacheFilter.java` at the ga122 tag has commits dated 2023-10-04.
- I cannot confirm "28 June" for any year. A separate CE announcement date may exist, but 27 June 2024 is the defensible date.

**CE vs DXP**

"Every DXP quarterly ships without it" (dossier) is false. [TESTED] I read `portal-impl.jar` from the released WARs:

| Release | Date | CacheFilter classes | Property |
|---|---|---|---|
| DXP 2024.Q1.1 to Q1.12 | 2024-03-13 to 2024-06-03 | **present** | `true` |
| DXP 2024.Q1.13 | 2025-01-31 | gone | gone |
| DXP 2024.Q2.0, Q2.1 | 2024-06-12, 2024-06-17 | **present** | `true` |
| DXP 2024.Q2.2 | **2024-06-24** | gone | gone |
| DXP 7.4.13 U123 | 2024-06-27 | gone (same commit as ga123) | gone |
| DXP 2024.Q3.0 | 2024-09-12 | gone | gone |
| DXP 2026.Q1.14 LTS, 2026.Q3.1 | current | gone | gone |

Details:

- The earliest shipped build without it is 2024.Q2.2, three days before GA123. "Deleted at 7.4.3.123" remains right for the 7.4 line.
- Jira's fix version says 2024.Q2.9, but the binaries show it gone by Q2.2. Trust the binaries.
- I tested Q1.1, .2, .4, .8, .12 as present and .13 to .16 and .32 as gone. Q1.3 and the other intermediate Q1 patches were not individually opened.

**Why it was removed** (better than the notes suggest)

- [SOURCE] [`7af5ad9`](https://github.com/liferay/liferay-portal/commit/7af5ad9bc096d082e23ce1672808ca9b2c3bafaa): "LanguageFilter is overlapping most its filter target with CacheFilter, and LanguageFilter on purposely disabled pacge caching, which is making CacheFilter really useless." (typo in the original)
- [SOURCE] [PR #151255](https://github.com/brianchandotcom/liferay-portal/pull/151255), Shuyang Zhou, 2024-06-12: "the cache filter's `com.liferay.portal.servlet.filters.cache.CacheUtil` portalcache hit ratio is always 0, since none of our test URLs are cacheable. But the cachefilter has to prepare for the cache key no matter what, so it is pure waste."
- Same PR, 2024-06-13: "I don't expect this to be a big improvement. But it is a pure improvement, can not cause performance regression."
- [SOURCE] Parent ticket [LPD-21598](https://liferay.atlassian.net/browse/LPD-21598): "Optimize Runtime code 2024.Q1 deployment".
- [SOURCE/INFERRED] The LanguageFilter overlap covers CacheFilter's *resource* mappings (`/combo/*`, `*.js`, `*.css`, `*.jsp`), where LanguageFilter sets `private, no-cache` ([L78-79](https://github.com/liferay/liferay-portal/blob/7.4.3.112-ga112/portal-impl/src/com/liferay/portal/servlet/filters/language/LanguageFilter.java#L78-L79)). It does not map `/web/*`, `/group/*` or `/user/*`. So the page path was retired on the hit-ratio argument, not the overlap one.

**"The only built-in guest full-page cache"**: holds, with a limit you should know.

- [SOURCE] Guest-only: `userId > 0` or a remote user means not cacheable ([CacheFilter L325](https://github.com/liferay/liferay-portal/blob/7.4.3.112-ga112/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java#L325)).
- [SOURCE] **Widget pages only:** `if (!layout.isTypePortlet()) return false` ([L295](https://github.com/liferay/liferay-portal/blob/7.4.3.112-ga112/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java#L295)), and every portlet on the page had to be layout-cacheable ([L302](https://github.com/liferay/liferay-portal/blob/7.4.3.112-ga112/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java#L302)).
- [SOURCE] `_layoutCacheable` defaults to `false`; 91 Java files under `modules/apps` set `layout-cacheable=true` at ga112. By `isTypePortlet()` logic a page must resolve to the `portlet` layout type to qualify, so ordinary **content pages never used it** ([INFERRED] from reading the code, not run).
- [SOURCE] It also cached `*.css`, `*.js`, `/combo/*` and `/language/*`, so it was never purely a page cache.
- [INFERRED] "Only": none of the 43 filters in `liferay-web.xml` (2026.q3.0) does this job, and `BufferCacheServletResponse` users in `portal-impl` are not page caches. I did not exhaustively audit OSGi modules. Fragment-level caching exists but isn't full-page.

**"Silently"**

- [SOURCE] No entry in `readme/BREAKING_CHANGES.md` or `BREAKING_CHANGES_AMENDMENTS.md` at 2026.q3.0 (0 case-insensitive hits). The deleting commit touches no readme.
- [DOC] Zero hits across all 33 Learn pages fetched, covering Breaking Changes, Maintenance Mode and Default Settings for 2024.Q1 through 2026.Q3, plus the 7.4 Breaking Changes and Default Settings pages, with one exception:
- [DOC] **[2024.Q1 Default Setting and Feature Flag Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2024-deprecations-and-breaking-changes/2024-q1-default-setting-and-feature-flag-changes)**, under "Here are the property changes from 2023.Q4 to 2024.Q1", has the row `com.liferay.portal.servlet.filters.cache.CacheFilter | true | Removed property`. Oddly, 2024.Q1.1 to Q1.12 still shipped it, so the row doesn't match those binaries. I could not determine when the row was added.
- [SOURCE] For an operator it is silent: the key is not in `PreupgradeVerifyProperties` at 2026.q3.0 or master, unlike `layout.parallel.render.*`. A leftover `CacheFilter=true` draws no obsolete-property message from that check. I read this from the code and did not run an upgrade.
- [SOURCE] Leftovers persist at 2026.q3.0: `cache.content.threshold.size` ([L6174](https://github.com/liferay/liferay-portal/blob/2026.q3.0/portal-impl/src/portal.properties#L6174)) and `cache.filter.include.user.agent` (L6184) still describe "the cache filter". `<layout-cacheable>` is still in the DTD ([L584](https://github.com/liferay/liferay-portal/blob/2026.q3.0/definitions/liferay-portlet-app_7_4_0.dtd#L584)), and `LayoutTypePortletImpl.isCacheable()` has only test callers at ga132.

So: "no breaking-change entry" is rock solid. "Silently" isn't, because someone in the room can open that table. "Quietly" survives that challenge.

**Replacement**

None. [SOURCE] Neither the commits, the PRs, nor the ticket names one. [DOC] The Go Live Checklist lists a CDN in the PaaS stack (PDF p.4), which is infrastructure rather than a successor. Guest HTML caching now means a reverse proxy or CDN, which is the premise of this talk.

**Reintroduced?**

No. [SOURCE] Absent from master and 2026.q3.0, and [TESTED] from the 2026.Q3.1 WAR. GitHub code search on master finds only the unrelated `OAuth2NoCacheFilter`.

**Still recommended?**

I found no current page telling you to tune `CacheFilter` in production. Forum threads from the Liferay 5 and 6 era discuss it, but those I could reach came through search snippets only, because the threads redirect to a login page. GitHub code search, `portal-ext.properties` files: `CacheFilter=false` in 17, `=true` in 1 (a 6.2 SDK repo from 2017). Closest examples [WILD]:

- [`peterrichards-lr/liferay-docker-manager`](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/common/portal-ext.properties) L4 (pushed 2026-10-26) and [`pulse-workspace` `configs/prod`](https://github.com/peterrichards-lr/pulse-workspace/blob/main/configs/prod/portal-ext.properties) L10 (pushed 2026-03-18) still set `CacheFilter=false`. **This is the best live example:** people are still switching off a filter that no longer exists.

- [Liferay frontend guidelines](https://github.com/liferay/liferay-frontend-projects/blob/master/guidelines/dxp/environment.md) L21: `CacheFilter=false` in developer settings. Last changed 2021, and the filter no longer exists.
- [gist 6163740](https://gist.github.com/6163740), 2013: also `CacheFilter=false`.
- [IGNEK](https://www.ignek.com/blog/performance-tuning-with-liferay) (2025 metadata timestamps) and [Surekha Tech, 2016](https://www.surekhatech.com/blog/liferay-performance-tuning) both recommend `com.liferay.portal.servlet.filters.layoutcache.LayoutCacheFilter=true`. That key isn't even in 6.2.5's `portal.properties`. This is the nearest thing to a genuine graveyard example.

**Live command**

```bash
for t in 7.4.3.122-ga122 7.4.3.123-ga123; do curl -s -o /dev/null -w "$t %{http_code}\n" https://raw.githubusercontent.com/liferay/liferay-portal/$t/portal-impl/src/com/liferay/portal/servlet/filters/cache/CacheFilter.java; done
curl -s https://releases-cdn.liferay.com/dxp/7.4.13-u123/release.properties | grep -E '^(release.date|git.hash.liferay-portal-ee)'
```

Output: `200`, `404`, `git.hash.liferay-portal-ee=28071b9f...`, `release.date=2024-06-27`.

The dossier's Appendix B also greps `release.info.date` from `release.properties` at the tag. That returns nothing, so drop that line from any demo.

## 3. The minifier and GZipFilter relationship

**Conceptually connected, but not connected in the code, and their defaults flipped for different reasons.** They are two ways of trading app-server CPU for fewer bytes.

**No code link** [SOURCE]

- `GZipFilter.java` and `GZipResponse.java` contain no reference to the minifier (case-insensitive search, 7.4.3.132-ga132).
- `MinifierUtil` is called only from `ComboServlet`, `AggregateFilter` and `StripFilter`.
- No property couples the two switches. You can set them in any combination.

**The real code link is minifier and StripFilter** [SOURCE]

- [`StripFilter`](https://github.com/liferay/liferay-portal/blob/7.4.3.132-ga132/portal-impl/src/com/liferay/portal/servlet/filters/strip/StripFilter.java#L129) calls `MinifierUtil.minifyCss` and `minifyJavaScript` on inline content, using the `minifier.inline.content.cache.*` properties.
- If the speaker wants to say "these two are connected in the source", that is the pair to name.

**They share a pipeline** [SOURCE/INFERRED]

- GZipFilter maps onto the same surfaces the minifier serves: `/combo/*`, `*.css`, `*.js`.
- In `liferay-web.xml` the mappings are declared GZip, then Strip, then Language, then Aggregate (2026.q3.0 L626, L722, L746, L758).
- Reading that order, GZip is outermost, so output is minified first and compressed last. I read this from the file and did not observe it at runtime.
- Since LPD-52709 (2025), `FrontendResourceFilter` serves `/o/` resources ahead of GZip Filter, per LPD-109033, so that overlap has shrunk on current releases.

**They share a cost** [DOC]

- The legacy [Too Many CPU Intensive Tasks](https://learn.liferay.com/kb-article/too-many-cpu-intensive-tasks-a-common-performance-issue-in-dxp-7.0) article lists Minifier, StripFilter and GZipFilter together as common CPU causes.
- It says: "The StripFilter is similar to the Minifier in that the end result is smaller files in exchange for CPU usage."
- This article is probably why they feel connected. [INFERRED]

**They changed independently** [SOURCE]

| Default flipped | Ticket | First GA | Stated reason | Later fate |
|---|---|---|---|---|
| GZipFilter, Apr 2018 | LPS-79404, LPE-16413 | 7.1 GA1 | BREACH; also CPU | Not deprecated; `/o/` resources not covered per LPD-109033 |
| StripFilter, May 2019 | LPS-95552 | 7.2 GA1 | CPU and memory vs network savings | Not deprecated |
| Minifier, Dec 2020 | LPS-123550 | 7.4 GA1 | Server load; modern build tooling | Deprecated, JS path deleted Jan 2025 |

None of these commit messages mentions the others.

**Safe line:** "Same trade, CPU for bytes, but separate switches turned off for separate reasons. The minifier and StripFilter went for CPU, GZipFilter went for BREACH." Avoid saying they depend on each other.

## 4. What can honestly be asserted

**"Still on every checklist" is an overstatement.** Case-insensitive search of Liferay's three checklist editions:

| Item | 7.1 and 7.3 PDFs (live) | 7.4 PDF (2023, replaced) | Go Live 2026.Q1 (current) |
|---|---|---|---|
| `minifier.enabled` | no | no | no |
| `GZipFilter` | footnote says replace it | footnote says replace it | generic "compression" only |
| `layout.parallel.render` | no | no | no |
| `UseConcMarkSweepGC` | **yes** | **yes** | no, recommends G1 |
| `CacheFilter` | no | no | no |

Across all the sources I checked:

- CMS is the only one with official present-tense endorsement, and only in superseded or Java-8-labelled material.
- GZip and Strip appear widely, but mostly as "turn it off".
- `minifier.enabled` and `layout.parallel.render` I found mainly in old or developer-settings material.
- `CacheFilter` I found only as `false` in developer settings.
- My searches were not exhaustive, and search engines surfaced mostly 2012 to 2016 pages plus a few current ones. IGNEK is the best current web example.

**What real config files show** [WILD]. GitHub code search for each exact line in files named `portal-ext.properties`, run 2026-11-01. GitHub only indexes part of its public code, and these are small samples, so read the direction rather than the numbers:

| Setting | `=true` | `=false` |
|---|---|---|
| `minifier.enabled` | 1 | 16 |
| `GZipFilter` | 5 | 12 |
| `CacheFilter` | 1 | 17 |
| `layout.parallel.render.enable` | 0 | 0 |

The pattern: people mostly switch these **off**, often copying developer settings, and most of those lines are now no-ops. So the graveyard's honest framing isn't "people tell you to turn these on". It's "people are still setting properties that do nothing or no longer exist".

**"Half of what the internet tells you" has no basis.** No one has counted it, and a Liferay engineer can ask "half of what?".

**Defensible claims:**

- "These five keep turning up in Liferay tuning advice. Each is out of date, and I can prove each from the source."
- "Liferay's own 2023 checklist recommended a GC flag that would not boot on the JDK that DXP has required since 2024.Q3. They have since rewritten it around G1."
- "Liferay deleted its guest page cache in June 2024 with no breaking-change entry."

## 5. Proposed wording

### Slide

Only the header and two rows change.

| Header / row | Now | Proposed |
|---|---|---|
| Column header | Still on every checklist | **Still in circulation** |
| Row 1 | `minifier.enabled` / Deprecated | no change |
| Row 2 | `GZipFilter` / Off by default | no change |
| Row 3 | `layout.parallel.render` / Removed | **`layout.parallel.render.*`** / Removed |
| Row 4 | `-XX:+UseConcMarkSweepGC` / Won't boot | no change |
| Row 5 | `CacheFilter` / Deleted, silently | `CacheFilter` / **Deleted, quietly** |

### Speaker notes

105 words, against 113 now, so this should land inside the 45-second slot at the same pace.

> Hook: these five keep turning up in Liferay tuning advice. Each one is out of date, and I can prove it from the source.
> * minifier.enabled is deprecated and defaults to false, minification moved to build time.
> * GZipFilter and StripFilter are off by default; compress at the edge.
> * Server-side layout.parallel.render was removed in 7.3, LPS-110359. CMS was removed in JDK 14, and from 15 that flag stops a HotSpot JVM booting. DXP 2024.Q3 and later require 17 or 21. Liferay's checklist now says G1.
> And the punchline: CacheFilter, the only built-in guest full-page cache, was deleted at 7.4.3.123 on 27 June 2024, with no breaking-change entry.

### Q&A prep (not for the notes)

- **"It's documented, it's in the 2024.Q1 settings table."** Yes, one row saying "Removed property", no breaking-change entry, and those Q1 patches still shipped it.
- **"Why was it removed?"** Liferay's own PR: hit ratio 0 in their tests, cache-key work on every request, "pure waste".
- **"Did it cache content pages?"** No, only widget pages where every portlet opted in.
- **"GZip was turned off for BREACH, and that follows you to the edge."** Correct in principle. Guest HTML with no secret isn't exposed; logged-in HTML needs its own decision. See 2.2.
- **"Why do Liferay's own repos still set CMS?"** The osb-faro local Dockerfile does, alongside `-XX:+IgnoreUnrecognizedVMOptions`. It is a dev image, not a product default.
- **"Our 2024.Q1 still has it."** Correct up to Q1.12. Gone from Q1.13 and Q2.2.
- **"Semeru boots with that flag."** Yes, OpenJ9 ignores it. So does HotSpot with `-XX:+IgnoreUnrecognizedVMOptions`.
- **"The checklist was fixed."** Yes, the current one recommends G1. CMS remains in the live 7.3 PDF and in the Java 8 section of *Tuning Your JVM*.

## 6. Corrections needed in the dossier

**Status, 2026-11-01:** applied to `docs/liferay-performance-dossier.md` and `docs/talk-outline-45min.md`, and slide 3 was cut from the deck, so the deck items below no longer apply. Line numbers refer to the dossier before those edits.

| Line(s) | Says | Should say |
|---|---|---|
| 34, 156, 207, 222, 227, 1588 | 7.4.3.122 = 14 Jun **2023**; 7.4.3.123 = 28 Jun **2023** | 14 Jun **2024**; 27 Jun **2024** |
| 222 | 7.4 GA1 "(Oct 2021)" | CE tag 7.4.0-ga1 is committed 2021-04-20. I did not check a DXP GA1 date. |
| 207 | "Every DXP quarterly release (2024.Q1+) ships without it" | **False.** Present in 2024.Q1.1 to Q1.12 and in Q2.0 and Q2.1. See the table in 2.5. |
| 3676 | CacheFilter 404 "at `7.4.1-ga1`" | That tag doesn't exist (`portal.properties` also 404s). 200 at 7.4.0-ga1, 7.4.1-ga2, 7.4.2-ga3, 7.4.3.4-ga4. |
| 3676, 3678, 4349 | Removed "in 7.4"; property "gone from 7.4+" | Removed in update 123 of the 7.4 line, June 2024. 7.4.0-ga1 has `CacheFilter=true` at L9909. |
| 34, 169, 3678 | Removal "undocumented" | No breaking-change entry, but one "Removed property" row on the 2024.Q1 Default Setting page. |
| 34 | "Every blog post, StackOverflow answer and consultancy checklist telling you to tune it" | No such evidence found. Soften or drop. |
| 263 | Deleted because "it almost never hit" in a modern portal | Inference. Primary source is PR #151255: hit ratio 0 in their tests, plus LanguageFilter overlap. |
| 235 | `liferay-web.xml` "declares 44 filters" | 43 at master and 2026.q3.0 today. No CacheFilter, so the point stands. |
| 4750 | `GZipFilter=false` presented as a compression-placement choice | Add the actual reason: BREACH (LPE-16413, 7.0 Fix Pack 46). The dossier never mentions BREACH in this sense. |
| 4478 | Advice "stale by 10+ years" | Only parallel rendering (2015) is that old. GZip 2018, Strip 2019, minifier 2020, CMS 2020, CacheFilter 2024. |
| 4504 | "paying runtime CPU for nothing"; trade-off "none" | `true` still compresses CSS. LPD-45984 removed the JS path in Jan 2025 (gone in 2025.q1.13-lts, still present in 2024.q4.2). |
| 4723 | Parallel rendering "removed" with LPS-57880 as context | Add LPS-58748 (2015 hard-disable, thread-safety reason) and LPS-110359 (2020 removal). |
| 4724 | "Rendering is sequential" | Serial on the server, unless `render-weight` is below 1 with `ajaxable=true`, which is AJAX rendered in parallel. |
| 5057, 5449, 5583 | "CMS was removed in JDK 15" | Removed in **JDK 14** (JEP 363). The flag is fatal from JDK 15. |
| 119, 5073 | DXP "requires" or "mandates" JDK 21 | Requires 17 or 21. 21 is the recommended runtime. |
| 3682 | "Liferay 7.3 had a guest page cache. 7.4 doesn't." | 7.4 had it until update 122. It went in June 2024. |
| 5057, 5449, 5583, 119 | Deployment Checklist "still publishes them" | The current edition (Go Live Checklist 2026.Q1) uses G1. Say "the 2023 edition", or cite the live 7.3 PDF. |
| 5057 | "These flags will fail to start a JDK 17/21 JVM" | True on HotSpot. OpenJ9 ignores the CMS flag. Also, the full block already fails on JDK 11 because of `UseParNewGC`. |
| 5444, 5447, 5448 | Myth column: "Set `minifier.enabled=true`", "Enable `GZipFilter`", "Enable `StripFilter`" | Evidence shows the published advice is mostly to turn them **off**. |
| 1636 | `grep release.info.date` at the tag | `release.properties` at the tag has no such line. Use `releases-cdn.liferay.com/dxp/7.4.13-u123/release.properties`. |

The same errors appear outside the dossier:

- `docs/talk-outline-45min.md:27` has JDK 15, the present-tense checklist claim, and the 2023 date.
- `deck/speaker-notes.md:13`, `deck/project/slides/graveyard.html:12` and `deck/index.html` carry the slide notes.

## 7. Not verified

- **"28 June"** as any official CE GA123 date. I only have 27 June 2024 from the tag and DXP release metadata.
- **When the 2024.Q1 "Removed property" row was added**, and why it disagrees with the Q1.1 to Q1.12 binaries.
- **LPS-79404's rationale.** Its Jira entry returned 404, and the linked tickets LPP-59160 and PTR-7385 did too.
- **Whether LPS-79404 and LPE-16413 are formally linked.** The dates and content match, but no source I could read says so.
- **LPD-109033's behaviour.** I relied on the ticket and PR and did not reproduce it.
- **Stack Overflow.** WebSearch refused the domain because it isn't accessible to the tool, and I did not route around that. The dossier's "StackOverflow answer" claim remains unevidenced.
- **liferay.dev forum threads.** Some older threads redirect to a login or to Liferay Discuss, so those I saw through search snippets only (for example messages 4308514 and 46447576). I don't rely on them for any claim.
- **The 7.1 developer-mode doc** at `portal.liferay.dev`. Unreachable from here; seen as a search snippet only.
- **The osb-faro Dockerfile's base JDK.** Not determined, and the image was not built.
- **Liferay actually running on OpenJ9, or whether Semeru Open Edition counts as TCK-compliant.** I only tested `java -version`.
- **The full CMS block on OpenJ9 and JDK 9/10, and any test on Oracle JDK itself.** Not run. Oracle's builds are HotSpot, so I expect the same result as OpenJDK, but that is [INFERRED].
- **The learn.liferay.com KB on 6.2 `IllegalStateException`** (`/l/33815217`). It only returned a redirect stub, so I saw it through search snippets.
- **XTIVIA's portal-ext article.** Blocked to curl, not used as evidence.
- **Exhaustive "in the wild" counts.** The examples are concrete but are samples.
- **The CMS flag on a pre-JDK 17 Liferay image.** The DXP boot test was run only on 2026.Q3.1.

Environment note: `liferay/dxp:2026.q3.1` is still in the local Docker cache, because other `liferay/dxp` images were already there and I could not tell whether I added this one. I removed the JDK images I pulled.

## 8. Sources relied on

### Primary: decides product behaviour

**Liferay source and binaries**

- [liferay/liferay-portal](https://github.com/liferay/liferay-portal) at tags 6.2.5-ga6, 7.0.0-ga1, 7.0.6-ga7, 7.1.0-ga1, 7.2.0-ga1, 7.3.0-ga1, 7.3.1-ga2, 7.3.7-ga8, 7.4.0-ga1, 7.4.3.112-ga112, 7.4.3.122-ga122, 7.4.3.123-ga123, 7.4.3.132-ga132, 2026.q3.0 and master.
- Commits: [`7af5ad9`](https://github.com/liferay/liferay-portal/commit/7af5ad9bc096d082e23ce1672808ca9b2c3bafaa), [`71dc886`](https://github.com/liferay/liferay-portal/commit/71dc8861df87f0962782e11090d44213291f544b), [`1e68624`](https://github.com/liferay/liferay-portal/commit/1e6862493e8da3b422c6d930c8f3dea866519f1f), [`ee530e0`](https://github.com/liferay/liferay-portal/commit/ee530e0d1daa6a9d4369fde40a557a8cec0d10cd), [`4ad0773`](https://github.com/liferay/liferay-portal/commit/4ad0773ed68c15953fbfd8f6e82192efe2e35bd6), [`f461631`](https://github.com/liferay/liferay-portal/commit/f461631424502506c0f9215147febb0e9091730f), [`51d685f`](https://github.com/liferay/liferay-portal/commit/51d685f8aa904c132c95a581ea2319ac58d38ffe), [`25d2435`](https://github.com/liferay/liferay-portal/commit/25d24354665b5579d40da360e2653087946c7f52), [`7f87aac`](https://github.com/liferay/liferay-portal/commit/7f87aac249b6cbc65317eec590099e54dcb23a9a).
- PRs: [#151255](https://github.com/brianchandotcom/liferay-portal/pull/151255), [#151316](https://github.com/brianchandotcom/liferay-portal/pull/151316), [liferay-frontend #5774](https://github.com/liferay-frontend/liferay-portal/pull/5774).
- Tickets: [LPD-28282](https://liferay.atlassian.net/browse/LPD-28282), [LPD-21598](https://liferay.atlassian.net/browse/LPD-21598), [LPE-16413](https://liferay.atlassian.net/browse/LPE-16413), [LPD-109033](https://liferay.atlassian.net/browse/LPD-109033), [LPS-88569](https://liferay.atlassian.net/browse/LPS-88569), [LPS-110359](https://liferay.atlassian.net/browse/LPS-110359), [LPS-123550](https://liferay.atlassian.net/browse/LPS-123550), [LPS-58748](https://liferay.atlassian.net/browse/LPS-58748), [LPS-95552](https://liferay.atlassian.net/browse/LPS-95552).
- Release metadata and WARs: [releases.json](https://releases.liferay.com/releases.json), [U122](https://releases-cdn.liferay.com/dxp/7.4.13-u122/release.properties), [U123](https://releases-cdn.liferay.com/dxp/7.4.13-u123/release.properties), and the WARs under [releases-cdn.liferay.com/dxp/](https://releases-cdn.liferay.com/dxp/) for the versions in 2.5.

**OpenJDK**

- [JEP 363](https://openjdk.org/jeps/363), [JEP 291](https://openjdk.org/jeps/291).
- `arguments.cpp` at [jdk-13-ga](https://github.com/openjdk/jdk/blob/jdk-13-ga/src/hotspot/share/runtime/arguments.cpp#L530), [jdk-14-ga](https://github.com/openjdk/jdk/blob/jdk-14-ga/src/hotspot/share/runtime/arguments.cpp#L548), [jdk-15-ga](https://github.com/openjdk/jdk/blob/jdk-15-ga/src/hotspot/share/runtime/arguments.cpp).

**Liferay official documentation**

- [JVM Configuration](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/jvm-configuration), [Tuning Your JVM](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/setting-up-liferay/tuning-your-jvm).
- [Compatibility Matrices index](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/compatibility-matrices), [7.4 through 2025.Q1 matrix](https://support.liferay.com/w/liferay-dxp-7-4-through-dxp-2025-q1-lts-quarterly-release-compatibility-matrix).
- [7.3 Breaking Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-3-deprecations-and-breaking-changes/7-3-breaking-changes), [7.4 Breaking Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-4-deprecations-and-breaking-changes/7-4-breaking-changes), [7.4 Default Settings](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/7-4-deprecations-and-breaking-changes/default-setting-and-feature-flag-changes-in-7-4), [2024.Q1 Default Settings](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2024-deprecations-and-breaking-changes/2024-q1-default-setting-and-feature-flag-changes), [2025.Q2 Breaking Changes](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/upgrading-liferay/deprecations-and-breaking-changes-reference/2025-deprecations-and-breaking-changes/2025-q2-breaking-changes). The other 2024 to 2026 quarterly pages under the same path were also checked.
- Checklists: [the 7.4 URL, now Go Live 2026.Q1](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.4+Deployment+Checklist.pdf/f3464a36-c0f0-6708-37dd-efe7b8270403?t=1643744619710), [resource page](https://www.liferay.com/resources/product-info/Liferay+DXP+7.4+Deployment+Checklist), [7.3](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.3+Deployment+Checklist.pdf/bf1b2c5d-39df-94ab-41b9-77120f4543a8?t=1616026802771), [7.1](https://www.liferay.com/documents/10182/3292406/Liferay+DXP+7.1+Deployment+Checklist/cacaac23-9e02-411a-dcc9-adf86f95c513). The 2023 7.4 edition was read from a local copy.

### Liferay secondary: not official, but from Liferay

Used for reasons and recommendations, always alongside source where behaviour is claimed. The KB pages carry a banner saying they are not official documentation.

- KB: [GZIP filter disabled by default](https://learn.liferay.com/kb-article/gzip-filter-disabled-by-default), [gzip for specific endpoints](https://learn.liferay.com/kb-article/is-there-an-out-of-the-box-way-to-set-up-gzip-compression-for-only-specific-endpoints-), [Too Many CPU Intensive Tasks](https://learn.liferay.com/kb-article/too-many-cpu-intensive-tasks-a-common-performance-issue-in-dxp-7.0), [StripFilter](https://learn.liferay.com/kb-article/slow-performance-or-outofmemory-errors-due-to-stripfilter), [GC on Java 21](https://learn.liferay.com/kb-article/garbage-collection-on-java-21).
- [Liferay frontend guidelines, environment.md](https://github.com/liferay/liferay-frontend-projects/blob/master/guidelines/dxp/environment.md), last changed 2021.
- [Portal Developer Properties](https://learn.liferay.com/w/dxp/self-hosted-installation-and-upgrades/reference/portal-developer-properties).
- liferay.dev: [Java evolution is here](https://liferay.dev/b/java-evolution-is-here), [Blades, Gradles, and JDKs](https://liferay.dev/b/blades-gradles-and-jdks-oh-my-) (Jun 2024), [PortletMVC4Spring post](https://liferay.dev/b/portletmvc4spring-async-rest-client) (Aug 2021), [Portal Sandbox post](https://liferay.dev/b/introducing-portal-sandbox-improve-portal-resiliency) (May 2014), [Turn off minifiers](https://liferay.dev/blogs/-/blogs/turn-off-minifiers-and-html-stripping) (Aug 2010).

### Web posts and config files: evidence of what people recommend or do only

- Blogs: [Surekha Tech, performance tuning](https://www.surekhatech.com/blog/liferay-performance-tuning) (Feb 2016), [Surekha Tech, Apache](https://www.surekhatech.com/blog/liferay-performance-tuning-with-apache-web-server) (Mar 2016), [IGNEK](https://www.ignek.com/blog/performance-tuning-with-liferay) (2025 metadata timestamps), [XTIVIA](https://www.xtivia.com/blog/tuning-basic-jvm-performance-liferay-dxp-7/) (Aug 2016), [AIXTOR](https://www.linkedin.com/pulse/what-different-elements-liferay-performance-tuning-aixtor-phxzf) (Nov 2023), [oxybits](http://oxybits.blogspot.com/2012/06/liferay-how-to-increase-liferay.html) (Jun 2012), [gist 6163740](https://gist.github.com/6163740) (Aug 2013).
- Config repos: [Deltares/oss](https://github.com/Deltares/oss), [GovDataOfficial/GovDataPortal](https://github.com/GovDataOfficial/GovDataPortal), [peterrichards-lr/liferay-docker-manager](https://github.com/peterrichards-lr/liferay-docker-manager), [peterrichards-lr/pulse-workspace](https://github.com/peterrichards-lr/pulse-workspace), [limaagabriel/liferay-developer-utilities](https://github.com/limaagabriel/liferay-developer-utilities), [mdelapenya/docker-liferay-portal](https://github.com/mdelapenya/docker-liferay-portal).
- Reference pages: [Sun Web Space Server guide](https://docs.oracle.com/cd/E19316-01/820-7054/girna/index.html), [Scribd copy of the 7.4 checklist](https://www.scribd.com/document/727615239/Liferay-DXP-7-4-Deployment-Checklist) (listing only).
- Security background: [breachattack.com](https://www.breachattack.com/).
