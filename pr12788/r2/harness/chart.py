"""Figure 1: measured lease lifetime vs claim offset (PR #12788)."""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
FG = (230, 237, 243)
MUTED = (139, 148, 158)
GRID = (48, 54, 61)
RED = (248, 81, 73)
GREEN = (63, 185, 80)
AMBER = (210, 153, 34)

MENLO = "/System/Library/Fonts/Menlo.ttc"
font = ImageFont.truetype(MENLO, 26)
small = ImageFont.truetype(MENLO, 22)
bold = ImageFont.truetype(MENLO, 30, index=1)


def load(paths, db):
    points = {}
    for path in paths:
        for line in open(path):
            p = line.split()
            if p[1] != db or p[2] not in ("binding", "dispatch"):
                continue
            kv = dict(x.split("=", 1) for x in p[3:])
            if kv["lease"] != "1000":
                continue
            points.setdefault((p[0], p[2]), []).append(
                (int(kv["offset"]), int(kv["lifetime"])))
    return points


def main(out, *paths):
    pts = load(paths, "mariadb")
    W, H = 1600, 960
    L, R, T, B = 150, 60, 140, 190
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((L, 30), "1 s lease: measured takeover delay vs. claim time, real MariaDB 10.11.18", font=bold, fill=FG)
    d.text((L, 78), "Owner A claims at a given ms of a wall-clock second; owner B retries "
           "every 5 ms until its claim succeeds.",
           font=small, fill=MUTED)
    pw, ph = W - L - R, H - T - B
    ymax = 2200

    def xy(x, y):
        return L + x / 1000 * pw, T + ph - y / ymax * ph

    for y in range(0, ymax + 1, 500):
        _, py = xy(0, y)
        d.line([(L, py), (L + pw, py)], fill=GRID, width=1)
        d.text((L - 20, py), f"{y}", font=small, fill=MUTED, anchor="rm")
    for x in range(0, 1001, 100):
        px, _ = xy(x, 0)
        d.line([(px, T + ph), (px, T + ph + 8)], fill=MUTED, width=2)
        d.text((px, T + ph + 14), f"{x}", font=small, fill=MUTED,
               anchor="ma")
    d.text((L + pw / 2, T + ph + 50), "claim offset within the second (ms)",
           font=font, fill=MUTED, anchor="ma")
    d.text((30, T + ph / 2), "ms", font=font, fill=MUTED, anchor="lm")
    d.rectangle([L, T, L + pw, T + ph], outline=GRID, width=2)
    # configured duration
    _, py = xy(0, 1000)
    for x0 in range(L, L + pw, 24):
        d.line([(x0, py), (min(x0 + 12, L + pw), py)], fill=AMBER, width=3)
    d.text((L + pw * 0.33, py - 12), "configured lease = 1000 ms",
           font=small, fill=AMBER, anchor="lb")

    styles = {("main", "binding"): (RED, "o"), ("main", "dispatch"): (RED, "x"),
              ("head", "binding"): (GREEN, "o"),
              ("head", "dispatch"): (GREEN, "x")}
    for key, (color, marker) in styles.items():
        for x, y in pts.get(key, []):
            px, py = xy(x, y)
            if marker == "o":
                d.ellipse([px - 8, py - 8, px + 8, py + 8], fill=color)
            else:
                d.line([(px - 8, py - 8), (px + 8, py + 8)], fill=color,
                       width=4)
                d.line([(px - 8, py + 8), (px + 8, py - 8)], fill=color,
                       width=4)
    # legend
    lx, ly = L + 40, T + ph - 140
    for i, (label, color, marker) in enumerate([
            ("main 8a170d7 - operation lease", RED, "o"),
            ("main 8a170d7 - dispatch lease", RED, "x"),
            ("PR 369f636 - operation lease", GREEN, "o"),
            ("PR 369f636 - dispatch lease", GREEN, "x")]):
        y = ly + i * 36
        if marker == "o":
            d.ellipse([lx - 8, y - 8, lx + 8, y + 8], fill=color)
        else:
            d.line([(lx - 8, y - 8), (lx + 8, y + 8)], fill=color, width=4)
            d.line([(lx - 8, y + 8), (lx + 8, y - 8)], fill=color, width=4)
        d.text((lx + 24, y), label, font=small, fill=FG, anchor="lm")

    base = [y for k, v in pts.items() if k[0] == "main" for _, y in v]
    head = [y for k, v in pts.items() if k[0] == "head" for _, y in v]
    d.text((L, H - 30), f"main: {min(base)}-{max(base)} ms, "
           f"{sum(y < 1000 for y in base)}/{len(base)} shorter than the lease"
           f"    PR: {min(head)}-{max(head)} ms, "
           f"{sum(y < 1000 for y in head)}/{len(head)} shorter",
           font=small, fill=FG, anchor="ls")
    img.save(out, optimize=True)


if __name__ == "__main__":
    main(*sys.argv[1:])
