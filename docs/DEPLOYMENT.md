# Production deployment — 7 October 2026

Canonical site: https://diypokecard.com. `www` redirects to the apex for public pages. APIs remain reachable on both hostnames for webhook compatibility.

Current verified release: `099b8a9f-f453-4fee-bfe9-465219c87b98` (twelve real-model examples, free-text ideas, drawing reference flow, new ideas guide and social preview). Based on latest commit `100ecc9`; analytics, weekly reports and separate trial/paid ceilings are preserved. No schema migration was needed; `0002_analytics.sql` remains applied. Previous verified analytics release: `7310f98c-8ccf-4fb5-a282-7f1c3b5c6f70`. AI, email and payments are enabled.

## Cloudflare resources

Account: KEVV AI LABS INC. (`3dece8c6e6159891f5934007a97d81d3`).

| Resource | Name / identifier |
|---|---|
| Worker | `diypokecard` |
| Temporary Worker URL | `https://diypokecard.okjusthere.workers.dev` |
| D1 | `diypokecard-production` / `003c7433-3a08-4fe4-b743-ea7aea063f4c` |
| R2 (private) | `diypokecard-artwork` |
| DNS zone | `197fe41bc853aaa3bf6da693747f6e77` |
| Email sender | `studio@diypokecard.com` |
| Image model | `@cf/black-forest-labs/flux-2-klein-9b` |
| Optional character text | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Recovery cron | Every 15 minutes; returns credits reserved longer than 20 minutes |

There is no user or credit migration. The previous Railway project was not present in the authenticated Railway account. Its old `www` CNAME and verification TXT were removed, along with the placeholder apex A record; Workers Custom Domains now own the web routing. The former apex-to-www redirect is disabled. Google Search Console verification remains.

## Release

Use Node 22+ and the existing Wrangler login:

```sh
npm ci
npm test
npm run build
npm run db:migrate
npm run deploy
```

`wrangler.jsonc` contains only non-secret configuration. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with `wrangler secret put`. Never use an expiring Stripe CLI key as the production application key. Do not put credentials in `vars`, public assets, logs, screenshots, or Git.

`AI_ENABLED`, `EMAIL_ENABLED`, and `PAYMENTS_ENABLED` control feature availability. Checkout is additionally gated on AI, email, and a Stripe secret, so the app does not sell unusable credits.

Native Cloudflare bindings provide AI, D1, R2 and transactional email; they do not need third-party provider keys. DNS sender verification is configured. Cloudflare reports the single owner-authorized test email as delivered (one sent, one delivered), and the owner confirmed receiving it. Owner sign-in is not yet verified.

## Payments

Stripe account `acct_1SzMK3GS6DZ8N1FC` (Kevv AI Labs Inc.). This is a shared account: never change global branding, account support details, or unrelated products/webhooks.

| Plan | Credits | USD | Product | Price |
|---|---:|---:|---|---|
| Starter | 15 | 4.99 | `prod_VOikEH8urjd28E` | `price_1UNvJMGS6DZ8N1FCiDWUpXwP` |
| Family | 40 | 9.99 | `prod_VOiukiIcMFot6l` | `price_1UNvSSGS6DZ8N1FCHiT6Oq5w` |
| Creator | 90 | 19.99 | `prod_VOivSXO0BvWFXP` | `price_1UNvTzGS6DZ8N1FClbtgHokv` |

The application creates one-time Checkout sessions with app/account/plan metadata on both the Checkout Session and PaymentIntent. Fulfillment requires exact app, active plan, amount, currency and credit quantity. Signed webhooks and the return-page verifier use the same idempotent ledger entry. Foreign app events are ignored. No shared-account customer email lookup or global branding change is needed during checkout.

Webhook `we_1T70q7GS6DZ8N1FCpLpQ67XO` is named “DIY Poké Card — production”, points to `https://diypokecard.com/api/webhook`, and listens for Checkout completed, async success and async failure. Its signing secret has been installed in Worker Secrets.

Activated: the dedicated restricted key “DIY Poké Card production checkout” (Checkout Sessions write, Products/Prices read) is installed as `STRIPE_SECRET_KEY`; `PAYMENTS_ENABLED=true`. A live Checkout session created through the production API showed the correct one-time price and site return links. Correctly signed foreign events return 200/ignored, forged signatures return 400. No live charge was made; settled-payment fulfillment is covered by automated tests, not a real charge.

