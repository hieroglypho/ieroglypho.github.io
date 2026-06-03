#!/usr/bin/env python3
# build-gardiner-map.py — regenerate ΙΕΡΟΓΛΥΦΩ/gardiner-map.json
#
#   python3 tools/build-gardiner-map.py
#
# Maps each Egyptian-Hieroglyph code point to its Gardiner code, derived from
# the Unicode character *name* (the block is named by Gardiner number, e.g.
# "EGYPTIAN HIEROGLYPH N035A" -> N35A). This is the same derivation that
# produced column 3 of dictionary.txt, so the JSON reproduces the file's codes.
#
# Codes follow the Unicode convention verbatim (per user preference). Note this
# differs from the legacy bulk of dictionary.txt in exactly one category: the
# file historically wrote Gardiner's "Aa" category as "J" (~5,100 rows), while
# Unicode names it "Aa". New entries therefore use "Aa", matching Unicode and
# the newer Wikidata rows. Existing "J" rows are never rewritten; sorting is by
# the leading glyph itself, so the label divergence does not affect placement.
#
# Output is consumed only by dict-author.js, which is itself localhost-only —
# so this map never ships to / affects the public site.

import unicodedata, re, json, os

NAME_RE = re.compile(r"EGYPTIAN HIEROGLYPH ([A-Z]+)0*(\d+)([A-Z]?)$")
# Egyptian Hieroglyphs (U+13000–U+1342F) + Egyptian Hieroglyphs Extended-A.
RANGES = [(0x13000, 0x1342F), (0x13460, 0x143FA)]
# The Unicode *formal name* spells Gardiner's "Aa" category as "AA"; the
# conventional short code (and the file's 272 existing rows) is "Aa". Fix casing.
CATEGORY_REMAP = {"AA": "Aa"}

def main():
    gmap = {}
    for lo, hi in RANGES:
        for cp in range(lo, hi + 1):
            ch = chr(cp)
            try:
                name = unicodedata.name(ch)
            except ValueError:
                continue
            m = NAME_RE.match(name)
            if not m:
                continue
            cat, num, suf = m.groups()
            cat = CATEGORY_REMAP.get(cat, cat)
            gmap[ch] = f"{cat}{int(num)}{suf}"

    out = os.path.join(os.path.dirname(__file__), "..", "ΙΕΡΟΓΛΥΦΩ", "gardiner-map.json")
    out = os.path.normpath(out)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(gmap, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"wrote {len(gmap)} glyph→Gardiner entries to {out}")
    print(f"unicodedata version: {unicodedata.unidata_version}")

if __name__ == "__main__":
    main()
