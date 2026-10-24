"""Generate abstract backdrop art for the DevCon deck in Proventeq colours.

Outputs (2880x1620, 16:9) into ./art/ next to this script:
  trails  - long-exposure 'speed' light trails converging to the right (cover / close)
  wall    - dark block wall with a single lit seam (the 'wall' slide)
  pages   - a field of identical pre-rendered pages (Part 2 opener)
  tokens  - sparse glowing token particles on navy (the '$0.03' slide)

Each is written as .png (lossless) and .jpg (what the deck uses).
Deterministic: seed 7 reproduces the images in the deck.
Requires: numpy, pillow, scipy.   Run:  python3 gen_art.py
"""
import os, math
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

W, H = 2880, 1620
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "art")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

NAVY = np.array([15, 40, 56]) / 255.0
DEEP = np.array([8, 22, 33]) / 255.0
TEAL = np.array([52, 161, 160]) / 255.0
CYAN = np.array([46, 156, 199]) / 255.0
AMBER = np.array([234, 176, 0]) / 255.0
ORANGE = np.array([249, 141, 80]) / 255.0
PAPER = np.array([244, 247, 247]) / 255.0


def save(img, name):
    # dither to kill the 8-bit banding from the vignette
    img = img + (rng.random(img.shape) - rng.random(img.shape)) / 255.0 * 1.5
    img = np.clip(img, 0, 1)
    im = Image.fromarray((img * 255).astype(np.uint8))
    im.save(os.path.join(OUT, name), optimize=True)
    im.convert("RGB").save(os.path.join(OUT, name.replace(".png", ".jpg")),
                           quality=88, optimize=True, progressive=True)
    print("wrote", name)


def background(c_left, c_right):
    x = np.linspace(0, 1, W)[None, :, None]
    y = np.linspace(0, 1, H)[:, None, None]
    base = c_left * (1 - x) + c_right * x
    vignette = 1 - 0.35 * ((x - 0.6) ** 2 + (y - 0.55) ** 2)
    return base * vignette


def stamp_polyline(layer, xs, ys, weight):
    """Accumulate a thin polyline into a single-channel float layer."""
    for i in range(len(xs) - 1):
        x0, y0, x1, y1 = xs[i], ys[i], xs[i + 1], ys[i + 1]
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        px = np.linspace(x0, x1, n).astype(int)
        py = np.linspace(y0, y1, n).astype(int)
        ok = (px >= 0) & (px < W) & (py >= 0) & (py < H)
        np.add.at(layer, (py[ok], px[ok]), weight)


def bloom(layer):
    return (gaussian_filter(layer, 1.2) * 1.0 + gaussian_filter(layer, 6) * 0.9
            + gaussian_filter(layer, 22) * 0.7 + gaussian_filter(layer, 70) * 0.5)


def trails():
    img = background(DEEP, NAVY)
    colours = [(TEAL, 140), (CYAN, 90), (AMBER, 70), (ORANGE, 40), (PAPER, 30)]
    vx, vy = W * 1.25, H * 0.42           # vanishing point off the right edge
    for col, count in colours:
        layer = np.zeros((H, W))
        for _ in range(count):
            sx = rng.uniform(W * 0.25, W * 0.9)
            sy = rng.uniform(H * 0.55, H * 1.15)
            t = np.linspace(0, 1, 160)
            bend = rng.uniform(-120, 120)
            xs = sx + (vx - sx) * t
            ys = sy + (vy - sy) * (t ** rng.uniform(0.7, 1.4)) + bend * np.sin(t * math.pi)
            stamp_polyline(layer, xs, ys, rng.uniform(0.25, 0.9))
        x = np.linspace(0, 1, W)[None, :]
        fade = np.clip((x - 0.18) / 0.35, 0, 1) ** 1.6   # keep the title area dark
        glow = bloom(layer * fade)
        img += glow[:, :, None] * col[None, None, :] * 0.9
    save(img, "trails.png")


