# Demo 3: generate a static site from local Liferay and change a post

Slides 22 and 23, 5 minutes in total. Video to play: `deck/recordings/demo3-regenerate.mp4`.

To run the demo live, in stages: `docs/demos/demo3-regenerate.sh`. Press Enter to start each stage:

1. **Prepare:** start Liferay and the static site, and clear the last build. If Liferay is stopped this can take
   minutes, so run `docs/demos/demo3-regenerate.sh prepare` before the talk as well.
2. **First generation:** all 76 pages.
3. **Generate again:** nothing changed, so nothing is built. Then one post, both ways.
4. **Change the post:** the script retitles it, then waits while you make your own changes in Liferay.
5. **Generate again:** shows the pages to purge. You can then repeat: Enter generates again, `f` rebuilds everything,
   `q` runs the link check and finishes.

Generating picks up edits to published blog posts, web content, documents and pages. Use `f` for anything else:
fragment templates, the theme, menus, or something you deleted.

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

This puts back the post's title only, so undo any other changes you made in Liferay yourself.
