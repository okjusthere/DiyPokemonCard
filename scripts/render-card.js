const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { TYPES, normalizeCard, artBox, svgCard } = require('../public/card-model');
// Composite local artwork explicitly: native SVG rasterizers can omit nested image resources.
async function renderCard(input) {
  const card = normalizeCard(input), original = await loadImage(path.join(__dirname, '../public', card.art));
  const canvas = createCanvas(630, 880), ctx = canvas.getContext('2d'), theme = TYPES[card.type];
  const border = ctx.createLinearGradient(0, 0, 630, 880);
  border.addColorStop(0, '#ffedaa'); border.addColorStop(.4, theme.color); border.addColorStop(.7, '#fff7dd'); border.addColorStop(1, theme.color);
  ctx.fillStyle = border; ctx.beginPath(); ctx.roundRect(0, 0, 630, 880, 36); ctx.fill();
  ctx.fillStyle = theme.pale; ctx.beginPath(); ctx.roundRect(15, 15, 600, 850, 24); ctx.fill();
  const box = artBox(card), scale = Math.max(box.w / original.width, box.h / original.height) * card.zoom;
  const w = original.width * scale, h = original.height * scale;
  ctx.save(); ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, card.layout === 'fullart' ? 23 : 8); ctx.clip();
  ctx.drawImage(original, box.x - (w - box.w) * card.offsetX / 100, box.y - (h - box.h) * card.offsetY / 100, w, h); ctx.restore();
  const overlay = svgCard(card, 'preview').replace(/<image[^>]*\/>/, '').replace(/<rect width="630"[^>]*\/>/, '').replace(/<rect x="15"[^>]*\/>/, '');
  ctx.drawImage(await loadImage(Buffer.from(overlay)), 0, 0, 630, 880);
  return canvas;
}
module.exports = { renderCard };
