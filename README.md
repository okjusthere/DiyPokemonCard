# DIY Poké Card — Little Legends Studio

A complete rebuild of the free, family-friendly card-making experience. The studio works without AI credentials: start with an original companion or a local photo, personalize the card, and keep something you can actually play with.

## Production and local development

Production is [diypokecard.com](https://diypokecard.com), hosted on Cloudflare Workers with static assets, D1, private R2, Workers AI and Cloudflare Email Service. The original Railway infrastructure is retired. No legacy user or credit migration is required.

Use Node.js 22+:

```sh
npm ci
npm run build
npx wrangler d1 migrations apply diypokecard-production --local
npm run dev:worker
```

For a frontend-only local preview, the older Node harness remains available with `PORT=3100 DB_PATH=/tmp/diypoke-studio-dev.db npm run dev`. It is not the production backend. Use `wrangler dev` to exercise the new runtime; remote AI calls may incur provider usage.

## What works

- Three original illustrated companions; editable name, energy, HP, move, damage, ability, and creator name.
- Classic and full-art layouts; matte, holo, and cosmic finishes; 2D view, pointer/keyboard 3D tilt, and a reversible card back.
- Local JPEG/PNG/WebP photos, crop positioning and zoom. Images resize in the browser; manual editing does not upload photos.
- Undo/redo, automatic local drafts, a collection of up to 60 cards, editable JSON backup/import, and undo after removing a card.
- 945 × 1,320 PNG downloads and self-contained interactive HTML keepsakes with embedded art.
- A4/Letter print sheets at 63 × 88 mm, nine cards per page, cut guides, and a 50 mm calibration line.
- Surprise-card reveals, twelve starter ideas, creative challenges, and a simple two-player stat comparison game.
- Server-rendered search landing pages, canonical URLs, social preview, structured data, sitemap, real 404s, and self-hosted fonts.
- Cloudflare AI creature creation and photo transformation, Stripe one-time credit packs, private artwork links and email account restore. Lost responses can be recovered with the same generation ID without another charge.
- Cookie-free aggregate usage counts, separate free-trial and paid AI ceilings, franchise-name fallback on AI card text, and a weekly owner email report.

The 3D experience is an interactive card with simulated reflections, not a generated 3D creature model. The initial public interface is English for an international search audience. This is an independent fan-made tool, not an official Pokémon product.

## Project map

| File | Responsibility |
|---|---|
| `lib/site.js` | Server-rendered home, studio, guides, policy pages, metadata and sitemap |
| `public/card-model.js` | Shared input normalization, safe SVG renderer and templates |
| `public/studio.js` | Editing, IndexedDB, photos, exports, print, game and service integration |
| `public/styles.css` | Design system, responsive layouts, effects and print dimensions |
| `worker/` | Production routing, accounts, D1 credit ledger, R2 artwork, Stripe and email |
| `wrangler.jsonc`, `migrations/` | Cloudflare resources, feature gates and schema |
| `lib/pricing.json` | Current one-time AI packs |
| `app.js` | Legacy local preview/test harness, not deployed |
| `public/art/` | Original generated companion artwork, optimized WebP |
| `public/fonts/` | Self-hosted Outfit and DM Sans, with SIL OFL licenses |
| `scripts/build-social-image.js` | Regenerates the social preview and touch icon |
| `test/` | Service, card, SSR, route and artwork-isolation tests |

## Deployment and configuration

See [deployment runbook](docs/DEPLOYMENT.md) for resources, feature flags, secrets, operations and rollback. See [pricing research](docs/PRICING.md) for market benchmarks and launch assumptions. AI and email use native Cloudflare bindings. Stripe uses a dedicated restricted secret, a webhook signing secret and three explicit price IDs; no credentials belong in Git.

```sh
npm test
npm run build
npm run db:migrate
npm run deploy
```

The studio is English for an international search audience. Search landing pages are generated as complete HTML at build time; `studio` and private APIs are excluded from indexing. There is no promise of SEO rankings or AI-answer citations.

See [QA evidence](docs/QA.md), [product direction](docs/PRODUCT-DIRECTION.md), and [artwork provenance](docs/ARTWORK.md). Physical printer output and future traffic/conversion outcomes are not verified by software tests.
