import { hash, uid, clean, emailOf, validEmail, problem, sessionFor, issueSession, getAccount, getAccountByEmail, publicAccount, rate, profile, consumeToken, refund } from './storage.mjs';
import { checkout, webhook, stripeClient, finalize, validPurchase, plans } from './billing.mjs';
import { sendAccessEmail, restorePage } from './email.mjs';
import { generateArtwork } from './ai.mjs';
import { clientEvents, isHumanPageview, recordPageview, pruneVisitors, track } from './metrics.mjs';
import { sendWeeklyReport, WEEKLY_CRON } from './report.mjs';
const cookie=(token,secure=true)=>`dpc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?'; Secure':''}`;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}});
function secure(response,privateResponse=false){
 const r=new Response(response.body,response);r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('X-Frame-Options','DENY');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 r.headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
 r.headers.set('Strict-Transport-Security','max-age=31536000');
 if(privateResponse){r.headers.set('Cache-Control','private, no-store');r.headers.set('X-Robots-Tag','noindex, nofollow');}return r;
}
async function bodyJSON(request){
 if(!request.headers.get('content-type')?.includes('application/json'))throw problem('Use a JSON request.',415);
 if(Number(request.headers.get('content-length'))>6_000_000)throw problem('That image is too large.',413);
 const raw=await request.text();if(raw.length>6_000_000)throw problem('That image is too large.',413);
 try{const data=JSON.parse(raw);if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}catch{throw problem('The request was not valid JSON.');}
}
async function api(request,env,ctx){
 const url=new URL(request.url),path=url.pathname;
 if(!env.DB)throw problem('The studio service is temporarily unavailable.',503);
 if(path==='/api/healthz')return json({ok:true,platform:'cloudflare-workers'});
 if(path==='/api/webhook'&&request.method==='POST')return json(await webhook(request,env));
 if(request.method==='POST'){
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin&&origin!==env.BASE_URL)throw problem('Please use the form on this website.',403);
 }
 const ipHash=await hash(request.headers.get('cf-connecting-ip')||'local');
 // Feature counts are handled before sessions so a beacon never creates an anonymous account.
 if(path==='/api/event'&&request.method==='POST'){
  const name=url.searchParams.get('e');if(!clientEvents.has(name))throw problem('Unknown event.');
  await rate(env.DB,`event:${ipHash}`,300,3600);await track(env.DB,`ui:${name}`);
  return new Response(null,{status:204});
 }
 if(path==='/api/account/restore/consume'){
  if(request.method==='GET')return new Response(restorePage(url),{headers:{'content-type':'text/html; charset=utf-8'}});
  if(request.method==='POST'){
   await rate(env.DB,`restore-use:${ipHash}`,15,3600);if(Number(request.headers.get('content-length'))>4096)throw problem('Invalid sign-in request.',413);const form=await request.formData();
   const account=await consumeToken(env.DB,form.get('token'));const token=await issueSession(env.DB,account.id,request.headers.get('user-agent'));
   const generation=clean(form.get('generation'),40),next=new URL('/studio?restored=1',url.origin);if(/^gen_[a-f0-9]{32}$/.test(generation))next.searchParams.set('generation',generation);
   return new Response(null,{status:303,headers:{location:next.href,'set-cookie':cookie(token,url.protocol==='https:')}});
  }
 }
 if(path==='/api/account/restore/request'&&request.method==='POST'){
  const data=await bodyJSON(request),email=emailOf(data.email);if(!validEmail(email))throw problem('Enter a valid email address.');
  if(env.EMAIL_ENABLED!=='true'||!env.EMAIL)throw problem('Account email is not available yet.',503);
  await rate(env.DB,`restore-ip:${ipHash}`,5,3600);await rate(env.DB,`restore-email:${await hash(email)}`,3,3600);
  const account=await getAccountByEmail(env.DB,email);if(account)await sendAccessEmail(env,account);
  return json({ok:true,message:'If that email has an account, a sign-in link is on the way.'});
 }
 const session=await sessionFor(request,env);let account=session.account,response;
 const withCookie=res=>{if(session.token)res.headers.append('set-cookie',cookie(session.token,url.protocol==='https:'));return res;};
 try{
  const ai=env.AI_ENABLED==='true'&&!!env.AI&&!!env.ARTWORK;
  const emailReady=env.EMAIL_ENABLED==='true'&&!!env.EMAIL;
  if(path==='/api/session'&&request.method==='GET')response=json({account:publicAccount(account),restoreAvailable:emailReady,capabilities:{ai,aiPhoto:ai,payments:ai&&emailReady&&env.PAYMENTS_ENABLED==='true'&&!!env.STRIPE_SECRET_KEY},plans:Object.entries(plans).filter(([,p])=>p.active).map(([id,p])=>({id,...p}))});
  else if(path==='/api/credits'&&request.method==='GET')response=json(publicAccount(account));
  else if(path==='/api/account'&&request.method==='POST')response=json(publicAccount(await profile(env.DB,account,await bodyJSON(request))));
  else if(path==='/api/checkout'&&request.method==='POST'){await rate(env.DB,`checkout:${account.id}`,8,3600);response=json(await checkout(request,env,account,await bodyJSON(request)));}
  else if(path==='/api/checkout/verify'&&request.method==='GET'){
   if(!env.STRIPE_SECRET_KEY)throw problem('Checkout verification is not configured.',503);
   const id=clean(url.searchParams.get('session_id'),150);if(!/^cs_(test|live)_[a-zA-Z0-9]+$/.test(id))throw problem('Invalid payment reference.');
   await rate(env.DB,`verify:${account.id}`,20,3600);
   const s=await stripeClient(env).checkout.sessions.retrieve(id),stored=await env.DB.prepare('SELECT * FROM checkout_sessions WHERE stripe_session_id=?').bind(id).first();
   if(!validPurchase(s,stored))throw problem('Payment not found for this product.',404);
   const paid=s.payment_status==='paid';if(paid)await finalize(env.DB,s);
   response=json({verificationStatus:paid?'credited':s.status==='expired'?'failed':'pending',creditedToCurrentSession:s.metadata.accountId===account.id,account:publicAccount(await getAccount(env.DB,account.id))});
  }
  else if(['/api/ai/pokemon-create','/api/ai/pokemon-from-photo'].includes(path)&&request.method==='POST'){
   if(!ai)throw problem('AI artwork is not available yet. The free editor is ready to use.',503);
   response=json(await generateArtwork(request,env,account,await bodyJSON(request),path.endsWith('from-photo'),ipHash));
  }
  else if(/^\/api\/card\/(?:art\/)?gen_[a-f0-9]{32}$/.test(path)&&request.method==='GET'){
   const id=path.split('/').at(-1),row=await env.DB.prepare('SELECT * FROM generation_results WHERE request_id=? AND account_id=?').bind(id,account.id).first();
   if(!row)throw problem('This card was not found in your account.',404);
   if(path.includes('/art/')){const object=await env.ARTWORK.get(row.image_url);if(!object)throw problem('This artwork is no longer available. Use your local saved copy.',404);response=new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType||'image/png'}});}
   else response=json({generationId:id,cardData:JSON.parse(row.card_data_json),artUrl:`/api/card/art/${id}`});
  }
  else if(path==='/api/card/email'&&request.method==='POST'){
   const data=await bodyJSON(request);if(!/^gen_[a-f0-9]{32}$/.test(data.generationId||''))throw problem('Choose a generated card first.');
   const exists=await env.DB.prepare('SELECT request_id FROM generation_results WHERE request_id=? AND account_id=?').bind(data.generationId,account.id).first();if(!exists)throw problem('Card not found in your account.',404);
   if(data.acceptTerms!==true||data.acceptPrivacy!==true)throw problem('Please accept the Terms and Privacy Policy.');
   await rate(env.DB,`card-email:${account.id}`,5,3600);account=await profile(env.DB,account,data);if(!account.email)throw problem('Enter an adult email address.');
   await sendAccessEmail(env,account,data.generationId);response=json({emailStatus:'sent'});
  }else response=json({error:'API endpoint not found.'},404);
 }catch(error){response=json({error:error.status?error.message:'That request did not finish. Please try again.'},error.status||500);if(!error.status)console.error('API failure',path,error.name);}
 return withCookie(response);
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);try{
   if(url.pathname.startsWith('/api/'))return secure(await api(request,env,ctx),true);
   if(!['GET','HEAD'].includes(request.method))return secure(json({error:'Method not allowed.'},405));
   if(url.hostname==='www.diypokecard.com')return Response.redirect(`https://diypokecard.com${url.pathname}${url.search}`,301);
   if(url.pathname==='/index.html')return Response.redirect(new URL('/',url).href,301);
   let target=url.pathname==='/'?'/index.html':/\.[a-z0-9]+$/i.test(url.pathname)?url.pathname:url.pathname+'.html';
   if(url.pathname.endsWith('/')&&url.pathname!=='/')return Response.redirect(new URL(url.pathname.slice(0,-1)+url.search,url).href,301);
   const assetURL=new URL(request.url);assetURL.pathname=target;
   let response=await env.ASSETS.fetch(new Request(assetURL,request));
   if(response.status===404){assetURL.pathname='/404.html';response=await env.ASSETS.fetch(new Request(assetURL));response=new Response(response.body,{status:404,headers:response.headers});}
   response=secure(response);if(response.headers.get('content-type')?.includes('text/html')){
    response.headers.set('cache-control','no-cache');
    if(response.status===200&&env.DB&&isHumanPageview(request))ctx?.waitUntil?.(recordPageview(request,env,url.pathname));
   }
   return response;
  }catch(error){if(!error.status)console.error('Worker failure',error.name);return secure(json({error:error.status?error.message:'The studio service is temporarily unavailable.'},error.status||500),true);}
 },
 async scheduled(event,env){
  if(event?.cron===WEEKLY_CRON){await sendWeeklyReport(env);return;}
  const stale=await env.DB.prepare("SELECT request_id FROM generation_attempts WHERE status='reserved' AND created_at<datetime('now','-20 minutes') LIMIT 100").all();
  for(const row of stale.results)await refund(env.DB,row.request_id);
  await env.DB.batch([env.DB.prepare("DELETE FROM trial_claims WHERE claimed_at<datetime('now','-2 days')"),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(Math.floor(Date.now()/1000)),env.DB.prepare("DELETE FROM auth_tokens WHERE expires_at<datetime('now','-1 day')"),env.DB.prepare("DELETE FROM sessions WHERE last_seen_at<datetime('now','-60 days')")]);
  await pruneVisitors(env.DB);
 }
};
