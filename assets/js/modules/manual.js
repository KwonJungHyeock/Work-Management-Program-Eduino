/* ===========================================================================
   업무 매뉴얼 (CS · MD) — 살아있는 직무 매뉴얼(SOP)
   - 탭(업무별 페이지) 추가/이름변경/삭제 + 내용 자유 편집. 담당자들이 각자 작성.
   - 팀 공유 저장(부서 범위) → 같은 부서 누구나 열람, 담당자·관리자가 편집.
   - 최초 진입 시 각 부서 페이지 이름으로 샘플 탭을 자동 생성.
   ========================================================================= */
(function(){
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const me = ()=> (Auth.user&&Auth.user())||{};
  const newId = ()=> 't'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);

  function buildManual(cfg){
    // cfg: { key, dept('cs'|'md'), storeKey, title, seed:[탭이름…] }
    MODULES[cfg.key]={
      title:cfg.title, icon:'clipboard',
      render(root){
        const canEdit=()=> isAdmin() || me().dept===cfg.dept;
        let data=store(cfg.storeKey).get(null);
        if(!data || !Array.isArray(data.tabs) || !data.tabs.length){
          data={ tabs:(cfg.seed||['새 탭']).map(n=>({ id:newId(), name:n, content:'' })) };
          if(canEdit()) store(cfg.storeKey).set(data);        // 씨앗 탭 최초 생성(팀 공유)
        }
        let activeId=data.tabs[0] && data.tabs[0].id;
        const persist=()=>{ data.updatedBy=me().name||me().loginId||''; data.updatedAt=new Date().toISOString(); store(cfg.storeKey).set(data); };

        root.innerHTML=`
        <style>
          .mn-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:14px}
          .mn-tab{border:1px solid var(--line-2);background:var(--panel);border-radius:8px 8px 0 0;padding:8px 14px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;position:relative}
          .mn-tab.on{background:var(--active-bg);color:var(--red);border-color:var(--red)}
          .mn-add{border:1px dashed var(--line-2);background:transparent;color:var(--muted);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer}
          .mn-tools{display:flex;gap:6px;margin-left:auto}
          .mn-body{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:0}
          .mn-ta{width:100%;min-height:calc(100vh - 380px);font:inherit;font-size:14px;line-height:1.8;border:0;border-radius:12px;padding:18px 20px;resize:vertical;background:transparent;color:var(--ink)}
          .mn-view{white-space:pre-wrap;font-size:14px;line-height:1.8;padding:18px 20px;color:var(--ink-2);min-height:200px}
          .mn-meta{font-size:11.5px;color:var(--muted);margin-top:10px}
          .mn-empty{padding:44px;text-align:center;color:var(--muted)}
        </style>
        <div class="mhead">
          <div class="tt">${esc(cfg.title)}</div>
          <div class="ds">업무별 매뉴얼(SOP)을 탭으로 관리합니다. 담당자가 직접 탭·내용을 추가·수정하세요.${canEdit()?'':' <b>(열람 전용)</b>'}</div>
        </div>
        <div class="mbody wide" id="mnBody"></div>`;
        const body=root.querySelector('#mnBody');

        function saveActiveFromDom(){ const ta=body.querySelector('#mnTa'); if(!ta) return; const t=data.tabs.find(x=>x.id===activeId); if(t) t.content=ta.value; }
        function draw(){
          const t=data.tabs.find(x=>x.id===activeId)||data.tabs[0]; activeId=t&&t.id;
          body.innerHTML=`
            <div class="mn-tabs">
              ${data.tabs.map(x=>`<div class="mn-tab ${x.id===activeId?'on':''}" data-id="${esc(x.id)}">${esc(x.name)}</div>`).join('')}
              ${canEdit()?`<button class="mn-add" id="mnAdd">${icon('plus')}탭 추가</button>`:''}
              ${canEdit()&&t?`<div class="mn-tools">
                <button class="btn ghost sm" id="mnRen">${icon('edit')}이름</button>
                <button class="btn ghost sm" id="mnDel" style="color:var(--danger)">${icon('trash')}</button>
                <button class="btn pri sm" id="mnSave">${icon('save')}저장</button></div>`:''}
            </div>
            ${t?`<div class="mn-body">
              ${canEdit()?`<textarea id="mnTa" class="mn-ta" placeholder="이 업무의 절차·기준·주의점을 적어주세요. (예: 순서, 담당, 자주 쓰는 양식, 판단 기준)">${esc(t.content||'')}</textarea>`
                          :`<div class="mn-view">${esc(t.content||'')||'<span class="muted">아직 작성된 내용이 없습니다.</span>'}</div>`}
            </div>${data.updatedBy?`<div class="mn-meta">최종 수정: ${esc(data.updatedBy)} · ${esc((data.updatedAt||'').slice(0,10))}</div>`:''}`
              :`<div class="mn-empty">탭이 없습니다. ${canEdit()?'<b>[탭 추가]</b>로 만드세요.':''}</div>`}`;

          body.querySelectorAll('.mn-tab').forEach(el2=>el2.onclick=()=>{ saveActiveFromDom(); activeId=el2.dataset.id; draw(); });
          const add=body.querySelector('#mnAdd'); if(add) add.onclick=()=>{ const n=(prompt('새 탭 이름')||'').trim(); if(!n) return; saveActiveFromDom(); const nt={ id:newId(), name:n, content:'' }; data.tabs.push(nt); activeId=nt.id; persist(); draw(); };
          const ren=body.querySelector('#mnRen'); if(ren) ren.onclick=()=>{ const cur=data.tabs.find(x=>x.id===activeId); if(!cur) return; const n=(prompt('탭 이름 변경', cur.name)||'').trim(); if(!n) return; saveActiveFromDom(); cur.name=n; persist(); draw(); };
          const del=body.querySelector('#mnDel'); if(del) del.onclick=()=>{ const cur=data.tabs.find(x=>x.id===activeId); if(!cur) return; if(!confirm(`'${cur.name}' 탭을 삭제할까요? (내용도 함께 삭제 · 팀 전체 반영)`)) return; data.tabs=data.tabs.filter(x=>x.id!==activeId); activeId=data.tabs[0]&&data.tabs[0].id; persist(); draw(); toast('탭을 삭제했습니다'); };
          const sv=body.querySelector('#mnSave'); if(sv) sv.onclick=()=>{ saveActiveFromDom(); persist(); toast('매뉴얼을 저장했습니다'); };
        }
        draw();
      }
    };
  }

  buildManual({ key:'cs.manual', dept:'cs', storeKey:'eduino.manual.cs', title:'업무 매뉴얼',
    seed:['CS상담','견적/발주/후불','교환/반품','중국 발주요청','답변·메일 템플릿','고객 정보 검색'] });
  buildManual({ key:'md.manual', dept:'md', storeKey:'eduino.manual.md', title:'업무 매뉴얼',
    seed:['입점사 발주','결제요청','입점사 관리','상품·품질 관리','가격비교','TS상담'] });

  window.buildManual = buildManual;
})();
