require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const nodemailer = require('nodemailer');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Register bundled fonts (works on any server — no system fonts needed)
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'Inter-Regular.ttf'), 'CardFont');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'Inter-Bold.ttf'), 'CardFontBold');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Email transporter ───
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  transporter.verify((err) => {
    if (err) console.log('   Email:    ❌', err.message);
    else console.log('   Email:    ✅ Ready');
  });
} else {
  console.log('   Email:    ❌ (Set EMAIL_USER and EMAIL_PASS in .env)');
}

// ─── AI Pokemon Creator ───
const { AzureOpenAI } = require('openai');
let aiImage = null;  // for DALL-E 3 image generation
let aiChat = null;   // for GPT-5-mini chat completions

if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
  // Azure OpenAI — two clients because the models use different api-versions
  aiImage = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: '2024-02-01',
  });
  aiChat = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: '2025-04-01-preview',
  });
  console.log('   AI:       ✅ Ready (Azure OpenAI)');
} else {
  console.log('   AI:       ❌ (Set AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT in .env)');
}

// Simple rate limiter: max 5 per IP per minute
const aiRateMap = new Map();
function checkAIRate(ip) {
  const now = Date.now();
  const record = aiRateMap.get(ip) || [];
  const recent = record.filter(t => now - t < 60000);
  if (recent.length >= 5) return false;
  recent.push(now);
  aiRateMap.set(ip, recent);
  return true;
}

const COLORS_MAP = {
  red: 'red and orange', blue: 'blue and cyan', green: 'green and emerald',
  yellow: 'yellow and golden', purple: 'purple and violet', pink: 'pink and magenta',
  orange: 'orange and amber', white: 'white and silver'
};
const ANIMALS_MAP = {
  cat: 'cat', dragon: 'dragon', rabbit: 'rabbit', bird: 'bird',
  shark: 'shark', fox: 'fox', turtle: 'turtle', wolf: 'wolf',
  bear: 'bear', unicorn: 'unicorn'
};
const POWERS_MAP = {
  flying: 'majestic wings and ability to fly',
  fire: 'fire flames and glowing embers around it',
  ice: 'ice crystals and frosty aura',
  electric: 'electric sparks and lightning bolts',
  invisible: 'a mysterious translucent ghostly glow',
  water: 'water splashes and ocean waves'
};

const TYPE_EMOJIS = {
  Fire: '🔥', Water: '💧', Grass: '🌿', Electric: '⚡',
  Psychic: '🔮', Ice: '❄️', Ghost: '👻', Normal: '⚪', Flying: '🦅'
};

const TYPE_COLORS = {
  Fire: '#ff6f00', Water: '#1565c0', Grass: '#2e7d32', Electric: '#f9a825',
  Psychic: '#7b1fa2', Ice: '#00838f', Ghost: '#4a148c', Normal: '#757575', Flying: '#3949ab'
};

