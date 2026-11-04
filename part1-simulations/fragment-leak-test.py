#!/usr/bin/env python3
"""Does a fragment marked Cacheable show one user's data to another?

Builds a throwaway site with two fragments that print the current user: one
Cacheable, one not, as a control on the same page. Two test users and a guest
then open the page in a set order, each with their own session. Deletes the site
and the users afterwards.

    python3 -I fragment-leak-test.py [--keep]

Reads the lab admin login from part2-static-prototype/.env.local-proventeq.
"""
import http.cookiejar
import io
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / "part2-static-prototype/.env.local-proventeq"
LOGIN_NS = "_com_liferay_login_web_portlet_LoginPortlet_"
SITE_PATH = "/leak-test"
VERIFY_KEY = "company.security.strangers.verify"
TAG = secrets.token_hex(3)


def read_env():
    env = {}
    for line in ENV.read_text().splitlines():
        match = re.match(r"([A-Z_]+)=(.*)", line)
        if match:
            env[match.group(1)] = match.group(2).strip()
    return env


CONFIG = read_env()
for key in ("LIFERAY_URL", "LIFERAY_USER", "LIFERAY_PASSWORD"):
    # Point the tests at another Liferay, for example a temporary container.
    CONFIG[key] = os.environ.get(key, CONFIG[key])
BASE = CONFIG["LIFERAY_URL"]
ADMIN = urllib.request.HTTPPasswordMgrWithPriorAuth()
ADMIN.add_password(None, BASE, CONFIG["LIFERAY_USER"], CONFIG["LIFERAY_PASSWORD"], is_authenticated=True)
ADMIN_OPENER = urllib.request.build_opener(urllib.request.HTTPBasicAuthHandler(ADMIN))


def admin(method, path, body=None, form=None):
    data, headers = None, {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with ADMIN_OPENER.open(request, timeout=60) as response:
            text = response.read().decode()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} failed: {error.code} {error.read().decode()[:600]}")
    result = json.loads(text) if text.strip() else None
    if isinstance(result, dict) and "exception" in result:
        raise SystemExit(f"{method} {path} failed: {text[:600]}")
    return result


def probe_html(label):
    return (
        "<div>[#assign u = themeDisplay.getUser()]"
        f"PROBE-{label}|${{u.getFullName()}}|${{u.getEmailAddress()}}|${{themeDisplay.isSignedIn()?c}}|END"
        "</div>"
    )


