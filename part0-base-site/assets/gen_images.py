"""Generate the abstract images the base site uploads to Documents & Media.

Original work in the Proventeq palette (same family as deck/art/gen_art.py).
Deterministic (seed 11). Writes 1600x900 JPEGs next to this script:
  hero-migrate, hero-govern, hero-ai, hero-portal, split-team, split-data,
  split-cloud, split-liferay
Requires: numpy, pillow.   Run:  python3 gen_images.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1600, 900
OUT = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(11)

NAVY = (22, 71, 92)
DEEP = (9, 30, 42)
TEAL = (52, 161, 160)
CYAN = (46, 156, 199)
BLUE = (9, 98, 133)
ORANGE = (249, 141, 80)
AMBER = (234, 176, 0)
LIME = (177, 235, 70)
PAPER = (240, 246, 247)


def gradient(c1, c2, angle=0.35):
    y, x = np.mgrid[0:H, 0:W]
    t = (x / W) * np.cos(angle) + (y / H) * np.sin(angle)
    t = (t - t.min()) / (t.max() - t.min())
    a, b = np.array(c1, float), np.array(c2, float)
    return (a[None, None] * (1 - t[..., None]) + b[None, None] * t[..., None])


def blobs(img, colours, n=5, blur=140, alpha=0.55):
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    mask = Image.new("L", (W, H), 0)
    d, m = ImageDraw.Draw(layer), ImageDraw.Draw(mask)
    for i in range(n):
        r = int(rng.uniform(160, 380))
        cx, cy = rng.uniform(0, W), rng.uniform(0, H)
        col = colours[i % len(colours)]
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
        m.ellipse([cx - r, cy - r, cx + r, cy + r], fill=int(255 * alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return Image.composite(layer, img, mask)


def grid(img, colour, step=64, width=1, alpha=40):
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=colour + (alpha,), width=width)
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=colour + (alpha,), width=width)
    return Image.alpha_composite(img.convert("RGBA"), over).convert("RGB")


def arcs(img, colour, n=7, alpha=90):
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    cx, cy = W * rng.uniform(0.65, 0.95), H * rng.uniform(0.2, 0.8)
    for i in range(n):
        r = 120 + i * 95
        d.arc([cx - r, cy - r, cx + r, cy + r], start=rng.uniform(120, 200),
              end=rng.uniform(300, 420), fill=colour + (alpha - i * 8,), width=3)
    return Image.alpha_composite(img.convert("RGBA"), over).convert("RGB")


def nodes(img, colour, n=26, alpha=150):
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    pts = [(rng.uniform(W * 0.35, W), rng.uniform(0, H)) for _ in range(n)]
    for i, p in enumerate(pts):
        for q in pts[i + 1:]:
            if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 260 ** 2:
                d.line([p, q], fill=colour + (alpha // 3,), width=2)
    for p in pts:
        r = rng.uniform(4, 9)
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=colour + (alpha,))
    return Image.alpha_composite(img.convert("RGBA"), over).convert("RGB")


def blocks(img, colours, n=14):
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    for i in range(n):
        w, h = rng.uniform(120, 340), rng.uniform(70, 200)
        x, y = rng.uniform(W * 0.3, W - w), rng.uniform(0, H - h)
        col = colours[i % len(colours)]
        d.rounded_rectangle([x, y, x + w, y + h], radius=18,
                            fill=col + (int(rng.uniform(40, 120)),))
    return Image.alpha_composite(img.convert("RGBA"), over).convert("RGB")


def base(c1, c2):
    return Image.fromarray(gradient(c1, c2).astype(np.uint8))


def save(img, name):
    img.save(os.path.join(OUT, name + ".jpg"), quality=84, optimize=True, progressive=True)
    print("wrote", name + ".jpg")


save(arcs(grid(blobs(base(DEEP, NAVY), [TEAL, CYAN, BLUE]), (255, 255, 255)), TEAL), "hero-migrate")
save(nodes(blobs(base(DEEP, BLUE), [TEAL, LIME, CYAN], n=4), (177, 235, 70)), "hero-govern")
save(arcs(blobs(base(NAVY, DEEP), [ORANGE, AMBER, TEAL], n=6, alpha=0.45), ORANGE, n=9), "hero-ai")
save(blocks(grid(blobs(base(DEEP, NAVY), [CYAN, TEAL]), (255, 255, 255), step=80), [TEAL, CYAN, ORANGE]), "hero-portal")
save(blobs(base(PAPER, (214, 236, 236)), [TEAL, CYAN, ORANGE], n=6, alpha=0.35), "split-team")
save(nodes(grid(base(PAPER, (220, 234, 240)), NAVY, alpha=22), BLUE, n=30), "split-data")
save(arcs(blobs(base((230, 243, 246), PAPER), [CYAN, TEAL], n=4, alpha=0.4), BLUE, alpha=120), "split-cloud")
save(blocks(blobs(base(PAPER, (226, 240, 236)), [TEAL, AMBER], n=4, alpha=0.3), [TEAL, BLUE, ORANGE, CYAN], n=18), "split-liferay")


# A ~100 KB, three-page PDF for the Documents & Media download scenario
# (k6/dl-download.js; Liferay's benchmark quotes a 100 KB document).
def brochure():
    from PIL import ImageFont
    try:
        head = ImageFont.truetype("DejaVuSans-Bold.ttf", 64)
        body = ImageFont.truetype("DejaVuSans.ttf", 30)
    except OSError:
        head = body = ImageFont.load_default()
    pages = []
    for i, (bg, title, lines) in enumerate([
        ("hero-migrate", "Proventeq365", ["Migration, governance, storage optimisation", "and Copilot readiness for Microsoft 365."]),
        ("split-data", "Migrate & modernise", ["20+ source systems: Documentum, FileNet, OpenText,", "iManage, Alfresco, Box, file shares and more."]),
        ("split-liferay", "Digital experience", ["Liferay portals, Liferay on Azure, client portals", "and CMS modernisation."]),
    ]):
        im = Image.open(os.path.join(OUT, bg + ".jpg")).convert("RGB").resize((1240, 698))
        page = Image.new("RGB", (1240, 1754), PAPER)
        page.paste(im, (0, 0))
        d = ImageDraw.Draw(page)
        d.text((80, 780), title, font=head, fill=NAVY)
        for n, line in enumerate(lines):
            d.text((80, 900 + n * 48), line, font=body, fill=(60, 80, 90))
        d.text((80, 1650), f"proventeq  |  local performance-test replica  |  page {i + 1}/3", font=body, fill=TEAL)
        pages.append(page)
    path = os.path.join(OUT, "proventeq365-brochure.pdf")
    pages[0].save(path, save_all=True, append_images=pages[1:], resolution=150, quality=55)
    print("wrote proventeq365-brochure.pdf", os.path.getsize(path) // 1024, "KB")


brochure()
