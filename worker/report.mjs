import plans from '../lib/pricing.json' with { type: 'json' };
import { validEmail } from './storage.mjs';
import { today } from './metrics.mjs';
// Monday 13:00 UTC: 9:00 in New York (EDT), 21:00 in Beijing. Must match a trigger in wrangler.jsonc.
export const WEEKLY_CRON='0 13 * * 1';
// Planning cost per successful image from docs/PRICING.md. Actual Workers AI cost is usually lower.
const AI_COST_CENTS=8;
const DAY=86400000;
const money=cents=>`${cents<0?'-':''}$${(Math.abs(cents)/100).toFixed(2)}`;
const percent=(part,whole)=>whole?`${(part/whole*100).toFixed(1)}%`:'—';
const esc=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const short=day=>day.slice(5).replace('-','/');

async function week(db,start,end){
 const [metrics,generations,purchases,started]=await Promise.all([
  db.prepare('SELECT name,SUM(count) AS total FROM daily_metrics WHERE day>=? AND day<? GROUP BY name').bind(start,end).all(),
  db.prepare('SELECT charge_source,status,COUNT(*) AS n FROM generation_attempts WHERE created_at>=? AND created_at<? GROUP BY charge_source,status').bind(start,end).all(),
  db.prepare("SELECT plan,COUNT(*) AS n FROM checkout_sessions WHERE status='completed' AND completed_at>=? AND completed_at<? GROUP BY plan").bind(start,end).all(),
  db.prepare('SELECT COUNT(*) AS n FROM checkout_sessions WHERE created_at>=? AND created_at<?').bind(start,end).first()
 ]);
 const m=Object.fromEntries(metrics.results.map(r=>[r.name,Number(r.total)]));
 const generated=(source,status)=>generations.results.filter(r=>(!source||r.charge_source===source)&&r.status===status).reduce((n,r)=>n+Number(r.n),0);
 let orders=0,gross=0,fees=0;const byPlan={};
 for(const row of purchases.results){
  const plan=plans[row.plan],n=Number(row.n);if(!plan)continue;
  orders+=n;gross+=n*plan.price;fees+=n*Math.round(plan.price*0.029+30);byPlan[plan.label]=(byPlan[plan.label]||0)+n;
 }
 const trial=generated('promo','completed'),paid=generated('paid','completed'),aiCost=(trial+paid)*AI_COST_CENTS;
 return {m,trial,paid,failed:generated(null,'refunded'),orders,byPlan,checkouts:Number(started?.n)||0,gross,fees,aiCost,net:gross-fees-aiCost,visitors:m.visitors||0};
}

export async function weeklyReport(db,now=new Date()){
 const end=today(now),start=today(new Date(now.getTime()-7*DAY)),previousStart=today(new Date(now.getTime()-14*DAY));
 const [current,previous,credits]=await Promise.all([week(db,start,end),week(db,previousStart,start),db.prepare('SELECT COALESCE(SUM(delta),0) AS n FROM credit_ledger').first()]);
 const metric=name=>[current.m[name]||0,previous.m[name]||0];
 const pick=key=>[current[key],previous[key]];
 const sourceNames={search:'搜索',direct:'直接访问',social:'社交',ai:'AI 助手',other:'其他'};
 const landings=Object.entries(current.m).filter(([name])=>name.startsWith('landing:')).sort((a,b)=>b[1]-a[1]).slice(0,5);
 const sections=[
  ['流量',[
   ['访客（按天去重）',...pick('visitors')],['页面浏览',...metric('pageviews')],
   ...Object.entries(sourceNames).map(([key,label])=>[`来源 · ${label}`,...metric(`source:${key}`)]),
   ...landings.map(([name])=>[`入口页 ${name.slice(8)}`,...metric(name)])
  ]],
  ['创作漏斗（每次页面加载最多计一次）',[
   ['开始一句话创作',...metric('ui:idea_start')],['改编案例',...metric('ui:example_remix')],['筛选灵感',...metric('ui:ideas_filter')],['改了卡片',...metric('ui:edit')],['加了照片',...metric('ui:photo')],['存进收藏',...metric('ui:save')],['下载 PNG',...metric('ui:png')],['下载互动卡',...metric('ui:keepsake')],['打印',...metric('ui:print')],['打开积分/购买窗口',...metric('ui:credits_open')],['惊喜卡',...metric('ui:surprise')],['对战',...metric('ui:duel')]
  ]],
  ['AI',[
   ['免费试用生成',...pick('trial')],['付费生成',...pick('paid')],['失败并已退还',...pick('failed')],['试用额度用满（被拒次数）',...metric('ai_trial_cap_hit')],['付费额度用满（被拒次数）',...metric('ai_paid_cap_hit')],['拦截的品牌名',...metric('franchise_name_blocked')]
  ]],
  ['收入',[
   ['发起结账',...pick('checkouts')],['成交订单',...pick('orders')],['付费转化率（订单/访客）',percent(current.orders,current.visitors),percent(previous.orders,previous.visitors)],
   ['收入',money(current.gross),money(previous.gross)],['Stripe 手续费（估算）',money(current.fees),money(previous.fees)],['AI 成本（估算）',money(current.aiCost),money(previous.aiCost)],['估算净额',money(current.net),money(previous.net)]
  ]]
 ];
 const plansSold=Object.entries(current.byPlan).map(([label,n])=>`${label} ×${n}`).join('，')||'无';
 const range=`${short(start)}–${short(today(new Date(now.getTime()-DAY)))}`;
 const notes=[`本周成交：${plansSold}`,`尚未使用的付费积分（全部账户）：${Number(credits?.n)||0}`,'访客为按天去重后相加，不使用 cookie，同一人隔天再来会再计一次。','Stripe 手续费按美国卡 2.9% + $0.30 估算；AI 成本按每张 $0.08 的规划成本估算，实际通常更低；未扣除税费和托管费。'];
 const subject=`DIY Poké Card 周报 ${range}：访客 ${current.visitors}，订单 ${current.orders}，收入 ${money(current.gross)}`;
 const text=[`${subject}\n（括号内为上周）`,...sections.map(([title,rows])=>`\n${title}\n${rows.map(([label,now,before])=>`  ${label}：${now}（${before}）`).join('\n')}`),'',...notes].join('\n');
 const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#24283c"><h1 style="font-size:20px">DIY Poké Card 周报 ${esc(range)}</h1>${sections.map(([title,rows])=>`<h2 style="font-size:15px;margin-top:22px">${esc(title)}</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="color:#6e7287"><td></td><td style="text-align:right">本周</td><td style="text-align:right">上周</td></tr>${rows.map(([label,now,before])=>`<tr style="border-top:1px solid #e6e7ef"><td style="padding:6px 0">${esc(label)}</td><td style="text-align:right"><strong>${esc(now)}</strong></td><td style="text-align:right;color:#6e7287">${esc(before)}</td></tr>`).join('')}</table>`).join('')}${notes.map(note=>`<p style="font-size:12px;color:#6e7287;line-height:1.6">${esc(note)}</p>`).join('')}</div>`;
 return {subject,text,html};
}

export async function sendWeeklyReport(env,now=new Date()){
 if(!env.DB||env.EMAIL_ENABLED!=='true'||!env.EMAIL||!validEmail(env.REPORT_EMAIL||'')){console.info('Weekly report skipped: set REPORT_EMAIL and enable email.');return false;}
 const report=await weeklyReport(env.DB,now);
 await env.EMAIL.send({from:env.EMAIL_FROM||'studio@diypokecard.com',to:env.REPORT_EMAIL,subject:report.subject,text:report.text,html:report.html});
 return true;
}
