#!/usr/bin/env node
// Cache-bust local JS/CSS references by stamping each with a content hash.
//
// Static GitHub-Pages site, no HTML build step, so bare `src="export.js"` tags
// get served stale after a deploy (this masked a fixed PDF-export bug for a
// whole session — see ΙΕΡΟΓΛΥΦΩ/BUGS.md). This rewrites every local `.js`/`.css`
// reference to `file.ext?v=<hash>`: change a file and its hash (and URL) change,
// so browsers refetch; leave it unchanged and the URL is stable, so it stays
// cached. Re-run after editing assets, before committing. Idempotent.
//
//   node tools/cache-bust.mjs [file.html ...]   (default: ΙΕΡΟΓΛΥΦΩ/index.html)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push(resolve(repoRoot, 'ΙΕΡΟΓΛΥΦΩ/index.html'));

// (src|href)="path.js|css" with an optional existing ?v=... we replace.
const REF = /\b(src|href)="([^"?#]+\.(?:js|css))(?:\?v=[^"]*)?"/g;

let totalChanged = 0;
for (const htmlPath of targets) {
    const html = readFileSync(htmlPath, 'utf8');
    const htmlDir = dirname(htmlPath);
    let changed = 0;

    const out = html.replace(REF, (whole, attr, url) => {
        if (/^(?:https?:)?\/\//.test(url) || url.startsWith('data:')) return whole; // external
        const assetPath = resolve(htmlDir, url);
        if (!existsSync(assetPath)) {
            console.warn(`  ! skipped (missing): ${url}`);
            return whole;
        }
        const hash = createHash('sha256').update(readFileSync(assetPath)).digest('hex').slice(0, 8);
        const next = `${attr}="${url}?v=${hash}"`;
        if (next !== whole) changed++;
        return next;
    });

    if (out !== html) { writeFileSync(htmlPath, out); totalChanged += changed; }
    console.log(`${htmlPath}: ${changed} reference(s) stamped`);
}
console.log(`Done — ${totalChanged} reference(s) updated.`);
