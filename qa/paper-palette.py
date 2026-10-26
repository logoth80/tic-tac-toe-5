"""Read the palette out of the reference picture instead of guessing it.

Counts the image's colours after a coarse quantization, then reports the ones that carry the
drawing: the paper, the grid line, and the three inks. A theme taken from a picture should use
the picture's numbers, not an impression of them."""
import sys
from collections import Counter
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert('RGB')
w, h = im.size
print('picture: %dx%d' % (w, h))

# the frame's black border and the anti-aliased edges are noise; the drawing is inside
im = im.crop((int(w * 0.18), int(h * 0.15), int(w * 0.86), int(h * 0.80)))
px = list(im.getdata())

coarse = Image.new('P', (1, 1))
quant = Counter(((r // 12 * 12, g // 12 * 12, b // 12 * 12) for r, g, b in px))
print('most common colours (quantized to 12 levels):')
for c, n in quant.most_common(14):
    print('   #%02x%02x%02x  %7d  %5.2f%%' % (c[0], c[1], c[2], n, 100.0 * n / len(px)))


def lum(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)


# the inks: saturated hues, clustered by hue family, median of the cluster
def ink(pred):
    pts = [p for p in px if pred(p)]
    if not pts:
        return None, 0
    pts.sort(key=lambda p: (lum(p)))
    return pts[len(pts) // 2], len(pts)


def strong(p, sat_floor, bright_min):
    mx = max(p)
    return mx >= bright_min and (mx - min(p)) > sat_floor and lum(p) < 0.62


blue, nb = ink(lambda p: strong(p, 60, 200) and p[2] > p[0] + 40 and p[2] >= p[1])
red, nr = ink(lambda p: strong(p, 60, 150) and p[0] > p[2] + 40 and p[0] > p[1] + 40)
dark, nd = ink(lambda p: max(p) < 110)


def show(name, got_count):
    c, n = got_count
    print(('   %-5s #%02x%02x%02x  n=%d' % ((name,) + c + (n,))) if c else '   %-5s none' % name)


print('\nsampled inks:')
show('blue', (blue, nb))
show('red', (red, nr))
show('dark', (dark, nd))

paper = quant.most_common(1)[0][0]
grid = next((c for c, n in quant.most_common(40) if c != paper and
             abs(c[0] - paper[0]) < 90 and c[2] >= c[0] and 90 < n), None)
print('\npaper #%02x%02x%02x   grid #%02x%02x%02x' % (paper + (grid or paper)))
for name, c in (('blue', blue), ('red', red), ('dark', dark)):
    if c:
        print('contrast %s vs paper: %.1f:1' % (name, ratio(c, paper)))
if grid:
    print('contrast grid vs paper: %.2f:1' % ratio(grid, paper))

"""How wide is the reference's pen? The theme has to answer that in cells, not in pixels, so the
grid's own pitch is measured from the sheet and the red stroke's thickness is divided by it.
The grid lines run the whole height of the sheet, so a column histogram of grid-coloured pixels
peaks on them however many stones sit on top; the stones are what makes a naive threshold fail."""
data = im.load()
W, H = im.size


def is_grid(p):
    return p[2] > p[0] + 18 and p[1] > p[0] + 12 and p[0] > 120


def is_red(p):
    return p[0] > 150 and p[0] > p[1] + 60 and p[0] > p[2] + 40


def pitch(scores, min_share=0.45):
    """Median spacing between the grid lines: local maxima of a histogram, shoulders merged."""
    cut = max(scores) * min_share
    cand = [i for i, s in enumerate(scores)
            if s >= cut and (i == 0 or s > scores[i - 1]) and (i == len(scores) - 1 or s >= scores[i + 1])]
    peaks, last = [], -9
    for i in cand:
        if i - last > 3:
            peaks.append(i)
            last = i
    gaps = sorted(peaks[j + 1] - peaks[j] for j in range(len(peaks) - 1))
    return (gaps[len(gaps) // 2] if gaps else 0), len(peaks)


cols = [sum(1 for y in range(H) if is_grid(data[x, y])) for x in range(W)]
rows = [sum(1 for x in range(W) if is_grid(data[x, y])) for y in range(H)]
px_pitch, ncol = pitch(cols)
py_pitch, nrow = pitch(rows)
cell_px = (px_pitch + py_pitch) / 2.0
print('\ngrid pitch: %d vertical lines at %s px, %d horizontal at %s px -> a cell is ~%.1f px'
      % (ncol, px_pitch, nrow, py_pitch, cell_px))

redxy = [(x, y) for y in range(H) for x in range(W) if is_red(data[x, y])]
if redxy and cell_px:
    xs = [p[0] for p in redxy]
    ys = [p[1] for p in redxy]
    long_axis = max(max(xs) - min(xs), max(ys) - min(ys))
    thick = float(len(redxy)) / max(1, long_axis)
    print('red stroke: %d px, spans %d px (%.2f cells), mean thickness %.1f px = %.2f of a cell'
          % (len(redxy), long_axis, long_axis / cell_px, thick, thick / cell_px))
    print('   -> a theme that wants that pen sets --winpen to %.2f' % (thick / cell_px))
else:
    print('red stroke: none found with that predicate')


# The theme as it is written into match5.html, checked against the picture's own numbers. The bar
# is WCAG's: 4.5:1 for text, 3:1 for a graphic object such as a stone. The grid is a graphic
# object too, but one that is meant to recede, so its number is reported rather than judged.
CAND = {
    'page': (0xE8, 0xEC, 0xEF), 'panel': (0xFC, 0xFC, 0xFC), 'felt': (0xFC, 0xFC, 0xFC),
    'grid': (0xA8, 0xD8, 0xE4), 'ink': (0x10, 0x15, 0x1A), 'dim': (0x46, 0x54, 0x5F),
    'label': (0x64, 0x74, 0x7F), 'X': (0x00, 0x00, 0xFC), 'O': (0x0D, 0x11, 0x17),
    'win': (0xFF, 0x00, 0x00), 'accent': (0x1F, 0x6D, 0x8F), 'accent text': (0xFF, 0xFF, 0xFF),
}
PAIRS = [('ink', 'panel', 4.5), ('dim', 'panel', 4.5), ('label', 'panel', 4.5),
         ('X', 'felt', 3.0), ('O', 'felt', 3.0), ('win', 'felt', 3.0),
         ('grid', 'felt', 0.0), ('accent', 'panel', 3.0), ('accent text', 'accent', 4.5),
         ('panel', 'page', 1.0), ('ink', 'page', 4.5)]
print('\npaper theme, checked:')
for a, b, bar in PAIRS:
    r = ratio(CAND[a], CAND[b])
    tag = 'report' if bar == 0 else ('ok' if r >= bar else 'FAIL bar %.1f' % bar)
    print('   %-11s on %-6s  %5.2f:1  %s' % (a, b, r, tag))
