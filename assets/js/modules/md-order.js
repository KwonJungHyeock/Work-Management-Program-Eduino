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
  const getVendors =()=>venDB().get(DEFAULT_MD_VENDORS.map(v=>({...v})));
  const getOrders  =()=>ordDB().get([]);
  const getCfg     =()=>cfgDB().get({sheetUrl:'', autoSend:true});
  const vat=g=>{ const gross=Number(g)||0; const tax=Math.round(gross/11); return {gross,tax,supply:gross-tax}; };

  /* 발주 → 구글시트 행 매핑 (화면/백그라운드 재시도 공용) */
  function ordSheetRows(list){
    return list.map(o=>ORDER_SHEET_COLS.map(c=>({
      '일자':o.date,'구분':o.gubun,'주문경로':o.route,'주문자명':o.orderer,'입점사명':o.vendor,
      '정산구분':o.settle,'자체상품코드':o.selfCode||o.code,'품명':o.name,'수량':o.qty,
      '출고송장/입고':`배송비 ${fmtNum(o.ship)}원`,
      '발주':'O','배송정보/비고':o.shipInfo })[c] ?? ''));
  }
  /* 저장 실패로 미전송된 발주 자동 재시도 (주기적 + 재접속) — 내부는 멱등 재반영, 외부는 구글시트 */
  async function ordRetry(){
    try{
      const cfg=cfgDB().get({sheetUrl:''}); const orders=ordDB().get([]);
      const pending=orders.filter(o=>!o.synced); if(!pending.length) return;
      if(window.Records) pending.forEach(o=>Records.pushMD(o));               // 내부 발주 기록 재반영
      if(!cfg.sheetUrl || cfg.backup===false) return;                          // 외부 백업 미설정/미사용
      const opts={method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({cols:ORDER_SHEET_COLS, rows:ordSheetRows(pending)})};
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
      // 팀원은 실무(발주 입력)만 · 상품 마스터·입점사 정보·연동 설정은 관리자 전용
      const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
      // 정산구분 정규화: 옛 값 원/선 → 월정산/선결제
      const normSettle=s=>{ s=String(s||'').trim();
        if(s==='원'||s==='월'||s==='월정산') return '월정산';
        if(s==='선'||s==='선결제') return '선결제';
        return s; };
      let products=getProducts(), vendors=getVendors(), orders=getOrders(), editIdx=-1;
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
      const vendorObj=n=>vendors.find(x=>x.name===n)||null;
      const vendorShip=n=>{ const v=vendorObj(n); return v?Number(v.ship)||0:0; };
      // A~E 로 시작하는 자체상품코드 = 자사 상품 → 입점사명 '자사'
      const isJasa=c=>/^[A-E]-/i.test(String(c||'').trim());
      // 구매처명: 제품 자체 vendor > 이카운트 코드→이름표(구매처) > 자사
      const vendorName=p=>{ const v=(typeof catVendorName==='function'?catVendorName(p):((p&&p.vendor)||'')).trim();
        return v||(isJasa(p&&p.selfCode)?'자사':''); };
      const shipFor=p=>{ const o=Number(p&&p.ship); return o>0?o:vendorShip(vendorName(p)); };

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
        .lookup .pill{white-space:nowrap;background:var(--panel);font-weight:600;border-color:#b7dcc6}
        .lookup .pill b{color:var(--ink);font-weight:800;margin-left:2px}
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
          ${isAdmin?`<div class="t" data-t="catmap">이카운트 매핑</div>
          <div class="t" data-t="vendor">입점사 정보</div>
          <div class="t" data-t="settings">연동 설정</div>`:''}
        </div>
      </div>
      <div class="mbody" id="ordBody"></div>`;
      const body=root.querySelector('#ordBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=>{ if(!isAdmin && tab!=='entry') tab='entry';
        return tab==='entry'?drawEntry(): tab==='catmap'?drawCatMap(): tab==='vendor'?drawVendors(): drawSettings(); };

      /* ---------------- 발주 입력 ---------------- */
      const meName=((Auth.user&&Auth.user())||{}).name||'';
      let form={ code:'', name:'', qty:1, orderer:'', route:'', gubun:'직배', shipInfo:'', handler:meName, date:todayStr().slice(5).replace('-','/') };
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
                <label class="fld">일자<input type="text" id="fDate" value="${esc(form.date)}" placeholder="7/7"></label>
              </div>
              <label class="fld" style="margin-top:14px">배송정보/비고<textarea id="fShipInfo" rows="2" placeholder="수령인 · 연락처 · 주소 · 요청사항">${esc(form.shipInfo)}</textarea></label>
              <div style="display:flex;gap:10px;margin-top:14px">
                <button class="btn pri lg" id="addOrder">${icon('plus')}발주 목록에 추가</button>
                <span class="muted" style="align-self:center;font-size:12.5px">미등록 코드는 <b>이카운트</b>에 등록하면 매일 00시 자동 반영됩니다.</span>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <h3 style="font-size:16px">발주 목록 <span class="muted" style="font-weight:500;font-size:13.5px" id="ordCnt"></span></h3>
            <span id="sheetStat" class="muted" style="margin-left:auto;font-size:12.5px"></span>
            <button class="btn sm" id="clearOrders">${icon('trash')}비우기</button>
            <button class="btn pri" id="saveOrders">${icon('save')}저장 <span style="opacity:.75;font-weight:500;font-size:11.5px">내부+시트</span></button>
          </div>
          <div class="out-tbl" style="max-height:none;margin-bottom:22px"><table class="tbl" id="ordTable"></table></div>

          <div class="fieldset fs-green">
            <div class="fs-hd"><span class="step" style="background:#0f9d58">1</span>구글시트 미리보기 (입점사명·정산구분·품명·배송비 자동) · <b>[저장]</b>으로 함께 전송됩니다
              <span class="hint" style="display:flex;gap:6px">
                <button class="btn sm" id="sheetCopy">${icon('copy')}복사</button>
                <button class="btn sm" id="sheetCsv">${icon('download')}CSV</button></span></div>
            <div class="fs-bd"><div class="out-tbl"><table class="tbl" id="sheetTable"></table></div>
              <div class="note" style="margin-top:10px"><b>출고송장/입고</b> 칸에는 <b>배송비</b>가 먼저 들어갑니다. 이후 실제 출고 시 담당자가 이 칸을 <b>송장번호로 덮어쓰면</b> 됩니다.</div></div>
          </div>

          <div class="fieldset fs-amber">
            <div class="fs-hd"><span class="step" style="background:#b26a00">2</span>이카운트용 배송비 (입점사별 자동 산출)
              <span class="hint" style="display:flex;gap:6px">
                <button class="btn sm" id="ecCopy">${icon('copy')}복사</button>
                <button class="btn sm" id="ecCsv">${icon('download')}CSV</button></span></div>
            <div class="fs-bd"><div class="out-tbl"><table class="tbl" id="ecTable"></table></div>
              <div class="note" style="margin-top:10px">거래처(입점사)마다 <b>배송비 1줄</b>씩 생성됩니다. 단가(vat포함)를 공급가·부가세로 자동 분리(÷11)합니다.</div></div>
          </div>`;

        const $f=id=>body.querySelector(id);
        const codeEl=$f('#fCode');
        const catCache={};   // 셀메이트 카탈로그 조회 캐시 (code → product)
        async function fetchCatalog(code){ try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(code)); if(!r.ok) return null; const d=await r.json(); return (d&&d.product)||null; }catch(e){ return null; } }
        const resolveLocal=code=>prodMap()[normCode(code)]||catCache[normCode(code)];
        const nameEl=()=>$f('#fName');
        // 조회 결과에 맞춰 품명칸 동기화 — 자동 채운 값만 갱신/삭제, 사용자가 직접 입력한 값은 보존
        function syncName(p){ const el=nameEl(); if(!el) return;
          const wasAuto = el.dataset.auto && el.value===el.dataset.auto;
          if(p && p.name){ if(!el.value.trim() || wasAuto){ el.value=p.name; el.dataset.auto=p.name; form.name=p.name; } }
          else if(wasAuto){ el.value=''; el.dataset.auto=''; form.name=''; }   // 새 코드에 품명 없음/미등록 → 이전 자동값 제거
        }
        function refreshLookup(){
          const code=codeEl.value.trim(); const box=$f('#lookup');
          if(!code){ box.className='lookup'; box.textContent='상품코드를 입력하세요.'; return null; }
          const p=resolveLocal(code);
          if(!p){
            // 로컬 상품 마스터에 없으면 서버 카탈로그(셀메이트)에서 조회
            box.className='lookup'; box.innerHTML=`${icon('cloud')} 카탈로그 조회 중…`;
            fetchCatalog(code).then(prod=>{ if(codeEl.value.trim()!==code) return;
              if(prod){ catCache[normCode(code)]=prod; refreshLookup(); }
              else { syncName(null); box.className='lookup warn'; box.innerHTML=`${icon('alert')} 이카운트 미등록 코드 — <b>품명을 직접 입력</b>하면 그대로 발주에 추가됩니다.`; } });
            return null;
          }
          syncName(p);
          const sh=shipFor(p); const ven=vendorObj(vendorName(p));
          const policy=(ven&&ven.policy||'').trim();
          box.className='lookup ok';
          box.innerHTML=`<div class="lk">
            <div class="lk-top"><span class="lk-vn">${esc(vendorName(p)||'입점사 미지정')}</span>
              <span class="pill">정산 <b>${esc(p.settle||'-')}</b></span>
              <span class="pill">배송비 <b>${fmtNum(sh)}원</b></span>${policy?`<span class="pill pol">${icon('truck')}<b>${esc(policy)}</b></span>`:''}</div>
            <div class="lk-name">${p.name?esc(p.name):'<span class="muted">품명 미등록 — 직접 입력하세요</span>'}</div></div>`;
          return p;
        }
        codeEl.oninput=()=>{ form.code=codeEl.value; refreshLookup(); };
        if(nameEl()) nameEl().oninput=e=>{ form.name=e.target.value; e.target.dataset.auto=''; };  // 수동 편집 시 자동채움 잠금 해제
        ['fQty','fOrderer','fRoute','fGubun','fDate'].forEach(id=>$f('#'+id).oninput=e=>{ form[id.slice(1).toLowerCase()==='qty'?'qty':({fOrderer:'orderer',fRoute:'route',fGubun:'gubun',fDate:'date'})[id]]=e.target.value; });
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
          if(!p){ p=await fetchCatalog(code); if(p) catCache[normCode(code)]=p; }
          // 미등록 코드도 품명만 있으면 발주에 추가(이카운트에 없어도 정상 등록)
          const nameVal=($f('#fName').value||'').trim() || (p&&p.name) || '';
          if(!p && !nameVal){ toast('미등록 코드입니다 — 품명을 입력하면 추가됩니다'); refreshLookup(); const n=nameEl(); if(n) n.focus(); return; }
          const rec={ id:uuid(), date:$f('#fDate').value.trim()||form.date, gubun:$f('#fGubun').value.trim(),
            route:$f('#fRoute').value.trim(), orderer:$f('#fOrderer').value.trim(), handler:$f('#fHandler').value.trim(),
            vendor:p?vendorName(p):(isJasa(code)?'자사':'미지정'), settle:p?(p.settle||''):'', selfCode:(p&&(p.selfCode||p.code))||normCode(code), code:(p&&p.code)||'', name:nameVal,
            qty:Number($f('#fQty').value)||1, ship:p?shipFor(p):0, shipInfo:$f('#fShipInfo').value.trim(), synced:false, unregistered:!p };
          orders.push(rec); saveOrders();
          // 코드/품명/주문자/배송정보만 비우고 구분·경로·일자 유지
          form.code=''; form.name=''; codeEl.value=''; { const n=nameEl(); if(n){ n.value=''; n.dataset.auto=''; } }
          $f('#fOrderer').value=''; $f('#fShipInfo').value=''; $f('#fQty').value=1;
          refreshLookup(); renderAll(); codeEl.focus();
          // 자동 저장이면 추가 즉시 내부+시트 동시 저장, 아니면 [저장] 대기
          if(getCfg().autoSend){ commit([rec]).then(r=>{ renderAll();
            toast(r.internalOnly?'저장됨 (내부 시트)':(r.ok?(r.unconfirmed?SHEET_MSG.unconf(1):SHEET_MSG.ok(1)):SHEET_MSG.fail(r.error))); }); }
          else toast('발주 목록에 추가 · [저장]으로 반영');
        }
        $f('#addOrder').onclick=addOrder;
        body.querySelector('.card-bd').addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.id==='fCode'){ e.preventDefault(); addOrder(); }});
        $f('#clearOrders').onclick=()=>{ if(orders.length&&confirm('발주 목록을 모두 비울까요?')){ orders=[]; saveOrders(); renderAll(); } };
        const rowsTSV=rows=>rows.map(r=>r.join('\t')).join('\n');
        $f('#sheetCopy').onclick=()=>{ const {rows}=sheetData(); if(!rows.length){ toast('발주 목록이 비어 있습니다'); return; } copyText(rowsTSV(rows)); }; // 헤더 없이 데이터 행만
        $f('#sheetCsv').onclick=()=>{ const {cols,rows}=sheetData(); downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`발주_구글시트_${todayStr()}.csv`); toast('CSV 저장'); };
        $f('#saveOrders').onclick=onSave;
        $f('#ecCopy').onclick=()=>{ const {rows}=ecData(); if(!rows.length){ toast('발주 목록이 비어 있습니다'); return; } copyText(rowsTSV(rows)); }; // 헤더 없이
        $f('#ecCsv').onclick=()=>{ const {cols,rows}=ecData(); downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`발주_이카운트배송비_${todayStr()}.csv`); toast('CSV 저장'); };
        refreshLookup(); renderAll(); codeEl.focus();
      }

      // 출고송장/입고 칸: 발주 시 배송비를 먼저 채우고(담당자가 나중에 송장번호로 덮어씀)
      const sheetRowsFor=(list)=>ordSheetRows(list);
      function sheetData(){ return { cols:ORDER_SHEET_COLS, rows:sheetRowsFor(orders) }; }
      async function sendOrders(list){
        const cfg=getCfg(); if(!cfg.sheetUrl) return {ok:false,error:'시트 URL 미설정'};
        const targets=list.filter(o=>!o.synced); if(!targets.length) return {ok:true,sent:0};
        const opts={method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
          body:JSON.stringify({cols:ORDER_SHEET_COLS, rows:sheetRowsFor(targets)})};
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
      function ecData(){
        const byV={}; orders.forEach(o=>{ if(!byV[o.vendor]) byV[o.vendor]=vendorShip(o.vendor); });
        const cols=['거래처','품목코드','품목명','수량','단가(vat포함)','공급가','부가세'];
        const rows=Object.entries(byV).map(([v,ship])=>{ const s=vat(ship); return [v,'00001','배송비',1,ship,s.supply,s.tax]; });
        return { cols, rows };
      }
      function renderAll(){ renderOrders(); renderSheet(); renderEc(); }
      function renderOrders(){
        const t=body.querySelector('#ordTable'), cnt=body.querySelector('#ordCnt'); if(!t) return;
        if(cnt) cnt.textContent=`· ${orders.length}건`;
        t.innerHTML=`<thead><tr><th>일자</th><th>구분</th><th>담당자</th><th>주문자</th><th>입점사</th><th>정산</th><th>자체상품코드</th><th>품명</th>
          <th class="num">수량</th><th class="num">배송비</th><th style="width:78px">시트</th><th style="width:92px"></th></tr></thead><tbody></tbody>`;
        const tb=t.querySelector('tbody');
        if(!orders.length){ tb.innerHTML=`<tr><td colspan="12" class="muted" style="text-align:center;padding:18px">상품코드를 입력해 발주를 추가하세요.</td></tr>`; return; }
        orders.forEach((o,i)=>{ const tr=el('tr');
          if(i===editIdx){
            tr.innerHTML=`<td><input type="text" class="oe" data-k="date" value="${esc(o.date)}" placeholder="7/7" style="width:64px"></td>
              <td><input class="oe" data-k="gubun" value="${esc(o.gubun||'')}" style="width:64px"></td>
              <td><input class="oe" data-k="handler" value="${esc(o.handler||'')}" style="width:80px"></td>
              <td><input class="oe" data-k="orderer" value="${esc(o.orderer||'')}" style="width:88px"></td>
              <td>${o.vendor==='자사'?'<span class="vbadge jasa">자사</span>':'<b>'+esc(o.vendor||'-')+'</b>'}</td>
              <td>${esc(o.settle)}</td><td class="mono">${esc(o.selfCode||o.code)}</td>
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
            tr.querySelector('[data-a=odel]').onclick=()=>{ orders.splice(i,1); if(editIdx===i)editIdx=-1; saveOrders(); renderAll(); };
          }
          tb.appendChild(tr); });
      }
      function fillTable(id,{cols,rows}){ const t=body.querySelector(id); if(!t) return;
        t.innerHTML=`<thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.length?rows.map(r=>`<tr>${r.map((c,ci)=>`<td class="${ci>=cols.length-3&&typeof c==='number'?'num mono':''}">${esc(c)}</td>`).join('')}</tr>`).join('')
            :`<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:14px">발주 목록이 비어 있습니다.</td></tr>`}</tbody>`; }
      const renderSheet=()=>fillTable('#sheetTable',sheetData());
      const renderEc=()=>fillTable('#ecTable',ecData());

      /* 저장 = 내부 시트(Records) + 외부 구글시트 동시 반영 */
      async function commit(list){
        const pending=list.filter(o=>!o.synced); if(!pending.length) return {ok:true, sent:0, none:true};
        if(window.Records) pending.forEach(o=>Records.pushMD(o));      // 내부 발주 기록에 즉시 반영
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
          <input type="file" id="venFile" accept=".csv,text/csv" class="hidden">
          <div class="card">
            <div class="card-hd">${icon('truck')}<b>입점사 정보</b> <span class="muted" style="font-size:12.5px">· 배송비(vat포함)·무료배송조건·담당자</span>
              <span class="badge soon" id="vDirty" style="display:${dirtyVendor?'':'none'}">● 저장 안 됨</span>
              <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn sm" id="addVen">${icon('plus')}행 추가</button>
                <button class="btn sm" id="impVenFile">${icon('upload')}CSV 불러오기</button>
                <button class="btn sm" id="impVenPaste">${icon('clipboard')}붙여넣기</button>
                <button class="btn sm" id="expVen">${icon('download')}CSV 내보내기</button>
                <button class="btn sm pri" id="saveVen">${icon('save')}저장</button></span></div>
            <div class="card-bd" style="padding:0"><div class="ven-tbl"><table class="tbl" id="venTable"></table></div></div>
          </div>
          <div class="note" style="margin-top:12px">배송비는 <b>입점사별 고정 금액</b>(vat포함)이 기본이며 공급가·부가세는 ÷11로 자동 분리됩니다.
            <b>무료배송조건</b>은 발주 입력 시 자동 조회에 함께 표시됩니다. 회사 배송정보 리스트(<span class="mono" style="font-size:12px">data/입점사_배송정보.csv</span>)를 <b>CSV 불러오기</b>로 한 번에 등록하세요.
            헤더(입점사명/업체명·정산구분·배송비·무료배송조건/배송조건·담당자·연락처·발주메일·특이사항)를 자동 인식합니다. 수정 후 <b>저장</b>.</div>
          <div id="venPasteBox" class="hidden" style="margin-top:14px"></div>`;
        renderVen();
        body.querySelector('#saveVen').onclick=()=>{ saveVendors(); dirtyVendor=false; body.querySelector('#vDirty').style.display='none'; toast('저장되었습니다'); };
        body.querySelector('#addVen').onclick=()=>{ vendors.unshift({name:'',ship:3000,policy:'',manager:'',contact:'',email:'',note:''}); markVendorDirty(); renderVen(); };
        body.querySelector('#expVen').onclick=()=>{ const cols=['입점사명','정산구분','배송비','무료배송조건','담당자','연락처','발주메일','특이사항'];
          const rows=vendors.map(v=>[v.name,v.settle||'',v.ship||'',v.policy||'',v.manager||'',v.contact||'',v.email||'',v.note||'']);
          downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`입점사정보_${todayStr()}.csv`); toast('CSV 저장'); };
        const vf=body.querySelector('#venFile');
        body.querySelector('#impVenFile').onclick=()=>vf.click();
        vf.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(!f)return; const rd=new FileReader(); rd.onload=()=>importVendors(parseTable(rd.result)); rd.readAsText(f,'utf-8'); };
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
      function importVendors(rows){
        if(!rows.length){ toast('불러올 데이터가 없습니다'); return; }
        const norm=s=>String(s||'').replace(/\s/g,'').toLowerCase();
        const idxOf=(names)=>{ const h=rows[0].map(norm); for(const n of names){ const i=h.indexOf(norm(n)); if(i>=0) return i; } return -1; };
        const ci={ name:idxOf(['입점사명','입점사','업체명','거래처','거래처명']),
          settle:idxOf(['정산구분','정산']), ship:idxOf(['배송비']),
          policy:idxOf(['무료배송조건','배송조건','배송비정책','무료배송기준']),
          manager:idxOf(['담당자','담당자명','담당']), contact:idxOf(['연락처','전화','전화번호','연락처1']),
          email:idxOf(['발주메일','발주 메일','이메일','메일','발주이메일']), note:idxOf(['특이사항','비고','메모']) };
        const hasHeader = ci.name>=0 || ci.ship>=0 || ci.policy>=0;
        const dataRows = hasHeader ? rows.slice(1) : rows;
        const g=(r,i)=> i>=0&&i<r.length ? String(r[i]).trim() : '';
        const nameIdx = ci.name>=0 ? ci.name : 0;
        let added=0, updated=0;
        dataRows.forEach(r=>{ if(!r.join('').trim()) return;
          const name=g(r,nameIdx); if(!name) return;
          const policy=g(r,ci.policy);
          let ship=g(r,ci.ship).replace(/[^\d]/g,'');
          ship = ship!=='' ? Number(ship) : (parseShipFromPolicy(policy) ?? 0);
          const rec={ name, settle:normSettle(g(r,ci.settle)), ship, policy,
            manager:g(r,ci.manager), contact:g(r,ci.contact), email:g(r,ci.email), note:g(r,ci.note) };
          const ex=vendors.find(v=>v.name===name);
          if(ex){ Object.assign(ex,rec); updated++; } else { vendors.push(rec); added++; } });
        markVendorDirty(); renderVen();
        toast(`불러오기 완료 · 신규 ${added} / 갱신 ${updated}건 · [저장]을 눌러 반영`);
      }
      function renderVen(){
        const t=body.querySelector('#venTable'); if(!t) return;
        t.innerHTML=`<thead><tr><th style="min-width:140px">입점사명</th><th style="width:78px">정산</th>
          <th class="num" style="width:112px">배송비(vat포함)</th><th class="num" style="width:88px">공급가</th><th class="num" style="width:72px">부가세</th>
          <th style="min-width:180px">무료배송조건</th><th style="min-width:110px">담당자</th><th style="min-width:150px">연락처</th>
          <th style="min-width:180px">발주메일</th><th style="min-width:120px">특이사항</th><th style="width:34px"></th></tr></thead><tbody></tbody>`;
        const tb=t.querySelector('tbody');
        if(!vendors.length){ tb.innerHTML=`<tr><td colspan="11" class="muted" style="text-align:center;padding:16px">입점사가 없습니다. “행 추가” 또는 CSV 불러오기.</td></tr>`; return; }
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
        const toText=m=>Object.entries(m||{}).map(([k,val])=>k+'\t'+val).join('\n');
        const parse=txt=>{ const out={}; String(txt||'').replace(/\r/g,'').split('\n').forEach(line=>{
          if(!line.trim()) return; const sep=line.includes('\t')?'\t':','; const i=line.indexOf(sep);
          const code=(i>=0?line.slice(0,i):line).trim(), name=(i>=0?line.slice(i+1):'').trim();
          const k=catCodeNorm(code); if(!k||!name) return; out[k]=name; const kz=k.replace(/^0+/,''); if(kz&&!out[kz]) out[kz]=name; }); return out; };
        body.innerHTML=`
          <div class="note" style="max-width:920px;margin-bottom:14px"><b>이카운트는 구매처명·상품분류를 API로 제공하지 않습니다.</b>
            여기에 <b>코드↔이름표</b>를 한 번 넣어두면, 상품 조회·발주에서 자동으로 이름이 표시됩니다(품명·단가는 API로 매일 자동).
            이카운트에서 <b>거래처</b>·<b>품목분류</b>를 엑셀로 열어 <b>두 열(코드·이름)</b>을 복사해 붙여넣으세요. 저장하면 <b>팀 전체에 공유</b>됩니다. 헤더 줄은 자동 무시됩니다.</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="card"><div class="card-hd">${icon('truck')}<b>구매처(거래처) 이름표</b><span id="vCnt" class="muted" style="margin-left:auto;font-size:12.5px">${Object.keys(cur.vendor||{}).length}건</span></div>
              <div class="card-bd"><div class="muted" style="font-size:12.5px;margin-bottom:6px">한 줄에 <b>사업자번호(또는 거래처코드)</b> · <b>거래처명</b></div>
                <textarea id="vMap" rows="14" placeholder="1078841033	(주)로보로보&#10;8598800910	(주)컴스마트">${esc(toText(cur.vendor))}</textarea></div></div>
            <div class="card"><div class="card-hd">${icon('grid')}<b>상품분류 이름표</b><span id="cCnt" class="muted" style="margin-left:auto;font-size:12.5px">${Object.keys(cur.category||{}).length}건</span></div>
              <div class="card-bd"><div class="muted" style="font-size:12.5px;margin-bottom:6px">한 줄에 <b>분류코드</b> · <b>분류명</b></div>
                <textarea id="cMap" rows="14" placeholder="00006	유아&#10;00010	교구">${esc(toText(cur.category))}</textarea></div></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px">
            <button class="btn pri" id="saveCatMap">${icon('save')}저장 (팀 공유)</button>
            <span class="muted" id="catStat" style="font-size:12.5px"></span></div>
          <div class="card" style="margin-top:16px;max-width:560px"><div class="card-hd">${icon('search')}<b>테스트</b> <span class="muted" style="font-size:12px">· 저장 전 미리 확인</span></div>
            <div class="card-bd"><label class="fld">상품코드로 구매처명 확인<input type="text" id="catTest" placeholder="예: P-DA39" autocomplete="off"></label>
              <div id="catTestOut" class="muted" style="margin-top:8px;font-size:13px">상품코드를 입력하세요.</div></div></div>`;
        body.querySelector('#saveCatMap').onclick=()=>{
          const vm=parse(body.querySelector('#vMap').value), cm=parse(body.querySelector('#cMap').value);
          store(STORE.catMap).set({vendor:vm, category:cm});
          body.querySelector('#vCnt').textContent=Object.keys(vm).length+'건';
          body.querySelector('#cCnt').textContent=Object.keys(cm).length+'건';
          body.querySelector('#catStat').innerHTML='<span style="color:var(--ok)">저장됨 · 팀 전체에 공유됩니다</span>';
          toast('이름표 저장 — 상품 조회·발주에 자동 반영');
        };
        const testEl=body.querySelector('#catTest');
        testEl.oninput=async()=>{ const code=testEl.value.trim(); const o=body.querySelector('#catTestOut');
          if(!code){ o.textContent='상품코드를 입력하세요.'; return; }
          const vm=parse(body.querySelector('#vMap').value), cm=parse(body.querySelector('#cMap').value);
          o.innerHTML=`${icon('cloud')} 조회 중…`;
          try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(code)); const d=await r.json();
            if(!root.isConnected) return;
            if(!d||!d.product){ o.textContent='미등록 상품코드입니다.'; return; }
            const p=d.product;
            const vn=p.vendor||catMapGet(vm,p.custCode)||`<span style="color:var(--danger)">이름표에 없음(거래처코드 ${esc(p.custCode||'-')})</span>`;
            const cn=p.category||catMapGet(cm,p.classCode)||'-';
            o.innerHTML=`품명 <b>${esc(p.name)}</b><br>구매처 <b>${vn}</b> · 분류 <b>${esc(cn)}</b>`;
            if(!p.custCode) o.innerHTML+=`<br><span style="color:var(--danger);font-size:12px">※ 카탈로그에 거래처코드가 없습니다 — VPS에서 최신 sync 1회 실행 필요</span>`;
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
                <li>발주표 <b>구글 시트</b>를 엽니다. <span class="muted" style="font-size:12.5px">(1행 헤더: 일자·구분·주문경로·주문자명·입점사명·정산구분·자체상품코드·품명·수량·출고송장/입고·발주·배송정보/비고)</span></li>
                <li><span class="k">확장 프로그램</span> → <span class="k">Apps Script</span> → 편집기 내용을 지우고 위 <b>[Apps Script 코드 복사]</b> 붙여넣기 후 저장.</li>
                <li>코드 상단 <span class="mono" style="font-size:12px">SHEET_NAME</span> 을 기록할 <b>탭 이름</b>으로 맞춥니다. <span class="muted" style="font-size:12.5px">(실제 발주표 탭 이름)</span></li>
                <li><span class="k">배포</span> → <span class="k">새 배포</span> → <span class="k">웹 앱</span> (실행: 나 / 액세스: <span class="k">모든 사용자</span>)로 배포. <span class="muted" style="font-size:12.5px">(권한 승인 창이 뜨면 허용)</span></li>
                <li>표시된 <b>웹 앱 URL</b>(<span class="mono" style="font-size:12.5px">…/exec</span>)을 아래에 붙여넣고 <b>[저장] → [연결 테스트]</b>.</li>
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
        body.querySelector('#copyCode').onclick=async()=>{ try{ const r=await fetch('google-apps-script-orders.gs'); if(!r.ok)throw 0; copyText(await r.text()); }catch{ toast('코드 파일을 불러오지 못했습니다'); } };
        body.querySelector('#ordSave').onclick=()=>{ cfgDB().set({ ...getCfg(), sheetUrl:body.querySelector('#ordUrl').value.trim(),
          autoSend: body.querySelector('input[name=autoSend]:checked').value==='1',
          backup: body.querySelector('#ordBackup').checked }); toast('저장했습니다'); };
        body.querySelector('#ordTest').onclick=async()=>{ const url=body.querySelector('#ordUrl').value.trim(), stat=body.querySelector('#ordStat');
          if(!url){ stat.textContent='URL을 입력하세요'; return; } stat.textContent='테스트 중…';
          try{ const res=await fetch(url,{method:'GET'}); let d=null; try{d=await res.json();}catch{}
            stat.innerHTML=res.ok?`<span style="color:var(--ok)">연결 성공${d&&d.sheet?` · 시트 "${esc(d.sheet)}"`:''}</span>`:`<span style="color:var(--danger)">HTTP ${res.status}</span>`;
          }catch(err){ stat.innerHTML=`<span style="color:var(--danger)">연결 실패: ${esc(err.message)}</span>`; } };
      }

      draw();
    }
  };
})();
