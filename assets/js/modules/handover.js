/* ===========================================================================
   거래처 인수인계 카드 (입점사 관리 / 파트너사 관리)
   - 담당자가 거래처를 직접 등록하고, 클릭하면 중요사항·주의사항·메모·담당자·결제조건
     카드가 열려 편집. 담당자가 바뀌어도 이 카드만 보면 파악 가능(업무 지식 보존 1단계).
   - 저장은 서버 공용 컬렉션(coll)로 팀 전체 즉시 공유.
   - buildHandover(cfg) 로 MD(입점사)·CS(파트너사) 두 곳에서 동일 UI 재사용.
   ========================================================================= */
(function(){
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const me = ()=> (Auth.user&&Auth.user())||{};

  async function collGet(coll){ try{ const r=await fetch('/api/store?type=coll&coll='+coll); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }
  async function collPush(coll,item){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll,item})}); return r.ok; }catch(e){ return false; } }
  async function collDel(coll,id){ try{ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collDel',coll,id})}); return r.ok; }catch(e){ return false; } }

  // 기본 카드 항목(MD 입점사) — 담당자·결제조건·중요/주의사항·메모
  const DEFAULT_FIELDS=[
    { k:'manager',  label:'담당자',   ph:'우리 측 / 상대 측 담당자·연락처', badge:true },
    { k:'payTerms', label:'결제조건', ph:'예: 월말마감 익월정산 / 선결제 / 위탁' },
    { k:'important',label:'중요사항', ta:1, ph:'꼭 알아야 할 핵심 정보(단가·정산·핵심 연락)' },
    { k:'caution',  label:'주의사항', ta:1, ph:'실수하기 쉬운 점·리스크·금기' },
    { k:'memo',     label:'메모',     ta:1, ph:'기타 참고·협상 이력 등' },
  ];
  // CS 파트너사 카드 항목 — 등급·공급율·사이트·담당자·연락처·메일·결제조건·메모
  const PARTNER_FIELDS=[
    { k:'grade',      label:'등급',     ph:'예: 파트너사 A / B / C · B2B', badge:true },
    { k:'supplyRate', label:'공급율',   ph:'예: 키트·부품 20% / 보드 10% / 입점사 5%' },
    { k:'site',       label:'사이트',   ph:'쇼핑몰/사이트 URL 또는 결제 아이디' },
    { k:'manager',    label:'담당자명', ph:'담당자', badge:true },
    { k:'contact',    label:'연락처',   ph:'연락처' },
    { k:'email',      label:'메일',     ph:'이메일' },
    { k:'payTerms',   label:'결제조건', ph:'예: 선결제 / 월정산 / 위탁' },
    { k:'memo',       label:'메모',     ta:1, ph:'기타 참고·협상 이력 등' },
  ];
  const uid = ()=> 'v'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
  const snippet = (s,n)=>{ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n)+'…':s; };

  function buildHandover(cfg){
    // cfg: { key, coll, unit('입점사'|'파트너사'), dept('md'|'cs'), title, desc }
    const FIELDS = cfg.fields || DEFAULT_FIELDS;   // 인스턴스별 카드 항목
    MODULES[cfg.key]={
      title:cfg.title, icon:'folder',
      render(root){
        const canEdit=()=> isAdmin() || me().dept===cfg.dept;
        let list=[], q='';
        root.innerHTML=`
        <style>
          .hv-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
          .hv-bar input.q{flex:1;min-width:180px;font:inherit;border:1px solid var(--line-2);border-radius:9px;padding:9px 12px}
          .hv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
          .hv-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:14px 16px;cursor:pointer;transition:box-shadow .12s,transform .12s}
          .hv-card:hover{box-shadow:var(--sh-md);transform:translateY(-1px)}
          .hv-nm{font-size:15px;font-weight:800;color:var(--ink);margin-bottom:4px}
          .hv-mgr{display:inline-block;font-size:11px;font-weight:800;color:var(--info);background:var(--info-bg);border-radius:5px;padding:1px 7px;margin-bottom:8px}
          .hv-line{font-size:12.5px;color:var(--ink-2);margin:3px 0;line-height:1.5}
          .hv-line b{color:var(--muted);font-weight:700;font-size:11px}
          .hv-empty{padding:44px;text-align:center;color:var(--muted)}
        </style>
        <div class="mhead">
          <div class="tt">${esc(cfg.title)}</div>
          <div class="ds">${esc(cfg.desc)}</div>
        </div>
        <div class="mbody wide" id="hvBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
        const body=root.querySelector('#hvBody');

        function draw(){
          const term=q.trim().toLowerCase();
          const rows=list.filter(v=>!term || (String(v.name||'')+String(v.manager||'')).toLowerCase().includes(term))
                         .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ko'));
          body.innerHTML=`
            <div class="hv-bar">
              <input class="q" placeholder="${esc(cfg.unit)}명·담당자 검색" value="${esc(q)}">
              ${canEdit()?`<button class="btn pri" id="hvAdd">${icon('plus')}새 ${esc(cfg.unit)}</button>`:''}
              <span class="muted" style="font-size:12.5px">${rows.length}곳</span>
            </div>
            ${rows.length?`<div class="hv-grid">${rows.map(cardHtml).join('')}</div>`
              :`<div class="hv-empty">${icon('folder')}<div style="margin-top:8px">등록된 ${esc(cfg.unit)}가 없습니다.${canEdit()?` <b>[새 ${esc(cfg.unit)}]</b>로 추가하세요.`:''}</div></div>`}`;
          const qi=body.querySelector('.q'); qi.oninput=()=>{ q=qi.value; const p=qi.selectionStart; draw(); const n=body.querySelector('.q'); n.focus(); try{n.setSelectionRange(p,p);}catch(e){} };
          const add=body.querySelector('#hvAdd'); if(add) add.onclick=()=>openCard(null);
          body.querySelectorAll('[data-id]').forEach(c=>c.onclick=()=>{ const v=list.find(x=>x.id===c.dataset.id); if(v) openCard(v); });
        }
        function cardHtml(v){
          const badges=FIELDS.filter(f=>f.badge && String(v[f.k]||'').trim())
            .map(f=>`<span class="hv-mgr">${icon('users')}${esc(v[f.k])}</span>`).join(' ');
          const lines=FIELDS.filter(f=>!f.badge && String(v[f.k]||'').trim()).slice(0,4)
            .map(f=>`<div class="hv-line"><b>${esc(f.label)}</b> ${esc(snippet(v[f.k],48))}</div>`).join('');
          return `<div class="hv-card" data-id="${esc(v.id)}">
            <div class="hv-nm">${esc(v.name||'(이름 없음)')}</div>
            ${badges?`<div style="margin-bottom:8px">${badges}</div>`:''}
            ${lines}
          </div>`;
        }
        function openCard(v){
          const edit=canEdit(); const isNew=!v; v=v||{ id:uid() };
          const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
          const fieldHtml=f=>{
            const val=v[f.k]==null?'':v[f.k];
            const input=edit
              ? (f.ta?`<textarea data-k="${f.k}" style="width:100%;min-height:70px;font:inherit;font-size:13px;line-height:1.6;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px;resize:vertical" placeholder="${esc(f.ph)}">${esc(val)}</textarea>`
                       :`<input data-k="${f.k}" style="width:100%;font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:8px 11px" placeholder="${esc(f.ph)}" value="${esc(val)}">`)
              : `<div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:var(--ink-2);min-height:20px">${esc(val)||'<span class="muted">-</span>'}</div>`;
            return `<div style="margin-bottom:12px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">${esc(f.label)}</div>${input}</div>`;
          };
          ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:540px;width:96%;max-height:calc(100vh - 48px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
            <div style="padding:18px 22px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
              <div style="font-size:16px;font-weight:800;flex:1">${icon('folder')} ${isNew?`새 ${esc(cfg.unit)} 등록`:esc(cfg.unit)+' 인수인계 카드'}</div>
              <button class="btn ghost sm" id="hvClose">${icon('x')}</button>
            </div>
            <div style="padding:16px 22px;overflow-y:auto">
              <div style="margin-bottom:12px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">${esc(cfg.unit)}명</div>
                ${edit?`<input id="hvName" style="width:100%;font:inherit;font-size:14px;font-weight:700;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px" placeholder="${esc(cfg.unit)}명" value="${esc(v.name||'')}">`
                      :`<div style="font-size:15px;font-weight:800">${esc(v.name||'')}</div>`}</div>
              ${FIELDS.map(fieldHtml).join('')}
              ${v.updatedBy?`<div class="muted" style="font-size:11.5px;margin-top:4px">최종 수정: ${esc(v.updatedBy)} · ${esc((v.updatedAt||'').slice(0,10))}</div>`:''}
              <div id="hvMsg" class="muted" style="font-size:12.5px;margin-top:6px;min-height:16px"></div>
            </div>
            ${edit?`<div style="display:flex;gap:8px;justify-content:space-between;padding:14px 22px;border-top:1px solid var(--line)">
              <div>${isNew?'':`<button class="btn ghost" id="hvDel" style="color:var(--danger)">${icon('trash')}삭제</button>`}</div>
              <div style="display:flex;gap:8px"><button class="btn ghost" id="hvCancel">취소</button><button class="btn pri" id="hvSave">${icon('save')}저장</button></div>
            </div>`:''}
          </div>`;
          document.body.appendChild(ov);
          const close=()=>ov.remove();
          ov.onclick=e=>{ if(e.target===ov) close(); };
          ov.querySelector('#hvClose').onclick=close;
          const cancel=ov.querySelector('#hvCancel'); if(cancel) cancel.onclick=close;
          const save=ov.querySelector('#hvSave');
          if(save) save.onclick=async()=>{
            const name=(ov.querySelector('#hvName').value||'').trim();
            const msg=ov.querySelector('#hvMsg');
            if(!name){ msg.innerHTML='<span style="color:var(--danger)">'+cfg.unit+'명을 입력하세요.</span>'; return; }
            const rec={ id:v.id, name };
            ov.querySelectorAll('[data-k]').forEach(el2=>{ rec[el2.dataset.k]=el2.value; });
            rec.updatedBy=me().name||me().loginId||''; rec.updatedAt=new Date().toISOString();
            save.disabled=true; msg.innerHTML='<span style="color:var(--info)">저장 중…</span>';
            const ok=await collPush(cfg.coll,rec);
            if(ok){ toast(cfg.unit+' 카드를 저장했습니다'); close(); await load(); }
            else{ save.disabled=false; msg.innerHTML='<span style="color:var(--danger)">저장 실패 — 잠시 후 다시 시도</span>'; }
          };
          const del=ov.querySelector('#hvDel');
          if(del) del.onclick=async()=>{ if(!confirm(`'${v.name}' 카드를 삭제할까요? (팀 전체에서 사라집니다)`)) return;
            del.disabled=true; const ok=await collDel(cfg.coll,v.id);
            if(ok){ toast('삭제했습니다'); close(); await load(); } else { del.disabled=false; toast('삭제 실패'); } };
        }
        async function load(){ const items=await collGet(cfg.coll); if(!root.isConnected) return;
          list=(items||[]).filter(x=>x&&x.id); draw(); }
        load();
      }
    };
  }

  // ── MD: 입점사 관리 (신규/변동사항 + 입점사 관리 카드) ──
  buildHandover({ key:'md.vendorcards', coll:'handover_md', unit:'입점사', dept:'md',
    title:'입점사 관리', desc:'입점사별 담당자·결제조건·중요/주의사항·메모를 카드로 관리합니다(인수인계).' });
  // CS: 파트너사 관리 (단독 페이지)
  buildHandover({ key:'cs.partners', coll:'handover_cs', unit:'파트너사', dept:'cs', fields:PARTNER_FIELDS,
    title:'파트너사 관리', desc:'파트너사별 등급·공급율·사이트·담당자·연락처·메일·결제조건·메모를 카드로 관리합니다.' });

  // MD '입점사 관리' 컨테이너 — 서브탭: 신규/변동사항(먼저) + 입점사 관리(카드)
  MODULES['md.vendormgmt']={
    title:'입점사 관리', icon:'truck',
    render(root){
      const SUBS=[
        { t:'changes', key:'md.vendorchg',   label:'신규/변동사항' },
        { t:'cards',   key:'md.vendorcards', label:'입점사 관리' },
      ];
      let tab='changes';
      root.innerHTML=`
        <div class="mhead">
          <div class="tt">입점사 관리</div>
          <div class="ds">입점사 신규/변동사항 기록과, 입점사별 인수인계 카드를 한 곳에서 관리합니다.</div>
          <div class="mtabs">${SUBS.map(s=>`<div class="t" data-t="${s.t}">${esc(s.label)}</div>`).join('')}</div>
        </div>
        <div class="mbody wide" id="vmBody"></div>`;
      const body=root.querySelector('#vmBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      function draw(){ const s=SUBS.find(x=>x.t===tab)||SUBS[0]; embedModule(body, s.key); }
      draw();
    }
  };

  window.buildHandover = buildHandover;
})();
