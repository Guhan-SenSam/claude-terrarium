"""Draws thinking-weather's pixel art: 320x180, flat tones, every layer as SVG path runs.

The desktop app strips embedded images from a backdrop SVG, so each colour becomes one
<path> whose 1px-wide strokes cover that colour's horizontal pixel runs.
Writes hooks/art.ts into the mod folder in argv[1] and preview PNGs into argv[2]:

    python3 tools/gen_art.py . /tmp/weather-preview   (needs numpy and pillow)
"""
import math, random, sys
from pathlib import Path

import numpy as np
from PIL import Image

W, H = 320, 180
MOD = Path(sys.argv[1])
PREV = Path(sys.argv[2])
rng = random.Random(11)
HORIZON = 150  # where the near fields start


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Layer:
    """Indexed canvas: -1 transparent, otherwise a palette index."""

    def __init__(self, pal, w=W, h=H):
        self.pal, self.w, self.h = pal, w, h
        self.a = np.full((h, w), -1, int)

    def put(self, x, y, i):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = i

    def svg(self):
        out = []
        for ci, col in enumerate(self.pal):
            parts = []
            for y in range(self.h):
                row = self.a[y] == ci
                if not row.any():
                    continue
                x, pen = 0, None
                while x < self.w:
                    if row[x]:
                        s = x
                        while x < self.w and row[x]:
                            x += 1
                        n = x - s
                        if pen is None:
                            parts.append(f'M{s} {y}.5h{n}')
                        else:
                            parts.append(f'm{s - pen} 0h{n}')
                        pen = x
                    else:
                        x += 1
            if parts:
                out.append(f'<path stroke="{col}" d="{"".join(parts)}"/>')
        return ''.join(out)

    def rgba(self):
        img = np.zeros((self.h, self.w, 4), np.uint8)
        cols = np.array([hexrgb(c) for c in self.pal], np.uint8)
        m = self.a >= 0
        img[m, :3] = cols[self.a[m]]
        img[m, 3] = 255
        return img


def puffs(layer, items, light=(-0.55, -0.8, 0.45), ambient=0.15, wrap=False, bands=None):
    """Z-buffered sphere puffs, shaded each on its own and cut into flat tone bands."""
    lx, ly, lz = light
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / ln, ly / ln, lz / ln
    h, w = layer.h, layer.w
    zbuf = np.full((h, w), -1e9)
    shade = np.zeros((h, w))
    ys, xs = np.indices((h, w))
    for item in items:
        cx, cy, r, cz = item[:4]
        base = item[4] if len(item) > 4 else 1e9      # flat cloud base: nothing below it
        squash = item[5] if len(item) > 5 else 1.25   # >1 flattens the puff
        ph = item[6] if len(item) > 6 else 0.0
        for off in ([0, -w, w] if wrap else [0]):
            dx = xs - (cx + off)
            dy = (ys - cy) * squash
            d2 = dx * dx + dy * dy
            # lumpy outline: the radius wobbles with the angle, so no puff is a clean circle
            th = np.arctan2(dy, dx)
            rr = r * (1 + 0.13 * np.sin(5 * th + ph) + 0.07 * np.sin(9 * th + 2 * ph))
            inside = (d2 < rr * rr) & (ys < base)
            if not inside.any():
                continue
            nz = np.sqrt(np.clip(rr * rr - d2, 0, None))
            z = cz + nz
            front = inside & (z > zbuf)
            lam = np.clip((dx / rr) * lx + (dy / rr) * ly + (nz / rr) * lz, 0, 1)
            under = np.clip(dy / r, 0, 1) * 0.45
            # the underside darkens toward the flat base
            near_base = np.clip(1 - (base - ys) / 6.0, 0, 1) * 0.35 if base < 1e8 else 0
            s = np.clip(ambient + lam ** 1.3 * (1 - ambient) - under - near_base, 0, 0.999)
            zbuf = np.where(front, z, zbuf)
            shade = np.where(front, s, shade)
    n = len(layer.pal)
    edges = bands or [i / n for i in range(1, n)]
    idx = np.digitize(shade, edges)
    m = zbuf > -1e8
    layer.a[m] = idx[m]


def mound(cx, base_y, width, height, count, rmin, rmax):
    out = []
    for _ in range(count):
        t = rng.uniform(-1, 1)
        x = cx + t * width / 2
        top = base_y - height * (1 - t * t) ** 0.8
        y = rng.uniform(top, base_y)
        r = rng.uniform(rmin, rmax) * (0.6 + 0.4 * (1 - abs(t)))
        out.append((x, y, r, (y - top) * 0.9 + rng.uniform(-3, 3)))
    return out


def cumulus(cx, base, width, towers, rscale=1.0, zoff=0.0):
    """A cumulus: a flat base, billowing towers and a cauliflower edge of small puffs.

    towers: [(dx, height, spread)] bumps that make the top outline.
    """
    def top(x):
        t = (x - cx) / (width / 2)
        if abs(t) >= 1:
            return base
        env = max(h * math.exp(-((x - cx - dx) / s) ** 2) for dx, h, s in towers)
        return base - env * (1 - t ** 4)

    out = []
    # body: big soft puffs behind, filling the mass
    for _ in range(int(width * 0.7)):
        x = cx + rng.uniform(-0.45, 0.45) * width
        t = top(x)
        if base - t < 4:
            continue
        r = rng.uniform(7, 13) * rscale
        y = rng.uniform(t + r * 0.6, base + 2)
        out.append((x, y, r, zoff + (y - t) * 0.5, base, 1.15, rng.uniform(0, 6.3)))
    # cauliflower rim: small puffs hugging the top outline, smaller higher up
    x = cx - width / 2 + 3
    while x < cx + width / 2 - 3:
        t = top(x)
        hgt = base - t
        if hgt > 3:
            r = (2.2 + 4.5 * (1 - min(1, hgt / 60)) + rng.uniform(0, 2.2)) * rscale
            out.append((x, t + r * 0.75, r, zoff + 30 + rng.uniform(0, 6), base, 1.1, rng.uniform(0, 6.3)))
            x += r * rng.uniform(0.9, 1.4)
        else:
            x += 2
    # side bulges: mid-height puffs poking out of the flanks
    for _ in range(int(width * 0.08)):
        x = cx + rng.choice([-1, 1]) * rng.uniform(0.2, 0.45) * width
        t = top(x)
        y = rng.uniform(t + 3, base - 3) if base - t > 8 else base - 3
        r = rng.uniform(4, 7) * rscale
        out.append((x, y, r, zoff + 34 + rng.uniform(0, 4), base, 1.2, rng.uniform(0, 6.3)))
    # flat base: wide flattened puffs along the bottom
    x = cx - width / 2 + 6
    while x < cx + width / 2 - 6:
        if base - top(x) > 5:
            out.append((x, base - 2, rng.uniform(5, 8) * rscale, zoff + 20, base, 2.2, rng.uniform(0, 6.3)))
        x += 7
    return out


