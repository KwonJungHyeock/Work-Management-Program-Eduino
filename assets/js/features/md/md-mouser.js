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
  const EDMAP_KEY='eduino.mouser.edmap';                 // { mouserNo: 자사코드 }
  const edMap = ()=> store(EDMAP_KEY).get({})||{};
  const setEd = (no,code)=>{ const m=edMap(); if(code) m[no]=code; else delete m[no]; store(EDMAP_KEY).set(m); };
  const meU = ()=> (Auth.user&&Auth.user())||{};
  const canEdit = ()=> !!(Auth.isAdmin&&Auth.isAdmin()) || meU().dept==='md' || meU().role==='lead';
  const prodUrl = no => `https://www.mouser.kr/ProductDetail/${encodeURIComponent(no)}`;

  // 실시간 재고·현재가 조회(서버 프록시) — 보이는 품목만 조회해 호출 최소화
  async function fetchLive(nos){
    try{ const r=await fetch('/api/mouser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mouserNos:nos})});
      if(!r.ok) return null; return await r.json(); }catch(e){ return null; }
  }

  function drawMouser(root){
    const all=PARTS();
    const mfrs=[...new Set(all.map(p=>p.mfr))];
    let mfr=mfrs[0]||'', cat='', view='stock';
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
        /* 마우저 표 — 공간 효율: 상품명이 남는 폭 흡수, 숫자·액션 칸은 최소폭 */
        table.mo-t{border-collapse:collapse;width:100%;font-size:12.5px;table-layout:fixed}
        table.mo-t th{position:sticky;top:0;background:var(--panel-2);color:var(--ink-2);font-size:11px;font-weight:800;text-align:left;padding:7px 8px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.mo-t td{padding:6px 8px;border-bottom:1px solid var(--line);color:var(--ink-2);vertical-align:top}
        table.mo-t td.num{text-align:right;font-variant-numeric:tabular-nums}
        table.mo-t .c-no{width:112px} table.mo-t .c-ed{width:96px} table.mo-t .c-stk{width:66px} table.mo-t .c-pr{width:84px} table.mo-t .c-act{width:104px}
        .mo-req{background:#0a3d62;color:#fff;border:0;border-radius:7px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
        .mo-req:hover{background:#0c4b78}
      </style>
      <div class="nx-note" id="moNote" style="border-left-color:#0a3d62;background:#eef4fb">
        ${icon('truck')} <b>마우저 직소싱</b> — 즐겨찾기 <b>${all.length}</b>품목의 재고·가격을 확인하고, <b>[결제요청]</b>으로 구매 요청을 올립니다.
        <span id="moLiveState" class="muted" style="font-size:12px"></span>
      </div>
      <div class="mo-tabs" id="moMfr">${mfrs.map(m=>`<div class="mo-tab${m===mfr?' on':''}" data-m="${esc(m)}">${esc(m)} <span class="muted" style="font-weight:600;font-size:11px">${all.filter(p=>p.mfr===m).length}</span></div>`).join('')}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span class="mo-sub" id="moCat"></span>
        <span class="mo-view" id="moView"><button data-v="stock" class="on">재고·비교</button><button data-v="orders">주문현황</button></span>
      </div>
      <div id="moBody"></div>`;

    const catBar=root.querySelector('#moCat'), moBody=root.querySelector('#moBody');
    function renderCats(){ const cats=catsOf(mfr); if(!cats.includes(cat)) cat=cats[0]||'';
      catBar.innerHTML=cats.map(c=>`<button data-c="${esc(c)}" class="${c===cat?'on':''}">${esc(c)}</button>`).join('');
      catBar.querySelectorAll('button').forEach(b=>b.onclick=()=>{ cat=b.dataset.c; paint(); }); }
    root.querySelectorAll('#moMfr .mo-tab').forEach(t=>t.onclick=()=>{ mfr=t.dataset.m;
      root.querySelectorAll('#moMfr .mo-tab').forEach(x=>x.classList.toggle('on',x.dataset.m===mfr)); renderCats(); paint(); });
    root.querySelectorAll('#moView button').forEach(b=>b.onclick=()=>{ view=b.dataset.v;
      root.querySelectorAll('#moView button').forEach(x=>x.classList.toggle('on',x.dataset.v===view)); paint(); });

    function rows(){ return all.filter(p=>p.mfr===mfr && p.category===cat); }

    function paint(){
      if(view==='orders'){ paintOrders(); return; }
      const list=rows(); const em=edMap();
      moBody.innerHTML=`<div class="nx-wrap" style="max-height:calc(100vh - 330px)"><table class="mo-t">
        <colgroup><col class="c-no"><col class="c-ed"><col><col class="c-stk"><col class="c-pr"><col class="c-act"></colgroup>
        <thead><tr>
          <th>마우저 번호</th><th>자사코드</th><th>상품명</th>
          <th style="text-align:right">재고/입고</th><th style="text-align:right">가격</th><th style="text-align:center">요청</th></tr></thead>
        <tbody>${list.length?list.map(p=>{
          const ed=em[p.mouserNo]!=null?em[p.mouserNo]:(p.edCode||'');
          return `<tr data-no="${esc(p.mouserNo)}">
            <td><a class="mo-code" href="${esc(prodUrl(p.mouserNo))}" target="_blank" rel="noopener">${esc(p.mouserNo)}</a><div class="muted" style="font-size:10.5px">${esc(p.mfrNo||'')}</div></td>
            <td class="mo-ed">${canEdit()?`<input data-ed="${esc(p.mouserNo)}" value="${esc(ed)}" placeholder="미보유">`:esc(ed||'-')}</td>
            <td style="white-space:normal;word-break:break-word;line-height:1.35">${esc(p.name||'')}</td>
            <td class="num" data-stk><span class="mo-stk wait">–</span></td>
            <td class="num" data-price><span class="mo-price">${won(p.basePriceKRW)}</span><div class="mo-base">기준가</div></td>
            <td style="white-space:nowrap;text-align:center">
              <input class="mo-qty" data-qty="${esc(p.mouserNo)}" value="1" inputmode="numeric" maxlength="2">
              <button class="mo-req" data-req="${esc(p.mouserNo)}" title="결제요청에 추가 + 마우저 열기">요청</button>
            </td></tr>`; }).join('')
          :`<tr><td colspan="6" class="nx-empty">이 카테고리에 품목이 없습니다.</td></tr>`}</tbody></table></div>`;
      // 자사코드 인라인 편집
      moBody.querySelectorAll('[data-ed]').forEach(inp=>inp.onchange=()=>setEd(inp.dataset.ed, inp.value.trim()));
      // 결제요청
      moBody.querySelectorAll('[data-req]').forEach(b=>b.onclick=()=>requestPay(b.dataset.req));
      // 실시간 재고/가격 채우기(보이는 품목만)
      loadLive(list.map(p=>p.mouserNo));
    }

    async function loadLive(nos){
      if(!nos.length) return;
      const st=root.querySelector('#moLiveState'); if(st) st.textContent=' · 실시간 조회 중…';
      const res=await fetchLive(nos);
      if(!root.isConnected) return;
      if(!res || res.configured===false){ if(st) st.innerHTML=' · <b style="color:var(--warn)">실시간 연동 대기</b> (서버에 MOUSER_API_KEY 설정 시 자동 표시 · 현재는 기준가)'; return; }
      if(st) st.textContent=' · 실시간 재고·가격 반영됨';
      const data=res.data||{};
      nos.forEach(no=>{ const d=data[no]; const tr=moBody.querySelector(`tr[data-no="${CSS.escape(no)}"]`); if(!tr||!d) return;
        const stkTd=tr.querySelector('[data-stk]'), prTd=tr.querySelector('[data-price]');
        if(d.found){
          if(d.inStock>0) stkTd.innerHTML=`<span class="mo-stk in">${won(d.inStock)}</span><div class="mo-lead">재고 보유</div>`;
          else stkTd.innerHTML=`<span class="mo-stk out">0</span><div class="mo-lead">${esc(d.lead||d.availability||'입고 문의')}</div>`;
          if(d.priceKRW>0) prTd.innerHTML=`<span class="mo-price">${won(d.priceKRW)}</span><div class="mo-base">현재가</div>`;
        } else stkTd.innerHTML=`<span class="mo-stk wait">확인불가</span>`;
      });
    }

    function requestPay(no){
      const p=all.find(x=>x.mouserNo===no); if(!p) return;
      const qtyEl=moBody.querySelector(`[data-qty="${CSS.escape(no)}"]`); const qty=Math.max(1, Number((qtyEl&&qtyEl.value||'1').replace(/[^\d]/g,''))||1);
      // 현재가 셀에서 단가 추출(없으면 기준가)
      const prTd=moBody.querySelector(`tr[data-no="${CSS.escape(no)}"] [data-price] .mo-price`);
      const unit=prTd?Number(prTd.textContent.replace(/[^\d]/g,''))||p.basePriceKRW:p.basePriceKRW;
      const me=meU(); const today=todayStr();
      const rec={ id:uuid(), day:today, date:today, kind:'발주', orderer:'', vendor:'Mouser',
        content:`[${p.mouserNo}${(edMap()[no]||p.edCode)?' · '+(edMap()[no]||p.edCode):''}] ${p.name||''}`,
        qty:String(qty), amount:unit*qty, account:'', prodAmount:unit*qty, ship:0,
        whoName:me.name||'', who:me.loginId||me.name||'', createdAt:nowISO(), source:'mouser', mouserNo:no };
      if(window.Records) Records.pushRaw('md','payreq',rec);
      // 마우저 상품 페이지 열기(장바구니 담기용 — 자동담기는 이후 단계)
      try{ window.open(prodUrl(no),'_blank','noopener'); }catch(e){}
      toast('결제요청에 추가했습니다 · 마우저 상품페이지를 열었습니다');
    }

    // 주문현황(Phase 1 최소) — 결제요청→주문된 마우저 건 표시 + DHL 추적 링크
    async function paintOrders(){
      moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb">
        마우저 주문 완료 건과 배송추적을 확인합니다. <b>실시간 주문상태 자동연동</b>은 마우저 주문 API 연결(다음 단계) 후 제공되며,
        지금은 <b>DHL 송장번호</b>로 추적 링크를 열 수 있습니다.</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
          <input id="moDhl" placeholder="DHL 송장(추적) 번호" style="height:38px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px;min-width:220px">
          <button class="btn pri" id="moDhlGo" style="background:#0a3d62">${icon('truck')}DHL 배송추적 열기</button>
          <a class="btn ghost" href="https://www.mouser.kr/OrderHistory/" target="_blank" rel="noopener">${icon('chart')}마우저 주문내역 열기</a>
        </div>
        <div class="nx-empty">${icon('box')}<div>주문현황 자동표시는 다음 단계(주문 API)에서 연결됩니다.</div></div>`;
      const go=()=>{ const t=(moBody.querySelector('#moDhl').value||'').replace(/\s/g,''); if(!t){ toast('DHL 송장번호를 입력하세요'); return; }
        window.open('https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id='+encodeURIComponent(t),'_blank','noopener'); };
      moBody.querySelector('#moDhlGo').onclick=go;
      moBody.querySelector('#moDhl').onkeydown=e=>{ if(e.key==='Enter') go(); };
    }

    renderCats(); paint();
  }

  // 가격비교 탭으로 등록(엔티렉스 옆) — 여러 번 로드돼도 중복 방지
  window.PriceTabs = window.PriceTabs || [];
  if(!window.PriceTabs.some(t=>t.key==='mouser'))
    window.PriceTabs.push({ key:'mouser', name:'마우저', render:drawMouser });
})();
