#!/usr/bin/env node
'use strict';
/*
 * build-template-pdf.js — printable blank trading-card template, written without a PDF library.
 *
 *   node scripts/build-template-pdf.js            writes dist/assets/downloads/trading-card-template-a4.pdf,
 *                                                 trading-card-template-letter.pdf and blank-trading-card.png
 *   node scripts/build-template-pdf.js --check    same, then re-reads the PDFs, verifies the xref table and
 *                                                 runs qpdf / mutool / pdfinfo / pypdf when they are installed
 *   node scripts/build-template-pdf.js --out DIR  write into DIR instead
 *
 * Each PDF is hand-assembled PDF 1.4: catalog, pages, one page, one content stream and the base-14 Helvetica
 * and Helvetica-Bold fonts (WinAnsi, nothing embedded). The PNG is the same card drawn with @napi-rs/canvas
 * at 15 px per mm. All drawing happens in millimetres with y pointing down; the two painters below convert.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MM = 2.834645669; // PostScript points per millimetre
const PAPERS = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  letter: { label: 'US Letter', width: 612, height: 792 },
};
const CARD = { width: 63, height: 88 }; // mm, standard trading-card size
const COLS = 3, ROWS = 3, GAP = 2, GUIDE = 4, MIN_MARGIN = 5, SAFE = 4; // mm
const PNG = { width: 945, height: 1320, scale: 15 }; // px, 15 px per mm
const FILES = { a4: 'trading-card-template-a4.pdf', letter: 'trading-card-template-letter.pdf', png: 'blank-trading-card.png' };
const DEFAULT_DEST = path.resolve(__dirname, '../dist/assets/downloads');

const FOOTER = 'diypokecard.com · free fan-made trading card template · print at 100% / actual size, cut on the dashed lines';
const CALIBRATION = '50 mm — measure after printing at 100%';

// Glyph advance widths (1/1000 em) for codes 32-126 of the base-14 Helvetica fonts, from the Adobe AFM files.
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVETICA_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const WINANSI = { '·': 183, '—': 151 }; // periodcentered, emdash
const WINANSI_WIDTH = { 183: 278, 151: 1000 }; // same in both Helvetica weights

const fmt = value => {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
};
const pdfCodes = str => Array.from(str, ch => { const code = ch.charCodeAt(0); return code >= 32 && code <= 126 ? code : WINANSI[ch] || 45; });
const pdfLiteral = str => pdfCodes(str).map(code => code === 40 || code === 41 || code === 92 ? '\\' + String.fromCharCode(code) : code > 126 ? '\\' + code.toString(8).padStart(3, '0') : String.fromCharCode(code)).join('');
const textWidthPt = (str, size, bold) => pdfCodes(str).reduce((sum, code) => sum + (code <= 126 ? (bold ? HELVETICA_BOLD : HELVETICA)[code - 32] : WINANSI_WIDTH[code] || 500), 0) * size / 1000;

// ---------------------------------------------------------------------------------------------- layout (mm)

function layout(paper) {
  const key = String(paper).toLowerCase(), size = PAPERS[key];
  if (!size) throw new Error(`Unknown paper "${paper}" (use "a4" or "letter")`);
  const pageWidth = size.width / MM, pageHeight = size.height / MM;
  const gridWidth = COLS * CARD.width + (COLS - 1) * GAP, gridHeight = ROWS * CARD.height + (ROWS - 1) * GAP;
  const marginX = (pageWidth - gridWidth) / 2, marginY = (pageHeight - gridHeight) / 2;
  if (marginX < MIN_MARGIN || marginY < MIN_MARGIN) throw new Error(`${size.label} cannot hold a ${COLS}x${ROWS} grid of ${CARD.width}x${CARD.height} mm cards with ${MIN_MARGIN} mm margins`);
  const cards = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) cards.push({ row, col, x: marginX + col * (CARD.width + GAP), y: marginY + row * (CARD.height + GAP), width: CARD.width, height: CARD.height });
  const columnEdges = cards.filter(c => c.row === 0).flatMap(c => [c.x, c.x + c.width]);
  const rowEdges = cards.filter(c => c.col === 0).flatMap(c => [c.y, c.y + c.height]);
  // The calibration bar and footer sit under the grid when the bottom margin has room beyond the cut guides
  // and the printer-safe zone (A4: 14.5 mm). US Letter leaves 5.7 mm, so there they run up the side margins.
  const extras = marginY - GUIDE - SAFE >= 6 ? 'bottom' : 'sides';
  return { paper: key, label: size.label, widthPt: size.width, heightPt: size.height, pageWidth, pageHeight, gridWidth, gridHeight, marginX, marginY, cards, columnEdges, rowEdges, extras };
}

// ---------------------------------------------------------------------------------------------- drawing

const offset = (p, ox, oy) => ({
  line: (x1, y1, x2, y2, style) => p.line(ox + x1, oy + y1, ox + x2, oy + y2, style),
  rect: (x, y, w, h, style) => p.rect(ox + x, oy + y, w, h, style),
  roundRect: (x, y, w, h, r, style) => p.roundRect(ox + x, oy + y, w, h, r, style),
  text: (x, y, str, style) => p.text(ox + x, oy + y, str, style),
});

// One blank card, origin at its top-left corner, 63 x 88 mm. Lines are light grey and the labels are small
// so children can write straight over them.
function drawBlankCard(p) {
  const L = 3.5, R = 59.5, thin = { width: 0.35, grey: 0.7 }, label = { size: 6, bold: true, grey: 0.55 };
  p.roundRect(1, 1, CARD.width - 2, CARD.height - 2, 2, thin);
  p.text(L, 6.6, 'NAME', label);
  p.line(L + 7.5, 7.2, 44, 7.2, thin);
  p.rect(46.5, 3, 13, 6.5, thin);
  p.text(47.5, 7.2, 'HP', label);
  p.rect(L, 11.5, R - L, 39.6, thin); // art box: 45% of the card height
  p.text((L + R) / 2, 32.1, 'DRAW YOUR ART HERE', { size: 6, grey: 0.75, align: 'center' });
  p.text(L, 56, 'SPECIAL ABILITY', label);
  p.line(L, 60.5, R, 60.5, thin);
  p.line(L, 65, R, 65, thin);
  p.text(L, 70, 'MOVE', label);
  p.line(L, 74.5, 46.5, 74.5, thin);
  p.rect(48.5, 67.5, 11, 8, thin);
  p.text(49.3, 70.3, 'DMG', { ...label, size: 5.5 });
  p.text(L, 83.2, 'MADE BY', label);
  p.line(L + 11, 83.7, R, 83.7, thin);
}

function drawPage(p, L) {
  for (const card of L.cards) drawBlankCard(offset(p, card.x, card.y));
  const top = L.marginY, bottom = L.marginY + L.gridHeight, left = L.marginX, right = L.marginX + L.gridWidth;
  const guide = { width: 0.4, grey: 0.45, dash: [2, 1.5] };
  // Margin marks stay inside the printable area (home printers clip the outer ~5 mm), so on tight margins they shorten.
  const stubTop = Math.max(top - GUIDE, MIN_MARGIN), stubBottom = Math.min(bottom + GUIDE, L.pageHeight - MIN_MARGIN), stubLeft = Math.max(left - GUIDE, MIN_MARGIN), stubRight = Math.min(right + GUIDE, L.pageWidth - MIN_MARGIN);
  for (const x of L.columnEdges) { p.line(x, stubTop, x, top, guide); p.line(x, bottom, x, stubBottom, guide); }
  for (const y of L.rowEdges) { p.line(stubLeft, y, left, y, guide); p.line(right, y, stubRight, y, guide); }
  // Dashed cut lines run down the middle of every gap, a clear strip the whole length of the grid.
  const gapCenters = edges => edges.slice(1, -1).reduce((out, edge, i, arr) => (i % 2 === 0 ? [...out, (edge + arr[i + 1]) / 2] : out), []);
  for (const x of gapCenters(L.columnEdges)) p.line(x, top, x, bottom, guide);
  for (const y of gapCenters(L.rowEdges)) p.line(left, y, right, y, guide);
  const bar = { width: 0.9, grey: 0.3 }, small = { size: 6, grey: 0.45 };
  if (L.extras === 'bottom') {
    const y = bottom + GUIDE + 2.4;
    p.line(left, y, left + 50, y, bar); p.line(left, y - 1.25, left, y + 1.25, bar); p.line(left + 50, y - 1.25, left + 50, y + 1.25, bar);
    p.text(left + 53, y + 0.75, CALIBRATION, small);
    p.text(L.pageWidth / 2, L.pageHeight - SAFE, FOOTER, { ...small, align: 'center' });
  } else {
    // Bar up the right margin, footer up the left margin, both reading bottom-to-top and clear of the guide stubs.
    const x = L.pageWidth - 6;
    p.line(x, bottom, x, bottom - 50, bar); p.line(x - 1.25, bottom, x + 1.25, bottom, bar); p.line(x - 1.25, bottom - 50, x + 1.25, bottom - 50, bar);
    p.text(x + 0.9, bottom - 53, CALIBRATION, { ...small, rotate: 90 });
    p.text(7, bottom, FOOTER, { ...small, rotate: 90 });
  }
}

// ---------------------------------------------------------------------------------------------- PDF painter

function pdfPainter(heightPt) {
  const ops = [], state = {};
  const X = x => fmt(x * MM), Y = y => fmt(heightPt - y * MM), P = (x, y) => `${X(x)} ${Y(y)}`;
  function stroke({ width = 0.35, grey = 0.7, dash = null } = {}) {
    const d = dash ? `[${dash.map(fmt).join(' ')}] 0 d` : '[] 0 d';
    if (width !== state.width) { ops.push(`${fmt(width)} w`); state.width = width; }
    if (grey !== state.grey) { ops.push(`${fmt(grey)} G`); state.grey = grey; }
    if (d !== state.dash) { ops.push(d); state.dash = d; }
  }
  return {
    line(x1, y1, x2, y2, style) { stroke(style); ops.push(`${P(x1, y1)} m ${P(x2, y2)} l S`); },
    rect(x, y, w, h, style) { stroke(style); ops.push(`${P(x, y + h)} ${fmt(w * MM)} ${fmt(h * MM)} re S`); },
    roundRect(x, y, w, h, r, style) {
      stroke(style); const k = 0.5523 * r;
      ops.push([`${P(x + r, y)} m`, `${P(x + w - r, y)} l`, `${P(x + w - r + k, y)} ${P(x + w, y + r - k)} ${P(x + w, y + r)} c`,
        `${P(x + w, y + h - r)} l`, `${P(x + w, y + h - r + k)} ${P(x + w - r + k, y + h)} ${P(x + w - r, y + h)} c`,
        `${P(x + r, y + h)} l`, `${P(x + r - k, y + h)} ${P(x, y + h - r + k)} ${P(x, y + h - r)} c`,
        `${P(x, y + r)} l`, `${P(x, y + r - k)} ${P(x + r - k, y)} ${P(x + r, y)} c`, 'h S'].join(' '));
    },
    text(x, y, str, { size = 6, bold = false, grey = 0.55, align = 'left', rotate = 0 } = {}) {
      const width = textWidthPt(str, size, bold) / MM, back = align === 'center' ? width / 2 : align === 'right' ? width : 0;
      const tm = rotate === 90 ? `0 1 -1 0 ${P(x, y + back)}` : rotate === -90 ? `0 -1 1 0 ${P(x, y - back)}` : `1 0 0 1 ${P(x - back, y)}`;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${fmt(size)} Tf ${fmt(grey)} g ${tm} Tm (${pdfLiteral(str)}) Tj ET`);
    },
    stream: () => ops.join('\n') + '\n',
  };
}

function buildTemplatePdf(paper) {
  const L = layout(paper), painter = pdfPainter(L.heightPt);
  drawPage(painter, L);
  const content = Buffer.from(painter.stream(), 'latin1'); // ASCII only: non-ASCII glyphs are octal escapes
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(L.widthPt)} ${fmt(L.heightPt)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ProcSet [/PDF /Text] >> /Contents 4 0 R >>`,
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${pdfLiteral(`Blank trading card template - ${L.label}`)}) /Producer (diypokecard.com build-template-pdf.js) >>`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
  let position = parts[0].length;
  objects.forEach((body, index) => {
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(position); parts.push(chunk); position += chunk.length;
  });
  const count = objects.length + 1; // xref entries are exactly 20 bytes each: 10-digit offset, 5-digit generation, type, space, newline
  const xref = ['xref', `0 ${count}`, '0000000000 65535 f ', ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n `)].join('\n') + '\n';
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${count} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${position}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------- PNG painter

let fontFamily = null;
function registerFonts(GlobalFonts) {
  if (fontFamily) return fontFamily;
  const files = ['dm-sans-400.ttf', 'dm-sans-700.ttf'].map(name => path.join(__dirname, '../public/fonts', name)).filter(fs.existsSync);
  fontFamily = files.map(file => GlobalFonts.registerFromPath(file, 'Template Sans')).some(Boolean) ? 'Template Sans' : 'Helvetica, Arial, sans-serif';
  return fontFamily;
}

function canvasPainter(ctx, scale, family) {
  const PT = scale / MM; // px per point
  const rgb = grey => `rgb(${Math.round(grey * 255)},${Math.round(grey * 255)},${Math.round(grey * 255)})`;
  function stroke({ width = 0.35, grey = 0.7, dash = null } = {}) {
    ctx.lineWidth = Math.max(1.5, width * PT); ctx.strokeStyle = rgb(grey); ctx.setLineDash(dash ? dash.map(d => d * PT) : []);
  }
  return {
    line(x1, y1, x2, y2, style) { stroke(style); ctx.beginPath(); ctx.moveTo(x1 * scale, y1 * scale); ctx.lineTo(x2 * scale, y2 * scale); ctx.stroke(); },
    rect(x, y, w, h, style) { stroke(style); ctx.strokeRect(x * scale, y * scale, w * scale, h * scale); },
    roundRect(x, y, w, h, r, style) { stroke(style); ctx.beginPath(); ctx.roundRect(x * scale, y * scale, w * scale, h * scale, r * scale); ctx.stroke(); },
    text(x, y, str, { size = 6, bold = false, grey = 0.55, align = 'left', rotate = 0 } = {}) {
      ctx.save(); ctx.translate(x * scale, y * scale); if (rotate) ctx.rotate(-rotate * Math.PI / 180);
      ctx.font = `${bold ? 700 : 400} ${size * PT}px "${family}"`; ctx.fillStyle = rgb(grey); ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, 0, 0); ctx.restore();
    },
  };
}

function buildBlankCardPng() {
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas'); // loaded lazily so the PDF side has no native dependency
  const canvas = createCanvas(PNG.width, PNG.height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PNG.width, PNG.height);
  drawBlankCard(canvasPainter(ctx, PNG.scale, registerFonts(GlobalFonts)));
  return canvas.toBuffer('image/png');
}

function writeTemplates(destDir = DEFAULT_DEST) {
  fs.mkdirSync(destDir, { recursive: true });
  const outputs = [
    { file: path.join(destDir, FILES.a4), data: buildTemplatePdf('a4') },
    { file: path.join(destDir, FILES.letter), data: buildTemplatePdf('letter') },
    { file: path.join(destDir, FILES.png), data: buildBlankCardPng() },
  ];
  for (const output of outputs) fs.writeFileSync(output.file, output.data);
  return outputs.map(output => ({ file: output.file, bytes: output.data.length }));
}

// ---------------------------------------------------------------------------------------------- self-check

// Parses the xref table of a finished PDF and confirms every in-use offset lands on "N 0 obj", the stream
// /Length matches the bytes before "endstream", and the trailer is consistent.
function checkPdf(buffer) {
  const text = buffer.toString('latin1'), problems = [];
  if (!text.startsWith('%PDF-1.4\n')) problems.push('missing %PDF-1.4 header');
  if (!text.endsWith('%%EOF\n')) problems.push('missing %%EOF');
  const startxref = text.lastIndexOf('startxref');
  const xrefOffset = startxref < 0 ? -1 : Number(text.slice(startxref + 9).trim().split(/\s+/)[0]);
  const header = /^xref\n(\d+) (\d+)\n/.exec(text.slice(xrefOffset));
  if (xrefOffset < 0 || !header) problems.push(`startxref ${xrefOffset} does not point at an xref table`);
  const count = header ? Number(header[2]) : 0, tableStart = header ? xrefOffset + header[0].length : 0, entries = [];
  for (let i = 0; i < count; i++) {
    const entry = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(text.slice(tableStart + i * 20, tableStart + (i + 1) * 20));
    if (!entry) { problems.push(`xref entry ${i} is malformed`); continue; }
    entries.push({ offset: Number(entry[1]), type: entry[3] });
    if (entry[3] === 'n' && !text.startsWith(`${i} 0 obj\n`, Number(entry[1]))) problems.push(`xref entry ${i} (offset ${Number(entry[1])}) does not point at "${i} 0 obj"`);
  }
  const trailer = text.slice(tableStart + count * 20), size = /\/Size (\d+)/.exec(trailer);
  if (!size || Number(size[1]) !== count) problems.push('trailer /Size does not match the xref count');
  if (!/\/Root 1 0 R/.test(trailer)) problems.push('trailer has no /Root 1 0 R');
  const stream = /\/Length (\d+) >>\nstream\n/.exec(text);
  if (!stream) problems.push('no content stream'); else if (!text.startsWith('\nendstream', stream.index + stream[0].length + Number(stream[1]))) problems.push('content stream /Length is wrong');
  const box = /\/MediaBox \[([^\]]+)\]/.exec(text), mediaBox = box ? box[1].trim().split(/\s+/).map(Number) : null;
  if (!mediaBox || mediaBox.length !== 4) problems.push('page has no MediaBox');
  return { ok: problems.length === 0, problems, objects: Math.max(0, count - 1), xrefOffset, mediaBox, streamBytes: stream ? Number(stream[1]) : 0 };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return { tool: command, ok: result.status === 0, output };
}
const installed = command => { try { return spawnSync('which', [command]).status === 0; } catch { return false; } };

function externalValidators(file) {
  const results = [];
  if (installed('qpdf')) results.push(run('qpdf', ['--check', file]));
  if (installed('mutool')) results.push(run('mutool', ['info', file]));
  if (installed('pdfinfo')) results.push(run('pdfinfo', [file]));
  if (installed('python3')) {
    const script = 'import sys\ntry:\n    import pypdf as p\nexcept ImportError:\n    import PyPDF2 as p\nr = p.PdfReader(sys.argv[1])\nprint(p.__name__, p.__version__ if hasattr(p, "__version__") else "", len(r.pages), "page(s), mediabox", list(r.pages[0].mediabox))';
    const result = run('python3', ['-I', '-c', script, file]);
    if (/No module named/.test(result.output)) results.push({ tool: 'python3 pypdf/PyPDF2', skipped: true, output: 'not installed' });
    else results.push({ ...result, tool: 'python3 pypdf' });
  }
  return results;
}

function selfCheck(destDir = DEFAULT_DEST) {
  let ok = true;
  const mm = pt => fmt(pt / MM);
  for (const paper of ['a4', 'letter']) {
    const file = path.join(destDir, FILES[paper]), L = layout(paper), result = checkPdf(fs.readFileSync(file)), card = L.cards[0];
    console.log(`\n${FILES[paper]} (${L.label})`);
    console.log(`  xref at byte ${result.xrefOffset}, ${result.objects} objects, content stream ${result.streamBytes} bytes: ${result.ok ? 'all offsets point at "N 0 obj"' : result.problems.join('; ')}`);
    if (result.mediaBox) console.log(`  MediaBox [${result.mediaBox.join(' ')}] pt = ${mm(result.mediaBox[2])} x ${mm(result.mediaBox[3])} mm`);
    console.log(`  card 1 at x ${fmt(card.x)} mm, y ${fmt(card.y)} mm (from top), ${card.width} x ${card.height} mm = ${fmt(card.x * MM)} x ${fmt(L.heightPt - (card.y + card.height) * MM)} pt (lower-left), ${fmt(card.width * MM)} x ${fmt(card.height * MM)} pt`);
    console.log(`  grid ${L.gridWidth} x ${L.gridHeight} mm, margins ${fmt(L.marginX)} mm left/right and ${fmt(L.marginY)} mm top/bottom, calibration bar + footer ${L.extras === 'bottom' ? 'under the grid' : 'up the side margins'}`);
    if (!result.ok) ok = false;
    for (const check of externalValidators(file)) {
      if (check.skipped) { console.log(`  ${check.tool}: skipped (${check.output})`); continue; }
      console.log(`  ${check.tool}: ${check.ok ? 'ok' : 'FAILED'}${check.output ? '\n    ' + check.output.split('\n').slice(0, 12).join('\n    ') : ''}`);
      if (!check.ok) ok = false;
    }
  }
  const png = fs.readFileSync(path.join(destDir, FILES.png));
  const pngOk = png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && png.readUInt32BE(16) === PNG.width && png.readUInt32BE(20) === PNG.height;
  console.log(`\n${FILES.png}: ${pngOk ? `valid PNG header, ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)} px` : 'INVALID PNG header or size'}`);
  if (!pngOk) ok = false;
  console.log(`\nSelf-check ${ok ? 'passed' : 'FAILED'}.`);
  return ok;
}

if (require.main === module) {
  const args = process.argv.slice(2), outIndex = args.indexOf('--out');
  const destDir = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : DEFAULT_DEST;
  try {
    for (const output of writeTemplates(destDir)) console.log(`${path.relative(process.cwd(), output.file)}  ${output.bytes} bytes`);
    if (args.includes('--check') && !selfCheck(destDir)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildTemplatePdf, buildBlankCardPng, writeTemplates, checkPdf, selfCheck, layout, drawBlankCard, PAPERS, CARD, FILES, MM };