def streak(cx, cy, length, thick):
    """A thin high cloud: flattened, lumpy puffs in a line."""
    out = []
    x = cx - length / 2
    while x < cx + length / 2:
        out.append((x, cy + rng.uniform(-1, 1), thick * rng.uniform(1.2, 2.2), 0, cy + thick * 0.8, 3.2, rng.uniform(0, 6.3)))
        x += thick * 1.5
    return out


MAX_RUNS = 64


def lum(h):
    r, g, b = hexrgb(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _runs(cells):
    """cells: set of (x, y) -> list of (y, x0, n) horizontal runs, row-major."""
    rows = {}
    for x, y in cells:
        rows.setdefault(y, []).append(x)
    out = []
    for y in sorted(rows):
        xs = sorted(rows[y])
        s = p = xs[0]
        for x in xs[1:]:
            if x == p + 1:
                p = x
                continue
            out.append((y, s, p - s + 1))
            s = p = x
        out.append((y, s, p - s + 1))
    return out


def _d(runs):
    d, pen = [], None
    for (y, x0, n) in runs:
        if pen is None:
            d.append(f'M{x0} {y}h{n}')
        else:
            d.append(f'm{x0 - pen[0]} {y - pen[1]}h{n}')
        pen = (x0 + n, y)
    return ''.join(d)


def emit_safe(layer):
    """Seam-safe stroke runs, after the method of BackdropKit's emitSafe (MIT).

    Colours go darkest first and each also covers its 4-neighbours of colours drawn later, so
    every edge lies over a solid neighbour instead of the layers beneath (no hairlines at
    fractional cell sizes). A path holds at most MAX_RUNS runs; each later chunk of a colour
    also covers touching cells of its earlier chunks. A run on row y is drawn at y, so the
    caller shifts the picture down half a cell.
    """
    a = layer.a
    h, w = a.shape
    used = sorted({int(v) for v in np.unique(a) if v >= 0}, key=lambda i: lum(layer.pal[i]))
    rank = {ci: r for r, ci in enumerate(used)}
    out = []
    for ci in used:
        ys, xs = np.nonzero(a == ci)
        own = set(zip(xs.tolist(), ys.tolist()))
        cov = set(own)
        for (x, y) in own:
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    nc = int(a[ny, nx])
                    if nc >= 0 and rank[nc] > rank[ci]:
                        cov.add((nx, ny))
        rows = {}
        for (x, y) in cov:
            rows.setdefault(y, set()).add((x, y))
        done, paths = set(), []
        cur = set()

        def with_overlap(ks):
            s2 = set(ks)
            for (x, y) in ks:
                for n in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if n in done:
                        s2.add(n)
            return s2

        def close(c):
            if c:
                paths.append(_d(_runs(with_overlap(c))))
                done.update(c)
            return set()

        for y in sorted(rows):
            row = rows[y]
            if len(_runs(with_overlap(cur | row))) <= MAX_RUNS:
                cur = cur | row
                continue
            cur = close(cur)
            if len(_runs(with_overlap(row))) <= MAX_RUNS:
                cur = set(row)
                continue
            piece = set()
            for k in sorted(row):
                t = piece | {k}
                if piece and len(_runs(with_overlap(t))) > MAX_RUNS:
                    close(piece)
                    piece = {k}
                else:
                    piece = t
            cur = piece
        close(cur)
        col = layer.pal[ci]
        if len(paths) == 1:
            out.append(f'<path stroke="{col}" d="{paths[0]}"/>')
        else:
            out.append(f'<g stroke="{col}">' + ''.join(f'<path d="{p}"/>' for p in paths) + '</g>')
    return ''.join(out)


# ---- sky: one smooth vertical gradient (vector, not cells) ----
SKY_STOPS = [(0, '#0e3c98'), (0.3, '#1c66c8'), (0.6, '#4a9fe4'), (0.82, '#8acdf3'), (1, '#d4eefa')]
SKY = ('<linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1">' +
       ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in SKY_STOPS) +
       '</linearGradient><rect y="-1" width="320" height="162" fill="url(#skyg)"/>')


# ---- cloud blanket: a still overcast up top and big cumulus rows below ----
clouds = Layer(['#4a8fd0', '#6fb0e6', '#9ad0f3', '#c9ebfb', '#eefbff'])
# overcast: rows of big flattened billows filling the top of the sky
deck = []
for row, (yc, rmin, rmax, z) in enumerate([(4, 16, 24, 0), (24, 14, 21, 10), (44, 12, 18, 20), (60, 10, 15, 30)]):
    x = -20 + rng.uniform(0, 10)
    while x < 340:
        r = rng.uniform(rmin, rmax)
        if not (row == 2 and 150 < x < 200):   # one patch of blue sky showing through
            deck.append((x, yc + rng.uniform(-3, 3), r, z + rng.uniform(0, 4), yc + r * 0.55, 1.9, rng.uniform(0, 6.3)))
        x += r * rng.uniform(1.1, 1.5)
puffs(clouds, deck, light=(-0.4, -0.9, 0.4), ambient=0.25, bands=[0.4, 0.62, 0.82])
deck_cells = clouds.a.copy()
items = []
for base, sc, z in [(104, 1.1, 0), (140, 1.25, 40)]:
    x = -30 + rng.uniform(0, 20)
    while x < 350:
        w = rng.uniform(80, 120)
        towers = [(rng.uniform(-w / 4, w / 4), rng.uniform(22, 34) * sc, w / 4)]
        if rng.random() < 0.6:
            towers.append((rng.uniform(-w / 3, w / 3), rng.uniform(12, 22) * sc, w / 5))
        items += cumulus(x, base, w, towers, rscale=sc * 1.15, zoff=z)
        x += w * rng.uniform(0.6, 0.8)
blank = clouds.a.copy()
puffs(clouds, items, bands=[0.25, 0.45, 0.65, 0.85])
clouds.a = np.where(clouds.a >= 0, clouds.a, blank)

# ---- storm banks: they roll in from the left, right and top while Claude works ----
STORM_PAL = ['#11142f', '#24264f', '#3a386c', '#57508a']


TOP_CLUMPS = [90, 170, 250]  # scene.ts aims rain and lightning at these


