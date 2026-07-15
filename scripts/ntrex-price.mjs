// NTREX (DeviceMart) price watcher — run on fixed-IP VPS
//   Daily: fetch each product's current DeviceMart price, compare to the base price
//   (from the supply table), and push changes to the app KV (coll 'ntrex').
//   Console output is ASCII-only (avoids broken Korean fonts on some terminals).
//
//   Files in same folder: ntrex-list.json (codes+base price), .env
//   .env example:
//     STORE_URL=https://work-manager-liart.vercel.app/api/store
//     NTREX_PRICE_REGEX=            (optional; set after --debug confirms selector)
//     NTREX_DELAY_MS=400
//
//   Usage:
//     node ntrex-price.mjs --debug --code=1358481   # inspect price candidates + HTML context
//     node ntrex-price.mjs --dry                     # compare only, no upload
//     node ntrex-price.mjs                           # compare + upload changes
//     node ntrex-price.mjs --limit=30                # first 30 only (test)
import { readFileSync } from 'node:fs';

const E = process.env;
try { for (const line of readFileSync(new URL('./.env', import.meta.url),'utf8').split('\n')) {
  const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if(m) E[m[1]]=m[2].replace(/^["']|["']$/g,''); } } catch {}

const arg = k => { const a=process.argv.find(x=>x.startsWith('--'+k)); return a?(a.includes('=')?a.split('=')[1]:true):false; };
const DEBUG=arg('debug'), DRY=arg('dry'), LIMIT=Number(arg('limit'))||0, ONE=arg('code');
const DELAY=Number(E.NTREX_DELAY_MS)||400;
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36';
const siteUrl = no => `https://www.devicemart.co.kr/goods/view?no=${encodeURIComponent(no)}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const won = n => Number(n||0).toLocaleString('en-US');
const ascii = s => String(s||'').replace(/[^\x20-\x7E]/g,'.').replace(/\s+/g,' ').trim();  // strip non-ASCII (no broken glyphs)

async function getHtml(url){
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9'}});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return await r.text();
}
function num(s){ const n=parseInt(String(s).replace(/[^\d]/g,''),10); return isNaN(n)?0:n; }
function priceCandidates(html){
  const out=[]; let m;
  const push=(tag,v)=>{ const n=num(v); if(n>=100&&n<100000000) out.push({tag,val:n,raw:String(v)}); };
  // ★ 디바이스마트 판매가 요소: <strong class="sell_price ...">462,000원</strong> (508,200원)
  //   괄호 안 = VAT 포함(우리 공급가표 기준과 동일) → 이 값을 최우선으로 사용
  const reSV=/sell_price[\s\S]{0,400}?\(\s*([\d]{1,3}(?:,[\d]{3})+)/g; while((m=reSV.exec(html))) push('sellvat',m[1]);
  const reS=/class="[^"]*sell_price[^"]*"[^>]*>[\s\S]{0,60}?([\d]{1,3}(?:,[\d]{3})+)/g; while((m=reS.exec(html))) push('sell',m[1]);
  const reT=/총\s*상품금액[\s\S]{0,120}?VAT\s*포함[\s\S]{0,40}?([\d]{1,3}(?:,[\d]{3})+)/g; while((m=reT.exec(html))) push('total',m[1]);
  const reV=/VAT\s*포함[^0-9]{0,20}?([\d]{1,3}(?:,[\d]{3})+)/g; while((m=reV.exec(html))) push('vatincl',m[1]);
  const re1=/"(?:price|lowPrice|highPrice|salePrice|sellPrice)"\s*:\s*"?([\d,]+)"?/gi; while((m=re1.exec(html))) push('jsonld',m[1]);
  const re2=/(?:product:price:amount|og:price:amount)"?\s*content="?([\d,]+)/gi; while((m=re2.exec(html))) push('meta',m[1]);
  const re3=/(판매가|정상가|정가|할인가|가격|판매)[^0-9]{0,40}?([\d]{1,3}(?:,[\d]{3})+)\s*원?/g; while((m=re3.exec(html))) push('label',m[2]);
  const re4=/([\d]{1,3}(?:,[\d]{3}){1,3})\s*원/g; while((m=re4.exec(html))) push('won',m[1]);
  return out;
}
function extractPrice(html){
  if(E.NTREX_PRICE_REGEX){ try{ const m=html.match(new RegExp(E.NTREX_PRICE_REGEX)); if(m){ const n=num(m[1]||m[0]); if(n) return n; } }catch{} }
  const c=priceCandidates(html);
  const by=t=>c.find(x=>x.tag===t);
  // 판매가 요소만 신뢰: VAT 포함(sellvat/total/vatincl) 우선 → 판매가 요소(sell) → 구조화/라벨
  // 못 찾으면 0 반환 → 비교 건너뜀(엉뚱한 최댓값으로 오탐하지 않음)
  const pick = by('sellvat') || by('total') || by('vatincl') || by('sell') || by('jsonld') || by('meta') || by('label');
  return pick?pick.val:0;
}
function htmlContext(html, raw){ const i=html.indexOf(raw); if(i<0) return ''; return ascii(html.slice(Math.max(0,i-140), i+20)); }
function title(html){ const m=html.match(/<title[^>]*>([^<]+)</i); return ascii(m?m[1]:''); }

// 상품 리스트: ① 같은 폴더 ntrex-list.json ② 없으면 .env NTREX_LIST_URL(앱의 ntrex-data.js)에서 받아옴
async function loadList(){
  try{ return JSON.parse(readFileSync(new URL('./ntrex-list.json', import.meta.url),'utf8')); }catch{}
  if(E.NTREX_LIST_URL){
    const js=await getHtml(E.NTREX_LIST_URL);
    const m=js.match(/NTREX_PRODUCTS\s*=\s*(\[[\s\S]*?\])\s*;/);
    if(m){ const arr=JSON.parse(m[1]); return arr.map(a=>({ ntx:String(a[1]), ed:a[0], name:a[2], basePrice:Number(a[3])||0 })).filter(p=>p.ntx); }
    throw new Error('NTREX_PRODUCTS not found at NTREX_LIST_URL');
  }
  throw new Error('no product list — put ntrex-list.json in this folder OR set NTREX_LIST_URL in .env (…/assets/js/ntrex-data.js)');
}
let items;
if(ONE){ items=[{ ntx:String(ONE), ed:'', name:'', basePrice:0 }]; }
else{
  try{ items=(await loadList()).filter(p=>p.ntx); }
  catch(e){ console.error(e.message); process.exit(1); }
  if(LIMIT) items=items.slice(0,LIMIT);
}

if(DEBUG){
  console.log('== price candidate diagnostics ==');
  for(const p of items.slice(0,ONE?1:3)){
    try{ const html=await getHtml(siteUrl(p.ntx));
      console.log(`\n[${p.ntx}] title: ${title(html)}`);
      console.log(`  URL: ${siteUrl(p.ntx)}  ·  html length: ${html.length}`);
      console.log(`  base price (supply table): ${won(p.basePrice)}`);
      const cs=priceCandidates(html);
      // de-dup by (tag,val)
      const seen=new Set(), uniq=[];
      for(const c of cs){ const k=c.tag+':'+c.val; if(!seen.has(k)){ seen.add(k); uniq.push(c); } }
      console.log(`  candidates (${uniq.length}):`);
      uniq.slice(0,14).forEach(c=>console.log(`   - [${c.tag}] ${won(c.val)}   context: ${htmlContext(html,c.raw)}`));
      console.log(`  => picked: ${won(extractPrice(html))}`);
    }catch(e){ console.log(`[${p.ntx}] FAILED: ${e.message}`); }
    await sleep(DELAY);
  }
  console.log('\nNote: tell me which candidate is the real sale price (with its [tag] + context).');
  console.log('If none matches, the price is JS-rendered -> switch to a headless-browser fetch.');
  process.exit(0);
}

const day = new Date().toISOString().slice(0,10);
const diffs=[]; let checked=0, failed=0;
for(const p of items){
  try{ const html=await getHtml(siteUrl(p.ntx)); const cur=extractPrice(html); checked++;
    if(cur>0 && p.basePrice>0 && cur!==p.basePrice){
      diffs.push({ ntx:p.ntx, ed:p.ed, name:p.name, oldPrice:p.basePrice, newPrice:cur });
      console.log(`CHANGED ${p.ed}/${p.ntx}: ${won(p.basePrice)} -> ${won(cur)}`);
    }
  }catch(e){ failed++; }
  await sleep(DELAY);
}
console.log(`\nchecked ${checked} · failed ${failed} · changed ${diffs.length}`);

if(DRY){ console.log('[dry-run] skip upload'); process.exit(0); }
if(!E.STORE_URL){ console.log('STORE_URL not set -> skip upload (add STORE_URL to .env)'); process.exit(0); }
const doc={ id:`ntrex:${day}`, coll:'ntrex', day, checkedAt:new Date().toISOString(), count:diffs.length, items:diffs };
const r=await fetch(E.STORE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'ntrex',item:doc})});
console.log('upload:', r.status, ascii(await r.text()).slice(0,200));
