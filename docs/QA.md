# Verification — 2026-10-07

## Automated checks

`npm test`: 18 passing. Nine existing service tests cover the local preview harness. Four studio tests cover:

- Text escaping, untrusted image rejection, unknown energies and bounded numeric inputs.
- Actual image aspect ratio and continuous photo crop positioning.
- Server-rendered landing pages: one H1, unique canonical/title, readable content, valid JSON-LD, no fabricated rating or FAQPage.
- HTTP routes, 404s, no-store private responses, disabled unconfigured services, image decoding and cross-account artwork isolation.

Additional checks: JavaScript syntax, `git diff --check`, social preview visual inspection and rendered SVG-to-PNG exports.

Five production Worker tests use a real local Miniflare D1 database: concurrent final-credit reservation, exactly-once debit/refund/fulfillment, shared-account Stripe event isolation and signature rejection, single-use restore tokens and cross-account artwork denial, and cached AI recovery without a second charge. Provider failure refunds and retry after a technical failure are covered.

## Real browser checks

Codex in-app browser, `http://localhost:3100`, disposable SQLite database `/tmp/diypoke-studio-dev.db`.

- Desktop 1,280 px and mobile 320 px. Home/editor fit without horizontal scrolling after fixing hero fan/min-content sizing.
- Name and energy editing, classic/full-art, finish selection, 2D/3D and card flip.
- Bundled original test artwork added through the file chooser. Checked zoom/position and downloaded the actual photo-card PNG.
- PNG downloads visually inspected at 945 × 1,320, including artwork, crop and text.
- Local collection saved and preserved across navigation/reload.
- Interactive HTML downloaded; embedded artwork, styling, CSP and JavaScript syntax checked. The browser tool prohibited `file://` opening, so offline execution was not claimed or bypassed.
- Bubbles versus Ember, attack damage selected: expected `Ember wins · 30 to 50` result.
- Letter/sample print tool: nine cards and correct paper state. Physical CSS specifies 63 × 88 mm and explicit pages. No physical printer output tested.
- Unconfigured AI, checkout and email controls show availability messages.

Screenshots are in `docs/screenshots/`. Browser fixtures use original artwork; no child's private photo was uploaded or transmitted.

## Production verification

- Deployed to Cloudflare Worker `diypokecard`, bound to `diypokecard.com` and `www.diypokecard.com`. Apex returns 200; www preserves the path in a 301 to apex.
- Ten public HTML routes return 200 with one H1 and their own canonical. Sitemap, robots.txt and llms.txt return 200. Unknown paths and `/.env` return genuine 404s; private health responses use no-store.
- Real Workers AI creature generation and photo transformation both succeeded, returning visually inspected 1,024 × 1,024 JPEGs. Photo testing used original bundled artwork, not a child's private photo. Images are in private R2 with D1 ownership.
- The production page shows live AI availability and the three current prices. The dedicated Stripe restricted key is installed, and the purchase button is enabled.
- Cloudflare Email domain is enabled with verified DNS. One owner-authorized message to `eric.wei@kevv.ai` was sent from `studio@diypokecard.com`; Cloudflare reports one sent and one delivered. The owner confirmed receiving it. The owner's sign-in click is not verified.
- The three retired Railway/placeholder DNS records are removed; the former apex-to-www redirect is disabled. No legacy users or credits were migrated.
- Live Stripe products/prices exist for $4.99/15, $9.99/40 and $19.99/90. The owner completed Stripe identity verification; both permanent restricted key and webhook signing secret are stored in Cloudflare Secrets. A real live Checkout was created through the production API and opened in Chrome, showing the correct one-time amount, product and return link. No live charge was made.
- A correctly signed foreign-product event returned 200/ignored from the production webhook; a forged signature returned 400. No credits were issued by these probes.
- Production editor changes update the card, survive reload and produce no browser console warnings/errors in the checked flow.
- Final Checkout renders this site's name/icon and USD amount. The cancel link returns to the editor. Both live QA Checkout sessions were expired without payment; the site's verification API reports the expired probe as failed and zero paid credits. Temporary credential/session files were removed after encrypted-secret installation. The owner's original free trial was restored after QA.

## Remaining verification

- Browser interruption and full recovery against the live AI provider; backend retry behavior is covered by automated tests. Broad provider safety/latency evaluation is not complete.
- Real paid settlement has not been tested. Live Checkout creation/rendering and production webhook signature/isolation checks pass; automated tests cover fulfillment and idempotency.
- Owner email sign-in through a real mailbox. Token consumption and scanner-safe confirmation behavior are covered locally.
- Opening downloaded HTML in ordinary desktop/mobile browsers and checking printer scaling on physical A4/Letter paper.
- Safari/iOS, Android, real assistive technology, public Core Web Vitals and real family usability sessions.
- Operational recovery from D1/R2 backups and sustained-load behavior.

No Search Console sitemap submission or public photo gallery was performed. No traffic, ranking or retention improvement is claimed before measurement.

## Inspiration update — 7 October 2026

- Base: latest local/remote `100ecc9`. 27 automated tests passed, including six categories with two valid local assets/recipes each, SSR discovery links, prompt validation, safety-brief failures before image generation, credit refunds and idempotent recovery. Existing payment, access isolation, analytics and weekly-report regressions passed.
- Real production API: 10 text-idea and 2 reference-drawing illustrations succeeded. All public outputs visually reviewed together. Provenance recorded in `gallery-provenance.json`; illustrations have not been retouched. AI details vary from requests.
- Browser: homepage prompt chips and text handoff, category filter, editable example, drawing reference and unchecked consent, nickname edit, collection save, and prompt/reference recovery after reload verified. New example deep links are consumed after initialization so a refresh preserves edits.
- Export: real browser PNG download `Sprout-Scout-card.png` inspected at 945 × 1320, with the correct new illustration and changed title. In-app browser download-event waiting timed out, but the UI completion message and the actual file in Downloads verified completion.
- Responsive: 1280 × 900 desktop, 390 × 844 mobile and 320 × 740 narrow layout checked. No horizontal overflow at 390 or 320. Gallery thumbnails lazy-load, have explicit dimensions, and total gallery imagery (including card previews and sketches) is about 1.6 MB.
- Production browser: custom teapot idea generated successfully, one credit consumed, reveal shown, and card saved. Trial balance restored to its original value after QA. All 12 examples, all 9 energy choices, theme filtering and restored balance verified on the deployed site. No browser errors observed.
- SEO: indexable `/card-ideas` now contains the 12 actual ideas, sources/use guidance and ordinary edit links. Homepage and guide metadata, shared social preview and privacy description updated. No ranking or traffic outcome claimed.
- Release: `099b8a9f-f453-4fee-bfe9-465219c87b98`. Screenshots: `screenshots/inspiration-home.png`, `screenshots/inspiration-gallery.png`.
