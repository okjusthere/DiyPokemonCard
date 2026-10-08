import { hash } from './storage.mjs';
// Aggregate, cookie-free counts. Never pass photos, card text, names, emails or prompts to these helpers.
export const clientEvents=new Set(['edit','photo','save','png','keepsake','print','credits_open','surprise','duel','idea_start','example_remix','ideas_filter','variation_start','photo_to_ai','reveal_download']);
// Order matters: AI assistants on google.com must not be counted as search.
const sources=[
 ['ai',/(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/],
 ['search',/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|naver|search\.brave|startpage)\./],
 ['social',/(^|\.)(pinterest|facebook|instagram|tiktok|reddit|youtube|x|twitter|threads|linkedin)\.|(^|\.)(t\.co|pin\.it|lnkd\.in)$/]
];
const bots=/bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|python|curl|wget|httpclient|axios/i;
export const today=(now=new Date())=>now.toISOString().slice(0,10);
export const count=(db,name,day=today(),by=1)=>db.prepare('INSERT INTO daily_metrics(day,name,count) VALUES(?,?,?) ON CONFLICT(day,name) DO UPDATE SET count=count+excluded.count').bind(day,name,by);
// Measurement must never break creating or paying, so failures are logged and swallowed.
export async function track(db,...names){
 if(!db||!names.length)return;
 try{const day=today();await db.batch(names.map(name=>count(db,name,day)));}catch(error){console.error('Metric write failed',error.name);}
}
// Browsers send Sec-Fetch-Dest on real navigations; most crawlers and prefetches are excluded.
export function isHumanPageview(request){
 const h=request.headers;
 return request.method==='GET'&&h.get('sec-fetch-dest')==='document'&&!h.get('sec-purpose')&&h.get('purpose')!=='prefetch'&&!bots.test(h.get('user-agent')||'');
}
export function sourceOf(request){
 let host='';try{host=new URL(request.headers.get('referer')||'').hostname.replace(/^www\./,'');}catch{/* No referrer is a direct visit. */}
 if(!host||host===new URL(request.url).hostname||host.endsWith('diypokecard.com'))return 'direct';
 for(const [name,pattern] of sources)if(pattern.test(host))return name;
 return 'other';
}
let saltCache;
async function salt(db,day){
 if(saltCache?.day===day)return saltCache.salt;
 await db.prepare('INSERT OR IGNORE INTO analytics_salts(day,salt) VALUES(?,?)').bind(day,crypto.randomUUID()+crypto.randomUUID()).run();
 const row=await db.prepare('SELECT salt FROM analytics_salts WHERE day=?').bind(day).first();
 saltCache={day,salt:row.salt};return row.salt;
}
export async function recordPageview(request,env,path){
 try{
  const db=env.DB,day=today();
  const visitor=await hash(`${await salt(db,day)}|${request.headers.get('cf-connecting-ip')||'local'}|${request.headers.get('user-agent')||''}`);
  const fresh=await db.prepare('INSERT OR IGNORE INTO daily_visitors(day,visitor_hash) VALUES(?,?)').bind(day,visitor).run();
  const names=['pageviews'];
  if(fresh.meta.changes)names.push('visitors',`landing:${/^\/[a-z0-9/.-]{0,60}$/.test(path)?path:'other'}`,`source:${sourceOf(request)}`);
  await db.batch(names.map(name=>count(db,name,day)));
 }catch(error){console.error('Pageview metric failed',error.name);}
}
export async function pruneVisitors(db,now=new Date()){
 const cutoff=today(new Date(now.getTime()-2*86400000));
 await db.batch([db.prepare('DELETE FROM daily_visitors WHERE day<?').bind(cutoff),db.prepare('DELETE FROM analytics_salts WHERE day<?').bind(cutoff)]);
}
