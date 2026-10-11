import { hash } from './storage.mjs';
// Aggregate, cookie-free counts. Never pass photos, card text, names, emails or prompts to these helpers.
export const clientEvents=new Set(['edit','photo','save','save2','png','keepsake','print','share','credits_open','credits_open_paywall','credits_open_menu','surprise','duel','idea_start','example_remix','ideas_filter','variation_start','photo_to_ai','reveal_download','reveal_another','email_card','generate_under5s','generate_under15s','generate_under30s','generate_over30s']);
// Bounded dimensions for event and purchase attribution. Metric names must come from a finite set, never from the request.
// Every public page: keep in step with lib/site.js (a test checks that each page passes).
const knownLanding=/^\/(?:|studio|pricing|photo-card-maker|holographic-card-maker|printable-trading-cards|card-ideas|make-a-card-game|ai-trading-card-generator|pet-trading-card|birthday-trading-card|drawing-to-trading-card|about|trading-card-template|christmas-trading-cards|privacy\.html|terms\.html|ideas\/[a-z0-9-]{1,40})$/;
export const landingOf=value=>{const path=String(value??'');return knownLanding.test(path)?path:'';};
// Campaign tags are only counted when the owner listed them in CAMPAIGNS (comma-separated slugs), so links cannot invent metric rows.
export function campaignOf(value,env){
 const slug=String(value??'').toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug))return '';
 return String(env?.CAMPAIGNS||'').toLowerCase().split(',').map(s=>s.trim()).includes(slug)?slug:'';
}
const channels=new Set(['pinterest','facebook','instagram','tiktok','reddit','youtube','google','bing','email','newsletter','creator','keepsake','print']);
// Ad-platform click ids only. Facebook (fbclid) and Pinterest (epik) add theirs to organic clicks too, so those count as paid only with utm_medium.
const paidParams=['gclid','msclkid','ttclid'];
// Order matters: AI assistants on google.com must not be counted as search.
const sources=[
 ['ai',/(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/],
 ['search',/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|naver|search\.brave|startpage)\./],
 ['social',/(^|\.)(pinterest|facebook|instagram|tiktok|reddit|youtube|x|twitter|threads|linkedin)\.|(^|\.)(t\.co|pin\.it|lnkd\.in)$/]
];
// "bot" must not match the Cubot phone brand; an empty user agent is not treated as a crawler for accounts, only for counting.
const bots=/(?<!cu)bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|python|curl|wget|httpclient|axios|scan|probe|detect|indexer|java\/|go-http|okhttp|libwww/i;
export const isBot=userAgent=>bots.test(userAgent||'');
// The owner's browsers opt out of counting with a cookie set at /api/internal/exclude.
export const isInternal=request=>/(?:^|;\s*)dpc_internal=1(?:;|$)/.test(request.headers.get('cookie')||'');
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
 return request.method==='GET'&&h.get('sec-fetch-dest')==='document'&&!h.get('sec-purpose')&&h.get('purpose')!=='prefetch'&&!!h.get('user-agent')&&!bots.test(h.get('user-agent'));
}
export function sourceOf(request){
 const params=new URL(request.url).searchParams;
 if(paidParams.some(key=>params.has(key))||/^(cpc|ppc|paid|paid_social|paidsocial)$/i.test(params.get('utm_medium')||''))return 'paid';
 if(params.get('ref')==='keepsake')return 'keepsake';
 let host='';try{host=new URL(request.headers.get('referer')||'').hostname.replace(/^www\./,'');}catch{/* No referrer is a direct visit. */}
 if(!host||host===new URL(request.url).hostname||host.endsWith('diypokecard.com'))return channels.has((params.get('utm_source')||'').toLowerCase())?'other':'direct';
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
  if(fresh.meta.changes){
   const params=new URL(request.url).searchParams,campaign=campaignOf(params.get('utm_campaign'),env),channel=(params.get('utm_source')||params.get('ref')||'').toLowerCase();
   names.push('visitors',`landing:${landingOf(path)||'other'}`,`source:${sourceOf(request)}`);
   if(campaign)names.push(`campaign:${campaign}`);
   if(channels.has(channel))names.push(`channel:${channel}`);
  }
  await db.batch(names.map(name=>count(db,name,day)));
 }catch(error){console.error('Pageview metric failed',error.name);}
}
export async function pruneVisitors(db,now=new Date()){
 const cutoff=today(new Date(now.getTime()-2*86400000)),old=today(new Date(now.getTime()-400*86400000));
 await db.batch([db.prepare('DELETE FROM daily_visitors WHERE day<?').bind(cutoff),db.prepare('DELETE FROM analytics_salts WHERE day<?').bind(cutoff),db.prepare('DELETE FROM daily_metrics WHERE day<?').bind(old)]);
}
