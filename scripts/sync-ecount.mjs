// 이카운트 OAPI → 에듀이노 카탈로그 동기화 (고정 IP VPS 실행용 · 규격/옵션 포함)
//   VPS(고정 IP, 이카운트 허용) 에서 실행: /home/ubuntu/ecount-sync/sync.mjs 를 이 내용으로 교체.
//   같은 폴더 .env 에서 자격증명을 읽습니다. (git 에는 올리지 않음)
//   실행:   node sync.mjs                 → 품목+규격 카탈로그 반영
//           node sync.mjs --dry           → 업로드 생략(미리보기)
//           node sync.mjs --fields        → 규격 후보 필드 진단(업로드 안 함)
//           node sync.mjs --code=SP-I6-1  → 특정 코드 매핑 결과 확인
import { readFileSync } from 'node:fs';

try { for (const line of readFileSync(new URL('./.env', import.meta.url),'utf8').split('\n')) {
  const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if(m) process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } } catch {}

const E=process.env;
for (const k of ['ECOUNT_COM_CODE','ECOUNT_USER_ID','ECOUNT_API_CERT_KEY','CATALOG_URL','CRON_SECRET'])
  if(!E[k]){ console.error('환경변수 누락:', k); process.exit(1); }

const sbo=/^(1|true|test|y)$/i.test(E.ECOUNT_TEST||'');
const base=sbo?'sboapi':'oapi';
const zoneHost=`https://${base}.ecount.com`;
const host=z=>`https://${base}${String(z||'').toUpperCase()}.ecount.com`;

async function post(url,body){ let r;
  try{ r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}); }
  catch(e){ throw new Error('연결 실패 ['+url+'] '+(e?.message||e)); }
  const t=await r.text(); let j=null; try{j=JSON.parse(t);}catch{}
  if(!r.ok) throw new Error('HTTP '+r.status+' ['+url+'] '+t.slice(0,300)); return j??t; }

function pickArray(obj,path){ if(Array.isArray(obj)) return obj;
  if(path){ let c=obj; for(const k of path.split('.')) c=c&&c[k]; if(Array.isArray(c)) return c; }
  const d=(obj&&obj.Data)||obj||{};
  for(const c of [d.Result,d.Datas,d.datas,d.List,d.list,obj?.Result,obj?.data]) if(Array.isArray(c)) return c;
  if(d&&typeof d==='object') for(const k in d) if(Array.isArray(d[k])) return d[k];
  return []; }

// ── 규격(옵션) 필드 탐지 ── 이카운트 계정마다 필드명이 달라 폭넓게 탐색.
//    .env 에 ECOUNT_MAP_OPTION=필드명 을 넣으면 그 필드를 강제 사용(가장 확실).
const OPT_KNOWN = ['SIZE_DES','SIZE_DES1','SIZE_DES2','OPT_DES','OPTION_DES','SIZE1_DES','SIZE2_DES',
  'PROD_SIZE_DES','PROD_SIZE','ITEM_SIZE','SIZE_NAME','SPEC_DES','SPEC','OPT1_DES','OPTION_NAME','OPTION','OPT','규격','규격명'];
const optEnv=E.ECOUNT_MAP_OPTION||'';
const isOptKey=k=>/opt|size|spec|규격|옵션/i.test(k) && !/cd$|code|_no$|qty|price|단가|수량|번호|일자|date|flag|yn$|여부/i.test(k);
const findOption=x=>{
  if(optEnv) return String(x[optEnv]||'');
  for(const k of OPT_KNOWN){ const v=x[k]; if(v!=null&&String(v).trim()!=='') return String(v); }
  for(const k in x){ if(isOptKey(k)){ const v=x[k]; if(v!=null&&String(v).trim()!=='') return String(v); } }
  return '';
};

// ── 구매처명(입점사명) 필드 탐지 ── 이카운트 품목에 구매처 '코드'만 있고 코드→이름 매핑(거래처등록)이 최신이 아니면
//    프로그램에서 '입점사 미지정'으로 뜸. 그래서 구매처 '이름' 필드가 응답에 있으면 그대로 담아 매칭 의존을 없앰.
//    .env 에 ECOUNT_MAP_VENDORNAME=필드명 을 넣으면 그 필드를 강제 사용.
const VNAME_KNOWN = ['CUST_DES','CUST_NAME','CUST_NM','CUST_DES1','VEND_DES','VEND_NAME','VEND_NM',
  'BUYER_DES','BUYER_NAME','PUR_CUST_DES','PUR_CUST_NAME','WH_CUST_DES','구매처명','매입처명','공급처명','거래처명'];
const vnameEnv=E.ECOUNT_MAP_VENDORNAME||'';
const isVNameKey=k=>/(cust|vend|buyer|pur|구매처|매입처|공급처|거래처)/i.test(k)
  && /(des|nm|name|명)/i.test(k)
  && !/cd$|code|_no$|번호|qty|price|단가|수량|일자|date|amt|금액/i.test(k);
const findVendorName=x=>{
  if(vnameEnv) return String(x[vnameEnv]||'').trim();
  for(const k of VNAME_KNOWN){ const v=x[k]; if(v!=null&&String(v).trim()!=='') return String(v).trim(); }
  for(const k in x){ if(isVNameKey(k)){ const v=x[k]; if(v!=null&&String(v).trim()!=='') return String(v).trim(); } }
  return '';
};

