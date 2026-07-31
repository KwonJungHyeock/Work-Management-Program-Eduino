/* ===========================================================================
   물류 · 자사제품 입고  — 중국·마우저 입고 현황을 직접 기록·수정하는 시트
   - 단일 품목 + 마우저 주문번호 '묶음'(주문 하나에 세부품목 여러 개, 토글로 펼침)
   - 기간 필터·대기 빠른필터·달력(대기/완료 색 구분)·완료일 자동기록·주문번호 연결
   - 공용 컬렉션 'mouser_inbound'(팀 공유) + 로컬 캐시. 편집은 물류/리드/관리자.
   =========================================================================== */
(function(){
  const COLL='mouser_inbound';
  const CACHE='eduino.logi.mouserin';
  const KINDS=['중국 - 기존','중국 - 신제품','마우저 - 기존','마우저 - 신제품'];
  const STATUSES=['대기','완료'];
  const MOUSER_ORDER_URL='https://www.mouser.kr/OrderHistory/';
  const meU=()=>(Auth.user&&Auth.user())||{};
  const canEdit=()=> !!(Auth.isAdmin&&Auth.isAdmin()) || meU().dept==='logi' || meU().role==='lead';
  const won=n=>Number(n||0).toLocaleString('ko-KR');
  const num=s=>Math.max(0, Number(String(s==null?'':s).replace(/[^\d]/g,''))||0);
  const fileNorm=v=>{ v=String(v||''); if(v==='drive'||v==='구글드라이브') return 'drive'; return 'None'; };
  const isBundle=it=>!!(it&&it.bundle);
  const subList=it=>Array.isArray(it&&it.sub)?it.sub:[];
  const qtyOf=it=> isBundle(it) ? subList(it).reduce((s,x)=>s+num(x.qty),0) : num(it.qty);
  const isDone=it=>it&&it.status==='완료';
  const api={
    list: async()=>{ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch{ return null; } },
    push: (item)=>{ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:COLL,item})}); }catch{} },
    del:  (id)=>{ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:COLL,id})}); }catch{} },
  };

  MODULES['logi.mouserin']={
    title:'자사제품 입고', icon:'box',
    render(root){
      const editable=canEdit();
      let items=store(CACHE).get([])||[];
      let q='', dateFilter='', preset='all', custFrom='', custTo='', waitOnly=false;
      const expanded=new Set();
      const _t=new Date(); let calY=_t.getFullYear(), calM=_t.getMonth();

      root.innerHTML=`
      <style>
        .mi-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:18px;box-shadow:var(--sh)}
        .mi-hd{display:flex;align-items:center;gap:10px;padding:13px 18px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:14.5px;flex-wrap:wrap}
        .mi-hd .mi-ic{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:#e3f7ef;color:#12886a}
        .mi-hd .mi-ic svg{width:15px;height:15px}
        .mi-hd .mi-hsum{margin-left:auto;display:flex;gap:7px;flex-wrap:wrap;font-weight:700;font-size:12px}
        .mi-bd{padding:14px 18px}
        /* 입고 추가 — 단품/묶음 모드 · 필드 정렬 */
        .mi-addbar{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:flex-end}
        .mi-fld{display:flex;flex-direction:column;gap:4px}
        .mi-fld>label{font-size:11px;font-weight:700;color:var(--muted)}
        .mi-fld.grow{flex:1 1 160px;min-width:150px}
        .mi-in{height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;font:inherit;background:var(--panel);color:var(--ink)}
        .mi-in:focus{outline:2px solid #12886a33;border-color:#12886a}
        .mi-modeseg{display:inline-flex;border:1px solid var(--line-2);border-radius:8px;overflow:hidden;height:36px}
        .mi-modeseg button{border:0;background:var(--panel);padding:0 14px;font-size:12.5px;font-weight:800;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .mi-modeseg button:first-child{border-left:0}.mi-modeseg button.on{background:#12886a;color:#fff}
        .mi-addbtn{height:36px;padding:0 14px;border:0;border-radius:8px;background:#12886a;color:#fff;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap}
        .mi-addbtn:hover{background:#0f7259}
        /* 모드별 필드 표시 */
        .mode-single .b-only{display:none} .mode-bundle .s-only{display:none}
        /* 묶음 세부품목 입력(추가 전) */
        .mi-subedit{margin-top:12px;border-top:1px dashed var(--line-2);padding-top:12px}
        .mi-subedit-hd{font-size:12px;font-weight:800;color:#0a63c2;margin-bottom:8px}
        .mi-subrow-e{display:grid;grid-template-columns:130px minmax(150px,1fr) 80px 30px;gap:8px;margin-bottom:6px}
        .mi-subrow-e input{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font:inherit;background:var(--panel);color:var(--ink)}
        .mi-subx{border:0;background:transparent;color:#b9c4d2;cursor:pointer;font-size:14px;border-radius:6px}
        .mi-subx:hover{background:#fdecea;color:#c0392b}
        .mi-submore{border:1px dashed #bcd3ee;background:#f0f6fd;color:#0a63c2;border-radius:8px;font-size:12px;font-weight:700;padding:6px 12px;cursor:pointer}
        .mi-submore:hover{background:#e3eefb}
        /* 필터 바 */
        .mi-fbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
        .mi-seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .mi-seg button{border:0;background:var(--panel);padding:7px 12px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .mi-seg button:first-child{border-left:0}.mi-seg button.on{background:#12886a;color:#fff}
        .mi-dates{display:none;align-items:center;gap:6px;font-size:12px}
        .mi-dates.on{display:inline-flex}
        .mi-dates input{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 8px;font:inherit}
        .mi-search{height:36px;border:1px solid var(--line-2);border-radius:9px;padding:0 12px;font:inherit;min-width:180px;background:var(--panel);color:var(--ink)}
        .mi-chip{font-size:12px;font-weight:700;border-radius:9px;padding:5px 11px;background:var(--panel-2);border:1px solid var(--line-2);color:var(--ink-2);cursor:default}
        .mi-chip b{color:#12886a}
        .mi-chip.wait{cursor:pointer;background:#fff4e6;border-color:#f0d3a6;color:#b4530a}
        .mi-chip.wait.on{background:#b4530a;color:#fff;border-color:#b4530a}
        .mi-chip.wait b{color:inherit}
        .mi-fchip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#0f7259;background:#eafaf3;border:1px solid #bfe9d5;border-radius:8px;padding:4px 10px}
        .mi-fchip .x{cursor:pointer;font-weight:800}
        /* 표 */
        table.mi-t{border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed}
        table.mi-t th{background:var(--panel-2);color:var(--ink-2);font-size:11px;font-weight:800;text-align:left;padding:9px 8px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.mi-t td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
        table.mi-t tr:hover td{background:var(--panel-2)}
        .mi-cell{width:100%;min-width:0;height:32px;border:1px solid transparent;border-radius:7px;padding:0 7px;font:inherit;background:transparent;color:var(--ink)}
        .mi-cell:hover{border-color:var(--line-2)} .mi-cell:focus{outline:0;border-color:#12886a;background:var(--panel)}
        select.mi-cell,input[type=date].mi-cell{cursor:pointer} input[type=date].mi-cell{padding:0 5px}
        .mi-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mi-code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
        .mi-qty{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .mi-del{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:4px 5px;border-radius:7px}
        .mi-del:hover{background:#fdecea;color:#c0392b}
        /* 박스카드 — 구분 · 입고여부 */
        select.mi-kindsel{font-weight:800;border:1px solid var(--line-2);border-radius:8px;background:var(--panel)}
        select.mi-kindsel.k-mo{background:#fff4ec;border-color:#f2cdb0;color:#b4530a}
        select.mi-kindsel.k-cn{background:#eef4fb;border-color:#cfe0f5;color:#0a63c2}
        .mi-stbtn{width:100%;height:30px;border:1px solid;border-radius:8px;font-weight:800;font-size:12px;cursor:pointer}
        .mi-stbtn.done{background:#e6f7f0;border-color:#bfe9d5;color:#12886a}
        .mi-stbtn.wait{background:#fff4e6;border-color:#f0d3a6;color:#b4530a}
        .mi-stbadge{display:inline-block;font-size:11.5px;font-weight:800;border-radius:7px;padding:3px 10px;border:1px solid}
        .mi-stbadge.done{background:#e6f7f0;border-color:#bfe9d5;color:#12886a}
        .mi-stbadge.wait{background:#fff4e6;border-color:#f0d3a6;color:#b4530a}
        /* 마우저 주문번호 */
        .mi-ono{color:#0a63c2;font-weight:700;font-family:var(--mono);font-size:12px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;max-width:100%}
        .mi-ono:hover{text-decoration:underline}
        .mi-tog{border:0;background:transparent;color:#0a63c2;cursor:pointer;font-size:11px;padding:0 3px 0 0;font-weight:800}
        .mi-onocell{display:flex;align-items:center;gap:3px;min-width:0}
        /* 묶음 행 */
        tr.mi-brow>td{background:#f3f8ff}
        .mi-bchip{display:inline-block;font-size:10.5px;font-weight:800;color:#0a63c2;background:#e8f1fc;border:1px solid #cfe0f5;border-radius:6px;padding:2px 7px}
        tr.mi-subrow>td{background:#fafcff;border-bottom:1px solid var(--line);padding-top:4px;padding-bottom:4px}
        tr.mi-subrow .ind{color:#9db4d0;font-size:12px;padding-left:6px}
        .mi-subadd{border:1px dashed #bcd3ee;background:#f0f6fd;color:#0a63c2;border-radius:7px;font-size:11.5px;font-weight:700;padding:3px 9px;cursor:pointer}
        .mi-subadd:hover{background:#e3eefb}
        .mi-subdel{border:0;background:transparent;color:#b9c4d2;cursor:pointer;font-size:13px;padding:2px 5px;border-radius:6px}
        .mi-subdel:hover{background:#fdecea;color:#c0392b}
        /* 좌: 입고현황 · 우: 달력 */
        .mi-layout{display:grid;grid-template-columns:minmax(0,1fr) 336px;gap:16px;align-items:start}
        @media(max-width:1240px){.mi-layout{grid-template-columns:1fr}}
        .mi-side .mi-card{margin-bottom:0}
        .mi-cal-hd{display:flex;align-items:center;gap:8px;margin-bottom:12px}
        .mi-cal-hd .t{font-weight:800;font-size:14px;color:var(--ink)}
        .mi-cal-nav{border:1px solid var(--line-2);background:var(--panel);border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:15px;line-height:1;color:var(--ink-2)}
        .mi-cal-nav:hover{background:var(--panel-2);border-color:#12886a;color:#12886a}
        .mi-cal-today{margin-left:auto;font-size:12px;font-weight:700;border:1px solid var(--line-2);background:var(--panel);border-radius:8px;padding:5px 11px;cursor:pointer;color:#12886a}
        .mi-cal-today:hover{background:#eafaf3}
        .mi-dowrow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}
        .mi-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;grid-auto-rows:42px;align-content:start}
        .mi-dow{text-align:center;font-size:11px;font-weight:800;color:var(--muted);padding:1px 0 3px}
        .mi-dow.sun{color:#c0392b}.mi-dow.sat{color:#0a63c2}
        .mi-day{position:relative;min-height:0;border:1px solid var(--line);border-radius:9px;background:var(--panel);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:12.5px;color:var(--ink-2);transition:border-color .12s,background .12s}
        .mi-day.empty{border-color:transparent;background:transparent;cursor:default}
        .mi-day:hover:not(.empty):not(.sel){border-color:#12886a}
        .mi-day.done{background:#eafaf3;border-color:#bfe9d5;font-weight:800;color:#0f7259}
        .mi-day.pend{background:#fff4e6;border-color:#f0d3a6;font-weight:800;color:#b4530a}
        .mi-day.today{box-shadow:inset 0 0 0 2px #12886a55}
        .mi-day.sel{background:#12886a;border-color:#12886a;color:#fff;font-weight:800}
        .mi-day .dn{line-height:1}
        .mi-day .badge{font-size:9.5px;font-weight:800;color:#fff;border-radius:8px;padding:0 5px;line-height:15px;min-width:15px;text-align:center;background:#12886a}
        .mi-day.pend .badge{background:#b4530a}
        .mi-day.sel .badge{background:#fff;color:#12886a}
        .mi-cal-info{margin-top:12px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:9px;line-height:1.6}
        .mi-cal-info b{color:#12886a}
        .mi-cal-legend{display:flex;gap:10px;font-size:11px;margin-top:6px}
        .mi-cal-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:3px;vertical-align:-1px}
        .mi-cal-clear{color:var(--muted);text-decoration:underline;cursor:pointer;font-weight:600}
      </style>

      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">자사제품 입고</div>
          <div class="ds">중국·마우저 입고 내역을 기록·관리합니다. 마우저 주문 여러 품목은 <b>[묶음 추가]</b>로 한 번에.</div></div>
        <div class="mhead-act mi-sum" id="miSum"></div>
      </div></div>
      <div class="mbody">
      ${editable?`<div class="mi-card"><div class="mi-hd"><span class="mi-ic">${icon('box')}</span> 입고 추가</div>
        <div class="mi-bd">
          <div class="mi-addbar mode-single" id="miAddBar">
            <div class="mi-fld"><label>추가유형</label>
              <span class="mi-modeseg" id="miMode"><button type="button" data-m="단품" class="on">단품</button><button type="button" data-m="묶음">묶음</button></span></div>
            <div class="mi-fld"><label>입고날짜</label><input class="mi-in" id="miDate" type="date" style="width:130px"></div>
            <div class="mi-fld"><label>구분</label><select class="mi-in" id="miKind" style="width:116px">${KINDS.map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select></div>
            <div class="mi-fld s-only"><label>상품코드</label><input class="mi-in" id="miCode" placeholder="예: P-T604" autocomplete="off" style="width:110px"></div>
            <div class="mi-fld"><label>마우저 주문번호</label><input class="mi-in" id="miOrder" placeholder="예: 281234465" autocomplete="off" style="width:128px"></div>
            <div class="mi-fld grow s-only"><label>제품명</label><input class="mi-in" id="miName" placeholder="제품명" autocomplete="off" style="width:100%"></div>
            <div class="mi-fld s-only"><label>수량</label><input class="mi-in mi-qty" id="miQty" placeholder="0" inputmode="numeric" style="width:64px"></div>
            <div class="mi-fld"><label>파일</label><select class="mi-in" id="miFile" style="width:78px"><option value="None">None</option><option value="drive">drive</option></select></div>
            <div class="mi-fld"><label>입고여부</label><select class="mi-in" id="miStatus" style="width:82px">${STATUSES.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
            <div class="mi-fld"><label>&nbsp;</label><button class="mi-addbtn" id="miAdd">＋ 추가</button></div>
          </div>
          <div class="mi-subedit b-only" id="miSubEdit">
            <div class="mi-subedit-hd">세부품목 <span class="muted" style="font-weight:600">— 이 주문번호에 포함된 품목을 모두 입력한 뒤 [묶음 추가]</span></div>
            <div id="miSubList"></div>
            <button type="button" class="mi-submore" id="miSubMore">＋ 품목 추가</button>
          </div>
        </div></div>`:''}

      <div class="mi-layout">
        <div class="mi-main">
          <div class="mi-card">
            <div class="mi-hd"><span class="mi-ic">${icon('clipboard')||icon('box')}</span> 입고현황
              <span class="mi-hsum" id="miHsum"></span></div>
            <div class="mi-bd">
              <div class="mi-fbar">
                <span class="mi-seg" id="miSeg">
                  <button data-p="all" class="on">전체</button><button data-p="today">오늘</button><button data-p="7">7일</button>
                  <button data-p="30">30일</button><button data-p="month">이번달</button><button data-p="custom">지정</button></span>
                <span class="mi-dates" id="miDates"><input type="date" id="miFrom"> ~ <input type="date" id="miTo"></span>
                <span class="mi-chip wait" id="miWaitChip"></span>
                <span id="miFilter"></span>
                <input class="mi-search" id="miQ" type="search" placeholder="코드·제품명·주문번호 검색">
                <span class="muted" id="miCount" style="font-size:12px;margin-left:auto"></span>
              </div>
              <div style="overflow:auto;max-height:calc(100vh - 380px)">
                <table class="mi-t">
                <colgroup><col style="width:126px"><col style="width:104px"><col style="width:92px"><col style="width:118px"><col><col style="width:66px"><col style="width:70px"><col style="width:86px">${editable?'<col style="width:40px">':''}</colgroup>
                <thead><tr>
                  <th>입고날짜</th><th>구분</th><th>상품코드</th><th>마우저 주문번호</th><th>제품명</th>
                  <th style="text-align:right">수량</th><th>파일</th><th>입고여부</th>${editable?'<th></th>':''}
                </tr></thead><tbody id="miRows"></tbody></table>
              </div>
            </div>
          </div>
        </div>
        <aside class="mi-side">
          <div class="mi-card"><div class="mi-hd"><span class="mi-ic">${icon('check2')||icon('box')}</span> 입고 일정</div>
            <div class="mi-bd mi-cal" id="miCal"></div></div>
        </aside>
      </div>
      </div>`;

      const $=s=>root.querySelector(s);
      const rowsEl=$('#miRows'), sumEl=$('#miSum'), countEl=$('#miCount'), hsumEl=$('#miHsum');
      const COLSPAN=editable?9:8;

      function persist(item){ item.updatedAt=nowISO(); item.whoName=meU().name||meU().loginId||item.whoName||''; api.push(item); store(CACHE).set(items); }
      function addDays(s,n){ try{ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return todayStr(d); }catch{ return s; } }
      function range(){ const to=todayStr();
        if(preset==='today') return {from:to,to};
        if(preset==='7') return {from:addDays(to,-6),to};
        if(preset==='30') return {from:addDays(to,-29),to};
        if(preset==='month') return {from:to.slice(0,8)+'01',to};
        if(preset==='custom') return {from:custFrom||'0000-01-01',to:custTo||'9999-12-31'};
        return {from:'0000-01-01',to:'9999-12-31'}; }

      // 마우저 주문번호 셀(연결 링크)
      const onoLink=ono=>ono?`<a class="mi-ono" href="${esc(MOUSER_ORDER_URL)}" target="_blank" rel="noopener" title="마우저 주문내역에서 ${esc(ono)} 확인">${esc(ono)}</a>`:'';
      const kindCls=k=>/마우저/.test(k||'')?'k-mo':'k-cn';

      function render(){
        const term=q.trim().toLowerCase(); const {from,to}=range();
        const inRange=d=>!d||(d>=from&&d<=to);
        const matchTerm=it=>{ if(!term) return true; const hay=((it.code||'')+' '+(it.name||'')+' '+(it.orderNo||'')+' '+subList(it).map(s=>(s.code||'')+' '+(s.name||'')).join(' ')).toLowerCase(); return hay.includes(term); };
        const ranged=items.filter(it=>inRange(it.date)&&(!dateFilter||it.date===dateFilter)&&matchTerm(it));
        const pend=ranged.filter(it=>!isDone(it));
        const view=(waitOnly?pend:ranged).slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')) || String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||'')));
        // 요약(전체 · 대기 · 총수량) — mhead
        const totQty=items.reduce((s,it)=>s+qtyOf(it),0); const pendAll=items.filter(it=>!isDone(it)).length;
        sumEl.innerHTML=`<span class="mi-chip">전체 <b>${items.length}</b>건</span>
          <span class="mi-chip">대기 <b style="color:#b4530a">${pendAll}</b> · 완료 <b>${items.length-pendAll}</b></span>
          <span class="mi-chip">총 수량 <b>${won(totQty)}</b></span>`;
        // 입고현황 카드 요약
        const vQty=view.reduce((s,it)=>s+qtyOf(it),0);
        hsumEl.innerHTML=`<span class="mi-chip" style="padding:3px 9px">표시 <b>${view.length}</b>건 · 수량 <b>${won(vQty)}</b></span>`;
        // 대기 빠른필터 칩
        const wc=$('#miWaitChip'); if(wc){ wc.classList.toggle('on',waitOnly); wc.innerHTML=`${icon('bell')||'●'} 대기 <b>${pend.length}</b>건${waitOnly?' · 해제':''}`; }
        // 날짜필터 칩
        const fEl=$('#miFilter'); if(fEl) fEl.innerHTML=dateFilter?`<span class="mi-fchip">${esc(dateFilter)} 입고<span class="x" id="miFClear">✕</span></span>`:'';
        const fc=$('#miFClear'); if(fc) fc.onclick=()=>{ dateFilter=''; render(); };
        countEl.textContent=`${view.length}/${items.length}건`;

        if(!view.length){ rowsEl.innerHTML=`<tr><td colspan="${COLSPAN}" class="nx-empty" style="padding:26px">${dateFilter||waitOnly||preset!=='all'||term?'조건에 맞는 입고 내역이 없습니다.':'아직 입고 내역이 없습니다.'+(editable?' 위에서 추가하세요.':'')}</td></tr>`; renderCal(); return; }
        rowsEl.innerHTML=view.map(it=>rowHtml(it)).join('');
        renderCal();
        wire();
      }

      function rowHtml(it){
        const id=esc(it.id); const done=isDone(it); const st=done?'done':'wait';
        const kc=kindCls(it.kind);
        const fileCell=editable
          ? `<select class="mi-cell" data-f="file"><option value="None" ${fileNorm(it.file)!=='drive'?'selected':''}>None</option><option value="drive" ${fileNorm(it.file)==='drive'?'selected':''}>drive</option></select>`
          : (fileNorm(it.file)==='drive'?'drive':'<span class="muted">None</span>');
        const stCell=editable
          ? `<button class="mi-stbtn ${st}" data-status="${id}" title="${done&&it.doneAt?'완료 '+esc(fmtWhenD(it.doneAt)):'클릭하면 완료/대기 전환'}">${done?'완료':'대기'}</button>`
          : `<span class="mi-stbadge ${st}">${done?'완료':'대기'}</span>`;
        const kindCell=editable
          ? `<select class="mi-cell mi-kindsel ${kc}" data-f="kind">${KINDS.map(k=>`<option value="${esc(k)}" ${it.kind===k?'selected':''}>${esc(k)}</option>`).join('')}</select>`
          : `<span class="mi-kind ${/신제품/.test(it.kind||'')?'new':'old'}" style="display:inline-block;font-size:11px;font-weight:800;border-radius:6px;padding:2px 8px;${kc==='k-mo'?'background:#fff4ec;color:#b4530a':'background:#eef4fb;color:#0a63c2'}">${esc(it.kind||'-')}</span>`;
        const dateCell=editable?`<input class="mi-cell" data-f="date" type="date" value="${esc(it.date||'')}">`:esc(it.date||'-');

        if(isBundle(it)){
          const open=expanded.has(it.id); const subs=subList(it);
          const summary=subs.map(s=>s.name||s.code).filter(Boolean).slice(0,3).join(', ')||'(세부품목 없음)';
          const onoCell=`<div class="mi-onocell"><button class="mi-tog" data-toggle="${id}">${open?'▼':'▶'}</button>${onoLink(it.orderNo)}</div>`;
          const parent=`<tr class="mi-brow" data-id="${id}">
            <td>${dateCell}</td><td>${kindCell}</td>
            <td><span class="mi-bchip">묶음 ${subs.length}</span></td>
            <td>${onoCell}</td>
            <td class="mi-name" title="${esc(summary)}">${esc(summary)}${subs.length>3?` <span class="muted">외 ${subs.length-3}</span>`:''}</td>
            <td class="mi-qty">${won(qtyOf(it))}</td><td>${fileCell}</td><td>${stCell}</td>
            ${editable?`<td><button class="mi-del" data-del="${id}" title="묶음 삭제">✕</button></td>`:''}</tr>`;
          if(!open) return parent;
          const subRows=subs.map((s,i)=> editable
            ? `<tr class="mi-subrow" data-id="${id}" data-subrow="${i}">
                <td></td><td></td>
                <td><input class="mi-cell" data-sub="${i}" data-sf="code" value="${esc(s.code||'')}" placeholder="상품코드"></td>
                <td class="ind">└ 세부</td>
                <td><input class="mi-cell" data-sub="${i}" data-sf="name" value="${esc(s.name||'')}" placeholder="제품명" title="${esc(s.name||'')}"></td>
                <td><input class="mi-cell mi-qty" data-sub="${i}" data-sf="qty" value="${esc(String(s.qty||''))}" inputmode="numeric" placeholder="0"></td>
                <td></td><td></td>
                <td><button class="mi-subdel" data-subdel="${id}:${i}" title="세부품목 삭제">✕</button></td></tr>`
            : `<tr class="mi-subrow" data-id="${id}">
                <td></td><td></td><td class="mi-code">${esc(s.code||'-')}</td><td class="ind">└ 세부</td>
                <td class="mi-name" title="${esc(s.name||'')}">${esc(s.name||'-')}</td><td class="mi-qty">${won(num(s.qty))}</td><td></td><td></td></tr>`).join('');
          const addRow=editable?`<tr class="mi-subrow" data-id="${id}"><td></td><td></td><td colspan="${COLSPAN-2}"><button class="mi-subadd" data-addsub="${id}">＋ 세부품목 추가</button></td></tr>`:'';
          return parent+subRows+addRow;
        }
        // 단일 품목
        if(editable) return `<tr data-id="${id}">
          <td>${dateCell}</td><td>${kindCell}</td>
          <td><input class="mi-cell" data-f="code" value="${esc(it.code||'')}" placeholder="상품코드"></td>
          <td><input class="mi-cell" data-f="orderNo" value="${esc(it.orderNo||'')}" placeholder="주문번호" title="${esc(it.orderNo||'')}"></td>
          <td><input class="mi-cell" data-f="name" value="${esc(it.name||'')}" placeholder="제품명" title="${esc(it.name||'')}"></td>
          <td><input class="mi-cell mi-qty" data-f="qty" value="${esc(String(it.qty||''))}" inputmode="numeric" placeholder="0"></td>
          <td>${fileCell}</td><td>${stCell}</td>
          <td><button class="mi-del" data-del="${id}" title="삭제">✕</button></td></tr>`;
        return `<tr data-id="${id}">
          <td>${dateCell}</td><td>${kindCell}</td>
          <td class="mi-code" title="${esc(it.code||'')}">${esc(it.code||'-')}</td>
          <td>${onoLink(it.orderNo)||'<span class="muted">-</span>'}</td>
          <td class="mi-name" title="${esc(it.name||'')}">${esc(it.name||'-')}</td>
          <td class="mi-qty">${won(num(it.qty))}</td><td>${fileCell}</td><td>${stCell}</td></tr>`;
      }

      function setStatus(it, done){ it.status=done?'완료':'대기'; if(done) it.doneAt=nowISO(); else it.doneAt=''; persist(it); }
      function wire(){
        rowsEl.querySelectorAll('tr[data-id]').forEach(tr=>{ const it=items.find(x=>String(x.id)===tr.dataset.id); if(!it) return;
          // 묶음 펼침 토글 — 읽기 전용 열람자도 세부품목 확인 가능
          const tg=tr.querySelector('[data-toggle]'); if(tg) tg.onclick=()=>{ const id=tg.dataset.toggle; expanded.has(id)?expanded.delete(id):expanded.add(id); render(); };
          if(!editable) return;
          // 단일/묶음 공통 필드
          tr.querySelectorAll('[data-f]').forEach(inp=>inp.onchange=()=>{ const f=inp.dataset.f;
            if(f==='qty'){ it.qty=num(inp.value); inp.value=it.qty; } else it[f]=inp.value.trim();
            persist(it); if(f==='kind'){ inp.className='mi-cell mi-kindsel '+kindCls(it.kind); }
            if(f==='qty'||f==='date'){ render(); } });
          // 세부품목
          tr.querySelectorAll('[data-sub]').forEach(inp=>inp.onchange=()=>{ const i=+inp.dataset.sub, sf=inp.dataset.sf; it.sub=it.sub||[]; it.sub[i]=it.sub[i]||{};
            if(sf==='qty'){ it.sub[i].qty=num(inp.value); inp.value=it.sub[i].qty; render(); } else it.sub[i][sf]=inp.value.trim();
            persist(it); });
          // 입고여부 토글(완료일 자동기록)
          const sb=tr.querySelector('[data-status]'); if(sb) sb.onclick=()=>{ setStatus(it,!isDone(it)); render(); };
          // 묶음 세부 추가/삭제
          const as=tr.querySelector('[data-addsub]'); if(as) as.onclick=()=>{ it.sub=it.sub||[]; it.sub.push({code:'',name:'',qty:''}); persist(it); render(); };
          const sd=tr.querySelector('[data-subdel]'); if(sd) sd.onclick=()=>{ const [,i]=sd.dataset.subdel.split(':'); it.sub.splice(+i,1); persist(it); render(); };
          const db=tr.querySelector('[data-del]'); if(db) db.onclick=()=>{ if(!confirm(isBundle(it)?'이 주문묶음(세부품목 전체)을 삭제할까요?':'이 입고 내역을 삭제할까요?')) return;
            api.del(it.id); items=items.filter(x=>String(x.id)!==String(it.id)); store(CACHE).set(items); render(); toast('삭제했습니다'); };
        });
      }

      // 달력 — 대기(주황)/완료(초록) 색 구분
      function ymd(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
      function fmtWhenD(iso){ try{ const d=new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }catch{ return ''; } }
      function renderCal(){
        const box=$('#miCal'); if(!box) return;
        const agg={}; items.forEach(it=>{ const d=it.date; if(!d) return; const a=agg[d]=agg[d]||{n:0,q:0,pend:0}; a.n++; a.q+=qtyOf(it); if(!isDone(it)) a.pend++; });
        const startDow=new Date(calY,calM,1).getDay(); const days=new Date(calY,calM+1,0).getDate();
        const todayS=todayStr(); const mPrefix=`${calY}-${String(calM+1).padStart(2,'0')}`;
        let mN=0,mQ=0,mPend=0; Object.keys(agg).forEach(k=>{ if(k.slice(0,7)===mPrefix){ mN+=agg[k].n; mQ+=agg[k].q; mPend+=agg[k].pend; } });
        const cells=[];
        for(let i=0;i<startDow;i++) cells.push('<div class="mi-day empty"></div>');
        for(let d=1;d<=days;d++){ const ds=ymd(calY,calM,d); const a=agg[ds];
          const cls=['mi-day']; if(a) cls.push(a.pend>0?'pend':'done'); if(ds===todayS) cls.push('today'); if(ds===dateFilter) cls.push('sel');
          cells.push(`<div class="${cls.join(' ')}" data-day="${ds}" title="${a?`입고 ${a.n}건 · 수량 ${won(a.q)}${a.pend?` · 대기 ${a.pend}`:' · 전부완료'}`:''}"><span class="dn">${d}</span>${a?`<span class="badge">${a.n}</span>`:''}</div>`); }
        box.innerHTML=`
          <div class="mi-cal-hd"><button class="mi-cal-nav" data-nav="-1">‹</button><span class="t">${calY}년 ${calM+1}월</span>
            <button class="mi-cal-nav" data-nav="1">›</button><button class="mi-cal-today" id="miCalToday">오늘</button></div>
          <div class="mi-dowrow">${['일','월','화','수','목','금','토'].map((w,i)=>`<div class="mi-dow ${i===0?'sun':i===6?'sat':''}">${w}</div>`).join('')}</div>
          <div class="mi-grid">${cells.join('')}</div>
          <div class="mi-cal-info">${dateFilter
            ? `<b>${esc(dateFilter)}</b> 입고 <b>${(agg[dateFilter]||{}).n||0}</b>건 · 수량 <b>${won((agg[dateFilter]||{}).q||0)}</b> · <span class="mi-cal-clear" id="miCalClear">전체 보기</span>`
            : `이번 달 입고 <b>${mN}</b>건 · 수량 <b>${won(mQ)}</b>${mPend?` · <b style="color:#b4530a">대기 ${mPend}</b>`:''}`}
            <div class="mi-cal-legend"><span><i style="background:#b4530a"></i>대기 있음</span><span><i style="background:#12886a"></i>전부 완료</span></div></div>`;
        box.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ calM+=Number(b.dataset.nav); if(calM<0){calM=11;calY--;} if(calM>11){calM=0;calY++;} renderCal(); });
        const tb=box.querySelector('#miCalToday'); if(tb) tb.onclick=()=>{ const t=new Date(); calY=t.getFullYear(); calM=t.getMonth(); renderCal(); };
        box.querySelectorAll('[data-day]').forEach(c=>{ if(c.classList.contains('empty')) return; c.onclick=()=>{ dateFilter=(dateFilter===c.dataset.day)?'':c.dataset.day; render(); }; });
        const cl=box.querySelector('#miCalClear'); if(cl) cl.onclick=()=>{ dateFilter=''; render(); };
      }

      // 필터 바 이벤트
      $('#miSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{ preset=b.dataset.p;
        $('#miSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.p===preset));
        $('#miDates').classList.toggle('on',preset==='custom'); render(); });
      $('#miFrom').onchange=e=>{ custFrom=e.target.value; if(preset==='custom') render(); };
      $('#miTo').onchange=e=>{ custTo=e.target.value; if(preset==='custom') render(); };
      $('#miWaitChip').onclick=()=>{ waitOnly=!waitOnly; render(); };
      const qEl=$('#miQ'); if(qEl) qEl.oninput=()=>{ q=qEl.value; render(); };

      if(editable){
        const dateEl=$('#miDate'), kindEl=$('#miKind'), codeEl=$('#miCode'), orderEl=$('#miOrder'), nameEl=$('#miName'), qtyEl=$('#miQty'), fileEl=$('#miFile'), statusEl=$('#miStatus');
        const barEl=$('#miAddBar'), addBtn=$('#miAdd');
        if(dateEl) dateEl.value=todayStr();
        let addMode='단품', draftSub=[{code:'',name:'',qty:''}];
        const common=()=>({ date:(dateEl&&dateEl.value)||todayStr(), kind:kindEl.value||KINDS[0], file:(fileEl&&fileEl.value)||'None', status:(statusEl&&statusEl.value)||'대기' });
        const resetCommon=()=>{ kindEl.value=KINDS[0]; if(dateEl)dateEl.value=todayStr(); if(fileEl)fileEl.value='None'; if(statusEl)statusEl.value='대기'; orderEl.value=''; };
        const clearFilters=()=>{ preset='all'; q=''; if(qEl)qEl.value=''; dateFilter=''; waitOnly=false;
          $('#miSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.p==='all')); $('#miDates').classList.remove('on'); };
        // 묶음 세부품목 입력(추가 전에 그 자리에서)
        function renderSubList(){ const box=$('#miSubList'); if(!box) return;
          box.innerHTML=draftSub.map((s,i)=>`<div class="mi-subrow-e" data-i="${i}">
            <input data-sf="code" value="${esc(s.code||'')}" placeholder="상품코드">
            <input data-sf="name" value="${esc(s.name||'')}" placeholder="제품명">
            <input data-sf="qty" value="${esc(String(s.qty||''))}" placeholder="수량" inputmode="numeric">
            <button type="button" class="mi-subx" data-x="${i}" title="삭제">✕</button></div>`).join('');
          box.querySelectorAll('.mi-subrow-e').forEach(row=>{ const i=+row.dataset.i;
            row.querySelectorAll('[data-sf]').forEach(inp=>inp.oninput=()=>{ const f=inp.dataset.sf; draftSub[i][f]=f==='qty'?inp.value.replace(/[^\d]/g,''):inp.value; });
            const x=row.querySelector('[data-x]'); if(x) x.onclick=()=>{ draftSub.splice(i,1); if(!draftSub.length) draftSub=[{code:'',name:'',qty:''}]; renderSubList(); }; });
        }
        function setMode(m){ addMode=m; if(barEl){ barEl.classList.toggle('mode-single',m==='단품'); barEl.classList.toggle('mode-bundle',m==='묶음'); }
          const se=$('#miSubEdit'); if(se) se.style.display=(m==='묶음')?'':'none';
          $('#miMode').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.m===m));
          if(addBtn) addBtn.textContent=(m==='묶음')?'＋ 묶음 추가':'＋ 추가';
          if(m==='묶음') renderSubList(); }
        $('#miMode').querySelectorAll('button').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
        $('#miSubMore').onclick=()=>{ draftSub.push({code:'',name:'',qty:''}); renderSubList(); };
        setMode('단품');
        const addSingle=()=>{ const code=codeEl.value.trim(), name=nameEl.value.trim(), orderNo=orderEl.value.trim(), qty=num(qtyEl.value);
          if(!code&&!name){ toast('상품코드 또는 제품명을 입력하세요'); codeEl.focus(); return; }
          const c=common(); const item={ id:uuid(), day:todayStr(), ...c, orderNo, code, name, qty, doneAt:c.status==='완료'?nowISO():'', createdAt:nowISO() };
          items.push(item); persist(item); codeEl.value=''; nameEl.value=''; qtyEl.value=''; resetCommon(); codeEl.focus(); clearFilters(); render();
          toast(`입고 추가 — ${c.date} · ${code||name}`); };
        const addBundle=()=>{ const orderNo=orderEl.value.trim();
          if(!orderNo){ toast('묶음은 마우저 주문번호를 입력하세요'); orderEl.focus(); return; }
          const sub=draftSub.map(s=>({code:(s.code||'').trim(),name:(s.name||'').trim(),qty:num(s.qty)})).filter(s=>s.code||s.name||s.qty);
          if(!sub.length){ toast('세부품목을 1개 이상 입력하세요'); return; }
          const c=common(); const item={ id:uuid(), bundle:true, day:todayStr(), ...c, orderNo, sub, doneAt:c.status==='완료'?nowISO():'', createdAt:nowISO() };
          items.push(item); persist(item); resetCommon(); draftSub=[{code:'',name:'',qty:''}]; renderSubList(); orderEl.focus(); clearFilters(); render();
          toast(`묶음(주문 ${orderNo}) 추가 — ${sub.length}품목`); };
        if(addBtn) addBtn.onclick=()=> addMode==='묶음'?addBundle():addSingle();
        [codeEl,nameEl,qtyEl].forEach(elm=>elm&&elm.addEventListener('keydown',e=>{ if(e.key==='Enter') addSingle(); }));
      }

      render();
      api.list().then(list=>{ if(!root.isConnected || list==null) return; items=list; store(CACHE).set(items); render(); });
    }
  };
})();
