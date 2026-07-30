/* ===========================================================================
   물류 · 마우저 입고  — 마우저에서 들여온 상품의 입고 현황을 직접 기록·수정하는 시트
   컬럼: 구분(기존/신제품 · 드롭다운) · 상품코드 · 제품명 · 입고 수량
   - 담당자가 행을 추가하고, 각 칸을 직접 입력·수정, 필요 없으면 삭제
   - 공용 컬렉션 'mouser_inbound'(팀 공유) — 물류/MD 함께 열람. 로컬 캐시로 오프라인 표시.
   =========================================================================== */
(function(){
  const COLL='mouser_inbound';
  const CACHE='eduino.logi.mouserin';
  const KINDS=['기존','신제품'];
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
    title:'마우저 입고', icon:'box',
    render(root){
      const editable=canEdit();
      let items=store(CACHE).get([])||[];    // 로컬 캐시 먼저 표시(즉시 렌더) → 서버 최신으로 교체
      let q='';

      root.innerHTML=`
      <style>
        .mi-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:18px;box-shadow:var(--sh)}
        .mi-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15px}
        .mi-hd .mi-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:#e3f7ef;color:#12886a}
        .mi-hd .mi-ic svg{width:15px;height:15px}
        .mi-bd{padding:16px 20px}
        .mi-add{display:grid;grid-template-columns:120px 150px minmax(180px,1fr) 110px 92px;gap:10px;align-items:end}
        @media(max-width:820px){.mi-add{grid-template-columns:1fr 1fr}}
        .mi-add label{display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:4px}
        .mi-in{width:100%;height:38px;border:1px solid var(--line-2);border-radius:9px;padding:0 11px;font:inherit;background:var(--panel);color:var(--ink)}
        .mi-in:focus{outline:2px solid #12886a33;border-color:#12886a}
        .mi-addbtn{height:38px;border:0;border-radius:9px;background:#12886a;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer}
        .mi-addbtn:hover{background:#0f7259}
        table.mi-t{border-collapse:collapse;width:100%;font-size:13px}
        table.mi-t th{background:var(--panel-2);color:var(--ink-2);font-size:11.5px;font-weight:800;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.mi-t td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
        table.mi-t tr:hover td{background:var(--panel-2)}
        .mi-cell{width:100%;height:34px;border:1px solid transparent;border-radius:7px;padding:0 8px;font:inherit;background:transparent;color:var(--ink)}
        .mi-cell:hover{border-color:var(--line-2)} .mi-cell:focus{outline:0;border-color:#12886a;background:var(--panel)}
        select.mi-cell{cursor:pointer}
        .mi-kind{display:inline-block;font-size:11.5px;font-weight:800;border-radius:6px;padding:2px 9px}
        .mi-kind.new{background:#fff4e6;color:#b4530a} .mi-kind.old{background:#eef4fb;color:#0a63c2}
        .mi-qty{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
        .mi-del{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:4px 8px;border-radius:7px}
        .mi-del:hover{background:#fdecea;color:#c0392b}
        .mi-meta{font-size:11px;color:var(--muted);white-space:nowrap}
        .mi-sum{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
        .mi-chip{font-size:12px;font-weight:700;border-radius:9px;padding:5px 11px;background:var(--panel-2);border:1px solid var(--line-2);color:var(--ink-2)}
        .mi-chip b{color:#12886a}
        .mi-search{height:36px;border:1px solid var(--line-2);border-radius:9px;padding:0 12px;font:inherit;min-width:200px;background:var(--panel);color:var(--ink)}
      </style>

      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">마우저 입고</div>
          <div class="ds">마우저에서 들여온 상품의 입고 내역을 직접 기록·수정합니다. 구분(기존/신제품)·상품코드·제품명·입고 수량을 입력하세요.</div></div>
        <div class="mhead-act mi-sum" id="miSum"></div>
      </div></div>
      <div class="mbody">
      ${editable?`<div class="mi-card"><div class="mi-hd"><span class="mi-ic">${icon('box')}</span> 입고 추가</div>
        <div class="mi-bd"><div class="mi-add">
          <div><label>구분</label><select class="mi-in" id="miKind">${KINDS.map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select></div>
          <div><label>상품코드</label><input class="mi-in" id="miCode" placeholder="예: P-T604" autocomplete="off"></div>
          <div><label>제품명</label><input class="mi-in" id="miName" placeholder="제품명" autocomplete="off"></div>
          <div><label>입고 수량</label><input class="mi-in mi-qty" id="miQty" placeholder="0" inputmode="numeric"></div>
          <div><button class="mi-addbtn" id="miAdd">추가</button></div>
        </div></div></div>`:''}

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input class="mi-search" id="miQ" type="search" placeholder="상품코드·제품명 검색">
        <span class="muted" id="miCount" style="font-size:12px;margin-left:auto"></span>
      </div>
      <div class="mi-card"><div style="overflow:auto;max-height:calc(100vh - 300px)">
        <table class="mi-t"><thead><tr>
          <th style="width:110px">구분</th><th style="width:150px">상품코드</th><th>제품명</th>
          <th style="width:110px;text-align:right">입고 수량</th><th style="width:150px">등록</th>${editable?'<th style="width:44px"></th>':''}
        </tr></thead><tbody id="miRows"></tbody></table>
      </div></div>
      </div>`;

      const $=s=>root.querySelector(s);
      const rowsEl=$('#miRows'), sumEl=$('#miSum'), countEl=$('#miCount');

      function fmtWhen(iso){ try{ const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch{ return ''; } }
      function persist(item){ item.updatedAt=nowISO(); item.whoName=meU().name||meU().loginId||item.whoName||''; api.push(item); store(CACHE).set(items); }

      function render(){
        const term=q.trim().toLowerCase();
        const view=items.slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))
          .filter(it=>!term || ((it.code||'')+' '+(it.name||'')).toLowerCase().includes(term));
        // 요약: 신제품/기존 건수 + 총 입고 수량
        const cNew=items.filter(it=>it.kind==='신제품').length, cOld=items.filter(it=>it.kind!=='신제품').length;
        const totQty=items.reduce((s,it)=>s+num(it.qty),0);
        sumEl.innerHTML=`<span class="mi-chip">전체 <b>${items.length}</b>건</span>
          <span class="mi-chip">신제품 <b>${cNew}</b> · 기존 <b>${cOld}</b></span>
          <span class="mi-chip">총 입고 수량 <b>${won(totQty)}</b></span>`;
        countEl.textContent=`${view.length}/${items.length}건`;
        if(!view.length){ rowsEl.innerHTML=`<tr><td colspan="${editable?6:5}" class="nx-empty" style="padding:26px">${term?'검색 결과가 없습니다.':'아직 입고 내역이 없습니다.'+(editable?' 위에서 추가하세요.':'')}</td></tr>`; return; }
        rowsEl.innerHTML=view.map(it=>{
          const id=esc(it.id); const isNew=it.kind==='신제품';
          if(editable) return `<tr data-id="${id}">
            <td><select class="mi-cell" data-f="kind">${KINDS.map(k=>`<option value="${esc(k)}" ${it.kind===k?'selected':''}>${esc(k)}</option>`).join('')}</select></td>
            <td><input class="mi-cell" data-f="code" value="${esc(it.code||'')}" placeholder="상품코드"></td>
            <td><input class="mi-cell" data-f="name" value="${esc(it.name||'')}" placeholder="제품명"></td>
            <td><input class="mi-cell mi-qty" data-f="qty" value="${esc(String(it.qty||''))}" inputmode="numeric" placeholder="0"></td>
            <td class="mi-meta">${esc(it.whoName||'-')}<div>${esc(fmtWhen(it.updatedAt))}</div></td>
            <td><button class="mi-del" data-del="${id}" title="삭제">✕</button></td></tr>`;
          return `<tr data-id="${id}">
            <td><span class="mi-kind ${isNew?'new':'old'}">${esc(it.kind||'기존')}</span></td>
            <td class="mono">${esc(it.code||'-')}</td><td>${esc(it.name||'-')}</td>
            <td class="mi-qty">${won(num(it.qty))}</td>
            <td class="mi-meta">${esc(it.whoName||'-')}<div>${esc(fmtWhen(it.updatedAt))}</div></td></tr>`;
        }).join('');
        if(!editable) return;
        // 인라인 편집 — 값 변경 시 해당 행만 저장(수량은 숫자 정규화)
        rowsEl.querySelectorAll('tr[data-id]').forEach(tr=>{ const it=items.find(x=>String(x.id)===tr.dataset.id); if(!it) return;
          tr.querySelectorAll('[data-f]').forEach(inp=>inp.onchange=()=>{ const f=inp.dataset.f;
            if(f==='qty'){ it.qty=num(inp.value); inp.value=it.qty; } else it[f]=inp.value.trim();
            persist(it);
            if(f==='qty' || f==='kind'){ render(); } });
          const db=tr.querySelector('[data-del]'); if(db) db.onclick=()=>{ if(!confirm('이 입고 내역을 삭제할까요?')) return;
            api.del(it.id); items=items.filter(x=>String(x.id)!==String(it.id)); store(CACHE).set(items); render(); toast('삭제했습니다'); };
        });
      }

      if(editable){
        const kindEl=$('#miKind'), codeEl=$('#miCode'), nameEl=$('#miName'), qtyEl=$('#miQty');
        const add=()=>{ const code=codeEl.value.trim(), name=nameEl.value.trim(), qty=num(qtyEl.value);
          if(!code && !name){ toast('상품코드 또는 제품명을 입력하세요'); codeEl.focus(); return; }
          const item={ id:uuid(), day:todayStr(), kind:kindEl.value||'기존', code, name, qty };
          items.push(item); persist(item);
          codeEl.value=''; nameEl.value=''; qtyEl.value=''; kindEl.value='기존'; codeEl.focus();
          q=''; const qEl=$('#miQ'); if(qEl) qEl.value=''; render();
          toast(`입고 추가 — ${code||name} ${qty?'× '+won(qty):''}`); };
        $('#miAdd').onclick=add;
        [codeEl,nameEl,qtyEl].forEach(elm=>elm.addEventListener('keydown',e=>{ if(e.key==='Enter') add(); }));
      }
      const qEl=$('#miQ'); if(qEl) qEl.oninput=()=>{ q=qEl.value; render(); };

      render();
      // 서버 최신본으로 교체(팀 공유) — 실패 시 로컬 캐시 유지
      api.list().then(list=>{ if(!root.isConnected || list==null) return; items=list; store(CACHE).set(items); render(); });
    }
  };
})();
