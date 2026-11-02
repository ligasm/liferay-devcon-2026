#!/usr/bin/env python3
"""Print who a saved Liferay page says the visitor is. Reads the ThemeDisplay block of 2026.q1.12."""
import re
import sys

b = open(sys.argv[1], errors="replace").read()


def get(key):
    found = re.findall(key + r":\s*\(\)\s*=>\s*'?([^',\n]*)", b)
    return found[0].encode().decode("unicode_escape") if found else "?"


print(
    f"bytes={len(b)} signedIn={get('isSignedIn')} userId={get('getUserId')} "
    f"name={get('getUserName')!r} email={get('getUserEmailAddress')!r} "
    f"logoutLink={b.count('/c/portal/logout')}"
)
