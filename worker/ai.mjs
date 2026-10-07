import { clean, problem, uid, rate, profile, getAccount, publicAccount, reserve, refund, complete } from './storage.mjs';
import model from '../public/card-model.js';
const {normalizeCard}=model;
const colors=new Set(['red','blue','green','yellow','purple','pink','orange','white','black','rainbow']);
const animals=new Set(['cat','dog','rabbit','dragon','fox','bird','bear','turtle','wolf','panda','dinosaur','unicorn','bunny','shark']);
const powers={fire:'Fire',water:'Water',electric:'Electric',electricity:'Electric',lightning:'Electric',grass:'Grass',nature:'Grass',ice:'Ice',psychic:'Psychic',magic:'Psychic',flying:'Flying',wind:'Flying',ghost:'Ghost',invisible:'Ghost',super:'Normal'};
function bytesFromBase64(value){if(typeof value!=='string'||value.length>14_000_000||!/^[A-Za-z0-9+/=\s]+$/.test(value))throw Error('Invalid image output');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
export function imageType(bytes){
 if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 throw problem('The image format was not supported. Choose JPG, PNG, or WebP.');
}
function photoBlob(data){
 if(typeof data!=='string'||data.length>2_000_000||!/^data:image\/(png|jpeg|webp);base64,/.test(data))throw problem('Please choose a smaller JPG, PNG, or WebP image.');
 const bytes=bytesFromBase64(data.split(',')[1]),type=imageType(bytes);return new Blob([bytes],{type});
}
export async function generateArtwork(request,env,account,input,fromPhoto,ipHash){
 const color=clean(input.color,16),animal=clean(input.animal,16),power=clean(input.power,16);
 let photo;
 if(fromPhoto){if(input.acceptTerms!==true||input.acceptPrivacy!==true||input.photoParentConsent!==true)throw problem('An adult must confirm permission before sending a photo for AI transformation.');photo=photoBlob(input.photo);}
 else if(!colors.has(color)||!animals.has(animal)||!Object.hasOwn(powers,power))throw problem('Choose a color, companion and superpower from the studio.');
 const requestId=/^gen_[a-f0-9]{32}$/.test(input.requestId||'')?input.requestId:uid('gen');
 const old=await env.DB.prepare('SELECT * FROM generation_results WHERE request_id=? AND account_id=?').bind(requestId,account.id).first();
 if(old)return {generationId:requestId,cardData:JSON.parse(old.card_data_json),account:publicAccount(await getAccount(env.DB,account.id))};
 const attempt=await env.DB.prepare('SELECT status FROM generation_attempts WHERE request_id=? AND account_id=?').bind(requestId,account.id).first();
 if(attempt?.status==='reserved')throw problem('Your earlier request is still creating. Try Recover my artwork shortly; no extra credit will be used.',409);
 if(attempt?.status==='refunded')throw problem('Your earlier request could not finish and its credit was returned. Start a new generation when ready.',410);
 await rate(env.DB,`ai-account:${account.id}`,account.paid_credits>0?20:6,3600);await rate(env.DB,`ai-global`,Number(env.AI_DAILY_LIMIT)||100,86400);
 // An initial trial is free; the IP guard prevents creating endless anonymous trial accounts.
 if(account.promo_credits_remaining>0){
  const identity=`${ipHash}:${new Date().toISOString().slice(0,10)}`;
  await env.DB.prepare('INSERT OR IGNORE INTO trial_claims(identity_hash,account_id) VALUES(?,?)').bind(identity,account.id).run();
  const claim=await env.DB.prepare('SELECT account_id FROM trial_claims WHERE identity_hash=?').bind(identity).first();
  if(claim.account_id!==account.id)throw problem('The free AI trial has already been used on this connection today. The manual studio stays free.',429);
 }
 account=await profile(env.DB,account,{displayName:input.kidName,acceptTerms:fromPhoto&&input.acceptTerms,acceptPrivacy:fromPhoto&&input.acceptPrivacy,photoParentConsent:fromPhoto&&input.photoParentConsent});
 let reserved=false;
 try{
  await reserve(env.DB,account.id,requestId,fromPhoto?'photo':'design');reserved=true;
  let description=fromPhoto?'a lovingly illustrated version of the subject in reference image 0':`an original adorable ${color} ${animal} with ${power} powers`;
  const prompt=`Premium hand-painted fantasy trading-card illustration of ${description}. Friendly expressive eyes, detailed anime-inspired gouache brushwork, beautiful luminous fantasy environment, refined warm and cool color harmony, polished professional illustration. Center the main subject and show it completely with generous space around the face, ears and silhouette. Family-friendly, joyful, adventurous. ${fromPhoto?'Preserve the reference subject\'s visible hairstyle, clothing, expression, species and recognizable features; transform only the artistic style.':''} Artwork only. No card border, no text, no letters, no logos, no watermark. Create an original character, not an existing franchise character. No violence or adult content.`;
  const form=new FormData();form.append('prompt',prompt);form.append('width','1024');form.append('height','1024');if(photo)form.append('input_image_0',photo,'reference.jpg');
  const encoded=new Response(form);
  const output=await env.AI.run(env.AI_IMAGE_MODEL,{multipart:{body:encoded.body,contentType:encoded.headers.get('content-type')}});
  const bytes=bytesFromBase64(output.image),mime=imageType(bytes);
  let text={};
  // Text is optional: an otherwise successful illustration should not be lost to a text-model error.
  if(!fromPhoto)try{
   const answer=await env.AI.run(env.AI_TEXT_MODEL,{messages:[{role:'system',content:'Invent an original friendly fantasy trading-card character for children. Return only JSON with name (max 24 characters), attack (max 30), ability (max 100). No known franchise names.'},{role:'user',content:`A ${color} ${animal} with ${power} powers.`}],max_tokens:180});
   const raw=typeof answer.response==='string'?answer.response:'';text=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||'{}');
  }catch{/* Editable starter text remains available. */}
  const card=normalizeCard({name:fromPhoto?clean(input.cardTitle,24)||'My little legend':text.name||`${color} ${animal}`,type:fromPhoto?'Psychic':powers[power],attack:text.attack||'A little everyday magic',ability:text.ability||'A one-of-a-kind companion with a story only you can tell.',trainer:account.display_name||'You',hp:90,damage:40,source:'ai',generationId:requestId,art:`/api/card/art/${requestId}`,artWidth:1024,artHeight:1024,layout:fromPhoto?'fullart':'classic',finish:'holo'});
  const key=`generated/${account.id}/${requestId}`;
  await env.ARTWORK.put(key,bytes,{httpMetadata:{contentType:mime}});
  await complete(env.DB,account,requestId,fromPhoto?'photo':'design',key,card);
  // Keep the historical API fields for existing clients while exposing the richer studio card.
  return {generationId:requestId,cardData:{...card,attack1:{name:card.attack,damage:card.damage},flavor:card.ability},emailStatus:'not_requested',account:publicAccount(await getAccount(env.DB,account.id))};
 }catch(error){if(reserved)await refund(env.DB,requestId);if(error.status)throw error;console.error('AI generation failed',error.name);throw problem('The AI artwork could not be completed. Your credit has been returned. Please try again later.',502);}
}
