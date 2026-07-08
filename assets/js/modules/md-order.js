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
      // 정산구분 정규화: 옛 값 원/선 → 월정산/선결제
      const normSettle=s=>{ s=String(s||'').trim();
        if(s==='원'||s==='월'||s==='월정산') return '월정산';
        if(s==='선'||s==='선결제') return '선결제';
        return s; };
      let products=getProducts(), vendors=getVendors(), orders=getOrders();
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
      // 자체상품코드(selfCode)가 기준 · 카페24 상품코드(code)로도 찾히게 보조 매핑
      const prodMap=()=>{ const m={}; products.forEach(p=>{ const s=(p.selfCode||'').trim(), c=(p.code||'').trim();
        if(s) m[s]=p; if(c && !m[c]) m[c]=p; }); return m; };
      const vendorObj=n=>vendors.find(x=>x.name===n)||null;
      const vendorShip=n=>{ const v=vendorObj(n); return v?Number(v.ship)||0:0; };
      // A~E 로 시작하는 자체상품코드 = 자사 상품 → 입점사명 '자사'
      const isJasa=c=>/^[A-E]-/i.test(String(c||'').trim());
      const vendorName=p=>((p&&p.vendor||'').trim())||(isJasa(p&&p.selfCode)?'자사':'');
      const shipFor=p=>{ const o=Number(p&&p.ship); return o>0?o:vendorShip(vendorName(p)); };

      root.innerHTML=`
      <style>
        .code-in{font-size:20px;font-weight:800;font-family:var(--mono);height:54px;letter-spacing:.03em;border-width:2px}
        .code-in:focus{border-color:var(--red);box-shadow:0 0 0 4px var(--red-soft)}
        /* 자동 조회 */
        .lookup{display:flex;align-items:center;padding:13px 16px;border-radius:11px;border:1.5px solid var(--line);background:var(--panel-2);min-height:66px;font-size:14px;transition:.14s}
        .lookup.ok{border-color:#8fd3ab;background:linear-gradient(0deg,var(--ok-bg),#f4fbf6)}
        .lookup.bad{border-color:#eecac6;background:#fdeef0;color:var(--danger);font-weight:600}
        .lk{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0}
        .lk-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .lk-vn{font-weight:800;font-size:18px;color:var(--ink);white-space:nowrap;letter-spacing:-.01em}
        .lk-name{font-size:13.5px;line-height:1.45;color:var(--ink-2);font-weight:600}
        .lookup .pill{white-space:nowrap;background:#fff;font-weight:600;border-color:#b7dcc6}
        .lookup .pill b{color:var(--ink);font-weight:800;margin-left:2px}
        .lookup .pill.pol{background:#fff7e8;border-color:#f0d08a;color:#8a5a00;display:inline-flex;align-items:center;gap:4px;max-width:100%}
        .lookup .pill.pol b{color:#7a4f00;white-space:normal}
        .lookup .pill.pol svg{width:13px;height:13px;flex:0 0 auto}
        /* 입점사 정보 표 */
        .ven-tbl{overflow:auto;border:1px solid var(--line);border-radius:9px;box-shadow:var(--sh-sm);max-height:560px}
        .ven-tbl table.tbl th{background:#eef1f5;position:sticky;top:0;z-index:1}
        .ven-tbl table.tbl tbody tr:nth-child(even){background:var(--zebra)}
        .ven-tbl input{min-width:0}
        /* 표 */
        .out-tbl{overflow:auto;max-height:320px;border:1px solid var(--line);border-radius:9px;box-shadow:var(--sh-sm)}
        .out-tbl table.tbl th{background:#eef1f5}
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
          <div class="t" data-t="master">상품 마스터</div>
          <div class="t" data-t="vendor">입점사 정보</div>
          <div class="t" data-t="settings">연동 설정</div>
        </div>
      </div>
      <div class="mbody" id="ordBody"></div>`;
      const body=root.querySelector('#ordBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=> tab==='entry'?drawEntry(): tab==='master'?drawMaster(): tab==='vendor'?drawVendors(): drawSettings();

      /* ---------------- 발주 입력 ---------------- */
      let form={ code:'', qty:1, orderer:'', route:'', gubun:'직배', shipInfo:'', date:todayStr().slice(5).replace('-','/') };
      function drawEntry(){
        body.innerHTML=`
          <div class="card" style="margin-bottom:18px">
            <div class="card-hd">${icon('search')}<b>상품코드로 빠른 발주</b>
              <span class="muted" style="margin-left:auto;font-size:12.5px">코드 입력 후 <b>Enter</b> → 목록에 추가</span></div>
            <div class="card-bd">
              <div style="display:grid;grid-template-columns:minmax(200px,1fr) minmax(260px,1.3fr);gap:16px;align-items:stretch">
                <label class="fld">자체상품코드
                  <input class="code-in" id="fCode" list="codeList" value="${esc(form.code)}" placeholder="예: ED-1004" autocomplete="off">
                  <datalist id="codeList">${products.map(p=>`<option value="${esc(p.selfCode||p.code)}">${esc(p.vendor)} · ${esc(p.name).slice(0,30)}`).join('')}</datalist></label>
                <div><div class="mini" style="margin-bottom:6px">자동 조회</div><div class="lookup" id="lookup">상품코드를 입력하세요.</div></div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin-top:16px">
                <label class="fld">수량<input type="number" id="fQty" value="${form.qty}" min="1"></label>
                <label class="fld">주문자명<input type="text" id="fOrderer" value="${esc(form.orderer)}"></label>
                <label class="fld">주문경로<input type="text" id="fRoute" value="${esc(form.route)}" placeholder="예: 스팸"></label>
                <label class="fld">구분<input type="text" id="fGubun" value="${esc(form.gubun)}" placeholder="예: 직배"></label>
                <label class="fld">일자<input type="text" id="fDate" value="${esc(form.date)}" placeholder="7/7"></label>
              </div>
              <label class="fld" style="margin-top:14px">배송정보/비고<textarea id="fShipInfo" rows="2" placeholder="수령인 · 연락처 · 주소 · 요청사항">${esc(form.shipInfo)}</textarea></label>
              <div style="display:flex;gap:10px;margin-top:14px">
                <button class="btn pri lg" id="addOrder">${icon('plus')}발주 목록에 추가</button>
                <span class="muted" style="align-self:center;font-size:12.5px">미등록 코드는 <b>상품 마스터</b> 탭에서 추가하세요.</span>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <h3 style="font-size:16px">발주 목록 <span class="muted" style="font-weight:500;font-size:13.5px" id="ordCnt"></span></h3>
            <button class="btn sm" id="clearOrders" style="margin-left:auto">${icon('trash')}전체 비우기</button>
          </div>
          <div class="out-tbl" style="max-height:none;margin-bottom:22px"><table class="tbl" id="ordTable"></table></div>

          <div class="fieldset fs-green">
            <div class="fs-hd"><span class="step" style="background:#0f9d58">1</span>구글시트용 (입점사명·정산구분·품명·배송비 자동)
              <span class="hint" style="display:flex;gap:6px">
                <button class="btn sm" id="sheetCopy">${icon('copy')}복사</button>
                <button class="btn sm" id="sheetCsv">${icon('download')}CSV</button>
                <button class="btn sm pri" id="sheetSend">${icon('cloudUp')}시트로 전송</button></span></div>
            <div class="fs-bd"><div class="out-tbl"><table class="tbl" id="sheetTable"></table></div>
              <div class="note" style="margin-top:10px"><b>출고송장/입고</b> 칸에는 <b>배송비</b>가 먼저 들어갑니다. 이후 실제 출고 시 담당자가 이 칸을 <b>송장번호로 덮어쓰면</b> 됩니다.</div>
              <div class="muted" id="sheetStat" style="font-size:12.5px;margin-top:8px"></div></div>
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
        function refreshLookup(){
          const code=codeEl.value.trim(); const p=prodMap()[code]; const box=$f('#lookup');
          if(!code){ box.className='lookup'; box.textContent='상품코드를 입력하세요.'; return null; }
          if(!p){ box.className='lookup bad'; box.innerHTML=`${icon('alert')} 미등록 상품코드입니다. ‘상품 마스터’에서 추가하세요.`; return null; }
          const sh=shipFor(p); const ven=vendorObj(vendorName(p));
          const policy=(ven&&ven.policy||'').trim();
          box.className='lookup ok';
          box.innerHTML=`<div class="lk">
            <div class="lk-top"><span class="lk-vn">${esc(vendorName(p)||'입점사 미지정')}</span>
              <span class="pill">정산 <b>${esc(p.settle)}</b></span>
              <span class="pill">배송비 <b>${fmtNum(sh)}원</b></span>${policy?`<span class="pill pol">${icon('truck')}<b>${esc(policy)}</b></span>`:''}</div>
            <div class="lk-name">${esc(p.name)}</div></div>`;
          return p;
        }
        codeEl.oninput=()=>{ form.code=codeEl.value; refreshLookup(); };
        ['fQty','fOrderer','fRoute','fGubun','fDate'].forEach(id=>$f('#'+id).oninput=e=>{ form[id.slice(1).toLowerCase()==='qty'?'qty':({fOrderer:'orderer',fRoute:'route',fGubun:'gubun',fDate:'date'})[id]]=e.target.value; });
        $f('#fShipInfo').oninput=e=>form.shipInfo=e.target.value;
        function addOrder(){
          const code=codeEl.value.trim(); const p=prodMap()[code];
          if(!p){ toast('미등록 상품코드입니다'); refreshLookup(); codeEl.focus(); return; }
          const rec={ id:uuid(), date:$f('#fDate').value.trim()||form.date, gubun:$f('#fGubun').value.trim(),
            route:$f('#fRoute').value.trim(), orderer:$f('#fOrderer').value.trim(),
            vendor:vendorName(p), settle:p.settle, selfCode:p.selfCode||p.code, code:p.code, name:p.name,
            qty:Number($f('#fQty').value)||1, ship:shipFor(p), shipInfo:$f('#fShipInfo').value.trim(), synced:false };
          orders.push(rec); saveOrders();
          // 코드/주문자/배송정보만 비우고 구분·경로·일자 유지
          form.code=''; codeEl.value=''; $f('#fOrderer').value=''; $f('#fShipInfo').value=''; $f('#fQty').value=1;
          refreshLookup(); renderAll(); codeEl.focus();
          const cfg=getCfg();
          if(cfg.autoSend && cfg.sheetUrl){ toast('추가 · '+SHEET_MSG.sending);
            sendOrders([rec]).then(r=>{ renderAll(); toast(r.ok?(r.unconfirmed?SHEET_MSG.unconf(1):SHEET_MSG.ok(1)):SHEET_MSG.fail(r.error)); });
          } else toast(cfg.sheetUrl?'발주 목록에 추가 (수동 전송 대기)':'발주 목록에 추가');
        }
        $f('#addOrder').onclick=addOrder;
        body.querySelector('.card-bd').addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.id==='fCode'){ e.preventDefault(); addOrder(); }});
        $f('#clearOrders').onclick=()=>{ if(orders.length&&confirm('발주 목록을 모두 비울까요?')){ orders=[]; saveOrders(); renderAll(); } };
        const rowsTSV=rows=>rows.map(r=>r.join('\t')).join('\n');
        $f('#sheetCopy').onclick=()=>{ const {rows}=sheetData(); if(!rows.length){ toast('발주 목록이 비어 있습니다'); return; } copyText(rowsTSV(rows)); }; // 헤더 없이 데이터 행만
        $f('#sheetCsv').onclick=()=>{ const {cols,rows}=sheetData(); downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`발주_구글시트_${todayStr()}.csv`); toast('CSV 저장'); };
        $f('#sheetSend').onclick=sendToSheet;
        $f('#ecCopy').onclick=()=>{ const {rows}=ecData(); if(!rows.length){ toast('발주 목록이 비어 있습니다'); return; } copyText(rowsTSV(rows)); }; // 헤더 없이
        $f('#ecCsv').onclick=()=>{ const {cols,rows}=ecData(); downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`발주_이카운트배송비_${todayStr()}.csv`); toast('CSV 저장'); };
        refreshLookup(); renderAll(); codeEl.focus();
      }

      function sheetRowsFor(list){
        // 출고송장/입고 칸: 발주 시 배송비를 먼저 채우고(담당자가 나중에 송장번호로 덮어씀)
        return list.map(o=>ORDER_SHEET_COLS.map(c=>({
          '일자':o.date,'구분':o.gubun,'주문경로':o.route,'주문자명':o.orderer,'입점사명':o.vendor,
          '정산구분':o.settle,'자체상품코드':o.selfCode||o.code,'품명':o.name,'수량':o.qty,
          '출고송장/입고':`배송비 ${fmtNum(o.ship)}원`,
          '발주':'O','배송정보/비고':o.shipInfo })[c] ?? ''));
      }
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
        t.innerHTML=`<thead><tr><th>일자</th><th>구분</th><th>주문자</th><th>입점사</th><th>정산</th><th>자체상품코드</th><th>품명</th>
          <th class="num">수량</th><th class="num">배송비</th><th style="width:78px">시트</th><th style="width:34px"></th></tr></thead><tbody></tbody>`;
        const tb=t.querySelector('tbody');
        if(!orders.length){ tb.innerHTML=`<tr><td colspan="11" class="muted" style="text-align:center;padding:18px">상품코드를 입력해 발주를 추가하세요.</td></tr>`; return; }
        orders.forEach((o,i)=>{ const tr=el('tr');
          tr.innerHTML=`<td>${esc(o.date)}</td><td>${esc(o.gubun)}</td><td>${esc(o.orderer||'-')}</td>
            <td>${o.vendor==='자사'?'<span class="vbadge jasa">자사</span>':'<b>'+esc(o.vendor||'-')+'</b>'}</td><td>${esc(o.settle)}</td><td class="mono">${esc(o.selfCode||o.code)}</td>
            <td style="max-width:360px">${esc(o.name)}</td><td class="num">${o.qty}</td><td class="num">${fmtNum(o.ship)}</td>
            <td>${o.synced?`<span class="badge live">${SHEET_MSG.badgeDone}</span>`:`<span class="badge soon">${SHEET_MSG.badgePending}</span>`}</td>
            <td><button class="btn ghost sm">${icon('x')}</button></td>`;
          tr.querySelector('button').onclick=()=>{ orders.splice(i,1); saveOrders(); renderAll(); };
          tb.appendChild(tr); });
      }
      function fillTable(id,{cols,rows}){ const t=body.querySelector(id); if(!t) return;
        t.innerHTML=`<thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.length?rows.map(r=>`<tr>${r.map((c,ci)=>`<td class="${ci>=cols.length-3&&typeof c==='number'?'num mono':''}">${esc(c)}</td>`).join('')}</tr>`).join('')
            :`<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:14px">발주 목록이 비어 있습니다.</td></tr>`}</tbody>`; }
      const renderSheet=()=>fillTable('#sheetTable',sheetData());
      const renderEc=()=>fillTable('#ecTable',ecData());

      async function sendToSheet(){
        const cfg=getCfg(), stat=body.querySelector('#sheetStat');
        if(!cfg.sheetUrl){ stat.innerHTML=`<span style="color:var(--danger)">${SHEET_MSG.noUrl}.</span>`; return; }
        const pending=orders.filter(o=>!o.synced);
        if(!pending.length){ stat.innerHTML=`<span style="color:var(--ok)">${SHEET_MSG.allSent}.</span>`; return; }
        stat.textContent=`${SHEET_MSG.sending} (${pending.length}건)`;
        const r=await sendOrders(pending); renderAll();
        stat.innerHTML = r.ok
          ? (r.unconfirmed ? `<span style="color:var(--ok)">${esc(SHEET_MSG.unconf(r.sent))}</span>`
                           : `<span style="color:var(--ok)">${esc(SHEET_MSG.ok(r.sent))}</span>`)
          : `<span style="color:var(--danger)">${esc(SHEET_MSG.fail(r.error))} (복사/CSV로 대체 가능)</span>`;
        if(r.ok) toast(r.unconfirmed?SHEET_MSG.unconf(r.sent):SHEET_MSG.ok(r.sent));
      }

      /* ---------------- 상품 마스터 ---------------- */
      function drawMaster(){
        body.innerHTML=`
          <input type="file" id="csvFile" accept=".csv,text/csv" class="hidden">
          <div class="card">
            <div class="card-hd">${icon('grid')}<b>상품 마스터</b>
              <span class="badge soon" id="mDirty" style="display:${dirtyMaster?'':'none'}">● 저장 안 됨</span>
              <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn sm" id="addProd">${icon('plus')}행 추가</button>
                <button class="btn sm" id="impFile">${icon('upload')}CSV 불러오기</button>
                <button class="btn sm" id="impPaste">${icon('clipboard')}붙여넣기</button>
                <button class="btn sm" id="expProd">${icon('download')}CSV 내보내기</button>
                <button class="btn sm" id="resetProd">${icon('refresh')}기본값</button>
                <button class="btn sm pri" id="saveProd">${icon('save')}저장</button></span></div>
            <div class="card-bd" style="padding:0"><div class="out-tbl" style="max-height:520px"><table class="tbl" id="prodTable"></table></div></div>
          </div>
          <div class="note" style="margin-top:12px"><b>자체상품코드</b>가 기준입니다(카페24 상품코드는 참고용·선택). 엑셀/구글시트에서
            <b>자체상품코드·입점사명·정산구분·품명</b> 열을 복사해 <b>붙여넣기</b>하거나 CSV로 불러오세요.
            헤더 이름(자체상품코드/자체코드/자사코드 등)을 자동 인식합니다. 배송비 예외는 비우면 입점사 기본 배송비를 사용합니다.</div>
          <div id="pasteBox" class="hidden" style="margin-top:14px"></div>`;
        renderProd();
        body.querySelector('#saveProd').onclick=()=>{ saveProducts(); saveVendors(); dirtyMaster=false;
          body.querySelector('#mDirty').style.display='none'; toast('저장되었습니다'); };
        body.querySelector('#addProd').onclick=()=>{ products.unshift({selfCode:'',code:'',vendor:'',settle:SETTLE_TYPES[0],name:'',ship:''}); markMasterDirty(); renderProd(); };
        body.querySelector('#resetProd').onclick=()=>{ if(confirm('상품 마스터를 기본값으로 되돌릴까요?')){ products=DEFAULT_MD_PRODUCTS.map(p=>({...p})); saveProducts(); dirtyMaster=false; body.querySelector('#mDirty').style.display='none'; renderProd(); } };
        body.querySelector('#expProd').onclick=()=>{ const cols=['자체상품코드','카페24코드','입점사명','정산구분','품명','배송비'];
          const rows=products.map(p=>[p.selfCode||'',p.code||'',p.vendor,p.settle,p.name,p.ship||'']);
          downloadBlob(new Blob([toCSV(cols,rows)],{type:'text/csv'}),`상품마스터_${todayStr()}.csv`); toast('CSV 저장'); };
        const file=body.querySelector('#csvFile');
        body.querySelector('#impFile').onclick=()=>file.click();
        file.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(!f)return; const rd=new FileReader(); rd.onload=()=>importRows(parseTable(rd.result)); rd.readAsText(f,'utf-8'); };
        body.querySelector('#impPaste').onclick=()=>{
          const box=body.querySelector('#pasteBox'); box.classList.remove('hidden');
          box.innerHTML=`<div class="card"><div class="card-hd"><b>붙여넣기로 불러오기</b></div><div class="card-bd">
            <div class="muted" style="font-size:12.5px;margin-bottom:8px">구글시트/엑셀에서 범위를 복사해 아래에 붙여넣으세요. 첫 줄이 헤더면 자동 인식합니다.</div>
            <textarea id="pasteArea" rows="6" placeholder="자체상품코드   입점사명   정산구분   품명"></textarea>
            <div style="display:flex;gap:8px;margin-top:10px"><button class="btn pri" id="pasteGo">불러오기</button>
              <button class="btn" id="pasteCancel">취소</button></div></div></div>`;
          box.querySelector('#pasteCancel').onclick=()=>{ box.classList.add('hidden'); box.innerHTML=''; };
          box.querySelector('#pasteGo').onclick=()=>{ importRows(parseTable(box.querySelector('#pasteArea').value)); box.classList.add('hidden'); box.innerHTML=''; };
        };
      }
      function importRows(rows){
        if(!rows.length){ toast('불러올 데이터가 없습니다'); return; }
        const norm=s=>String(s||'').replace(/\s/g,'').toLowerCase();
        const idxOf=(names)=>{ const h=rows[0].map(norm); for(const n of names){ const i=h.indexOf(norm(n)); if(i>=0) return i; } return -1; };
        const ci={ selfCode:idxOf(['자체상품코드','자체코드','자사상품코드','자사코드','자체품목코드']),
          code:idxOf(['상품코드','카페24코드','코드','품목코드']), vendor:idxOf(['입점사명','입점사','거래처']),
          settle:idxOf(['정산구분','정산']), name:idxOf(['품명','상품명','품목명']), ship:idxOf(['배송비','배송비예외']) };
        const hasHeader = ci.selfCode>=0 || ci.code>=0 || ci.vendor>=0 || ci.name>=0;
        const dataRows = hasHeader ? rows.slice(1) : rows;
        const g=(r,i,def)=> i>=0&&i<r.length ? String(r[i]).trim() : def;
        // 자체상품코드 열이 있으면 그것을 기준, 없으면 상품코드 열을 자체코드로 사용
        const keyIdx = ci.selfCode>=0 ? ci.selfCode : (ci.code>=0 ? ci.code : 0);
        let added=0;
        dataRows.forEach(r=>{ if(!r.join('').trim()) return;
          const selfCode=g(r, keyIdx, '').trim(); if(!selfCode) return;
          const rec={ selfCode, code:g(r,ci.code>=0&&ci.code!==keyIdx?ci.code:-1,''),
            vendor:g(r,ci.vendor,'')||(isJasa(selfCode)?'자사':''),
            settle:normSettle(g(r,ci.settle,'')) || SETTLE_TYPES[0], name:g(r,ci.name,''), ship:g(r,ci.ship,'') };
          const ex=products.find(p=>(p.selfCode||'').trim()===selfCode); if(ex){ Object.assign(ex,rec); } else { products.push(rec); }
          added++; });
        syncVendorsFromProducts(); markMasterDirty(); renderProd();
        toast(`${added}건 불러왔습니다 · [저장]을 눌러 반영하세요`);
      }
      function syncVendorsFromProducts(){ const names=new Set(vendors.map(v=>v.name));
        products.forEach(p=>{ if(p.vendor && !names.has(p.vendor)){ vendors.push({name:p.vendor,ship:3000}); names.add(p.vendor); } }); }
      function renderProd(){
        const t=body.querySelector('#prodTable'); if(!t) return;
        t.innerHTML=`<thead><tr><th style="width:120px">자체상품코드</th><th style="width:120px">카페24 상품코드<div class="mini" style="font-weight:500">참고·선택</div></th><th style="width:140px">입점사명</th><th style="width:118px">정산구분</th><th>품명</th><th style="width:100px">배송비 예외</th><th style="width:34px"></th></tr></thead><tbody></tbody>`;
        const tb=t.querySelector('tbody');
        if(!products.length){ tb.innerHTML=`<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">상품이 없습니다. “행 추가” 또는 불러오기.</td></tr>`; return; }
        products.forEach((p,i)=>{ const tr=el('tr');
          tr.innerHTML=`<td><input type="text" data-k="selfCode" value="${esc(p.selfCode||'')}" class="mono" style="font-weight:700"></td>
            <td><input type="text" data-k="code" value="${esc(p.code||'')}" class="mono" style="color:var(--muted)"></td>
            <td><input type="text" data-k="vendor" value="${esc(p.vendor)}" list="venList"></td>
            <td><select data-k="settle">${[...new Set([...SETTLE_TYPES, p.settle].filter(Boolean))].map(s=>`<option ${s===p.settle?'selected':''}>${esc(s)}</option>`).join('')}</select></td>
            <td><input type="text" data-k="name" value="${esc(p.name)}"></td>
            <td><input type="number" data-k="ship" value="${esc(p.ship||'')}" placeholder="기본"></td>
            <td><button class="btn ghost sm">${icon('x')}</button></td>`;
          tr.querySelectorAll('[data-k]').forEach(inp=>inp.onchange=()=>{ p[inp.dataset.k]=inp.value; if(inp.dataset.k==='vendor')syncVendorsFromProducts(); markMasterDirty(); });
          tr.querySelector('button').onclick=()=>{ products.splice(i,1); markMasterDirty(); renderProd(); };
          tb.appendChild(tr); });
        let dl=body.querySelector('#venList'); if(!dl){ dl=el('datalist'); dl.id='venList'; body.appendChild(dl); }
        dl.innerHTML=vendors.map(v=>`<option value="${esc(v.name)}">`).join('');
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
          <div class="note" style="margin-top:12px">배송비는 <b>입점사별 고정 금액</b>(vat포함)이 기본이며 공급가·부가세는 ÷11로 자동 분리됩니다. 특정 상품만 다르면 <b>상품 마스터</b>의 “배송비 예외”에 입력하세요.
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
                <label class="fld" style="margin-bottom:8px">발주 입력 시</label>
                <div style="display:flex;gap:20px;flex-wrap:wrap">
                  <label class="chk"><input type="radio" name="autoSend" value="1" ${cfg.autoSend!==false?'checked':''}> 시트에 <b>자동 전송</b> (추가 즉시)</label>
                  <label class="chk"><input type="radio" name="autoSend" value="0" ${cfg.autoSend===false?'checked':''}> 수동 (버튼으로 모아서 전송)</label>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="btn pri" id="ordSave">${icon('check')}저장</button>
                <button class="btn" id="ordTest">${icon('cloud')}연결 테스트</button>
                <span class="muted" id="ordStat" style="font-size:13px"></span></div>
            </div>
          </div>
          <div class="note warn" style="max-width:820px;margin-bottom:12px"><b>Apps Script 코드가 업데이트되었습니다.</b>
            시트에 값이 일부만 들어갔다면 → 위 <b>[Apps Script 코드 복사]</b>로 다시 복사해 붙여넣고 <b>재배포(배포 관리 → 새 버전)</b> 하세요.
            이제 시트의 <b>1행 헤더 이름</b>을 읽어 열을 맞추므로, 시트 열 순서가 달라도 정확히 들어갑니다.</div>
          <div class="note" style="max-width:820px">이카운트는 현재 <b>복사/CSV</b>로 내보내 붙여넣습니다. (ECOUNT API 연동은 추후 어댑터로 추가 가능)
            발주표 시트 1행 헤더에 <span class="mono" style="font-size:12px">입점사명 · 정산구분 · 상품코드(또는 자체상품코드) · 품명 · 수량 · 배송정보/비고</span> 같은 이름이 있으면 그 칸으로 채워집니다.</div>`;
        body.querySelector('#copyCode').onclick=async()=>{ try{ const r=await fetch('google-apps-script-orders.gs'); if(!r.ok)throw 0; copyText(await r.text()); }catch{ toast('코드 파일을 불러오지 못했습니다'); } };
        body.querySelector('#ordSave').onclick=()=>{ cfgDB().set({ sheetUrl:body.querySelector('#ordUrl').value.trim(),
          autoSend: body.querySelector('input[name=autoSend]:checked').value==='1' }); toast('저장했습니다'); };
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