def bank(kind):
    """Storm clouds: a mass in each top corner, or a few separate clumps along the top."""
    L = Layer(STORM_PAL)
    its = []
    if kind == 'top':
        for cx in TOP_CLUMPS:
            cx += rng.uniform(-6, 6)
            for _ in range(13):
                x = cx + rng.uniform(-26, 26)
                y = rng.uniform(-10, 18 - abs(x - cx) * 0.3)
                its.append((x, y, rng.uniform(9, 15), y * 0.4, 30 + rng.uniform(-2, 2), 1.15, rng.uniform(0, 6.3)))
            for _ in range(2):
                x = cx + rng.uniform(-18, 18); y = rng.uniform(29, 33)
                its.append((x, y, rng.uniform(3, 5), 80, y + 3, 1.7, rng.uniform(0, 6.3)))
    else:
        for _ in range(34):
            u = rng.random() ** 1.5
            d = -15 + 75 * u              # distance in from the edge
            y = rng.uniform(-10, 62 - d * 0.6)
            r = rng.uniform(10, 17) * (1.15 - 0.4 * u)
            x = d if kind == 'left' else 320 - d
            its.append((x, y, r, y * 0.4, 70 - d * 0.35, 1.15, rng.uniform(0, 6.3)))
        for _ in range(3):
            d = rng.uniform(5, 45); y = rng.uniform(66 - d * 0.35, 70 - d * 0.35)
            x = d if kind == 'left' else 320 - d
            its.append((x, y, rng.uniform(3, 5), 80, y + 3, 1.7, rng.uniform(0, 6.3)))
    light = {'top': (-0.3, -0.95, 0.35), 'left': (0.5, -0.8, 0.35), 'right': (-0.5, -0.8, 0.35)}[kind]
    puffs(L, its, light=light, ambient=0.06, bands=[0.2, 0.45, 0.72])
    return L


bank_l, bank_r, bank_t = bank('left'), bank('right'), bank('top')
storm = Layer(STORM_PAL)
for l in (bank_l, bank_r, bank_t):
    storm.a = np.where(l.a >= 0, l.a, storm.a)

# ---- ground: far mountains, a hedged patchwork of fields, a pond, a farm and a near meadow ----
ground = Layer([])


def gc(col):
    """Palette index for a colour, adding it on first use."""
    if col not in ground.pal:
        ground.pal.append(col)
    return ground.pal.index(col)


def gput(x, y, col):
    ground.put(x, y, gc(col))


xs = np.arange(W)
# far mountains with snow on the peaks, hazy blue
peaks = [(20, 128), (70, 120), (122, 133), (176, 124), (232, 131), (282, 118), (330, 130)]
mtn = np.full(W, 200.0)
for px, py in peaks:
    for x in range(W):
        h = py + abs(x - px) * 0.55 + 0.8 * math.sin(x * 0.9 + px) * min(1, abs(x - px) / 6)
        mtn[x] = min(mtn[x], h)
for x in range(W):
    top = int(mtn[x])
    for y in range(top, HORIZON):
        col = '#7d97bb' if (x + y) % 9 == 0 and y < top + 6 else '#6a86ad'
        if y > HORIZON - 7:
            col = '#7f9cc0'           # haze where the range meets the plain
        gput(x, y, col)
    for y in range(top, top + 4):     # snow on the higher peaks only
        if top < 126 and y < 128:
            gput(x, y, '#e2ecf7' if x % 3 else '#c7d6ea')

# rolling mid hills and a distant tree line
mid = (HORIZON - 4 + 3 * np.sin(xs / 21.0 + 2) + 2 * np.sin(xs / 7.0)).astype(int)
for x in range(W):
    for y in range(mid[x], H):
        gput(x, y, '#3f5f7f')
    if math.sin(x * 0.9) + math.sin(x * 0.37) > 0.4:
        gput(x, mid[x] - 1, '#2c4660')
        if x % 3 == 0:
            gput(x, mid[x] - 2, '#2c4660')

# patchwork fields with hedgerows between them
FIELDS = ['#6a9a4f', '#7ea852', '#c9a94a', '#557f42', '#b39445', '#89b05a', '#4f7a3f', '#a7c066']
near = (HORIZON + 3 + 2 * np.sin(xs / 30.0 + 1)).astype(int)
cuts = [0]
while cuts[-1] < W:
    cuts.append(cuts[-1] + rng.randint(26, 52))
rows = [HORIZON + 1, HORIZON + 6, HORIZON + 12]
for ri, (y0, y1) in enumerate(zip(rows, rows[1:] + [HORIZON + 19])):
    for ci, (x0, x1) in enumerate(zip(cuts, cuts[1:])):
        col = FIELDS[(ci * 3 + ri * 5) % len(FIELDS)]
        skew = (ri + 1) * 4
        for y in range(y0, y1):
            off = int((y - y0) * 0.3 * (1 if ci % 2 else -1))
            for x in range(x0 + off, x1 + off):
                if 0 <= x < W and y >= mid[min(max(x, 0), W - 1)]:
                    stripe = (col in ('#c9a94a', '#b39445')) and (x + y * 2) % 5 == 0
                    gput(x, y, '#d8bb5c' if stripe else col)
        # hedge along the field's bottom edge and its side
        for x in range(x0, x1):
            if 0 <= x < W and (x * 7 + ri) % 4 != 0:
                gput(x, y1 - 1, '#2a4a2c')
        for y in range(y0, y1):       # side hedge: a broken line of bushes, not a fence
            if (y + ci) % 3:
                gput(x0 + int((y - y0) * 0.3 * (1 if ci % 2 else -1)), y, '#2a4a2c')

# near meadow: graded greens with grass tufts and flowers
MEADOW = ['#5d9a4c', '#4f8a43', '#437a3b', '#376a33', '#2b5a2b']
start = HORIZON + 19
for x in range(W):
    for y in range(start, H):
        k = (y - start) / (H - start)
        gput(x, y, MEADOW[min(len(MEADOW) - 1, int(k * len(MEADOW)))])
for _ in range(260):
    x = rng.randrange(W)
    y = rng.randrange(start + 1, H)
    k = (y - start) / (H - start)
    tall = 1 + int(k * 3)
    for t in range(tall):
        gput(x, y - t, '#76b05a' if t == tall - 1 else '#3d7a36')
for _ in range(70):
    x = rng.randrange(W)
    y = rng.randrange(start + 4, H)
    col = rng.choice(['#f4d35e', '#f4d35e', '#ffffff', '#e86a8a', '#b48ae8'])
    gput(x, y, col)
    if y > start + 14:
        gput(x + 1, y, col)

# pond on the left, reflecting the sky
pcx, pcy, prx, pry = 64, HORIZON + 24, 22, 4.5
for y in range(int(pcy - pry) - 1, int(pcy + pry) + 2):
    for x in range(int(pcx - prx) - 1, int(pcx + prx) + 2):
        d = ((x - pcx) / prx) ** 2 + ((y - pcy) / pry) ** 2
        if d < 1:
            col = '#9fd3f3' if y < pcy - 1 else '#6fb3e6'
            if y == int(pcy) and abs(x - pcx - 4) < 6:
                col = '#e6f6ff'
            gput(x, y, col)
        elif d < 1.35:
            gput(x, y, '#5b4c3c')     # muddy rim
for (rx, ry) in [(44, HORIZON + 22), (46, HORIZON + 21), (83, HORIZON + 26)]:
    for t in range(4):                # reeds
        gput(rx, ry - t, '#2f5a2a' if t < 3 else '#7a5a34')

