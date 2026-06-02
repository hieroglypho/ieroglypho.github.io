# ΙΕΡΟΓΛΥΦΩ share shortener (Cloudflare Worker)

Turns the editor's long `…/#c=<packed>` share URLs into short, permanent ones
like `https://hieroglyphica-share.<you>.workers.dev/s/Ab3kQ`.

- `POST /` `{ "url": "https://…/#c=…" }` → `{ "id", "url" }`
- `GET /s/:id` → **302 redirect** to the stored long URL (the editor opens it
  exactly like a pasted `#c=` link, so no editor loading code changes)

Storage is a KV namespace (`LINKS`); entries never expire.

## One-time deploy

You need a (free) Cloudflare account and the Wrangler CLI:

```bash
npm install -g wrangler        # or: npx wrangler ...
cd share-worker
wrangler login                 # opens a browser to authorise

# 1) create the KV store, then paste the printed id into wrangler.toml
wrangler kv namespace create LINKS

# 2) deploy
wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g.
`https://hieroglyphica-share.<you>.workers.dev`.

## Point the editor at it

In `ΙΕΡΟΓΛΥΦΩ/index.html`, set the global before the editor scripts load:

```html
<script>window.SHARE_API = 'https://hieroglyphica-share.<you>.workers.dev';</script>
```

(There's a commented placeholder there already.) Leave it unset/empty and the
editor simply falls back to the long in-URL link — nothing breaks.

## Optional: serve short links from your own domain

Add a route so links read `hieroglyphica.org/s/Ab3kQ` instead of `*.workers.dev`:

1. In the Cloudflare dashboard, add `hieroglyphica.org` as a zone (or use an
   existing one).
2. Add a Worker route: `hieroglyphica.org/s/*` → this Worker, and also
   `hieroglyphica.org/` for the POST (or keep POSTing to the workers.dev origin).
3. Set `window.SHARE_API = 'https://hieroglyphica.org'`.

## Notes

- The Worker only accepts URLs that start with the live editor origins and
  contain `#c=` (see `ALLOWED_ORIGINS` / `SITE_PREFIXES` in `src/index.js`), and
  caps size at 96 KB — keep those lists in sync with where the editor is hosted.
- Free tier limits (100k reads/day, 1k writes/day, 1 GB) are far beyond this
  use; entries are tiny.
