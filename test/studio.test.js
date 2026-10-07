const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createApp } = require('../app');
const { TEMPLATES, normalizeCard, svgCard } = require('../public/card-model');
const site = require('../lib/site');

test('imported card input cannot inject scripts, external tracking images, or out-of-range values', () => {
  const hostile = normalizeCard({ name: '<img onerror=alert(1)>', art: 'https://tracker.example/photo.jpg', type: '__proto__', hp: Infinity, damage: -200, zoom: 900, offsetX: -40, layout: '" onload="alert(1)', finish: 'unknown', trainer: '</text><script>x</script>' });
  assert.equal(hostile.art, TEMPLATES[0].art);
  assert.equal(hostile.type, 'Electric');
  assert.equal(hostile.hp, 90);
  assert.equal(hostile.damage, 0);
  assert.equal(hostile.zoom, 2.5);
  assert.equal(hostile.offsetX, 0);
  const svg = svgCard(hostile, 'safe');
  assert.doesNotMatch(svg, /<script|<img|href="https:/);
  assert.match(svg, /&lt;img/);
  assert.match(svg, /&lt;\/text&gt;/i);
});

test('photo crop uses actual image aspect ratio and continuous offsets', () => {
  const left = svgCard({ ...TEMPLATES[0], artWidth: 1600, artHeight: 900, offsetX: 0 }, 'left');
  const right = svgCard({ ...TEMPLATES[0], artWidth: 1600, artHeight: 900, offsetX: 100 }, 'right');
  const midpoint = svgCard({ ...TEMPLATES[0], artWidth: 1600, artHeight: 900, offsetX: 37 }, 'middle');
  const getX = svg => Number(svg.match(/<image[^>]+ x="([^"]+)"/)[1]);
  assert.ok(getX(right) < getX(midpoint));
  assert.ok(getX(midpoint) < getX(left));
  assert.equal(getX(left), 36);
});

test('all public landing pages have substantive server-rendered text and unique canonical URLs', () => {
  const titles = new Set();
  for (const route of ['/', ...Object.keys(site.pages)]) {
    const html = route === '/' ? site.home() : site.article(route);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, route);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://diypokecard.com${route.replaceAll('/', '\\/')}"`));
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(!titles.has(title)); titles.add(title);
    assert.ok(html.replace(/<[^>]*>/g, '').length > 1800);
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)];
    schemas.forEach(([, json]) => assert.doesNotThrow(() => JSON.parse(json)));
    assert.doesNotMatch(html, /aggregateRating|FAQPage|DALL-E 3/);
  }
  const xml = site.sitemap('https://cards.example');
  assert.match(xml, /https:\/\/cards.example\/photo-card-maker/);
  assert.doesNotMatch(xml, /\/studio|localhost/);
});

test('HTTP: public routes, real 404s, private AI artwork, and honest capabilities', async t => {
  const app = createApp({ dbPath: ':memory:', env: { NODE_ENV: 'test', BASE_URL: 'https://cards.example' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.db.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/studio', ...Object.keys(site.pages), '/privacy.html', '/terms.html']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.ok((await response.text()).includes('<main id="main">'));
  }
  assert.equal((await fetch(origin + '/not-a-real-page')).status, 404);
  const missingApi = await fetch(origin + '/api/missing');
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.headers.get('content-type'), /application\/json/);
  const sitemap = await (await fetch(origin + '/sitemap.xml')).text();
  assert.match(sitemap, /https:\/\/cards.example\/photo-card-maker/);
  const sessionResponse = await fetch(origin + '/api/session');
  const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const session = await sessionResponse.json();
  assert.deepEqual(session.capabilities, { ai: false, aiPhoto: false, payments: false });
  assert.equal(session.restoreAvailable, false);
  assert.equal(session.account.totalCredits, 1);
  assert.equal(sessionResponse.headers.get('cache-control'), 'private, no-store');
  const services = app.locals.services;
  const reservation = services.reserveCredit(session.account.id, 'design');
  const canvas = createCanvas(60,80); canvas.getContext('2d').fillRect(0,0,60,80);
  services.storeGenerationResult(session.account.id, reservation.requestId, 'design', `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`, {}, 'Test');
  const own = await fetch(origin + '/api/card/art/' + reservation.requestId, { headers: { cookie } });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('content-type'), /image\/png/);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
  const decoded = await loadImage(Buffer.from(await own.arrayBuffer()));
  assert.equal(decoded.width,60);assert.equal(decoded.height,80);
  const other = await fetch(origin + '/api/card/art/' + reservation.requestId);
  assert.equal(other.status,404,'another account must not receive generated artwork');
  assert.equal((await fetch(origin + '/api/card/art/not-a-generation', {headers:{cookie}})).status,400);
  assert.equal((await fetch(origin + '/api/ai/pokemon-create',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'})).status,503);
});

test('gallery recipes remain editable, local, and discoverable without JavaScript', () => {
  const { categories, examples } = require('../public/examples');
  const fs = require('node:fs'), path = require('node:path');
  assert.equal(new Set(examples.map(e=>e.slug)).size, 12);
  const home = site.home(), guide = site.article('/card-ideas');
  for (const category of categories) assert.equal(examples.filter(e=>e.category===category.id).length, 2);
  for (const example of examples) {
    const card = normalizeCard(example);
    assert.equal(card.art, example.art); assert.equal(card.prompt, example.prompt);
    assert.ok(fs.existsSync(path.join(__dirname, '../public', card.art)));
    assert.ok(fs.existsSync(path.join(__dirname, `../public/art/examples/cards/${example.slug}.webp`)));
    assert.ok(home.includes(`/studio?example=${example.slug}`)); assert.ok(guide.includes(`/studio?example=${example.slug}`));
    assert.equal(card.generationId, '');
  }
  for (const art of ['/art/examples/../../private.webp','/art/examples/unknown.webp','https://evil.example/nova.webp']) assert.equal(normalizeCard({art}).art,TEMPLATES[0].art);
  assert.equal(normalizeCard({prompt:'x'.repeat(900)}).prompt.length,400);
});