# winding path with an edge and a few stones
for y in range(H - 1, HORIZON + 1, -1):
    k = (H - y) / (H - HORIZON - 1)
    cx = 160 + 26 * math.sin(k * 3.0) * (1 - k)
    half = 9 * (1 - k) + 0.6
    x0, x1 = int(cx - half), int(cx + half)
    for x in range(x0, x1 + 1):
        col = '#8b7558' if x - x0 < 2 else '#74604a'
        if (x * 13 + y * 7) % 23 == 0 and k < 0.7:
            col = '#a39377'
        gput(x, y, col)
    if y > HORIZON + 22 and y % 2 == 0:
        gput(x0 - 1, y, '#3d7a36')

# fence beside the path
for i, y in enumerate(range(HORIZON + 20, H, 4)):
    k = (H - y) / (H - HORIZON - 1)
    fx = int(160 + 26 * math.sin(k * 3.0) * (1 - k) + 9 * (1 - k) + 4 + i * 1.4)
    h = 2 + int((1 - k) * 4)
    for t in range(h):
        gput(fx, y - t, '#5a3d26')
    if i:
        for x in range(prev[0], fx):
            yy = prev[1] - prev[2] + 1 + int((x - prev[0]) / max(1, fx - prev[0]) * ((y - h + 1) - (prev[1] - prev[2] + 1)))
            gput(x, yy, '#7a5636')
    prev = (fx, y, h)


terrain_cells = ground.a.copy()   # the bare land, before trees, farm and town
terrain_pal = list(ground.pal)


def tree(cx, base, h, r, pal=('#0e2418', '#173522', '#21492b', '#2f6135', '#447a3e')):
    for y in range(base - h, base):
        gput(cx, y, '#2a1f1a')
        gput(cx + 1, y, '#3a2a20')
    crown = [(cx + rng.uniform(-r, r), base - h - rng.uniform(0, r * 1.1), rng.uniform(r * .4, r * .65))
             for _ in range(int(r * 1.5) + 3)]
    for y in range(base - h - int(r * 2.2), base - h + int(r * 0.8)):
        for x in range(cx - int(r * 1.6), cx + int(r * 1.6)):
            best = None
            for (px, py, pr) in crown:
                if (x - px) ** 2 + (y - py) ** 2 < pr * pr:
                    lit = ((px - x) + (py - y)) / pr
                    best = lit if best is None else max(best, lit)
            if best is not None:
                v = np.clip(0.4 + 0.42 * best, 0, 0.999)
                gput(x, y, pal[int(v * len(pal))])


WINDOWS = []      # [x, y, w, h, lit-at-night] drawn live in scene.ts, so they glow after dark
CHIMNEYS = []     # [x, y] tops, where scene.ts puffs smoke
LAMPS = []        # [x, y] streetlamp heads, lit after dark
DOORS = []        # [x, y] front-row doorsteps, for holiday pumpkins
EAVES = []        # [x, y, w] front-row roof edges, for holiday lights


