/* A small, dependency-free studio. Artwork and edits stay local unless AI is explicitly chosen. */
(async function () {
  'use strict';
  const { TEMPLATES, TYPES, normalizeCard, cardMarkup, svgCard, escape: esc } = window.PokeCards;
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const preview = $('#preview-card');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let card = normalizeCard(TEMPLATES[0]), mode = 'pal', view = reducedMotion.matches ? '2d' : '3d';
  let collection = [], undo = [], redo = [], flipped = false, initialized = false;
  let session = null, busy = false, saveTimer, toastTimer, revealCard = null, deletedCard = null;
  let photoArt = null, exportBusy = false, draftSequence = 0, pendingGeneration = null;
  const challenges = [
    ['What if your pet could control the weather?', 'Give them a name, a superpower, and a very dramatic signature move.'],
    ['What if a tiny dragon lived in your backpack?', 'Invent the one thing it always helps you with. Snacks count.'],
    ['What if your doodle could come to life?', 'Give it a new energy, a funny name, and a best friend.'],
    ['What if the ocean had a bubble-powered hero?', 'Make a water pal with a special talent for helping others.'],
    ['What if your whole family was a team?', 'Turn everybody’s best everyday talent into a superpower.'],
  ];
  const randomNames = ['Cloudskip', 'Tumble', 'Sunnybean', 'Moonwhisk', 'Pebble', 'Ziggy', 'Nimbus', 'Starling', 'Pip', 'Fizz'];
  const randomMoves = ['Rainbow dash', 'Cosmic cuddle', 'Pocket thunder', 'Bubble parade', 'Snack attack', 'Starlight leap', 'Brave little roar'];
  let challengeIndex = 0;
  const choose = (list) => list[Math.floor(Math.random() * list.length)];
  const makeId = () => `card_${crypto.randomUUID().replace(/-/g, '')}`;

  function toast(message, duration = 3500) {
    const el = $('#toast');
    el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
  }
  function showDialog(id) {
    const dialog = $(id); if (!dialog.open) dialog.showModal();
  }
  function closeDialog(id) { $(id)?.close(); }
  function filename(name) { return (name || 'my-card').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 45) || 'my-card'; }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function blobData(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(blob);
    });
  }
  function imageFrom(src) {
    return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('The image could not be opened. Please choose a different picture.')); image.src = src; });
  }
  async function request(url, data) {
    const response = await fetch(url, data === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('The server could not respond. Please try again.'); }
    if (!response.ok) { const error = new Error(payload.error === 'no_credits' ? 'You have used your AI credits. Add a pack, or keep creating in the free studio.' : payload.error || 'Something did not finish. Please try again.'); error.status = response.status; throw error; }
    return payload;
  }

  // IndexedDB keeps images out of cookies, URLs, and server-side accounts.
  let dbPromise;
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('diy-poke-studio', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('cards', { keyPath: 'id' }); req.result.createObjectStore('settings'); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('Local saving is unavailable. Download your card to keep it.'));
    });
    return dbPromise;
  }
  async function dbRead(store, key) {
    const db = await database();
    return new Promise((resolve, reject) => { const tx = db.transaction(store), req = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }
  async function dbWrite(store, value, key, remove = false) {
    const db = await database();
    return new Promise((resolve, reject) => { const tx = db.transaction(store, 'readwrite'), obj = tx.objectStore(store); if (remove) obj.delete(key); else if (key !== undefined) obj.put(value, key); else obj.put(value); tx.oncomplete = resolve; tx.onerror = () => reject(new Error('Your browser could not save this card. Download a backup or free up storage.')); tx.onabort = tx.onerror; });
  }
  async function loadCollection() {
    const raw = await dbRead('cards');
    collection = raw.map(normalizeCard).slice(0, 60);
    $$('[data-collection-count]').forEach(el => el.textContent = collection.length);
    return collection;
  }
  function persistDraft() {
    if (!preview || !initialized) return;
    const sequence = ++draftSequence;
    clearTimeout(saveTimer);
    $('#draft-state').textContent = 'Saving on this browser…';
    saveTimer = setTimeout(async () => {
      const draft = { card: { ...card }, mode, view };
      try { await dbWrite('settings', draft, 'draft'); if (sequence === draftSequence) $('#draft-state').textContent = 'Saved on this browser'; }
      catch { $('#draft-state').textContent = 'Download to keep your work'; }
    }, 350);
  }
  function remember() {
    undo.push({ ...card }); if (undo.length > 35) undo.shift(); redo = [];
  }
  function update(patch, record = true, sync = true) {
    if (record) remember();
    card = normalizeCard({ ...card, ...patch });
    render(sync); persistDraft();
  }
  function render(sync = true) {
    if (!preview) return;
    if (card.source === 'photo') photoArt = { art: card.art, artWidth: card.artWidth, artHeight: card.artHeight };
    preview.innerHTML = cardMarkup(card, 'preview');
    preview.classList.toggle('flat', view === '2d');
    $('.trading-card', preview).classList.toggle('is-flipped', flipped);
    if (sync) $$('[data-card-field]').forEach(input => { input.value = card[input.dataset.cardField]; });
    $$('[data-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.type === card.type)));
    $$('[data-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layout === card.layout)));
    $$('button[data-finish]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.finish === card.finish)));
    $$('[data-template]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.template === card.key && !card.art.startsWith('data:') && !card.generationId)));
    $$('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    $('#selected-type').textContent = card.type;
    $('#undo-button').disabled = !undo.length; $('#redo-button').disabled = !redo.length;
    $('#crop-controls').hidden = !photoArt;
    $('#email-card-section').hidden = !(card.generationId && session?.restoreAvailable);
    $('#preview-hint').lastChild.textContent = view === '3d' ? ' Move across your card. Catch a little sparkle.' : ' A clear, steady view of your creation.';
  }
  function changeMode(next) {
    if (!preview || !['pal', 'photo', 'ai'].includes(next)) return;
    mode = next;
    $$('[data-mode]').forEach(button => { const active = button.dataset.mode === next; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    ['pal', 'photo', 'ai'].forEach(name => $(`#mode-${name}`).hidden = name !== next);
    persistDraft();
  }
  function chooseTemplate(key, scroll = false) {
    const template = TEMPLATES.find(t => t.key === key); if (!template) return;
    if (!preview) { location.href = `/studio?template=${encodeURIComponent(key)}`; return; }
    photoArt = null; flipped = false; remember(); card = normalizeCard(template); changeMode('pal'); render(); persistDraft();
    if (scroll) $('#studio').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }

  async function readPhoto(file) {
    if (!file) return;
    const error = $('#photo-error'); error.textContent = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { error.textContent = 'Choose a JPG, PNG, or WebP image. Convert HEIC or SVG first.'; return; }
    if (file.size > 10 * 1024 * 1024) { error.textContent = 'This photo is over 10 MB. Choose a smaller version.'; return; }
    try {
      const source = await blobData(file), image = await imageFrom(source);
      if (image.width * image.height > 60_000_000) throw new Error('This picture has too many pixels. Resize it before adding it.');
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
      photoArt = { art: canvas.toDataURL('image/jpeg', .88), artWidth: canvas.width, artHeight: canvas.height };
      update({ ...photoArt, source:'photo', id: '', generationId: '', zoom: 1, offsetX: 50, offsetY: 50 });
      toast('Your photo is in. Give your little legend a name.');
    } catch (e) { error.textContent = e.message; }
    finally { $('#photo-input').value = ''; }
  }

  const artCache = new Map();
  async function embeddedArt(c) {
    if (c.art.startsWith('data:')) return c.art;
    if (!artCache.has(c.art)) artCache.set(c.art, (async () => {
      const response = await fetch(c.art, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('The artwork is unavailable. Reopen your saved card or choose a new image.');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('The artwork could not be loaded.');
      return blobData(blob);
    })().catch(error => { artCache.delete(c.art); throw error; }));
    return artCache.get(c.art);
  }
  async function cardPng(c) {
    const source = svgCard(c, 'export', await embeddedArt(c));
    const image = await imageFrom(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
    const canvas = document.createElement('canvas'); canvas.width = 945; canvas.height = 1320;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Export did not finish. Please try again.')), 'image/png'));
  }
  async function exportPng() {
    if (exportBusy) return;
    exportBusy = true; const snapshot = { ...card };
    const button = $('[data-action="download"]'); if (button) button.disabled = true;
    try { download(await cardPng(snapshot), `${filename(snapshot.name)}-card.png`); toast('Your card is ready. Print it, share it, keep it.'); }
    catch (e) { toast(e.message); }
    finally { exportBusy = false; if (button) button.disabled = false; }
  }
  async function exportInteractive() {
    if (exportBusy) return; exportBusy = true;
    try {
      const snapshot = { ...card, art: await embeddedArt(card) };
      const markup = cardMarkup(snapshot, 'keepsake');
      const css = `*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#f4f3f8;color:#252938;font:15px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:35px 20px}h1{font-size:27px;margin:0 0 10px;text-align:center}p{text-align:center;color:#6e7287;font-size:12px;line-height:1.7;max-width:360px}.stage{width:min(340px,76vw);margin:25px 0;perspective:1100px;touch-action:pan-y}.trading-card{width:100%;aspect-ratio:63/88;position:relative;--rx:0deg;--ry:0deg;--mx:50%;--my:50%;filter:drop-shadow(0 18px 20px #24283c30)}.card-rotator{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(var(--rx)) rotateY(var(--ry));transition:transform .25s}.is-flipped .card-rotator{transform:rotateX(var(--rx)) rotateY(calc(var(--ry) + 180deg))}.card-front,.card-back{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:18px;overflow:hidden}.card-front{transform:translateZ(1px)}.card-front svg{display:block;width:100%;height:100%}.card-shine{position:absolute;inset:2%;border-radius:12px;background:repeating-linear-gradient(115deg,#faaecc00,#ffee9855 15%,#93efed55 30%,#c6bcf644 45%,#faaecc00 60%);background-size:240% 240%;background-position:var(--mx) var(--my);mix-blend-mode:color-dodge;opacity:.5;pointer-events:none}[data-finish=matte] .card-shine{display:none}.card-back{transform:rotateY(180deg);background:#4358d9;border:7px solid #f0d988;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;color:#fff3bc;gap:27px}.back-star{font-size:75px}.card-back strong{font-size:26px;line-height:1.15}.back-brand{font-size:9px;letter-spacing:3px}.actions{display:flex;gap:10px;align-items:center}button,a{font:inherit;font-size:12px;border:1px solid #d7d9e4;background:white;color:#3847a8;border-radius:10px;padding:12px 16px;cursor:pointer;text-decoration:none}button:focus-visible,a:focus-visible,.stage:focus-visible{outline:3px solid #4358d9;outline-offset:5px}.small{font-size:10px}@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;
      const js = `const stage=document.querySelector('.stage'),card=document.querySelector('.trading-card');let flat=matchMedia('(prefers-reduced-motion: reduce)').matches;function tilt(x,y){card.style.setProperty('--rx',((.5-y)*18)+'deg');card.style.setProperty('--ry',((x-.5)*22)+'deg');card.style.setProperty('--mx',(x*100)+'%');card.style.setProperty('--my',(y*100)+'%')}function flip(){card.classList.toggle('is-flipped')}stage.addEventListener('pointermove',e=>{if(flat)return;const r=stage.getBoundingClientRect();tilt(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)))});stage.addEventListener('pointerleave',()=>tilt(.5,.5));stage.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'){e.preventDefault();flip()}if(!flat&&e.key.startsWith('Arrow')){e.preventDefault();tilt(e.key==='ArrowLeft'?.1:e.key==='ArrowRight'?.9:.5,e.key==='ArrowUp'?.1:e.key==='ArrowDown'?.9:.5)}});document.querySelector('#flip').onclick=flip;const mode=document.querySelector('#flat');function label(){mode.textContent=flat?'Try 3D':'Use 2D';mode.setAttribute('aria-pressed',String(flat))}mode.onclick=()=>{flat=!flat;tilt(.5,.5);label()};label();`;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(snapshot.name)} — My little legend</title><style>${css}</style></head><body><h1>${esc(snapshot.name)}</h1><p>Made by ${esc(snapshot.trainer)}. A little imagination, all their own.</p><div class="stage" tabindex="0" role="group" aria-label="Interactive card. Arrow keys tilt, F flips.">${markup}</div><div class="actions"><button id="flip">Flip card</button><button id="flat">Use 2D</button><a href="https://www.diypokecard.com/">Make your own ↗</a></div><p>Move across the card to catch the light.<br>On a keyboard: arrow keys to tilt, F to flip.</p><p class="small">An independent fan-made keepsake. Not an official Pokémon card.</p><script>${js}</script></body></html>`;
      download(new Blob([html], { type: 'text/html' }), `${filename(snapshot.name)}-interactive.html`);
      toast('Interactive card saved. Open the HTML in a browser to tilt and flip.');
    } catch (e) { toast(e.message); } finally { exportBusy = false; }
  }
  async function saveCard(input = card) {
    await loadCollection();
    const exists = collection.some(c => c.id && c.id === input.id);
    if (collection.length >= 60 && !exists) throw new Error('Your local collection has 60 cards. Back it up and remove a card to make room.');
    const saved = normalizeCard({ ...input, id: input.id || makeId(), art: await embeddedArt(input) });
    await dbWrite('cards', saved); await loadCollection();
    if (input === card) { card = { ...saved }; persistDraft(); }
    return saved;
  }
  function collectionMarkup() {
    if (!collection.length) return `<div class="empty-collection"><span aria-hidden="true">✦</span><h3>A whole world to fill.</h3><p>Make a card in the studio and tap Keep it. Your favorite creations will find a home right here.</p><button class="btn" data-action="start-from-collection">Make my first card →</button></div>`;
    return `<div class="collection-grid">${collection.map((c,i)=>`<article class="collection-item">${cardMarkup(c,`collection-${i}`)}<div class="collection-item-actions"><button class="btn btn-secondary" data-edit-card="${c.id}">Edit ${esc(c.name)}</button><button class="icon-btn" data-delete-card="${c.id}" aria-label="Remove ${esc(c.name)} from collection">×</button></div></article>`).join('')}</div>`;
  }
  async function openCollection() {
    try { await loadCollection(); $('#collection-content').innerHTML = collectionMarkup(); showDialog('#collection-dialog'); }
    catch (e) { toast(e.message); }
  }
  function reveal(c, title = 'Meet your next favorite.') {
    revealCard = normalizeCard({ ...c, id: '' });
    $('#reveal-title').textContent = title; $('#reveal-stage').innerHTML = cardMarkup(revealCard, 'reveal');
    $('.trading-card', $('#reveal-stage')).classList.add('is-flipped');
    $('#reveal-stage').classList.remove('revealed'); $('#reveal-stage').setAttribute('aria-label', 'Reveal your card');
    $('#reveal-save').hidden = true; $('#reveal-hint').textContent = 'Tap your card to reveal it.';
    showDialog('#reveal-dialog');
  }
  function surprise() {
    const base = choose(TEMPLATES), next = normalizeCard({ ...base, name: choose(randomNames), attack: choose(randomMoves), type: choose(Object.keys(TYPES)), hp: choose([60,70,80,90,100,110]), damage: choose([20,30,40,50,60]), finish: choose(['matte','holo','cosmic']), layout: choose(['classic','fullart']), trainer: card.trainer });
    reveal(next);
  }
  async function backup() {
    await loadCollection();
    if (!collection.length) { toast('Make and keep a card before creating a backup.'); return; }
    download(new Blob([JSON.stringify({ format: 'diy-poke-card-collection', version: 1, cards: collection }, null, 2)], { type: 'application/json' }), 'my-little-legends-backup.json');
    toast('Editable collection backup downloaded. Keep it somewhere safe.');
  }
  async function importBackup(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) throw new Error('That backup is too large. Choose a file under 50 MB.');
    let payload; try { payload = JSON.parse(await file.text()); } catch { throw new Error('This is not a readable collection backup.'); }
    if (payload.format !== 'diy-poke-card-collection' || payload.version !== 1 || !Array.isArray(payload.cards) || payload.cards.length > 60) throw new Error('Choose a DIY Poké Card collection backup.');
    await loadCollection();
    if (collection.length + payload.cards.length > 60) throw new Error('The combined collection exceeds 60 cards. Back up and remove some cards first.');
    const incoming = payload.cards.map(c => {
      if (!c || typeof c !== 'object' || typeof c.art !== 'string' || c.art.length > 7_000_000) throw new Error('A card in this backup is not valid.');
      const next = normalizeCard({ ...c, id: makeId() });
      if (next.art !== c.art) throw new Error('A card contains an unsupported image.');
      return next;
    });
    // One transaction means a quota failure cannot leave a partially imported collection.
    const db = await database();
    await new Promise((resolve,reject)=>{const tx=db.transaction('cards','readwrite');incoming.forEach(c=>tx.objectStore('cards').put(c));tx.oncomplete=resolve;tx.onerror=()=>reject(new Error('There is not enough browser storage for this backup.'));tx.onabort=tx.onerror;});
    await openCollection(); toast(`${incoming.length} cards added to your collection.`);
  }

  function updateSessionUI() {
    const credits = session?.account?.totalCredits || 0;
    const ai = session?.capabilities?.ai;
    if ($('#generate-button')) {
      const photo = $('#ai-kind').value === 'photo', available = photo ? session?.capabilities?.aiPhoto : ai;
      $('#generate-button').disabled = (!available && !pendingGeneration) || busy;
      if (!busy) $('#generate-button').textContent = pendingGeneration ? 'Recover my artwork · no extra credit' : 'Generate original artwork';
      $('#ai-status').textContent = available ? `${credits} AI credit${credits === 1 ? '' : 's'} available · one credit per generation. The manual studio stays free.` : 'AI artwork is temporarily unavailable. Original companions and your own photos are ready to use for free.';
      $('#ai-status').classList.toggle('available', !!available);
    }
    $('#credit-summary').textContent = `${credits} AI credit${credits===1?'':'s'} on this browser. ${ai ? 'Each new AI artwork uses one credit.' : 'AI generation is currently unavailable here.'}`;
    $('#checkout-button').disabled = !session?.capabilities?.payments || !ai;
    $('#restore-button').disabled = !session?.restoreAvailable;
    if (!session?.capabilities?.payments) $('#account-error').textContent = 'AI packs are not available to buy yet. You can still create, download and print for free.';
    if (!session?.restoreAvailable) $('#restore-status').textContent = 'Email sign-in is temporarily unavailable. Please try again later.';
    if (session?.account?.email) $('#account-email').value = session.account.email;
    $('#email-card-section').hidden = !(card.generationId && session?.restoreAvailable);
  }
  async function aiPhotoData(art) {
    const image = await imageFrom(art), scale = Math.min(1, 480 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .9);
  }
  async function generate() {
    if (busy) return;
    $('#ai-error').textContent = '';
    if (!pendingGeneration && !session?.account?.totalCredits) { showDialog('#account-dialog'); return; }
    const fromPhoto = $('#ai-kind').value === 'photo';
    if (!pendingGeneration && fromPhoto && !photoArt) { $('#ai-error').textContent = 'Add a picture in My photo first, then return here.'; return; }
    if (!pendingGeneration && fromPhoto && !$('#ai-photo-consent').checked) { $('#ai-error').textContent = 'An adult needs to confirm photo permission before AI processing.'; return; }
    busy = true; updateSessionUI(); $('#generate-button').textContent = pendingGeneration ? 'Recovering your artwork…' : 'Imagining your new character…';
    const before = pendingGeneration?.before || { ...card };
    try {
      if (!pendingGeneration) {
        const data = fromPhoto ? { photo: await aiPhotoData(photoArt.art), kidName: card.trainer, cardTitle: card.name, cardStyle: card.layout === 'fullart' ? 'fullart' : 'supporter', acceptTerms: true, acceptPrivacy: true, photoParentConsent: true } : { kidName: card.trainer, color: $('#ai-color').value, animal: $('#ai-animal').value, power: $('#ai-power').value };
        data.requestId = `gen_${crypto.randomUUID().replaceAll('-', '')}`;
        pendingGeneration = { before, request: { path: fromPhoto ? '/api/ai/pokemon-from-photo' : '/api/ai/pokemon-create', data } };
        try { await dbWrite('settings', pendingGeneration, 'pending-generation'); } catch { /* Keep the retry ID in memory when local storage is unavailable. */ }
      }
      if (!pendingGeneration.result) {
        const result = await request(pendingGeneration.request.path, pendingGeneration.request.data);
        session.account = result.account;
        pendingGeneration = { before, result: { generationId: result.generationId, cardData: result.cardData, trainerData: result.trainerData } };
        try { await dbWrite('settings', pendingGeneration, 'pending-generation'); } catch { /* In-memory recovery remains available without storage. */ }
      }
      const result = pendingGeneration.result;
      // Fetch only the authenticated server-stored result. Never accept arbitrary image URLs.
      const artResponse = await fetch(`/api/card/art/${encodeURIComponent(result.generationId)}`, { credentials: 'same-origin' });
      if (!artResponse.ok) throw new Error('Your artwork was created but could not be loaded. Use Recover my artwork to try again without spending another credit.');
      const art = await blobData(await artResponse.blob()), image = await imageFrom(art);
      const d = result.cardData, t = result.trainerData;
      const next = normalizeCard({ ...before, ...(d || {}), source:'ai', id: '', name: d?.name || t?.title || before.name, type: d?.type || before.type, hp: d?.hp || before.hp, attack: d?.attack || d?.attack1?.name || 'A little everyday magic', damage: d?.damage ?? d?.attack1?.damage ?? 40, ability: d?.ability || d?.flavor || t?.effect || before.ability, generationId: result.generationId, art, artWidth: image.width, artHeight: image.height, zoom: 1, offsetX: 50, offsetY: 50 });
      remember(); card = next; render(); persistDraft(); reveal(next, 'Your imagination came to life.');
      pendingGeneration = null;
      try { await dbWrite('settings', null, 'pending-generation', true); } catch { /* The downloaded artwork remains in the current draft. */ }
    } catch (e) {
      $('#ai-error').textContent = e.message;
      if (pendingGeneration?.request && [400,402,410,413,415,502,503].includes(e.status)) {
        pendingGeneration = null;
        try { await dbWrite('settings', null, 'pending-generation', true); } catch { /* Clear the in-memory request too. */ }
      }
      try { session = await request('/api/session'); } catch { /* Keep the previously known balance until the connection returns. */ }
      if (e.status === 402) showDialog('#account-dialog');
    } finally { busy = false; updateSessionUI(); }
  }
  async function handleReturns() {
    const params = new URLSearchParams(location.search);
    if (params.get('restored') === '1') { toast('Your AI account is restored. Your credits are ready.'); params.delete('restored'); history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash); }
    if (preview && /^gen_[a-f0-9]{32}$/.test(params.get('generation') || '')) {
      try {
        const saved = await request(`/api/card/${params.get('generation')}`);
        pendingGeneration = {before: {...card}, result: saved};
        changeMode('ai'); await generate(); params.delete('generation');
        history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
      } catch (error) { toast(error.message, 6000); }
    }
    if (params.get('payment') === 'cancelled') toast('Checkout was cancelled. No new credits were added.');
    if (params.get('payment') !== 'success' || !params.get('session_id')) return;
    try {
      const result = await request(`/api/checkout/verify?session_id=${encodeURIComponent(params.get('session_id'))}`);
      if (result.account) session.account = result.account; updateSessionUI();
      if (result.verificationStatus === 'credited') toast(result.creditedToCurrentSession ? 'Your AI credits are ready. Let’s make something.' : 'Purchase confirmed. Use your receipt email to restore those credits.', 6500);
      else toast('Your payment is still processing. Restore your account after confirmation to see the credits.', 6500);
      params.delete('payment'); params.delete('session_id'); history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    } catch (e) { toast(e.message, 6000); }
  }

  async function printCards(cards, paper = 'a4') {
    if (!cards.length) { toast('Keep a card in your collection before printing.'); return; }
    const prepared = await Promise.all(cards.map(async (c,i)=> svgCard(c,`print-${i}`, await embeddedArt(c))));
    const root = $('#print-root');
    // Each page has an explicit nine-card grid to prevent calibration text shifting later pages.
    root.style.display = '';
    const sheets=[];
    for(let i=0;i<prepared.length;i+=9) sheets.push(`<section class="print-page">${prepared.slice(i,i+9).map(markup=>`<div class="print-card">${markup}</div>`).join('')}<div class="print-calibration" aria-label="50 millimeter calibration line"><span>50 mm</span></div></section>`);
    root.innerHTML=sheets.join('');
    let style = $('#paper-style'); if (!style) { style = document.createElement('style'); style.id = 'paper-style'; document.head.append(style); }
    style.textContent = `@page{size:${paper === 'letter' ? 'letter' : 'A4'} portrait;margin:5mm}`;
    await Promise.all([...root.querySelectorAll('image')].map(el=>imageFrom(el.getAttribute('href'))));
    window.print();
  }
  async function printSelection() {
    await loadCollection();
    const kind = $('#print-source')?.value || 'collection';
    if (kind === 'samples') return Array.from({ length: 9 },(_,i)=>normalizeCard(TEMPLATES[i%3]));
    if (kind === 'current') { const draft=await dbRead('settings','draft'); return draft?.card ? [normalizeCard(draft.card)] : [normalizeCard(TEMPLATES[0])]; }
    return collection.length ? collection : Array.from({ length: 9 },(_,i)=>normalizeCard(TEMPLATES[i%3]));
  }
  async function renderPrintPreview() {
    if (!$('#print-preview')) return;
    const cards = await printSelection();
    $('#print-preview').classList.toggle('letter', $('#paper-size').value === 'letter');
    $('#print-preview').innerHTML = Array.from({length:9},(_,i)=>`<div class="print-slot${cards[i]?'':' empty'}">${cards[i]?cardMarkup(cards[i],`sheet-${i}`):'A space for your next legend'}</div>`).join('');
    $('#print-source-note').textContent = $('#print-source').value === 'collection' && !collection.length ? 'No cards saved yet. Here is a complete sample sheet to try.' : `${cards.length} card${cards.length===1?'':'s'} · ${Math.ceil(cards.length/9)} sheet${cards.length>9?'s':''}. Preview shows the first sheet.`;
  }
  let duelCards = [];
  async function setupDuel() {
    if (!$('#battle-one')) return;
    await loadCollection(); duelCards = collection.length >= 2 ? collection : TEMPLATES.map(normalizeCard);
    ['#battle-one','#battle-two'].forEach(id=>$(id).innerHTML=duelCards.map((c,i)=>`<option value="${i}">${esc(c.name)} · ${c.type}</option>`).join(''));
    $('#battle-two').value = '1'; renderDuel();
  }
  function renderDuel(show = false) {
    if (!duelCards.length) return;
    const one = duelCards[Number($('#battle-one').value)] || duelCards[0], two = duelCards[Number($('#battle-two').value)] || duelCards[1];
    $('#battle-versus').innerHTML = cardMarkup(one,'duel-one',show?'':'is-flipped')+'<span>vs.</span>'+cardMarkup(two,'duel-two',show?'':'is-flipped');
    const stat = $('#battle-stat').value, a=one[stat],b=two[stat];
    $('#battle-result').textContent = show ? a===b ? `A friendly draw · ${a} to ${b}` : `${a>b?one.name:two.name} wins · ${a} to ${b}` : 'Ready, little legends?';
    $('[data-action="duel"]').textContent = show ? 'Reveal again ✦' : 'Reveal the winner ✦';
  }

  document.addEventListener('click', async event => {
    const target = event.target.closest('button,a'); if (!target) return;
    try {
      if (target.dataset.close) { closeDialog('#'+target.dataset.close); return; }
      if (target.dataset.mode) { changeMode(target.dataset.mode); return; }
      if (target.dataset.template) { chooseTemplate(target.dataset.template); return; }
      if (target.dataset.remix) { chooseTemplate(target.dataset.remix, true); return; }
      if (target.dataset.type) { update({ type: target.dataset.type }); return; }
      if (target.dataset.layout) { update({ layout: target.dataset.layout }); return; }
      if (target.dataset.finish) { update({ finish: target.dataset.finish }); return; }
      if (target.dataset.view) { view=target.dataset.view;render();persistDraft();return; }
      if (target.dataset.editCard) {
        const selected=collection.find(c=>c.id===target.dataset.editCard); if(!selected)return;
        if (!preview) {await dbWrite('settings',{card:selected,mode:selected.source==='photo'?'photo':'pal',view},'draft');location.href='/studio';return;}
        remember();card={...selected};photoArt=card.source==='photo'?{art:card.art,artWidth:card.artWidth,artHeight:card.artHeight}:null;flipped=false;changeMode(photoArt?'photo':'pal');render();persistDraft();closeDialog('#collection-dialog');$('#studio').scrollIntoView();return;
      }
      if(target.dataset.deleteCard){
        deletedCard=collection.find(c=>c.id===target.dataset.deleteCard);await dbWrite('cards',null,target.dataset.deleteCard,true);await loadCollection();$('#collection-content').innerHTML=collectionMarkup();
        const undoButton=document.createElement('button');undoButton.className='text-btn';undoButton.dataset.action='undo-delete';undoButton.textContent=`Undo removing ${deletedCard.name}`;$('#collection-content').prepend(undoButton);return;
      }
      switch(target.dataset.action){
        case 'collection':await openCollection();break;
        case 'account':showDialog('#account-dialog');break;
        case 'undo':if(undo.length){redo.push({...card});card=undo.pop();render();persistDraft();}break;
        case 'redo':if(redo.length){undo.push({...card});card=redo.pop();render();persistDraft();}break;
        case 'reset':chooseTemplate(card.key);toast('Back to your original companion. Undo brings your changes back.');break;
        case 'reset-crop':update({zoom:1,offsetX:50,offsetY:50});break;
        case 'flip':flipped=!flipped;$('.trading-card',preview)?.classList.toggle('is-flipped',flipped);break;
        case 'download':await exportPng();break;
        case 'interactive':await exportInteractive();break;
        case 'save':await saveCard();toast('A little legend, safely in your collection.');break;
        case 'surprise':surprise();break;
        case 'keep-reveal':if(revealCard){const saved=await saveCard(revealCard);if(preview){remember();card=saved;flipped=false;changeMode(card.source==='photo'?'photo':card.source==='ai'?'ai':'pal');if(card.source==='template')photoArt=null;render();persistDraft();}closeDialog('#reveal-dialog');toast('Your new companion joined the collection.');}break;
        case 'challenge':challengeIndex=(challengeIndex+1)%challenges.length;$('#challenge-title').textContent=challenges[challengeIndex][0];$('#challenge-description').textContent=challenges[challengeIndex][1];break;
        case 'backup':await backup();break;
        case 'undo-delete':if(deletedCard){await dbWrite('cards',deletedCard);deletedCard=null;await openCollection();toast('Card restored.');}break;
        case 'start-from-collection':closeDialog('#collection-dialog');if(preview)$('#studio').scrollIntoView();else location.href='/studio';break;
        case 'print-collection':if(!collection.length){toast('Keep a card before printing your collection.');break;}closeDialog('#collection-dialog');await printCards(collection);break;
        case 'print-sheet':await printCards(await printSelection(),$('#paper-size').value);break;
        case 'duel':renderDuel(true);break;
        case 'generate':await generate();break;
        case 'email-card':{
          const email=$('#account-email').value;
          if(!$('#checkout-form [name=consent]').checked){toast('Agree to the Terms and Privacy Policy before sending account email.');break;}
          target.disabled=true;
          try{const result=await request('/api/card/email',{generationId:card.generationId,email,displayName:card.trainer,acceptTerms:true,acceptPrivacy:true,photoParentConsent:!!$('#ai-photo-consent')?.checked});toast(result.emailStatus==='sent'?'Your private artwork link is on its way.':'Email could not be delivered. Download your PNG instead.');}finally{target.disabled=false;}break;
        }
      }
    }catch(e){toast(e.message || 'That did not finish. Please try again.');}
  });
  $$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  $('#reveal-stage').addEventListener('click',()=>{
    const el=$('.trading-card',$('#reveal-stage'));if(!el?.classList.contains('is-flipped'))return;
    el.classList.remove('is-flipped');$('#reveal-stage').classList.add('revealed');$('#reveal-stage').setAttribute('aria-label',revealCard.name+' revealed');$('#reveal-save').hidden=false;$('#reveal-hint').textContent=`${revealCard.name}. ${revealCard.type} energy. Completely yours.`;
  });
  $('#import-collection').addEventListener('change',async event=>{try{await importBackup(event.target.files[0]);}catch(e){toast(e.message);}finally{event.target.value='';}});
  $('#checkout-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#checkout-button');if(button.disabled)return;button.disabled=true;$('#account-error').textContent='';
    try{const data=new FormData(event.target);const result=await request('/api/checkout',{email:data.get('email'),plan:data.get('plan'),displayName:card.trainer,acceptTerms:true,acceptPrivacy:true});const next=new URL(result.url);if(next.protocol!=='https:'||next.hostname!=='checkout.stripe.com')throw new Error('The checkout link was not valid.');location.assign(next.href);}catch(e){$('#account-error').textContent=e.message;button.disabled=false;}
  });
  $('#restore-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('#restore-button');if(button.disabled)return;button.disabled=true;try{const result=await request('/api/account/restore/request',{email:new FormData(event.target).get('email')});$('#restore-status').textContent=result.message;}catch(e){$('#restore-status').textContent=e.message;}finally{button.disabled=false;}});

  if(preview){
    $$('[data-card-field]').forEach(input=>input.addEventListener('input',()=>{update({[input.dataset.cardField]:input.value},true,false);}));
    $('#photo-input').addEventListener('change',event=>readPhoto(event.target.files[0]));
    const zone=$('#upload-zone');
    ['dragenter','dragover'].forEach(name=>zone.addEventListener(name,event=>{event.preventDefault();zone.classList.add('dragging');}));
    ['dragleave','drop'].forEach(name=>zone.addEventListener(name,()=>zone.classList.remove('dragging')));
    zone.addEventListener('drop',event=>{event.preventDefault();readPhoto(event.dataTransfer.files[0]);});
    $('.mode-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const modes=['pal','photo','ai'];const index=event.key==='Home'?0:event.key==='End'?2:(modes.indexOf(mode)+(event.key==='ArrowRight'?1:2))%3;changeMode(modes[index]);$(`[data-mode="${mode}"]`).focus();});
    function tilt(x=.5,y=.5){const el=$('.trading-card',preview);if(!el)return;el.style.setProperty('--rx',`${(.5-y)*17}deg`);el.style.setProperty('--ry',`${(x-.5)*21}deg`);el.style.setProperty('--mx',`${x*100}%`);el.style.setProperty('--my',`${y*100}%`);}
    let frame;
    preview.addEventListener('pointermove',event=>{if(view!=='3d'||reducedMotion.matches)return;const r=preview.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(event.clientY-r.top)/r.height));cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>tilt(x,y));});
    preview.addEventListener('pointerleave',()=>{cancelAnimationFrame(frame);tilt();});
    preview.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'){event.preventDefault();flipped=!flipped;$('.trading-card',preview).classList.toggle('is-flipped',flipped);}if(event.key.startsWith('Arrow')&&view==='3d'&&!reducedMotion.matches){event.preventDefault();tilt(event.key==='ArrowLeft'?.1:event.key==='ArrowRight'?.9:.5,event.key==='ArrowUp'?.1:event.key==='ArrowDown'?.9:.5);}});
    preview.addEventListener('focusout',()=>tilt());
    reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches){view='2d';render();}});
    $('#ai-kind').addEventListener('change',()=>{const fromPhoto=$('#ai-kind').value==='photo';$('#ai-creature-fields').hidden=fromPhoto;$('#ai-photo-fields').hidden=!fromPhoto;updateSessionUI();});
    try{const draft=await dbRead('settings','draft');if(draft?.card){card=normalizeCard(draft.card);mode=['pal','photo','ai'].includes(draft.mode)?draft.mode:'pal';view=!reducedMotion.matches&&draft.view==='3d'?'3d':'2d';}}catch{ /* Downloads remain available when local storage is disabled. */ }
    try{const pending=await dbRead('settings','pending-generation');if(/^gen_[a-f0-9]{32}$/.test(pending?.result?.generationId||'')){pendingGeneration={before:normalizeCard(pending.before),result:pending.result};mode='ai';}else if(/^gen_[a-f0-9]{32}$/.test(pending?.request?.data?.requestId||'')&&['/api/ai/pokemon-create','/api/ai/pokemon-from-photo'].includes(pending.request.path)){pendingGeneration={before:normalizeCard(pending.before),request:pending.request};mode='ai';}}catch{ /* A pending download can still be retried in the current tab. */ }
    const params=new URLSearchParams(location.search),template=TEMPLATES.find(t=>t.key===params.get('template'));
    if(template){card=normalizeCard(template);mode='pal';}
    if(Object.hasOwn(TYPES,params.get('type')))card.type=params.get('type');
    if(params.get('attack'))card=normalizeCard({...card,attack:params.get('attack')});
    if(['matte','holo','cosmic'].includes(params.get('finish')))card.finish=params.get('finish');
    if(card.source==='photo')photoArt={art:card.art,artWidth:card.artWidth,artHeight:card.artHeight};
    changeMode(params.get('mode')||mode);render();initialized=true;
    if(['template','type','attack','finish','mode'].some(key=>params.has(key)))persistDraft();
    if(params.get('surprise')==='1')surprise();
  }
  try{await loadCollection();await renderPrintPreview();await setupDuel();}catch{if($('#print-preview')){$('#print-source-note').textContent='Local storage is unavailable. Enable browser storage to use your collection.';}}
  ['#paper-size','#print-source'].forEach(id=>$(id)?.addEventListener('change',()=>renderPrintPreview().catch(e=>toast(e.message))));
  ['#battle-one','#battle-two','#battle-stat'].forEach(id=>$(id)?.addEventListener('change',()=>renderDuel()));
  try{session=await request('/api/session');updateSessionUI();await handleReturns();}catch{if($('#ai-status'))$('#ai-status').textContent='The AI service could not be reached. Keep creating with companions and your own photos.';$('#credit-summary').textContent='AI account services are offline. The free manual studio still works.';}
})();
