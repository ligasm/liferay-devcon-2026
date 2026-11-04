# Demo recordings

Videos of the talk's three demos, recorded 2026-11-02, and demo 3 on 2026-11-03. They are 1920×1080 with no audio. Every
command really ran, and nothing is sped up or cut. `.cast` is the asciinema source of each video. The commands
to run each demo yourself are in `docs/demos/`.

| Video | Slide | Length | What it shows |
|---|---|---|---|
| `demo1-curl.mp4` | 8 | 0:31 | `curl` of a fresh `liferay/dxp:2026.q1.12-lts` container with no config: `no-store` and three cookies |
| `demo2-varnish.mp4` | 12 | 1:33 | `docker compose up` Varnish in front of the S3 lab, MISS then HIT, the mix through the edge, Varnish counters, p95 table, sign-in at 0 % edge hit |
| `demo3-regenerate.mp4` | 22–23 | 1:31 | First build from the lab Liferay, no-change run, one post two ways, a real edit and its purge list, both showing the new title, link check |

## Where a video differs from the live demo

- **Demo 2** runs the mix for 30 s to fit the slot. The S0 and S3 columns in its table are the committed 90 s
  campaign, and the S4 column is this run. The edge was cold at the start, and k6 was the only load.
- **Demo 3** really edits a post in the lab Liferay, and `docs/demos/demo3-regenerate.sh cleanup` puts it back. `regenerate`,
  `stats`, `change_title` and `title_of` are small shell functions defined in the script, not on camera.

## Re-recording

`src/record.sh <script> <out>` records a demo script and renders the MP4. It needs `ffmpeg`, `uv` (for asciinema) and
[`agg`](https://github.com/asciinema/agg). The header of each script in `src/` lists what it needs. Run demo 2
from a copy of `part1-simulations`, because it writes results. Run `docs/demos/demo3-regenerate.sh prepare` before demo 3.
