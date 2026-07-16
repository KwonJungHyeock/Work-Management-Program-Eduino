/* ===========================================================================
   업무 매뉴얼 (CS · MD · 물류) — 살아있는 직무 매뉴얼(SOP)
   - 탭(업무별 페이지) 추가/이름변경/삭제.
   - 각 탭은 3분할: [업무 우선순위 / 중요사항 / 주의사항] (섹션 제목은 관리자가 수정 가능).
   - 팀 공유 저장(부서 범위) → 같은 부서 누구나 열람, 담당자·관리자가 편집.
   - 최초 진입 시 각 부서 페이지 이름으로 샘플 탭을 자동 생성.
   ========================================================================= */
(function(){
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const me = ()=> (Auth.user&&Auth.user())||{};
  const newId = ()=> 't'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
  const DEFAULT_TITLES = ['업무 우선순위','중요사항','주의사항'];
  const N = 3;

  function buildManual(cfg){
    // cfg: { key, dept('cs'|'md'|'logi'), storeKey, title, seed:[탭이름…] }
    MODULES[cfg.key]={
      title:cfg.title, icon:'clipboard',
      render(root){
        const canEdit=()=> isAdmin() || me().dept===cfg.dept;   // 본문 편집: 부서원·관리자
        let data=store(cfg.storeKey).get(null);
        // 최초 생성 / 구버전(content 단일) → 3분할(cells) 마이그레이션
        if(!data || !Array.isArray(data.tabs) || !data.tabs.length){
          data={ sectionTitles:DEFAULT_TITLES.slice(), tabs:(cfg.seed||['새 탭']).map(n=>({ id:newId(), name:n, cells:['','',''] })) };
          if(canEdit()) store(cfg.storeKey).set(data);
        } else {
          if(!Array.isArray(data.sectionTitles)||data.sectionTitles.length!==N) data.sectionTitles=DEFAULT_TITLES.slice();
          data.tabs.forEach(t=>{ if(!Array.isArray(t.cells)){ t.cells=[String(t.content||''),'','']; delete t.content; }
            while(t.cells.length<N) t.cells.push(''); });
        }
        let activeId=data.tabs[0] && data.tabs[0].id;
        let titleEdit=false;
        const persist=()=>{ data.updatedBy=me().name||me().loginId||''; data.updatedAt=new Date().toISOString(); store(cfg.storeKey).set(data); };

        root.innerHTML=`
        <style>
          .mn-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:14px}
          .mn-tab{border:1px solid var(--line-2);background:var(--panel);border-radius:8px 8px 0 0;padding:8px 14px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer}
          .mn-tab.on{background:var(--active-bg);color:var(--red);border-color:var(--red)}
          .mn-add{border:1px dashed var(--line-2);background:transparent;color:var(--muted);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer}
          .mn-tools{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
          .mn-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
          @media(max-width:900px){.mn-cols{grid-template-columns:1fr}}
          .mn-col{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);display:flex;flex-direction:column;overflow:hidden}
          .mn-colhd{padding:11px 14px;font-size:13.5px;font-weight:800;color:#fff;display:flex;align-items:center;gap:8px}
          .mn-col.c0 .mn-colhd{background:linear-gradient(135deg,#1f6feb,#4d9bff)}
          .mn-col.c1 .mn-colhd{background:linear-gradient(135deg,#12a5a5,#1fb7a8)}
          .mn-col.c2 .mn-colhd{background:linear-gradient(135deg,#e0313b,#ff5257)}
          .mn-colhd .ti{width:20px;height:20px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.22);border-radius:6px;font-size:12px}
          .mn-colhd input{flex:1;font:inherit;font-size:13.5px;font-weight:800;color:#fff;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.5);border-radius:6px;padding:4px 8px}
          .mn-colhd input::placeholder{color:rgba(255,255,255,.7)}
          .mn-cell{flex:1;min-height:calc(100vh - 430px);font:inherit;font-size:13.5px;line-height:1.75;border:0;padding:14px 16px;resize:vertical;background:transparent;color:var(--ink)}
          .mn-view{white-space:pre-wrap;font-size:13.5px;line-height:1.75;padding:14px 16px;color:var(--ink-2);min-height:160px}
          .mn-meta{font-size:11.5px;color:var(--muted);margin-top:12px}
          .mn-empty{padding:44px;text-align:center;color:var(--muted)}
        </style>
        <div class="mhead">
          <div class="tt">${esc(cfg.title)}</div>
          <div class="ds">업무별 매뉴얼(SOP)을 탭으로 관리합니다. 각 탭은 <b>우선순위·중요사항·주의사항</b> 3분할로 작성합니다.${canEdit()?'':' <b>(열람 전용)</b>'}</div>
        </div>
        <div class="mbody wide" id="mnBody"></div>`;
        const body=root.querySelector('#mnBody');
        const ICONS=['star','alert','info'];

        function saveActiveFromDom(){ const t=data.tabs.find(x=>x.id===activeId); if(!t) return;
          body.querySelectorAll('[data-cell]').forEach(ta=>{ const i=+ta.dataset.cell; if(i>=0&&i<N) t.cells[i]=ta.value; }); }
        function saveTitlesFromDom(){ const ins=body.querySelectorAll('[data-title]'); if(!ins.length) return;
          ins.forEach(inp=>{ const i=+inp.dataset.title; if(i>=0&&i<N) data.sectionTitles[i]=(inp.value||'').trim()||DEFAULT_TITLES[i]; }); }

        function draw(){
          const t=data.tabs.find(x=>x.id===activeId)||data.tabs[0]; activeId=t&&t.id;
          const edit=canEdit(); const admin=isAdmin();
          const colHtml=i=>{
            const title=data.sectionTitles[i]||DEFAULT_TITLES[i];
            const head = (titleEdit&&admin)
              ? `<span class="ti">${icon(ICONS[i])}</span><input data-title="${i}" value="${esc(title)}" placeholder="${esc(DEFAULT_TITLES[i])}">`
              : `<span class="ti">${icon(ICONS[i])}</span><span>${esc(title)}</span>`;
            const cellVal=(t&&t.cells[i])||'';
            const ccode = i===0?'c0':i===1?'c1':'c2';
            const inner = edit
              ? `<textarea class="mn-cell" data-cell="${i}" placeholder="${esc(title)} 내용을 적어주세요">${esc(cellVal)}</textarea>`
              : `<div class="mn-view">${esc(cellVal)||'<span class="muted">-</span>'}</div>`;
            return `<div class="mn-col ${ccode}"><div class="mn-colhd">${head}</div>${inner}</div>`;
          };
          body.innerHTML=`
            <div class="mn-tabs">
              ${data.tabs.map(x=>`<div class="mn-tab ${x.id===activeId?'on':''}" data-id="${esc(x.id)}">${esc(x.name)}</div>`).join('')}
              ${edit?`<button class="mn-add" id="mnAdd">${icon('plus')}탭 추가</button>`:''}
              ${edit&&t?`<div class="mn-tools">
                ${admin?`<button class="btn ghost sm" id="mnTitle">${icon('edit')}${titleEdit?'제목 완료':'제목 수정'}</button>`:''}
                <button class="btn ghost sm" id="mnRen">${icon('edit')}탭 이름</button>
                <button class="btn ghost sm" id="mnDel" style="color:var(--danger)">${icon('trash')}</button>
                <button class="btn pri sm" id="mnSave">${icon('save')}저장</button></div>`:''}
            </div>
            ${t?`<div class="mn-cols">${[0,1,2].map(colHtml).join('')}</div>
              ${data.updatedBy?`<div class="mn-meta">최종 수정: ${esc(data.updatedBy)} · ${esc((data.updatedAt||'').slice(0,10))}</div>`:''}`
              :`<div class="mn-empty">탭이 없습니다. ${edit?'<b>[탭 추가]</b>로 만드세요.':''}</div>`}`;

          body.querySelectorAll('.mn-tab').forEach(el2=>el2.onclick=()=>{ saveActiveFromDom(); if(titleEdit) saveTitlesFromDom(); activeId=el2.dataset.id; draw(); });
          const add=body.querySelector('#mnAdd'); if(add) add.onclick=()=>{ const n=(prompt('새 탭 이름')||'').trim(); if(!n) return; saveActiveFromDom(); const nt={ id:newId(), name:n, cells:['','',''] }; data.tabs.push(nt); activeId=nt.id; persist(); draw(); };
          const ren=body.querySelector('#mnRen'); if(ren) ren.onclick=()=>{ const cur=data.tabs.find(x=>x.id===activeId); if(!cur) return; const n=(prompt('탭 이름 변경', cur.name)||'').trim(); if(!n) return; saveActiveFromDom(); cur.name=n; persist(); draw(); };
          const del=body.querySelector('#mnDel'); if(del) del.onclick=()=>{ const cur=data.tabs.find(x=>x.id===activeId); if(!cur) return; if(!confirm(`'${cur.name}' 탭을 삭제할까요? (내용도 함께 삭제 · 팀 전체 반영)`)) return; data.tabs=data.tabs.filter(x=>x.id!==activeId); activeId=data.tabs[0]&&data.tabs[0].id; persist(); draw(); toast('탭을 삭제했습니다'); };
          const ttl=body.querySelector('#mnTitle'); if(ttl) ttl.onclick=()=>{ if(titleEdit){ saveTitlesFromDom(); saveActiveFromDom(); persist(); toast('섹션 제목을 저장했습니다'); } titleEdit=!titleEdit; draw(); };
          const sv=body.querySelector('#mnSave'); if(sv) sv.onclick=()=>{ saveActiveFromDom(); if(titleEdit) saveTitlesFromDom(); persist(); toast('매뉴얼을 저장했습니다'); };
        }
        draw();
      }
    };
  }

  buildManual({ key:'cs.manual', dept:'cs', storeKey:'eduino.manual.cs', title:'업무 매뉴얼',
    seed:['CS상담','견적/발주/후불','교환/반품','중국 발주요청','답변·메일 템플릿','고객 정보 검색'] });
  buildManual({ key:'md.manual', dept:'md', storeKey:'eduino.manual.md', title:'업무 매뉴얼',
    seed:['입점사 발주','결제요청','입점사 관리','상품·품질 관리','가격비교','TS상담'] });
  buildManual({ key:'logi.manual', dept:'logi', storeKey:'eduino.manual.logi', title:'업무 매뉴얼',
    seed:['입출고','재고관리','배송/택배','반품/교환 처리'] });

  window.buildManual = buildManual;
})();
