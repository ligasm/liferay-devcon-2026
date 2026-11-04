#!/usr/bin/env python3
"""How do Adaptive Media images behave with cdn.host and an edge cache?

Default run, against the lab with Varnish on :6081: cache headers and Varnish for a
public image, a restricted image, and an image whose permission is removed after it
was cached. Deletes its site and bans its images from Varnish afterwards.

    python3 -I adaptive-media-cdn-test.py

Rewrite check, against a Liferay started with the CDN host set. cdn.host is cached in
memory and only reset by the Instance Settings form, so set it at startup, for example
LIFERAY_CDN_PERIOD_HOST_PERIOD_HTTP on a temporary container, and point the script
at it with LIFERAY_URL, LIFERAY_USER and LIFERAY_PASSWORD:

    python3 -I adaptive-media-cdn-test.py setup
    python3 -I adaptive-media-cdn-test.py capture "cdn.host on"
    python3 -I adaptive-media-cdn-test.py teardown
"""
import importlib.util
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("leak", HERE / "fragment-leak-test.py")
leak = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leak)
admin, BASE, CONFIG, Visitor = leak.admin, leak.BASE, leak.CONFIG, leak.Visitor

EDGE = "http://127.0.0.1:6081"
CDN_HOST = "http://localhost:6081"
IMAGE = HERE.parent / "part0-base-site/assets/hero-migrate.jpg"
TAG = secrets.token_hex(3)
SITE_ERC = f"am-test-{TAG}"
SITE_PATH = f"/am-test-{TAG}"
PAGE = f"/web{SITE_PATH}/news"
BLOGS = "com_liferay_blogs_web_portlet_BlogsPortlet"


def initializer():
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("site-initializer/layouts/01-news/page.json", json.dumps({
            "friendlyURL": "/news", "hidden": False, "name": "news", "name_i18n": {"en_US": "news"},
            "private": False, "system": False, "type": "content",
        }))
        archive.writestr("site-initializer/layouts/01-news/page-definition.json", json.dumps({"pageElement": {
            "type": "Root",
            "pageElements": [{"type": "Widget", "definition": {"widgetInstance": {"widgetName": BLOGS}}}],
        }}))
    return buffer.getvalue()


def multipart(fields):
    boundary = "----am" + secrets.token_hex(8)
    parts = []
    for name, (filename, content_type, value) in fields.items():
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if filename:
            head += f'; filename="{filename}"'
        if content_type:
            head += f"\r\nContent-Type: {content_type}"
        parts.append(head.encode() + b"\r\n\r\n" + value + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def admin_multipart(method, path, fields):
    body, content_type = multipart(fields)
    request = urllib.request.Request(
        BASE + path, data=body, method=method, headers={"Content-Type": content_type, "Accept": "application/json"},
    )
    try:
        with leak.ADMIN_OPENER.open(request, timeout=180) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} failed: {error.code} {error.read().decode()[:500]}")


def upload(site_id, name, viewable_by):
    return admin_multipart("POST", f"/o/headless-delivery/v1.0/sites/{site_id}/documents", {
        "file": (name, "image/jpeg", IMAGE.read_bytes()),
        "document": (None, None, json.dumps({"title": name, "viewableBy": viewable_by}).encode()),
    })


def adapted_url(document_id):
    for _ in range(40):
        document = admin("GET", f"/o/headless-delivery/v1.0/documents/{document_id}")
        adapted = [image for image in document.get("adaptedImages", []) if image.get("contentUrl")]
        if adapted:
            preferred = next((i for i in adapted if i["resolutionName"].startswith("Preview")), adapted[0])
            return document, preferred["contentUrl"]
        time.sleep(2)
    raise SystemExit(f"No adapted images for document {document_id}")


def request(url, opener=None):
    """Status and the headers that matter, without following redirects to a login page."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    handlers = [NoRedirect()]
    if opener is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(opener.jar))
    client = urllib.request.build_opener(*handlers)
    try:
        response = client.open(url, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    body = response.read()
    headers = response.headers
    return {
        "status": response.status if hasattr(response, "status") else response.code,
        "type": headers.get("Content-Type"),
        "bytes": len(body),
        "cache_control": headers.get("Cache-Control"),
        "x_cache": headers.get("X-Cache"),
        "age": headers.get("Age"),
        "set_cookie": bool(headers.get("Set-Cookie")),
    }


def describe(label, result):
    print(
        f"  {label:44} {result['status']}  {str(result['type'])[:12]:12} {result['bytes']:>7} B  "
        f"cc={result['cache_control']}  x-cache={result['x_cache']}  age={result['age']}"
    )
    return {"check": label, **result}


def ban_test_urls():
    """Drop this test's images from Varnish, and nothing else."""
    subprocess.run(
        ["docker", "exec", "liferay-varnish", "varnishadm", "ban", "req.url", "~", f"/o/adaptive-media/image/({'|'.join(BANNED)})/"],
        check=False, capture_output=True,
    )


BANNED = []


STATE = Path(__file__).resolve().parent / ".am-test-state.json"


