# Original artwork and design assets

Created with the built-in `image_gen` tool on 2026-10-07. Three original creature designs, without official logos, copied character assets or card typography. Production assets are 750 × 1,000 WebP, approximately 183–207 KB each. Editable card typography is rendered separately as SVG.

## Reproducible art-direction prompts

These are complete briefs for reproducing the visual direction, not a byte-for-byte tool-call transcript. Regeneration is stochastic.

**Sparky — `public/art/sparky.webp`**

> Create a premium portrait 3:4 collectible fantasy-creature illustration, artwork only, without text, typography, card frame, logos, or watermark. An original adorable golden electric fox with oversized ears, fluffy pale chest, expressive warm eyes and a sparkling lightning-like tail bounds joyfully above lush floating islands. Bright cerulean sky, soft white clouds, tiny flowers, sunlit grass, dynamic golden electric arcs. Rich hand-painted anime / gouache game illustration, clean expressive character design, intricate luminous background, charming and adventurous for children ages 6–12. Keep the whole central creature readable within a square center crop, leave breathing room around ears and tail. Polished color harmony, detailed but uncluttered, original character rather than a recognizable existing Pokémon.

**Ember — `public/art/ember.webp`**

> Create a premium portrait 3:4 collectible fantasy-creature illustration, artwork only, without text, typography, card frame, logos, or watermark. An original small coral-orange dragon with an endearing brave expression, warm cream belly, teal wing membranes and little horns soaring above a magical volcanic landscape at sunset. Glowing embers, warm peach and golden skies, distant dramatic mountains, richly painted fantasy scenery. Hand-painted anime / gouache game illustration, refined edges and expressive eyes, adventurous and friendly for children ages 6–12. The full creature is the clear center of attention and remains readable in a square center crop. Sophisticated warm/cool contrast, no copied franchise character, beautiful enough to fill a collectible full-art card.

**Bubbles — `public/art/bubbles.webp`**

> Create a premium portrait 3:4 collectible fantasy-creature illustration, artwork only, without text, typography, card frame, logos, or watermark. An original adorable turquoise aquatic axolotl-dragon with soft frilled gills, large bright eyes, a pale belly and a playful flowing tail, swimming among shimmering bubbles in a vivid magical coral reef. Sunbeams filter through clear blue water, tiny jewel-like plants and pebbles add detail, the atmosphere feels welcoming and wondrous. Rich hand-painted anime / gouache game illustration, detailed luminous setting, polished creature design suitable for children ages 6–12. Center the entire creature with generous breathing room so it also works in a square crop. Original creature rather than an existing Pokémon.

## Source files

Original PNGs from this session:

- Sparky: `/Users/weizhengle/.codex/generated_images/01a11615-f49c-7233-9f78-0c1d2f5bc83d/exec-ea24d788-6755-43fe-9daf-3a814f3baf12.png`
- Ember: `/Users/weizhengle/.codex/generated_images/01a11615-f49c-7233-9f78-0c1d2f5bc83d/exec-4f1ae802-553c-44f3-947c-f0fab8734ff1.png`
- Bubbles: `/Users/weizhengle/.codex/generated_images/01a11615-f49c-7233-9f78-0c1d2f5bc83d/exec-574a598c-5fc0-47f9-88d4-e60c556c9a90.png`

Deployable WebP copies are in the repository; deployment does not depend on these local source paths. Resizing/compression used the installed canvas library.

## Other assets

- Original star/card brand mark: `public/images/studio-icon.svg`.
- Social preview: `public/images/og-studio.png`, 1,200 × 630, composed from original artwork and the shared card renderer. Regenerate with `node scripts/build-social-image.js`.
- Touch icon: `public/apple-touch-icon.png`.
- Self-hosted Outfit and DM Sans from the official Google Fonts repository, with SIL Open Font License texts in `public/fonts/`.
- Independently authored card frames, backs, foil gradients and interactions in this project.

Live user-generated artwork uses Cloudflare Workers AI with `@cf/black-forest-labs/flux-2-klein-9b`; optional character text uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Real launch QA generated a blue ice fox and transformed the bundled Ember artwork with this production provider. The three bundled companions above were created with Codex's built-in `image_gen` tool, which did not expose its underlying model ID. They are not evidence of FLUX output quality, and they must not be attributed to a specific GPT Image model without model metadata.
