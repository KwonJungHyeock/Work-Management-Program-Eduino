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
  // 자사(에듀이노) 상품 마스터 — 가격비교(엔티렉스) 공급가표 + 담당자 수정분을 ed(자사코드) 기준으로 조회.
  //  MD가 마우저 행에 자사코드를 입력하면 이 마스터에서 상품명·판매가·공급가·소비자가를 찾아 우측에 노출.
  const NF = window.NTREX_FIELDS || ['ed','ntx','name','price','supply','retail','note'];
  const ntxObj = a => Array.isArray(a) ? NF.reduce((o,k,i)=>(o[k]=a[i],o),{}) : a;
  function selfProducts(){
    const base={};
    (window.NTREX_PRODUCTS||[]).map(ntxObj).forEach(p=>{ const k=String(p.ed||'').trim(); if(k) base[k]=p; });
    const ov=store('eduino.ntrex.products').get({})||{};   // 담당자 추가·수정분(가격비교와 동일 저장소)
    Object.values(ov).forEach(o=>{ if(!o||o._del) return; const k=String(o.ed||'').trim(); if(k) base[k]={...(base[k]||{}),...o}; });
    return base;
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
    let selfMap=selfProducts();      // 자사코드(ed) → 자사 상품정보
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
        table.mo-t .c-no{width:112px} table.mo-t .c-ed{width:92px} table.mo-t .c-stk{width:104px} table.mo-t .c-pr{width:88px} table.mo-t .c-act{width:92px}
        table.mo-t .c-mine{width:auto}
        /* 자사 상품정보 칸 — 자사코드 매칭 시 우리 상품 노출 */
        .mo-mine{line-height:1.4} .mo-mine .nm{font-weight:600;color:var(--ink);white-space:normal;word-break:break-word}
        .mo-mine .pr{font-size:11px;color:var(--muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap}
        .mo-mine .pr .sup{color:#c0392b;font-weight:700} .mo-mine .pr .ret{color:#0070C0;font-weight:700}
        .mo-mine .none{color:var(--muted);font-size:11px}
        .mo-mine .hint{color:var(--muted);font-size:11px;opacity:.7}
        .mo-req{background:#0a3d62;color:#fff;border:0;border-radius:7px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
        .mo-req:hover{background:#0c4b78}
      </style>
      <div class="nx-note" id="moNote" style="border-left-color:#0a3d62;background:#eef4fb;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>${icon('truck')} <b>마우저 직소싱</b> — 즐겨찾기 <b>${all.length}</b>품목의 재고·가격을 확인하고, <b>[요청]</b>으로 결제요청+장바구니에 담습니다.
        <span id="moLiveState" class="muted" style="font-size:12px"></span></span>
        <span id="moCart" style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#0a3d62"></span>
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
      catBar.querySelectorAll('button').forEach(b=>b.onclick=()=>{ cat=b.dataset.c; paint(); }); }
    root.querySelectorAll('#moMfr .mo-tab').forEach(t=>t.onclick=()=>{ mfr=t.dataset.m;
      root.querySelectorAll('#moMfr .mo-tab').forEach(x=>x.classList.toggle('on',x.dataset.m===mfr)); renderCats(); paint(); });
    root.querySelectorAll('#moView button').forEach(b=>b.onclick=()=>{ view=b.dataset.v;
      root.querySelectorAll('#moView button').forEach(x=>x.classList.toggle('on',x.dataset.v===view)); paint(); });

    function rows(){ return all.filter(p=>p.mfr===mfr && p.category===cat); }

    // 자사코드(ed) → 자사 상품정보 셀 HTML. 입력 없으면 안내, 매칭 없으면 '등록 없음'.
    function mineCellHtml(ed){
      ed=String(ed||'').trim();
      if(!ed) return `<span class="hint">자사코드 입력 시 자사 상품정보 표시</span>`;
      const m=selfMap[ed];
      if(!m) return `<span class="none">자사 상품 DB에 <b>${esc(ed)}</b> 없음 <span style="opacity:.7">(가격비교 › 취급상품에 등록)</span></span>`;
      const pr=[];
      if(m.price) pr.push(`판매 ${won(m.price)}`);
      if(m.supply) pr.push(`<span class="sup">공급 ${won(m.supply)}</span>`);
      if(m.retail) pr.push(`<span class="ret">소비자 ${won(m.retail)}</span>`);
      return `<div class="nm">${esc(m.name||'(상품명 없음)')}</div>
        <div class="pr">${pr.join('')||'<span style="opacity:.7">가격 미등록</span>'}${m.ntx?`<span style="opacity:.7">엔티렉스 ${esc(m.ntx)}</span>`:''}</div>`;
    }

    function paint(){
      if(view==='orders'){ paintOrders(); return; }
      if(view==='changes'){ paintChanges(); return; }
      selfMap=selfProducts();
      const list=rows(); const em=edMap();
      moBody.innerHTML=`<div class="nx-wrap" style="max-height:calc(100vh - 330px)"><table class="mo-t">
        <colgroup><col class="c-no"><col class="c-ed"><col class="c-nm"><col class="c-stk"><col class="c-pr"><col class="c-mine"><col class="c-act"></colgroup>
        <thead><tr>
          <th>마우저 번호</th><th>자사코드</th><th>상품명</th>
          <th style="text-align:right">재고/입고</th><th style="text-align:right">가격</th><th>자사 상품정보</th><th style="text-align:center">요청</th></tr></thead>
        <tbody>${list.length?list.map(p=>{
          const ed=em[p.mouserNo]!=null?em[p.mouserNo]:(p.edCode||'');
          return `<tr data-no="${esc(p.mouserNo)}">
            <td><a class="mo-code" href="${esc(prodUrl(p.mouserNo))}" target="_blank" rel="noopener">${esc(p.mouserNo)}</a><div class="muted" style="font-size:10.5px">${esc(p.mfrNo||'')}</div></td>
            <td class="mo-ed">${canEdit()?`<input data-ed="${esc(p.mouserNo)}" value="${esc(ed)}" placeholder="미보유">`:esc(ed||'-')}</td>
            <td style="white-space:normal;word-break:break-word;line-height:1.35">${esc(p.name||'')}</td>
            <td class="num" data-stk><span class="mo-stk wait">–</span></td>
            <td class="num" data-price><span class="mo-price">${won(p.basePriceKRW)}</span><div class="mo-base">기준가</div></td>
            <td class="mo-mine" data-mine="${esc(p.mouserNo)}">${mineCellHtml(ed)}</td>
            <td style="white-space:nowrap;text-align:center">
              <input class="mo-qty" data-qty="${esc(p.mouserNo)}" value="1" inputmode="numeric" maxlength="2">
              <button class="mo-req" data-req="${esc(p.mouserNo)}" title="결제요청에 추가 + 마우저 열기">요청</button>
            </td></tr>`; }).join('')
          :`<tr><td colspan="7" class="nx-empty">이 카테고리에 품목이 없습니다.</td></tr>`}</tbody></table></div>`;
      // 자사코드 인라인 편집 → 저장 + 우측 자사 상품정보 즉시 갱신
      moBody.querySelectorAll('[data-ed]').forEach(inp=>inp.onchange=()=>{ const v=inp.value.trim(); setEd(inp.dataset.ed, v);
        const cell=moBody.querySelector(`[data-mine="${CSS.escape(inp.dataset.ed)}"]`); if(cell) cell.innerHTML=mineCellHtml(v); });
      // 결제요청
      moBody.querySelectorAll('[data-req]').forEach(b=>b.onclick=()=>requestPay(b.dataset.req));
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
        else{ const info = d.nextDate ? `입고예정 <b>${esc(d.nextDate)}</b>${d.onOrderQty?` · ${won(d.onOrderQty)}`:''}` : esc(d.availability||d.lead||'입고 문의');
          stkTd.innerHTML=`<span class="mo-stk out">0</span><div class="mo-lead">${info}${srcNote}</div>`; }
        if(d.priceKRW>0) prTd.innerHTML=`<span class="mo-price">${won(d.priceKRW)}</span><div class="mo-base">${viaCart?'카트조회가':'현재가'}</div>`;
      });
    }
    async function loadStock(){ try{ const r=await fetch('/api/store?type=coll&coll=mouser_stock'); if(!r.ok) return;
      const dd=await r.json(); const it=(dd&&dd.items||[]).find(x=>x&&x.id==='latest'); if(it){ stockMap=it.parts||{}; stockAt=it.at||''; } }catch(e){} }

    // 장바구니 배지 — [내용]으로 담긴 품목을 프로그램 안에서 바로 확인, [열기]로 API 카트(CartKey) 연결
    let lastCart=null;
    async function refreshCart(){ const box=root.querySelector('#moCart'); if(!box) return;
      const r=await cartApi('get'); if(!root.isConnected||!box) return;
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
        toast(`결제요청 추가 + 마우저 장바구니에 담았습니다 (${p.mouserNo} × ${qty}) — 배지 [내용]에서 확인`); refreshCart();
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

    // 주문내역 — 마우저 Order History API 로 주문·상태·송장 가져와 표시(송장→DHL 자동)
    const dhlUrl=t=>'https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id='+encodeURIComponent(String(t||'').replace(/\s/g,''));
    async function paintOrders(){
      moBody.innerHTML='<div class="muted" style="padding:18px">주문내역 불러오는 중…</div>';
      let res=null; try{ const r=await fetch('/api/mouser-orders'); if(r.ok) res=await r.json(); }catch(e){}
      if(!root.isConnected) return;
      const manual=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0">
          <span class="muted" style="font-size:12px">송장으로 직접 추적:</span>
          <input id="moDhl" placeholder="DHL 송장(추적) 번호" style="height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 12px;min-width:200px">
          <button class="btn sm" id="moDhlGo" style="background:#0a3d62;color:#fff">${icon('truck')}DHL 추적</button>
          <a class="btn ghost sm" href="https://www.mouser.kr/OrderHistory/" target="_blank" rel="noopener">마우저 주문내역 열기</a></div>`;
      const wireManual=()=>{ const go=()=>{ const t=(moBody.querySelector('#moDhl').value||'').trim(); if(!t){ toast('DHL 송장번호를 입력하세요'); return; } window.open(dhlUrl(t),'_blank','noopener'); };
        const b=moBody.querySelector('#moDhlGo'); if(b) b.onclick=go; const i=moBody.querySelector('#moDhl'); if(i) i.onkeydown=e=>{ if(e.key==='Enter') go(); }; };
      if(!res || res.configured===false){
        moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb">${icon('info')} 주문내역 자동연동 <b>대기</b> — 마우저 <b>Order History API 키</b> 설정 후 주문·상태·송장이 자동 표시됩니다. (진단: <a href="/api/mouser-orders?raw=1" target="_blank" rel="noopener">/api/mouser-orders?raw=1</a>)</div>${manual}`;
        wireManual(); return; }
      const orders=res.orders||[];
      moBody.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb">${icon('box')} 마우저 <b>주문내역</b> ${orders.length}건 (최근 12개월) · 상태·송장 자동. 송장의 <b>[DHL]</b>로 배송추적을 엽니다.</div>
        ${orders.length?`<div class="nx-wrap" style="max-height:calc(100vh - 340px)"><table class="mo-t" style="width:100%">
          <thead><tr><th>주문번호</th><th>주문일</th><th>상태</th><th style="text-align:right">금액</th><th>송장/배송추적</th></tr></thead>
          <tbody>${orders.map(o=>`<tr>
            <td class="mo-code">${esc(o.orderNo||'-')}${o.poNumber?`<div class="muted" style="font-size:10.5px">PO ${esc(o.poNumber)}</div>`:''}</td>
            <td style="white-space:nowrap">${esc(o.date||'-')}</td>
            <td><span style="font-weight:700">${esc(o.status||'-')}</span></td>
            <td class="num">${esc(o.total||'')}</td>
            <td>${o.tracking?`${esc(o.carrier||'')} ${esc(o.tracking)} <a class="btn ghost sm" href="${esc(dhlUrl(o.tracking))}" target="_blank" rel="noopener" style="padding:2px 8px">DHL</a>`:'<span class="muted">-</span>'}</td>
          </tr>`).join('')}</tbody></table></div>`
          :`<div class="nx-empty">${icon('box')}<div>최근 12개월 주문내역이 없습니다.</div></div>`}
        ${manual}`;
      wireManual();
    }

    renderCats(); paint();
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
