#!/usr/bin/env python3
"""Make the TTF copy of Hieroglyphica Extended that the PDF export embeds.

The editor shows the font from ΙΕΡΟΓΛΥΦΩ/fonts/HieroglyphicaExtended-Regular.woff2,
but the PDF export (pdf-export.js, via fontkit) needs a plain TrueType file. Re-run
this after every change to the woff2, before committing:

    python3 tools/build-pdf-fonts.py

Glyph records are padded to 4 bytes. A plain woff2 -> ttf conversion leaves them
unpadded (padding 1), and fontkit's subsetter then writes a short 'loca' table
with wrong offsets: every Extended-A sign came out blank in the PDF.

Needs fontTools with brotli (pip install fonttools brotli).
"""
from pathlib import Path
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / 'ΙΕΡΟΓΛΥΦΩ' / 'fonts'
src = FONTS / 'HieroglyphicaExtended-Regular.woff2'
dst = FONTS / 'HieroglyphicaExtended-Regular.ttf'

font = TTFont(src)
font.flavor = None
font['glyf'].padding = 4
font.save(dst)

# Check: every glyph must decode again (catches a broken table early).
check = TTFont(dst)
glyf = check['glyf']
for name in check.getGlyphOrder():
    glyf[name].expand(glyf)
print(f'{dst.name}: {len(check.getGlyphOrder())} glyphs, {dst.stat().st_size:,} bytes')
