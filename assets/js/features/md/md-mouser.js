/* ===========================================================================
   MD · 가격비교 > 마우저 탭 (직소싱 대시보드) — Phase 1: 조회(부품·재고·가격) + 결제요청
   - 시드: window.MOUSER_PARTS (마우저 즐겨찾기 48품목) · 제조사→상위탭, 카테고리→서브탭
   - 실시간 재고/현재가: /api/mouser (서버가 MOUSER_API_KEY 보관) · 미설정 시 기준가만 표시
   - 자사(이카운트)코드: 미보유 다수 → 공란 허용, 담당자가 인라인 편집(로컬 저장)
   - [결제요청]: 결제요청 리스트에 추가(Records.pushRaw md/payreq) + 마우저 상품페이지 열기
   가격비교(md-pricewatch)의 window.PriceTabs 로 탭 등록 → 제조사 추가 시 시드만 늘리면 됨.
   =========================================================================== */
(function(){
  const MF = window.MOUSER_FIELDS || ['mouserNo','mfrNo','mfr','category','edCode','name','basePriceKRW'];
  const toObj = a => Array.isArray(a) ? MF.reduce((o,k,i)=>(o[k]=a[i],o),{}) : a;
  const PARTS = ()=> (window.MOUSER_PARTS||[]).map(toObj);
  const won = n => Number(n||0).toLocaleString('ko-KR');
  // 자사(에듀이노) 상품 마스터 — 이카운트 카탈로그(/api/catalog)에서 자사코드로 조회.
  //  MD가 마우저 행에 자사코드(ed)를 입력하면 이카운트 상품명·판매가(출고단가/outPrice)를 우측에 노출하고 마진율을 계산.
  //  (가격비교 엔티렉스 공급가표가 아니라 이카운트 실판매가 기준 — eduino.kr 판매가와 일치)
  const normEd = s => String(s||'').trim().toUpperCase();
  const catCache = {};   // ED(대문자) → 상품객체 | 'loading' | null(이카운트 없음)
  function ensureCat(ed, cb){ const k=normEd(ed); if(!k) return;
    if(catCache[k]!==undefined){ if(catCache[k]!=='loading' && cb) cb(); return; }
    catCache[k]='loading';
    fetch('/api/catalog?code='+encodeURIComponent(k)).then(r=>r.ok?r.json():null).then(d=>{
      let prod=(d&&d.product)||null;
      if(!prod && d && Array.isArray(d.options) && d.options.length===1) prod=d.options[0];   // 옵션 상품이 하나뿐이면 그 값 사용
      catCache[k]=prod||null;
      if(cb) cb();
    }).catch(()=>{ catCache[k]=null; if(cb) cb(); });
  }
  // 자사(에듀이노)코드 매핑 { mouserNo: 자사코드 } — MD 팀 공유(coll 'mouser_edmap') + 로컬 캐시
  const EDMAP_KEY='eduino.mouser.edmap';
  let edState = store(EDMAP_KEY).get({})||{};
  const edMap = ()=> edState;
  async function loadEdShared(){
    try{ const r=await fetch('/api/store?type=coll&coll=mouser_edmap'); if(!r.ok) return false;
      const d=await r.json(); let ch=false; (d&&d.items||[]).forEach(it=>{ if(it&&it.id){ edState[it.id]=it.code||''; ch=true; } });
      store(EDMAP_KEY).set(edState); return ch; }catch(e){ return false; }
  }
  function setEd(no,code){ code=String(code||'').trim();
    if(code) edState[no]=code; else delete edState[no]; store(EDMAP_KEY).set(edState);
    try{ if(code) fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:'mouser_edmap',item:{id:no,code}})});
         else fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:'mouser_edmap',id:no})}); }catch(e){}
  }
  // 마우저 장바구니(Cart API) — 서버 프록시 경유
  async function cartApi(op, items){ try{ const r=await fetch('/api/mouser-cart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,items})}); return r.ok?await r.json():null; }catch(e){ return null; } }
  const meU = ()=> (Auth.user&&Auth.user())||{};
  const canEdit = ()=> !!(Auth.isAdmin&&Auth.isAdmin()) || meU().dept==='md' || meU().role==='lead';
  const prodUrl = no => `https://www.mouser.kr/ProductDetail/${encodeURIComponent(no)}`;

  function drawMouser(root){
    const all=PARTS();
    const mfrs=[...new Set(all.map(p=>p.mfr))];
    let mfr=mfrs[0]||'', cat='', view='stock';
    let stockMap=null, stockAt='';   // 크론이 저장한 최신 재고맵(coll mouser_stock)
    const catsOf=m=>[...new Set(all.filter(p=>p.mfr===m).map(p=>p.category).filter(Boolean))];
    cat=catsOf(mfr)[0]||'';

    root.innerHTML=`
      <style>
        .mo-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
        .mo-tab{border:1px solid var(--line-2);background:var(--panel);border-radius:9px;padding:8px 16px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer}
        .mo-tab.on{background:#0a3d62;color:#fff;border-color:#0a3d62}
        .mo-sub{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .mo-sub button{border:0;background:var(--panel);padding:7px 14px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .mo-sub button:first-child{border-left:0} .mo-sub button.on{background:var(--active-bg);color:#0a3d62}
        .mo-view{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden;margin-left:auto}
        .mo-view button{border:0;background:var(--panel);padding:7px 13px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .mo-view button.on{background:#0a3d62;color:#fff}
        .mo-stk{font-weight:800} .mo-stk.in{color:#12886a} .mo-stk.out{color:#c0392b} .mo-stk.wait{color:var(--muted)}
        .mo-lead{font-size:11px;color:var(--muted);margin-top:1px}
        .mo-price{font-weight:800;color:#0a3d62} .mo-base{color:var(--muted);font-size:11px}
        .mo-code{font-family:var(--mono);font-weight:800;font-size:12px;color:#0a3d62}
        .mo-ed input{width:100%;min-width:70px;font:inherit;border:1px dashed var(--line-2);border-radius:6px;padding:4px 6px;font-size:12px}
        .mo-qty{width:38px;text-align:center;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:4px 3px}
        /* 마우저 표 — 우측 여백을 자사 상품정보 칸이 흡수, 숫자·액션 칸은 최소폭 */
        table.mo-t{border-collapse:collapse;width:100%;font-size:12.5px;table-layout:fixed}
        table.mo-t .c-nm{width:360px}
        table.mo-t th{position:sticky;top:0;background:var(--panel-2);color:var(--ink-2);font-size:11px;font-weight:800;text-align:left;padding:7px 8px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.mo-t td{padding:6px 8px;border-bottom:1px solid var(--line);color:var(--ink-2);vertical-align:top}
        table.mo-t td.num{text-align:right;font-variant-numeric:tabular-nums}
        /* 마우저 상품명·자사 상품명 두 칸이 남는 폭을 '반씩' 흡수 → 중간에 큰 공백이 안 생김 */
        table.mo-t .c-no{width:100px} table.mo-t .c-nm{width:auto;min-width:170px}
        table.mo-t .c-stk{width:88px} table.mo-t .c-buy{width:96px}
        table.mo-t .c-ed{width:78px} table.mo-t .c-snm{width:auto;min-width:160px}
        table.mo-t .c-sup{width:100px} table.mo-t .c-save{width:104px} table.mo-t .c-act{width:100px}
        table.mo-t td:last-child{padding-right:12px}
        /* 자사·비교 영역 — 옅은 배경으로 마우저와 시각 구분 */
        table.mo-t th.zself, table.mo-t td.zself{background:#f3f8ff}
        table.mo-t th.zself{border-bottom-color:#cfe0f5}
        /* 자사 공급가/판매정보 */
        .mo-snm{font-weight:600;color:var(--ink);white-space:normal;word-break:break-word;line-height:1.35}
        .mo-sup{font-weight:800;color:#0a3d62} .mo-sup .lbl{font-size:9.5px;font-weight:700;color:var(--muted);display:block}
        .mo-sub2{font-size:10.5px;color:var(--muted);margin-top:2px;white-space:normal;word-break:break-word;line-height:1.3}
        .mo-none{color:var(--muted);font-size:11px} .mo-hint{color:var(--muted);font-size:11px;opacity:.7}
        /* 직소싱 절감 배지 */
        .mo-save{font-weight:800;font-size:12px;border-radius:7px;padding:3px 8px;display:inline-block;white-space:nowrap}
        .mo-save.good{color:#12886a;background:#e6f7f0} .mo-save.bad{color:#c0392b;background:#fdecea} .mo-save.same{color:#6b7280;background:#eef0f3}
        .mo-save .pct{font-size:10.5px;font-weight:700;opacity:.85}
        .mo-savenote{font-size:10px;color:var(--muted);margin-top:3px}
        .mo-req{background:#0a3d62;color:#fff;border:0;border-radius:7px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
        .mo-req:hover{background:#0c4b78}
        /* 주문내역 표 — 가독성 위해 글자 확대 */
        table.mo-ord{font-size:14px}
        table.mo-ord th{font-size:12.5px;padding:10px 12px}
        table.mo-ord td{padding:11px 12px;vertical-align:middle}
        table.mo-ord .mo-code{font-size:14.5px;font-weight:800}
        table.mo-ord .osub{font-size:11.5px;color:var(--muted);margin-top:2px;font-weight:600}
        table.mo-ord .ost{display:inline-block;font-weight:800;font-size:13px;border-radius:7px;padding:3px 11px}
        table.mo-ord .obar{height:5px;border-radius:3px;background:#e9ecf1;margin-top:6px;overflow:hidden;max-width:150px}
        table.mo-ord .otrk{font-size:13px;font-family:var(--mono)}
        table.mo-ord .otrk b{font-weight:800}
      </style>
      <div class="nx-note" id="moNote" style="border-left-color:#0a3d62;background:#eef4fb;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>${icon('truck')} <b>마우저 직소싱</b> — 즐겨찾기 <b>${all.length}</b>품목의 재고·가격을 확인하고, <b>[요청]</b>으로 결제요청+장바구니에 담습니다.
        <span id="moLiveState" class="muted" style="font-size:12px"></span></span>
        <span id="moCart" style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#0a3d62"></span>
        <div style="flex-basis:100%;font-size:11.5px;color:var(--muted);margin-top:2px">${icon('info')||''} <b>데이터 기준</b> — 마우저 재고·가격·입고예정은 <b>매일 아침 7시</b> 자동 조사한 값입니다(실시간 아님). 그날 아침 이후 변동은 다음날 반영돼요.</div>
      </div>
      <div class="mo-tabs" id="moMfr">${mfrs.map(m=>`<div class="mo-tab${m===mfr?' on':''}" data-m="${esc(m)}">${esc(m)} <span class="muted" style="font-weight:600;font-size:11px">${all.filter(p=>p.mfr===m).length}</span></div>`).join('')}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span class="mo-sub" id="moCat"></span>
        <span class="mo-view" id="moView"><button data-v="stock" class="on">재고·비교</button><button data-v="changes">변동 알림</button><button data-v="orders">주문내역</button></span>
      </div>
      <div id="moBody"></div>`;

    const catBar=root.querySelector('#moCat'), moBody=root.querySelector('#moBody');
    function renderCats(){ const cats=catsOf(mfr); if(!cats.includes(cat)) cat=cats[0]||'';
      catBar.innerHTML=cats.map(c=>`<button data-c="${esc(c)}" class="${c===cat?'on':''}">${esc(c)}</button>`).join('');
      catBar.querySelectorAll('button').forEach(b=>b.onclick=()=>{ cat=b.dataset.c;
        catBar.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.c===cat)); paint(); }); }
    root.querySelectorAll('#moMfr .mo-tab').forEach(t=>t.onclick=()=>{ mfr=t.dataset.m;
      root.querySelectorAll('#moMfr .mo-tab').forEach(x=>x.classList.toggle('on',x.dataset.m===mfr)); renderCats(); paint(); });
    root.querySelectorAll('#moView button').forEach(b=>b.onclick=()=>{ view=b.dataset.v;
      root.querySelectorAll('#moView button').forEach(x=>x.classList.toggle('on',x.dataset.v===view)); applyViewChrome(); paint(); });
    // 주문내역·변동알림은 제조사와 무관 → 제조사/카테고리 탭 숨김(재고·비교에서만 표시)
    function applyViewChrome(){ const per=(view==='stock');
      const mfrBar=root.querySelector('#moMfr'); if(mfrBar) mfrBar.style.display=per?'':'none';
      if(catBar) catBar.style.display=per?'':'none'; }

    function rows(){ return all.filter(p=>p.mfr===mfr && p.category===cat); }

    // 마우저 매입가(직소싱 원가) — 크론 재고맵의 현재가 우선, 없으면 시드 기준가
    function mouserBuyOf(p){ const d=stockMap&&stockMap[p.mouserNo]; if(d&&d.found&&d.priceKRW>0) return d.priceKRW; return p.basePriceKRW||0; }
    // 행의 자사코드 — 팀 공유 매핑(edMap) 우선, 없으면 시드의 edCode
    const edOf = no => { const em=edMap(); if(em[no]!=null) return em[no]; const p=all.find(x=>x.mouserNo===no); return (p&&p.edCode)||''; };
    // 자사(에듀이노) 상품명 셀 — 이카운트 카탈로그 상품명(마우저 상품명과 나란히 비교)
    function selfNameCellHtml(ed){ ed=normEd(ed);
      if(!ed) return `<span class="mo-hint">자사코드 입력 시</span>`;
      const v=catCache[ed];
      if(v===undefined||v==='loading') return `<span class="mo-hint">이카운트 조회 중…</span>`;
      if(!v) return `<span class="mo-none">이카운트 DB 없음 <span style="opacity:.7">(코드 확인)</span></span>`;
      return `<div class="mo-snm">${esc(v.name||'(상품명 없음)')}</div>`;
    }
    // 자사 판매가 셀 — 이카운트 출고단가(outPrice) = 에듀이노 판매가
    function sellCellHtml(ed){ ed=normEd(ed);
      if(!ed) return `<span class="mo-hint">–</span>`;
      const v=catCache[ed];
      if(v===undefined||v==='loading') return `<span class="mo-hint">…</span>`;
      if(!v) return `<span class="mo-none">–</span>`;
      return `<div class="mo-sup">${v.outPrice?won(v.outPrice):'<span class="mo-none">미등록</span>'}</div>`;
    }
    // 마진율 셀 — (자사 판매가 − 마우저 매입가) ÷ 자사 판매가 × 100. 마우저서 사와 자사가로 팔 때 마진.
    function marginCellHtml(ed, buy){ ed=normEd(ed);
      const v=ed?catCache[ed]:null;
      if(v==='loading'||v===undefined&&ed) return `<span class="mo-hint">…</span>`;
      const sell=(v&&v!=='loading')?Number(v.outPrice)||0:0;
      if(!v||!sell) return `<span class="mo-none">-</span>`;
      if(!buy) return `<span class="mo-none" title="마우저 매입가 미확인 · 자동갱신 후 표시">매입가 확인</span>`;
      const diff=sell-buy; const pct=Math.round(diff/sell*1000)/10;
      const cls=diff>0?'good':(diff<0?'bad':'same');
      return `<span class="mo-save ${cls}">${pct}%</span><div class="mo-savenote">마진 ${won(diff)}</div>`;
    }
    function paintCompareCells(no){ const ed=edOf(no); const p=all.find(x=>x.mouserNo===no);
      const nmCell=moBody.querySelector(`[data-snm="${CSS.escape(no)}"]`); if(nmCell) nmCell.innerHTML=selfNameCellHtml(ed);
      const sellCell=moBody.querySelector(`[data-sell="${CSS.escape(no)}"]`); if(sellCell) sellCell.innerHTML=sellCellHtml(ed);
      const mgCell=moBody.querySelector(`[data-margin="${CSS.escape(no)}"]`); if(mgCell) mgCell.innerHTML=marginCellHtml(ed, p?mouserBuyOf(p):0);
    }
    // 자사코드로 이카운트 조회를 보장하고, 도착하면 해당 행의 자사명·판매가·마진율을 갱신
    function updateCompare(no){ const ed=edOf(no);
      if(ed) ensureCat(ed, ()=>{ if(root.isConnected) paintCompareCells(no); });
      paintCompareCells(no);
    }

    function paint(){
      if(view==='orders'){ paintOrders(); return; }
      if(view==='changes'){ paintChanges(); return; }
      const list=rows(); const em=edMap();
      moBody.innerHTML=`<div class="nx-wrap" style="max-height:calc(100vh - 330px);overflow:auto"><table class="mo-t" style="min-width:1040px">
        <colgroup><col class="c-no"><col class="c-nm"><col class="c-stk"><col class="c-buy"><col class="c-ed"><col class="c-snm"><col class="c-sup"><col class="c-save"><col class="c-act"></colgroup>
        <thead><tr>
          <th colspan="4" style="position:static;text-align:left;color:#0a3d62;font-size:12px;background:var(--panel-2)">▍마우저 (직소싱)</th>
          <th colspan="4" class="zself" style="position:static;text-align:left;color:#0a3d62;font-size:12px">▍자사 (에듀이노)</th>
          <th style="position:static;background:var(--panel-2)"></th></tr>
        <tr>
          <th>마우저 번호</th><th>마우저 상품명</th><th style="text-align:right">재고/입고</th><th style="text-align:right">마우저 매입가</th>
          <th class="zself">자사코드</th><th class="zself">자사 상품명</th><th class="zself" style="text-align:right">자사 판매가</th><th class="zself">마진율</th>
          <th style="text-align:center">요청</th></tr></thead>
        <tbody>${list.length?list.map(p=>{
          const ed=em[p.mouserNo]!=null?em[p.mouserNo]:(p.edCode||''); const buy=mouserBuyOf(p);
          return `<tr data-no="${esc(p.mouserNo)}">
            <td><a class="mo-code" href="${esc(prodUrl(p.mouserNo))}" target="_blank" rel="noopener">${esc(p.mouserNo)}</a><div class="muted" style="font-size:10.5px">${esc(p.mfrNo||'')}</div></td>
            <td style="white-space:normal;word-break:break-word;line-height:1.35">${esc(p.name||'')}</td>
            <td class="num" data-stk><span class="mo-stk wait">–</span></td>
            <td class="num" data-price><span class="mo-price">${won(p.basePriceKRW)}</span><div class="mo-base">기준가</div></td>
            <td class="zself mo-ed">${canEdit()?`<input data-ed="${esc(p.mouserNo)}" value="${esc(ed)}" placeholder="미보유">`:esc(ed||'-')}</td>
            <td class="zself" data-snm="${esc(p.mouserNo)}" style="white-space:normal;word-break:break-word;line-height:1.35">${selfNameCellHtml(ed)}</td>
            <td class="zself num" data-sell="${esc(p.mouserNo)}">${sellCellHtml(ed)}</td>
            <td class="zself" data-margin="${esc(p.mouserNo)}">${marginCellHtml(ed, buy)}</td>
            <td style="white-space:nowrap;text-align:center">
              <input class="mo-qty" data-qty="${esc(p.mouserNo)}" value="1" inputmode="numeric" maxlength="2">
              <button class="mo-req" data-req="${esc(p.mouserNo)}" title="결제요청에 추가 + 마우저 장바구니에 담기">요청</button>
            </td></tr>`; }).join('')
          :`<tr><td colspan="9" class="nx-empty">이 카테고리에 품목이 없습니다.</td></tr>`}</tbody></table></div>`;
      // 자사코드 인라인 편집 → 저장 + 자사공급가·직소싱 절감 즉시 갱신
      moBody.querySelectorAll('[data-ed]').forEach(inp=>inp.onchange=()=>{ setEd(inp.dataset.ed, inp.value.trim()); updateCompare(inp.dataset.ed); });
      // 결제요청
      moBody.querySelectorAll('[data-req]').forEach(b=>b.onclick=()=>requestPay(b.dataset.req));
      // 자사코드가 있는 행은 이카운트에서 상품명·판매가·마진율을 조회해 채움
      list.forEach(p=>{ if(edOf(p.mouserNo)) updateCompare(p.mouserNo); });
      // 아침 크론이 저장한 최신 재고·가격·입고예정 표시(매 접속마다 실시간 호출 대신)
      fillStock(list);
    }

    function fillStock(list){
      const st=root.querySelector('#moLiveState');
      if(!stockMap){ if(st) st.innerHTML=' · <b style="color:var(--warn)">자동갱신 대기</b> — 매일 아침 자동조사 후 표시 (지금 즉시: <a href="/api/mouser-cron" target="_blank" rel="noopener">/api/mouser-cron</a> 1회 실행)'; return; }
      if(st) st.innerHTML=` · 자동갱신 <b>${esc((stockAt||'').slice(0,10))}</b> <a href="/api/mouser-cron" target="_blank" rel="noopener" title="지금 최신화" style="font-size:11px">↻ 지금</a>`;
      list.forEach(p=>{ const d=stockMap[p.mouserNo]; const tr=moBody.querySelector(`tr[data-no="${CSS.escape(p.mouserNo)}"]`); if(!tr) return;
        const stkTd=tr.querySelector('[data-stk]'), prTd=tr.querySelector('[data-price]'), reqBtn=tr.querySelector('[data-req]');
        if(!d || !d.found){ stkTd.innerHTML='<span class="mo-stk wait">확인불가</span>'; return; }
        if(d.restricted){   // 마우저 유통 구매불가 — 소싱 판단에 중요
          stkTd.innerHTML=`<span class="mo-stk" style="color:#8a6d00">구매제한</span><div class="mo-lead" title="${esc(d.restriction||'')}">마우저 구매불가</div>`;
          if(reqBtn){ reqBtn.disabled=true; reqBtn.style.opacity=.4; reqBtn.style.cursor='not-allowed'; reqBtn.title='마우저 구매불가 품목'; }
          return; }
        const viaCart = d.via==='cart';   // Search가 막아 Cart API로 보강한 값(카트 조회 기준)
        const srcNote = viaCart ? '<span title="검색API 제한 → 장바구니API 조회값" style="color:#8a6d00"> · 카트조회</span>' : '';
        if(d.inStock>0) stkTd.innerHTML=`<span class="mo-stk in">${won(d.inStock)}</span><div class="mo-lead">재고 보유${srcNote}</div>`;
        else{ // 품절 → 마우저 입고예정(주문중) 배치별 수량·예상일 모두 표시
          const oo=(d.onOrder||[]).filter(x=>x&&(x.qty||x.date));
          let info;
          if(oo.length) info=`<b style="color:#0a3d62">입고예정</b>${oo.map(x=>`<div>${x.qty?`<b>${won(x.qty)}개</b> `:''}${x.date?`~ ${esc(String(x.date).slice(0,10))}`:'예정일 미정'}</div>`).join('')}`;
          else if(d.nextDate) info=`입고예정 <b>${esc(d.nextDate)}</b>${d.onOrderQty?` · ${won(d.onOrderQty)}개`:''}`;
          else{ const lead=String(d.lead||'').trim(); const leadTxt=lead&&!/^0\s*(일|day)/i.test(lead)?` · 리드 ${esc(lead)}`:'';
            info=`<span class="muted">입고예정 없음</span>${leadTxt}`; }
          stkTd.innerHTML=`<span class="mo-stk out">0</span><div class="mo-lead">${info}${srcNote}</div>`; }
        if(d.priceKRW>0) prTd.innerHTML=`<span class="mo-price">${won(d.priceKRW)}</span><div class="mo-base">${viaCart?'카트조회 매입가':'현재 매입가'}</div>`;
        updateCompare(p.mouserNo);   // 실제 매입가 확보 → 직소싱 절감 재계산
      });
    }
    async function loadStock(){ try{ const r=await fetch('/api/store?type=coll&coll=mouser_stock'); if(!r.ok) return;
      const dd=await r.json(); const it=(dd&&dd.items||[]).find(x=>x&&x.id==='latest'); if(it){ stockMap=it.parts||{}; stockAt=it.at||''; } }catch(e){} }

    // 장바구니 배지 — [내용]으로 담긴 품목을 프로그램 안에서 바로 확인, [열기]로 API 카트(CartKey) 연결
    //  optCart 를 주면(담기 응답) 별도 조회 없이 그 값으로 즉시 갱신 → 담은 직후 숫자가 바로 반영됨.
    let lastCart=null;
    async function refreshCart(optCart){ const box=root.querySelector('#moCart'); if(!box) return;
      const r=(optCart&&optCart.configured!==false)?optCart:await cartApi('get'); if(!root.isConnected||!box) return;
      if(!r || r.configured===false){ box.innerHTML=''; return; }
      lastCart=r; const n=r.count||0;
      const url=r.webUrl||'https://www.mouser.kr/Cart/';
      const tip=r.cartKey?`API 장바구니 (CartKey ${String(r.cartKey).slice(0,10)}…) · 웹 장바구니와 별도 · [내용]으로 담긴 품목 확인`:'';
      box.innerHTML=`${icon('box')} 마우저 장바구니 <b>${n}</b>건
        <button id="moCartView" class="btn ghost sm" style="padding:2px 8px" title="담긴 품목 보기">내용</button>
        <a href="${esc(url)}" target="_blank" rel="noopener" class="btn ghost sm" style="padding:2px 8px" title="${esc(tip)}">열기</a>`;
      const vb=box.querySelector('#moCartView'); if(vb) vb.onclick=()=>showCart(r);
    }
    // 담긴 품목 목록을 오버레이로 표시 — "웹 카트에 안 보인다" 오해 해소(API 카트는 별도 관리)
    function showCart(r){
      const items=(r&&r.items)||[]; const ck=(r&&r.cartKey)||''; const url=(r&&r.webUrl)||'https://www.mouser.kr/Cart/';
      const rowsH=items.length?items.map(it=>`<tr>
          <td><a class="mo-code" href="${esc(prodUrl(it.no))}" target="_blank" rel="noopener">${esc(it.no)}</a><div class="muted" style="font-size:10.5px;white-space:normal;max-width:320px">${esc(it.desc||'')}</div></td>
          <td class="num">${it.qty}</td><td class="num">${won(it.unit)}</td><td class="num"><b>${won(it.ext||it.unit*it.qty)}</b></td>
          <td class="num">${it.ats?won(it.ats):'-'}</td></tr>`).join('')
        :`<tr><td colspan="5" class="nx-empty" style="padding:20px">담긴 품목이 없습니다.</td></tr>`;
      const sum=items.reduce((s,i)=>s+(i.ext||i.unit*i.qty||0),0);
      const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
      ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:720px;width:97%;max-height:calc(100vh - 40px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
        <div style="padding:16px 20px 10px;border-bottom:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px">${icon('box')||''} 마우저 API 장바구니 <span class="muted" style="font-weight:600;font-size:13px">${items.length}품목 · ${(r&&r.count)||0}개</span>
            <button id="moCartX" class="btn ghost sm" style="margin-left:auto;padding:2px 10px">닫기</button></div>
          <div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb;margin-top:10px">
            ${icon('info')||''} 이 목록은 <b>API 장바구니</b>입니다. 마우저 <b>웹 장바구니와 별도</b>로 관리되어, 웹에서 기본으로 열리는 카트에는 보이지 않을 수 있습니다.
            ${ck?`<div style="margin-top:6px;font-size:12px">CartKey <code style="font-family:var(--mono);background:#fff;border:1px solid var(--line-2);border-radius:5px;padding:1px 6px">${esc(ck)}</code>
              <button id="moCkCopy" class="btn ghost sm" style="padding:1px 8px">복사</button>
              <a class="btn ghost sm" href="${esc(url)}" target="_blank" rel="noopener" style="padding:1px 8px">웹에서 열기</a></div>`:''}
          </div>
        </div>
        <div style="padding:6px 20px;overflow-y:auto;flex:1">
          <table class="mo-t" style="width:100%">
            <thead><tr><th>부품 / 설명</th><th style="text-align:right">수량</th><th style="text-align:right">단가</th><th style="text-align:right">금액</th><th style="text-align:right">재고</th></tr></thead>
            <tbody>${rowsH}</tbody></table>
          <div style="text-align:right;margin:12px 2px;font-weight:800;color:#0a3d62">합계 ${won(sum)}원</div>
        </div></div>`;
      document.body.appendChild(ov); const close=()=>ov.remove(); ov.onclick=e=>{ if(e.target===ov) close(); };
      const xb=ov.querySelector('#moCartX'); if(xb) xb.onclick=close;
      const cp=ov.querySelector('#moCkCopy'); if(cp) cp.onclick=()=>{ try{ navigator.clipboard.writeText(ck); toast('CartKey 복사됨'); }catch(e){} };
    }

    async function requestPay(no){
      const p=all.find(x=>x.mouserNo===no); if(!p) return;
      const qtyEl=moBody.querySelector(`[data-qty="${CSS.escape(no)}"]`); const qty=Math.max(1, Number((qtyEl&&qtyEl.value||'1').replace(/[^\d]/g,''))||1);
      const prTd=moBody.querySelector(`tr[data-no="${CSS.escape(no)}"] [data-price] .mo-price`);
      const unit=prTd?Number(prTd.textContent.replace(/[^\d]/g,''))||p.basePriceKRW:p.basePriceKRW;
      const ed=edMap()[no]||p.edCode||'';
      const me=meU(); const today=todayStr();
      // 버튼 상태 피드백(담는 중 → 결과) — 반응이 확실히 보이도록
      const btn=moBody.querySelector(`[data-req="${CSS.escape(no)}"]`); const orig=btn?btn.innerHTML:'';
      const setBtn=(t,bg)=>{ if(!btn) return; btn.innerHTML=t; if(bg) btn.style.background=bg; };
      if(btn){ btn.disabled=true; } setBtn('담는 중…');
      // 1) 프로그램 결제요청 리스트에 추가
      const rec={ id:uuid(), day:today, date:today, kind:'발주', orderer:'', vendor:'Mouser',
        content:`[${p.mouserNo}${ed?' · '+ed:''}] ${p.name||''}`,
        qty:String(qty), amount:unit*qty, account:'', prodAmount:unit*qty, ship:0,
        whoName:me.name||'', who:me.loginId||me.name||'', createdAt:nowISO(), source:'mouser', mouserNo:no };
      if(window.Records) Records.pushRaw('md','payreq',rec);
      // 2) 마우저 장바구니에 담기(Cart API) — 미설정/실패 시 상품페이지 열기로 대체
      const cr=await cartApi('add',[{mouserNo:no, qty, edCode:ed}]);
      const restore=(ms)=>setTimeout(()=>{ if(btn){ btn.disabled=false; btn.innerHTML=orig; btn.style.background=''; } }, ms||1400);
      if(cr && cr.configured!==false && cr.ok){
        setBtn('담김 ✓','#12886a'); restore();
        const healed = cr.healed ? ' · 새 카트 생성됨' : '';
        toast(`결제요청 추가 + 마우저 장바구니에 담았습니다 (${p.mouserNo} × ${qty})${healed} — 배지 [내용]에서 확인`);
        refreshCart(cr);   // 담기 응답으로 배지 즉시 갱신
      } else {
        const errMsg=(cr&&cr.errors&&cr.errors.length)?String(cr.errors[0].Message||cr.errors[0]||''):(cr&&cr.error)||'';
        setBtn('열기 ↗','#8a6d00'); restore(1800);
        try{ window.open(prodUrl(no),'_blank','noopener'); }catch(e){}
        toast(cr&&cr.configured===false ? '결제요청 추가 · (장바구니 자동담기는 서버 Cart API 키 설정 후 활성화)'
          : `결제요청 추가 · 장바구니 담기 실패${errMsg?' ('+errMsg+')':''} → 상품페이지를 열었습니다`);
      }
    }

    // 변동 알림 — 크론(api/mouser-cron)이 매일 저장한 일자별 변동 리포트(coll mouser_report)
    async function paintChanges(){
      moBody.innerHTML='<div class="muted" style="padding:18px">변동 리포트 불러오는 중…</div>';
      let reports=[];
      try{ const r=await fetch('/api/store?type=coll&coll=mouser_report'); if(r.ok){ const d=await r.json(); reports=(d&&d.items||[]).filter(x=>x&&x.day).sort((a,b)=>String(b.day).localeCompare(String(a.day))); } }catch(e){}
      if(!root.isConnected) return;
      if(!reports.length){ moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb">
        ${icon('info')} 아직 수집된 변동 리포트가 없습니다. <b>매일 자동</b>으로 가격·재고를 조사해 변동을 여기 쌓습니다.<br>
        지금 바로 시작하려면 <a href="/api/mouser-cron" target="_blank" rel="noopener"><b>/api/mouser-cron</b></a> 을 한 번 열어 <b>첫 스냅샷</b>을 만드세요. (첫 실행은 기준값만 저장 → 다음 실행부터 변동 표시)</div>`; return; }
      let day=reports[0].day;
      const lab={up:['가격 ▲','#c0392b'],down:['가격 ▼','#12886a'],restock:['신규 입고','#0a3d62'],oos:['품절','#8a6d00']};
      function render(){ const rep=reports.find(r=>r.day===day)||reports[0]; const chs=rep.changes||[];
        moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span>${icon('chart')} <b>${esc(rep.day)}</b> 변동 <b>${rep.changed||0}</b>건 · 검사 ${rep.checked||0}품목</span>
            <span style="margin-left:auto">일자 <select id="moDaySel" style="height:32px;border:1px solid var(--line-2);border-radius:7px;padding:0 8px">${reports.map(r=>`<option value="${esc(r.day)}" ${r.day===day?'selected':''}>${esc(r.day)} (${r.changed||0}건)</option>`).join('')}</select></span></div>
          ${chs.length?`<div class="nx-wrap" style="max-height:calc(100vh - 340px)"><table class="mo-t">
            <colgroup><col style="width:120px"><col style="width:96px"><col style="width:380px"><col style="width:180px"></colgroup>
            <thead><tr><th>구분</th><th>마우저번호</th><th>상품명</th><th style="text-align:right">변동</th></tr></thead>
            <tbody>${chs.map(c=>{ const L=lab[c.kind]||['변동','#333'];
              const detail=c.field==='price'?`${won(c.old)} → <b style="color:${L[1]}">${won(c.new)}</b>`
                : c.kind==='restock'?`<b style="color:${L[1]}">${won(c.new)} 입고</b>` : `<b style="color:${L[1]}">품절</b>`;
              return `<tr><td><span style="font-weight:800;color:${L[1]}">${L[0]}</span></td>
                <td><a class="mo-code" href="${esc(prodUrl(c.mouserNo))}" target="_blank" rel="noopener">${esc(c.mouserNo)}</a></td>
                <td style="white-space:normal;word-break:break-word;line-height:1.35">${esc(c.name||'')}</td>
                <td class="num">${detail}</td></tr>`; }).join('')}</tbody></table></div>`
            :`<div class="nx-empty">${icon('check2')}<div>이 날은 가격·재고 변동이 없습니다.</div></div>`}`;
        const sel=moBody.querySelector('#moDaySel'); if(sel) sel.onchange=()=>{ day=sel.value; render(); };
      }
      render();
    }

    // 주문내역 — 마우저 Order History API 로 주문·상태·송장 가져와 통합 표시(제조사 무관 · 필터 제공)
    const dhlUrl=t=>'https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id='+encodeURIComponent(String(t||'').replace(/\s/g,''));
    // 주문상태 영문(OrderStatusDisplay) → 한글 라벨(마우저 웹과 동일 표기)
    function statusKo(s){ const t=String(s||'').trim(); const m={
      'Warehouse Processing':'창고 처리중','Pick Started':'부품 선별중','Backordered':'이월 주문',
      'Complete':'완료','Cancelled':'취소됨','Canceled':'취소됨','Shipped':'배송됨','Invoiced':'청구완료',
      'In Process':'처리중','Processing':'처리중','Submitted':'접수됨','Pending':'대기중' };
      return m[t]||t; }
    // 주문상태 → 색/진행도(영문·한글 키워드로 분류). 상태 연동이 핵심이라 눈에 띄게.
    function statusStyle(s){ const t=String(s||'').toLowerCase();
      if(/취소|cancel|void/.test(t)) return {c:'#8a8f98',bg:'#eef0f3',pct:0};
      if(/완료|배송|invoiced|complete|shipped|delivered/.test(t)) return {c:'#12886a',bg:'#e6f7f0',pct:100};
      if(/이월|백오더|back\s*order|backorder/.test(t)) return {c:'#b4530a',bg:'#fff4e6',pct:35};
      if(/선별|처리|진행|프로세스|process|pick|pack|prepar|warehouse|submit/.test(t)) return {c:'#0a63c2',bg:'#e8f1fc',pct:60};
      return {c:'#4a4f57',bg:'#f0f2f5',pct:20}; }
    let ordersCache=null, ordFilter={status:'',buyer:'',q:''};
    async function paintOrders(){
      moBody.innerHTML='<div class="muted" style="padding:18px">주문내역 불러오는 중…</div>';
      let res=null; try{ const r=await fetch('/api/mouser-orders'); if(r.ok) res=await r.json(); }catch(e){}
      if(!root.isConnected) return;
      const manual=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0">
          <span class="muted" style="font-size:12px">송장/추적번호로 직접 조회:</span>
          <input id="moDhl" placeholder="DHL 추적번호" style="height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px;min-width:180px">
          <button class="btn sm" id="moDhlGo" style="background:#0a3d62;color:#fff">${icon('truck')}DHL 추적</button>
          <a class="btn ghost sm" href="https://www.mouser.kr/OrderHistory/" target="_blank" rel="noopener">마우저 주문내역 열기 ↗</a></div>`;
      const wireManual=()=>{ const go=()=>{ const t=(moBody.querySelector('#moDhl').value||'').trim(); if(!t){ toast('추적번호를 입력하세요'); return; } window.open(dhlUrl(t),'_blank','noopener'); };
        const b=moBody.querySelector('#moDhlGo'); if(b) b.onclick=go; const i=moBody.querySelector('#moDhl'); if(i) i.onkeydown=e=>{ if(e.key==='Enter') go(); }; };
      if(!res || res.configured===false){
        moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb">${icon('info')} 주문내역 자동연동 <b>대기</b> — 마우저 <b>Order History API 키</b> 설정 후 주문·<b>상태</b>·송장·추적번호가 자동 표시됩니다.<br>
          진단: <a href="/api/mouser-orders?raw=1" target="_blank" rel="noopener"><b>/api/mouser-orders?raw=1</b></a> 로 원응답을 확인하세요. (권한 없으면 빈 목록/오류 → automation팀에 OrderHistory 권한 요청)</div>${manual}`;
        wireManual(); return; }
      ordersCache=(res.orders||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
      renderOrders();
    }
    function renderOrders(){
      const all=ordersCache||[];
      const statuses=[...new Set(all.map(o=>o.status).filter(Boolean))];
      const buyers=[...new Set(all.map(o=>o.buyer).filter(Boolean))];
      const q=ordFilter.q.trim().toLowerCase();
      const list=all.filter(o=>
        (!ordFilter.status||o.status===ordFilter.status) &&
        (!ordFilter.buyer||o.buyer===ordFilter.buyer) &&
        (!q||[o.orderNo,o.salesNo,o.webNo,o.poNumber,o.tracking,o.invoiceNo].some(x=>String(x||'').toLowerCase().includes(q))));
      // 상태별 요약(진행중/완료/이월/취소)
      const cnt={done:0,proc:0,back:0,cancel:0};
      all.forEach(o=>{ const p=statusStyle(o.status).pct; if(/취소|cancel/.test(String(o.status).toLowerCase()))cnt.cancel++; else if(p>=100)cnt.done++; else if(/이월|back/.test(String(o.status).toLowerCase()))cnt.back++; else cnt.proc++; });
      const filters=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 0 12px">
          <select id="ordStatus" style="height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 8px">
            <option value="">전체 상태</option>${statuses.map(s=>`<option value="${esc(s)}" ${ordFilter.status===s?'selected':''}>${esc(statusKo(s))}</option>`).join('')}</select>
          ${buyers.length>1?`<select id="ordBuyer" style="height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 8px">
            <option value="">전체 구매자</option>${buyers.map(b=>`<option value="${esc(b)}" ${ordFilter.buyer===b?'selected':''}>${esc(b)}</option>`).join('')}</select>`:''}
          <input id="ordQ" type="search" value="${esc(ordFilter.q)}" placeholder="주문번호·PO·추적번호 검색" style="height:34px;flex:1;min-width:200px;max-width:340px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px">
          <span class="muted" style="font-size:12px;margin-left:auto">${list.length}/${all.length}건</span></div>`;
      const kpi=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          ${[['진행중',cnt.proc,'#0a63c2'],['완료',cnt.done,'#12886a'],['이월',cnt.back,'#b4530a'],['취소',cnt.cancel,'#8a8f98']].map(([l,n,c])=>
            `<span style="font-size:12px;font-weight:700;color:${c};background:${c}18;border:1px solid ${c}44;border-radius:8px;padding:4px 10px">${l} ${n}</span>`).join('')}</div>`;
      moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb;font-size:13.5px">${icon('box')} 마우저 <b>주문내역</b> (최근 12개월) — 제조사 구분 없이 <b>전체</b>. <b>주문상태</b>·금액·운송사 자동. <span class="muted">※ 추적번호는 마우저 API로 제공되지 않아, 하단에서 추적번호로 직접 조회하세요.</span></div>
        ${kpi}${filters}
        ${list.length?`<div class="nx-wrap" style="max-height:calc(100vh - 400px);overflow:auto"><table class="mo-t mo-ord" style="min-width:980px">
          <thead><tr><th style="width:104px">주문일</th><th style="width:180px">주문번호</th><th style="width:130px">구매자</th><th style="width:180px">주문상태</th><th style="text-align:right;width:120px">금액(KRW)</th><th>운송사</th></tr></thead>
          <tbody>${list.map(o=>{ const st=statusStyle(o.status); return `<tr>
            <td style="white-space:nowrap">${esc(o.date||'-')}</td>
            <td class="mo-code" style="white-space:normal;word-break:break-all">웹 ${esc(o.webNo||o.orderNo||'-')}${o.salesNo&&o.salesNo!==o.webNo?`<div class="osub">판매 ${esc(o.salesNo)}</div>`:''}${o.poNumber?`<div class="osub">PO ${esc(o.poNumber)}</div>`:''}</td>
            <td style="white-space:nowrap">${esc(o.buyer||'-')}</td>
            <td><span class="ost" style="color:${st.c};background:${st.bg}">${esc(statusKo(o.status)||'-')}</span>
              <div class="obar"><div style="width:${st.pct}%;height:100%;background:${st.c}"></div></div></td>
            <td class="num" style="font-weight:800">${o.total?won(o.total):'<span class="muted">-</span>'}</td>
            <td>${o.carrier?esc(o.carrier):'<span class="muted">-</span>'}${o.shipDate?`<div class="osub">배송 ${esc(o.shipDate)}</div>`:''}</td>
          </tr>`; }).join('')}</tbody></table></div>`
          :`<div class="nx-empty">${icon('box')}<div>${all.length?'필터에 맞는 주문이 없습니다.':'최근 12개월 주문내역이 없습니다.'}</div></div>`}
        ${manualOrders()}`;
      const ss=moBody.querySelector('#ordStatus'); if(ss) ss.onchange=()=>{ ordFilter.status=ss.value; renderOrders(); };
      const bs=moBody.querySelector('#ordBuyer'); if(bs) bs.onchange=()=>{ ordFilter.buyer=bs.value; renderOrders(); };
      const qq=moBody.querySelector('#ordQ'); if(qq) qq.oninput=()=>{ ordFilter.q=qq.value; renderOrders(); };
      wireManualOrders();
    }
    // 주문내역 하단 수동 추적(공통)
    function manualOrders(){ return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0">
        <span class="muted" style="font-size:12px">추적번호로 직접 조회:</span>
        <input id="moDhl" placeholder="DHL 추적번호" style="height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px;min-width:180px">
        <button class="btn sm" id="moDhlGo" style="background:#0a3d62;color:#fff">${icon('truck')}DHL 추적</button>
        <a class="btn ghost sm" href="https://www.mouser.kr/OrderHistory/" target="_blank" rel="noopener">마우저 주문내역 열기 ↗</a></div>`; }
    function wireManualOrders(){ const go=()=>{ const el2=moBody.querySelector('#moDhl'); const t=(el2&&el2.value||'').trim(); if(!t){ toast('추적번호를 입력하세요'); return; } window.open(dhlUrl(t),'_blank','noopener'); };
      const b=moBody.querySelector('#moDhlGo'); if(b) b.onclick=go; const i=moBody.querySelector('#moDhl'); if(i) i.onkeydown=e=>{ if(e.key==='Enter') go(); }; }

    renderCats(); applyViewChrome(); paint();
    // 최신 재고맵(크론 저장) + 팀 공유 자사코드 로드 후 반영 + 장바구니 배지
    loadStock().then(()=>{ if(root.isConnected && view==='stock') paint(); });
    loadEdShared().then(ch=>{ if(ch && root.isConnected && view==='stock') paint(); });
    refreshCart();
  }

  // 가격비교 탭으로 등록(엔티렉스 옆) — 여러 번 로드돼도 중복 방지
  window.PriceTabs = window.PriceTabs || [];
  if(!window.PriceTabs.some(t=>t.key==='mouser'))
    window.PriceTabs.push({ key:'mouser', name:'마우저', render:drawMouser });
})();
