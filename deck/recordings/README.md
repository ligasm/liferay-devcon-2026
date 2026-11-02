# Demo recordings

Fallback videos for the talk's three demos, recorded 2026-11-02. They are 1920×1080 with no audio. Every
command really ran, and nothing is sped up or cut. `.cast` is the asciinema source of each video. The commands
to run each demo yourself are in `docs/demos/`.

| Video | Slide | Length | What it shows |
|---|---|---|---|
| `demo1-curl.mp4` | 5 | 0:31 | `curl` of a fresh `liferay/dxp:2026.q1.12-lts` container with no config: `no-store` and three cookies |
| `demo2-varnish.mp4` | 12 | 1:33 | `docker compose up` Varnish in front of the S3 lab, MISS then HIT, the mix through the edge, Varnish counters, p95 table, sign-in at 0 % edge hit |
| `demo3-regenerate.mp4` | 22–23 | 2:14 | First build from liferay.dev, no-change run, one post two ways, one edit and its purge list, AI dry run, link check |

## Where a video differs from the live demo

- **Demo 2** runs the mix for 30 s to fit the slot. The S0 and S3 columns in its table are the committed 90 s
  campaign, and the S4 column is this run. The edge was cold at the start, and k6 was the only load.
- **Demo 3** edits the post in the local mirror with `--offline`, because liferay.dev isn't ours to edit. On your
  own DXP this would be a real edit and a webhook. `stats` is a small shell function defined in the script, not on
  camera. It prints bytes, `<script` tags and whether `authToken` appears.

## Re-recording

`src/record.sh <script> <out>` records a demo script and renders the MP4. It needs `ffmpeg`, `uv` (for asciinema) and
[`agg`](https://github.com/asciinema/agg). The header of each script in `src/` lists what it needs. Run demos 2 and 3
from copies of `part1-simulations` and `part2-static-prototype`, because they write results, state and content.
