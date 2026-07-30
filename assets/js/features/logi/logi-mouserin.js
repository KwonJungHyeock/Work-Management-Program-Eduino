/* ===========================================================================
   물류 · 마우저 입고  — 마우저에서 들여온 상품의 입고 현황을 직접 기록·수정하는 시트
   컬럼: 구분(기존/신제품 · 드롭다운) · 상품코드 · 제품명 · 입고 수량
   - 담당자가 행을 추가하고, 각 칸을 직접 입력·수정, 필요 없으면 삭제
   - 공용 컬렉션 'mouser_inbound'(팀 공유) — 물류/MD 함께 열람. 로컬 캐시로 오프라인 표시.
   =========================================================================== */
(function(){
  const COLL='mouser_inbound';
  const CACHE='eduino.logi.mouserin';
  const KINDS=['중국 - 기존','중국 - 신제품','마우저 - 기존','마우저 - 신제품'];
  const meU=()=>(Auth.user&&Auth.user())||{};
  const canEdit=()=> !!(Auth.isAdmin&&Auth.isAdmin()) || meU().dept==='logi' || meU().role==='lead';
  const won=n=>Number(n||0).toLocaleString('ko-KR');
  const num=s=>Math.max(0, Number(String(s==null?'':s).replace(/[^\d]/g,''))||0);
  const api={
    list: async()=>{ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch{ return null; } },
    push: (item)=>{ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:COLL,item})}); }catch{} },
    del:  (id)=>{ try{ return fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll:COLL,id})}); }catch{} },
  };

  MODULES['logi.mouserin']={
    title:'자사제품 입고', icon:'box',
    render(root){
      const editable=canEdit();
      let items=store(CACHE).get([])||[];    // 로컬 캐시 먼저 표시(즉시 렌더) → 서버 최신으로 교체
      let q='', dateFilter='';               // 검색어 · 달력에서 선택한 입고날짜(필터)
      const _t=new Date(); let calY=_t.getFullYear(), calM=_t.getMonth();   // 달력 표시 연/월(0-based)

      root.innerHTML=`
      <style>
        .mi-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:18px;box-shadow:var(--sh)}
        .mi-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15px}
        .mi-hd .mi-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:#e3f7ef;color:#12886a}
        .mi-hd .mi-ic svg{width:15px;height:15px}
        .mi-bd{padding:16px 20px}
        .mi-add{display:grid;grid-template-columns:148px 118px 132px minmax(150px,1fr) 88px 124px 84px;gap:10px;align-items:end}
        @media(max-width:1000px){.mi-add{grid-template-columns:1fr 1fr}}
        .mi-add label{display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:4px}
        .mi-in{width:100%;height:38px;border:1px solid var(--line-2);border-radius:9px;padding:0 11px;font:inherit;background:var(--panel);color:var(--ink)}
        .mi-in:focus{outline:2px solid #12886a33;border-color:#12886a}
        .mi-addbtn{height:38px;width:100%;border:0;border-radius:9px;background:#12886a;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer}
        .mi-addbtn:hover{background:#0f7259}
        /* 표는 고정 레이아웃 → 제품명이 길어도 다른 칸을 밀지 않고 칸 안에서 처리 */
        table.mi-t{border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed}
        table.mi-t th{background:var(--panel-2);color:var(--ink-2);font-size:11.5px;font-weight:800;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.mi-t td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
        table.mi-t tr:hover td{background:var(--panel-2)}
        .mi-cell{width:100%;min-width:0;height:34px;border:1px solid transparent;border-radius:7px;padding:0 8px;font:inherit;background:transparent;color:var(--ink)}
        .mi-cell:hover{border-color:var(--line-2)} .mi-cell:focus{outline:0;border-color:#12886a;background:var(--panel)}
        select.mi-cell,input[type=date].mi-cell{cursor:pointer}
        input[type=date].mi-cell{padding:0 6px}
        /* 읽기전용 제품명 — 길면 말줄임(전체는 tooltip) */
        .mi-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mi-code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        /* 파일위치 — 없음/구글드라이브 한 줄 선택(행 높이 일정하게) */
        .mi-file{white-space:nowrap}
        .mi-kind{display:inline-block;font-size:11.5px;font-weight:800;border-radius:6px;padding:2px 9px}
        .mi-kind.new{background:#fff4e6;color:#b4530a} .mi-kind.old{background:#eef4fb;color:#0a63c2}
        .mi-qty{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .mi-del{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:4px 5px;border-radius:7px}
        .mi-del:hover{background:#fdecea;color:#c0392b}
        .mi-meta{font-size:11px;color:var(--muted);white-space:nowrap}
        .mi-sum{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
        .mi-chip{font-size:12px;font-weight:700;border-radius:9px;padding:5px 11px;background:var(--panel-2);border:1px solid var(--line-2);color:var(--ink-2)}
        .mi-chip b{color:#12886a}
        .mi-search{height:36px;border:1px solid var(--line-2);border-radius:9px;padding:0 12px;font:inherit;min-width:200px;background:var(--panel);color:var(--ink)}
        /* 좌: 입고 시트 · 우: 입고 일정 달력 */
        .mi-layout{display:grid;grid-template-columns:minmax(0,1fr) 384px;gap:18px;align-items:start}
        @media(max-width:1220px){.mi-layout{grid-template-columns:1fr}}
        .mi-side .mi-card{margin-bottom:0}
        .mi-cal-hd{display:flex;align-items:center;gap:8px;margin-bottom:12px}
        .mi-cal-hd .t{font-weight:800;font-size:14.5px;color:var(--ink)}
        .mi-cal-nav{border:1px solid var(--line-2);background:var(--panel);border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:15px;line-height:1;color:var(--ink-2)}
        .mi-cal-nav:hover{background:var(--panel-2);border-color:#12886a;color:#12886a}
        .mi-cal-today{margin-left:auto;font-size:12px;font-weight:700;border:1px solid var(--line-2);background:var(--panel);border-radius:8px;padding:5px 11px;cursor:pointer;color:#12886a}
        .mi-cal-today:hover{background:#eafaf3}
        /* 요일 헤더와 날짜 그리드를 분리 + 날짜 행은 고정 높이 → 빈 칸 때문에 첫 주가 늘어나던 문제 방지 */
        .mi-dowrow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}
        .mi-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;grid-auto-rows:44px;align-content:start}
        .mi-dow{text-align:center;font-size:11px;font-weight:800;color:var(--muted);padding:1px 0 3px}
        .mi-dow.sun{color:#c0392b}.mi-dow.sat{color:#0a63c2}
        .mi-day{position:relative;min-height:0;border:1px solid var(--line);border-radius:9px;background:var(--panel);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:12.5px;color:var(--ink-2);transition:border-color .12s,background .12s}
        .mi-day.empty{border-color:transparent;background:transparent;cursor:default}
        .mi-day:hover:not(.empty):not(.sel){border-color:#12886a}
        .mi-day.has{background:#eafaf3;border-color:#bfe9d5;font-weight:800;color:#0f7259}
        .mi-day.today{box-shadow:inset 0 0 0 2px #12886a55}
        .mi-day.sel{background:#12886a;border-color:#12886a;color:#fff;font-weight:800}
        .mi-day .dn{line-height:1}
        .mi-day .badge{font-size:9.5px;font-weight:800;background:#12886a;color:#fff;border-radius:8px;padding:0 5px;line-height:15px;min-width:15px;text-align:center}
        .mi-day.sel .badge{background:#fff;color:#12886a}
        .mi-cal-info{margin-top:12px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:9px;line-height:1.6}
        .mi-cal-info b{color:#12886a}
        .mi-cal-clear{color:var(--muted);text-decoration:underline;cursor:pointer;font-weight:600}
        .mi-fchip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#0f7259;background:#eafaf3;border:1px solid #bfe9d5;border-radius:8px;padding:4px 10px}
        .mi-fchip .x{cursor:pointer;font-weight:800}
      </style>

      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">자사제품 입고</div>
          <div class="ds">자사제품(중국·마우저)의 입고 내역을 직접 기록·수정합니다. 구분·상품코드·제품명·입고 수량·파일위치를 입력하세요.</div></div>
        <div class="mhead-act mi-sum" id="miSum"></div>
      </div></div>
      <div class="mbody">
      ${editable?`<div class="mi-card"><div class="mi-hd"><span class="mi-ic">${icon('box')}</span> 입고 추가</div>
        <div class="mi-bd"><div class="mi-add">
          <div><label>입고날짜</label><input class="mi-in" id="miDate" type="date"></div>
          <div><label>구분</label><select class="mi-in" id="miKind">${KINDS.map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select></div>
          <div><label>상품코드</label><input class="mi-in" id="miCode" placeholder="예: P-T604" autocomplete="off"></div>
          <div><label>제품명</label><input class="mi-in" id="miName" placeholder="제품명" autocomplete="off"></div>
          <div><label>입고 수량</label><input class="mi-in mi-qty" id="miQty" placeholder="0" inputmode="numeric"></div>
          <div><label>파일위치</label><select class="mi-in" id="miFile"><option value="없음">없음</option><option value="구글드라이브">구글드라이브</option></select></div>
          <div><label>&nbsp;</label><button class="mi-addbtn" id="miAdd">추가</button></div>
        </div></div></div>`:''}

      <div class="mi-layout">
        <div class="mi-main">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <input class="mi-search" id="miQ" type="search" placeholder="상품코드·제품명 검색">
            <span id="miFilter"></span>
            <span class="muted" id="miCount" style="font-size:12px;margin-left:auto"></span>
          </div>
          <div class="mi-card"><div style="overflow:auto;max-height:calc(100vh - 320px)">
            <table class="mi-t">
            <colgroup><col style="width:138px"><col style="width:112px"><col style="width:98px"><col><col style="width:76px"><col style="width:98px"><col style="width:100px">${editable?'<col style="width:44px">':''}</colgroup>
            <thead><tr>
              <th>입고날짜</th><th>구분</th><th>상품코드</th><th>제품명</th>
              <th style="text-align:right">입고 수량</th><th>파일위치</th><th>등록</th>${editable?'<th></th>':''}
            </tr></thead><tbody id="miRows"></tbody></table>
          </div></div>
        </div>
        <aside class="mi-side">
          <div class="mi-card"><div class="mi-hd"><span class="mi-ic">${icon('check2')||icon('box')}</span> 입고 일정</div>
            <div class="mi-bd mi-cal" id="miCal"></div></div>
        </aside>
      </div>
      </div>`;

      const $=s=>root.querySelector(s);
      const rowsEl=$('#miRows'), sumEl=$('#miSum'), countEl=$('#miCount');

      function fmtWhen(iso){ try{ const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch{ return ''; } }
      function persist(item){ item.updatedAt=nowISO(); item.whoName=meU().name||meU().loginId||item.whoName||''; api.push(item); store(CACHE).set(items); }

      function render(){
        const term=q.trim().toLowerCase();
        // 정렬: 입고날짜 최신순 → 같으면 등록 최신순(편집 중 행이 튀지 않게 createdAt 기준)
        const view=items.slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||''))
            || String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||'')))
          .filter(it=> (!dateFilter || it.date===dateFilter)
            && (!term || ((it.code||'')+' '+(it.name||'')).toLowerCase().includes(term)));
        // 요약: 신제품/기존 건수 + 총 입고 수량
        const cNew=items.filter(it=>/신제품/.test(it.kind||'')).length, cOld=items.filter(it=>!/신제품/.test(it.kind||'')).length;
        const totQty=items.reduce((s,it)=>s+num(it.qty),0);
        sumEl.innerHTML=`<span class="mi-chip">전체 <b>${items.length}</b>건</span>
          <span class="mi-chip">신제품 <b>${cNew}</b> · 기존 <b>${cOld}</b></span>
          <span class="mi-chip">총 입고 수량 <b>${won(totQty)}</b></span>`;
        // 달력 날짜필터 칩(선택 시 표시)
        const fEl=$('#miFilter'); if(fEl) fEl.innerHTML = dateFilter
          ? `<span class="mi-fchip">${icon('check2')||''} ${esc(dateFilter)} 입고<span class="x" id="miFClear" title="필터 해제">✕</span></span>` : '';
        const fc=$('#miFClear'); if(fc) fc.onclick=()=>{ dateFilter=''; render(); };
        countEl.textContent=`${view.length}/${items.length}건`;
        if(!view.length){ rowsEl.innerHTML=`<tr><td colspan="${editable?8:7}" class="nx-empty" style="padding:26px">${dateFilter?esc(dateFilter)+' 입고 내역이 없습니다.':term?'검색 결과가 없습니다.':'아직 입고 내역이 없습니다.'+(editable?' 위에서 추가하세요.':'')}</td></tr>`; renderCal(); return; }
        rowsEl.innerHTML=view.map(it=>{
          const id=esc(it.id); const isNew=/신제품/.test(it.kind||'');
          if(editable) return `<tr data-id="${id}">
            <td><input class="mi-cell" data-f="date" type="date" value="${esc(it.date||'')}"></td>
            <td><select class="mi-cell" data-f="kind">${KINDS.map(k=>`<option value="${esc(k)}" ${it.kind===k?'selected':''}>${esc(k)}</option>`).join('')}</select></td>
            <td><input class="mi-cell" data-f="code" value="${esc(it.code||'')}" placeholder="상품코드"></td>
            <td><input class="mi-cell" data-f="name" value="${esc(it.name||'')}" placeholder="제품명" title="${esc(it.name||'')}"></td>
            <td><input class="mi-cell mi-qty" data-f="qty" value="${esc(String(it.qty||''))}" inputmode="numeric" placeholder="0"></td>
            <td class="mi-file">${fileCellHtml(it,true)}</td>
            <td class="mi-meta">${esc(it.whoName||'-')}<div>${esc(fmtWhen(it.updatedAt))}</div></td>
            <td><button class="mi-del" data-del="${id}" title="삭제">✕</button></td></tr>`;
          return `<tr data-id="${id}">
            <td>${esc(it.date||'-')}</td>
            <td><span class="mi-kind ${isNew?'new':'old'}">${esc(it.kind||'-')}</span></td>
            <td class="mono mi-code" title="${esc(it.code||'')}">${esc(it.code||'-')}</td>
            <td class="mi-name" title="${esc(it.name||'')}">${esc(it.name||'-')}</td>
            <td class="mi-qty">${won(num(it.qty))}</td>
            <td class="mi-file">${fileCellHtml(it,false)}</td>
            <td class="mi-meta">${esc(it.whoName||'-')}<div>${esc(fmtWhen(it.updatedAt))}</div></td></tr>`;
        }).join('');
        renderCal();
        if(!editable) return;
        // 인라인 편집 — 값 변경 시 해당 행만 저장(수량은 숫자 정규화)
        rowsEl.querySelectorAll('tr[data-id]').forEach(tr=>{ const it=items.find(x=>String(x.id)===tr.dataset.id); if(!it) return;
          tr.querySelectorAll('[data-f]').forEach(inp=>inp.onchange=()=>{ const f=inp.dataset.f;
            if(f==='qty'){ it.qty=num(inp.value); inp.value=it.qty; } else it[f]=inp.value.trim();
            persist(it);
            if(f==='qty' || f==='kind' || f==='date'){ render(); } });
          const db=tr.querySelector('[data-del]'); if(db) db.onclick=()=>{ if(!confirm('이 입고 내역을 삭제할까요?')) return;
            api.del(it.id); items=items.filter(x=>String(x.id)!==String(it.id)); store(CACHE).set(items); render(); toast('삭제했습니다'); };
        });
      }
      // 파일위치 셀 — 없음/구글드라이브 한 줄 선택(행 높이 일정)
      function fileCellHtml(it, edit){
        const gd=it.file==='구글드라이브';
        if(edit) return `<select class="mi-cell" data-f="file">
            <option value="없음" ${!gd?'selected':''}>없음</option>
            <option value="구글드라이브" ${gd?'selected':''}>구글드라이브</option></select>`;
        return gd ? '구글드라이브' : '<span class="muted">없음</span>';
      }

      // 입고 일정 달력 — 월별로 입고 예정/기록 건수를 표시, 날짜 클릭 시 시트를 그 날짜로 필터
      function ymd(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
      function renderCal(){
        const box=$('#miCal'); if(!box) return;
        const agg={}; items.forEach(it=>{ const d=it.date; if(!d) return; const a=agg[d]=agg[d]||{n:0,q:0}; a.n++; a.q+=num(it.qty); });
        const startDow=new Date(calY,calM,1).getDay(); const days=new Date(calY,calM+1,0).getDate();
        const todayS=todayStr(); const mPrefix=`${calY}-${String(calM+1).padStart(2,'0')}`;
        let mN=0, mQ=0; Object.keys(agg).forEach(k=>{ if(k.slice(0,7)===mPrefix){ mN+=agg[k].n; mQ+=agg[k].q; } });
        const cells=[];
        for(let i=0;i<startDow;i++) cells.push('<div class="mi-day empty"></div>');
        for(let d=1;d<=days;d++){ const ds=ymd(calY,calM,d); const a=agg[ds];
          const cls=['mi-day']; if(a) cls.push('has'); if(ds===todayS) cls.push('today'); if(ds===dateFilter) cls.push('sel');
          cells.push(`<div class="${cls.join(' ')}" data-day="${ds}" title="${a?`입고 ${a.n}건 · 수량 ${won(a.q)}`:''}"><span class="dn">${d}</span>${a?`<span class="badge">${a.n}</span>`:''}</div>`); }
        box.innerHTML=`
          <div class="mi-cal-hd"><button class="mi-cal-nav" data-nav="-1">‹</button>
            <span class="t">${calY}년 ${calM+1}월</span>
            <button class="mi-cal-nav" data-nav="1">›</button>
            <button class="mi-cal-today" id="miCalToday">오늘</button></div>
          <div class="mi-dowrow">${['일','월','화','수','목','금','토'].map((w,i)=>`<div class="mi-dow ${i===0?'sun':i===6?'sat':''}">${w}</div>`).join('')}</div>
          <div class="mi-grid">${cells.join('')}</div>
          <div class="mi-cal-info">${dateFilter
            ? `<b>${esc(dateFilter)}</b> 입고 <b>${(agg[dateFilter]||{}).n||0}</b>건 · 수량 <b>${won((agg[dateFilter]||{}).q||0)}</b> · <span class="mi-cal-clear" id="miCalClear">전체 보기</span>`
            : `이번 달 입고 <b>${mN}</b>건 · 수량 <b>${won(mQ)}</b><br><span class="muted" style="font-size:11px">날짜를 누르면 그날 입고만 볼 수 있어요.</span>`}</div>`;
        box.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ calM+=Number(b.dataset.nav);
          if(calM<0){ calM=11; calY--; } if(calM>11){ calM=0; calY++; } renderCal(); });
        const tb=box.querySelector('#miCalToday'); if(tb) tb.onclick=()=>{ const t=new Date(); calY=t.getFullYear(); calM=t.getMonth(); renderCal(); };
        box.querySelectorAll('[data-day]').forEach(c=>{ if(c.classList.contains('empty')) return;
          c.onclick=()=>{ dateFilter=(dateFilter===c.dataset.day)?'':c.dataset.day; render(); }; });
        const cl=box.querySelector('#miCalClear'); if(cl) cl.onclick=()=>{ dateFilter=''; render(); };
      }

      if(editable){
        const dateEl=$('#miDate'), kindEl=$('#miKind'), codeEl=$('#miCode'), nameEl=$('#miName'), qtyEl=$('#miQty'), fileEl=$('#miFile');
        if(dateEl) dateEl.value=todayStr();   // 기본값: 오늘 (달력에서 변경 가능)
        const add=()=>{ const code=codeEl.value.trim(), name=nameEl.value.trim(), qty=num(qtyEl.value);
          if(!code && !name){ toast('상품코드 또는 제품명을 입력하세요'); codeEl.focus(); return; }
          const date=(dateEl&&dateEl.value)||todayStr();
          const file=(fileEl&&fileEl.value)||'없음';
          const item={ id:uuid(), day:todayStr(), date, kind:kindEl.value||KINDS[0], code, name, qty, file, createdAt:nowISO() };
          items.push(item); persist(item);
          codeEl.value=''; nameEl.value=''; qtyEl.value=''; kindEl.value=KINDS[0]; if(dateEl) dateEl.value=todayStr();
          if(fileEl) fileEl.value='없음'; codeEl.focus();
          q=''; const qEl=$('#miQ'); if(qEl) qEl.value=''; render();
          toast(`입고 추가 — ${date} · ${code||name} ${qty?'× '+won(qty):''}`); };
        $('#miAdd').onclick=add;
        [codeEl,nameEl,qtyEl].forEach(elm=>elm&&elm.addEventListener('keydown',e=>{ if(e.key==='Enter') add(); }));
      }
      const qEl=$('#miQ'); if(qEl) qEl.oninput=()=>{ q=qEl.value; render(); };

      render();
      // 서버 최신본으로 교체(팀 공유) — 실패 시 로컬 캐시 유지
      api.list().then(list=>{ if(!root.isConnected || list==null) return; items=list; store(CACHE).set(items); render(); });
    }
  };
})();