const CARD_BG_COLORS = {
  Fire: '#fff3e0', Water: '#e3f2fd', Grass: '#e8f5e9', Electric: '#fffde7',
  Psychic: '#f3e5f5', Ice: '#e0f7fa', Ghost: '#ede7f6', Normal: '#fafafa', Flying: '#e8eaf6'
};

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function generateCardImage(imageBuffer, cardData, displayName) {
  // 2x resolution for crisp output
  const SCALE = 2;
  const CW = 630 * SCALE, CH = 880 * SCALE, PAD = 30 * SCALE;
  const IW = CW - PAD * 2, IH = 360 * SCALE, IT = 100 * SCALE;
  const typeName = cardData.type || 'Normal';
  const tc = TYPE_COLORS[typeName] || '#757575';
  const bg = CARD_BG_COLORS[typeName] || '#f7f5e8';
  const a1 = cardData.attack1 || {}, a2 = cardData.attack2 || {};
  const rc = cardData.retreatCost || 1;
  const ay = IT + IH + 20 * SCALE;
  const S = (px) => px * SCALE;

  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d');

  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function circ(cx, cy, r, fill, a = 1) {
    ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  }
  function hl(y, c = '#d0d0d0') {
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CW - PAD, y);
    ctx.strokeStyle = c; ctx.lineWidth = SCALE; ctx.stroke();
  }

  // ── Card background gradient ──
  rr(0, 0, CW, CH, S(24));
  const bgG = ctx.createLinearGradient(0, 0, CW, CH);
  bgG.addColorStop(0, bg); bgG.addColorStop(0.5, '#fffef8'); bgG.addColorStop(1, bg);
  ctx.fillStyle = bgG; ctx.fill();

  // Holographic border
  rr(S(4), S(4), CW - S(8), CH - S(8), S(20));
  const bG = ctx.createLinearGradient(0, 0, CW, CH);
  bG.addColorStop(0, tc); bG.addColorStop(0.25, '#e8c547');
  bG.addColorStop(0.5, tc); bG.addColorStop(0.75, '#e8c547'); bG.addColorStop(1, tc);
  ctx.strokeStyle = bG; ctx.lineWidth = S(8); ctx.stroke();

  // Inner gold trim
  rr(S(16), S(16), CW - S(32), CH - S(32), S(14));
  ctx.strokeStyle = 'rgba(201,168,76,0.5)'; ctx.lineWidth = S(2); ctx.stroke();

  // Shimmer overlay
  const shim = ctx.createLinearGradient(0, 0, CW, CH * 0.5);
  shim.addColorStop(0, 'rgba(255,255,255,0)'); shim.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  shim.addColorStop(0.5, 'rgba(255,255,255,0.14)'); shim.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  shim.addColorStop(1, 'rgba(255,255,255,0)');
  rr(S(16), S(16), CW - S(32), CH - S(32), S(14));
  ctx.fillStyle = shim; ctx.fill();

  // ── Header ──
  ctx.font = `700 ${S(12)}px CardFontBold`; ctx.fillStyle = '#999'; ctx.textAlign = 'left';
  ctx.fillText('BASIC POKÉMON', PAD, S(44));

  ctx.shadowColor = 'rgba(0,0,0,0.1)'; ctx.shadowBlur = S(6); ctx.shadowOffsetY = S(2);
  ctx.font = `700 ${S(34)}px CardFontBold`; ctx.fillStyle = '#1a1a1a';
  ctx.fillText(cardData.name || 'Mysteon', PAD, S(84));
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  ctx.font = `700 ${S(40)}px CardFontBold`; ctx.fillStyle = '#cc0000'; ctx.textAlign = 'right';
  ctx.fillText(String(cardData.hp || 60), CW - PAD, S(76));
  ctx.font = `700 ${S(14)}px CardFontBold`; ctx.fillText('HP', CW - PAD, S(94));
  ctx.textAlign = 'left';

  // ── Image frame with shadow ──
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = S(16); ctx.shadowOffsetY = S(6);
  rr(PAD, IT, IW, IH, S(10)); ctx.fillStyle = '#c9a84c'; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  rr(PAD + S(3), IT + S(3), IW - S(6), IH - S(6), S(8));
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = S(1); ctx.stroke();

  try {
    const img = await loadImage(imageBuffer);
    ctx.save(); rr(PAD + S(5), IT + S(5), IW - S(10), IH - S(10), S(6)); ctx.clip();
    ctx.drawImage(img, PAD + S(5), IT + S(5), IW - S(10), IH - S(10)); ctx.restore();
  } catch (e) { console.error('Failed to load Pokemon image:', e.message); }

  // ── Type badge (pill) ──
  const bW = S(120), bH = S(26), bX = PAD, bY = ay;
  rr(bX, bY, bW, bH, S(13));
  const tbG = ctx.createLinearGradient(bX, bY, bX + bW, bY);
  tbG.addColorStop(0, tc); tbG.addColorStop(1, tc + 'aa');
  ctx.fillStyle = tbG; ctx.fill();
  ctx.font = `700 ${S(12)}px CardFontBold`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText(typeName.toUpperCase(), bX + bW / 2, bY + S(18)); ctx.textAlign = 'left';

  ctx.font = `400 ${S(11)}px CardFont`; ctx.fillStyle = '#999';
  ctx.fillText(`Designed by ${displayName}`, bX + bW + S(12), bY + S(18));

  // ── Attack 1 ──
  const a1Y = ay + S(40); hl(a1Y);
  circ(PAD + S(12), a1Y + S(28), S(10), tc, 0.9);
  circ(PAD + S(34), a1Y + S(28), S(10), '#ccc', 0.6);
  ctx.font = `700 ${S(20)}px CardFontBold`; ctx.fillStyle = '#1a1a1a';
  ctx.fillText(a1.name || 'Tackle', PAD + S(52), a1Y + S(34));
  ctx.font = `700 ${S(30)}px CardFontBold`; ctx.textAlign = 'right';
  ctx.fillText(String(a1.damage || 20), CW - PAD, a1Y + S(36)); ctx.textAlign = 'left';
  ctx.font = `400 ${S(11)}px CardFont`; ctx.fillStyle = '#777';
  ctx.fillText(a1.desc || '', PAD + S(52), a1Y + S(54));

  // ── Attack 2 ──
  const a2Y = a1Y + S(68); hl(a2Y);
  circ(PAD + S(12), a2Y + S(28), S(10), tc, 0.9);
  circ(PAD + S(34), a2Y + S(28), S(10), tc, 0.6);
  circ(PAD + S(56), a2Y + S(28), S(10), '#ccc', 0.5);
  ctx.font = `700 ${S(20)}px CardFontBold`; ctx.fillStyle = '#1a1a1a';
  ctx.fillText(a2.name || 'Strike', PAD + S(74), a2Y + S(34));
  ctx.font = `700 ${S(30)}px CardFontBold`; ctx.textAlign = 'right';
  ctx.fillText(String(a2.damage || 40), CW - PAD, a2Y + S(36)); ctx.textAlign = 'left';
  ctx.font = `400 ${S(11)}px CardFont`; ctx.fillStyle = '#777';
  ctx.fillText(a2.desc || '', PAD + S(74), a2Y + S(54));

  // ── Bottom stats ──
  const sY = a2Y + S(72); hl(sY, '#c0c0c0');
  ctx.font = `700 ${S(10)}px CardFontBold`; ctx.fillStyle = '#999'; ctx.textAlign = 'center';
  ctx.fillText('WEAKNESS', CW * 0.17, sY + S(20));
  circ(CW * 0.17 - S(8), sY + S(38), S(10), TYPE_COLORS[cardData.weakness] || '#757575');
  ctx.font = `700 ${S(15)}px CardFontBold`; ctx.fillStyle = '#333';
  ctx.fillText('\u00d72', CW * 0.17 + S(12), sY + S(42));

  ctx.font = `700 ${S(10)}px CardFontBold`; ctx.fillStyle = '#999';
  ctx.fillText('RESISTANCE', CW * 0.5, sY + S(20));
  circ(CW * 0.5 - S(10), sY + S(38), S(10), TYPE_COLORS[cardData.resistance] || '#757575');
  ctx.font = `700 ${S(15)}px CardFontBold`; ctx.fillStyle = '#333';
  ctx.fillText('-20', CW * 0.5 + S(10), sY + S(42));

  ctx.font = `700 ${S(10)}px CardFontBold`; ctx.fillStyle = '#999';
  ctx.fillText('RETREAT', CW * 0.83, sY + S(20));
  for (let i = 0; i < rc; i++) {
    const cx = CW * 0.83 - (rc - 1) * S(10) + i * S(20);
    circ(cx, sY + S(38), S(9), '#e0e0e0');
    ctx.beginPath(); ctx.arc(cx, sY + S(38), S(9), 0, Math.PI * 2);
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = SCALE; ctx.stroke();
  }

  // ── Flavor text (word-wrapped) ──
  const fY = sY + S(58); hl(fY, '#ddd');
  ctx.font = `italic ${S(12)}px CardFont`; ctx.fillStyle = '#888'; ctx.textAlign = 'left';
  const flav = cardData.flavor || 'A creature born from imagination.';
  const mxW = CW - PAD * 2;
  let ln = '', lnY = fY + S(22);
  for (const w of flav.split(' ')) {
    const t = ln + w + ' ';
    if (ctx.measureText(t).width > mxW && ln) { ctx.fillText(ln.trim(), PAD, lnY); ln = w + ' '; lnY += S(16); }
    else ln = t;
  }
  if (ln.trim()) ctx.fillText(ln.trim(), PAD, lnY);

  // ── Footer ──
  ctx.font = `400 ${S(10)}px CardFont`; ctx.fillStyle = '#bbb'; ctx.textAlign = 'center';
  ctx.fillText(`DIY Pokemon Card Collection \u00b7 YBP-${Date.now().toString().slice(-4)}`, CW / 2, CH - S(22));

  return canvas.toBuffer('image/jpeg', { quality: 95 });
}

