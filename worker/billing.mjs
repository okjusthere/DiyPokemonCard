import Stripe from 'stripe';
import plans from '../lib/pricing.json' with { type: 'json' };
import { clean, emailOf, validEmail, profile, getAccount, getAccountByEmail, problem, uid } from './storage.mjs';
export { plans };
export function stripeClient(env){return new Stripe(env.STRIPE_SECRET_KEY,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2});}
export function validPurchase(session,stored){
 const plan=plans[session?.metadata?.plan];
 if(!plan?.active||session.mode!=='payment'||session.currency!=='usd'||session.amount_total!==plan.price||Number(session.metadata.credits)!==plan.credits)return false;
 return session.metadata.app==='diypokecard' && /^acct_[a-f0-9]{32}$/.test(session.metadata.accountId||'');
}
export async function finalize(db,session){
 const existing=await db.prepare('SELECT * FROM checkout_sessions WHERE stripe_session_id=?').bind(session.id).first();
 if(!validPurchase(session,existing)||session.payment_status!=='paid')throw problem('This payment does not match a DIY Poké Card purchase.',400);
 if(existing?.status==='completed')return getAccount(db,existing.account_id);
 const email=emailOf(session.customer_details?.email||session.metadata.email);
 let account=await getAccount(db,session.metadata.accountId||'');
 if(!account&&validEmail(email))account=await getAccountByEmail(db,email);
 if(!account){
  if(!validEmail(email))throw problem('The purchase could not be linked to an account. Contact support.',409);
  const id=/^acct_[a-f0-9]{32}$/.test(session.metadata.accountId||'')?session.metadata.accountId:uid('acct');
  await db.prepare('INSERT OR IGNORE INTO accounts(id,email,promo_credits_remaining) VALUES(?,?,0)').bind(id,email).run();
  account=await getAccount(db,id)||await getAccountByEmail(db,email);
 }
 const plan=plans[session.metadata.plan];
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO checkout_sessions(stripe_session_id,account_id,email,plan,credits_added,status) VALUES(?,?,?,?,?,'created')`).bind(session.id,account.id,email,session.metadata.plan,plan.credits),
  db.prepare(`INSERT OR IGNORE INTO credit_ledger(account_id,delta,reason,reference) SELECT account_id,credits_added,'stripe_purchase',? FROM checkout_sessions WHERE stripe_session_id=?`).bind(`stripe:${session.id}:credit`,session.id),
  db.prepare(`UPDATE checkout_sessions SET status='completed',completed_at=COALESCE(completed_at,datetime('now')) WHERE stripe_session_id=?`).bind(session.id)
 ]);
 const row=await db.prepare('SELECT account_id FROM checkout_sessions WHERE stripe_session_id=?').bind(session.id).first();
 return getAccount(db,row.account_id);
}
export async function checkout(request,env,account,body){
 if(env.PAYMENTS_ENABLED!=='true'||!env.STRIPE_SECRET_KEY||env.AI_ENABLED!=='true'||env.EMAIL_ENABLED!=='true')throw problem('AI checkout is not available yet. The free card studio is ready to use.',503);
 const plan=plans[body.plan];if(!plan?.active)throw problem('Choose one of the available AI packs.');
 if(body.acceptTerms!==true||body.acceptPrivacy!==true)throw problem('An adult must accept the Terms and Privacy Policy.');
 account=await profile(env.DB,account,body);if(!account.email)throw problem('Enter your adult email to keep purchases recoverable.');
 const stripe=stripeClient(env);
 const priceId=env[`STRIPE_PRICE_${body.plan.toUpperCase()}`];
 const line=priceId?{price:priceId,quantity:1}:{price_data:{currency:'usd',unit_amount:plan.price,product_data:{name:`DIY Poké Card — ${plan.label}`,description:`${plan.credits} successful AI artwork generations. One-time purchase. No subscription.`}},quantity:1};
 const session=await stripe.checkout.sessions.create({mode:'payment',adaptive_pricing:{enabled:false},branding_settings:{display_name:'DIY Poké Card',background_color:'#faf9f6',button_color:'#5156ce',border_style:'rounded',icon:{type:'url',url:`${env.BASE_URL}/apple-touch-icon.png`}},line_items:[line],customer_email:account.email,client_reference_id:account.id,success_url:`${env.BASE_URL}/studio?payment=success&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${env.BASE_URL}/studio?payment=cancelled`,metadata:{app:'diypokecard',accountId:account.id,plan:body.plan,credits:String(plan.credits),email:account.email},payment_intent_data:{metadata:{app:'diypokecard',accountId:account.id,plan:body.plan}},expires_at:Math.floor(Date.now()/1000)+1800});
 await env.DB.prepare(`INSERT OR IGNORE INTO checkout_sessions(stripe_session_id,account_id,email,plan,credits_added,status) VALUES(?,?,?,?,?,'created')`).bind(session.id,account.id,account.email,body.plan,plan.credits).run();
 return {url:session.url};
}
export async function webhook(request,env){
 if(!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)throw problem('Payment webhook is not configured.',503);
 const signature=request.headers.get('stripe-signature');if(!signature)throw problem('Invalid payment signature.',400);
 let event;
 try{event=await stripeClient(env).webhooks.constructEventAsync(await request.text(),signature,env.STRIPE_WEBHOOK_SECRET,300,Stripe.createSubtleCryptoProvider());}catch{throw problem('Invalid payment signature.',400);}
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type))return {received:true,ignored:true};
 const s=event.data.object,stored=await env.DB.prepare('SELECT * FROM checkout_sessions WHERE stripe_session_id=?').bind(s.id).first();
 if(!validPurchase(s,stored)){console.info('Ignored foreign or invalid checkout event',event.id,event.type);return {received:true,ignored:true};}
 if(s.payment_status==='paid'&&event.type!=='checkout.session.async_payment_failed')await finalize(env.DB,s);
 else await env.DB.prepare(`UPDATE checkout_sessions SET status=? WHERE stripe_session_id=? AND status<>'completed'`).bind(event.type==='checkout.session.async_payment_failed'?'failed_async_payment':'awaiting_async_payment',s.id).run();
 return {received:true};
}
