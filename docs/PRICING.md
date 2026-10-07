# Market-based launch pricing

Research checked 7 October 2026. Historical DIY Poké Card prices and customer balances do not inform this relaunch.

## Benchmarks

| Service | Observed offer | Relevance |
|---|---|---|
| [CardMaker](https://cardmaker.org/pricing) | One-time $30 / 120 credits, $80 / 400, $200 / 1,200; subscription options also offered | Paid AI card creation; credits are not necessarily one finished image |
| [TCG Generator](https://tcggenerator.com/credits) | €5 / 10, €10 / 25, €20 / 60, €45 / 150, plus VAT; regeneration bonuses vary | Direct AI card generator; compare credit mechanics and VAT before converting prices |
| [PocketCards](https://pocketcards.net/card-maker) | Free manual card editor and high-resolution PNG | Basic editing/downloads must deliver value without a paywall |
| [DeckMint](https://www.deckmint.com/pricing) | Free credits and paid plans | Credit-to-image denominator unclear; not used as a per-image cost benchmark |

## Launch offer

Manual card creation, personal photo editing, 2D/3D effects, local collections, PNG/interactive exports and printing are free. One promotional AI generation is available subject to anti-abuse limits.

| Pack | Successful AI artworks | One-time USD | Effective USD/artwork |
|---|---:|---:|---:|
| Starter | 15 | 4.99 | 0.333 |
| Family | 40 | 9.99 | 0.250 |
| Creator | 90 | 19.99 | 0.222 |

One credit covers a successful original creature or photo transformation. Technical failures refund the reserved credit. User-requested new variations use a new credit. No subscription or auto-renewal. Credits do not currently have an expiry mechanism; avoid promising perpetual service availability.

This is a launch hypothesis: the smaller first pack lowers the commitment for parents, and the free studio earns trust before asking for payment. Do not claim conversion, retention, organic traffic or profit improvements before measuring them.

## Unit economics

[Cloudflare lists FLUX.2 klein 9B](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/) at $0.015 for the first output megapixel and $0.002 per additional/input megapixel. Text inference, infrastructure, free trials, refunds and support are extra. Real 1,024 × 1,024 creature and photo-transform requests succeeded in launch QA; quality is a more useful gating signal than the lowest theoretical image cost.

Using a deliberately higher planning cost of $0.08 per successful generation and [Stripe domestic card pricing](https://stripe.com/en-us/pricing) of 2.9% + $0.30, estimated contribution before tax, hosting, free trials and support is about 67%, 62% and 60% for these packs. International cards, currency conversion, disputes, refunds and tax treatment can change these figures.

Do not offer unlimited AI. Start with an explicit global usage ceiling and review actual inference failure rate, cost per success, trial-to-purchase conversion, repeat use and support burden before changing pack sizes or adding a subscription.
