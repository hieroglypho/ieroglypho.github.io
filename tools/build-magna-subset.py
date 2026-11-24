#!/usr/bin/env python3
"""Build the editor's copy of Hieroglyphica Magna: only the Extended-A signs
that NewGardiner does not have.

The editor draws Egyptian Hieroglyphs Extended-A (U+13460–143FF) with
Hieroglyphica Gardiner Light (NewGardiner by Mark-Jan Nederhof, SIL OFL 1.1,
with lighter strokes: tools/build-gardiner-light.py) and falls back to Magna
for the signs NewGardiner leaves out (568 non-core signs in the NewGardiner
of 2026-11-23). Magna's strokes are made lighter too (tools/thinfont.py), to
match. The full Magna is NOT published: keep it outside this public
repository.

    python3 tools/build-magna-subset.py <full Magna font (.woff2/.ttf/.otf)>

Run it again after every change to Magna or to NewGardiner.ttf. It writes
    ΙΕΡΟΓΛΥΦΩ/fonts/HieroglyphicaExtended-Regular.woff2   (the browser's copy)
    ΙΕΡΟΓΛΥΦΩ/fonts/HieroglyphicaExtended-Regular.ttf     (the PDF export's copy)
and updates the list of Magna's signs (the lines marked MAGNA-RANGES) in
main.css, help-content.html and export.js. Then run tools/cache-bust.mjs.

The TTF's glyph records are padded to 4 bytes: unpadded, fontkit's subsetter
writes a short 'loca' table and every sign comes out blank in the PDF.

Needs fontTools with brotli (pip install fonttools brotli), Pillow, scipy and
FontForge (apt install fontforge).
"""
import re
import sys
import tempfile
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset

sys.path.insert(0, str(Path(__file__).resolve().parent))
from thinfont import thin_font  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent / 'ΙΕΡΟΓΛΥΦΩ'
FONTS = ROOT / 'fonts'
EXT_A = range(0x13460, 0x14400)
WEIGHTS = (-7, -5, -3)   # font units, tried in turn: -7 takes Magna from ~7.4 px at 200 px to ~5.8

COPYRIGHT = ('(c) 2026 M. Mazzon. Outlines drawn by M. Mazzon after the sign images '
             'in Unicode document L2/23-181 (WG2 N5240, ed. M. Suignard).')
DESCRIPTION = ('Egyptian Hieroglyphs Extended-A: the signs NewGardiner leaves out, '
               'used beside NewGardiner in the Hieroglyphica editor.')


def ranges(cps):
    """[0x13460, 0x13461, 0x13470] -> 'U+13460-13461,U+13470'"""
    out, cps = [], sorted(cps)
    i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f'U+{cps[i]:X}' if i == j else f'U+{cps[i]:X}-{cps[j]:X}')
        i = j + 1
    return ','.join(out)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    full = TTFont(src)
    have = {c for c in full.getBestCmap() if c in EXT_A}
    ng = {c for c in TTFont(FONTS / 'NewGardiner.ttf').getBestCmap() if c in EXT_A}
    need = sorted(have - ng)
    if len(have) < len(need) + 100:
        sys.exit(f'{src} has only {len(have)} Extended-A signs: is it the FULL Magna?')
    print(f'Magna {len(have)} Extended-A signs, NewGardiner {len(ng)}, kept in Magna {len(need)}')

    opts = subset.Options()
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    opts.glyph_names = True
    opts.layout_features = ['*']
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=need)
    sub.subset(font)
    for rec in font['name'].names:
        if rec.nameID == 0:
            rec.string = COPYRIGHT
        elif rec.nameID == 10:
            rec.string = DESCRIPTION

    tmp = tempfile.TemporaryDirectory()
    plain = Path(tmp.name) / 'magna-subset.ttf'
    font.flavor = None   # the source may be a woff2: write a plain TTF
    font.save(plain)
    font, done, kept = thin_font(plain, WEIGHTS)
    font.flavor = None
    print('signs thinned by weight:', done, f'- kept at the original weight: {" ".join(kept) or "none"}')

    if 'glyf' in font:
        font['glyf'].padding = 4
    ttf = FONTS / 'HieroglyphicaExtended-Regular.ttf'
    font.save(ttf)
    font.flavor = 'woff2'
    woff2 = FONTS / 'HieroglyphicaExtended-Regular.woff2'
    font.save(woff2)
    tmp.cleanup()
    check = TTFont(ttf)
    if 'glyf' in check:
        for name in check.getGlyphOrder():
            check['glyf'][name].expand(check['glyf'])
    print(f'{woff2.name}: {woff2.stat().st_size:,} bytes; {ttf.name}: {ttf.stat().st_size:,} bytes')

    rng = ranges(need)
    for name, pattern, repl in [
        ('main.css', r"unicode-range: [^;]*; /\* MAGNA-RANGES \*/", f"unicode-range: {rng}; /* MAGNA-RANGES */"),
        ('help-content.html', r"unicode-range: [^;]*; /\* MAGNA-RANGES \*/", f"unicode-range: {rng}; /* MAGNA-RANGES */"),
        ('export.js', r"const MAGNA_RANGES = '[^']*'; // MAGNA-RANGES", f"const MAGNA_RANGES = '{rng}'; // MAGNA-RANGES"),
    ]:
        p = ROOT / name
        text = p.read_text(encoding='utf-8')
        new, n = re.subn(pattern, lambda m: repl, text)
        if n != 1:
            sys.exit(f'{name}: expected one MAGNA-RANGES line, found {n}')
        p.write_text(new, encoding='utf-8')
        print(f'{name}: Magna range updated ({len(need)} signs)')


if __name__ == '__main__':
    main()
