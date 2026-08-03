/* ===========================================================================
   MD · 입점사 발주 자동화
   - 상품코드만 입력하면 입점사명·정산구분·품명(구글시트용)과
     배송비(이카운트용)가 자동으로 채워집니다.
   - 마스터(상품코드→입점사·정산구분·품명, 입점사→배송비)는 로컬 저장 + 임포트.
   =========================================================================== */
(function(){
  const prodDB=()=>store(STORE.mdProducts);
  const venDB =()=>store(STORE.mdVendors);
  const ordDB =()=>store('eduino.md.orders');
  const cfgDB =()=>store(STORE.mdOrderCfg);
  const getProducts=()=>prodDB().get(DEFAULT_MD_PRODUCTS.map(p=>({...p})));
  // 입점사 정규화(괄호주석·(주)·공백 제거) — 병합 키
  const venNorm=s=>String(s||'').replace(/[(（[][^)）\]]*[)）\]]/g,'').replace(/㈜|주식회사|유한회사|재단법인/g,'').replace(/\s/g,'').toLowerCase();
  // 저장/동기화된 입점사 데이터가 불완전해도 번들 기본값(전체 배송정보)이 빈틈을 채우도록 "병합"
  // (저장값이 우선 · 번들에만 있는 입점사는 추가) → 어느 직원 기기에서든 정산구분·배송비가 동일하게 잡힘
  const getVendors =()=>{
    const base=DEFAULT_MD_VENDORS.map(v=>({...v}));
    const stored=venDB().get(null);
    if(!Array.isArray(stored)||!stored.length) return base;
    const map={}; base.forEach(v=>{ const k=venNorm(v.name); if(k) map[k]=v; });
    stored.forEach(v=>{ const k=venNorm(v.name); if(!k){ return; } map[k]={ ...(map[k]||{}), ...v }; });
    return Object.values(map);
  };
  const getOrders  =()=>ordDB().get([]);
  const getCfg     =()=>cfgDB().get({sheetUrl:'', autoSend:true});
  // 발주 입력 순서 보존용 시퀀스(입력한 순서대로 발주 기록 정렬 · 시각 기반이라 담당자 간에도 시간순 유지)
  let __ordSeq = Date.now();
  const nextOrd = ()=> (__ordSeq += 1);
  const vat=g=>{ const gross=Number(g)||0; const tax=Math.round(gross/11); return {gross,tax,supply:gross-tax}; };

  /* 발주 → 구글시트 행 매핑 (미리보기 표/CSV용 · 포지셔널) */
  function ordSheetRows(list){
    return list.map(o=>ORDER_SHEET_COLS.map(c=>({
      '일자':o.date,'구분':o.gubun,'주문경로':o.route,'주문자명':o.orderer,'입점사명':o.vendor,
      '정산구분':o.settle,'자체상품코드':o.selfCode||o.code,'품명':o.name,'수량':o.qty,
      '출고송장/입고':o.invoice||'',   // 발주 등록 시 비움 — 출고 후 담당자가 발주 기록에서 송장번호 수기 입력
      '발주':'O','배송정보/비고':o.shipInfo })[c] ?? ''));
  }
  /* 발주 → 구글시트 전송 레코드 (CS와 동일한 records+id upsert 방식 · 중복 없이 갱신) */
  function ordSheetRecord(o){ return {
    id:o.id, '일자':o.date||o.day||'', '구분':o.gubun||'', '주문경로':o.route||'', '주문자명':o.orderer||'', '입점사명':o.vendor||'',
    '정산구분':o.settle||'', '자체상품코드':o.selfCode||o.code||'', '품명':o.name||'', '수량':(o.qty!=null?o.qty:''),
    '출고송장/입고':o.invoice||'', '발주':'O', '배송정보/비고':o.shipInfo||'' }; }   // 출고송장/입고 = 송장번호(발주 기록에서 수기 입력)
  /* 저장 실패로 미전송된 발주 자동 재시도 (주기적 + 재접속) — 내부는 멱등 재반영, 외부는 구글시트 */
  async function ordRetry(){
    try{
      const cfg=cfgDB().get({sheetUrl:''}); const orders=ordDB().get([]);
      const pending=orders.filter(o=>!o.synced); if(!pending.length) return;
      if(window.Records) pending.forEach(o=>Records.pushMD(o));               // 내부 발주 기록 재반영
      if(!cfg.sheetUrl || cfg.backup===false) return;                          // 외부 백업 미설정/미사용
      const opts={method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({sheet:'입점사발주', records:pending.map(ordSheetRecord)})};
      try{ const res=await fetch(cfg.sheetUrl,opts); if(res.ok){ pending.forEach(o=>o.synced=true); ordDB().set(orders); } }
      catch(err){ if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){ await fetch(cfg.sheetUrl,{...opts,mode:'no-cors'}); pending.forEach(o=>o.synced=true); ordDB().set(orders); } }
    }catch(e){}
  }
  setInterval(ordRetry, 90000);
  window.addEventListener('online', ordRetry);

  /* 구분자 데이터 파서 (CSV / 붙여넣기 TSV) */
  function parseTable(text){
    text=text.replace(/\r/g,''); const lines=text.split('\n').filter(l=>l.trim()!=='');
    if(!lines.length) return [];
    const tab=lines[0].includes('\t');
    return lines.map(line=>{
      if(tab) return line.split('\t');
      const out=[]; let cur='',q=false;
      for(let i=0;i<line.length;i++){ const c=line[i];
        if(q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
        else { if(c===','){out.push(cur);cur='';} else if(c==='"'){q=true;} else cur+=c; } }
      out.push(cur); return out;
    });
  }
  const csvCell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const toCSV=(cols,rows)=>'﻿'+[cols.join(','), ...rows.map(r=>r.map(csvCell).join(','))].join('\r\n');
  const toTSV=(cols,rows)=>[cols.join('\t'), ...rows.map(r=>r.join('\t'))].join('\n');

  MODULES['md.order']={
    title:'입점사 발주', icon:'truck',
    render(root){
      let tab='entry', dirtyMaster=false, dirtyVendor=false;
      // 팀원은 실무(발주 입력)만 · 이카운트 매핑·연동 설정은 관리자 전용
      const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
      // 입점사 정보(배송비·정산조건 등) 수정 권한 — 관리자 또는 대표가 '팀 설정'에서 부여(md.vendors)
      const _u=(Auth.user&&Auth.user())||{};
      const hasCap=k=> (Array.isArray(_u.perms)&&_u.perms.includes(k)) || (Array.isArray(_u.editPerms)&&_u.editPerms.includes(k));
      const canVendors=isAdmin || hasCap('md.vendors');
      // 정산구분 정규화: 옛 값 원/선 → 월정산/선결제
      const normSettle=s=>{ s=String(s||'').trim();
        if(s==='원'||s==='월'||s==='월정산') return '월정산';
        if(s==='선'||s==='선결제') return '선결제';
        return s; };
      let products=getProducts(), vendors=getVendors(), orders=getOrders(), editIdx=-1, ordSort='input';   // ordSort: input|desc|asc
      // 마이그레이션: 자체상품코드 비어있고 카페24코드만 있으면 왼쪽(자체)로 이동 + 정산구분 정리
      (function migrate(){ let changed=false;
        products.forEach(p=>{ if(!(p.selfCode||'').trim() && (p.code||'').trim()){ p.selfCode=p.code; p.code=''; changed=true; }
          const ns=normSettle(p.settle); if(ns!==p.settle){ p.settle=ns; changed=true; }
          if(!(p.vendor||'').trim() && /^[A-E]-/i.test((p.selfCode||'').trim())){ p.vendor='자사'; changed=true; } });
        if(changed) prodDB().set(products); })();
      const markMasterDirty=()=>{ dirtyMaster=true; const d=body.querySelector('#mDirty'); if(d)d.style.display=''; };
      const markVendorDirty=()=>{ dirtyVendor=true; const d=body.querySelector('#vDirty'); if(d)d.style.display=''; };
      const saveProducts=()=>prodDB().set(products);
      const saveVendors =()=>venDB().set(vendors);
      const saveOrders  =()=>ordDB().set(orders);
      // 코드 정규화(공백 제거·대문자) — 서버 카탈로그와 동일 규칙으로 매칭 실패 방지
      const normCode=c=>String(c||'').trim().toUpperCase();
      // 자체상품코드(selfCode)가 기준 · 카페24 상품코드(code)로도 찾히게 보조 매핑(정규화 키)
      const prodMap=()=>{ const m={}; products.forEach(p=>{ const s=normCode(p.selfCode), c=normCode(p.code);
        if(s) m[s]=p; if(c && !m[c]) m[c]=p; }); return m; };
      // 회사명 정규화 — 괄호주석(사이트·카카오톡 등)·(주)·㈜·주식회사 등과 공백 제거 후 비교(입점사 정보 매칭 견고화)
      const normCo=s=>String(s||'').replace(/[(（[][^)）\]]*[)）\]]/g,'')      // (사이트)·(네오봇 카톡 검색) 등 괄호 주석 제거
        .replace(/㈜|주식회사|유한회사|재단법인/g,'').replace(/\s/g,'').toLowerCase();
      const vendorObj=n=>{ if(!n) return null; const exact=vendors.find(x=>x.name===n); if(exact) return exact;
        const k=normCo(n); return k? (vendors.find(x=>normCo(x.name)===k)||null) : null; };
      const vendorShip=n=>{ const v=vendorObj(n); return v?Number(v.ship)||0:0; };
      // A~E 로 시작하는 자체상품코드 = 자사 상품 → 입점사명 '자사'
      const isJasa=c=>/^[A-E]-/i.test(String(c||'').trim());
      // 가격비교(엔티렉스) 취급상품 코드 집합 — 이카운트 구매처(custCode) 미지정 품목의 입점사 폴백 소스
      //  엔티렉스 공급가표(ntrex-data.js)의 에듀이노코드 = 엔티렉스에서 소싱하는 상품이므로, 구매처가 안 잡혀도 입점사=엔티렉스로 연동
      const NTREX_SELF=(()=>{ const s=new Set(); ((typeof window!=='undefined'&&window.NTREX_PRODUCTS)||[]).forEach(r=>{ const c=Array.isArray(r)?r[0]:(r&&r.ed); const k=normCode(c); if(k) s.add(k); }); return s; })();
      const inNtrex=p=> !!(p && NTREX_SELF.has(normCode(p.selfCode||p.code)));
      // 구매처명: (엔티렉스 취급상품) 엔티렉스 고정 > 제품 vendor > 이카운트 코드→이름표(구매처) > 자사
      //  ※ 엔티렉스 취급상품은 구매처 고정 — 이카운트 구매처가 '디바이스마트'/'(주)엔티렉스' 등으로 달라도
      //     입점사 마스터명(엔티렉스)과 불일치해 정산(월/선결제)·배송비가 누락되던 문제 방지.
      const vendorName=p=>{
        if(inNtrex(p)) return '엔티렉스';
        const v=(typeof catVendorName==='function'?catVendorName(p):((p&&p.vendor)||'')).trim();
        if(v) return v;
        return isJasa(p&&p.selfCode)?'자사':''; };
      // 입점사 관리(인수인계 카드 · coll handover_md)의 '등급/정산' 분류를 정산구분 보조 소스로 사용.
      //  배송정보 마스터(mdVendors)에 정산구분이 비어 있어도, 입점사 관리에서 분류된 값으로 자동 연동.
      let cardSettle={};   // { normCo(입점사명): '월정산'|'선결제' }
      const parseCardSettle=t=>{ const s=String(t||''); if(/월\s*정산|월정산/.test(s)) return '월정산'; if(/선결제|선결/.test(s)) return '선결제'; return ''; };
      const cardSettleOf=n=>{ const k=normCo(n); if(!k) return '';
        if(cardSettle[k]) return cardSettle[k];
        // 표기 차이(약칭·접미어 '아시아/코리아' 등) 보정 — 정규화 이름이 서로 접두 일치하고 4자 이상일 때만
        if(k.length>=4){ for(const ck in cardSettle){ if(ck.length>=4 && (ck.startsWith(k)||k.startsWith(ck))) return cardSettle[ck]; } }
        return ''; };
      async function loadCardSettle(){ try{ const r=await fetch('/api/store?type=coll&coll=handover_md'); if(!r.ok) return false;
        const d=await r.json(); const m={}; (d&&d.items||[]).forEach(it=>{ if(!it) return;
          const cls=parseCardSettle(it.gradeSettle); const k=normCo(it.name||it.vendor||''); if(k&&cls&&!m[k]) m[k]=cls; });
        cardSettle=m; return true; }catch(e){ return false; } };
      // 정산구분 최종 판정: 배송정보 마스터 > 입점사 관리 카드 분류 > 상품(이카운트) 값
      const resolveSettle=p=>{ const nm=vendorName(p); const ven=vendorObj(nm);
        return normSettle((ven&&ven.settle)||cardSettleOf(nm)||(p&&p.settle)||''); };
      // 배송비 = 입점사 정보(배송정보 리스트) 우선 · 없으면 이카운트 상품 배송비 (리스트는 화면에서 수정 가능)
      const baseShipFor=p=>{ const vs=vendorShip(vendorName(p)); return vs>0?vs:(Number(p&&p.ship)||0); };
      // 무료배송 임계값 파싱: "5만원 이상"→{amount:50000} · "3만원 이상"→30000 · "5권 이상"→{qty:5}
      function freeThreshold(policy){ const s=String(policy||'');
        let m=s.match(/([\d,]+(?:\.\d+)?)\s*만원\s*이상/); if(m) return { amount:Math.round(parseFloat(m[1].replace(/,/g,''))*10000) };
        m=s.match(/([\d,]+)\s*원\s*이상/); if(m) return { amount:Number(m[1].replace(/,/g,'')) };
        m=s.match(/(\d+)\s*(?:권|개|세트|박스|ea|EA)\s*이상/); if(m) return { qty:Number(m[1]) };
        return {}; }
      // 실제 배송비 = 무료조건 충족 시 0, 아니면 기본 배송비 (총주문금액/수량 기준)
      function shipInfoFor(p, totalAmt, qty){
        const base=baseShipFor(p); const ven=vendorObj(vendorName(p)); const th=freeThreshold(ven&&ven.policy);
        const free = (th.amount!=null && totalAmt>=th.amount) || (th.qty!=null && qty>=th.qty);
        return { base, ship: free?0:base, free, th };
      }
      const shipFor=p=>baseShipFor(p);   // 하위호환(수량 미고려 기본 배송비)
      const shipPillHtml=si=> si.free
        ? `배송비 <b style="color:var(--ok)">무료</b> <span class="muted" style="font-weight:600">(조건충족${si.grouped?' · 주문서 합산':''} · 원래 ${fmtNum(si.base)}원)</span>`
        : `배송비 <b>${fmtNum(si.ship)}원</b>${si.grouped?' <span class="muted" style="font-weight:600">· 주문서 합산</span>':''}`;
      // 하나의 주문서(같은 입점사·주문자·일자) 키 — commit 의 orderGroup 과 동일 규칙
      const groupKeyOf=o=> o.orderGroup || ('g:'+venNorm(o.vendor)+'|'+String(o.orderer||'').trim()+'|'+String(o.date||o.day||'').slice(0,10));
      // 배송비 재계산 — 무료조건을 '주문서 합계(금액/수량)' 기준으로 판정하고, 배송비는 주문서당 1회만 부과
      function recalcGroupShipping(){
        const groups={};
        orders.forEach(o=>{ const k=groupKeyOf(o); (groups[k]=groups[k]||[]).push(o); });
        Object.values(groups).forEach(items=>{
          const amt=items.reduce((s,o)=>s+(Number(o.amount)||0),0);
          const qty=items.reduce((s,o)=>s+(Number(o.qty)||0),0);
          const ven=vendorObj(items[0].vendor); const th=freeThreshold(ven&&ven.policy);
          const base=Math.max(0,...items.map(o=> o.baseShip!=null?(Number(o.baseShip)||0):(vendorShip(o.vendor)||Number(o.ship)||0)));
          const free=(th.amount!=null && amt>=th.amount) || (th.qty!=null && qty>=th.qty);
          const sorted=items.slice().sort((a,b)=>(Number(a.ord)||0)-(Number(b.ord)||0));   // 입력순 첫 항목이 배송비 대표
          sorted.forEach((o,i)=>{ const ns=free?0:(i===0?base:0); if((Number(o.ship)||0)!==ns){ o.ship=ns; o.synced=false; } });   // 변경 시 재동기화 표시
        });
      }

      root.innerHTML=`
      <style>
        /* 오늘 처리량 위젯 */
        .today-stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
        .ts{display:flex;align-items:center;gap:11px;padding:11px 16px;border:1px solid var(--line);border-radius:11px;background:var(--panel);box-shadow:var(--sh-sm);min-width:150px;flex:1 1 0}
        .ts .ts-ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;font-size:17px}
        .ts.me .ts-ic{background:var(--red-soft);color:var(--red)} .ts.day .ts-ic{background:var(--info-bg);color:var(--info)} .ts.week .ts-ic{background:var(--ok-bg);color:var(--ok)}
        .ts .ts-l{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.03em;text-transform:uppercase}
        .ts .ts-v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--ink);line-height:1.15}
        .ts .ts-v small{font-size:12.5px;font-weight:600;color:var(--muted);margin-left:2px}
        /* 빠른 발주 히어로 카드 */
        .card.qk{border-radius:14px;box-shadow:var(--sh);overflow:hidden}
        .card.qk .card-hd{background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800}
        .card.qk .qk-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;
          background:var(--red-soft);color:var(--red);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--red) 22%,transparent)}
        .card.qk .qk-ic svg{width:15px;height:15px}
        .code-in{font-size:20px;font-weight:800;font-family:var(--mono);height:54px;letter-spacing:.03em;border-width:2px}
        .code-in:focus{border-color:var(--red);box-shadow:0 0 0 4px var(--red-soft)}
        .oe{height:32px;font-size:13px;padding:4px 8px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel)}
        .oe:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft);outline:none}
        .settle-sel{border:1px solid var(--line-2);border-radius:5px;background:var(--panel);font-size:12.5px;font-weight:700;padding:1px 4px;color:var(--ink);vertical-align:middle}
        .lookup .pill .settle-sel{height:22px}
        .settle-sel:focus{border-color:var(--red);outline:none}
        #ordTable tr:has(.oe){background:var(--active-bg)}
        /* 자동 조회 */
        .lookup{display:flex;align-items:center;padding:13px 16px;border-radius:11px;border:1.5px solid var(--line);background:var(--panel-2);min-height:66px;font-size:14px;transition:border-color .14s,background .14s,box-shadow .14s}
        .lookup.ok{border-color:color-mix(in srgb,var(--ok) 42%,var(--line));background:var(--ok-bg);box-shadow:inset 3px 0 0 var(--ok)}
        .lookup.bad{border-color:color-mix(in srgb,var(--danger) 38%,var(--line));background:var(--danger-soft);color:var(--danger);font-weight:600;box-shadow:inset 3px 0 0 var(--danger)}
        .lookup.warn{border-color:color-mix(in srgb,var(--warn) 42%,var(--line));background:var(--warn-bg);color:var(--warn);font-weight:600;box-shadow:inset 3px 0 0 var(--warn)}
        .lookup.warn b{color:var(--ink)}
        .vbadge.unreg{background:var(--warn-bg);color:var(--warn)}
        .lk{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0}
        .lk-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .lk-vn{font-weight:800;font-size:18px;color:var(--ink);white-space:nowrap;letter-spacing:-.01em}
        .lk-name{font-size:13.5px;line-height:1.45;color:var(--ink-2);font-weight:600}
        .lk-amt{font-size:13.5px;font-weight:700;color:var(--ink);margin:2px 0 1px}
        .lk-amt b{color:var(--red);font-variant-numeric:tabular-nums;font-size:15px}
        .lk-amt .muted{font-weight:500;font-size:12px}
        .lookup .pill{white-space:nowrap;background:var(--panel);font-weight:600;border-color:#b7dcc6}
        .lookup .pill b{color:var(--ink);font-weight:800;margin-left:2px}
        /* 옵션 상품 선택 리스트 (P-D10 → P-D10-1~3) */
        .lookup:has(.opt-list){display:block;align-items:stretch}
        .opt-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto}
        .opt-row{display:flex;align-items:center;gap:11px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);cursor:pointer;text-align:left;transition:.12s;width:100%}
        .opt-row:hover{border-color:var(--red);background:var(--red-soft)}
        .opt-row .oc{font-family:var(--mono);font-weight:800;font-size:14px;min-width:96px;color:var(--ink)}
        .opt-row .oopt{font-size:12.5px;font-weight:700;color:var(--red);background:var(--red-soft);border-radius:5px;padding:2px 9px;white-space:nowrap;flex:none}
        .opt-row .on{font-size:13px;color:var(--ink-2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lookup .pill.pol{background:var(--warn-bg);border-color:color-mix(in srgb,var(--warn) 45%,var(--line));color:var(--warn);display:inline-flex;align-items:center;gap:4px;max-width:100%}
        .lookup .pill.pol b{color:var(--warn);white-space:normal}
        .lookup .pill.pol svg{width:13px;height:13px;flex:0 0 auto}
        /* 입점사 정보 표 */
        .ven-tbl{overflow:auto;border:1px solid var(--line);border-radius:9px;box-shadow:var(--sh-sm);max-height:560px}
        .ven-tbl table.tbl th{background:var(--panel-2);position:sticky;top:0;z-index:1}
        .ven-tbl table.tbl tbody tr:nth-child(even){background:var(--zebra)}
        .ven-tbl input{min-width:0}
        /* 표 */
        .out-tbl{overflow:auto;max-height:320px;border:1px solid var(--line);border-radius:9px;box-shadow:var(--sh-sm)}
        .out-tbl table.tbl th{background:var(--panel-2)}
        .out-tbl table.tbl tbody tr:nth-child(even){background:var(--zebra)}
        .mini{font-size:11px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        /* 자사/입점사 배지 */
        .vbadge{display:inline-block;font-size:11px;font-weight:800;padding:1px 7px;border-radius:5px;background:var(--info-bg);color:var(--info);margin-left:4px}
        .vbadge.jasa{background:#eae4ff;color:#5b3fc4}
        /* 섹션 스텝 통일 */
        .fs-hd .step{box-shadow:0 2px 6px rgba(16,24,40,.18)}
      </style>
      <div class="mhead">
        <div class="tt">입점사 발주</div>
        <div class="ds">상품코드만 입력하면 입점사·정산구분·품명(구글시트)과 배송비(이카운트)가 자동으로 채워집니다.</div>
        <div class="mtabs">
          <div class="t" data-t="entry">발주 입력</div>
          <div class="t" data-t="records">발주 기록</div>
          ${canVendors?`<div class="t" data-t="vendor">입점사 정보</div>`:''}
          ${isAdmin?`<div class="t" data-t="catmap">이카운트 매핑</div>
          <div class="t" data-t="settings">연동 설정</div>`:''}
        </div>
      </div>
      <div class="mbody" id="ordBody"></div>`;
      const body=root.querySelector('#ordBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      // 탭 접근 가드: 발주입력·발주기록은 전원 · 입점사 정보는 권한자 · 이카운트/연동설정은 관리자
      const tabOk=t=> t==='entry'||t==='records'||(t==='vendor'&&canVendors)||((t==='catmap'||t==='settings')&&isAdmin);
      const draw=()=>{ if(!tabOk(tab)) tab='entry';
        return tab==='entry'?drawEntry(): tab==='records'?embedModule(body,'md.records'): tab==='catmap'?drawCatMap(): tab==='vendor'?drawVendors(): drawSettings(); };

      /* ---------------- 발주 입력 ---------------- */
      const meName=((Auth.user&&Auth.user())||{}).name||'';
      let form={ code:'', name:'', qty:1, orderer:'', route:'', gubun:'직배', settle:'', shipInfo:'', handler:meName, date:todayStr() };   // 일자 = YYYY-MM-DD(발주 기록과 통일)
      // 담당자 셀렉트 채우기 — MD 구성원(+관리자 본인). 팀원은 본인으로 기본 고정
      async function fetchRoster(){ try{ const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})}); const d=await r.json(); return (d&&d.roster)||[]; }catch{ return []; } }
      function fillHandler(sel){ if(!sel) return;
        fetchRoster().then(list=>{ if(!sel.isConnected) return;
          const names=[...new Set([meName, ...list.filter(p=>p.dept==='md').map(p=>p.name)].filter(Boolean))];
          sel.innerHTML=`<option value="">담당자 선택</option>`+names.map(n=>`<option ${n===form.handler?'selected':''}>${esc(n)}</option>`).join('');
          if(!form.handler && meName){ form.handler=meName; sel.value=meName; }
          if(!isAdmin && meName){ form.handler=meName; sel.value=meName; sel.disabled=true; }  // 팀원은 본인 고정
        });
      }
      function drawEntry(){
        body.innerHTML=`
          <div class="today-stat" id="todayStat" style="display:none"></div>
          <div class="card qk" style="margin-bottom:18px">
            <div class="card-hd"><span class="qk-ic">${icon('search')}</span><b>상품코드로 빠른 발주</b>
              <span class="muted" style="margin-left:auto;font-size:12.5px">코드 입력 후 <b>Enter</b> → 목록에 추가</span></div>
            <div class="card-bd">
              <div style="display:grid;grid-template-columns:minmax(200px,1fr) minmax(260px,1.3fr);gap:16px;align-items:stretch">
                <label class="fld">자체상품코드
                  <input type="text" class="code-in" id="fCode" value="${esc(form.code)}" placeholder="예: ED-1004" autocomplete="off"></label>
                <div><div class="mini" style="margin-bottom:6px">자동 조회</div><div class="lookup" id="lookup">상품코드를 입력하세요.</div></div>
              </div>
              <label class="fld" style="margin-top:14px">품명 <span class="muted" style="font-weight:500;font-size:12px">· 코드 입력 시 자동 채움 · 미등록 품목은 직접 입력</span>
                <input type="text" id="fName" value="${esc(form.name)}" placeholder="상품코드로 자동 조회됩니다" autocomplete="off"></label>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin-top:16px">
                <label class="fld">담당자<select id="fHandler"><option value="">담당자 선택</option></select></label>
                <label class="fld">수량<input type="number" id="fQty" value="${form.qty}" min="1"></label>
                <label class="fld">주문자명<input type="text" id="fOrderer" value="${esc(form.orderer)}"></label>
                <label class="fld">주문경로<input type="text" id="fRoute" value="${esc(form.route)}" placeholder="예: 사이트"></label>
                <label class="fld">구분<input type="text" id="fGubun" value="${esc(form.gubun)}" placeholder="예: 직배"></label>
                <label class="fld">일자<input type="date" id="fDate" value="${esc(form.date)}"></label>
              </div>
              <label class="fld" style="margin-top:14px">배송정보/비고<textarea id="fShipInfo" rows="2" placeholder="수령인 · 연락처 · 주소 · 요청사항">${esc(form.shipInfo)}</textarea></label>
              <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
                <button class="btn pri lg" id="addOrder">${icon('plus')}발주 목록에 추가</button>
                <button class="btn lg" id="newOrderForm" title="주문자·배송정보를 비우고 다른 고객의 새 주문서를 시작합니다">${icon('refresh')}새 주문서</button>
              </div>
              <div class="muted" id="ordFormHint" style="margin-top:10px;font-size:12.5px;line-height:1.6">같은 주문자에게 여러 상품이면 <b>상품코드·수량만 바꿔 계속 추가</b>하세요 → 하나의 주문서로 묶입니다. 다른 주문자는 <b>[새 주문서]</b>. <span style="opacity:.8">· 미등록 코드는 이카운트 등록 시 매일 00시 자동 반영</span></div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <h3 style="font-size:16px">발주 목록 <span class="muted" style="font-weight:500;font-size:13.5px" id="ordCnt"></span></h3>
            <span id="sheetStat" class="muted" style="margin-left:auto;font-size:12.5px"></span>
            <button class="btn ghost sm" id="ordSortBtn" title="일자 정렬 전환">정렬: 입력순</button>
            <button class="btn sm" id="clearOrders">${icon('trash')}비우기</button>
            <button class="btn pri" id="saveOrders">${icon('save')}저장 <span style="opacity:.75;font-weight:500;font-size:11.5px">내부+시트</span></button>
          </div>
          <div class="out-tbl" style="max-height:none;margin-bottom:22px"><table class="tbl" id="ordTable"></table></div>`;

        const $f=id=>body.querySelector(id);
        // 입력 중 미리보기 배송비 — 같은 주문서(주문자·입점사·일자)로 이미 담긴 항목 금액/수량까지 합산해 무료조건 판정
        const groupShipPreview=(p,thisAmt,thisQty)=>{
          const on=(($f('#fOrderer')&&$f('#fOrderer').value)||'').trim(), dt=(($f('#fDate')&&$f('#fDate').value)||form.date||'').slice(0,10);
          const gk='g:'+venNorm(vendorName(p))+'|'+on+'|'+dt;
          const grp=orders.filter(o=>groupKeyOf(o)===gk);
          const ea=grp.reduce((s,o)=>s+(Number(o.amount)||0),0), eq=grp.reduce((s,o)=>s+(Number(o.qty)||0),0);
          const si=shipInfoFor(p, thisAmt+ea, thisQty+eq); si.grouped=grp.length>0; return si;
        };
        let curProd=null;   // 현재 자동조회된 상품(수량 변경 시 총주문금액 재계산용)
        let curSettle='';   // 자동조회로 판정된 정산구분(월정산/선결제) — 사용자가 직접 고르면 form.settle 이 우선
        // 정산구분(월정산/선결제) 선택 드롭다운 — 구글시트 정산구분 칸으로 들어감
        const settleSelHtml=(cur,id)=>`<select id="${id}" class="settle-sel"><option value="">-</option>`+
          ['월정산','선결제'].map(o=>`<option ${o===cur?'selected':''}>${o}</option>`).join('')+`</select>`;
        const codeEl=$f('#fCode');
        const catCache={};   // 셀메이트 카탈로그 조회 캐시 (code → product)
        // 정확 일치 상품 + 옵션 후보(P-D10 → P-D10-1~3) 함께 반환
        async function fetchCatalog(code){ try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(code)); if(!r.ok) return {product:null,options:[]}; const d=await r.json(); return { product:(d&&d.product)||null, options:(d&&d.options)||[] }; }catch(e){ return {product:null,options:[]}; } }
        function pickOption(o){ catCache[normCode(o.selfCode)]=o; codeEl.value=o.selfCode; form.code=o.selfCode; refreshLookup(); const n=nameEl(); }
        const resolveLocal=code=>prodMap()[normCode(code)]||catCache[normCode(code)];
        const nameEl=()=>$f('#fName');
        // 조회 결과에 맞춰 품명칸 동기화 — 자동 채운 값만 갱신/삭제, 사용자가 직접 입력한 값은 보존
        function syncName(p){ const el=nameEl(); if(!el) return;
          const wasAuto = el.dataset.auto && el.value===el.dataset.auto;
          if(p && p.name){ if(!el.value.trim() || wasAuto){ el.value=p.name; el.dataset.auto=p.name; form.name=p.name; } }
          else if(wasAuto){ el.value=''; el.dataset.auto=''; form.name=''; }   // 새 코드에 품명 없음/미등록 → 이전 자동값 제거
        }
        function refreshLookup(){
          curProd=null;
          const code=codeEl.value.trim(); const box=$f('#lookup');
          if(!code){ box.className='lookup'; box.textContent='상품코드를 입력하세요.'; return null; }
          const p=resolveLocal(code);
          if(!p){
            // 로컬 상품 마스터에 없으면 서버 카탈로그(셀메이트)에서 조회
            box.className='lookup'; box.innerHTML=`${icon('cloud')} 카탈로그 조회 중…`;
            fetchCatalog(code).then(res=>{ if(codeEl.value.trim()!==code) return;
              if(res.product){ catCache[normCode(code)]=res.product; refreshLookup(); }
              else if(res.options && res.options.length){   // 옵션 상품 — 선택 리스트 표시
                syncName(null); box.className='lookup';
                box.innerHTML=`<div style="font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:6px">옵션 상품 <b style="color:var(--red)">${res.options.length}</b>개 — 선택하세요</div>
                  <div class="opt-list">${res.options.map((o,i)=>`<button type="button" class="opt-row" data-i="${i}">
                    <span class="oc">${esc(o.selfCode)}</span>${o.option?`<span class="oopt">${esc(o.option)}</span>`:''}<span class="on">${o.name?esc(o.name):'<span class="muted">(품명 없음)</span>'}</span></button>`).join('')}</div>`;
                box.querySelectorAll('.opt-row').forEach(r=>r.onclick=()=>pickOption(res.options[+r.dataset.i]));
              }
              else { syncName(null); box.className='lookup warn'; box.innerHTML=`${icon('alert')} 이카운트 미등록 코드 — <b>품명을 직접 입력</b>하면 그대로 발주에 추가됩니다.`; } });
            return null;
          }
          syncName(p);
          const ven=vendorObj(vendorName(p));
          const policy=(ven&&ven.policy||'').trim();
          const settle=resolveSettle(p);   // 배송정보 마스터 > 입점사 관리 카드 분류 > 상품값
          curSettle=settle;                                            // 자동조회 기준값(사용자가 미선택 시 사용)
          const unit=Number(p.inPrice)||0, qty=Number(form.qty)||1;   // 이카운트 금액합계 = 입고단가 × 수량
          const si=groupShipPreview(p, unit*qty, qty);   // 이미 담긴 같은 주문서 항목까지 합산해 무료조건 판정
          box.className='lookup ok';
          box.innerHTML=`<div class="lk">
            <div class="lk-top"><span class="lk-vn">${esc(vendorName(p)||'입점사 미지정')}</span>
              <span class="pill" style="padding:2px 6px 2px 9px">정산 ${settleSelHtml(form.settle||settle,'lkSettle')}</span>
              <span class="pill" id="lkShip">${shipPillHtml(si)}</span>${policy?`<span class="pill pol">${icon('truck')}<b>${esc(policy)}</b></span>`:''}</div>
            <div class="lk-amt" id="lkAmt">총주문금액 <b>${fmtNum(unit*qty)}원</b> <span class="muted">= 입고단가 ${fmtNum(unit)}원 × ${qty}${unit?'':' · 단가 미등록'}</span></div>
            <div class="lk-name">${p.name?esc(p.name):'<span class="muted">품명 미등록 — 직접 입력하세요</span>'}</div></div>`;
          const ss=box.querySelector('#lkSettle'); if(ss) ss.onchange=e=>{ form.settle=e.target.value; };
          curProd=p; return p;
        }
        codeEl.oninput=()=>{ form.code=codeEl.value; form.settle=''; refreshLookup(); };  // 코드 변경 시 정산 선택은 자동판정으로 초기화
        if(nameEl()) nameEl().oninput=e=>{ form.name=e.target.value; e.target.dataset.auto=''; };  // 수동 편집 시 자동채움 잠금 해제
        ['fQty','fOrderer','fRoute','fGubun','fDate'].forEach(id=>$f('#'+id).oninput=e=>{ form[id.slice(1).toLowerCase()==='qty'?'qty':({fOrderer:'orderer',fRoute:'route',fGubun:'gubun',fDate:'date'})[id]]=e.target.value;
          if(id==='fQty' && curProd){ const u=Number(curProd.inPrice)||0, q=Number(form.qty)||1; const tot=u*q;
            const amt=$f('#lkAmt'); if(amt) amt.innerHTML=`총주문금액 <b>${fmtNum(tot)}원</b> <span class="muted">= 입고단가 ${fmtNum(u)}원 × ${q}${u?'':' · 단가 미등록'}</span>`;
            const shp=$f('#lkShip'); if(shp) shp.innerHTML=shipPillHtml(groupShipPreview(curProd, tot, q)); } });
        $f('#fShipInfo').oninput=e=>form.shipInfo=e.target.value;
        $f('#fHandler').onchange=e=>form.handler=e.target.value;
        fillHandler($f('#fHandler'));

        /* 오늘 처리량 위젯 (발주 기록 기준) */
        (function(){
          if(!window.Records) return;
          const ymd=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
          const dayOf=r=>String(r.date||r.day||'').slice(0,10);
          const today=todayStr(); const ws=new Date(); ws.setDate(ws.getDate()-((ws.getDay()+6)%7)); const wkStart=ymd(ws);
          const months=[...new Set([today.slice(0,7), wkStart.slice(0,7), ymd(new Date(new Date().setMonth(new Date().getMonth()-1))).slice(0,7)])];
          Promise.all(months.map(m=>Records.month('md','orders',m))).then(packs=>{
            const box=body.querySelector('#todayStat'); if(!box||!body.isConnected) return;
            const recs=packs.filter(Boolean).flat();
            const myName=((Auth.user&&Auth.user()||{}).name)||'';
            const todayN=recs.filter(r=>dayOf(r)===today).length;
            const weekN=recs.filter(r=>{ const d=dayOf(r); return d>=wkStart&&d<=today; }).length;
            const mineN=recs.filter(r=>dayOf(r)===today && (r.handler||r.who||r.whoName||'')===myName).length;
            box.innerHTML=`
              <div class="ts me"><span class="ts-ic">🙋</span><div><div class="ts-l">오늘 나</div><div class="ts-v">${mineN}<small>건</small></div></div></div>
              <div class="ts day"><span class="ts-ic">🚚</span><div><div class="ts-l">오늘 발주(팀)</div><div class="ts-v">${todayN}<small>건</small></div></div></div>
              <div class="ts week"><span class="ts-ic">🗓️</span><div><div class="ts-l">이번 주(팀)</div><div class="ts-v">${weekN}<small>건</small></div></div></div>`;
            box.style.display='flex';
          }).catch(()=>{});
        })();
        async function addOrder(){
          const code=codeEl.value.trim();
          if(!code){ toast('상품코드를 입력하세요'); codeEl.focus(); return; }
          let p=resolveLocal(code);
          if(!p){ const res=await fetchCatalog(code);
            if(res.product){ p=res.product; catCache[normCode(code)]=p; }
            else if(res.options && res.options.length){ refreshLookup(); toast('옵션 상품입니다 — 아래 목록에서 옵션을 선택하세요'); return; }
          }
          // 미등록 코드도 품명만 있으면 발주에 추가(이카운트에 없어도 정상 등록)
          const nameVal=($f('#fName').value||'').trim() || (p&&p.name) || '';
          if(!p && !nameVal){ toast('미등록 코드입니다 — 품명을 입력하면 추가됩니다'); refreshLookup(); const n=nameEl(); if(n) n.focus(); return; }
          const rec={ id:uuid(), date:$f('#fDate').value.trim()||form.date, gubun:$f('#fGubun').value.trim(),
            route:$f('#fRoute').value.trim(), orderer:$f('#fOrderer').value.trim(), handler:$f('#fHandler').value.trim(),
            vendor:p?vendorName(p):(isJasa(code)?'자사':'미지정'), settle:normSettle(form.settle||curSettle||(p&&resolveSettle(p))||''), selfCode:(p&&(p.selfCode||p.code))||normCode(code), code:(p&&p.code)||'', name:nameVal,
            qty:Number($f('#fQty').value)||1, amount:(Number(p&&p.inPrice)||0)*(Number($f('#fQty').value)||1),
            baseShip:p?baseShipFor(p):0,   // 무료조건 미충족 시 부과할 기본 배송비(주문서 재계산용)
            ship:p?shipInfoFor(p,(Number(p.inPrice)||0)*(Number($f('#fQty').value)||1),Number($f('#fQty').value)||1).ship:0, invoice:'', shipInfo:$f('#fShipInfo').value.trim(),
            ord:nextOrd(), orderStatus:'발주전', synced:false, unregistered:!p };   // ord=입력순 · orderStatus=발주 진행여부
          orders.push(rec); recalcGroupShipping(); saveOrders();   // 주문서 합계 기준으로 배송비 재계산
          // 상품(코드·품명·수량)만 비우고 주문자·배송정보·구분·경로·일자 유지 → 같은 주문서에 여러 상품 연속 추가
          // (정산 선택도 초기화 — 다음 상품은 자동판정 · 다른 주문자는 [새 주문서]로 고객정보 비움)
          form.code=''; form.name=''; form.settle=''; curSettle=''; codeEl.value=''; { const n=nameEl(); if(n){ n.value=''; n.dataset.auto=''; } }
          $f('#fQty').value=1;
          refreshLookup(); renderAll(); updateOrderHint(); codeEl.focus();
          // 자동 저장이면 추가 즉시 내부+시트 동시 저장(같은 주문서 형제 항목도 배송비 변경분 재동기화), 아니면 [저장] 대기
          if(getCfg().autoSend){ const grp=orders.filter(o=>groupKeyOf(o)===groupKeyOf(rec)); commit(grp).then(r=>{ renderAll();
            toast(r.internalOnly?'저장됨 (내부 시트)':(r.ok?(r.unconfirmed?SHEET_MSG.unconf(1):SHEET_MSG.ok(1)):SHEET_MSG.fail(r.error))); }); }
          else toast('발주 목록에 추가 · [저장]으로 반영');
        }
        // 현재 주문서 상태 표시 — 같은 주문자+일자로 담긴 상품 수
        function updateOrderHint(){ const h=$f('#ordFormHint'); if(!h) return;
          const on=($f('#fOrderer').value||'').trim(), dt=($f('#fDate').value||'').slice(0,10);
          const n=on?orders.filter(o=>String(o.orderer||'').trim()===on && String(o.date||'').slice(0,10)===dt).length:0;
          h.innerHTML = n
            ? `${icon('check')} 현재 주문서: <b>${esc(on)}</b> · <b style="color:var(--ok)">${n}개</b> 담김 — 상품코드·수량만 바꿔 계속 추가하거나 <b>[새 주문서]</b>`
            : `같은 주문자에게 여러 상품이면 <b>상품코드·수량만 바꿔 계속 추가</b>하세요 → 하나의 주문서로 묶입니다. 다른 주문자는 <b>[새 주문서]</b>. <span style="opacity:.8">· 미등록 코드는 이카운트 등록 시 매일 00시 자동 반영</span>`;
        }
        $f('#addOrder').onclick=addOrder;
        $f('#newOrderForm').onclick=()=>{ form.orderer=''; form.shipInfo=''; form.code=''; form.name=''; form.qty=1;
          $f('#fOrderer').value=''; $f('#fShipInfo').value=''; codeEl.value=''; $f('#fQty').value=1; { const n=nameEl(); if(n){ n.value=''; n.dataset.auto=''; } }
          refreshLookup(); updateOrderHint(); codeEl.focus(); toast('새 주문서 — 주문자·배송정보를 비웠습니다'); };
        $f('#fOrderer').addEventListener('input', updateOrderHint);
        $f('#fDate').addEventListener('change', updateOrderHint);
        body.querySelector('.card-bd').addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.id==='fCode'){ e.preventDefault(); addOrder(); }});
        $f('#clearOrders').onclick=()=>{ if(orders.length&&confirm('발주 목록을 모두 비울까요?')){ orders=[]; saveOrders(); renderAll(); } };
        { const sb=$f('#ordSortBtn'); if(sb){ const lbl={input:'정렬: 입력순',desc:'일자 최신순 ↓',asc:'일자 오래된순 ↑'};
          const paint=()=>{ sb.textContent=lbl[ordSort]; sb.classList.toggle('on',ordSort!=='input'); };
          paint(); sb.onclick=()=>{ ordSort= ordSort==='input'?'desc': ordSort==='desc'?'asc':'input'; paint(); renderOrders(); }; } }
        const rowsTSV=rows=>rows.map(r=>r.join('\t')).join('\n');
        { const sc=$f('#sheetCopy'); if(sc) sc.onclick=()=>{ const {rows}=sheetData(); if(!rows.length){ toast('발주 목록이 비어 있습니다'); return; } copyText(rowsTSV(rows)); }; }
        { const scsv=$f('#sheetCsv'); if(scsv) scsv.onclick=()=>{ const {cols,rows}=sheetData(); downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`발주_구글시트_${todayStr()}.csv`); toast('CSV 저장'); }; }
        $f('#saveOrders').onclick=onSave;
        refreshLookup(); renderAll(); updateOrderHint(); codeEl.focus();
        // 입점사 관리(카드) 정산 분류를 불러와 배송정보 마스터의 빈 정산구분을 보완 → 로드 후 조회 갱신
        loadCardSettle().then(ok=>{ if(ok && root.isConnected) refreshLookup(); });
      }

      // 출고송장/입고 칸: 발주 시 배송비를 먼저 채우고(담당자가 나중에 송장번호로 덮어씀)
      const sheetRowsFor=(list)=>ordSheetRows(list);
      function sheetData(){ return { cols:ORDER_SHEET_COLS, rows:sheetRowsFor(orders) }; }
      async function sendOrders(list){
        const cfg=getCfg(); if(!cfg.sheetUrl) return {ok:false,error:'시트 URL 미설정'};
        const targets=list.filter(o=>!o.synced); if(!targets.length) return {ok:true,sent:0};
        const opts={method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
          body:JSON.stringify({sheet:'입점사발주', records:targets.map(ordSheetRecord)})};
        try{ const res=await fetch(cfg.sheetUrl, opts);
          if(!res.ok) throw new Error('HTTP '+res.status);
          let data=null; try{ data=await res.json(); }catch{}
          if(data && data.ok===false) throw new Error(data.error||'시트 처리 실패(보호된 시트 등)');
          targets.forEach(o=>o.synced=true); saveOrders();
          return {ok:true, sent:(data&&data.added)||targets.length};
        }catch(err){
          // Apps Script는 POST 응답에 CORS 헤더가 없어 브라우저가 못 읽음 → no-cors 로 전송(응답 확인 불가)
          if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){
            try{ await fetch(cfg.sheetUrl, {...opts, mode:'no-cors'});
              targets.forEach(o=>o.synced=true); saveOrders();
              return {ok:true, sent:targets.length, unconfirmed:true};
            }catch(e2){ return {ok:false, error:e2.message||'전송 실패'}; }
          }
          return {ok:false, error:err.message||'전송 실패'};
        }
      }
      function renderAll(){ renderOrders(); renderSheet(); }
      function renderOrders(){
        const t=body.querySelector('#ordTable'), cnt=body.querySelector('#ordCnt'); if(!t) return;
        if(cnt) cnt.textContent=`· ${orders.length}건`;
        t.innerHTML=`<thead><tr><th>일자</th><th>구분</th><th>담당자</th><th>주문자</th><th>입점사</th><th>정산</th><th>자체상품코드</th><th>품명</th>
          <th class="num">수량</th><th class="num">배송비</th><th style="width:78px">시트</th><th style="width:92px"></th></tr></thead><tbody></tbody>`;
        const tb=t.querySelector('tbody');
        if(!orders.length){ tb.innerHTML=`<tr><td colspan="12" class="muted" style="text-align:center;padding:18px">상품코드를 입력해 발주를 추가하세요.</td></tr>`; return; }
        // 표시용 정렬 — 원본 인덱스(i)는 보존해 수정/삭제가 정확히 동작
        const dOf=o=>String(o.date||o.day||'');
        let view=orders.map((o,i)=>({o,i}));
        if(ordSort==='desc') view.sort((a,b)=> dOf(b.o).localeCompare(dOf(a.o)) || (Number(b.o.ord)||0)-(Number(a.o.ord)||0));
        else if(ordSort==='asc') view.sort((a,b)=> dOf(a.o).localeCompare(dOf(b.o)) || (Number(a.o.ord)||0)-(Number(b.o.ord)||0));
        view.forEach(({o,i})=>{ const tr=el('tr');
          if(i===editIdx){
            tr.innerHTML=`<td><input type="date" class="oe" data-k="date" value="${esc(o.date)}" style="width:130px"></td>
              <td><input class="oe" data-k="gubun" value="${esc(o.gubun||'')}" style="width:64px"></td>
              <td><input class="oe" data-k="handler" value="${esc(o.handler||'')}" style="width:80px"></td>
              <td><input class="oe" data-k="orderer" value="${esc(o.orderer||'')}" style="width:88px"></td>
              <td>${o.vendor==='자사'?'<span class="vbadge jasa">자사</span>':'<b>'+esc(o.vendor||'-')+'</b>'}</td>
              <td><select class="oe settle-sel" data-k="settle"><option value="">-</option>${['월정산','선결제'].map(x=>`<option ${x===normSettle(o.settle)?'selected':''}>${x}</option>`).join('')}</select></td><td class="mono">${esc(o.selfCode||o.code)}</td>
              <td style="max-width:360px">${esc(o.name)}<input class="oe" data-k="shipInfo" value="${esc(o.shipInfo||'')}" placeholder="배송정보/비고" style="width:100%;margin-top:5px"></td>
              <td class="num"><input type="number" min="1" class="oe" data-k="qty" value="${o.qty}" style="width:54px;text-align:right"></td>
              <td class="num">${fmtNum(o.ship)}</td><td></td>
              <td><span style="display:flex;gap:4px"><button class="btn pri sm" data-a="osave">${icon('check')}</button><button class="btn ghost sm" data-a="ocancel">취소</button></span></td>`;
            tr.querySelector('[data-a=ocancel]').onclick=()=>{ editIdx=-1; renderAll(); };
            tr.querySelector('[data-a=osave]').onclick=async(e)=>{ const btn=e.currentTarget; btn.disabled=true;
              tr.querySelectorAll('.oe').forEach(inp=>{ const k=inp.dataset.k; o[k]= k==='qty'?(Number(inp.value)||1):inp.value.trim(); });
              o.synced=false; editIdx=-1; saveOrders(); await commit([o]); renderAll(); toast('수정했습니다'); };
          } else {
            tr.innerHTML=`<td>${esc(o.date)}</td><td>${esc(o.gubun)}</td><td>${o.handler?esc(o.handler):'<span class="muted">-</span>'}</td><td>${esc(o.orderer||'-')}</td>
              <td>${o.vendor==='자사'?'<span class="vbadge jasa">자사</span>':'<b>'+esc(o.vendor||'-')+'</b>'}${o.unregistered?' <span class="vbadge unreg" title="이카운트 미등록 — 직접 입력">미등록</span>':''}</td><td>${esc(o.settle||'-')}</td><td class="mono">${esc(o.selfCode||o.code)}</td>
              <td style="max-width:360px">${o.name?esc(o.name):'<span class="muted">(품명 없음)</span>'}${o.shipInfo?`<div class="muted" style="font-size:11.5px;margin-top:2px">${esc(o.shipInfo)}</div>`:''}</td><td class="num">${o.qty}</td><td class="num">${fmtNum(o.ship)}</td>
              <td>${o.synced?`<span class="badge live">${SHEET_MSG.badgeDone}</span>`:`<span class="badge soon">${SHEET_MSG.badgePending}</span>`}</td>
              <td><span style="display:flex;gap:3px"><button class="btn ghost sm" data-a="oedit">수정</button><button class="btn ghost sm" data-a="odel" title="삭제">${icon('x')}</button></span></td>`;
            tr.querySelector('[data-a=oedit]').onclick=()=>{ editIdx=i; renderAll(); };
            tr.querySelector('[data-a=odel]').onclick=()=>{
              const rec=orders[i];
              // 저장(전송)된 발주는 삭제 시 서버 발주기록·일일결산에서도 함께 차감 — 오표기 정정 시 잔재가 남지 않도록
              if(rec && rec.synced && !confirm('이 발주를 삭제할까요? 발주 기록·일일결산에서도 함께 삭제됩니다.')) return;
              orders.splice(i,1); if(editIdx===i)editIdx=-1; saveOrders(); renderAll();
              if(window.Records && rec){ Records.delMD(rec).then(()=>toast('삭제했습니다 · 발주 기록에서도 제거')).catch(()=>{});
                Records.del('md','payreq',rec.id,dayOfOrder(rec).slice(0,7)); }   // 결제요청에서도 제거
            };
          }
          tb.appendChild(tr); });
      }
      function fillTable(id,{cols,rows}){ const t=body.querySelector(id); if(!t) return;
        t.innerHTML=`<thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.length?rows.map(r=>`<tr>${r.map((c,ci)=>`<td class="${ci>=cols.length-3&&typeof c==='number'?'num mono':''}">${esc(c)}</td>`).join('')}</tr>`).join('')
            :`<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:14px">발주 목록이 비어 있습니다.</td></tr>`}</tbody>`; }
      const renderSheet=()=>fillTable('#sheetTable',sheetData());

      // 선결제 발주 → 결제요청(payreq) 미러: 발주 기록에 남기고, 선결제면 결제요청 시트에도 한 번 더 올림
      const dayOfOrder=o=>/^\d{4}-\d{2}-\d{2}$/.test(o.date||'')?o.date:todayStr();
      function payreqFromOrder(o){ const ven=vendorObj(o.vendor);
        const prod=Number(o.amount)||0, ship=Number(o.ship)||0;   // 배송비 포함해야 결제요청 합계가 실제 결제액과 일치
        return { id:o.id, day:dayOfOrder(o), date:o.date, kind:'발주',
          orderer:[o.route,o.orderer].filter(Boolean).join(' '), vendor:o.vendor||'', content:o.name||'', qty:(o.qty!=null?o.qty:''),
          amount:prod+ship, prodAmount:prod, ship, account:(ven&&ven.account)||'', handler:o.handler||'', whoName:o.handler||'' }; }
      function syncPayreq(o){ if(!window.Records) return;
        if(normSettle(o.settle)==='선결제') Records.pushRaw('md','payreq',payreqFromOrder(o));
        else Records.del('md','payreq',o.id,dayOfOrder(o).slice(0,7));   // 선결제 아니면 제거(수정으로 바뀐 경우)
      }
      /* 저장 = 내부 시트(Records) + 외부 구글시트 동시 반영 */
      async function commit(list){
        recalcGroupShipping();   // 저장 직전 주문서 합계 기준 배송비 확정
        const pending=list.filter(o=>!o.synced); if(!pending.length) return {ok:true, sent:0, none:true};
        // 같은 입점사·주문자·일자의 상품을 '하나의 주문서(orderGroup)'로 자동 묶음 → 발주 기록에서 인접 표시
        // (자동저장으로 한 건씩 올려도 같은 주문건이면 같은 그룹이 되도록 결정적 키 사용)
        pending.forEach(o=>{ if(!o.orderGroup){ o.orderGroup='g:'+venNorm(o.vendor)+'|'+String(o.orderer||'').trim()+'|'+String(o.date||o.day||'').slice(0,10); } if(o.ord==null) o.ord=nextOrd(); });
        if(window.Records) pending.forEach(o=>{ Records.pushMD(o); syncPayreq(o); });   // 발주 기록 + 선결제면 결제요청 미러
        const cfg=getCfg();
        if(!cfg.sheetUrl || cfg.backup===false){ pending.forEach(o=>o.synced=true); saveOrders(); return {ok:true, sent:pending.length, internalOnly:true}; }
        return sendOrders(pending);                                    // 외부 구글시트(성공 시 synced 표시)
      }
      async function onSave(){
        const stat=body.querySelector('#sheetStat'); const pending=orders.filter(o=>!o.synced);
        if(!pending.length){ if(stat) stat.innerHTML=`<span style="color:var(--ok)">모두 저장됨</span>`; toast('저장할 신규 발주가 없습니다'); return; }
        if(stat) stat.textContent=`저장 중… (${pending.length}건)`;
        const r=await commit(pending); renderAll();
        if(stat) stat.innerHTML = r.internalOnly ? `<span style="color:var(--ok)">내부 발주 기록에 저장 · ${pending.length}건${getCfg().backup===false?' (구글 백업 꺼짐)':' (구글시트 미설정)'}</span>`
          : r.ok ? `<span style="color:var(--ok)">${esc(r.unconfirmed?SHEET_MSG.unconf(r.sent):SHEET_MSG.ok(r.sent))}</span>`
                 : `<span style="color:var(--danger)">${esc(SHEET_MSG.fail(r.error))} (복사/CSV로 대체 가능)</span>`;
        toast((r.ok||r.internalOnly)?'저장했습니다':'전송 실패 — 다시 시도하세요');
      }

      /* ---------------- 입점사 정보 (배송비 + 배송정책·담당자) ---------------- */
      // "3,000원 - 20만원 이상 구매" → 배송비 3000 추출 · "무료배송"/"0원…" → 0
      function parseShipFromPolicy(s){ s=String(s||'').trim(); if(!s||s==='-') return null;
        if(/무료/.test(s) && !/[1-9]/.test(s.replace(/무료\s*배송/g,''))) return 0;
        const m=s.replace(/,/g,'').match(/(\d+)\s*원/); return m?Number(m[1]):null; }
      function drawVendors(){
        body.innerHTML=`
          <input type="file" id="venFile" accept=".xlsx,.csv,.tsv,.txt,text/csv" class="hidden">
          <div class="card">
            <div class="card-hd">${icon('truck')}<b>입점사 정보</b> <span class="muted" style="font-size:12.5px">· 배송비(vat포함)·무료배송조건·담당자</span>
              <span class="badge soon" id="vDirty" style="display:${dirtyVendor?'':'none'}">● 저장 안 됨</span>
              <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn sm" id="addVen">${icon('plus')}행 추가</button>
                <button class="btn sm" id="impVenFile">${icon('upload')}파일 불러오기<span style="font-weight:500;color:var(--muted);font-size:11px">·xlsx/csv</span></button>
                <button class="btn sm" id="impVenPaste">${icon('clipboard')}붙여넣기</button>
                <button class="btn sm" id="expVen">${icon('download')}CSV 내보내기</button>
                <button class="btn sm pri" id="saveVen">${icon('save')}저장</button></span></div>
            <div class="card-bd" style="padding:0"><div class="ven-tbl"><table class="tbl" id="venTable"></table></div></div>
          </div>
          <div class="note" style="margin-top:12px">배송비는 <b>입점사별 고정 금액</b>(vat포함)이 기본이며 공급가·부가세는 ÷11로 자동 분리됩니다.
            <b>무료배송조건</b>은 발주 입력 시 자동 조회에 함께 표시됩니다. 회사 배송정보 리스트(<span class="mono" style="font-size:12px">integrations/source-data/입점사_배송정보.csv</span>)를 <b>CSV 불러오기</b>로 한 번에 등록하세요.
            헤더(입점사명/업체명·정산구분·배송비·무료배송조건/배송조건·담당자·연락처·발주메일·특이사항)를 자동 인식합니다. 수정 후 <b>저장</b>.</div>
          <div id="venPasteBox" class="hidden" style="margin-top:14px"></div>`;
        renderVen();
        body.querySelector('#saveVen').onclick=()=>{ saveVendors(); dirtyVendor=false; body.querySelector('#vDirty').style.display='none'; toast('저장되었습니다'); };
        body.querySelector('#addVen').onclick=()=>{ vendors.unshift({name:'',ship:3000,policy:'',manager:'',contact:'',email:'',note:''}); markVendorDirty(); renderVen(); };
        body.querySelector('#expVen').onclick=()=>{ const cols=['입점사명','정산구분','배송비','무료배송조건','담당자','연락처','발주메일','계좌정보','특이사항'];
          const rows=vendors.map(v=>[v.name,v.settle||'',v.ship||'',v.policy||'',v.manager||'',v.contact||'',v.email||'',v.account||'',v.note||'']);
          downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`입점사정보_${todayStr()}.csv`); toast('CSV 저장'); };
        const vf=body.querySelector('#venFile');
        body.querySelector('#impVenFile').onclick=()=>vf.click();
        vf.onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if(!f)return;
          // .xlsx(ZIP 바이너리)는 텍스트로 읽으면 깨지므로 XlsxLite 로 파싱 · 월말정산/선결제 등 여러 시트를 모두 반영
          if(/\.(xlsx|xls)$/i.test(f.name) && window.XlsxLite){
            try{ const sheets=await XlsxLite.parseSheets(f); let A=0,U=0;
              sheets.forEach(s=>{ const tag=/월말정산|선결제|선결|후불|정산/.test(s.name)?s.name.trim():''; const r=importVendors(s.rows, tag, true); A+=r.added; U+=r.updated; });
              markVendorDirty(); renderVen();
              toast(`불러오기 완료 · 신규 ${A} / 갱신 ${U}건 · 시트 ${sheets.length}개(${sheets.map(s=>s.name).join('·')}) · [저장]을 눌러 반영`);
            }catch(err){ toast('엑셀을 읽지 못했습니다: '+(err&&err.message||err)); }
          } else { const rd=new FileReader(); rd.onload=()=>importVendors(parseTable(rd.result)); rd.readAsText(f,'utf-8'); } };
        body.querySelector('#impVenPaste').onclick=()=>{
          const box=body.querySelector('#venPasteBox'); box.classList.remove('hidden');
          box.innerHTML=`<div class="card"><div class="card-hd"><b>붙여넣기로 불러오기</b></div><div class="card-bd">
            <div class="muted" style="font-size:12.5px;margin-bottom:8px">엑셀/구글시트에서 범위를 복사해 붙여넣으세요. 첫 줄 헤더(입점사명·배송비·무료배송조건·담당자·연락처·발주메일)를 자동 인식합니다.</div>
            <textarea id="venPasteArea" rows="6" placeholder="입점사명   정산구분   배송비   무료배송조건   담당자   연락처   발주메일"></textarea>
            <div style="display:flex;gap:8px;margin-top:10px"><button class="btn pri" id="venPasteGo">불러오기</button>
              <button class="btn" id="venPasteCancel">취소</button></div></div></div>`;
          box.querySelector('#venPasteCancel').onclick=()=>{ box.classList.add('hidden'); box.innerHTML=''; };
          box.querySelector('#venPasteGo').onclick=()=>{ importVendors(parseTable(box.querySelector('#venPasteArea').value)); box.classList.add('hidden'); box.innerHTML=''; };
        };
      }
      function importVendors(rows, defaultSettle, silent){
        if(!rows.length){ if(!silent) toast('불러올 데이터가 없습니다'); return {added:0,updated:0}; }
        const norm=s=>String(s||'').replace(/\s/g,'').toLowerCase();
        const HEAD={ name:['입점사명','입점사','업체명','거래처','거래처명','상호','상호명'],
          settle:['정산구분','정산'], ship:['배송비','배송비(vat포함)','배송비vat포함'],
          policy:['무료배송조건','배송조건','배송비정책','무료배송기준','배송조건/무료배송조건'],
          manager:['담당자','담당자명','담당'], contact:['연락처','전화','전화번호','연락처1'],
          email:['발주메일','발주 메일','이메일','메일','발주이메일'], account:['계좌정보','계좌','입금계좌','발주계좌','계좌번호'], note:['특이사항','비고','메모'] };
        // 헤더 행 자동 탐색 — 실제 시트는 상단에 안내/빈 행이 섞여 있어 첫 8행 중 헤더가 가장 많이 잡히는 행을 헤더로 인정
        let headerRow=0, best=0;
        for(let i=0;i<Math.min(rows.length,8);i++){ const h=(rows[i]||[]).map(norm); let sc=0;
          for(const key in HEAD){ if(HEAD[key].some(n=>h.includes(norm(n)))) sc++; }
          if(sc>best){ best=sc; headerRow=i; } }
        const hasHeader = best>=2;
        const h = hasHeader ? rows[headerRow].map(norm) : [];
        const idxOf=(key)=>{ for(const n of HEAD[key]){ const i=h.indexOf(norm(n)); if(i>=0) return i; } return -1; };
        const ci={}; for(const key in HEAD) ci[key]=idxOf(key);
        const dataRows = hasHeader ? rows.slice(headerRow+1) : rows;
        const used=new Set(Object.values(ci).filter(i=>i>=0));
        // 업체명 열이 헤더로 안 잡히면(빈 헤더 등) 데이터에서 '회사명 같은' 열을 추정 — 이메일/전화/숫자 제외, 한글·영문 텍스트 최다 열
        if(ci.name<0){
          const cols=Math.max(0,...dataRows.map(r=>r.length)); let bestCol=-1, bestScore=-1;
          for(let c=0;c<cols;c++){ if(used.has(c)) continue; let sc=0;
            for(const r of dataRows){ const v=String((r&&r[c])||'').trim(); if(!v) continue;
              if(/@|https?:/.test(v)){ sc-=2; continue; }
              if(/^[\d\s\-().+]+$/.test(v)){ sc-=1; continue; }
              if(/[가-힣A-Za-z]/.test(v)) sc++; }
            if(sc>bestScore){ bestScore=sc; bestCol=c; } }
          ci.name=bestCol;
        }
        const g=(r,i)=> i>=0&&i<r.length ? String(r[i]).trim() : '';
        const nameIdx = ci.name>=0 ? ci.name : 0;
        const isHeadWord=v=>HEAD.name.some(n=>norm(n)===norm(v));
        let added=0, updated=0;
        dataRows.forEach(r=>{ if(!r || !r.join('').trim()) return;
          const name=g(r,nameIdx).split(/\r?\n/)[0].trim();   // 다중행 셀은 첫 줄을 업체명으로
          if(!name || isHeadWord(name)) return;
          const policy=g(r,ci.policy);
          let ship=g(r,ci.ship).replace(/[^\d]/g,'');
          ship = ship!=='' ? Number(ship) : (parseShipFromPolicy(policy) ?? 0);
          const rec={ name, settle:normSettle(g(r,ci.settle))||defaultSettle||'', ship, policy,
            manager:g(r,ci.manager), contact:g(r,ci.contact), email:g(r,ci.email), account:g(r,ci.account), note:g(r,ci.note) };
          const ex=vendors.find(v=>v.name===name);
          if(ex){ Object.assign(ex,rec); updated++; } else { vendors.push(rec); added++; } });
        if(!silent){ markVendorDirty(); renderVen();
          toast(`불러오기 완료 · 신규 ${added} / 갱신 ${updated}건${!hasHeader?' · 헤더 자동인식 실패(순서대로 매핑)':''} · [저장]을 눌러 반영`); }
        return {added,updated};
      }
      function renderVen(){
        const t=body.querySelector('#venTable'); if(!t) return;
        t.innerHTML=`<thead><tr><th style="min-width:140px">입점사명</th><th style="width:78px">정산</th>
          <th class="num" style="width:112px">배송비(vat포함)</th><th class="num" style="width:88px">공급가</th><th class="num" style="width:72px">부가세</th>
          <th style="min-width:180px">무료배송조건</th><th style="min-width:110px">담당자</th><th style="min-width:150px">연락처</th>
          <th style="min-width:180px">발주메일</th><th style="min-width:190px">계좌정보 <span style="font-weight:500;color:var(--muted);font-size:11px">(선결제 결제요청 자동)</span></th><th style="min-width:120px">특이사항</th><th style="width:34px"></th></tr></thead><tbody></tbody>`;
        const tb=t.querySelector('tbody');
        if(!vendors.length){ tb.innerHTML=`<tr><td colspan="12" class="muted" style="text-align:center;padding:16px">입점사가 없습니다. “행 추가” 또는 CSV 불러오기.</td></tr>`; return; }
        vendors.forEach((v,i)=>{ const s=vat(v.ship); const tr=el('tr');
          const jasa = v.name==='자사';
          tr.innerHTML=`<td>${jasa?'<span class="vbadge jasa">자사</span> ':''}<input type="text" data-k="name" value="${esc(v.name)}" style="width:${jasa?'88px':'100%'}"></td>
            <td><input type="text" data-k="settle" value="${esc(v.settle||'')}" placeholder="-"></td>
            <td><input type="number" data-k="ship" value="${esc(v.ship)}" style="text-align:right"></td>
            <td class="num mono">${fmtNum(s.supply)}</td><td class="num mono">${fmtNum(s.tax)}</td>
            <td><input type="text" data-k="policy" value="${esc(v.policy||'')}" placeholder="예: 3,000원 - 20만원 이상 무료"></td>
            <td><input type="text" data-k="manager" value="${esc(v.manager||'')}"></td>
            <td><input type="text" data-k="contact" value="${esc(v.contact||'')}"></td>
            <td><input type="text" data-k="email" value="${esc(v.email||'')}"></td>
            <td><input type="text" data-k="account" value="${esc(v.account||'')}" placeholder="은행 / 계좌번호 / 예금주"></td>
            <td><input type="text" data-k="note" value="${esc(v.note||'')}"></td>
            <td><button class="btn ghost sm">${icon('x')}</button></td>`;
          tr.querySelectorAll('[data-k]').forEach(inp=>inp.onchange=()=>{ v[inp.dataset.k]= inp.dataset.k==='ship'?(Number(inp.value)||0):inp.value;
            markVendorDirty(); if(inp.dataset.k==='ship') renderVen(); });
          tr.querySelector('button').onclick=()=>{ vendors.splice(i,1); markVendorDirty(); renderVen(); };
          tb.appendChild(tr); });
      }

      /* ---------------- 이카운트 매핑 (구매처·분류 코드→이름표) ---------------- */
      function drawCatMap(){
        const cur=store(STORE.catMap).get({vendor:{},category:{}});
        const norm=s=>catCodeNorm(s);
        const parse=txt=>{ const out={}; String(txt||'').replace(/\r/g,'').split('\n').forEach(line=>{
          if(!line.trim()) return; const sep=line.includes('\t')?'\t':','; const i=line.indexOf(sep);
          const code=(i>=0?line.slice(0,i):line).trim(), name=(i>=0?line.slice(i+1):'').trim();
          const k=norm(code); if(!k||!name) return; out[k]=name; const kz=k.replace(/^0+/,''); if(kz&&!out[kz]) out[kz]=name; }); return out; };
        body.innerHTML=`
          <style>
            .cm-steps{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
            .cm-step{flex:1 1 180px;display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:12px 14px;box-shadow:var(--sh-sm)}
            .cm-step .n{flex:none;width:24px;height:24px;border-radius:7px;background:var(--red-soft);color:var(--red);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
            .cm-step b{font-size:13px} .cm-step span{font-size:12px;color:var(--muted);line-height:1.5}
            .cm-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px} @media(max-width:940px){.cm-cols{grid-template-columns:1fr}}
            .cm-list{max-height:460px;overflow:auto}
            .cm-row{display:grid;grid-template-columns:112px minmax(0,1fr) 200px;gap:10px;align-items:center;padding:9px 13px;border-top:1px solid var(--line-2)}
            .cm-row:first-child{border-top:0}
            .cm-row .cc{font-family:var(--mono);font-weight:800;font-size:12.5px;color:var(--ink)}
            .cm-row .cm{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .cm-row input{height:34px;font-size:13.5px}
            .cm-row.done .cc::after{content:" ✓";color:var(--ok)}
            .cm-row.todo{background:color-mix(in srgb,var(--warn) 7%,transparent)}
            .cm-hint{font-size:11px;color:var(--info);cursor:pointer;text-decoration:underline;margin-top:3px;display:inline-block}
            .cm-empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:13px;line-height:1.6}
          </style>
          <div class="cm-steps">
            <div class="cm-step"><span class="n">1</span><div><b>코드가 자동으로 나옵니다</b><br><span>지금 상품에 실제로 쓰이는 거래처코드를 아래에 자동으로 보여줘요. 코드를 몰라도 됩니다.</span></div></div>
            <div class="cm-step"><span class="n">2</span><div><b>회사명만 적으세요</b><br><span>각 코드 옆 칸에 이카운트 거래처명(예: (주)컴스마트)을 입력합니다.</span></div></div>
            <div class="cm-step"><span class="n">3</span><div><b>저장하면 끝</b><br><span>팀 전체에 공유되고, 상품 조회·발주에서 자동으로 구매처명이 표시됩니다.</span></div></div>
          </div>
          <div class="cm-cols">
            <div class="card"><div class="card-hd">${icon('truck')}<b>구매처(거래처) 이름표</b><span id="vSum" class="muted" style="margin-left:auto;font-size:12.5px"></span></div>
              <div class="card-bd" style="padding:0"><div class="cm-list" id="vList"><div class="cm-empty">${icon('cloud')} 불러오는 중…</div></div></div></div>
            <div class="card"><div class="card-hd">${icon('grid')}<b>상품분류 이름표</b><span id="cSum" class="muted" style="margin-left:auto;font-size:12.5px"></span></div>
              <div class="card-bd" style="padding:0"><div class="cm-list" id="cList"><div class="cm-empty">…</div></div></div></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
            <button class="btn pri lg" id="saveCatMap">${icon('save')}저장 (팀 공유)</button>
            <button class="btn ok sm" id="fillApi">⚡ API 추정 전체 채우기</button>
            <button class="btn ghost sm" id="reloadFacet">${icon('refresh')}코드 다시 불러오기</button>
            <span class="muted" id="catStat" style="font-size:12.5px"></span></div>
          <div class="card" style="margin-top:16px;max-width:960px"><div class="card-hd">${icon('upload')}<b>이카운트 거래처 목록 파일 불러오기</b>
              <span class="muted" style="margin-left:auto;font-size:12px">엑셀(.xlsx)·CSV를 올리면 거래처코드→거래처명을 통째로 이름표에 반영</span></div>
            <div class="card-bd">
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <input type="file" id="vendorFile" accept=".xlsx,.csv,.tsv,.txt" class="hidden">
                <button class="btn pri" id="vendorFileBtn">${icon('upload')}거래처 파일 선택 (.xlsx/.csv)</button>
                <span class="muted" id="vendorFileStat" style="font-size:13px">이카운트 › 거래처등록 › 엑셀 내려받기 파일을 그대로 올리면 됩니다. (거래처코드·거래처명 열 자동 인식)</span>
              </div>
              <div class="note" style="margin-top:10px;font-size:12px">파일은 <b>브라우저 안에서만</b> 처리되어 이름표(구매처명)로 저장됩니다. 상품코드의 거래처코드와 일치하는 항목이 자동으로 구매처명으로 표시됩니다.</div>
            </div></div>
          <div class="card" style="margin-top:16px;max-width:960px"><div class="card-hd">${icon('download')}<b>거래처 목록 붙여넣기 → 자동 매칭</b>
              <span class="muted" style="margin-left:auto;font-size:12px">이카운트 거래처/분류 목록을 통째로 붙여넣으면 코드를 알아서 찾아 채웁니다(열 순서 무관)</span></div>
            <div class="card-bd">
              <div class="cm-cols">
                <div><div class="muted" style="font-size:12px;margin-bottom:5px"><b>구매처(거래처)</b> 목록 붙여넣기</div>
                  <textarea id="vMap" rows="5" placeholder="이카운트 거래처 목록 복사 → 붙여넣기&#10;(거래처코드·거래처명 열이 섞여 있어도 자동 매칭)"></textarea></div>
                <div><div class="muted" style="font-size:12px;margin-bottom:5px"><b>상품분류</b> 목록 붙여넣기</div>
                  <textarea id="cMap" rows="5" placeholder="이카운트 품목분류 목록 복사 → 붙여넣기"></textarea></div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
                <button class="btn pri sm" id="autoMatch">${icon('check')}붙여넣은 내용 자동 매칭</button>
                <span class="muted" id="matchStat" style="font-size:12.5px">붙여넣고 이 버튼을 누르면 위 목록의 빈칸이 자동으로 채워집니다.</span></div>
            </div></div>
          <div class="card" style="margin-top:16px;max-width:560px"><div class="card-hd">${icon('search')}<b>테스트</b> <span class="muted" style="font-size:12px">· 저장 전 미리 확인</span></div>
            <div class="card-bd"><label class="fld">상품코드로 구매처명 확인<input type="text" id="catTest" placeholder="예: P-DA39" autocomplete="off"></label>
              <div id="catTestOut" class="muted" style="margin-top:8px;font-size:13px">상품코드를 입력하세요.</div></div></div>`;

        function collect(listEl){ const out={}; if(!listEl) return out;
          listEl.querySelectorAll('.cm-row').forEach(row=>{ const code=row.dataset.code, name=(row.querySelector('.cm-in')||{}).value; if(code&&name&&name.trim()){ const k=norm(code); out[k]=name.trim(); const kz=k.replace(/^0+/,''); if(kz&&!out[kz]) out[kz]=name.trim(); } }); return out; }
        function updateSums(){ [['#vList','#vSum'],['#cList','#cSum']].forEach(([l,s])=>{ const list=body.querySelector(l), sum=body.querySelector(s); if(!list||!sum) return;
          const rows=list.querySelectorAll('.cm-row'), done=list.querySelectorAll('.cm-row.done').length;
          sum.innerHTML = rows.length? `${done}/${rows.length} 완료${done<rows.length?` · <b style="color:var(--warn)">미입력 ${rows.length-done}</b>`:' <span style="color:var(--ok)">✓</span>'}` : ''; }); }
        function renderList(container, items, curMap, kind){
          if(!items || !items.length){ container.innerHTML=`<div class="cm-empty">카탈로그에 ${kind==='vendor'?'거래처':'분류'}코드가 없습니다.<br><span style="font-size:12px">VPS 동기화가 코드(custCode)를 저장했는지 확인이 필요합니다. 아래 <b>테스트</b>에서 상품코드로 점검해 보세요.</span></div>`; return; }
          container.innerHTML=items.map((it,idx)=>{ const val=catMapGet(curMap, it.code); const done=!!val;
            const sug=(!val && it.apiVendor)?`<span class="cm-hint" data-fill="${idx}">API 추정: ${esc(it.apiVendor)} · 쓰기</span>`:'';
            return `<div class="cm-row ${done?'done':'todo'}" data-code="${esc(it.code)}">
              <div class="cc">${esc(it.code)}</div>
              <div><div class="cm" title="${esc(it.sampleName||'')}">${it.count}개 · 예: ${esc(it.sampleName||it.sampleCode||'-')}</div>${sug}</div>
              <div><input type="text" class="cm-in" value="${esc(val)}" placeholder="${kind==='vendor'?'회사명 입력':'분류명 입력'}"></div></div>`; }).join('');
          container.querySelectorAll('.cm-hint[data-fill]').forEach(h=>{ h.onclick=()=>{ const row=h.closest('.cm-row'), inp=row.querySelector('.cm-in'); inp.value=items[+h.dataset.fill].apiVendor||''; row.classList.add('done'); row.classList.remove('todo'); updateSums(); }; });
          container.querySelectorAll('.cm-in').forEach(inp=>{ inp.oninput=()=>{ const row=inp.closest('.cm-row'), has=!!inp.value.trim(); row.classList.toggle('done',has); row.classList.toggle('todo',!has); updateSums(); }; });
        }
        let facetV=[], facetC=[];
        async function loadFacet(){ const vL=body.querySelector('#vList'), cL=body.querySelector('#cList');
          if(vL) vL.innerHTML=`<div class="cm-empty">${icon('cloud')} 불러오는 중…</div>`;
          try{ const r=await fetch('/api/catalog?facet=1'); const d=await r.json(); if(!root.isConnected) return;
            facetV=d.vendors||[]; facetC=d.categories||[];
            // 표시용 base = 내장 거래처 기본값(VENDOR_DEFAULTS) + 관리자 저장값(우선) — 이미 매칭된 이름이 채워져 보임
            const vBase={ ...((typeof window!=='undefined'&&window.VENDOR_DEFAULTS)||{}), ...(cur.vendor||{}) };
            renderList(vL, facetV, vBase, 'vendor'); renderList(cL, facetC, cur.category, 'category'); updateSums();
          }catch(e){ if(vL) vL.innerHTML=`<div class="cm-empty">코드 목록을 불러오지 못했습니다(배포 환경에서 표시됩니다).</div>`; }
        }
        loadFacet();
        body.querySelector('#reloadFacet').onclick=loadFacet;
        // ⚡ API가 준 이름(apiVendor)이 있는 코드를 한 번에 채움
        body.querySelector('#fillApi').onclick=()=>{ let n=0;
          (facetV||[]).forEach(it=>{ if(!it.apiVendor) return; const row=body.querySelector(`#vList .cm-row[data-code="${CSS.escape(it.code)}"]`); if(!row) return; const inp=row.querySelector('.cm-in'); if(inp && !inp.value.trim()){ inp.value=it.apiVendor; row.classList.add('done'); row.classList.remove('todo'); n++; } });
          updateSums(); toast(n?`API 이름 ${n}개 채움 — 확인 후 저장하세요`:'API가 제공한 이름이 없습니다. (붙여넣기 자동 매칭을 이용하세요)'); };
        // 붙여넣은 목록에서 코드를 찾아 이름을 자동 매칭(열 순서 무관)
        function smartFill(listEl, text){
          if(!listEl) return 0; const idx=new Map();
          listEl.querySelectorAll('.cm-row').forEach(r=>{ const k=norm(r.dataset.code); idx.set(k,r); const z=k.replace(/^0+/,''); if(z) idx.set(z,r); });
          let filled=0;
          String(text||'').replace(/\r/g,'').split('\n').forEach(line=>{
            if(!line.trim()) return; const cells=line.split(/\t|,|;|\s{2,}/).map(c=>c.trim()).filter(Boolean); if(cells.length<2) return;
            let codeCell=null,row=null;
            for(const c of cells){ const k=norm(c); if(k&&idx.has(k)){ codeCell=c; row=idx.get(k); break; } const z=k.replace(/^0+/,''); if(z&&idx.has(z)){ codeCell=c; row=idx.get(z); break; } }
            if(!row) return;
            let name=''; for(const c of cells){ if(c===codeCell) continue; if(/[가-힣]|\(주\)|㈜|주식회사|co\.|ltd|inc/i.test(c) && c.length>=name.length) name=c; }
            if(!name){ for(const c of cells){ if(c===codeCell) continue; if(!/^[\d\-]+$/.test(c) && c.length>=name.length) name=c; } }
            if(name){ const inp=row.querySelector('.cm-in'); if(inp){ inp.value=name; row.classList.add('done'); row.classList.remove('todo'); filled++; } }
          });
          return filled;
        }
        body.querySelector('#autoMatch').onclick=()=>{
          const nv=smartFill(body.querySelector('#vList'), body.querySelector('#vMap').value);
          const nc=smartFill(body.querySelector('#cList'), body.querySelector('#cMap').value);
          updateSums();
          const st=body.querySelector('#matchStat'); const tot=nv+nc;
          st.innerHTML = tot? `<span style="color:var(--ok);font-weight:700">✓ ${tot}개 자동 매칭됨</span> — 확인 후 <b>저장</b>하세요` : '<span style="color:var(--warn)">매칭된 코드가 없습니다.</span> 붙여넣은 목록에 위 코드들이 포함돼 있는지 확인하세요.';
          if(tot) toast(`${tot}개 자동 매칭 — 저장하면 반영`);
        };
        /* ---- 이카운트 거래처 목록 파일(.xlsx/.csv) 일괄 불러오기 → 이름표 반영 ---- */
        // 행 배열에서 거래처코드 열·거래처명 열을 자동 인식해 {정규화코드:이름} 생성
        function vendorMapFromRows(rows){
          if(!rows || !rows.length) return {};
          const isCode = v => { const d=String(v||'').replace(/[^0-9]/g,''); return d.length>=8 && /^\d+$/.test(d); };
          // 1) 헤더 이름으로 열 찾기 — 코드·이름 헤더가 "같은 행"에 있는 행만 헤더로 인정
          //    (첫 행의 "회사명 : 주식회사…" 같은 제목 행이 이름열로 오인식되는 것 방지)
          let codeCol=-1, nameCol=-1, headerRow=-1;
          for(let r=0;r<Math.min(rows.length,6);r++){ const row=rows[r]||[]; let cc=-1, nc=-1;
            row.forEach((c,i)=>{ const t=String(c||'').replace(/\s/g,'');
              if(cc<0 && /(거래처|사업자|업체|구매처)?코드$|^코드/.test(t)) cc=i;
              if(nc<0 && !/코드/.test(t) && /(거래처명|구매처명|업체명|상호명|회사명|^거래처$|^구매처$|^상호$|^업체$)/.test(t)) nc=i; });
            if(cc>=0 && nc>=0){ codeCol=cc; nameCol=nc; headerRow=r; break; }
          }
          // 2) 헤더 못 찾으면 값 패턴으로 추정 (숫자코드 비율이 가장 높은 열 = 코드열, 그 옆 텍스트열 = 이름열)
          if(codeCol<0){ const cols=Math.max(...rows.map(r=>r.length)); let best=-1,bestFrac=0;
            for(let i=0;i<cols;i++){ let num=0,tot=0; for(const r of rows){ const v=r[i]; if(v==null||v==='')continue; tot++; if(isCode(v))num++; } const f=tot?num/tot:0; if(f>bestFrac){ bestFrac=f; best=i; } }
            if(bestFrac>0.5){ codeCol=best; } }
          if(codeCol>=0 && nameCol<0){ // 코드열 다음의 한글/텍스트 열
            const cols=Math.max(...rows.map(r=>r.length));
            for(let i=codeCol+1;i<cols;i++){ let txt=0,tot=0; for(const r of rows){ const v=r[i]; if(v==null||v==='')continue; tot++; if(/[가-힣A-Za-z]/.test(String(v))&&!isCode(v))txt++; } if(tot&&txt/tot>0.5){ nameCol=i; break; } }
          }
          if(codeCol<0 || nameCol<0) return { __err:'열 인식 실패' };
          const map={}; let cnt=0;
          for(let r=(headerRow>=0?headerRow+1:0); r<rows.length; r++){ const row=rows[r]||[];
            const code=String(row[codeCol]||'').trim(), name=String(row[nameCol]||'').trim();
            if(!isCode(code) || !name) continue;
            const k=norm(code); if(!k) continue; map[k]=name; const kz=k.replace(/^0+/,''); if(kz&&!map[kz]) map[kz]=name; cnt++;
          }
          map.__count=cnt; return map;
        }
        (function(){ const fEl=body.querySelector('#vendorFile'), btn=body.querySelector('#vendorFileBtn'), stat=body.querySelector('#vendorFileStat');
          if(!btn) return; btn.onclick=()=>fEl.click();
          fEl.onchange=async()=>{ const f=fEl.files&&fEl.files[0]; fEl.value=''; if(!f) return;
            if(!window.XlsxLite){ stat.textContent='파서를 불러오지 못했습니다.'; return; }
            stat.textContent='파일 읽는 중…';
            try{
              const { rows } = await XlsxLite.parseFile(f);
              const built = vendorMapFromRows(rows);
              if(built.__err || !built.__count){ stat.innerHTML='<span style="color:var(--danger)">거래처코드·거래처명 열을 찾지 못했습니다. 이카운트 거래처등록 엑셀을 그대로 올려주세요.</span>'; return; }
              const cnt=built.__count; delete built.__count;
              // 이름표에 병합 저장(기존 값 유지, 파일값 우선)
              const vm={ ...(cur.vendor||{}), ...built }; cur.vendor=vm;
              store(STORE.catMap).set({ vendor:vm, category:(cur.category||{}) });
              // 현재 상품에 쓰이는 거래처코드 중 몇 개가 이번에 매칭됐는지 집계
              let covered=0; (facetV||[]).forEach(it=>{ if(catMapGet(vm, it.code)) covered++; });
              const totalFacet=(facetV||[]).length;
              stat.innerHTML=`<span style="color:var(--ok);font-weight:700">✓ 거래처 ${cnt.toLocaleString()}건 이름표 반영</span> · 현재 상품 거래처코드 ${totalFacet?`${covered}/${totalFacet}개 매칭`:'매칭 확인'} — <b>저장 완료(팀 공유)</b>`;
              renderList(body.querySelector('#vList'), facetV, cur.vendor, 'vendor'); updateSums();
              toast(`거래처 ${cnt.toLocaleString()}건 반영 · 상품 코드 ${covered}개 매칭`);
            }catch(e){ stat.innerHTML=`<span style="color:var(--danger)">파일 처리 실패: ${esc(e.message||e)}</span>`; }
          };
        })();

        body.querySelector('#saveCatMap').onclick=()=>{
          const vm={ ...(cur.vendor||{}), ...parse(body.querySelector('#vMap').value), ...collect(body.querySelector('#vList')) };
          const cm={ ...(cur.category||{}), ...parse(body.querySelector('#cMap').value), ...collect(body.querySelector('#cList')) };
          store(STORE.catMap).set({vendor:vm, category:cm}); cur.vendor=vm; cur.category=cm;
          body.querySelector('#catStat').innerHTML='<span style="color:var(--ok)">✓ 저장됨 · 팀 전체 공유 · 상품 조회·발주에 자동 반영</span>';
          toast('구매처 이름표 저장 완료');
        };
        const testEl=body.querySelector('#catTest');
        testEl.oninput=async()=>{ const code=testEl.value.trim(); const o=body.querySelector('#catTestOut');
          if(!code){ o.textContent='상품코드를 입력하세요.'; return; }
          const vm={ ...((typeof window!=='undefined'&&window.VENDOR_DEFAULTS)||{}), ...(cur.vendor||{}), ...parse(body.querySelector('#vMap').value), ...collect(body.querySelector('#vList')) };
          const cm={ ...(cur.category||{}), ...parse(body.querySelector('#cMap').value), ...collect(body.querySelector('#cList')) };
          o.innerHTML=`${icon('cloud')} 조회 중…`;
          try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(code)); const d=await r.json();
            if(!root.isConnected) return;
            if(!d||!d.product){ o.textContent='미등록 상품코드입니다.'; return; }
            const p=d.product;
            const vn=catMapGet(vm,p.custCode)||p.vendor||`<span style="color:var(--danger)">이름표에 없음(거래처코드 ${esc(p.custCode||'-')})</span>`;
            const cn=catMapGet(cm,p.classCode)||p.category||'-';
            o.innerHTML=`품명 <b>${esc(p.name)}</b><br>구매처 <b>${vn}</b> · 분류 <b>${esc(cn)}</b>`;
            if(!p.custCode) o.innerHTML+=`<br><span style="color:var(--danger);font-size:12px">※ 카탈로그에 거래처코드(custCode)가 없습니다 — VPS에서 최신 sync 1회 실행이 필요합니다.</span>`;
          }catch(e){ o.textContent='조회 실패'; } };
      }

      /* ---------------- 연동 설정 ---------------- */
      function drawSettings(){
        const cfg=getCfg();
        body.innerHTML=`
          <div class="card" style="max-width:820px;margin-bottom:16px">
            <div class="card-hd">${icon('link')}<b>구글시트 발주표 연동</b>
              <button class="btn pri sm" id="copyCode" style="margin-left:auto">${icon('copy')}Apps Script 코드 복사</button></div>
            <div class="card-bd">
              <ol class="setup-guide">
                <li>백업용 <b>구글 스프레드시트</b>를 준비합니다. <span class="muted" style="font-size:12.5px">(탭·헤더 자동 생성 · 이 모듈 탭: <b>입점사발주</b>)</span></li>
                <li><span class="k">확장 프로그램</span> → <span class="k">Apps Script</span> → 편집기 내용을 지우고 위 <b>[Apps Script 코드 복사]</b> 붙여넣기 후 저장. <span class="muted" style="font-size:12.5px">(<span class="mono">SHEET_NAME</span>은 <b>비워둠</b> → 모듈별 탭에 기록)</span></li>
                <li><span class="k">배포</span> → <span class="k">새 배포</span> → <span class="k">웹 앱</span> (실행: 나 / 액세스: <span class="k">모든 사용자</span>)로 배포. <span class="muted" style="font-size:12.5px">(권한 승인 창이 뜨면 허용)</span></li>
                <li>표시된 <b>웹 앱 URL</b>(<span class="mono" style="font-size:12.5px">…/exec</span>)을 아래에 붙여넣고 <b>[저장] → [연결 테스트]</b>. <span class="muted" style="font-size:12.5px">다른 모듈과 <b>같은 URL</b> 사용 가능(탭만 달라짐).</span></li>
              </ol>
              <label class="fld" style="margin:8px 0 12px">웹 앱 URL<input type="text" id="ordUrl" value="${esc(cfg.sheetUrl)}" placeholder="https://script.google.com/macros/s/……/exec"></label>
              <div style="margin-bottom:14px">
                <label class="fld" style="margin-bottom:8px">발주 입력 시 <span class="muted" style="font-weight:500">· [저장]은 내부 시트와 구글시트에 함께 반영됩니다</span></label>
                <div style="display:flex;gap:20px;flex-wrap:wrap">
                  <label class="chk"><input type="radio" name="autoSend" value="1" ${cfg.autoSend!==false?'checked':''}> <b>추가 즉시 저장</b> (내부+시트 자동)</label>
                  <label class="chk"><input type="radio" name="autoSend" value="0" ${cfg.autoSend===false?'checked':''}> 모아서 <b>[저장]</b> 버튼으로</label>
                </div>
              </div>
              <label class="chk" style="margin-bottom:14px"><input type="checkbox" id="ordBackup" ${cfg.backup!==false?'checked':''}> 구글시트 <b>백업 사용</b> <span class="muted" style="font-weight:500">· 끄면 내부 발주 기록에만 저장(내부 시트가 안정화되면 꺼도 됩니다)</span></label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="btn pri" id="ordSave">${icon('check')}저장</button>
                <button class="btn" id="ordTest">${icon('cloud')}연결 테스트</button>
                <span class="muted" id="ordStat" style="font-size:13px"></span></div>
            </div>
          </div>
          <div class="note warn" style="max-width:820px;margin-bottom:12px"><b>Apps Script 코드가 업데이트되었습니다.</b>
            시트에 값이 일부만 들어갔다면 → 위 <b>[Apps Script 코드 복사]</b>로 다시 복사해 붙여넣고 <b>재배포(배포 관리 → 새 버전)</b> 하세요.
            이제 시트의 <b>1행 헤더 이름</b>을 읽어 열을 맞추므로, 시트 열 순서가 달라도 정확히 들어갑니다.</div>
          <div class="note" style="max-width:820px"><b>이카운트 품목 연동됨</b> · 상품코드를 입력하면 이카운트 품목(매일 00시 자동 최신화)에서 품명을 자동 조회합니다. 이카운트용 배송비는 <b>복사/CSV</b>로 내보내 붙여넣습니다.
            발주표 시트 1행 헤더에 <span class="mono" style="font-size:12px">입점사명 · 정산구분 · 상품코드(또는 자체상품코드) · 품명 · 수량 · 배송정보/비고</span> 같은 이름이 있으면 그 칸으로 채워집니다.</div>`;
        body.querySelector('#copyCode').onclick=async()=>{ try{ const r=await fetch('integrations/google-apps-script/main.gs'); if(!r.ok)throw 0; copyText(await r.text()); }catch{ toast('코드 파일을 불러오지 못했습니다'); } };
        body.querySelector('#ordSave').onclick=()=>{ cfgDB().set({ ...getCfg(), sheetUrl:body.querySelector('#ordUrl').value.trim(),
          autoSend: body.querySelector('input[name=autoSend]:checked').value==='1',
          backup: body.querySelector('#ordBackup').checked }); toast('저장했습니다'); };
        body.querySelector('#ordTest').onclick=async()=>{ const url=body.querySelector('#ordUrl').value.trim(), stat=body.querySelector('#ordStat');
          if(!url){ stat.textContent='URL을 입력하세요'; return; } stat.textContent='테스트 중…';
          try{ const res=await fetch(url+(url.includes('?')?'&':'?')+'sheet='+encodeURIComponent('입점사발주'),{method:'GET'}); let d=null; try{d=await res.json();}catch{}
            stat.innerHTML=res.ok?`<span style="color:var(--ok)">연결 성공 · 이 모듈 저장 탭 <b>"입점사발주"</b>${d&&typeof d.rows==='number'?` (${d.rows}행)`:''}</span>`:`<span style="color:var(--danger)">HTTP ${res.status}</span>`;
          }catch(err){ stat.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(err.message)}</span>`; } };
      }

      draw();
    }
  };
})();
