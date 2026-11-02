# OIDC check: does an SSO user carry the edge bypass cookies?

The bypass rules key on `COMPANY_ID`, `ID` and friends. Reading `master` suggested an SSO login writes
none of them. This signs in through a real OIDC provider and looks. Run 2026-11-02 on DXP 2026.q1.12-lts
with S3 applied and G1. Output: `../results/oidc-check-2026-11-02/`.

## Result

| Test | Result |
|---|---|
| Cookies after an OIDC login (three logins, direct and through Varnish) | `JSESSIONID`, `COOKIE_SUPPORT`, `GUEST_LANGUAGE_ID`. No bypass cookie |
| Cookies after a password login (control) | The same plus `COMPANY_ID` and `ID` |
| SSO user at the origin, public page | Signed in: `private, no-cache, no-store, must-revalidate`, with name, email and user ID in the HTML |
| SSO user through the repo VCL, public page | Looks signed out. No `Cookie` reaches the origin |
| Guest sharing that cache object (`HIT`) | Clean guest page |
| SSO user through the repo VCL, `/group/` page | Signed in, not cached. A guest gets a 404 |
| Password user through the repo VCL (control) | `BYPASS`, signed in |
| **Model edge: SSO user, then an anonymous visitor** | **`HIT`: the visitor gets the signed-in page, with name, email, user ID and that session's `authToken`** |
| Model edge: password user, then an anonymous visitor (control) | `BYPASS`, then a clean guest page |

The model is `model-cookie-forwarding.vcl`: Varnish set up like the Cloudflare rules (same bypass list,
cookies forwarded on a miss, override TTL, `Set-Cookie` dropped). **It is not Cloudflare.** It shows the
mechanism. Whether Cloudflare does this is still from its docs, and needs a throwaway zone.

## Not shown

- SAML and token auto-login, which take the same `AutoLoginFilter` path: read from source only.
- Whether the leaked `authToken` is usable. It is bound to the user's session, and no attempt was made.
- What cookie stripping does to a member-only page under `/web/`, which may loop an SSO user back to login.
- Why the page after login returned 404 with the user signed in, direct and through Varnish. Not looked
  into; it did not change any result above.
- `/c/portal/logout` is absent from `test@liferay.com`'s page and present on the SSO user's, even with
  the Administrator role. Cause not found. Use `isSignedIn: () => true` as the signed-in marker.

## Run it

Needs the lab from `../matrix/local/`, with Liferay stopped. Secrets live in `.env`, which git ignores.

```bash
cp .env.example .env   # then set the values; LIFERAY_* is the lab's portal admin
./setup.sh             # Keycloak, the model edge, the OIDC config; waits until the login page offers it
set -a; . ./.env; set +a
NODE_PATH=<dir holding playwright> CHROME_PATH=/usr/bin/chromium OIDC_OUT=/tmp/oidc-check node browser-flow.cjs
OIDC_OUT=/tmp/oidc-check ./edge-compare.sh
```

Keycloak fills `${...}` in `realm.json` from its environment on import, and `setup.sh` fills the provider
`.config` from its template, including Keycloak's container IP.

Two traps: the enable file must set `tokenRefreshOffset`, because a missing value counts as 0 and the
listener rejects anything under 30. And `edge-compare.sh` stops with an error when the cookie files are
missing, because empty cookies would make everyone look like a guest.

The SSO user lands in the lab database. To undo it: remove both `.config` files, delete the user, re-apply
S3 with `../matrix/local/apply-stage.sh`, and remove both containers. On 2026-11-02 the database was also
restored from a backup taken before the test.
