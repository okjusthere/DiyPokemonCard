import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {uid, hash, getAccount, reserve, refund, complete, consumeToken, sessionFor} from '../worker/storage.mjs';
import {validPurchase, finalize, webhook} from '../worker/billing.mjs';
import worker from '../worker/index.mjs';
let mf,db;
before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'studio-test',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-10-07'}]}));
 db=await mf.getD1Database('DB');
 const sql=await readFile(new URL('../migrations/0001_studio.sql',import.meta.url),'utf8');
 await db.batch(sql.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
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
