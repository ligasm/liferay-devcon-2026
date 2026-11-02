# Demo 3: regenerate a static site from liferay.dev

Slides 22 and 23, 5 minutes in total. Fallback video: `deck/recordings/demo3-regenerate.mp4`.

The demo needs network access to liferay.dev. It runs from a copy of `part2-static-prototype`, so the committed
content isn't overwritten, and it makes no paid model calls. Run everything in one terminal.

## Before the talk

This creates the copy and clears its build state.

```bash
cd /data/git/mir333/liferay-devcon-2026
rm -rf /tmp/devcon-demo3
rsync -a --exclude '/dist*' --exclude '/content-proventeq' --exclude '/reports-proventeq' --exclude '/.env' part2-static-prototype/ /tmp/devcon-demo3/
cd /tmp/devcon-demo3
rm -rf content/raw content/build content/state.json content/plan.json content/build-info.json content/build-result.json content/ai-log.json reports/*.md
unset ANTHROPIC_API_KEY
POST=setting-up-glowroot-as-central-collector-liferay
ID=121975600
stats() { curl -sSL "$1" -o /tmp/devcon-demo3-page; echo "$(wc -c < /tmp/devcon-demo3-page) bytes, $(grep -o '<script' /tmp/devcon-demo3-page | wc -l) scripts, $(grep -c authToken /tmp/devcon-demo3-page) authToken"; }
```

## On stage

### 1. First build

```bash
node pipeline/regenerate.mjs --full --no-ai --max-items 80
```

Expect about 136 pages and 3.5 MB. It takes about 11 to 36 seconds, nearly all of it fetching. An `HTTP 500` on the
page listing is fine, because the pipeline falls back to fetching known pages one by one.

### 2. Run it again with nothing changed

```bash
node pipeline/regenerate.mjs
```

Expect `nothing changed → skip build (0 tokens)` in about 2 seconds.

### 3. Compare one post, both ways

Start the local server first. The first `stats` line is the portal, the second is the static site.

```bash
node tools/serve.mjs dist >/dev/null 2>&1 &
SERVE=$!
sleep 1
```

```bash
stats https://liferay.dev/b/$POST
stats http://localhost:4321/blog/$POST/
```

Expect about 202 kB, 35 scripts and an `authToken` from the portal, against about 23 kB, 2 scripts and no `authToken`
from the static site.

```bash
curl -sSD- -o /dev/null http://localhost:4321/blog/$POST/ | grep -iE '^(cache-control|cache-tag):'
```

Expect `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600` and
`Cache-Tag: blog,post-121975600`.

### 4. Edit one post and rerun

This edits the local mirror, because liferay.dev isn't ours to edit. On your own DXP it would be a real edit and a
webhook.

```bash
sed -i -E '0,/"headline": *"/s//&[EDITED] /' content/raw/blog/$ID.json
node pipeline/regenerate.mjs --offline --no-ai 2>&1 | grep -E "plan:|build:|done in"
```

Expect `plan: +0 ~1 -0` and `4 URLs to purge` in about 1.5 seconds. Then show which four:

```bash
sed -n '/CDN purge/,$p' "$(ls -t reports/*.md | head -1)"
```

Expect that post, the home page, the blog list and its category page.

### 5. Estimate the model cost for the whole catalogue

This makes no calls and needs no key.

```bash
node pipeline/regenerate.mjs --dry-run --full --offline 2>&1 | grep -E "plan:|orchestrated"
grep -E 'calls:' "$(ls -t reports/*.md | head -1)"
```

Expect about 14,000 tokens, 4 calls and $0.03.

### 6. Check every internal link

```bash
node tools/check-links.mjs dist
```

Expect about 4,020 links checked and 0 broken.

## Afterwards

```bash
kill $SERVE
rm -f /tmp/devcon-demo3-page
```

## If the post has left the mirror

The mirror keeps the 80 most recently modified posts, so this post can drop out as liferay.dev publishes more. If
step 3 or 4 can't find it, this picks the newest post instead. Its sizes will differ from the ones above.

```bash
ID=$(node -e "const fs=require('fs');const p=fs.readdirSync('content/raw/blog').map(f=>JSON.parse(fs.readFileSync('content/raw/blog/'+f)));p.sort((a,b)=>a.dateModified>b.dateModified?-1:1);console.log(p[0].id)")
POST=$(node -e "console.log(JSON.parse(require('fs').readFileSync('content/raw/blog/$ID.json')).friendlyUrlPath)")
echo "$ID $POST"
```
