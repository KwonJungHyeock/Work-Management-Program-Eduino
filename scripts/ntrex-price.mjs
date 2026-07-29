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
const DELAY=Number(E.NTREX_DELAY_MS)||5000;   // 기본 5초 · 실제 간격은 아래 gap()으로 무작위화
const MAXFAIL=Math.max(3, Number(E.NTREX_MAX_FAIL)||10);   // 연속 실패 이 횟수 도달 시 즉시 중단(IP 보호)
// ── 안전 랜덤화(사람처럼 · 봇 탐지·차단 회피) ──
//  간격을 DELAY의 0.9~1.8배로 무작위 → 불규칙하고 분당 최대도 15회 밑 유지(DELAY=5000이면 4.5~9초=6.7~13회/분)
const gap=()=>Math.floor(DELAY*0.9 + Math.random()*DELAY*0.9);
// 요청마다 UA 무작위 선택(실브라우저 여러 개)
const UAS=[
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];
const pickUA=()=>UAS[Math.floor(Math.random()*UAS.length)];
const UA=UAS[0];   // 진단(debug)용 기본
const siteUrl = no => `https://www.devicemart.co.kr/goods/view?no=${encodeURIComponent(no)}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// 프록시 경유(선택) — devicemart 가 IP를 차단할 때 한국 프록시로 우회.
//   .env:  NTREX_PROXY=http://아이디:비번@프록시호스트:포트   (또는 http://프록시호스트:포트)
//   ※ VPS 에서 1회 `npm i undici` 필요(프록시 사용 시에만).
let DISPATCHER=null;
if(E.NTREX_PROXY){
  try{ const { ProxyAgent }=await import('undici'); DISPATCHER=new ProxyAgent(E.NTREX_PROXY);
    console.log('proxy: on ('+E.NTREX_PROXY.replace(/\/\/[^@]*@/,'//***@')+')'); }
  catch(e){ console.error('NTREX_PROXY 설정됨 · undici 로드 실패 → VPS ecount-sync 폴더에서 `npm i undici` 후 재시도:', e.message); process.exit(1); }
}
const won = n => Number(n||0).toLocaleString('en-US');
const ascii = s => String(s||'').replace(/[^\x20-\x7E]/g,'.').replace(/\s+/g,' ').trim();  // strip non-ASCII (no broken glyphs)

async function getHtml(url, ua){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(), Number(E.NTREX_TIMEOUT_MS)||15000);
  try{ const r=await fetch(url,{headers:{
      'User-Agent':ua||UA,
      'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language':'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer':'https://www.devicemart.co.kr/',
      'Upgrade-Insecure-Requests':'1',
    },signal:ctl.signal,dispatcher:DISPATCHER||undefined});
    if(!r.ok) throw new Error('HTTP '+r.status); return await r.text();
  } finally{ clearTimeout(t); }
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

// 분할(선택) — 전체 목록을 여러 날에 '순환' 조회(하루 부하↓·차단 위험↓).
//   NTREX_CYCLE_DAYS=3  → 3일에 걸쳐 전 상품 확인(각 상품 3일마다 1회). 권장.
//   NTREX_DAILY_MAX=200 → 하루 최대 개수로 지정(주기는 자동 계산). CYCLE_DAYS 가 우선.
const CYCLE=Number(E.NTREX_CYCLE_DAYS)||0;
const DAILY=Number(E.NTREX_DAILY_MAX)||0;
let CHUNK='';
if(!ONE && (CYCLE>1 || (DAILY>0 && items.length>DAILY))){
  const K=CYCLE>1 ? CYCLE : Math.ceil(items.length/DAILY);  // 며칠 주기로 도는지
  const size=Math.ceil(items.length/K);                     // 하루치(균등 분배)
  const idx=Math.floor(Date.now()/86400000)%K;              // 날짜 기준 순환 인덱스
  items=items.slice(idx*size,(idx+1)*size);
  CHUNK=`${idx+1}/${K}`;
  console.log(`daily chunk ${CHUNK} · ${items.length} items (전체 순환 ${K}일 주기)`);
}

if(DEBUG){
  console.log('== price candidate diagnostics ==');
  for(const p of items.slice(0,ONE?1:3)){
    try{ const html=await getHtml(siteUrl(p.ntx), pickUA());
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
    await sleep(gap());
  }
  console.log('\nNote: tell me which candidate is the real sale price (with its [tag] + context).');
  console.log('If none matches, the price is JS-rendered -> switch to a headless-browser fetch.');
  process.exit(0);
}

// 요청 순서 무작위(셔플) — 매일 같은 순서/패턴을 피해 봇 탐지↓ (분할 커버리지는 그대로 유지)
for(let i=items.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [items[i],items[j]]=[items[j],items[i]]; }

const day = new Date().toISOString().slice(0,10);
const diffs=[]; let checked=0, failed=0, noprice=0, consecFail=0;
let restIn=18+Math.floor(Math.random()*22);   // 18~39건마다 사람처럼 긴 휴식
for(const p of items){
  try{ const html=await getHtml(siteUrl(p.ntx), pickUA()); const cur=extractPrice(html); checked++; consecFail=0;
    if(checked%50===0) console.log(`... ${checked}/${items.length} (changed ${diffs.length})`);   // 진행 표시
    if(!cur){ noprice++; }
    else if(p.basePrice>0 && cur!==p.basePrice){
      diffs.push({ ntx:p.ntx, ed:p.ed, name:p.name, oldPrice:p.basePrice, newPrice:cur });
      console.log(`CHANGED ${p.ed}/${p.ntx}: ${won(p.basePrice)} -> ${won(cur)}`);
    }
  }catch(e){ failed++; consecFail++;
    if(consecFail>=MAXFAIL){ console.log(`\n연속 ${consecFail}건 실패 — 사이트 차단/장애로 보고 조기 종료(수집분 업로드). ※ IP 보호를 위해 즉시 중단합니다.`); break; }
  }
  await sleep(gap());
  // 가끔(18~39건마다) 20~50초 긴 휴식 — 연속 트래픽 티 줄임
  if(--restIn<=0){ const rest=20000+Math.floor(Math.random()*30000); console.log(`... 휴식 ${Math.round(rest/1000)}초`); await sleep(rest); restIn=18+Math.floor(Math.random()*22); }
}
console.log(`\nchecked ${checked} failed ${failed} noprice ${noprice} changed ${diffs.length}`);

if(DRY){ console.log('[dry-run] skip upload'); process.exit(0); }
if(!E.STORE_URL){ console.log('STORE_URL not set -> skip upload (add STORE_URL to .env)'); process.exit(0); }
const doc={ id:`ntrex:${day}`, coll:'ntrex', day, checkedAt:new Date().toISOString(),
  count:diffs.length, checked, failed, noprice, total:items.length, chunk:CHUNK||undefined, items:diffs };   // 일일 리포트용 통계(분할 시 chunk 표기)
const r=await fetch(E.STORE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'ntrex',item:doc})});
console.log('upload:', r.status, ascii(await r.text()).slice(0,200));