def wall():
    noise = np.zeros((H, W))
    for octave, amp in [(160, 0.5), (60, 0.25), (20, 0.15), (5, 0.1)]:
        n = rng.standard_normal((H // octave + 2, W // octave + 2))
        n = np.kron(n, np.ones((octave, octave)))[:H, :W]
        noise += gaussian_filter(n, octave / 2) * amp
    noise = (noise - noise.min()) / (noise.max() - noise.min())
    img = DEEP[None, None, :] * (0.75 + 0.5 * noise[:, :, None]) + NAVY * 0.25
    bh, bw = 270, 540
    mortar = np.zeros((H, W))
    for r in range(H // bh + 1):
        y = r * bh
        mortar[max(0, y - 3):y + 3, :] = 1
        off = (bw // 2) * (r % 2)
        for c in range(-1, W // bw + 2):
            x = c * bw + off
            if 0 <= x < W:
                mortar[y:min(H, y + bh), max(0, x - 3):x + 3] = 1
    tone = np.ones((H, W))
    hi = np.zeros((H, W))
    for r in range(H // bh + 1):
        off = (bw // 2) * (r % 2)
        for c in range(-1, W // bw + 2):
            x0, y0 = c * bw + off, r * bh
            xs0, xe0, ys0, ye0 = max(0, x0), min(W, x0 + bw), max(0, y0), min(H, y0 + bh)
            if xs0 < xe0 and ys0 < ye0:
                tone[ys0:ye0, xs0:xe0] = rng.uniform(0.82, 1.18)
                hi[ys0 + 4:ys0 + 10, xs0:xe0] = 1
    img *= tone[:, :, None]
    img += gaussian_filter(hi, 2)[:, :, None] * 0.05
    img *= (1 - 0.6 * gaussian_filter(mortar, 1.5))[:, :, None]
    seam = np.zeros((H, W))
    xs = np.linspace(W * 0.62, W * 0.70, 400) + gaussian_filter(np.cumsum(rng.normal(0, 4, 400)), 3)
    ys = np.linspace(-20, H + 20, 400)
    stamp_polyline(seam, xs, ys, 1.0)
    img += bloom(seam)[:, :, None] * TEAL[None, None, :] * 0.45
    save(img, "wall.png")


def pages():
    img = background(np.array([30, 120, 119]) / 255, TEAL * 0.95)
    layer_fill = np.zeros((H, W))
    layer_line = np.zeros((H, W))
    pw, ph, gap = 150, 200, 46
    for r in range(-1, H // (ph + gap) + 2):
        for c in range(-1, W // (pw + gap) + 2):
            x0 = c * (pw + gap) + (r % 2) * (pw + gap) // 2
            y0 = r * (ph + gap) + 30
            if x0 < W * 0.42:
                continue
            a = min(1.0, (x0 - W * 0.42) / (W * 0.25))
            ys, ye, xs_, xe = max(0, y0), min(H, y0 + ph), max(0, x0), min(W, x0 + pw)
            if ys >= ye or xs_ >= xe:
                continue
            layer_fill[ys:ye, xs_:xe] += 0.13 * a
            for k in range(6):
                ly = y0 + 34 + k * 24
                if 0 <= ly < H:
                    lw = pw - 40 - (30 if k == 5 else 0)
                    layer_line[ly:ly + 6, max(0, x0 + 20):min(W, x0 + 20 + lw)] += 0.35 * a
            hy = y0 + 14
            if 0 <= hy < H:
                layer_line[hy:hy + 10, max(0, x0 + 20):min(W, x0 + 90)] += 0.6 * a
    img = img * (1 - layer_fill[:, :, None]) + PAPER[None, None, :] * layer_fill[:, :, None] * 1.2
    img += gaussian_filter(layer_line, 0.8)[:, :, None] * (PAPER - img) * 0.9
    save(img, "pages.png")


def tokens():
    img = background(DEEP, NAVY)
    layer = np.zeros((H, W))
    gold = np.zeros((H, W))
    step = 64
    for r in range(H // step + 2):
        for c in range(W // step + 2):
            x = c * step + (r % 2) * step // 2
            y = r * step
            if x >= W or y >= H or x < W * 0.45:
                continue
            fade = min(1.0, (x - W * 0.45) / (W * 0.3))
            if rng.random() < 0.018:
                gold[max(0, y - 2):y + 3, max(0, x - 2):x + 3] += 4 * fade
            else:
                layer[y, x] += 1.2 * fade
    img += gaussian_filter(layer, 2.2)[:, :, None] * TEAL[None, None, :] * 14
    img += bloom(gold)[:, :, None] * AMBER[None, None, :] * 0.9
    save(img, "tokens.png")


if __name__ == "__main__":
    trails()
    wall()
    pages()
    tokens()
