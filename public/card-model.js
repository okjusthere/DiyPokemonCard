(function (root) {
  'use strict';
  const TYPES = {
    Electric: { color: '#e4b936', pale: '#fff4c8', ink: '#5a420e', symbol: 'ϟ' },
    Fire: { color: '#e98254', pale: '#ffe8da', ink: '#762e20', symbol: '◆' },
    Water: { color: '#64b8d9', pale: '#e0f5fb', ink: '#205672', symbol: '●' },
    Grass: { color: '#83ae65', pale: '#eaf2d8', ink: '#385324', symbol: '❧' },
    Psychic: { color: '#b096cf', pale: '#f0e7fa', ink: '#654680', symbol: '✧' },
    Ice: { color: '#82c8ca', pale: '#e3f7f4', ink: '#296264', symbol: '❄' },
    Ghost: { color: '#969aca', pale: '#ededfb', ink: '#454675', symbol: '☾' },
    Normal: { color: '#b4ad9d', pale: '#f3f0e8', ink: '#5b574e', symbol: '★' },
    Flying: { color: '#9eb8dd', pale: '#edf3ff', ink: '#415f8b', symbol: '≋' },
  };
  const TEMPLATES = [
    { key: 'sparky', name: 'Sparky', type: 'Electric', hp: 90, attack: 'Comet spark', damage: 40, ability: 'A little courage. A whole lot of sparkle.', trainer: 'You', art: '/art/sparky.webp', finish: 'holo', layout: 'classic', tag: 'The little spark', zoom: 1, offsetX: 50, offsetY: 42 },
    { key: 'ember', name: 'Ember', type: 'Fire', hp: 100, attack: 'Sunburst swoop', damage: 50, ability: 'Small wings. Impossibly big adventures.', trainer: 'You', art: '/art/ember.webp', finish: 'holo', layout: 'fullart', tag: 'Born for adventure', zoom: 1, offsetX: 50, offsetY: 35 },
    { key: 'bubbles', name: 'Bubbles', type: 'Water', hp: 80, attack: 'Bubble bounce', damage: 30, ability: 'Collects shiny pebbles and very good friends.', trainer: 'You', art: '/art/bubbles.webp', finish: 'holo', layout: 'classic', tag: 'Make a splash', zoom: 1, offsetX: 50, offsetY: 52 },
  ];
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function text(value, fallback, limit) { return String(value ?? fallback).replace(/[\u0000-\u001f]/g, '').trim().slice(0, limit) || fallback; }
  function number(value, fallback, min, max) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
  function safeArt(value) {
    if (typeof value !== 'string') return TEMPLATES[0].art;
    if (/^\/art\/(sparky|ember|bubbles)\.webp$/.test(value) || /^\/api\/card\/art\/gen_[a-f0-9]+$/.test(value) || /^\/art\/examples\/(nova|birthday-hero|cinder-corgi|moonwhisk|sproutsaur|moonmoth|sir-broccoli|sundae-soar|copperbot|crystal-dragon|party-bunny|party-panda)\.webp$/.test(value)) return value;
    if (value.length < 7_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
    return TEMPLATES[0].art;
  }
  function normalizeCard(raw = {}) {
    const base = TEMPLATES.find(t => t.key === raw.key) || TEMPLATES[0];
    return {
      key: base.key,
      id: /^[a-z0-9_-]{1,80}$/i.test(raw.id || '') ? raw.id : '',
      name: text(raw.name, base.name, 24), type: Object.hasOwn(TYPES, raw.type) ? raw.type : base.type,
      hp: Math.round(number(raw.hp, base.hp, 10, 300) / 10) * 10,
      attack: text(raw.attack, base.attack, 30), damage: Math.round(number(raw.damage, base.damage, 0, 200) / 10) * 10,
      ability: text(raw.ability, base.ability, 100), trainer: text(raw.trainer, 'You', 24),
      prompt: text(raw.prompt, '', 400),
      example: /^[a-z-]{1,40}$/.test(raw.example || '') ? raw.example : '',
      art: safeArt(raw.art || base.art),
      source: ['template', 'photo', 'ai'].includes(raw.source) ? raw.source : raw.generationId ? 'ai' : String(raw.art || '').startsWith('data:') ? 'photo' : 'template',
      artWidth: number(raw.artWidth, 750, 1, 10000), artHeight: number(raw.artHeight, 1000, 1, 10000),
      finish: ['matte', 'holo', 'cosmic'].includes(raw.finish) ? raw.finish : 'holo',
      layout: ['classic', 'fullart'].includes(raw.layout) ? raw.layout : 'classic',
      zoom: number(raw.zoom, 1, 1, 2.5), offsetX: number(raw.offsetX, 50, 0, 100), offsetY: number(raw.offsetY, 50, 0, 100),
      generationId: /^[a-z]+_[a-f0-9]{32}$/.test(raw.generationId || '') ? raw.generationId : '',
    };
  }
  function lines(value, max = 43) {
    const words = value.split(' '), result = []; let current = '';
    for (let word of words) {
      while (word.length > max) { if (current) result.push(current); result.push(word.slice(0, max)); word = word.slice(max); current = ''; }
      if ((current + ' ' + word).trim().length > max) { result.push(current); current = word; } else current = (current + ' ' + word).trim();
    }
    if (current) result.push(current);
    return result.slice(0, 3);
  }
  function artBox(card) { return card.layout === 'fullart' ? { x: 16, y: 16, w: 598, h: 848 } : { x: 36, y: 104, w: 558, h: 420 }; }
  function fittedSize(value, size, width) {
    const units = [...value].reduce((sum, char) => sum + (/[^\u0000-\u024f]/.test(char) ? 1 : /[MW@]/.test(char) ? .9 : /[ilI .,']/.test(char) ? .3 : .62), 0);
    return Math.min(size, width / Math.max(1, units)).toFixed(2);
  }
  function svgCard(input, uid = 'card', artOverride) {
    const c = normalizeCard(input), t = TYPES[c.type], full = c.layout === 'fullart';
    const p = String(uid).replace(/[^a-z0-9_-]/gi, ''), b = artBox(c);
    const scale = Math.max(b.w / c.artWidth, b.h / c.artHeight) * c.zoom;
    const w = c.artWidth * scale, h = c.artHeight * scale;
    const x = b.x - (w - b.w) * c.offsetX / 100, y = b.y - (h - b.h) * c.offsetY / 100;
    const frontText = full ? '#fffdf5' : '#24283c';
    const label = `${c.name}, ${c.type} card, ${c.hp} HP. ${c.attack}, ${c.damage} damage. ${c.ability}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 630 880" role="img" aria-label="${escape(label)}">
      <defs>
        <linearGradient id="${p}-edge" x2="1" y2="1"><stop stop-color="#ffedaa"/><stop offset=".3" stop-color="${t.color}"/><stop offset=".55" stop-color="#fff7dd"/><stop offset="1" stop-color="${t.color}"/></linearGradient>
        <linearGradient id="${p}-shade" x2="0" y2="1"><stop stop-color="#172035" stop-opacity=".65"/><stop offset=".22" stop-color="#172035" stop-opacity="0"/><stop offset=".48" stop-color="#172035" stop-opacity="0"/><stop offset="1" stop-color="#172035" stop-opacity=".95"/></linearGradient>
        <linearGradient id="${p}-foil" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#ffa9ac" stop-opacity=".13"/><stop offset=".28" stop-color="#ffef95" stop-opacity=".09"/><stop offset=".48" stop-color="#a0fff0" stop-opacity=".24"/><stop offset=".68" stop-color="#b2c6ff" stop-opacity=".10"/><stop offset="1" stop-color="#f7bcff" stop-opacity=".16"/></linearGradient>
        <clipPath id="${p}-outer"><rect x="16" y="16" width="598" height="848" rx="23"/></clipPath>
        <clipPath id="${p}-art"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${full ? 23 : 8}"/></clipPath>
      </defs>
      <rect width="630" height="880" rx="36" fill="url(#${p}-edge)"/>
      <rect x="15" y="15" width="600" height="850" rx="24" fill="${t.pale}" stroke="${t.ink}" stroke-opacity=".45" stroke-width="2"/>
      <g clip-path="url(#${p}-art)"><image href="${escape(artOverride || c.art)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/></g>
      ${full ? `<rect x="16" y="16" width="598" height="848" rx="23" fill="url(#${p}-shade)"/>` : `<rect x="36" y="104" width="558" height="420" rx="8" fill="none" stroke="${t.color}" stroke-width="3"/><text x="315" y="548" text-anchor="middle" fill="${t.ink}" font-size="14" font-family="sans-serif" letter-spacing="2">IMAGINATION SERIES · ${escape(c.type.toUpperCase())}</text>`}
      <g font-family="Arial, sans-serif" fill="${frontText}">
        <rect x="36" y="35" width="71" height="23" rx="11" fill="${full ? '#ffffff35' : t.color}"/>
        <text x="71" y="51" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1">BASIC</text>
        <text x="37" y="88" font-size="${fittedSize(c.name,37,375)}" font-weight="800">${escape(c.name)}</text>
        <text x="474" y="76" text-anchor="end" font-size="15" font-weight="700">HP</text><text x="545" y="78" text-anchor="end" font-size="37" font-weight="700">${c.hp}</text>
        <circle cx="575" cy="62" r="21" fill="${t.color}"/><text x="575" y="71" text-anchor="middle" font-size="27" fill="${t.ink}">${t.symbol}</text>
        <text x="43" y="${full ? 607 : 601}" font-size="15" font-weight="700" letter-spacing="2" fill="${full ? '#ead78e' : t.ink}">SPECIAL ABILITY</text>
        ${lines(c.ability).map((line, i) => `<text x="43" y="${(full ? 639 : 633) + i * 23}" font-size="${fittedSize(line,19,544)}">${escape(line)}</text>`).join('')}
        <line x1="42" y1="705" x2="588" y2="705" stroke="${full ? '#ffffff50' : t.color}"/>
        <circle cx="58" cy="747" r="16" fill="${t.color}"/><text x="58" y="754" font-size="23" text-anchor="middle" fill="${t.ink}">${t.symbol}</text>
        <text x="87" y="755" font-size="${fittedSize(c.attack,27,405)}" font-weight="700">${escape(c.attack)}</text><text x="584" y="758" text-anchor="end" font-size="33" font-weight="700">${c.damage}</text>
        <line x1="42" y1="786" x2="588" y2="786" stroke="${full ? '#ffffff50' : t.color}"/>
        <text x="43" y="814" font-size="13">MADE BY ${escape(c.trainer.toUpperCase())}</text><text x="586" y="814" text-anchor="end" font-size="13" letter-spacing="2">${c.finish === 'matte' ? '◆' : '✦'} 001 / YOU</text>
        <text x="315" y="846" text-anchor="middle" font-size="11" opacity=".7" letter-spacing="1.4">DIY POKÉ CARD · FAN-MADE · JUST FOR FUN</text>
      </g>
      ${c.finish !== 'matte' ? `<rect x="16" y="16" width="598" height="848" rx="23" fill="url(#${p}-foil)"/>` : ''}
      ${c.finish === 'cosmic' ? `<g fill="#ffffff" opacity=".65">${Array.from({ length: 27 }, (_, i) => { const sx = 28 + (i * 137) % 570, sy = 110 + (i * 197) % 580; return `<path d="M${sx - 4} ${sy}h8m-4-4v8" stroke="white" stroke-width="1.4"/>`; }).join('')}</g>` : ''}
    </svg>`;
  }
  function cardMarkup(card, uid, className = '') {
    const c = normalizeCard(card);
    return `<div class="trading-card ${className}" data-finish="${c.finish}"><div class="card-rotator"><div class="card-front">${svgCard(c, uid)}<span class="card-shine" aria-hidden="true"></span><span class="card-glare" aria-hidden="true"></span></div><div class="card-back" aria-hidden="true"><span class="back-orbit"></span><span class="back-star">✦</span><strong>imagination<br>is your superpower.</strong><span class="back-brand">DIY POKÉ CARD</span></div></div></div>`;
  }
  const api = { TYPES, TEMPLATES, escape, normalizeCard, svgCard, cardMarkup, lines, artBox };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokeCards = api;
})(typeof globalThis === 'object' ? globalThis : this);
