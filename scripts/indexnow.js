// Tells IndexNow search engines (Bing, Yandex, Seznam…) which pages changed. Run after a deploy.
// The key is public by design: the same value is served at /38f663ecb9361d556fc308c68b947f55.txt so engines can verify ownership.
const site = require('../lib/site');
const KEY = '38f663ecb9361d556fc308c68b947f55';
const host = new URL(site.ORIGIN).host;
const urlList = [...site.sitemap(site.ORIGIN).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
(async () => {
  const response = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host, key: KEY, keyLocation: `${site.ORIGIN}/${KEY}.txt`, urlList }) });
  console.log(`IndexNow: ${response.status} ${response.statusText} for ${urlList.length} URLs`);
  if (!response.ok && response.status !== 202) process.exitCode = 1;
})();
