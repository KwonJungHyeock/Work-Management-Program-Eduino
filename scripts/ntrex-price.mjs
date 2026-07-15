// 엔티렉스(디바이스마트) 판매가 비교 크롤러 — 고정 IP VPS 실행용
//   매일 1회 각 상품의 디바이스마트 현재 판매가를 조회 → 기준가(공급가표)와 다르면
//   변동분을 앱 KV(coll 'ntrex')로 올림 → 프로그램 [가격비교]에 자동 표시.
//
//   같은 폴더에 ntrex-list.json (엔티렉스코드·기준판매가) 과 .env 가 있어야 함.
//   .env 예:
//     STORE_URL=https://work-manager-liart.vercel.app/api/store
//     NTREX_PRICE_REGEX=            (선택 · --debug 로 확인 후 지정)
//     NTREX_DELAY_MS=400           (요청 간 간격 · 과도한 부하 방지)
//
//   실행:
//     node ntrex-price.mjs --debug --code=1358481   → 판매가 후보 확인(가장 먼저 1회)
//     node ntrex-price.mjs --dry                     → 비교만(업로드 안 함)
//     node ntrex-price.mjs                           → 비교 + 변동분 업로드
//     node ntrex-price.mjs --limit=30                → 앞 30건만(테스트)
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
const won = n => Number(n||0).toLocaleString();

async function getHtml(url){
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9'}});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return await r.text();
}

// 판매가 추출 — 디바이스마트 마크업 여러 형태에 대응(확실치 않으면 --debug 로 후보 확인 후 NTREX_PRICE_REGEX 지정)
function extractPrice(html){
  if(E.NTREX_PRICE_REGEX){ try{ const m=html.match(new RegExp(E.NTREX_PRICE_REGEX)); if(m){ const n=num(m[1]||m[0]); if(n) return n; } }catch{} }
  const cands=priceCandidates(html);
  // 우선순위: JSON-LD/메타 price > '판매가' 근처 > 최빈 원단위
  for(const c of cands){ if(c.tag==='jsonld'||c.tag==='meta') return c.val; }
  const near=cands.find(c=>c.tag==='label'); if(near) return near.val;
  return cands[0]?cands[0].val:0;
}
function num(s){ const n=parseInt(String(s).replace(/[^\d]/g,''),10); return isNaN(n)?0:n; }
function priceCandidates(html){
  const out=[];
  // 1) JSON-LD / og / meta price
  let m;
  const push=(tag,v)=>{ const n=num(v); if(n>=100&&n<100000000) out.push({tag,val:n,raw:String(v)}); };
  const re1=/"(?:price|lowPrice|highPrice)"\s*:\s*"?([\d,]+)"?/gi; while((m=re1.exec(html))) push('jsonld',m[1]);
  const re2=/(?:product:price:amount|og:price:amount)"?\s*content="?([\d,]+)/gi; while((m=re2.exec(html))) push('meta',m[1]);
  // 2) '판매가'/'정가' 라벨 근처 원단위 숫자
  const re3=/(판매가|정상가|정가|할인가|가격)[^0-9]{0,40}?([\d]{1,3}(?:,[\d]{3})+)\s*원?/g; while((m=re3.exec(html))) push('label',m[2]);
  // 3) 그 외 원단위 숫자(참고)
  const re4=/([\d]{1,3}(?:,[\d]{3}){1,3})\s*원/g; while((m=re4.exec(html))) push('won',m[1]);
  return out;
}
function title(html){ const m=html.match(/<title[^>]*>([^<]+)</i); return m?m[1].trim():''; }

// --code 로 특정 코드만 볼 땐 리스트 파일이 없어도 바로 크롤(진단용). 그 외엔 ntrex-list.json 필요.
let items;
if(ONE){
  items=[{ ntx:String(ONE), ed:'', name:'', basePrice:0 }];
}else{
  let list;
  try{ list=JSON.parse(readFileSync(new URL('./ntrex-list.json', import.meta.url),'utf8')); }
  catch(e){ console.error('ntrex-list.json 을 찾을 수 없습니다. 같은 폴더에 두세요. (특정 코드 확인은 --code=번호 로 파일 없이 가능)'); process.exit(1); }
  items=list.filter(p=>p.ntx);
  if(LIMIT) items=items.slice(0,LIMIT);
}

if(DEBUG){
  console.log('== 판매가 후보 진단 ==');
  for(const p of items.slice(0,ONE?1:3)){
    try{ const html=await getHtml(siteUrl(p.ntx));
      console.log(`\n[${p.ntx}] ${title(html)}\n  URL: ${siteUrl(p.ntx)}\n  기준판매가(공급가표): ${won(p.basePrice)}원`);
      const cs=priceCandidates(html).slice(0,12);
      cs.forEach(c=>console.log(`   - (${c.tag}) ${won(c.val)}원  [${c.raw}]`));
      console.log('  → 채택값:', won(extractPrice(html))+'원');
    }catch(e){ console.log(`[${p.ntx}] 실패: ${e.message}`); }
    await sleep(DELAY);
  }
  console.log('\n※ 위 후보 중 "판매가"에 해당하는 tag/값이 무엇인지 알려주시면 파서를 고정하거나 NTREX_PRICE_REGEX 를 지정합니다.');
  process.exit(0);
}

// 전체 비교
const day = new Date().toISOString().slice(0,10);
const diffs=[]; let checked=0, failed=0;
for(const p of items){
  try{ const html=await getHtml(siteUrl(p.ntx)); const cur=extractPrice(html); checked++;
    if(cur>0 && p.basePrice>0 && cur!==p.basePrice){
      diffs.push({ ntx:p.ntx, ed:p.ed, name:p.name, oldPrice:p.basePrice, newPrice:cur });
      console.log(`변동 ${p.ed}/${p.ntx}: ${won(p.basePrice)} → ${won(cur)}`);
    }
  }catch(e){ failed++; }
  await sleep(DELAY);
}
console.log(`\n확인 ${checked} · 실패 ${failed} · 변동 ${diffs.length}건`);

if(DRY){ console.log('[dry-run] 업로드 생략'); process.exit(0); }
if(!E.STORE_URL){ console.log('STORE_URL 미설정 — 업로드 생략(.env 에 STORE_URL 지정)'); process.exit(0); }
const doc={ id:`ntrex:${day}`, coll:'ntrex', day, checkedAt:new Date().toISOString(), count:diffs.length, items:diffs };
const r=await fetch(E.STORE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'ntrex',item:doc})});
console.log('업로드:', r.status, (await r.text()).slice(0,200));
