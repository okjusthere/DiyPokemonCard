const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { examples } = require('../public/examples');
const { renderCard } = require('./render-card');
async function main() {
  const directory = path.join(__dirname, '../public/art/examples/cards');
  fs.mkdirSync(directory, { recursive: true });
  for (const example of examples) {
    const card = await renderCard(example), thumbnail = createCanvas(450, 629);
    thumbnail.getContext('2d').drawImage(card, 0, 0, 450, 629);
    fs.writeFileSync(path.join(directory, `${example.slug}.webp`), thumbnail.toBuffer('image/webp', 85));
  }
  console.log(`Built ${examples.length} card previews from the shared card renderer.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
