"""Lighter strokes for a hieroglyph font, so its signs match the line weight of
Noto Sans Egyptian Hieroglyphs (about 4 px at 200 px; NewGardiner is about
8.5, Magna about 7.4).

FontForge's Change Weight (a negative stroke width eats into every outline)
does the thinning. Only the outlines are taken from its output: they are
copied into the original font, so every other table (GSUB, GPOS, cmap,
metrics) stays exactly as it was. Each thinned sign is checked against the
original: a sign whose thin lines break up, that shrinks too much, or whose
overlap removal went wrong (ink outside the original, a figure filled solid)
is tried again at the next, gentler weight, and keeps its original outline
if every weight fails.

Needs FontForge on the PATH (apt install fontforge), fontTools, Pillow, scipy.
"""
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

FF_SCRIPT = r'''
import fontforge, sys
f = fontforge.open(sys.argv[1])
w = float(sys.argv[3])
todo = set(map(int, open(sys.argv[4]).read().split()))
f.selection.none()
for g in f.glyphs():
    if g.unicode in todo:
        f.selection.select(("more",), g.glyphname)
f.changeWeight(w, "LCG", 0, 0, "auto")
f.generate(sys.argv[2])
'''


def _ink(path, ch, size=200):
    font = ImageFont.truetype(str(path), size)
    im = Image.new('L', (size * 3, size * 3), 0)
    ImageDraw.Draw(im).text((size, size), ch, font=font, fill=255)
    return np.array(im) > 96


def _ok(orig, thin):
    """The thinned ink must lie inside the original, keep a fair part of it,
    and not break into many more pieces."""
    a = orig.sum()
    if a < 30:
        return True
    t = thin.sum()
    if t < 0.25 * a:
        return False
    outside = (thin & ~ndimage.binary_dilation(orig, iterations=2)).sum()
    if outside > 0.01 * a:
        return False
    n_orig = ndimage.label(orig)[1]
    n_thin = ndimage.label(thin)[1]
    return n_thin <= n_orig + max(2, n_orig // 5)


def thin_font(src, weights):
    """Return (TTFont with thinned hieroglyph outlines, {weight: number of
    signs thinned at it}, [glyph names kept as they were]). weights: font
    units, strongest first, e.g. (-12, -8, -4)."""
    src = Path(src)
    font = TTFont(src)
    font.flavor = None
    cmap = font.getBestCmap()
    glyf = font['glyf']
    todo = {cp: name for cp, name in cmap.items() if cp >= 0x13000}
    orig = {cp: _ink(src, chr(cp)) for cp in todo}
    done = {}
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / 'thin.py'
        script.write_text(FF_SCRIPT)
        for weight in weights:
            if not todo:
                break
            out = Path(tmp) / f'thin{weight}.ttf'
            lst = Path(tmp) / 'todo.txt'
            lst.write_text(' '.join(map(str, todo)))
            subprocess.run(['fontforge', '-lang=py', '-script', str(script), str(src), str(out), str(weight), str(lst)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            thin = TTFont(out)
            thin_cmap = thin.getBestCmap()
            thin_gs = thin.getGlyphSet()
            n = 0
            for cp, name in sorted(todo.items()):
                if cp not in thin_cmap or not _ok(orig[cp], _ink(out, chr(cp))):
                    continue
                pen = TTGlyphPen(None)
                thin_gs[thin_cmap[cp]].draw(pen)
                g = pen.glyph()
                g.recalcBounds(glyf)
                glyf[name] = g
                adv, _ = font['hmtx'][name]
                font['hmtx'][name] = (adv, getattr(g, 'xMin', 0))
                del todo[cp]
                n += 1
            done[weight] = n
            thin.close()
    return font, done, sorted(todo.values())
