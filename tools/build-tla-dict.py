#!/usr/bin/env python3
"""build-tla-dict.py — convert the TLA (Thesaurus Linguae Aegyptiae) lemma list
into the Hieroglyphica dictionary line format, kept in a SEPARATE file.

Source: TLA-lemmata-Wikidata-2024.csv  (BBAW/Saxon Academy, edoc.bbaw.de doc 5402)
License of source data: CC BY-SA 4.0 International.

Because of ShareAlike, this output is published as its own CC BY-SA file and is
NOT merged into the proprietary core dictionary.txt. The app loads it alongside
the core at runtime; only this file carries the CC BY-SA obligation.

Outputs (written to repo root):
  dictionary-tla.txt              — entries WITH an English gloss (ships, loaded)
  dictionary-tla-de-worklist.txt  — German-only entries, held for hand-translation

Line format (matches dictionary.txt / dict-additions.txt):
  glyphs <tab> translit gloss <i> pos </i> <tab> gardiner-codes <tab> credit
Glyph-less lemmata (proper nouns etc.) emit a leading empty glyph column; they
are still findable by transliteration/gloss text in the search.
"""
import csv, json, os, re, sys
from collections import Counter

# Some hieroglyphs fields embed <g>CODE</g> placeholders for signs that have no
# Unicode codepoint (e.g. <g>X9</g>), plus stray zero-width joiners. We split the
# field on those tags so the displayed glyph column stays pure Unicode while the
# Gardiner CODE is still recorded in the codes column at the right position.
G_TAG = re.compile(r"<g>([^<]*)</g>")
ZERO_WIDTH = dict.fromkeys(map(ord, "‌‍"), None)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(HERE, "TLA-lemmata-Wikidata-2024.csv")
GM_PATH  = os.path.join(ROOT, "ΙΕΡΟΓΛΥΦΩ", "gardiner-map.json")
OUT_EN   = os.path.join(ROOT, "dictionary-tla.txt")
OUT_DE   = os.path.join(ROOT, "dictionary-tla-de-worklist.txt")

CREDIT_TAG = "TLA {id} CC BY-SA 4.0"

HEADER = """\
# ============================================================================
#  dictionary-tla.txt — Thesaurus Linguae Aegyptiae lemma list (English glosses)
# ============================================================================
#  Source : Thesaurus Linguae Aegyptiae (TLA), hieroglyphic/hieratic lemma list,
#           Wikidata-linked export 2024. Berlin-Brandenburgische Akademie der
#           Wissenschaften & Saxon Academy of Sciences and Humanities.
#           https://thesaurus-linguae-aegyptiae.de  (edoc.bbaw.de, docId 5402)
#
#  LICENSE: CC BY-SA 4.0 International — https://creativecommons.org/licenses/by-sa/4.0/
#           This file (and any redistribution of it) MUST stay under CC BY-SA 4.0
#           and keep this attribution. It is deliberately SEPARATE from the
#           proprietary core dictionary.txt; the ShareAlike obligation applies to
#           THIS file only, not to the Hieroglyphica core.
#
#  Transliteration follows the Leiden Unified Transliteration (as published by
#  TLA), which differs from the MdC-style transliteration in the core file.
#  Per-line credit column carries the stable TLA lemma ID for citation.
# ============================================================================
"""

HEADER_DE = HEADER.replace(
    "dictionary-tla.txt — Thesaurus Linguae Aegyptiae lemma list (English glosses)",
    "dictionary-tla-de-worklist.txt — TLA lemmata with ONLY a German gloss"
).replace(
    "# ============================================================================\n#  Transliteration",
    "#  WORKLIST: these lemmata had no English gloss in the source. Translate the\n"
    "#  German gloss by hand, then move the line into dictionary-tla.txt.\n"
    "# ============================================================================\n#  Transliteration"
)


def load_gardiner():
    if not os.path.exists(GM_PATH):
        print("WARN: gardiner-map.json not found; codes column will be empty", file=sys.stderr)
        return {}
    return json.load(open(GM_PATH, encoding="utf-8"))


def parse_glyphs(raw, gm, unmapped):
    """Split the raw hieroglyphs field into (clean_unicode_glyphs, gardiner_codes).
    <g>CODE</g> placeholders contribute their CODE to the codes column but no
    visible glyph (the sign has no Unicode form). Unknown Unicode signs are
    counted and rendered '?' so nothing is silently dropped."""
    raw = raw.translate(ZERO_WIDTH)
    glyphs, codes, pos = [], [], 0
    for m in G_TAG.finditer(raw):
        for ch in raw[pos:m.start()]:
            glyphs.append(ch)
            c = gm.get(ch)
            if not c:
                unmapped[ch] += 1
            codes.append(c or "?")
        codes.append(m.group(1).strip())  # the non-Unicode sign's Gardiner code
        pos = m.end()
    for ch in raw[pos:]:
        glyphs.append(ch)
        c = gm.get(ch)
        if not c:
            unmapped[ch] += 1
        codes.append(c or "?")
    return "".join(glyphs), "-".join(codes)


def pos_label(row):
    parts = []
    extra = row["additionalLexicalCategory"].strip()
    if extra:
        parts.append(extra)
    g = row["gender"].strip()
    if g == "masculine":
        parts.append("masc.")
    elif g == "feminine":
        parts.append("fem.")
    base = row["lexicalCategory"].strip() or "lemma"
    return base + (" (" + ", ".join(parts) + ")" if parts else "")


def make_line(row, gm, unmapped):
    glyphs, codes = parse_glyphs(row["hieroglyphs"].strip(), gm, unmapped)
    translit = row["transliterationLUT"].strip()
    senses = row["senses"].strip()
    pos = pos_label(row)
    credit = CREDIT_TAG.format(id=row["tlaID"].strip())
    return f"{glyphs}\t{translit} {senses} <i> {pos} </i>\t{codes}\t{credit}"


def main():
    gm = load_gardiner()
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))
    unmapped = Counter()
    en_lines, de_lines = [], []
    for r in rows:
        line = make_line(r, gm, unmapped)
        (en_lines if r["sensesLanguage"] == "EN" else de_lines).append(line)

    with open(OUT_EN, "w", encoding="utf-8") as f:
        f.write(HEADER)
        f.write("\n".join(en_lines) + "\n")
    with open(OUT_DE, "w", encoding="utf-8") as f:
        f.write(HEADER_DE)
        f.write("\n".join(de_lines) + "\n")

    print(f"rows in        : {len(rows)}")
    print(f"EN  -> {os.path.basename(OUT_EN)} : {len(en_lines)}")
    print(f"DE  -> {os.path.basename(OUT_DE)} : {len(de_lines)}")
    print(f"glyph-less EN lines: {sum(1 for l in en_lines if l.startswith(chr(9)))}")
    if unmapped:
        print(f"unmapped signs (rendered '?'): {len(unmapped)} distinct, "
              f"{sum(unmapped.values())} occurrences; top: {unmapped.most_common(8)}")
    else:
        print("all signs mapped to Gardiner codes")


if __name__ == "__main__":
    main()
