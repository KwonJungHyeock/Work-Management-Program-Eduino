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
  const won = n => Number(n||0).toLocaleString('ko-KR');

  /* ── 품목 오버레이 (팀 공유 coll 'mouser_parts') ──────────────────────────
     시드(mouser-data.js)는 그대로 두고, 추가·카테고리수정·삭제분만 오버레이로 저장.
     · 엑셀(프로젝트 매니저) 불러오기로 추가한 품목도 여기에 쌓임
     · 병합 규칙: 시드 → 오버레이 덮어쓰기 → 오버레이 전용 신규품목 추가 (del=삭제표시) */
  const PARTS_COLL='mouser_parts', POV_KEY='eduino.mouser.parts';
  let povState = store(POV_KEY).get({}) || {};
  async function loadOverlay(){
    try{ const r=await fetch('/api/store?type=coll&coll='+PARTS_COLL); if(!r.ok) return false;
      const d=await r.json(); const m={}; ((d&&d.items)||[]).forEach(it=>{ if(it&&it.id) m[String(it.id)]=it; });
      povState=m; store(POV_KEY).set(m); return true; }catch(e){ return false; }
  }
  function putPart(p){ const id=String(p.mouserNo||p.id||'').trim(); if(!id) return;
    const item={ ...p, id }; povState[id]=item; store(POV_KEY).set(povState);
    try{ fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({op:'collPush',coll:PARTS_COLL,item})}).catch(()=>{}); }catch(e){}
  }
  /* ── 탭(제조사/프로젝트) 목록 (팀 공유 coll 'mouser_tabs') ───────────────────
     품목에서 자동으로 생기는 탭 + 사용자가 직접 추가한 빈 탭을 합쳐서 보여줌.
     (마우저 프로젝트 = 제조사_카테고리 → 프로젝트를 탭으로 시트화하는 용도) */
  const TABS_COLL='mouser_tabs', TABS_KEY='eduino.mouser.tabs';
  let tabState = store(TABS_KEY).get({}) || {};
  async function loadTabs(){
    try{ const r=await fetch('/api/store?type=coll&coll='+TABS_COLL); if(!r.ok) return false;
      const d=await r.json(); const m={}; ((d&&d.items)||[]).forEach(it=>{ if(it&&it.id) m[String(it.id)]=it; });
      tabState=m; store(TABS_KEY).set(m); return true; }catch(e){ return false; }
  }
  function putTab(name, order){ const id=String(name||'').trim(); if(!id) return;
    const item={ id, name:id, order:order==null?999:order }; tabState[id]=item; store(TABS_KEY).set(tabState);
    try{ fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({op:'collPush',coll:TABS_COLL,item})}).catch(()=>{}); }catch(e){}
  }
  function dropTab(name){ const id=String(name||'').trim(); if(!id) return; delete tabState[id]; store(TABS_KEY).set(tabState);
    try{ fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({op:'collDel',coll:TABS_COLL,id})}).catch(()=>{}); }catch(e){}
  }
  // 탭 이름 매칭용 정규화 — "SEEEDSTUDIO" ↔ "Seeed Studio", "RASPBERRY PI" ↔ "Raspberry Pi"
  const normTab = s => String(s||'').replace(/[\s_\-.]/g,'').toLowerCase();

  const SEED = ()=> (window.MOUSER_PARTS||[]).map(toObj);
  const PARTS = ()=>{
    const ov=povState||{}, out=[], seen=new Set();
    SEED().forEach(p=>{ const o=ov[p.mouserNo]; seen.add(p.mouserNo);
      if(o && o.del) return;                                   // 삭제 표시된 시드 품목은 제외
      out.push(o ? { ...p, ...o, mouserNo:p.mouserNo } : p); });
    Object.keys(ov).forEach(k=>{ const o=ov[k]; if(!o || o.del || seen.has(k)) return; out.push(toObj(o)); });
    return out;
  };
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
  /* 결제요청에 넣을 계좌 — 입점사 정보에 해당 업체(마우저)가 등록돼 있으면 자동 연동 */
  function venAcctOf(name){
    try{
      const ov=(typeof STORE!=='undefined'&&STORE.mdVendors)?store(STORE.mdVendors).get(null):null;
      const list=(Array.isArray(ov)&&ov.length)?ov:((typeof DEFAULT_MD_VENDORS!=='undefined'&&DEFAULT_MD_VENDORS)||[]);
      const n=String(name||'').trim(); if(!n) return '';
      const ex=list.find(v=>v&&String(v.name||'').trim()===n); if(ex&&ex.account) return String(ex.account);
      if(typeof normCoName!=='function') return '';
      const k=normCoName(n); const m=k?list.find(v=>v&&normCoName(v.name)===k):null;
      return (m&&m.account)?String(m.account):'';
    }catch(e){ return ''; }
  }

  function drawMouser(root){
    let all=PARTS();
    const ALL='__all';                 // 전체 상품 리스트(제조사 구분 없이)
    // 탭 = 품목에서 자동으로 생긴 것 + 직접 추가한 빈 탭 (추가 탭은 order 순으로 뒤에)
    const mfrsOf=()=>{ const fromParts=[...new Set(all.map(p=>p.mfr).filter(Boolean))];
      const set=new Set(fromParts);
      Object.values(tabState||{}).sort((a,b)=>(a.order||999)-(b.order||999)).forEach(t=>{ if(t&&t.name) set.add(t.name); });
      return [...set]; };
    let mfrs=mfrsOf();
    let mfr=mfrs[0]||'', cat='', view='stock', q='', sortBy='default', filterBy='all';
    let stockMap=null, stockAt='';   // 크론이 저장한 최신 재고맵(coll mouser_stock)
    const catsOf=m=> m===ALL ? [] : [...new Set(all.filter(p=>p.mfr===m).map(p=>p.category).filter(Boolean))];
    cat=catsOf(mfr)[0]||'';

    root.innerHTML=`
      <style>
        .mo-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
        .mo-tab{border:1px solid var(--line-2);background:var(--panel);border-radius:9px;padding:8px 16px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer}
        .mo-tab.on{background:#0a3d62;color:#fff;border-color:#0a3d62}
        .mo-sub{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .mo-sub button{border:0;background:var(--panel);padding:7px 14px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .mo-sub button:first-child{border-left:0} .mo-sub button.on{background:var(--active-bg);color:#0a3d62}
        /* 상단 바 — 좌측(탭·카테고리)은 가변, 우측(화면전환·검색·도구)은 항상 같은 자리 */
        .mo-bar1{display:flex;align-items:center;gap:12px;margin-bottom:10px}
        .mo-bar1 .mo-tabs{flex:1 1 auto;min-width:0;margin-bottom:0}
        .mo-bar1 .mo-view{flex:0 0 auto;margin-left:auto}
        .mo-bar2{display:flex;align-items:center;gap:12px;margin-bottom:12px;min-height:36px}
        .mo-bar2 .mo-sub{flex:0 1 auto;min-width:0}
        .mo-bar2-r{flex:0 0 auto;margin-left:auto;display:flex;align-items:center;gap:8px}
        @media(max-width:900px){ .mo-bar1,.mo-bar2{flex-wrap:wrap} .mo-bar2-r{margin-left:0;width:100%} .mo-search{flex:1} }
        .mo-search{height:34px;border:1px solid var(--line-2);border-radius:9px;padding:0 12px;font:inherit;font-size:12.5px;width:230px;background:var(--panel);color:var(--ink)}
        .mo-sel{height:34px;border:1px solid var(--line-2);border-radius:9px;padding:0 8px;font:inherit;font-size:12.5px;background:var(--panel);color:var(--ink);cursor:pointer}
        .mo-search:focus{outline:2px solid #0a3d6233;border-color:#0a3d62}
        .mo-mgr{width:100%;border-collapse:collapse;font-size:12.5px}
        .mo-mgr th{position:sticky;top:0;background:var(--panel-2);font-size:11px;font-weight:800;color:var(--muted);text-align:left;padding:7px 8px;border-bottom:1px solid var(--line-2);z-index:1}
        .mo-mgr td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
        .mo-mgr input{width:100%;height:28px;border:1px solid var(--line-2);border-radius:6px;padding:0 7px;font:inherit;font-size:12.5px;background:var(--panel);color:var(--ink)}
        .mo-mgr .del{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:14px;border-radius:6px;padding:2px 6px}
        .mo-mgr .del:hover{background:#fdecea;color:#c0392b}
        .mo-mgr tr.gone td{opacity:.42;text-decoration:line-through}
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
      <!-- 1행: 제조사 탭(좌) · 화면 전환(우 고정) -->
      <div class="mo-bar1">
        <div class="mo-tabs" id="moMfr"></div>
        <span class="mo-view" id="moView"><button data-v="stock" class="on">재고·비교</button><button data-v="changes">변동 알림</button><button data-v="orders">주문내역</button></span>
      </div>
      <!-- 2행: 카테고리(좌) · 검색+도구(우 고정) — 탭이 바뀌어도 우측 위치가 흔들리지 않게 -->
      <div class="mo-bar2" id="moBar2">
        <span class="mo-sub" id="moCat"></span>
        <span class="mo-bar2-r">
          <select id="moSort" class="mo-sel" title="정렬 기준">
            <option value="default">정렬: 기본</option>
            <option value="no">마우저번호 ↑</option>
            <option value="no_d">마우저번호 ↓</option>
            <option value="ed">자사코드 ↑</option>
            <option value="name">상품명 ↑</option>
            <option value="price">마우저 원가 ↑</option>
            <option value="price_d">마우저 원가 ↓</option>
            <option value="stock_d">재고 많은순</option>
          </select>
          <select id="moFilter" class="mo-sel" title="표시 조건">
            <option value="all">필터: 전체</option>
            <option value="ed">자사코드 보유</option>
            <option value="noed">자사코드 미보유</option>
            <option value="instock">재고 보유</option>
            <option value="nostock">재고 없음·확인불가</option>
          </select>
          <input id="moQ" class="mo-search" type="search" placeholder="상품 검색 — 마우저번호·상품명·자사코드" autocomplete="off">
          <button class="btn sm" id="moExport" title="지금 보이는 목록을 엑셀(.xlsx)로 내려받기">${icon('download')}엑셀 내보내기</button>
          ${canEdit()?`<span id="moTools" style="display:flex;gap:6px">
            <button class="btn sm" id="moImport" title="마우저 [프로젝트 매니저] 엑셀(.xls/.xlsx)에서 품목 불러오기">${icon('upload')}엑셀 불러오기</button>
            <button class="btn sm" id="moManage" title="탭·품목·카테고리 관리">${icon('grid')}탭·품목 관리</button></span>`:''}
        </span>
      </div>
      <input type="file" id="moFile" accept=".xls,.xlsx,application/vnd.ms-excel" style="display:none">
      <div id="moBody"></div>`;

    const catBar=root.querySelector('#moCat'), moBody=root.querySelector('#moBody');
    const mfrBarEl=root.querySelector('#moMfr');
    // 제조사 탭 — 마지막에 [전체] 탭(제조사 구분 없이 등록 상품 전체)
    function renderMfrs(){
      mfrBarEl.innerHTML = mfrs.map(m=>`<div class="mo-tab${m===mfr?' on':''}" data-m="${esc(m)}">${esc(m)} <span class="muted" style="font-weight:600;font-size:11px">${all.filter(p=>p.mfr===m).length}</span></div>`).join('')
        + `<div class="mo-tab${mfr===ALL?' on':''}" data-m="${ALL}" title="제조사 구분 없이 등록된 마우저 상품 전체">전체 <span class="muted" style="font-weight:600;font-size:11px">${all.length}</span></div>`;
      mfrBarEl.querySelectorAll('.mo-tab').forEach(t=>t.onclick=()=>{ mfr=t.dataset.m;
        mfrBarEl.querySelectorAll('.mo-tab').forEach(x=>x.classList.toggle('on',x.dataset.m===mfr)); renderCats(); paint(); });
    }
    function renderCats(){ const cats=catsOf(mfr);
      if(mfr===ALL || !cats.length){ catBar.style.visibility='hidden'; catBar.innerHTML=''; return; }
      catBar.style.visibility=''; if(!cats.includes(cat)) cat=cats[0]||'';
      catBar.innerHTML=cats.map(c=>`<button data-c="${esc(c)}" class="${c===cat?'on':''}">${esc(c)}</button>`).join('');
      catBar.querySelectorAll('button').forEach(b=>b.onclick=()=>{ cat=b.dataset.c;
        catBar.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.c===cat)); paint(); }); }
    renderMfrs();
    root.querySelectorAll('#moView button').forEach(b=>b.onclick=()=>{ view=b.dataset.v;
      root.querySelectorAll('#moView button').forEach(x=>x.classList.toggle('on',x.dataset.v===view)); applyViewChrome(); paint(); });
    // 주문내역·변동알림은 제조사와 무관 → 제조사/카테고리/검색 숨김(재고·비교에서만 표시)
    function applyViewChrome(){ const per=(view==='stock');
      if(mfrBarEl) mfrBarEl.style.visibility=per?'':'hidden';   // 자리는 유지 → 화면전환 버튼 위치 고정
      const bar2=root.querySelector('#moBar2'); if(bar2) bar2.style.display=per?'':'none';
      if(catBar) catBar.style.visibility=(per && mfr!==ALL && catsOf(mfr).length)?'':'hidden'; }

    // 상품 검색 — 마우저번호·상품명·제조사번호·자사코드·제조사·카테고리
    const qEl=root.querySelector('#moQ');
    if(qEl) qEl.oninput=()=>{ q=qEl.value.trim().toLowerCase(); paint(); };
    const sortEl=root.querySelector('#moSort'), filEl=root.querySelector('#moFilter');
    if(sortEl) sortEl.onchange=()=>{ sortBy=sortEl.value; paint(); };
    if(filEl)  filEl.onchange =()=>{ filterBy=filEl.value; paint(); };
    function matchQ(p){ if(!q) return true;
      const ed=edOf(p.mouserNo)||'';
      return `${p.mouserNo} ${p.mfrNo||''} ${p.name||''} ${ed} ${p.mfr||''} ${p.category||''}`.toLowerCase().includes(q); }

    // 재고 수량(크론 재고맵) — 정렬·필터용. 확인불가/미조사는 -1
    const stockOf = p => { const d=stockMap&&stockMap[p.mouserNo]; return (d&&d.found)? (Number(d.inStock)||0) : -1; };
    const kNum = s => String(s||'').replace(/\D/g,'');   // 마우저번호 숫자부(정렬 안정화)
    function rows(){
      const base = (mfr===ALL) ? all.slice()
        : all.filter(p=>p.mfr===mfr && (!catsOf(mfr).length || p.category===cat));
      let list = base.filter(matchQ);
      // 표시 조건
      if(filterBy==='ed')      list=list.filter(p=>!!edOf(p.mouserNo));
      else if(filterBy==='noed')    list=list.filter(p=>!edOf(p.mouserNo));
      else if(filterBy==='instock') list=list.filter(p=>stockOf(p)>0);
      else if(filterBy==='nostock') list=list.filter(p=>stockOf(p)<=0);
      // 정렬 — 행 배선은 마우저번호 기준이라 순서를 바꿔도 자사코드 매칭은 그대로 유지됨
      const byNo=(a,b)=> String(a.mouserNo).localeCompare(String(b.mouserNo),'en',{numeric:true});
      const cmp={
        no:  byNo,
        no_d:(a,b)=>-byNo(a,b),
        ed:  (a,b)=>{ const x=edOf(a.mouserNo)||'', y=edOf(b.mouserNo)||'';
               if(!x&&!y) return byNo(a,b); if(!x) return 1; if(!y) return -1;   // 미보유는 뒤로
               return x.localeCompare(y,'en',{numeric:true}) || byNo(a,b); },
        name:(a,b)=> String(a.name||'').localeCompare(String(b.name||''),'ko') || byNo(a,b),
        price:(a,b)=> (mouserBuyOf(a)-mouserBuyOf(b)) || byNo(a,b),
        price_d:(a,b)=> (mouserBuyOf(b)-mouserBuyOf(a)) || byNo(a,b),
        stock_d:(a,b)=> (stockOf(b)-stockOf(a)) || byNo(a,b),
      }[sortBy];
      if(cmp) list.sort(cmp);
      else if(mfr===ALL) list.sort((a,b)=> String(a.mfr||'').localeCompare(String(b.mfr||'')) || String(a.category||'').localeCompare(String(b.category||'')) || byNo(a,b));
      return list;
    }
    // 품목 변경(불러오기·카테고리 수정·삭제) 후 화면 재구성
    function refreshParts(){ all=PARTS(); mfrs=mfrsOf();
      if(mfr!==ALL && !mfrs.includes(mfr)) mfr=mfrs[0]||ALL;
      renderMfrs(); renderCats(); paint(); }

    // 마우저 원가(현지 판매가) — 크론 재고맵의 현재가 우선, 없으면 시드 기준가
    function mouserBuyOf(p){ const d=stockMap&&stockMap[p.mouserNo]; if(d&&d.found&&d.priceKRW>0) return d.priceKRW; return p.basePriceKRW||0; }
    // 마우저 매입가 = 원가 × 1.18 (부가세 10% + 관세 8%). 실제 국내 도착원가로 마진율 산정.
    const VAT_DUTY = 1.18;
    const buyVatOf = p => Math.round(mouserBuyOf(p)*VAT_DUTY);
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
    // 마진율 셀 — (자사 판매가 − 마우저 매입가) ÷ 자사 판매가 × 100. 매입가는 관·부가세 18% 포함가.
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
      const mgCell=moBody.querySelector(`[data-margin="${CSS.escape(no)}"]`); if(mgCell) mgCell.innerHTML=marginCellHtml(ed, p?buyVatOf(p):0);
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
      moBody.innerHTML=`<div class="nx-wrap" style="max-height:calc(100vh - 330px);overflow:auto"><table class="mo-t" style="min-width:1140px">
        <colgroup><col class="c-no"><col class="c-nm"><col class="c-stk"><col class="c-buy"><col class="c-buy"><col class="c-ed"><col class="c-snm"><col class="c-sup"><col class="c-save"><col class="c-act"></colgroup>
        <thead><tr>
          <th colspan="5" style="position:static;text-align:left;color:#0a3d62;font-size:12px;background:var(--panel-2)">▍마우저 (직소싱)</th>
          <th colspan="4" class="zself" style="position:static;text-align:left;color:#0a3d62;font-size:12px">▍자사 (에듀이노)</th>
          <th style="position:static;background:var(--panel-2)"></th></tr>
        <tr>
          <th>마우저 번호</th><th>마우저 상품명</th><th style="text-align:right">재고/입고</th><th style="text-align:right">마우저 원가</th><th style="text-align:right">마우저 매입가</th>
          <th class="zself">자사코드</th><th class="zself">자사 상품명</th><th class="zself" style="text-align:right">자사 판매가</th><th class="zself">마진율</th>
          <th style="text-align:center">요청</th></tr></thead>
        <tbody>${list.length?list.map(p=>{
          const ed=em[p.mouserNo]!=null?em[p.mouserNo]:(p.edCode||''); const buy=buyVatOf(p);
          return `<tr data-no="${esc(p.mouserNo)}">
            <td><a class="mo-code" href="${esc(prodUrl(p.mouserNo))}" target="_blank" rel="noopener">${esc(p.mouserNo)}</a><div class="muted" style="font-size:10.5px">${esc(p.mfrNo||'')}${mfr===ALL?` · ${esc(p.mfr||'')}${p.category?' / '+esc(p.category):''}`:''}</div></td>
            <td style="white-space:normal;word-break:break-word;line-height:1.35">${esc(p.name||'')}</td>
            <td class="num" data-stk><span class="mo-stk wait">–</span></td>
            <td class="num" data-price><span class="mo-price">${won(p.basePriceKRW)}</span><div class="mo-base">기준가</div></td>
            <td class="num" data-buyvat><span class="mo-price">${won(Math.round(p.basePriceKRW*VAT_DUTY))}</span><div class="mo-base">관·부가세 18%</div></td>
            <td class="zself mo-ed">${canEdit()?`<input data-ed="${esc(p.mouserNo)}" value="${esc(ed)}" placeholder="미보유">`:esc(ed||'-')}</td>
            <td class="zself" data-snm="${esc(p.mouserNo)}" style="white-space:normal;word-break:break-word;line-height:1.35">${selfNameCellHtml(ed)}</td>
            <td class="zself num" data-sell="${esc(p.mouserNo)}">${sellCellHtml(ed)}</td>
            <td class="zself" data-margin="${esc(p.mouserNo)}">${marginCellHtml(ed, buy)}</td>
            <td style="white-space:nowrap;text-align:center">
              <input class="mo-qty" data-qty="${esc(p.mouserNo)}" value="1" inputmode="numeric" maxlength="2">
              <button class="mo-req" data-req="${esc(p.mouserNo)}" title="결제요청에 추가 + 마우저 장바구니에 담기">요청</button>
            </td></tr>`; }).join('')
          :`<tr><td colspan="10" class="nx-empty">이 카테고리에 품목이 없습니다.</td></tr>`}</tbody></table></div>`;
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
        const stkTd=tr.querySelector('[data-stk]'), prTd=tr.querySelector('[data-price]'), buyTd=tr.querySelector('[data-buyvat]'), reqBtn=tr.querySelector('[data-req]');
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
        if(d.priceKRW>0){ prTd.innerHTML=`<span class="mo-price">${won(d.priceKRW)}</span><div class="mo-base">${viaCart?'카트조회 원가':'현재 원가'}</div>`;
          if(buyTd) buyTd.innerHTML=`<span class="mo-price">${won(Math.round(d.priceKRW*VAT_DUTY))}</span><div class="mo-base">관·부가세 18%</div>`; }
        updateCompare(p.mouserNo);   // 실제 원가 확보 → 매입가·마진율 재계산
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
        qty:String(qty), amount:unit*qty, account:venAcctOf('Mouser'), prodAmount:unit*qty, ship:0,
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

    /* ── 마우저 [프로젝트 매니저] 엑셀 불러오기 ───────────────────────────────
       양식(내보내기 그대로): 6행째 "프로젝트명"(제조사_카테고리) · 7행째 헤더 · 8행부터 데이터
       가져오는 값: 마우저번호 · 제조업체번호 · 제조업체 · 설명(상품명) · 가격(KRW) · 고객부품번호(자사코드)
       나머지(재고·입고예정·자사판매가·마진)는 기존처럼 크론/이카운트에서 자동으로 채워집니다. */
    const numKR = v => { const s=String(v==null?'':v).replace(/[^\d.]/g,''); const n=Number(s); return isFinite(n)?Math.round(n):0; };
    const HEAD = { no:['mouser 번호','mouser번호','마우저 번호'], mfrNo:['제조업체 번호','제조사 번호'], mfr:['제조업체','제조사'],
      ed:['고객 부품 번호','고객부품번호'], name:['설명','상품명','제품명'], price:['가격'] };
    function parseProjectSheet(sh){
      const rows=(sh&&sh.rows)||[]; const norm=s=>String(s==null?'':s).replace(/\s+/g,'').toLowerCase();
      let hr=-1; for(let i=0;i<Math.min(rows.length,20);i++){ if((rows[i]||[]).some(c=>/mouser\s*번호|마우저\s*번호/i.test(String(c||'')))){ hr=i; break; } }
      if(hr<0) return null;
      // 프로젝트명 = 헤더 바로 위쪽에서 값이 있는 첫 셀 (예: "RASPBERRY PI_AI HAT")
      let proj=''; for(let i=hr-1;i>=0 && i>=hr-4;i--){ const v=String((rows[i]||[])[0]||'').trim(); if(v){ proj=v; break; } }
      const catFromProj = proj.includes('_') ? proj.slice(proj.lastIndexOf('_')+1).trim() : proj.trim();
      const h=(rows[hr]||[]).map(norm);
      // 정확 일치를 먼저 찾고(‘제조업체’가 ‘제조업체 번호’에 걸리는 것 방지) 없을 때만 접두 일치
      const idx=k=>{ for(const n of HEAD[k]){ const i=h.indexOf(norm(n)); if(i>=0) return i; }
        for(const n of HEAD[k]){ const t=norm(n); const i=h.findIndex(x=>x.startsWith(t)); if(i>=0) return i; } return -1; };
      const ci={ no:idx('no'), mfrNo:idx('mfrNo'), mfr:idx('mfr'), ed:idx('ed'), name:idx('name'), price:idx('price') };
      if(ci.no<0) return null;
      const out=[];
      for(let i=hr+1;i<rows.length;i++){ const r=rows[i]||[]; const no=String(r[ci.no]==null?'':r[ci.no]).trim();
        if(!no || /^mouser/i.test(no)) continue;
        out.push({ mouserNo:no, mfrNo:String(r[ci.mfrNo]||'').trim(), mfr:String(r[ci.mfr]||'').trim(),
          category:catFromProj||'기타', edCode:String(ci.ed>=0?(r[ci.ed]||''):'').trim(),
          name:String(r[ci.name]||'').trim(), basePriceKRW:numKR(ci.price>=0?r[ci.price]:0) }); }
      return { proj, category:catFromProj, items:out };
    }
    async function readWorkbook(file){
      const xls=/\.xls$/i.test(file.name);
      if(xls){ if(!window.XlsLite) throw new Error('xls 판독기를 불러오지 못했습니다'); return XlsLite.parseSheets(file); }
      if(!window.XlsxLite) throw new Error('xlsx 판독기를 불러오지 못했습니다'); return XlsxLite.parseSheets(file);
    }
    async function onPickFile(file){
      let parsed=[];
      try{ const sheets=await readWorkbook(file);
        sheets.forEach(sh=>{ const r=parseProjectSheet(sh); if(r && r.items.length) parsed.push(r); });
      }catch(err){ toast('엑셀을 읽지 못했습니다 — '+(err&&err.message||'형식 확인')); return; }
      if(!parsed.length){ toast('마우저 프로젝트 양식이 아닙니다 (‘Mouser 번호’ 헤더를 찾지 못함)'); return; }
      const items=[].concat(...parsed.map(p=>p.items));
      const exist=new Set(all.map(p=>p.mouserNo));
      const add=items.filter(i=>!exist.has(i.mouserNo)), upd=items.filter(i=>exist.has(i.mouserNo));
      // 어느 탭(제조사/프로젝트)에 시트화할지 기본값 — 프로젝트 접두("STM_보드"→STM) → 제조업체 → 기존 탭과 이름이 같으면 그 탭에 합침
      const single = parsed.length===1;
      const proj = single ? String(parsed[0].proj||'') : '';
      const projPrefix = proj.includes('_') ? proj.slice(0, proj.lastIndexOf('_')).trim() : proj.trim();
      const fileMfr = (items.find(i=>i.mfr)||{}).mfr || '';
      const findTab = v => v ? mfrs.find(t=>normTab(t)===normTab(v)) : null;
      const defTab = findTab(projPrefix) || findTab(fileMfr) || projPrefix || fileMfr || '기타';
      const defCat = single ? (parsed[0].category||'기타') : '';
      const ov=document.createElement('div'); ov.className='modal-ov';
      ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
      ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:720px;width:97%;max-height:calc(100vh - 60px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800">${icon('upload')||''} 마우저 프로젝트 불러오기</div>
          <div class="muted" style="font-size:12.5px;margin-top:3px">${esc(file.name)} · 프로젝트 <b>${parsed.map(p=>esc(p.proj||'-')).join(', ')}</b></div></div>
        <div style="padding:14px 20px;overflow:auto">
          <div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb;font-size:12.5px;margin-bottom:12px">
            신규 <b>${add.length}</b>건 · 기존 갱신 <b>${upd.length}</b>건 — 마우저번호·상품명·가격을 채웁니다.
            <span class="muted">재고·입고예정·자사판매가·마진은 기존처럼 자동으로 채워집니다.</span></div>
          <div style="margin-bottom:12px;padding:12px 14px;border:1px solid var(--line-2);background:var(--panel-2);border-radius:10px">
            <div style="font-size:12.5px;font-weight:800;margin-bottom:9px">어디에 넣을까요? <span class="muted" style="font-weight:600">· 마우저 프로젝트 <b>${esc(proj||'여러 개')}</b></span></div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
              <div style="min-width:210px">
                <div class="muted" style="font-size:11px;font-weight:800;margin-bottom:4px">탭(시트)</div>
                <select id="imTabSel" style="width:100%;height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 8px;font:inherit;font-size:12.5px;background:var(--panel);color:var(--ink)">
                  ${mfrs.map(t=>`<option value="${esc(t)}" ${t===defTab?'selected':''}>${esc(t)} — 기존 탭에 추가</option>`).join('')}
                  <option value="__new" ${mfrs.includes(defTab)?'':'selected'}>＋ 새 탭 만들기…</option></select>
                <input id="imTabNew" value="${esc(mfrs.includes(defTab)?'':defTab)}" placeholder="새 탭 이름 (예: STM)" style="width:100%;height:34px;margin-top:6px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font:inherit;font-size:12.5px;background:var(--panel);color:var(--ink);display:${mfrs.includes(defTab)?'none':''}">
              </div>
              <div style="min-width:190px">
                <div class="muted" style="font-size:11px;font-weight:800;margin-bottom:4px">카테고리</div>
                <select id="imCatSel" style="width:100%;height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 8px;font:inherit;font-size:12.5px;background:var(--panel);color:var(--ink)"></select>
                <input id="imCatNew" value="${esc(defCat)}" placeholder="새 카테고리 (예: 보드)" style="width:100%;height:34px;margin-top:6px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font:inherit;font-size:12.5px;background:var(--panel);color:var(--ink)">
              </div>
              <div style="flex:1;min-width:180px">
                <div class="muted" style="font-size:11px;font-weight:800;margin-bottom:4px">저장 경로</div>
                <div id="imPath" style="height:34px;display:flex;align-items:center;font-size:13px;font-weight:800;color:#0a3d62;background:var(--panel);border:1px solid var(--line-2);border-radius:8px;padding:0 11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"></div>
                <div id="imPathNote" class="muted" style="font-size:11px;margin-top:5px"></div>
              </div>
            </div>
          </div>
          <div style="border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:330px">
            <table class="mo-mgr"><thead><tr><th style="width:150px">마우저 번호</th><th>상품명</th><th style="width:96px">카테고리</th><th style="width:92px;text-align:right">가격</th><th style="width:52px">상태</th></tr></thead>
            <tbody>${items.slice(0,300).map(i=>`<tr><td class="mono">${esc(i.mouserNo)}</td>
              <td style="white-space:normal;line-height:1.35">${esc((i.name||'').slice(0,90))}</td>
              <td>${esc(i.category)}</td><td style="text-align:right">${won(i.basePriceKRW)}</td>
              <td>${exist.has(i.mouserNo)?'<span class="muted">갱신</span>':'<b style="color:#12886a">신규</b>'}</td></tr>`).join('')}</tbody></table></div>
          ${items.length>300?`<div class="muted" style="font-size:11.5px;margin-top:6px">※ 미리보기는 300건까지 · 저장은 ${items.length}건 전체</div>`:''}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line)">
          <button class="btn ghost" id="imCancel">취소</button><button class="btn pri" id="imOk">${items.length}건 반영</button></div></div>`;
      document.body.appendChild(ov);
      const close=()=>ov.remove(); ov.onclick=e=>{ if(e.target===ov) close(); };
      ov.querySelector('#imCancel').onclick=close;

      /* 저장 경로(탭 › 카테고리)를 명확히 고르게 — 기존 탭에 합칠지 새 탭을 만들지 선택 */
      const $i=s=>ov.querySelector(s);
      const chosenTab=()=>{ const v=$i('#imTabSel').value; return v==='__new' ? ($i('#imTabNew').value||'').trim() : v; };
      const chosenCat=()=>{ const v=$i('#imCatSel').value; return v==='__new' ? ($i('#imCatNew').value||'').trim() : v; };
      function syncCatOptions(){
        const t=chosenTab(); const cats=[...new Set(all.filter(p=>p.mfr===t).map(p=>p.category).filter(Boolean))];
        const prev=$i('#imCatSel').value;
        const want = (prev && prev!=='__new' && cats.includes(prev)) ? prev : (cats.includes(defCat)? defCat : '__new');
        $i('#imCatSel').innerHTML = cats.map(c=>`<option value="${esc(c)}" ${c===want?'selected':''}>${esc(c)} — 기존 카테고리</option>`).join('')
          + `<option value="__new" ${want==='__new'?'selected':''}>＋ 새 카테고리…</option>`;
        paintPath();
      }
      function paintPath(){
        const t=chosenTab(), c=chosenCat();
        const newTab=!mfrs.includes(t), newCat=!all.some(p=>p.mfr===t&&p.category===c);
        $i('#imTabNew').style.display = $i('#imTabSel').value==='__new' ? '' : 'none';
        $i('#imCatNew').style.display = $i('#imCatSel').value==='__new' ? '' : 'none';
        $i('#imPath').textContent = (t||'?') + ' › ' + (c||'?');
        $i('#imPathNote').innerHTML = (!t||!c) ? '<span style="color:#c0392b">탭과 카테고리를 지정하세요</span>'
          : `${newTab?'<b>새 탭</b> 생성':'기존 탭에 추가'} · ${newCat?'<b>새 카테고리</b> 생성':'기존 카테고리에 추가'} · ${items.length}건`;
        const ok=$i('#imOk'); if(ok) ok.disabled=!t||!c;
      }
      $i('#imTabSel').onchange=()=>{ $i('#imTabNew').style.display=$i('#imTabSel').value==='__new'?'':'none'; syncCatOptions(); };
      $i('#imTabNew').oninput=()=>{ syncCatOptions(); };
      $i('#imCatSel').onchange=paintPath;
      $i('#imCatNew').oninput=paintPath;
      syncCatOptions();

      ov.querySelector('#imOk').onclick=()=>{
        const tabName=chosenTab(), catName=chosenCat();
        if(!tabName||!catName){ toast('탭과 카테고리를 지정하세요'); return; }
        items.forEach(i=>{ const cur=all.find(p=>p.mouserNo===i.mouserNo)||{};
          putPart({ mouserNo:i.mouserNo, mfrNo:i.mfrNo||cur.mfrNo||'', mfr:tabName,
            category:catName || i.category || cur.category || '기타', name:i.name||cur.name||'',
            basePriceKRW:i.basePriceKRW||cur.basePriceKRW||0, edCode:i.edCode||cur.edCode||'' }); });
        putTab(tabName);                                   // 탭 목록에도 등록(품목을 다 지워도 탭은 유지)
        if(window.actLog) actLog('불러오기','마우저 품목',`${file.name} → [${tabName}] 신규 ${add.length}·갱신 ${upd.length}`);
        close(); mfr=tabName; if(catName) cat=catName; refreshParts();
        toast(`[${tabName}] 시트로 불러왔습니다 — 신규 ${add.length} · 갱신 ${upd.length}건`);
      };
    }
    const fileEl=root.querySelector('#moFile');
    const impBtn=root.querySelector('#moImport'); if(impBtn) impBtn.onclick=()=>fileEl.click();
    if(fileEl) fileEl.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) onPickFile(f); };

    /* ── 품목·카테고리 관리 (카테고리 이름 수정 · 일괄 변경 · 품목 삭제) ── */
    function openManage(){
      const scope = mfr===ALL ? all.slice() : all.filter(p=>p.mfr===mfr);
      const cats=[...new Set(all.map(p=>p.category).filter(Boolean))];
      const draft={}, gone={};
      const ov=document.createElement('div'); ov.className='modal-ov';
      ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
      ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:860px;width:98%;max-height:calc(100vh - 56px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800">${icon('grid')||''} 품목 · 카테고리 관리</div>
          <div class="muted" style="font-size:12.5px;margin-top:3px">${mfr===ALL?'전체':esc(mfr)} · <b>${scope.length}</b>품목 — 카테고리를 직접 고치거나 일괄 변경/삭제할 수 있습니다.</div></div>
        <div style="padding:12px 20px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12.5px;font-weight:700;color:var(--muted)">탭(제조사·프로젝트)</span>
          <span id="mgTabs" style="display:flex;gap:6px;flex-wrap:wrap"></span>
          <input id="mgNewTab" placeholder="새 탭 이름" style="height:30px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font:inherit;font-size:12.5px;width:130px">
          <button class="btn sm" id="mgAddTab">＋ 탭 추가</button>
          <span class="muted" style="font-size:11.5px;flex-basis:100%">※ 탭을 만든 뒤 <b>[엑셀 불러오기]</b>에서 그 탭을 고르면 기존 시드·라즈베리파이처럼 시트가 채워집니다</span></div>
        <div style="padding:12px 20px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12.5px;font-weight:700;color:var(--muted)">카테고리 일괄 변경</span>
          <select id="mgFrom" style="height:32px;border:1px solid var(--line-2);border-radius:8px;padding:0 8px;font:inherit;font-size:12.5px">
            <option value="">— 대상 —</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select>
          <span class="muted">→</span>
          <input id="mgTo" placeholder="새 카테고리명" style="height:32px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font:inherit;font-size:12.5px;width:150px">
          <button class="btn sm" id="mgApply">적용</button>
          <span class="muted" style="font-size:11.5px">※ 이름을 바꾸면 그 카테고리의 품목 전체가 옮겨집니다</span></div>
        <div style="padding:0;overflow:auto;flex:1">
          <table class="mo-mgr"><thead><tr><th style="width:148px">마우저 번호</th><th>상품명</th><th style="width:130px">카테고리</th><th style="width:110px">제조사</th><th style="width:44px"></th></tr></thead>
          <tbody id="mgBody">${scope.map(p=>`<tr data-no="${esc(p.mouserNo)}">
            <td class="mono">${esc(p.mouserNo)}</td>
            <td style="white-space:normal;line-height:1.35">${esc((p.name||'').slice(0,80))}</td>
            <td><input data-c="${esc(p.mouserNo)}" value="${esc(p.category||'')}" list="mgCats"></td>
            <td class="muted">${esc(p.mfr||'')}</td>
            <td><button class="del" data-x="${esc(p.mouserNo)}" title="이 품목 삭제">✕</button></td></tr>`).join('')}</tbody></table>
          <datalist id="mgCats">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line)">
          <button class="btn ghost" id="mgCancel">취소</button><button class="btn pri" id="mgSave">${icon('save')||''}저장</button></div></div>`;
      document.body.appendChild(ov);
      const close=()=>ov.remove(); ov.onclick=e=>{ if(e.target===ov) close(); };
      ov.querySelector('#mgCancel').onclick=close;

      /* 탭 추가 · 이름변경 · 삭제 (즉시 반영) */
      function paintTabs(){
        const box=ov.querySelector('#mgTabs'); if(!box) return;
        box.innerHTML = mfrs.map(t=>`<span style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line-2);background:var(--panel-2);border-radius:8px;padding:3px 6px 3px 10px;font-size:12px;font-weight:700">
            ${esc(t)} <span class="muted" style="font-weight:600">${all.filter(p=>p.mfr===t).length}</span>
            <button class="del" data-ren="${esc(t)}" title="이름 변경" style="font-size:12px">✎</button>
            <button class="del" data-dtab="${esc(t)}" title="탭 삭제">✕</button></span>`).join('') || '<span class="muted" style="font-size:12px">탭이 없습니다</span>';
        box.querySelectorAll('[data-ren]').forEach(b=>b.onclick=()=>{
          const from=b.dataset.ren; const to=(prompt(`탭 이름 변경\n\n'${from}' → 새 이름을 입력하세요`, from)||'').trim();
          if(!to || to===from) return;
          all.filter(p=>p.mfr===from).forEach(p=>putPart({ ...p, mouserNo:p.mouserNo, mfr:to }));
          if(tabState[from]) dropTab(from);
          putTab(to);
          if(window.actLog) actLog('수정','마우저 탭',`${from} → ${to}`);
          if(mfr===from) mfr=to;
          all=PARTS(); mfrs=mfrsOf(); paintTabs(); refreshParts(); toast(`탭 이름을 '${to}'로 변경했습니다`);
        });
        box.querySelectorAll('[data-dtab]').forEach(b=>b.onclick=()=>{
          const t=b.dataset.dtab; const n=all.filter(p=>p.mfr===t).length;
          if(!confirm(`'${t}' 탭을 삭제할까요?${n?`\n이 탭의 품목 ${n}건도 함께 삭제됩니다.`:''}`)) return;
          all.filter(p=>p.mfr===t).forEach(p=>putPart({ ...p, mouserNo:p.mouserNo, del:true }));
          dropTab(t);
          if(window.actLog) actLog('삭제','마우저 탭',`${t}${n?` · 품목 ${n}건`:''}`);
          all=PARTS(); mfrs=mfrsOf(); if(mfr===t) mfr=mfrs[0]||ALL;
          paintTabs(); refreshParts(); toast(`'${t}' 탭을 삭제했습니다`);
        });
      }
      paintTabs();
      ov.querySelector('#mgAddTab').onclick=()=>{
        const el2=ov.querySelector('#mgNewTab'); const name=(el2.value||'').trim();
        if(!name){ toast('새 탭 이름을 입력하세요'); el2.focus(); return; }
        if(mfrs.some(t=>normTab(t)===normTab(name))){ toast('이미 있는 탭입니다'); return; }
        putTab(name, mfrs.length); el2.value='';
        if(window.actLog) actLog('생성','마우저 탭',name);
        mfrs=mfrsOf(); paintTabs(); refreshParts(); toast(`'${name}' 탭을 추가했습니다 · [엑셀 불러오기]에서 이 탭을 고르세요`);
      };

      ov.querySelectorAll('[data-c]').forEach(inp=>inp.onchange=()=>{ draft[inp.dataset.c]=inp.value.trim(); });
      ov.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{ const no=b.dataset.x; const tr=b.closest('tr');
        gone[no]=!gone[no]; tr.classList.toggle('gone',!!gone[no]); b.textContent=gone[no]?'↺':'✕'; });
      ov.querySelector('#mgApply').onclick=()=>{ const from=ov.querySelector('#mgFrom').value, to=ov.querySelector('#mgTo').value.trim();
        if(!from||!to){ toast('대상 카테고리와 새 이름을 입력하세요'); return; }
        ov.querySelectorAll('[data-c]').forEach(inp=>{ if(inp.value.trim()===from){ inp.value=to; draft[inp.dataset.c]=to; } });
        toast(`‘${from}’ → ‘${to}’ 로 변경 준비됨 · [저장]을 누르세요`); };
      ov.querySelector('#mgSave').onclick=()=>{
        let nCat=0, nDel=0;
        scope.forEach(p=>{ const no=p.mouserNo;
          if(gone[no]){ putPart({ ...p, mouserNo:no, del:true }); nDel++; return; }
          const c=draft[no]; if(c!=null && c!==(p.category||'')){ putPart({ ...p, mouserNo:no, category:c||'기타' }); nCat++; } });
        if(!nCat && !nDel){ toast('변경된 내용이 없습니다'); close(); return; }
        if(window.actLog) actLog(nDel?'수정·삭제':'수정','마우저 품목',`카테고리 ${nCat}건${nDel?` · 삭제 ${nDel}건`:''}`);
        close(); refreshParts(); toast(`저장했습니다 — 카테고리 ${nCat}건${nDel?` · 삭제 ${nDel}건`:''}`);
      };
    }
    const mgBtn=root.querySelector('#moManage'); if(mgBtn) mgBtn.onclick=openManage;

    /* ── 엑셀 내보내기 — 지금 화면에 보이는 목록(탭·카테고리·검색·필터·정렬 그대로) ── */
    async function exportXlsx(){
      const list=rows();
      if(!list.length){ toast('내보낼 항목이 없습니다'); return; }
      const head=['마우저 번호','제조사 번호','탭(제조사)','카테고리','마우저 상품명','재고','입고예정',
        '마우저 원가(KRW)','마우저 매입가(관·부가세18%)','자사코드','자사 상품명','자사 판매가','마진액','마진율(%)'];
      const body=list.map(p=>{
        const d=stockMap&&stockMap[p.mouserNo]; const ed=normEd(edOf(p.mouserNo));
        const v=ed?catCache[ed]:null; const self=(v&&v!=='loading')?v:null;
        const sell=self?(Number(self.outPrice)||0):0, buy=buyVatOf(p);
        const eta=(d&&d.found&&Array.isArray(d.onOrder)&&d.onOrder.length)
          ? d.onOrder.map(o=>[o.qty?o.qty+'개':'',o.date||''].filter(Boolean).join(' ')).filter(Boolean).join(' / ') : '';
        return [ p.mouserNo, p.mfrNo||'', p.mfr||'', p.category||'', p.name||'',
          (d&&d.found)?(Number(d.inStock)||0):'', eta,
          mouserBuyOf(p)||'', buy||'', ed||'', self?(self.name||''):'', sell||'',
          (sell&&buy)?(sell-buy):'', (sell&&buy)?Math.round((sell-buy)/sell*1000)/10:'' ];
      });
      const scope = mfr===ALL ? '전체' : (mfr + (cat?'_'+cat:''));
      const fname = `마우저_${scope}_${todayStr()}.xlsx`.replace(/[\/\\:*?"<>|]/g,'_');
      try{
        if(!window.XlsxOut) throw new Error('엑셀 저장기를 불러오지 못했습니다');
        await XlsxOut.save([head,...body], fname, ('마우저 '+scope).slice(0,31));
        if(window.actLog) actLog('내보내기','마우저 품목',`${scope} · ${list.length}건`);
        toast(`엑셀로 내보냈습니다 — ${list.length}건`);
      }catch(e){ toast('내보내기 실패 — '+(e&&e.message||'')); }
    }
    const exBtn=root.querySelector('#moExport'); if(exBtn) exBtn.onclick=exportXlsx;

    renderCats(); applyViewChrome(); paint();
    // 팀 공유 탭 목록 + 품목 오버레이(추가·카테고리수정) → 최신 재고맵 + 자사코드 순으로 반영
    Promise.all([loadTabs(), loadOverlay()]).then(r=>{ if((r[0]||r[1]) && root.isConnected) refreshParts(); });
    loadStock().then(()=>{ if(root.isConnected && view==='stock') paint(); });
    loadEdShared().then(ch=>{ if(ch && root.isConnected && view==='stock') paint(); });
    refreshCart();
  }

  // 가격비교 탭으로 등록(엔티렉스 옆) — 여러 번 로드돼도 중복 방지
  window.PriceTabs = window.PriceTabs || [];
  if(!window.PriceTabs.some(t=>t.key==='mouser'))
    window.PriceTabs.push({ key:'mouser', name:'마우저', render:drawMouser });
})();
