/**
 * ΙΕΡΟΓΛΥΦΩ share shortener — a tiny Cloudflare Worker.
 *
 * The editor already encodes a whole composition into a long `…/#c=<packed>` URL.
 * This Worker just turns that long URL into a short, permanent one:
 *
 *   POST /            { "url": "https://…/#c=…" }  → { id, url: ".../s/Ab3kQ" }
 *   GET  /s/:id                                     → 302 redirect to the long URL
 *
 * Because resolving is a plain redirect, the editor needs ZERO loading changes —
 * the browser follows /s/:id straight to the `#c=` URL it already understands.
 *
 * Storage is a KV namespace bound as `LINKS`. Entries are permanent.
 */

const ALLOWED_ORIGINS = [
    'https://www.hieroglyphica.org',
    'https://hieroglyphica.org',
    'https://ieroglypho.github.io',
    'http://localhost:8137',
    'http://localhost:8000',
];
// A submitted URL must point back at the live editor and carry a composition.
const SITE_PREFIXES = [
    'https://www.hieroglyphica.org/',
    'https://hieroglyphica.org/',
    'https://ieroglypho.github.io/',
];
const MAX_LEN = 96 * 1024;            // generous ceiling; rejects abuse blobs
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function newId(n = 7) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    let s = '';
    for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length];
    return s;
}

function corsHeaders(origin) {
    const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

function json(obj, status, origin) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const origin = req.headers.get('Origin') || '';

        // CORS preflight for the POST.
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        // Create a short link.
        if (req.method === 'POST') {
            let body;
            try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
            const target = (body && body.url || '').toString();

            if (!SITE_PREFIXES.some(p => target.startsWith(p)) || !target.includes('#c=')) {
                return json({ error: 'invalid url' }, 400, origin);
            }
            if (target.length > MAX_LEN) return json({ error: 'too large' }, 413, origin);

            let id = newId();
            for (let i = 0; i < 5 && (await env.LINKS.get(id)) !== null; i++) id = newId();
            await env.LINKS.put(id, target);          // permanent (no expiration)

            return json({ id, url: url.origin + '/s/' + id }, 200, origin);
        }

        // Resolve a short link → redirect to the stored composition URL.
        const m = url.pathname.match(/^\/s\/([0-9A-Za-z]+)$/);
        if (req.method === 'GET' && m) {
            const target = await env.LINKS.get(m[1]);
            if (!target) return new Response('Link not found', { status: 404 });
            return Response.redirect(target, 302);
        }

        if (req.method === 'GET' && url.pathname === '/') {
            return new Response('ΙΕΡΟΓΛΥΦΩ share shortener', { status: 200 });
        }
        return new Response('Not found', { status: 404 });
    },
};
