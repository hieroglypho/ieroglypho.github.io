# AI ideas — free-tier / zero-cost feature enhancements

Captured 2026-06-02. The platform is a static GitHub Pages site with one
Cloudflare Worker (share links). The point of this list: AI features that cost
**nothing**, mostly *not* about the Egyptian language itself.

## The two patterns that make "free" real
- **Precompute at build time.** Run the model once locally / in CI, ship the
  output as static JSON. Zero runtime cost, no infra, works offline, no keys.
- **On-device in the browser.** Transformers.js (WebGPU/wasm) or Chrome's
  built-in Gemini Nano (`window.ai`) run on the *user's* hardware — free, scales
  infinitely, no Worker load.
- The Worker is the third lever, for the rare thing that needs a live call
  (Cloudflare Workers AI free daily allocation).

## To-do (ranked, best first)
- [ ] **1. Semantic search for help/tutorials.** Upgrade the existing
  `tutorials.html` keyword search so "how do I make a name ring" hits the
  *cartouche* card. Embeddings precomputed at build time → static JSON → query
  embedded on-device. Truly free, lowest risk. **← starting here.**
- [ ] **2. "How do I…?" assistant for the tool.** Grounded (RAG) on existing help
  content via the Worker + a free model. About *using the app*, not Egyptian.
  Reuses #1's embeddings + grounding → low hallucination, free tier fine.
- [ ] **3. Photo cleanup for tracing.** Free Workers-AI image models to
  denoise / upscale / contrast-boost / segment an uploaded stela photo so faint
  signs become traceable. (Use AI only where plain canvas filters fall short.)
- [ ] **4. Spam guard on the "Submit New Hieroglyph" form.** Free text classifier
  on the Worker flags junk before it reaches the maintainer's inbox.
- [ ] **5. AI-localized docs.** Translate help/tutorials into a few languages at
  build time, ship as static pages → multilingual SEO + reach, zero runtime cost.
  (Needs a human proofread per language.)
- [ ] Honorable mentions: Whisper voice dictation of transliteration;
  auto alt-text / OG descriptions for shared compositions.

## Don't (looks like AI, isn't the right tool)
- OG preview images for share links → that's rendering, not AI.
- Typo-tolerance in dictionary search → a fuzzy-match lib beats an LLM and is
  deterministic.

See `tools/build-help-index.mjs` for the #1 build-step sketch.
