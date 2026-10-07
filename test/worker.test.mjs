import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {uid, hash, getAccount, reserve, refund, complete, consumeToken, sessionFor} from '../worker/storage.mjs';
import {validPurchase, finalize, webhook} from '../worker/billing.mjs';
import worker from '../worker/index.mjs';
import {generateArtwork, franchiseName} from '../worker/ai.mjs';
import {recordPageview, isHumanPageview, sourceOf} from '../worker/metrics.mjs';
import {weeklyReport, sendWeeklyReport} from '../worker/report.mjs';
let mf,db;
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'studio-test',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-10-07'}]}));
 db=await mf.getD1Database('DB');
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()){
  const sql=await readFile(new URL(file,dir),'utf8');
  await db.batch(sql.split(';').filter(s=>s.replace(/--.*$/gm,'').trim()).map(s=>db.prepare(s)));
 }
});
after(async()=>{await mf?.dispose();});
async function account(promo=1){const id=uid('acct');await db.prepare('INSERT INTO accounts(id,promo_credits_remaining) VALUES(?,?)').bind(id,promo).run();return getAccount(db,id);}
test('D1 reserves the final credit once under concurrent requests and refunds once',async()=>{
 const a=await account(),ids=[uid('gen'),uid('gen')];
 const results=await Promise.allSettled(ids.map(id=>reserve(db,a.id,id,'design')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await getAccount(db,a.id)).promo_credits_remaining,0);
 const id=ids[results.findIndex(r=>r.status==='fulfilled')];
 await assert.rejects(reserve(db,a.id,id,'design'));
 await Promise.all([refund(db,id),refund(db,id)]);
 assert.equal((await getAccount(db,a.id)).promo_credits_remaining,1);
});
test('paid debit and success are idempotent; successful images cannot be refunded',async()=>{
 const a=await account(0),id=uid('gen');
 await db.prepare("INSERT INTO credit_ledger(account_id,delta,reason,reference) VALUES(?,1,'test',?)").bind(a.id,uid('grant')).run();
 await reserve(db,a.id,id,'design');await assert.rejects(reserve(db,a.id,id,'design'));
 assert.equal((await getAccount(db,a.id)).paid_credits,0);
 await complete(db,a,id,'design','private/key',{name:'Fox'});await refund(db,id);
 assert.equal((await getAccount(db,a.id)).paid_credits,0);
});
test('Stripe ignores foreign app, wrong amount, wrong currency, and old plans; delivery is exactly once',async()=>{
 const a=await account(0),s={id:'cs_test_integration',mode:'payment',currency:'usd',amount_total:499,payment_status:'paid',metadata:{app:'diypokecard',accountId:a.id,plan:'starter15',credits:'15',email:'test@example.com'}};
 assert.equal(validPurchase(s),true);
 for(const bad of [{amount_total:1},{currency:'eur'},{metadata:{...s.metadata,app:'other-app'}},{metadata:{...s.metadata,plan:'single',credits:'1'}}])assert.equal(validPurchase({...s,...bad},{status:'created'}),false);
 await Promise.all([finalize(db,s),finalize(db,s)]);
 assert.equal((await getAccount(db,a.id)).paid_credits,15);
 await assert.rejects(webhook(new Request('https://diypokecard.com/api/webhook',{method:'POST',body:'{}',headers:{'stripe-signature':'t=1,v1=wrong'}}),{DB:db,STRIPE_SECRET_KEY:'sk_test_not_real',STRIPE_WEBHOOK_SECRET:'whsec_test'}),/signature/);
});
test('restore token is single-use; session cookies do not grant another account’s artwork',async()=>{
 const a=await account(),id=uid('restore'),secret='a'.repeat(64);
 await db.prepare('INSERT INTO auth_tokens(id,account_id,email,token_hash,expires_at) VALUES(?,?,?,?,?)').bind(id,a.id,'test@example.com',await hash(secret),new Date(Date.now()+60000).toISOString()).run();
 const results=await Promise.allSettled([consumeToken(db,`${id}.${secret}`),consumeToken(db,`${id}.${secret}`)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const env={DB:db,TRIAL_CREDITS:'1',BASE_URL:'https://diypokecard.com'};
 const gen=uid('gen');await reserve(db,a.id,gen,'design');await complete(db,a,gen,'design','private/key',{name:'Private'});
 const response=await worker.fetch(new Request(`https://diypokecard.com/api/card/art/${gen}`),env,{});
 assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const csrf=await worker.fetch(new Request('https://diypokecard.com/api/account',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:'{}'}),env,{});
 assert.equal(csrf.status,403);
 const getLink=await worker.fetch(new Request(`https://diypokecard.com/api/account/restore/consume?token=${id}.${secret}`),env,{});
 assert.match(await getLink.text(),/method="post"/i);
});
test('lost-response retry returns the existing AI result without spending another credit; failures refund',async()=>{
 const {generateArtwork}=await import('../worker/ai.mjs');
 const a=await account(),id=uid('gen');let images=0;
 const env={DB:db,AI_IMAGE_MODEL:'art',AI_TEXT_MODEL:'text',ARTWORK:{async put(){}},AI:{async run(model){if(model==='text')return {response:'{"name":"Frosty","attack":"Snow swirl","ability":"Brings a little winter magic."}'};images++;return {image:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};}}};
 const data={requestId:id,color:'blue',animal:'fox',power:'ice'};
 const first=await generateArtwork(null,env,a,data,false,uid('ip'));
 const retry=await generateArtwork(null,env,await getAccount(db,a.id),data,false,uid('ip'));
 assert.equal(first.generationId,retry.generationId);assert.equal(images,1);assert.equal((await getAccount(db,a.id)).promo_credits_remaining,0);
 const failedAccount=await account(),failedId=uid('gen'),ip=uid('ip'),broken={...env,AI:{async run(){throw Error('Provider unavailable')}}};
 await assert.rejects(generateArtwork(null,broken,failedAccount,{...data,requestId:failedId},false,ip),e=>e.status===502);
 assert.equal((await getAccount(db,failedAccount.id)).promo_credits_remaining,1);
 await assert.rejects(generateArtwork(null,env,failedAccount,{...data,requestId:failedId},false,ip),e=>e.status===410);
 await generateArtwork(null,env,failedAccount,{...data,requestId:uid('gen')},false,ip);
 assert.equal((await getAccount(db,failedAccount.id)).promo_credits_remaining,0);
});
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const metricTotal=async(name)=>Number((await db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM daily_metrics WHERE name=?').bind(name).first()).n);
function aiEnv(extra={},textResponse='{"name":"Frosty","attack":"Snow swirl","ability":"Brings a little winter magic."}'){
 return {DB:db,AI_IMAGE_MODEL:'art',AI_TEXT_MODEL:'text',ARTWORK:{async put(){}},AI:{async run(model){return model==='text'?{response:textResponse}:{image:PNG};}},...extra};
}
test('free trials have their own daily ceiling and never block paying customers',async()=>{
 await db.prepare('DELETE FROM rate_limits').run();
 const env=aiEnv({AI_TRIAL_DAILY_LIMIT:'1',AI_PAID_DAILY_LIMIT:'5'}),data=()=>({requestId:uid('gen'),color:'blue',animal:'fox',power:'ice'});
 const empty=await account(0);
 await assert.rejects(generateArtwork(null,env,empty,data(),false,uid('ip')),e=>e.status===402);
 await generateArtwork(null,env,await account(),data(),false,uid('ip'));
 const blocked=await account(),before=await metricTotal('ai_trial_cap_hit');
 await assert.rejects(generateArtwork(null,env,blocked,data(),false,uid('ip')),e=>e.status===429&&/free AI trials/.test(e.message));
 assert.equal((await getAccount(db,blocked.id)).promo_credits_remaining,1);
 assert.equal(await metricTotal('ai_trial_cap_hit'),before+1);
 const buyer=await account(0);
 await db.prepare("INSERT INTO credit_ledger(account_id,delta,reason,reference) VALUES(?,2,'test',?)").bind(buyer.id,uid('grant')).run();
 await generateArtwork(null,env,await getAccount(db,buyer.id),data(),false,uid('ip'));
 assert.equal((await getAccount(db,buyer.id)).paid_credits,1);
});
test('franchise names are kept off AI cards without blocking ordinary words',()=>{
 for(const name of ['Pikachu','PIKA-CHU','Pokémon Jr','Mewtwo','Charizards','team rocket'])assert.equal(franchiseName(name),true,name);
 for(const name of ['Sparky','somewhere','Poke attack','Flare on','Moonwhisk','Mewing kitten'])assert.equal(franchiseName(name),false,name);
});
test('franchise names from the text model or photo title fall back to original card text',async()=>{
 await db.prepare('DELETE FROM rate_limits').run();
 const before=await metricTotal('franchise_name_blocked');
 const design=await generateArtwork(null,aiEnv({},'{"name":"Pikachu Spark","attack":"Thunder","ability":"Zaps."}'),await account(),{requestId:uid('gen'),color:'blue',animal:'fox',power:'ice'},false,uid('ip'));
 assert.equal(design.cardData.name,'blue fox');
 const photo=await generateArtwork(null,aiEnv(),await account(),{requestId:uid('gen'),photo:`data:image/png;base64,${PNG}`,cardTitle:'Poké-mon Max',acceptTerms:true,acceptPrivacy:true,photoParentConsent:true},true,uid('ip'));
 assert.equal(photo.cardData.name,'My little legend');
 assert.equal(await metricTotal('franchise_name_blocked'),before+2);
});
test('pageviews count unique daily visitors, landing page and source without cookies',async()=>{
 const browser={'sec-fetch-dest':'document','user-agent':'Mozilla/5.0 Safari','cf-connecting-ip':'203.0.113.9'};
 const visit=(path,headers={})=>new Request(`https://diypokecard.com${path}`,{headers:{...browser,...headers}});
 assert.equal(isHumanPageview(visit('/')),true);
 assert.equal(isHumanPageview(visit('/',{'user-agent':'Googlebot/2.1'})),false);
 assert.equal(isHumanPageview(visit('/',{'sec-purpose':'prefetch'})),false);
 assert.equal(isHumanPageview(new Request('https://diypokecard.com/')),false);
 assert.equal(sourceOf(visit('/',{referer:'https://www.google.com/'})),'search');
 assert.equal(sourceOf(visit('/',{referer:'https://gemini.google.com/app'})),'ai');
 assert.equal(sourceOf(visit('/',{referer:'https://www.pinterest.com/pin/1'})),'social');
 assert.equal(sourceOf(visit('/',{referer:'https://diypokecard.com/pricing'})),'direct');
 const [visitors,views,landing,search]=await Promise.all(['visitors','pageviews','landing:/photo-card-maker','source:search'].map(metricTotal));
 await recordPageview(visit('/photo-card-maker',{referer:'https://www.google.com/'}),{DB:db},'/photo-card-maker');
 await recordPageview(visit('/studio'),{DB:db},'/studio');
 assert.equal(await metricTotal('visitors'),visitors+1);
 assert.equal(await metricTotal('pageviews'),views+2);
 assert.equal(await metricTotal('landing:/photo-card-maker'),landing+1);
 assert.equal(await metricTotal('source:search'),search+1);
});
test('feature beacons accept known event names only and never create accounts',async()=>{
 const accounts=async()=>Number((await db.prepare('SELECT COUNT(*) AS n FROM accounts').first()).n);
 const env={DB:db,BASE_URL:'https://diypokecard.com'},before=await accounts(),png=await metricTotal('ui:png');
 const send=e=>worker.fetch(new Request(`https://diypokecard.com/api/event?e=${e}`,{method:'POST',headers:{origin:'https://diypokecard.com'}}),env,{});
 assert.equal((await send('png')).status,204);
 assert.equal((await send('kid-name')).status,400);
 assert.equal(await metricTotal('ui:png'),png+1);
 assert.equal(await accounts(),before);
});
test('weekly report summarizes last week and emails only the configured owner',async()=>{
 const day='2030-01-03',a=await account(0);
 await db.batch([['visitors',40],['pageviews',90],['landing:/photo-card-maker',25],['source:search',30],['ui:png',12]].map(([name,n])=>db.prepare('INSERT INTO daily_metrics(day,name,count) VALUES(?,?,?)').bind(day,name,n)));
 await db.prepare("INSERT INTO daily_metrics(day,name,count) VALUES('2029-12-27','visitors',20)").run();
 await db.prepare("INSERT INTO checkout_sessions(stripe_session_id,account_id,plan,credits_added,status,created_at,completed_at) VALUES('cs_test_report',?,'starter15',15,'completed','2030-01-03 10:00:00','2030-01-03 10:01:00')").bind(a.id).run();
 await db.prepare("INSERT INTO generation_attempts(request_id,account_id,mode,charge_source,status,created_at) VALUES(?,?,'design','promo','completed','2030-01-04 09:00:00')").bind(uid('gen'),a.id).run();
 const now=new Date('2030-01-07T13:00:00Z'),report=await weeklyReport(db,now);
 assert.match(report.subject,/12\/31–01\/06：访客 40，订单 1，收入 \$4\.99/);
 assert.match(report.text,/访客（按天去重）：40（20）/);
 assert.match(report.text,/入口页 \/photo-card-maker：25（0）/);
 assert.match(report.text,/免费试用生成：1（0）/);
 assert.match(report.text,/付费转化率（订单\/访客）：2\.5%（0\.0%）/);
 const sent=[],email={async send(message){sent.push(message);}};
 assert.equal(await sendWeeklyReport({DB:db,EMAIL_ENABLED:'true',EMAIL:email},now),false);
 assert.equal(await sendWeeklyReport({DB:db,EMAIL_ENABLED:'true',EMAIL:email,REPORT_EMAIL:'owner@example.com'},now),true);
 assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.com');assert.equal(sent[0].subject,report.subject);
});