def house(x, base, w, h, wall, roof, windows=1, chimney=False, door=True, big=False):
    """A house standing on `base`: walls, a pitched roof, windows recorded for scene.ts."""
    shade = '#00000000'
    for y in range(base - h, base):
        for xx in range(x, x + w):
            gput(xx, y, wall)
        gput(x + w - 1, y, roof_dark.get(wall, wall))          # shaded side wall
    for k in range(w // 2 + 2):
        for xx in range(x - 1 + k, x + w + 1 - k):
            gput(xx, base - h - k, roof if xx < x + w // 2 + 1 else roof_dark.get(roof, roof))
    if chimney:
        cx = x + w - 2
        for y in range(base - h - w // 2 - 2, base - h - 1):
            gput(cx, y, '#5a4a44')
        CHIMNEYS.append([cx, base - h - w // 2 - 3])
    ww = 2 if big else 1
    slots = [x + 1 + i * (w - 2 - ww) // max(1, windows - 1) for i in range(windows)] if windows > 1 else [x + 1]
    for wx in (slots if windows else []):
        WINDOWS.append([wx, base - h + 1, ww, 2 if big else 1, 1 if rng.random() < 0.75 else 0])
    if door:
        gput(x + w - 3, base - 1, '#2a1f1a')
        if big:
            gput(x + w - 3, base - 2, '#2a1f1a')
    if big:
        DOORS.append([x + w - 3, base - 1])
        EAVES.append([x - 1, base - h, w + 2])


roof_dark = {'#8a3b2e': '#6a2b22', '#4a2a22': '#3a201a', '#c7b89a': '#a8987a', '#b7a88a': '#9a8b6e',
             '#d8cfbd': '#b9af9c', '#9a6a4a': '#7d543a', '#5a3a3a': '#432a2a', '#7a3a32': '#5c2a24',
             '#3e4a63': '#2e374a', '#6b4b3a': '#523829', '#a95a3a': '#86452c'}

# a farm on the left: barn and silo, and a windmill tower whose sails turn in scene.ts
house(96, HORIZON + 4, 9, 5, '#8a3b2e', '#4a2a22', windows=0, door=True)
for y in range(HORIZON - 6, HORIZON + 4):    # silo
    gput(107, y, '#b9b2a6'); gput(108, y, '#9a948a')
gput(107, HORIZON - 7, '#7a7a86'); gput(108, HORIZON - 7, '#7a7a86')
MILL = [40, HORIZON - 12]                    # hub of the windmill's sails
for y in range(HORIZON - 12, HORIZON + 4):
    k = (y - (HORIZON - 12)) / 16
    half = int(1 + k * 2.5)
    for x in range(40 - half, 40 + half + 1):
        gput(x, y, '#d8cfbd' if x < 40 + half else '#b9af9c')
for x in range(38, 43):
    gput(x, HORIZON - 13, '#6b4b3a')
gput(40, HORIZON + 2, '#2a1f1a'); gput(40, HORIZON + 3, '#2a1f1a')
WINDOWS.append([40, HORIZON - 6, 1, 1, 1])

# the town on the right: a back row on the hill, a church, and a front row along a lane
for y in range(HORIZON + 1, HORIZON + 17):   # town green and cobbles under the houses
    for x in range(184, 316):
        if y > HORIZON + 13:
            gput(x, y, '#7d7466' if (x + y) % 4 else '#6b6357')
        else:
            gput(x, y, '#4f7a3f')
WALLS = ['#d8cfbd', '#c7b89a', '#b7a88a', '#9a6a4a']
ROOFS = ['#7a3a32', '#5a3a3a', '#3e4a63', '#a95a3a', '#6b4b3a']
x = 186
while x < 312:                                # back row, small and far
    w = rng.choice([5, 6, 7]); h = rng.choice([3, 4])
    if not (218 <= x <= 232):
        house(x, HORIZON + 6, w, h, rng.choice(WALLS), rng.choice(ROOFS), windows=1, chimney=rng.random() < 0.4)
    x += w + rng.choice([1, 2])
# church with a steeple
for y in range(HORIZON - 1, HORIZON + 8):
    for xx in range(220, 230):
        gput(xx, y, '#d8cfbd' if xx < 229 else '#b9af9c')
for k in range(6):
    for xx in range(219 + k, 231 - k):
        gput(xx, HORIZON - 1 - k, '#3e4a63' if xx < 225 else '#2e374a')
for y in range(HORIZON - 16, HORIZON - 1):
    for xx in range(221, 225):
        gput(xx, y, '#c7b89a' if xx < 224 else '#a8987a')
for k in range(5):
    for xx in range(221 + k // 2, 225 - k // 2):
        gput(xx, HORIZON - 17 - k, '#3e4a63')
gput(222, HORIZON - 23, '#e8d27a'); gput(222, HORIZON - 24, '#e8d27a'); gput(221, HORIZON - 23, '#e8d27a'); gput(223, HORIZON - 23, '#e8d27a')
WINDOWS.append([222, HORIZON - 12, 1, 2, 1])
for wx in (221, 224, 227):
    WINDOWS.append([wx, HORIZON + 2, 1, 2, 1])
x = 188
while x < 312:                                # front row, bigger, along the lane
    w = rng.choice([7, 8, 9, 10]); h = rng.choice([5, 6, 7])
    if not (262 <= x + w and x <= 272):       # leave the lantern clear
        house(x, HORIZON + 14, w, h, rng.choice(WALLS), rng.choice(ROOFS), windows=2 if w > 7 else 1,
              chimney=rng.random() < 0.6, big=True)
    x += w + rng.choice([2, 3, 4])
for lx in (200, 238, 296):                    # streetlamps along the lane
    for y in range(HORIZON + 9, HORIZON + 15):
        gput(lx, y, '#1b1b22')
    gput(lx - 1, HORIZON + 8, '#1b1b22'); gput(lx + 1, HORIZON + 8, '#1b1b22')
    LAMPS.append([lx, HORIZON + 8])
tree(12, 168, 8, 10); tree(33, 161, 5, 7); tree(306, 166, 8, 9); tree(286, 158, 4, 6)
tree(120, HORIZON + 2, 2, 3); tree(150, HORIZON + 1, 2, 3)
for (bx, by) in [(52, 166), (110, 172), (214, 172), (296, 175)]:
    for y in range(by - 3, by + 1):
        for x in range(bx - 4, bx + 5):
            if ((x - bx) / 4.5) ** 2 + ((y - by) / 3.2) ** 2 < 1:
                gput(x, y, '#2f6135' if y < by - 1 else '#21492b')
# rocks
for (rx, ry) in [(140, 172), (190, 176), (78, 176)]:
    gput(rx, ry, '#7c7f86'); gput(rx + 1, ry, '#9a9ea6'); gput(rx, ry + 1, '#5d6068'); gput(rx + 1, ry + 1, '#6d7078')
# lantern post (the glass is drawn live in scene.ts so it can blink)
for y in range(154, 168):
    gput(267, y, '#1b1b22')
gput(266, 154, '#1b1b22'); gput(268, 154, '#1b1b22')

# ---- seasons and real-weather skies. Everything below draws after the summer ground, on its own
# random stream, so the town and fields keep the same layout in every season. ----
rng = random.Random(2026)


def variant(remap, extra=None, base=None):
    """A copy of a summer ground (the village's by default) with colours swapped, then `extra`."""
    base = ground if base is None else base
    v = Layer(list(base.pal))
    v.a = base.a.copy()
    for old, new in remap.items():
        if old not in base.pal:
            continue
        i = base.pal.index(old)
        if new is None:
            v.a[v.a == i] = -1
        else:
            if new not in v.pal:
                v.pal.append(new)
            v.a[v.a == i] = v.pal.index(new)
    if extra:
        extra(v)
    return v


def vput(v, x, y, col):
    if col not in v.pal:
        v.pal.append(col)
    v.put(x, y, v.pal.index(col))


TREE = ['#0e2418', '#173522', '#21492b', '#2f6135', '#447a3e']
MEADOW_C = ['#5d9a4c', '#4f8a43', '#437a3b', '#376a33', '#2b5a2b']
WHEAT = ['#c9a94a', '#b39445', '#d8bb5c']
GREENS = ['#6a9a4f', '#7ea852', '#557f42', '#89b05a', '#4f7a3f', '#a7c066']
FLOWERS = ['#f4d35e', '#ffffff', '#e86a8a', '#b48ae8']
ROOFS_ALL = ['#7a3a32', '#5a3a3a', '#3e4a63', '#a95a3a', '#6b4b3a', '#4a2a22',
             '#5c2a24', '#432a2a', '#2e374a', '#523829', '#86452c', '#3a201a']


def more_flowers(v):
    for _ in range(90):
        x, y = rng.randrange(W), rng.randrange(HORIZON + 22, H)
        if v.a[y, x] >= 0 and v.pal[v.a[y, x]] in MEADOW_C + ['#7fbf5a', '#6aae4c', '#5a9a44', '#4a8a3c', '#3c7a34']:
            vput(v, x, y, rng.choice(['#f2b8d0', '#ffffff', '#f4d35e', '#e86a8a']))


SPRING_MAP = {
    TREE[4]: '#f2b8d0', TREE[3]: '#5e9653',                 # blossom on the crowns
    WHEAT[0]: '#8cc36b', WHEAT[1]: '#7ea852', WHEAT[2]: '#9fd07a',   # young crops
    MEADOW_C[0]: '#7fbf5a', MEADOW_C[1]: '#6aae4c', MEADOW_C[2]: '#5a9a44', MEADOW_C[3]: '#4a8a3c', MEADOW_C[4]: '#3c7a34',
}
spring = variant(SPRING_MAP, more_flowers)


def leaves(v):
    for _ in range(60):
        x, y = rng.randrange(W), rng.randrange(HORIZON + 20, H)
        if v.a[y, x] >= 0:
            vput(v, x, y, rng.choice(['#d27a2a', '#a8481c', '#f0b04a']))


AUTUMN_MAP = {
    TREE[0]: '#3a1a10', TREE[1]: '#6a2a14', TREE[2]: '#a8481c', TREE[3]: '#d27a2a', TREE[4]: '#f0b04a',
    GREENS[0]: '#9a7a3e', GREENS[1]: '#b08a44', GREENS[2]: '#7a6034', GREENS[3]: '#a8904a', GREENS[4]: '#6a5230', GREENS[5]: '#c0a050',
    MEADOW_C[0]: '#8a9a4a', MEADOW_C[1]: '#7a8a42', MEADOW_C[2]: '#6a7a3a', MEADOW_C[3]: '#5a6a32', MEADOW_C[4]: '#4a5a2a',
    '#76b05a': '#b0a050', '#3d7a36': '#6a6a30',
    '#b48ae8': '#d27a2a', '#e86a8a': '#a8481c', '#ffffff': '#f0b04a',
}
autumn = variant(AUTUMN_MAP, leaves)

MILD = {   # a winter with no snow: dull greens, browned fields, bare-looking trees
    TREE[3]: '#4a5a3a', TREE[4]: '#6a6a48', TREE[2]: '#3a4a30',
    GREENS[0]: '#7a7a4a', GREENS[1]: '#8a8450', GREENS[3]: '#8a8a58', GREENS[5]: '#9a9460',
    WHEAT[0]: '#8a7448', WHEAT[1]: '#7a6640', WHEAT[2]: '#9a8454',
    MEADOW_C[0]: '#6a7a4a', MEADOW_C[1]: '#5e6e44', MEADOW_C[2]: '#52623c', MEADOW_C[3]: '#465634', MEADOW_C[4]: '#3a4a2c',
    '#76b05a': '#8a8a5a', '#f4d35e': '#5e6e44', '#e86a8a': '#52623c', '#b48ae8': '#5e6e44', '#ffffff': '#6a7a4a',
}
winter = variant(MILD)

SNOW = ['#f4f8fd', '#e6eef7', '#d6e2ef', '#c6d4e6', '#b6c7de']


def snow_on_top(v):
    """Snow on every roof, crown and hedge cell that has open sky above it, and deeper on peaks."""
    caps = set(ROOFS_ALL + ['#1f3a35', '#2a4a2c', '#3e4a63', '#d8cfbd', '#2a1f1a'])
    h, w = v.a.shape
    orig = v.a.copy()
    for x in range(w):
        for y in range(1, h):
            i = orig[y, x]
            above = orig[y - 1, x]
            if i >= 0 and v.pal[i] in caps and (above < 0 or v.pal[above] not in caps):
                vput(v, x, y, SNOW[0])
        col = v.a[:, x]
        top = next((y for y in range(h) if col[y] >= 0), None)
        if top is not None and top < HORIZON - 8:
            for y in range(top, min(top + 7, HORIZON - 6)):
                if v.pal[v.a[y, x]] in ('#6a86ad', '#7d97bb', '#7f9cc0', '#e2ecf7', '#c7d6ea'):
                    vput(v, x, y, SNOW[1] if (x + y) % 5 else SNOW[2])


SNOW_MAP = {
    TREE[0]: '#14282a', TREE[1]: '#1f3a35', TREE[2]: '#1f3a35', TREE[3]: '#e6eef7', TREE[4]: '#f4f8fd',
    **{g: SNOW[1] for g in GREENS}, WHEAT[0]: SNOW[0], WHEAT[1]: SNOW[1], WHEAT[2]: SNOW[0],
    MEADOW_C[0]: SNOW[0], MEADOW_C[1]: SNOW[1], MEADOW_C[2]: SNOW[2], MEADOW_C[3]: SNOW[3], MEADOW_C[4]: SNOW[4],
    '#76b05a': '#c6d4e6', '#3d7a36': '#b6c7de', '#2a4a2c': '#4a5a6a',
    '#9fd3f3': '#d4e6f4', '#6fb3e6': '#b9d3ea', '#e6f6ff': '#ffffff',             # ice
    '#8b7558': '#c9c0b2', '#74604a': '#b8ae9e', '#a39377': '#d8d0c4',            # snowy path
    '#4f7a3f': SNOW[1], '#2f6135': '#e6eef7', '#21492b': '#1f3a35',
    '#f4d35e': SNOW[1], '#e86a8a': SNOW[2], '#b48ae8': SNOW[1],
}
snowy = variant(SNOW_MAP, snow_on_top)

# ---- eras: the same land settled by the Stone Age and by a sci-fi future. scene.ts shows the one
# the conversation's context has reached. Each starts from the bare land snapshot. ----
rng = random.Random(4004)


def land(remap=None):
    """A layer of the bare land, colours optionally swapped."""
    L = Layer(list(terrain_pal))
    L.a = terrain_cells.copy()
    for old, new in (remap or {}).items():
        if old in L.pal:
            i = L.pal.index(old)
            if new not in L.pal:
                L.pal.append(new)
            L.a[L.a == i] = L.pal.index(new)
    return L


def tree_on(L, cx, base, h, r, pal=('#0e2418', '#173522', '#21492b', '#2f6135', '#447a3e')):
    for y in range(base - h, base):
        vput(L, cx, y, '#2a1f1a')
        vput(L, cx + 1, y, '#3a2a20')
    crown = [(cx + rng.uniform(-r, r), base - h - rng.uniform(0, r * 1.1), rng.uniform(r * .4, r * .65))
             for _ in range(int(r * 1.5) + 3)]
    for y in range(base - h - int(r * 2.2), base - h + int(r * 0.8)):
        for x in range(cx - int(r * 1.6), cx + int(r * 1.6)):
            best = None
            for (px, py, pr) in crown:
                if (x - px) ** 2 + (y - py) ** 2 < pr * pr:
                    lit = ((px - x) + (py - y)) / pr
                    best = lit if best is None else max(best, lit)
            if best is not None:
                v = np.clip(0.4 + 0.42 * best, 0, 0.999)
                vput(L, x, y, pal[int(v * len(pal))])


def lantern_post(L, top='#1b1b22'):
    for y in range(154, 168):
        vput(L, 267, y, top)
    vput(L, 266, 154, top); vput(L, 268, 154, top)


# -- Stone Age: wild grassland, round thatched huts in a palisade, a campfire, standing stones --
WILD = {c: g for c, g in zip(['#6a9a4f', '#7ea852', '#c9a94a', '#557f42', '#b39445', '#89b05a', '#4f7a3f', '#a7c066', '#d8bb5c'],
                             ['#6a9a4f', '#76a250', '#8aa858', '#5f8a48', '#7e9a50', '#6a9a4f', '#5f8a48', '#8aa858', '#8aa858'])}
WILD.update({'#2a4a2c': '#5f8a48', '#5a3d26': '#437a3b', '#7a5636': '#4f8a43',      # no hedges or fences
             '#8b7558': '#7a6648', '#74604a': '#6a5640', '#a39377': '#6a5640'})      # a beaten earth trail
stone = land(WILD)
STONE_HUTS = []   # [x, y] hut doorways, glowing with firelight after dark
FIRES = []        # [x, y] campfire, flames and smoke drawn live
THATCH = ['#6a4e2a', '#8a6a3a', '#a8844a', '#c4a060']


def hut(L, cx, base, w, h):
    for r in range(h):
        y = base - h + r
        half = max(1, int(round((w / 2) * math.sqrt((r + 1) / h))))
        for x in range(cx - half, cx + half + 1):
            t = (x - (cx - half)) / max(1, 2 * half)
            band = THATCH[min(3, int((1 - t) * 3.2 + (0.4 if (x + y) % 3 == 0 else 0)))]
            vput(L, x, y, band)
    vput(L, cx, base - h - 1, '#4a3420'); vput(L, cx - 1, base - h - 2, '#4a3420'); vput(L, cx + 1, base - h - 2, '#4a3420')
    for y in (base - 2, base - 1):
        vput(L, cx, y, '#1a120a'); vput(L, cx + 1, y, '#1a120a')
    STONE_HUTS.append([cx, base - 2])


for x in range(186, 316, 3):                   # a palisade of stakes round the settlement
    for y in range(HORIZON + 14, HORIZON + 18):
        vput(stone, x, y, '#5a4028' if y > HORIZON + 14 else '#7a5a38')
for (cx, base, w, h) in [(196, 157, 9, 6), (214, 156, 8, 5), (236, 157, 10, 6), (256, 156, 8, 5), (296, 157, 9, 6),
                         (203, 165, 11, 7), (226, 165, 10, 7), (281, 165, 11, 7), (304, 165, 9, 6)]:
    hut(stone, cx, base, w, h)
FIRES.append([250, 164])
for (dx, dy, c) in [(-2, 0, '#6a6a70'), (2, 0, '#6a6a70'), (-1, 1, '#5a5a60'), (1, 1, '#5a5a60'), (0, 1, '#5a3a20'), (-1, 0, '#4a2a14'), (1, 0, '#4a2a14')]:
    vput(stone, 250 + dx, 164 + dy, c)
# standing stones on the rise where the windmill would stand
for i, sx in enumerate(range(26, 58, 7)):
    hgt = 9 if i % 2 == 0 else 7
    for y in range(HORIZON + 3 - hgt, HORIZON + 3):
        vput(stone, sx, y, '#9a9ea6'); vput(stone, sx + 1, y, '#7c7f86'); vput(stone, sx + 2, y, '#6a6d74')
for x in range(26, 52):                        # lintels across the taller pairs
    if (x - 26) % 14 < 10:
        vput(stone, x, HORIZON - 7, '#8a8e96')
# a mammoth grazing where the farm would be
MAMMOTH = [
    '....bbbbbb....',
    '..bbbbbbbbbb..',
    '.bbbbbbbbbbbbh',
    'bbbbbbbbbbbbbh',
    'bbbbbbbbbbbbhh',
    'bbbbbbbbbbbb.h',
    '.bb.bb..bb.bt.',
    '.bb.bb..bb..tt',
]
for y, row in enumerate(MAMMOTH):
    for x, c in enumerate(row):
        if c != '.':
            vput(stone, 96 + x, HORIZON - 4 + y, {'b': '#5a3a24', 'h': '#4a2e1c', 't': '#e8e0d0'}[c])
for (tx, tb, th, tr) in [(12, 168, 8, 10), (33, 161, 5, 7), (306, 170, 8, 9), (120, HORIZON + 2, 2, 3), (150, HORIZON + 1, 2, 3), (176, HORIZON + 2, 3, 4)]:
    tree_on(stone, tx, tb, th, tr)
lantern_post(stone, '#4a3420')                  # a torch on a pole, lit live like the lantern

# -- the future: solar fields, a glowing road, a city of spires and domes, turbines, a space elevator --
FUTURE = {'#6a9a4f': '#24485a', '#7ea852': '#2a5468', '#c9a94a': '#1f3a4a', '#557f42': '#22404f', '#b39445': '#1c3442',
          '#89b05a': '#2a5468', '#4f7a3f': '#22404f', '#a7c066': '#2e5c70', '#d8bb5c': '#24485a',
          '#2a4a2c': '#3fd0e0',                                               # hedges become light lines
          '#8b7558': '#3a4050', '#74604a': '#2a2f3a', '#a39377': '#7fe8ff',   # a dark road with a lit centre
          '#5a3d26': '#9fb3c8', '#7a5636': '#c9d6e8',                         # fences become light rails
          '#5d9a4c': '#4a9a6c', '#4f8a43': '#3e8a60', '#437a3b': '#347a56', '#376a33': '#2a6a4c', '#2b5a2b': '#205a40'}
future = land(FUTURE)
SCIFI_WINDOWS = []   # [x, y, w, h, lit] tower windows, lit in cool colours after dark
BEACONS = []         # [x, y] blinking lights on the tops of the spires
FUTURE_EAVES = []
FUTURE_DOORS = []
FACE = ['#5a6a88', '#8a9ab8', '#c9d6e8', '#e8f0fa']


def spire(L, x, base, w, h, top='taper'):
    for y in range(base - h, base):
        for xx in range(x, x + w):
            edge = xx - x
            col = FACE[3] if edge == 0 else FACE[2] if edge < w // 2 else FACE[1] if edge < w - 1 else FACE[0]
            vput(L, xx, y, col)
    if top == 'taper':
        for k in range(w // 2 + 1):
            for xx in range(x + k, x + w - k):
                vput(L, xx, base - h - 1 - k * 2, FACE[2]); vput(L, xx, base - h - 2 - k * 2, FACE[2] if xx < x + w // 2 else FACE[1])
        tip = base - h - 2 - (w // 2) * 2
        for y in range(tip - 5, tip):
            vput(L, x + w // 2, y, '#9fb3c8')
        BEACONS.append([x + w // 2, tip - 6])
    else:  # a domed top
        for k in range(w // 2):
            for xx in range(x + k, x + w - k):
                vput(L, xx, base - h - 1 - k // 1, '#7fb8d8' if xx < x + w // 2 else '#5a90b8')
        BEACONS.append([x + w // 2, base - h - w // 2 - 1])
    for wy in range(base - h + 2, base - 2, 3):
        for wx in range(x + 1, x + w - 1, 2):
            SCIFI_WINDOWS.append([wx, wy, 1, 1, 1 if rng.random() < 0.8 else 0])
    FUTURE_EAVES.append([x, base - h, w])
    FUTURE_DOORS.append([x + w // 2, base - 1])


for (x, base, w, h, top) in [(186, 162, 7, 34, 'taper'), (195, 160, 6, 52, 'taper'), (204, 162, 9, 26, 'dome'),
                             (216, 160, 7, 70, 'taper'), (226, 162, 8, 44, 'taper'), (237, 161, 10, 30, 'dome'),
                             (250, 160, 6, 58, 'taper'), (259, 162, 8, 40, 'taper'), (272, 161, 7, 48, 'taper'),
                             (282, 162, 10, 24, 'dome'), (295, 160, 6, 62, 'taper'), (304, 162, 9, 36, 'taper')]:
    spire(future, x, base, w, h, top)
for (x0, x1, y) in [(193, 216, 128), (222, 250, 120), (256, 272, 134), (277, 295, 126)]:   # skybridges
    for x in range(x0, x1):
        vput(future, x, y, '#c9d6e8'); vput(future, x, y + 1, '#7fe8ff' if x % 3 else '#8a9ab8')
# greenhouse domes and wind turbines on the left, where the farm stands in other ages
for (cx, base, r) in [(100, HORIZON + 4, 7), (114, HORIZON + 4, 5)]:
    for y in range(base - r, base):
        for x in range(cx - r, cx + r + 1):
            if (x - cx) ** 2 + ((y - base) * 1.2) ** 2 < r * r:
                vput(future, x, y, '#bfe8f4' if (x + y) % 4 == 0 else '#7fc8e0' if x < cx else '#5aa8c8')
TURBINE = [40, HORIZON - 16]
for (tx, top) in [(40, HORIZON - 16), (62, HORIZON - 10)]:
    for y in range(top, HORIZON + 4):
        vput(future, tx, y, '#e8f0fa')
# a space elevator from the tallest peak into the sky
for y in range(0, 118):
    vput(future, 282, y, '#9fb3c8' if y % 6 else '#c9d6e8')
LIFT = [282, 118]
for (tx, tb, th, tr) in [(12, 168, 8, 10), (33, 161, 5, 7), (150, HORIZON + 1, 2, 3)]:   # park trees
    tree_on(future, tx, tb, th, tr, pal=('#0e2a24', '#173a32', '#21503f', '#2f6a52', '#44886a'))
lantern_post(future, '#9fb3c8')
NEON_LAMPS = [[178, 158], [200, 166], [238, 166], [296, 166]]
for (lx, ly) in NEON_LAMPS:
    for y in range(ly + 1, ly + 7):
        vput(future, lx, y, '#9fb3c8')

# every era in every season
stone_spring, stone_autumn, stone_winter, stone_snow = (variant(SPRING_MAP, more_flowers, stone), variant(AUTUMN_MAP, leaves, stone),
                                                        variant(MILD, None, stone), variant(SNOW_MAP, snow_on_top, stone))
future_snow = variant({**SNOW_MAP, **{c: SNOW[1] for c in ['#24485a', '#2a5468', '#1f3a4a', '#22404f', '#1c3442', '#2e5c70']},
                       '#4a9a6c': SNOW[0], '#3e8a60': SNOW[1], '#347a56': SNOW[2], '#2a6a4c': SNOW[3], '#205a40': SNOW[4]}, snow_on_top, future)

# ---- skies: a few fair-weather clouds, and a grey overcast deck ----
fair = Layer(['#5d9fd8', '#86bfea', '#b6dcf6', '#e2f4fd', '#ffffff'])
fitems = []
fitems += cumulus(62, 70, 60, [(0, 20, 14), (12, 12, 10)], rscale=0.8)
fitems += cumulus(182, 52, 46, [(0, 14, 11)], rscale=0.7)
fitems += cumulus(268, 82, 64, [(-8, 22, 14), (14, 14, 10)], rscale=0.8)
fitems += streak(120, 26, 50, 1.8)
puffs(fair, fitems, bands=[0.25, 0.45, 0.65, 0.85])
overcast = Layer(['#7d8796', '#959fad', '#adb6c2', '#c5ccd5'])
overcast.a = np.where(deck_cells >= 0, np.minimum(np.maximum(deck_cells - 1, 0), 3), -1)
# fill the deck's blue gaps so the blanket is whole
for y in range(0, 72):
    for x in range(W):
        if overcast.a[y, x] < 0 and y < 66:
            overcast.a[y, x] = 0


frag = {'SKY': SKY, 'BANK_L': emit_safe(bank_l), 'BANK_R': emit_safe(bank_r), 'BANK_T': emit_safe(bank_t), 'GROUND': emit_safe(ground), 'GROUND_SPRING': emit_safe(spring), 'GROUND_AUTUMN': emit_safe(autumn), 'GROUND_WINTER': emit_safe(winter), 'GROUND_SNOW': emit_safe(snowy), 'FAIR': emit_safe(fair), 'OVERCAST': emit_safe(overcast),
        'GROUND_STONE': emit_safe(stone), 'GROUND_STONE_SPRING': emit_safe(stone_spring), 'GROUND_STONE_AUTUMN': emit_safe(stone_autumn),
        'GROUND_STONE_WINTER': emit_safe(stone_winter), 'GROUND_STONE_SNOW': emit_safe(stone_snow),
        'GROUND_FUTURE': emit_safe(future), 'GROUND_FUTURE_SNOW': emit_safe(future_snow)}
lines = ['// Generated by tools/gen_art.py: vector pixel-art layers (320x180). Do not edit.',
         '// Seam handling follows the method of BackdropKit (MIT, github.com/winchxyz/backdropkit).']
for k, v in frag.items():
    lines.append(f"export const {k} = '{v}'")
import json
for k, v in (('WINDOWS', WINDOWS), ('CHIMNEYS', CHIMNEYS), ('LAMPS', LAMPS), ('MILL', MILL), ('DOORS', DOORS), ('EAVES', EAVES),
             ('STONE_HUTS', STONE_HUTS), ('FIRES', FIRES), ('SCIFI_WINDOWS', SCIFI_WINDOWS), ('BEACONS', BEACONS),
             ('FUTURE_EAVES', FUTURE_EAVES), ('FUTURE_DOORS', FUTURE_DOORS), ('TURBINE', TURBINE), ('LIFT', LIFT), ('NEON_LAMPS', NEON_LAMPS)):
    lines.append(f"export const {k} = {json.dumps(v)} as const")
(MOD / 'hooks' / 'art.ts').write_text('\n'.join(lines) + '\n')
print({k: len(v) for k, v in frag.items()}, 'total', sum(len(v) for v in frag.values()))

# previews
PREV.mkdir(parents=True, exist_ok=True)
skyimg = np.zeros((H, W, 4), np.uint8)
for y in range(H):
    t = min(1, y / 160)
    for (o0, c0), (o1, c1) in zip(SKY_STOPS, SKY_STOPS[1:]):
        if o0 <= t <= o1:
            k = (t - o0) / (o1 - o0)
            skyimg[y, :, :3] = [round(a0 + (a1 - a0) * k) for a0, a1 in zip(hexrgb(c0), hexrgb(c1))]
            break
skyimg[..., 3] = 255
base = Image.fromarray(skyimg)
for name, layers in (('summer', [ground]), ('spring', [fair, spring]), ('autumn', [fair, autumn]), ('winter', [overcast, winter]), ('snow', [overcast, snowy]),
                     ('stone', [stone]), ('stone_snow', [stone_snow]), ('future', [future]), ('future_snow', [future_snow])):
    im = base.copy()
    for l in layers:
        im = Image.alpha_composite(im, Image.fromarray(l.rgba()))
    im.resize((W * 4, H * 4), Image.NEAREST).save(PREV / f'vec_{name}.png')