app.post('/api/ai/pokemon-create', async (req, res) => {
  if (!aiImage || !aiChat) return res.status(503).json({ error: 'AI service not configured' });

  const ip = req.ip || req.connection.remoteAddress;
  if (!checkAIRate(ip)) return res.status(429).json({ error: 'Too many requests — please wait a minute! ⏳' });

  const { color, animal, power, kidName, email } = req.body;
  if (!color || !animal || !power) return res.status(400).json({ error: 'Missing fields' });

  const colorDesc = COLORS_MAP[color] || color;
  const animalDesc = ANIMALS_MAP[animal] || animal;
  const powerDesc = POWERS_MAP[power] || power;

  const prompt = `A cute chibi-style fictional creature (NOT a real Pokemon, an original design) that looks like a ${colorDesc} ${animalDesc} with ${powerDesc}. Friendly happy expression, big sparkling eyes, round proportions, pastel colors, clean white background. Digital art style similar to Japanese anime creature design. High quality, vibrant.`;

  try {
    // Generate image
    const imageResp = await aiImage.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });
    const imageUrl = imageResp.data[0].url;

    // Generate full card stats
    const cardResp = await aiChat.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{
        role: 'system',
        content: `You create Pokemon trading card data. Respond ONLY with valid JSON, no markdown. Format:
{"name":"CuteName","hp":60,"type":"Fire","attack1":{"name":"Ember Pounce","damage":20,"desc":"Flip a coin. If heads, the opponent is now Burned."},"attack2":{"name":"Flame Whirl","damage":40,"desc":"Discard 1 Energy card."},"weakness":"Water","resistance":"Grass","retreatCost":1,"flavor":"A playful creature found near volcanoes, always smiling."}
Rules: name max 12 chars, cute & easy to pronounce for 6-year-olds. HP between 40-90. Attack damage 10-50. Keep descriptions short and fun. Type should match the creature's power.`
      }, {
        role: 'user',
        content: `Create card data for a ${colorDesc} ${animalDesc} creature with ${powerDesc}`
      }],
      max_completion_tokens: 250,
      response_format: { type: 'json_object' },
    });

    let cardData;
    try {
      cardData = JSON.parse(cardResp.choices[0].message.content);
    } catch {
      cardData = { name: 'Mysteon', hp: 60, type: 'Normal', attack1: { name: 'Tackle', damage: 20, desc: '' }, attack2: { name: 'Quick Strike', damage: 30, desc: '' }, weakness: 'Fighting', resistance: 'Ghost', retreatCost: 1, flavor: 'A mysterious creature born from pure imagination!' };
    }
    const pokemonName = cardData.name;

    // Send email if provided
    let emailSent = false;
    if (email && transporter) {
      const displayName = kidName || 'Pokemon Trainer';
      try {
        // Download DALL-E image and generate card JPEG
        const rawImgBuffer = await downloadImageBuffer(imageUrl);
        const cardImgBuffer = await generateCardImage(rawImgBuffer, cardData, displayName);
        console.log(`   Generated card image: ${cardImgBuffer.length} bytes`);

        await transporter.sendMail({
          from: `"DIY Pokemon Card 🃏" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: `🃏 ${displayName}'s Pokemon Card — ${pokemonName}!`,
          attachments: [
            { filename: `${pokemonName}-card.jpg`, content: cardImgBuffer, cid: 'pokemoncard' },
            { filename: `${pokemonName}-original.jpg`, content: rawImgBuffer, cid: 'pokemonraw' },
          ],
          html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#0a0e1a; font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a; padding:20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1245; border-radius:20px; overflow:hidden; border:2px solid #FFD700;">

        <tr><td style="padding:30px 40px 16px; text-align:center;">
          <div style="font-size:26px; font-weight:bold; color:#FFD700;">🃏 Your Pokemon Trading Card!</div>
          <div style="font-size:13px; color:rgba(255,255,255,0.5); margin-top:6px;">Created with DIY Pokemon Card Maker</div>
        </td></tr>

        <!-- Pokemon Card Image -->
        <tr><td style="padding:0 40px; text-align:center;">
          <img src="cid:pokemoncard" alt="${pokemonName} Card" style="width:100%; max-width:400px; border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,0.4);">
        </td></tr>

        <tr><td style="padding:16px 40px 8px; text-align:center;">
          <div style="font-size:20px; font-weight:bold; color:#FFD700;">${pokemonName}</div>
          <div style="font-size:12px; color:rgba(255,255,255,0.5); margin-top:4px;">Designed by <strong style="color:#fff;">${displayName}</strong></div>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:20px 40px 12px; text-align:center;">
          <div style="font-size:18px; font-weight:bold; color:#FFD700;">🎨 Original AI Artwork</div>
          <div style="font-size:12px; color:rgba(255,255,255,0.4); margin-top:4px;">Long-press to save this image!</div>
        </td></tr>

        <!-- Raw AI Image -->
        <tr><td style="padding:0 40px 20px; text-align:center;">
          <img src="cid:pokemonraw" alt="${pokemonName}" style="width:100%; max-width:400px; border-radius:16px; border:3px solid rgba(255,215,0,0.3);">
        </td></tr>

        <!-- Message -->
        <tr><td style="padding:10px 40px 28px; text-align:center;">
          <div style="font-size:14px; color:rgba(255,255,255,0.5); line-height:1.7;">
            This one-of-a-kind Pokemon was created just for <strong style="color:#FFD700">${displayName}</strong> using AI magic. ⚡<br>
            Save the images — they're yours forever! 💛
          </div>
        </td></tr>

        <tr><td style="background:rgba(0,0,0,0.3); padding:14px 40px; text-align:center;">
          <div style="font-size:11px; color:rgba(255,255,255,0.3);">DIY Pokemon Card Maker</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`,
          text: `Hi ${displayName}! Here's your Pokemon card "${pokemonName}"! Two images are attached: the trading card and the original AI artwork.`,
        });
        emailSent = true;
        console.log(`   Pokemon email sent to ${email} for ${displayName}`);
      } catch (emailErr) {
        console.error('   Email send error:', emailErr.message);
      }
    }

    res.json({ imageUrl, name: pokemonName, cardData, emailSent });
  } catch (err) {
    console.error('AI Pokemon Create error:', err.message);
    console.error('   Error details:', JSON.stringify({ status: err.status, code: err.code, type: err.type, body: err.error }, null, 2));
    res.status(500).json({ error: `AI generation failed: ${err.message}` });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🃏 DIY Pokemon Card Maker running on port ${PORT}`);
});