def create_site():
    body, content_type = multipart({
        "file": ("am.zip", "application/zip", initializer()),
        "site": (None, None, json.dumps({
            "name": f"AM test {TAG}", "friendlyUrlPath": SITE_PATH, "externalReferenceCode": SITE_ERC,
        }).encode()),
    })
    put = urllib.request.Request(
        f"{BASE}/o/headless-admin-site/v1.0/sites/{SITE_ERC}/site-initializer", data=body, method="PUT",
        headers={"Content-Type": content_type, "Accept": "application/json"},
    )
    with leak.ADMIN_OPENER.open(put, timeout=180) as response:
        return json.loads(response.read().decode())["id"]


def rewrite_setup():
    site_id = create_site()
    public, public_url = adapted_url(upload(site_id, "public.jpg", "Anyone")["id"])
    post = admin("POST", f"/o/headless-delivery/v1.0/sites/{site_id}/blog-postings", body={
        "headline": f"am-post-{TAG}",
        "articleBody": f'<p>am-post-{TAG}</p><img data-fileentryid="{public["id"]}" src="{public["contentUrl"]}" />',
        "viewableBy": "Anyone",
    })
    page = f"{PAGE}/-/blogs/{post['friendlyUrlPath']}"
    STATE.write_text(json.dumps({"site_id": site_id, "page": page, "document": public["id"], "tag": TAG}))
    print("api body kept data-fileentryid:", "data-fileentryid" in post.get("articleBody", ""))
    print("page:", page)


def rewrite_capture(label):
    state = json.loads(STATE.read_text())
    html, _ = Visitor("guest").get(state["page"])
    start = html.find(f"am-post-{state['tag']}</p>")
    print(f"--- {label}: post found={start >= 0}")
    for tag in re.findall(r"<picture\b.*?</picture>|<img\b[^>]*>", html[start:start + 3000], re.S)[:2]:
        print(re.sub(r"\s+", " ", tag)[:700])
    urls = re.findall(r"""(?:src|srcset|href)\s*=\s*["']([^"'\s]+)""", html)
    assets = [u for u in urls if re.search(r"/o/[a-z-]+.*\.(css|js)|/combo", u)]
    on_cdn = [u for u in assets if CDN_HOST in u]
    print(f"theme and module assets: {len(assets)}, on the CDN host: {len(on_cdn)}")
    print("example:", (on_cdn or assets or ["none"])[0][:110])
    adaptive = sorted({u for u in urls if "adaptive-media" in u})
    print("adaptive URLs:", adaptive[:4])
    print("original URLs:", sorted({u for u in urls if "/documents/" in u})[:3])


def rewrite_teardown():
    state = json.loads(STATE.read_text())
    admin("DELETE", f"/o/headless-site/v1.0/sites/{state['site_id']}")
    STATE.unlink()
    print("site deleted")


def main():
    results = {}
    site_id = None
    try:
        site_id = create_site()
        public, public_url = adapted_url(upload(site_id, "public.jpg", "Anyone")["id"])
        restricted, restricted_url = adapted_url(upload(site_id, "restricted.jpg", "Owner")["id"])
        revoked, revoked_url = adapted_url(upload(site_id, "revoked.jpg", "Anyone")["id"])
        BANNED.extend(str(d["id"]) for d in (public, restricted, revoked))

        print("public image")
        checks = [
            describe("origin, guest", request(BASE + public_url)),
            describe("edge, guest, 1st", request(EDGE + public_url)),
            describe("edge, guest, 2nd", request(EDGE + public_url)),
        ]

        print("\nrestricted image (Owner only; the admin is the owner)")
        owner = Visitor("admin", {"email": CONFIG["LIFERAY_USER"], "password": CONFIG["LIFERAY_PASSWORD"]})
        checks += [
            describe("origin, guest", request(BASE + restricted_url)),
            describe("origin, owner", request(BASE + restricted_url, owner)),
            describe("edge, owner", request(EDGE + restricted_url, owner)),
            describe("edge, guest, 1st", request(EDGE + restricted_url)),
            describe("edge, guest, 2nd", request(EDGE + restricted_url)),
        ]

        print("\nimage cached at the edge, then Guest permission removed")
        checks += [
            describe("before: origin, guest", request(BASE + revoked_url)),
            describe("before: edge, guest, 1st", request(EDGE + revoked_url)),
            describe("before: edge, guest, 2nd", request(EDGE + revoked_url)),
        ]
        admin("PUT", f"/o/headless-delivery/v1.0/documents/{revoked['id']}/permissions", body=[
            {"roleName": "Guest", "actionIds": []},
            {"roleName": "Site Member", "actionIds": []},
        ])
        checks += [
            describe("after: origin, guest", request(BASE + revoked_url)),
            describe("after: edge, guest", request(EDGE + revoked_url)),
        ]
        results["checks"] = checks
    finally:
        if BANNED:
            ban_test_urls()
        if site_id:
            admin("DELETE", f"/o/headless-site/v1.0/sites/{site_id}")
        print("\ncleaned up: test images banned from Varnish, site deleted")

    (HERE / "results" / "adaptive-media-cdn-test.json").write_text(json.dumps(results, indent=1) + "\n")


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "main"
    if step == "setup":
        rewrite_setup()
    elif step == "capture":
        rewrite_capture(sys.argv[2])
    elif step == "teardown":
        rewrite_teardown()
    else:
        main()
