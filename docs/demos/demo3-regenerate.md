# Demo 3: generate a static site from local Liferay and change a post

Slides 22 and 23, 5 minutes in total. Video to play: `deck/recordings/demo3-regenerate.mp4`.

To run these commands from a script, one Enter at a time: `docs/demos/demo3-regenerate.sh prepare`, then
`docs/demos/demo3-regenerate.sh`. Each rehearsal needs a new `prepare`, because the demo starts from a clean build.

The demo uses the lab Liferay on `:8086` and the static site on `:8091`. It needs no network and makes no model calls.
It really changes a post in the lab Liferay, so finish with `restore`.

## Show what was built

Open both versions of the post side by side. They should look the same:

- Liferay: http://localhost:8086/web/proventeq/blog/-/blogs/copilot-readiness-five-checks
- Static: http://localhost:8091/web/proventeq/blog/-/blogs/copilot-readiness-five-checks

## Make a live change

This retitles the post in Liferay and regenerates the site. Refresh both pages to see it. Run it as often as you like.

```bash
docs/demos/demo3-regenerate.sh change "Your new title"
docs/demos/demo3-regenerate.sh restore
```

Expect about 9 seconds and 7 URLs to purge. Only a post's own page, its neighbours, its list page, its tag pages and
the search page change.

## The commands in the demo

The script defines the short functions used here: `regenerate`, `stats`, `change_title` and `title_of`.

### 1. First build

```bash
regenerate --full
```

Expect 76 pages in about 13 seconds.

### 2. Run it again with nothing changed

```bash
regenerate
```

Expect `plan: +0 ~0 -0` and `nothing changed, build skipped` in about 3 seconds. Nothing is built, and no model is called.

### 3. Compare one post, both ways

```bash
stats $PORTAL
stats $STATIC
```

### 4. Change the post in Liferay, then regenerate

```bash
change_title "Six checks to run before switching on Microsoft 365 Copilot"
regenerate
cat $WORK/reports/purge.txt
```

Expect `plan: +0 ~1 -0`, about 9 seconds and 7 URLs.

### 5. Both now show the new title

```bash
title_of $PORTAL
title_of $STATIC
```

### 6. Check every internal link

```bash
node tools/check-links.mjs dist-fidelity
```

Expect 76 pages, about 2,043 links checked and 0 broken.

## Afterwards

```bash
docs/demos/demo3-regenerate.sh cleanup
```
