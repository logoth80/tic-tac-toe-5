#!/usr/bin/env python3
"""Find an image among the harness's stored attachment objects by what is in it.

The paper theme was measured from a photograph of a game drawn on graph paper. The attachment
store keeps every object ever uploaded under a content hash with no name, so the only way back to
a specific picture is to look for the thing that makes it that picture: a pale sheet, a light-blue
printed grid, and pen strokes in blue, black and red.

Usage: python qa/find-reference.py <dir> [--min-white .35] [--min-grid .02] [--scan 160]

The scan is deliberately coarse - a 160 px copy of each candidate is enough to tell a graph-paper
sheet from a screenshot - and it reports the scores rather than picking one, because the last
judgement is made by looking at the image it points to.
"""
import sys, os

from PIL import Image

TARGETS = {
    'white': ((245, 245, 245), 22),      # the sheet itself
    'grid': ((168, 216, 228), 34),       # #a8d8e4, the printed graph
    'blue': ((0, 0, 255), 90),           # a blue pen
    'black': ((13, 17, 23), 60),         # black ink
    'red': ((255, 0, 0), 90),            # a red pen
}


def fractions(im):
    """Share of pixels within tolerance of each target colour, on a small copy."""
    w, h = im.size
    scale = 160.0 / max(w, h)
    if scale < 1:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    px = list(im.getdata())
    n = len(px)
    out = {}
    for name, (t, tol) in TARGETS.items():
        c = 0
        for r, g, b in px:
            if abs(r - t[0]) <= tol and abs(g - t[1]) <= tol and abs(b - t[2]) <= tol:
                c += 1
        out[name] = c / float(n)
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    d = sys.argv[1]
    min_white, min_grid = 0.35, 0.02
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == '--min-white': min_white = float(args[i + 1])
        if a == '--min-grid': min_grid = float(args[i + 1])
    hits = []
    files = []
    for root, _, names in os.walk(d):
        for nm in names:
            p = os.path.join(root, nm)
            if os.path.getsize(p) < 20000 or os.path.getsize(p) > 8000000:
                continue
            files.append(p)
    print('scanning %d candidate files' % len(files))
    for p in files:
        try:
            with Image.open(p) as im:
                im = im.convert('RGB')
                f = fractions(im)
        except Exception:
            continue
        if f['white'] >= min_white and f['grid'] >= min_grid:
            hits.append((f['grid'], os.path.getsize(p), p, f))
    hits.sort(reverse=True)
    print('%d candidates (sheet + printed grid)' % len(hits))
    for g, size, p, f in hits[:12]:
        print('grid %.3f white %.3f blue %.4f black %.4f red %.4f  %8d  %s' %
              (f['grid'], f['white'], f['blue'], f['black'], f['red'], size, p))
    return 0


if __name__ == '__main__':
    sys.exit(main())