def initializer_zip(slugs):
    """Two fragments and the pages that hold them, as a site initializer."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        def put(path, content):
            text = content if isinstance(content, str) else json.dumps(content)
            archive.writestr(f"site-initializer/{path}", text)

        group = "fragments/group/leak-probes"
        put(f"{group}/collection.json", {"name": "Leak probes", "description": ""})
        for key, label, cacheable in (("leak-cached", "CACHED", True), ("leak-uncached", "UNCACHED", False)):
            put(f"{group}/{key}/fragment.json", {
                "cacheable": cacheable,
                "configurationPath": "configuration.json",
                "cssPath": "index.css",
                "htmlPath": "index.html",
                "jsPath": "index.js",
                "name": key,
                "type": "component",
            })
            put(f"{group}/{key}/index.html", probe_html(label))
            put(f"{group}/{key}/index.css", "")
            put(f"{group}/{key}/index.js", "")
            put(f"{group}/{key}/configuration.json", {"fieldSets": []})
        for number, slug in enumerate(slugs, 1):
            put(f"layouts/{number:02d}-{slug}/page.json", {
                "friendlyURL": f"/{slug}",
                "hidden": False,
                "name": slug,
                "name_i18n": {"en_US": slug},
                "private": False,
                "system": False,
                "type": "content",
            })
            put(f"layouts/{number:02d}-{slug}/page-definition.json", {"pageElement": {"type": "Root", "pageElements": [
                {"type": "Fragment", "definition": {
                    "fragment": {"key": key}, "fragmentConfig": {}, "fragmentFields": [], "fragmentViewports": [],
                }} for key in ("leak-cached", "leak-uncached")
            ]}})
    return buffer.getvalue()


def create_site(erc, slugs):
    boundary = "----leak" + secrets.token_hex(8)
    site = json.dumps({"name": f"Leak test {TAG}", "friendlyUrlPath": SITE_PATH, "externalReferenceCode": erc})
    body = b"".join([
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="leak.zip"\r\n'
        "Content-Type: application/zip\r\n\r\n".encode(),
        initializer_zip(slugs),
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="site"\r\n\r\n{site}\r\n--{boundary}--\r\n'.encode(),
    ])
    request = urllib.request.Request(
        f"{BASE}/o/headless-admin-site/v1.0/sites/{erc}/site-initializer", data=body, method="PUT",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
    )
    try:
        with ADMIN_OPENER.open(request, timeout=180) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"site initializer failed: {error.code} {error.read().decode()[:600]}")


def fragment_flags(site_id):
    flags = {}
    for collection in admin("GET", f"/api/jsonws/fragment.fragmentcollection/get-fragment-collections/group-id/{site_id}"):
        for entry in admin("GET", f"/api/jsonws/fragment.fragmententry/get-fragment-entries/fragment-collection-id/{collection['fragmentCollectionId']}"):
            flags[entry["fragmentEntryKey"]] = entry["cacheable"]
    return flags


def add_user(first, password):
    email = f"leak-{first.lower()}-{TAG}@example.com"
    user = admin("POST", "/o/headless-admin-user/v1.0/user-accounts", body={
        "alternateName": f"leak-{first.lower()}-{TAG}",
        "emailAddress": email,
        "givenName": first,
        "familyName": "Probe",
        "password": password,
    })
    user_id = user["id"]
    admin("POST", "/api/jsonws/user/update-agreed-to-terms-of-use", form={"userId": user_id, "agreedToTermsOfUse": "true"})
    admin("POST", "/api/jsonws/user/update-reminder-query", form={"userId": user_id, "question": "colour", "answer": "teal"})
    return {"id": user_id, "email": email, "password": password, "name": f"{first} Probe"}


class Visitor:
    """One browser: its own cookies, signed in or not."""

    def __init__(self, name, user=None):
        self.name = name
        self.user = user
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        if user:
            self.sign_in()

    def get(self, path):
        with self.opener.open(BASE + path, timeout=60) as response:
            self.last_url = response.geturl()
            return response.read().decode(errors="replace"), response.status

    def sign_in(self):
        html, _ = self.get("/c/portal/login")
        form = next(
            (f for f in re.findall(r"<form\b[^>]*>.*?</form>", html, re.S) if f"{LOGIN_NS}password" in f),
            None,
        )
        if form is None:
            raise SystemExit("No login form found")
        action = re.search(r'action="([^"]+)"', form).group(1).replace("&amp;", "&")
        fields = {}
        for tag in re.findall(r"<input\b[^>]*>", form):
            name = re.search(r'name="([^"]+)"', tag)
            value = re.search(r'value="([^"]*)"', tag)
            if name and 'type="hidden"' in tag:
                fields[name.group(1)] = value.group(1) if value else ""
        fields[f"{LOGIN_NS}login"] = self.user["email"]
        fields[f"{LOGIN_NS}password"] = self.user["password"]
        request = urllib.request.Request(
            urllib.parse.urljoin(BASE, action), data=urllib.parse.urlencode(fields).encode(), method="POST",
        )
        with self.opener.open(request, timeout=60):
            pass
        if "COMPANY_ID" not in {cookie.name for cookie in self.jar}:
            raise SystemExit(f"Sign-in failed for {self.name}")
        self.finish_password_change()

    def post_form(self, html, extra=None):
        form = re.search(r"<form\b[^>]*action=['\"]([^'\"]+)['\"][^>]*>(.*?)</form>", html, re.S)
        fields = {}
        for tag in re.findall(r"<input\b[^>]*>", form.group(2)):
            name = re.search(r'name="([^"]+)"', tag)
            value = re.search(r'value="([^"]*)"', tag)
            if name and 'type="hidden"' in tag:
                fields[name.group(1)] = (value.group(1) if value else "").replace("&amp;", "&")
        fields.update(extra or {})
        url = urllib.parse.urljoin(BASE, form.group(1).replace("&amp;", "&"))
        request = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST")
        with self.opener.open(request, timeout=60) as response:
            self.last_url = response.geturl()
            return response.read().decode(errors="replace")

    def finish_password_change(self):
        """New users must change their password on first sign-in, as in a browser."""
        html, _ = self.get("/web/guest")
        if "update_password" not in self.last_url:
            return
        form_page = self.post_form(html)
        new_password = "Lk-" + secrets.token_urlsafe(14)
        self.post_form(form_page, {"password1": new_password, "password2": new_password})
        self.user["password"] = new_password
        html, _ = self.get("/web/guest")
        if "update_password" in self.last_url:
            raise SystemExit(f"Password change failed for {self.name}")

    def probes(self, page):
        html, status = self.get(page)
        found = dict(re.findall(r"PROBE-(CACHED|UNCACHED)\|([^|]*\|[^|]*\|[^|]*)\|END", html))
        if not found:
            title = re.search(r"<title>([^<]*)", html)
            forms = re.findall(r'id="([^"]*fm[^"]*)"', html)[:3]
            print(f"  {self.name}: no probes. url={self.last_url[:60]} title={title.group(1) if title else ''} forms={forms} len={len(html)}")
        return {
            "status": status,
            "cached": found.get("CACHED", "<not rendered>"),
            "uncached": found.get("UNCACHED", "<not rendered>"),
        }


def set_email_verification(company_id, required):
    """The instance requires verified emails and the lab has no mail server.

    Turned off for the test. Turning it back on removes the override, which leaves the
    portal default of true.
    """
    if required:
        admin("POST", "/api/jsonws/company/remove-preferences", form={
            "companyId": company_id, "keys": json.dumps([VERIFY_KEY]),
        })
    else:
        admin("POST", "/api/jsonws/company/update-preferences", form={
            "companyId": company_id, "unicodeProperties": json.dumps({VERIFY_KEY: "false"}),
        })


def remove_leftover_users():
    accounts = admin("GET", "/o/headless-admin-user/v1.0/user-accounts?fields=id,emailAddress&pageSize=100")["items"]
    for account in accounts:
        if re.fullmatch(r"leak-(alice|bob)-[0-9a-f]{6}@example\.com", account["emailAddress"]):
            admin("DELETE", f"/o/headless-admin-user/v1.0/user-accounts/{account['id']}")
            print(f"removed leftover test user {account['emailAddress']}")


def cleanup(site_id, users):
    for user in users:
        admin("DELETE", f"/o/headless-admin-user/v1.0/user-accounts/{user['id']}")
    if site_id:
        admin("DELETE", f"/o/headless-site/v1.0/sites/{site_id}")


def main():
    site_id, users, company_id = None, [], None
    results = []
    remove_leftover_users()
    try:
        slugs = ("order-alice-first", "order-bob-first", "order-guest-first")
        site_id = create_site(f"leak-test-{TAG}", slugs)["id"]
        flags = fragment_flags(site_id)
        print(f"flags: {flags}")
        if flags != {"leak-cached": True, "leak-uncached": False}:
            raise SystemExit("The fragments do not have the expected Cacheable flags")

        for first in ("Alice", "Bob"):
            users.append(add_user(first, "Lk-" + secrets.token_urlsafe(14)))
        company_id = admin("GET", f"/api/jsonws/group/get-group/group-id/{site_id}")["companyId"]
        set_email_verification(company_id, False)
        alice, bob, guest = Visitor("Alice", users[0]), Visitor("Bob", users[1]), Visitor("guest")

        orders = {
            "order-alice-first": [alice, bob, guest, alice, bob],
            "order-bob-first": [bob, alice, guest, bob, alice],
            "order-guest-first": [guest, alice, bob, guest],
        }
        for slug, visitors in orders.items():
            print(f"\n{slug}")
            for visitor in visitors:
                probe = visitor.probes(f"/web{SITE_PATH}/{slug}")
                results.append({"page": slug, "visitor": visitor.name, **probe})
                print(f"  {visitor.name:6} {probe['status']}  CACHEABLE: {probe['cached']:58}  NOT CACHEABLE: {probe['uncached']}")
    finally:
        if company_id:
            set_email_verification(company_id, True)
            page, _ = Visitor("restore check", users[0]).get("/web/guest")
            title = re.search(r"<title>([^<]*)", page).group(1)
            print(f"\nemail verification restored: {'Verify Email Address' in title}")
        if "--keep" not in sys.argv:
            cleanup(site_id, users)
            print("\ncleaned up: site and users deleted")
    (Path(sys.argv[0]).resolve().parent / "results" / "fragment-leak-test.json").write_text(
        json.dumps(results, indent=1) + "\n"
    )


if __name__ == "__main__":
    main()