Checkout uses this site's name, icon and colors through session-level branding. Adaptive Pricing is disabled per session so checkout stays in USD, matching the exact amount/currency fulfillment guard. Shared-account branding and other apps are unchanged. See [Stripe Checkout parameters](https://docs.stripe.com/api/checkout/sessions/create).

## Data and operations

- Manual photos and collections remain in IndexedDB. There is no cloud collection sync.
- AI photo inputs are resized to 480 pixels on the longest side before upload. Generated images are stored privately in R2; D1 tracks ownership and card data.
- Image requests require the owner’s HttpOnly session; private API responses are never cached.
- Account sign-in links expire after 20 minutes, use hashed single-use secrets and require a confirmation POST so mail scanners do not consume them.
- D1 atomic batches reserve/refund credits. Browser recovery saves the request ID before inference and reuses it after a lost response.
- Promotional trials have a per-connection daily guard; paid accounts have a higher hourly generation limit. Trials and paid generations use separate daily ceilings, `AI_TRIAL_DAILY_LIMIT` (100) and `AI_PAID_DAILY_LIMIT` (1,000), so free use cannot block a paying customer. Accounts without credits are rejected before they count toward either ceiling. The trial ceiling is the free-cost budget; the paid ceiling is only a runaway guard. Watch the cap-hit lines in the weekly report before raising either.
- The scheduled recovery job clears expired session/token/rate-limit data. Source photo uploads are not retained by the application after inference; generated images persist until account deletion. Do not describe local backups as server backups.
- R2 is private; never enable public bucket access to simplify previews.
- Payment refunds/disputes are handled operationally in Stripe; automatic refund-driven credit revocation is not implemented. Review unused credits when processing refunds.

## Analytics and weekly report

Migration `0002_analytics.sql` adds aggregate, cookie-free counting. The Worker counts human page navigations (browser `Sec-Fetch-Dest: document`, excluding known bots and prefetches), daily unique visitors, landing pages and referrer categories (search, social, AI assistant, direct, other). The studio sends `navigator.sendBeacon` events to `POST /api/event?e=<name>` for a fixed list of feature names: edit, photo, save, png, keepsake, print, credits_open, surprise, duel, idea_start, example_remix and ideas_filter. Each event name counts at most once per page load. The endpoint runs before session handling, so beacons never create anonymous accounts. Visitor hashes use a random per-day salt; both are deleted after two days, leaving only daily totals in `daily_metrics`. AI cap hits and blocked franchise names are counted too.

Every Monday at 13:00 UTC (`0 13 * * 1`), the Worker emails a Chinese-language summary of the previous Monday–Sunday (UTC) compared with the week before. It covers traffic, the creation funnel, trial and paid generations, failures, cap hits, checkouts, revenue and estimated contribution. Set the recipient as a secret so the address stays out of Git:

```sh
npx wrangler secret put REPORT_EMAIL
```

Without `REPORT_EMAIL` the report is skipped. For an on-demand look at the last seven days of counts, run `npm run stats`.

AI-generated card text and photo-mode titles that contain well-known franchise names fall back to original text. Custom ideas accept 8–400 characters, reject known franchise names, and require a valid family-friendly JSON brief before image generation. Invalid or rejected briefs refund the reservation. The parser supports Workers AI object responses, string JSON and OpenAI-style choices; structured JSON output is requested. Legacy menu-option requests still work. A photo of a franchise toy is still restyled as photographed; that is a known gap.

## Rollback

Use `wrangler deployments list` and `wrangler rollback <version-id>` for Worker code/config. D1 and R2 data are not rolled back with code. Keep schema changes additive and verify compatibility before rollback. The initial verified pre-payment version is `774cf85e-d67f-4279-a9f5-7211be9428e3`.

## Inspiration release verification

Released from the latest `100ecc9` base on 7 October 2026. All 27 tests pass. Production pages and www redirect were checked; all 24 public illustration/card-thumbnail assets matched local bytes and both source sketches returned successfully. AI, AI photo and payments capabilities remained enabled. A separate live browser check generated a new original “TeaPet” idea, displayed the reveal and saved it to the local collection. Its single free trial credit was restored after the check; that one successful trial remains in operational generation counts. No payment was charged and no emails were sent during this release.

The disposable gallery QA account, its synthetic credit ledger/attempts and 12 private R2 objects were removed after backup and publication. This keeps internal gallery production out of customer paid-generation totals. Public gallery images and provenance remain in Git; verified original outputs and a QA data backup remain locally under ignored `.deployment-private/`. Existing customer accounts, payments, secrets, weekly recipient, rate-limit configuration and cron schedules were preserved.
