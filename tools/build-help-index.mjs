// build-help-index.mjs — SKETCH of the build-time embedding step for semantic
// help/tutorial search (AI-ROADMAP.md item #1).
//
// Runs locally or in CI — NEVER at request time:
//     npm i -D @xenova/transformers
//     node tools/build-help-index.mjs
//
// The model runs on your machine; the only thing shipped to users is the static
// JSON it writes. So there's zero runtime cost, no API, and no key anywhere.
//
// Output → assets/help-index.json : [{ id, title, url, vector }]
//   - vector is L2-normalised, so runtime similarity is a plain dot product.
//   - ~tutorial-card count × 384 floats ≈ a few tens of KB. Tiny.

import { pipeline } from '@xenova/transformers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SRC   = 'tutorials.html';                 // the searchable help library
const OUT   = 'assets/help-index.json';
const MODEL = 'Xenova/all-MiniLM-L6-v2';        // 384-dim, small, strong at search

// --- 1. Pull one document per tutorial card ---------------------------------
// Each <article class="card" id="…" data-tags="…"> with an <h3> is a doc. We
// embed title + tags + body text (tags carry the synonyms you hand-curated, so
// they're gold for matching). Regex is fine for this controlled markup; swap in
// cheerio/jsdom if the HTML ever gets gnarlier.
function extractDocs(html) {
    const docs = [];
    const cardRe = /<article\b([^>]*)>([\s\S]*?)<\/article>/g;
    for (const m of html.matchAll(cardRe)) {
        const attrs = m[1], body = m[2];
        if (!/\bclass="[^"]*\bcard\b/.test(attrs)) continue;

        const id    = (attrs.match(/\bid="([^"]+)"/)        || [])[1];
        const tags  = (attrs.match(/\bdata-tags="([^"]*)"/) || [, ''])[1];
        const title = (body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [, ''])[1]
                        .replace(/<[^>]+>/g, '').trim();        // drop the glyph <span>
        const text  = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        if (id && title) docs.push({ id, title, tags, text, url: `${SRC}#${id}` });
    }
    return docs;
}

// --- 2. Embed each document --------------------------------------------------
async function main() {
    const html = await readFile(SRC, 'utf8');
    const docs = extractDocs(html);
    if (!docs.length) throw new Error('No tutorial cards found — check the markup/selectors.');

    const embed = await pipeline('feature-extraction', MODEL);

    for (const d of docs) {
        const input = `${d.title}. ${d.tags}. ${d.text}`;
        const out = await embed(input, { pooling: 'mean', normalize: true });
        d.vector = Array.from(out.data);     // 384 normalised floats
        delete d.text;                       // keep the shipped JSON lean
        delete d.tags;                       // (title + url + vector is all the runtime needs)
    }

    await mkdir('assets', { recursive: true });
    await writeFile(OUT, JSON.stringify(docs));
    console.log(`Wrote ${OUT}: ${docs.length} docs × ${docs[0].vector.length} dims`);
}

main().catch(e => { console.error(e); process.exit(1); });
