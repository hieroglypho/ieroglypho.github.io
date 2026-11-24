#!/usr/bin/env python3
"""Build Hieroglyphica Gardiner Light: NewGardiner with lighter strokes.

NewGardiner (Mark-Jan Nederhof, SIL OFL 1.1, fonts/NewGardiner.ttf, the
original file, kept unchanged as the source) draws its lines about twice as
thick as Noto Sans Egyptian Hieroglyphs, so its Extended-A signs looked bold
beside the base signs. This makes a lighter copy (tools/thinfont.py). Under the
OFL a modified version must not use the Reserved Font Name "NewGardiner", so
the copy has its own name; the copyright notice and licence are kept.

    python3 tools/build-gardiner-light.py

Writes ΙΕΡΟΓΛΥΦΩ/fonts/HieroglyphicaGardiner-Light.woff2 (the browser's and
the SVG export's copy) and .ttf (the PDF export's copy). Then run
tools/build-magna-subset.py only if NewGardiner itself changed, and
tools/cache-bust.mjs.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from thinfont import thin_font  # noqa: E402

FONTS = Path(__file__).resolve().parent.parent / 'ΙΕΡΟΓΛΥΦΩ' / 'fonts'
WEIGHTS = (-12, -8, -4)   # font units (1000/em), tried in turn: -12 takes NewGardiner from ~8.5 px at 200 px to ~5.8

FAMILY = 'Hieroglyphica Gardiner Light'
NAMES = {
    0: ('Copyright (c) 2020, Mark-Jan Nederhof (https://github.com/nederhof/newgardiner), '
        'with Reserved Font Name NewGardiner. Lighter strokes: modified by M. Mazzon, 2026.'),
    1: FAMILY,
    2: 'Regular',
    3: 'Hieroglyphica Gardiner Light 2026-11-24',
    4: FAMILY,
    6: 'HieroglyphicaGardiner-Light',
    10: 'NewGardiner by Mark-Jan Nederhof with lighter strokes, for the Hieroglyphica editor.',
    13: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    14: 'https://openfontlicense.org',
}


def main():
    font, done, kept = thin_font(FONTS / 'NewGardiner.ttf', WEIGHTS)
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (16, 17, 21, 22):
            name.removeNames(nameID=rec.nameID)
    for nid, text in NAMES.items():
        name.setName(text, nid, 3, 1, 0x409)
        name.setName(text, nid, 1, 0, 0)
    font['OS/2'].usWeightClass = 400
    font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~0b1100001) | 0b1000000   # REGULAR
    font['head'].macStyle = 0

    font['glyf'].padding = 4   # fontkit (PDF export) needs 4-byte glyph records
    ttf = FONTS / 'HieroglyphicaGardiner-Light.ttf'
    font.save(ttf)
    font.flavor = 'woff2'
    woff2 = FONTS / 'HieroglyphicaGardiner-Light.woff2'
    font.save(woff2)
    print(f'{ttf.name}: {ttf.stat().st_size:,} bytes; {woff2.name}: {woff2.stat().st_size:,} bytes')
    print('signs thinned by weight:', done)
    print(f'{len(kept)} signs kept at the original weight: {" ".join(kept)}')


if __name__ == '__main__':
    main()
