# Adaptive Media with cdn.host and an edge cache

Tested on DXP 2026.q1.12-lts on 2026-11-03. Script: `part1-simulations/adaptive-media-cdn-test.py`. Raw output for the caching checks: `adaptive-media-cdn-test.json`.

Liferay's documentation doesn't cover how Adaptive Media behaves on a CDN, so these results come from running it.

## cdn.host does not rewrite Adaptive Media URLs

A temporary container ran with `cdn.host.http=http://localhost:6081` set from startup. A blog post showed an uploaded image, and the page rendered a `<picture>` element.

| URLs in the page | On the CDN host |
|---|---|
| Theme and module assets | 15 of 16 |
| Adaptive Media (`/o/adaptive-media/image/...`) | 0 of 2 |
| Original image (`/documents/...`) | 0 of 1 |

So these images stay on the page's own host. They reach a CDN only if it proxies that host.

## An edge in front of that host does cache them

These runs used Varnish on `:6081` in front of the lab Liferay, with Documents and Media Cache Control set to public.

**Public image**

| Request | Status | Cache-Control | X-Cache |
|---|---|---|---|
| Origin, guest | 200 | `public, max-age=86400` | |
| Edge, guest, first | 200 | `public, max-age=86400` | MISS |
| Edge, guest, second | 200 | `public, max-age=86400` | HIT |

**Restricted image (owner only)**

| Request | Status | Cache-Control | X-Cache |
|---|---|---|---|
| Origin, guest | 404 | | |
| Origin, owner | 200 | `private` | |
| Edge, owner | 200 | `private` | BYPASS |
| Edge, guest, first | 404 | | MISS |
| Edge, guest, second | 404 | | HIT |

The owner's copy wasn't served to the guest. The edge did cache the 404 for guests.

## Removing permission does not remove a cached image

**Image cached at the edge, then Guest and Site Member view permission removed**

| Request | Status | X-Cache |
|---|---|---|
| Before: edge, guest, second | 200 | HIT |
| After: origin, guest | 404 | |
| After: edge, guest | **200** | **HIT** |

Liferay refuses the image, but the edge keeps serving it, and the URL doesn't change. `default.vcl` gives URLs with a `t=` timestamp a TTL of 365 days. That TTL was read from the VCL, not observed for that long.

## Not tested

- A real CDN such as Cloudflare. Varnish stood in for it.
- Cache-Control with the Documents and Media setting off.
- Whether an S5 purge would remove the image.
- Delegated adaptation, which Liferay `master` has and which does add the CDN host.

## How cdn.host has to be set

`PortalImpl` caches the CDN host in memory, and only the Instance Settings form resets that cache. Changing the preference through the API has no effect until a restart. On the lab Liferay the form returned "Your request failed to complete", and the cause wasn't found, so the rewrite check used a temporary container instead.

The form save failed and the field stayed empty afterwards. The lab has no CDN host set, and its pages were unchanged after the test.
