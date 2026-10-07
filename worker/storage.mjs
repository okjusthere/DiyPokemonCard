// D1 operations keep balance changes inside SQL transactions.
export const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export function problem(message, status=400) { return Object.assign(new Error(message), { status }); }
export const clean = (value, max=100) => String(value ?? '').replace(/[\u0000-\u001f]/g,'').trim().slice(0,max);
export const emailOf = value => clean(value,254).toLowerCase();
export const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const accountSQL = `SELECT a.*, COALESCE((SELECT SUM(delta) FROM credit_ledger WHERE account_id=a.id),0) AS paid_credits FROM accounts a`;
export function publicAccount(a) { if(!a)return null; const paidCredits=Number(a.paid_credits)||0,promoCreditsRemaining=Number(a.promo_credits_remaining)||0;return {id:a.id,email:a.email||'',displayName:a.display_name||'',paidCredits,promoCreditsRemaining,totalCredits:paidCredits+promoCreditsRemaining,hasCredits:paidCredits+promoCreditsRemaining>0,consents:{termsAccepted:!!a.terms_accepted_at,privacyAccepted:!!a.privacy_accepted_at,photoParentConsent:!!a.photo_parent_consent_at}}; }
export const getAccount = (db,id) => db.prepare(accountSQL+' WHERE a.id=?').bind(id).first();
export const getAccountByEmail = (db,email) => db.prepare(accountSQL+' WHERE a.email=?').bind(email).first();
export async function rate(db,key,limit,seconds){
 const now=Math.floor(Date.now()/1000),bucket=`${key}:${Math.floor(now/seconds)}`;
 const row=await db.prepare(`INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(bucket,now+seconds*2).first();
 if(row.count>limit)throw problem('Please wait a little before trying again.',429);
}
export async function issueSession(db,accountId,userAgent='') {
 const id=uid('sess'),secret=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 await db.prepare('INSERT INTO sessions(id,account_id,secret_hash,user_agent) VALUES(?,?,?,?)').bind(id,accountId,await hash(secret),clean(userAgent,180)).run();
 return `${id}.${secret}`;
}
export async function sessionFor(request,env){
 const match=(request.headers.get('cookie')||'').match(/(?:^|;\s*)dpc_session=(sess_[a-f0-9]{32}\.[a-f0-9]{64})(?:;|$)/);
 if(match){const [id,secret]=match[1].split('.');const row=await env.DB.prepare("SELECT * FROM sessions WHERE id=? AND last_seen_at>datetime('now','-30 days')").bind(id).first();
  if(row&&row.secret_hash===await hash(secret)){const account=await getAccount(env.DB,row.account_id);if(account){await env.DB.prepare("UPDATE sessions SET last_seen_at=datetime('now') WHERE id=?").bind(id).run();return {account};}}
 }
 const ip=request.headers.get('cf-connecting-ip')||'local';await rate(env.DB,`session:${await hash(ip)}`,20,3600);
 const id=uid('acct');
 await env.DB.prepare('INSERT INTO accounts(id,promo_credits_remaining) VALUES(?,?)').bind(id,Math.min(2,Math.max(0,Number(env.TRIAL_CREDITS)||0))).run();
 return {account:await getAccount(env.DB,id),token:await issueSession(env.DB,id,request.headers.get('user-agent'))};
}
export async function profile(db,account,input){
 const email=emailOf(input.email||account.email);
 if(email&&!validEmail(email))throw problem('Enter a valid adult email address.');
 const owner=email&&await getAccountByEmail(db,email);if(owner&&owner.id!==account.id)throw problem('This email already has an account. Use Email me a sign-in link to restore it.',409);
 await db.prepare(`UPDATE accounts SET email=?,display_name=?,terms_accepted_at=CASE WHEN ? THEN COALESCE(terms_accepted_at,datetime('now')) ELSE terms_accepted_at END,privacy_accepted_at=CASE WHEN ? THEN COALESCE(privacy_accepted_at,datetime('now')) ELSE privacy_accepted_at END,photo_parent_consent_at=CASE WHEN ? THEN COALESCE(photo_parent_consent_at,datetime('now')) ELSE photo_parent_consent_at END,updated_at=datetime('now') WHERE id=?`).bind(email||null,clean(input.displayName||account.display_name,24),input.acceptTerms===true?1:0,input.acceptPrivacy===true?1:0,input.photoParentConsent===true?1:0,account.id).run();
 return getAccount(db,account.id);
}
export async function reserve(db,accountId,requestId,mode){
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO generation_attempts(request_id,account_id,mode,charge_source,status) SELECT ?,id,?,CASE WHEN promo_credits_remaining>0 THEN 'promo' ELSE 'paid' END,'reserved' FROM accounts WHERE id=? AND (promo_credits_remaining>0 OR (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE account_id=?)>0) AND NOT EXISTS(SELECT 1 FROM generation_attempts WHERE account_id=? AND status='reserved')`).bind(requestId,mode,accountId,accountId,accountId),
  db.prepare(`UPDATE accounts SET promo_credits_remaining=promo_credits_remaining-1 WHERE id=? AND changes()=1 AND EXISTS(SELECT 1 FROM generation_attempts WHERE request_id=? AND charge_source='promo')`).bind(accountId,requestId),
  db.prepare(`INSERT OR IGNORE INTO credit_ledger(account_id,delta,reason,reference) SELECT account_id,-1,'generation_reserved',? FROM generation_attempts WHERE request_id=? AND charge_source='paid' AND status='reserved'`).bind(`generation:${requestId}:debit`,requestId)
 ]);
 const attempt=await db.prepare('SELECT * FROM generation_attempts WHERE request_id=? AND account_id=?').bind(requestId,accountId).first();
 if(!attempt)throw problem('No available AI credit, or a generation is already running.',402);
 if(!result[0].meta.changes)throw problem('This generation is already running. Wait for the first result.',409);
 return attempt;
}
export async function refund(db,id){
 await db.batch([
  db.prepare(`UPDATE accounts SET promo_credits_remaining=promo_credits_remaining+1 WHERE id=(SELECT account_id FROM generation_attempts WHERE request_id=? AND status='reserved' AND charge_source='promo')`).bind(id),
  db.prepare(`INSERT OR IGNORE INTO credit_ledger(account_id,delta,reason,reference) SELECT account_id,1,'generation_refund',? FROM generation_attempts WHERE request_id=? AND status='reserved' AND charge_source='paid'`).bind(`generation:${id}:refund`,id),
  db.prepare(`UPDATE generation_attempts SET status='refunded',refunded_at=datetime('now') WHERE request_id=? AND status='reserved'`).bind(id)
 ]);
}
export async function complete(db,account,id,mode,key,cardData){
 await db.batch([
  db.prepare(`INSERT INTO generation_results(request_id,account_id,mode,image_url,card_data_json,display_name) SELECT request_id,account_id,mode,?,?,? FROM generation_attempts WHERE request_id=? AND account_id=? AND status='reserved'`).bind(key,JSON.stringify(cardData),account.display_name||'You',id,account.id),
  db.prepare(`UPDATE generation_attempts SET status='completed',completed_at=datetime('now') WHERE request_id=? AND status='reserved'`).bind(id)
 ]);
}
export async function consumeToken(db,token){
 const [id,secret]=String(token||'').split('.');if(!/^restore_[a-f0-9]{32}$/.test(id||'')||!secret)throw problem('This sign-in link is invalid or expired.');
 const row=await db.prepare(`UPDATE auth_tokens SET used_at=datetime('now') WHERE id=? AND token_hash=? AND used_at IS NULL AND expires_at>? RETURNING account_id`).bind(id,await hash(secret),new Date().toISOString()).first();
 if(!row)throw problem('This sign-in link is invalid, expired, or already used.');
 return getAccount(db,row.account_id);
}