const com=E.ECOUNT_COM_CODE,user=E.ECOUNT_USER_ID,cert=E.ECOUNT_API_CERT_KEY;
let zone=E.ECOUNT_ZONE;
if(!zone){ const zr=await post(`${zoneHost}/OAPI/V2/Zone`,{COM_CODE:com}); zone=zr?.Data?.ZONE||zr?.ZONE; }
if(!zone) throw new Error('ZONE 조회 실패');
console.log('ZONE:',zone,'· 서버:',base);

const lr=await post(`${host(zone)}/OAPI/V2/OAPILogin`,{COM_CODE:com,USER_ID:user,API_CERT_KEY:cert,LAN_TYPE:E.ECOUNT_LAN||'ko-KR',ZONE:zone});
const sid=lr?.Data?.Datas?.SESSION_ID||lr?.Data?.SESSION_ID||lr?.SESSION_ID;
if(!sid) throw new Error('로그인 실패: '+JSON.stringify(lr).slice(0,400));
console.log('로그인 성공');

const path=E.ECOUNT_PRODUCT_PATH||'/OAPI/V2/InventoryBasic/GetBasicProductsList';
let params={}; if(E.ECOUNT_PRODUCT_BODY){try{params=JSON.parse(E.ECOUNT_PRODUCT_BODY);}catch{}}
const pr=await post(`${host(zone)}${path}?SESSION_ID=${encodeURIComponent(sid)}`,params);
const arr=pickArray(pr,E.ECOUNT_ARRAY_PATH);
console.log('받은 품목 수:',arr.length);

// ── 규격 후보 필드 진단 ──
if(process.argv.includes('--fields')){
  const keys=[...new Set(arr.flatMap(x=>Object.keys(x||{})))].sort();
  console.log('\n[규격 후보 필드 = 값 샘플]');
  const cands=keys.filter(isOptKey);
  if(!cands.length) console.log('  (후보 없음 — 이 품목 API 응답에 규격 필드가 없습니다. 아래 전체 필드명을 확인하세요.)');
  for(const k of cands){ const vals=arr.map(x=>x[k]).filter(v=>v!=null&&String(v).trim()!=='').slice(0,5); console.log('  -',k,'=',vals.join(' / ')||'(전부 빈값)'); }
  console.log('\n[구매처명(입점사명) 후보 필드 = 값 샘플]');
  const vcands=keys.filter(isVNameKey);
  if(!vcands.length) console.log('  (후보 없음 — 이 품목 API 응답에 구매처 이름 필드가 없습니다. 거래처등록 매핑을 최신화하거나 ECOUNT_MAP_VENDORNAME 지정 필요)');
  for(const k of vcands){ const vals=arr.map(x=>x[k]).filter(v=>v!=null&&String(v).trim()!=='').slice(0,5); console.log('  -',k,'=',vals.join(' / ')||'(전부 빈값)'); }
  console.log('\n[전체 필드명]\n ',keys.join(', '));
  console.log('\n※ 위에서 베이직/로열 같은 규격값이 든 필드를 .env 의 ECOUNT_MAP_OPTION 에 지정하면 확실합니다.');
  process.exit(0);
}

const M=(k,d)=>E['ECOUNT_MAP_'+k]||d;
const VCODE=M('VENDORCODE','CUST'), CCODE=M('CLASSCODE','CLASS_CD');
const products=arr.map(x=>({
  selfCode:x[M('CODE','PROD_CD')], code:'', name:x[M('NAME','PROD_DES')],
  option:findOption(x),              // ★ 규격(옵션) — 발주/조회 옵션 선택 화면에 표시됨
  vendor:findVendorName(x),          // ★ 구매처명(입점사명) — 코드→이름 매핑 누락 시 '입점사 미지정' 방지
  category:'',
  custCode:String(x[VCODE]||''), classCode:String(x[CCODE]||''),
  inPrice:Number(x[M('INPRICE','IN_PRICE')])||0, outPrice:Number(x[M('OUTPRICE','OUT_PRICE')])||0,
  settle:'', ship:0,
})).filter(p=>p.selfCode);

const withOpt=products.filter(p=>p.option&&p.option.trim()!=='').length;
const withVen=products.filter(p=>p.vendor&&p.vendor.trim()!=='').length;
console.log('업로드 대상:', products.length, '· 규격 채워진 품목:', withOpt, '· 구매처명 채워진 품목:', withVen);
if(withVen===0) console.log('※ 구매처명이 0건입니다 — 품목 API에 구매처 이름 필드가 없을 수 있습니다. `--fields`로 확인 후 ECOUNT_MAP_VENDORNAME 지정을 권장합니다(그동안은 거래처 등록표/이카운트 매핑으로 이름 표시).');

const target=(process.argv.find(a=>a.startsWith('--code='))||'--code=SP-I6-1').split('=')[1];
const hit=products.find(p=>String(p.selfCode).toUpperCase()===target.toUpperCase());
console.log(`[${target}] →`, hit?JSON.stringify(hit):'(해당 코드 없음)');

if(process.argv.includes('--dry')){ console.log('[dry-run] 업로드 생략'); process.exit(0); }

const up=await post(E.CATALOG_URL,{op:'bulkUpsert',secret:E.CRON_SECRET,products});
console.log('업로드 결과:', JSON.stringify(up));
