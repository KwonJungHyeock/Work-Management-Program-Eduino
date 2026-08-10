/* ===========================================================================
   요청(Requests) UI — 팀원 '요청하기' + 부서장/관리자 '받은 요청(처리함)'
   - 새 요청: 범위 카탈로그(Req.CATS)에서 유형 선택 → 작성 모달
   - 내 요청: 내가 보낸 요청의 상태 추적
   - 받은 요청(처리자): 바로가기(딥링크) + 처리중/완료/반려
   window.openReqComposer(prefill) 로 다른 화면에서 문맥 요청도 띄울 수 있음.
   =========================================================================== */
(function(){
  const meU=()=>(Auth.user&&Auth.user())||{};
  const esc0=s=>String(s==null?'':s);
  const fmtDay=iso=>{ try{ const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch(e){ return ''; } };
  const stBadge=st=>{ const m={sent:['#b4530a','#fff4e6'],doing:['#0a63c2','#e8f1fc'],done:['#12886a','#e6f7f0'],rejected:['#8a8f98','#eef0f3']};
    const c=m[st]||m.sent; return `<span style="font-size:11px;font-weight:800;border-radius:7px;padding:2px 9px;color:${c[0]};background:${c[1]}">${esc(Req.STATUS[st]||st)}</span>`; };
  // NAV 기반 페이지 목록(권한 요청 대상 선택용)
  /* 처리 담당자 후보 — 관리자(대표)·팀장·파트장 계정. 한 번 받아 캐시 */
  const ROLE_LABEL={ admin:'대표/관리자', manager:'팀장', lead:'파트장' };
  let _handlers=null;
  async function handlerList(){
    if(_handlers) return _handlers;
    try{
      const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})});
      const d=await r.json(); const list=(d&&d.roster)||[];
      const rank={admin:0,manager:1,lead:2};
      _handlers=list.filter(u=>u&&ROLE_LABEL[u.role])
        .sort((a,b)=>(rank[a.role]-rank[b.role])||String(a.name||'').localeCompare(String(b.name||'')));
    }catch(e){ _handlers=[]; }
    return _handlers;
  }
  function featureList(){ const out=[]; (typeof NAV!=='undefined'?NAV:[]).forEach(g=>{ if(g.dept==='home'||g.dept==='admin') return;
    (g.items||[]).forEach(it=> out.push({ key:it.key, name:`[${g.name}] ${it.name}` })); }); return out; }

  // 처리자가 [바로가기] 눌렀을 때 해당 기능/탭/대상으로 이동(딥링크)
  function goRef(r){
    if(r.cat==='perm'){ window.__teamTab='users'; window.__reqGrant={ loginId:r.fromId, name:r.fromName, key:r.targetKey, mode:r.permMode }; location.hash='admin.team'; return; }
    if(!r.refKey){ toast('이 요청은 연결된 화면이 없습니다(내용 참고).'); return; }
    if(r.refKey==='md.order' && r.refTab) window.__mdOrderTab=r.refTab;
    if(r.refId) window.__goRef={ key:r.refKey, id:r.refId };   // 레코드 강조용(대상 모듈이 지원 시)
    location.hash=r.refKey;
  }

  /* ---------------- 요청 작성 모달 ---------------- */
  window.openReqComposer=function(prefill){
    prefill=prefill||{}; const me=meU();
    let cat=prefill.cat||'', type=prefill.type||'', toId=prefill.toId||'', handlers=[];
    const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
    function typeList(){ const c=Req.catOf(cat); return c?c.types:[]; }
    function render(){
      const c=Req.catOf(cat); const t=Req.typeOf(cat,type);
      const needTarget=c&&c.needTarget;
      ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:560px;width:97%;max-height:calc(100vh - 48px);overflow:auto;box-shadow:var(--sh-lg)">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--line)">
          <div style="font-size:16px;font-weight:800">${icon('stamp')||''} 요청 보내기</div>
          <div class="muted" style="font-size:12.5px;margin-top:3px">담당자를 지정하면 그 분에게만 전달됩니다. 처리 결과는 <b>요청하기 › 내 요청</b>에서 확인돼요.</div></div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
          <label class="fld">처리 담당자
            <select id="rqTo"><option value="">자동 지정 — 우리 부서장 → 관리자</option>${
              handlers.map(h=>`<option value="${esc(h.loginId)}" ${h.loginId===toId?'selected':''}>${esc(h.name)} · ${esc(ROLE_LABEL[h.role]||h.role)}${h.dept?' ('+esc(h.dept)+')':''}</option>`).join('')}</select>
            <span class="muted" style="font-size:11.5px">${handlers.length?'결제·조치 담당자를 직접 고를 수 있습니다.':'담당자 목록을 불러오는 중…'}</span></label>
          <label class="fld">유형 분류
            <select id="rqCat"><option value="">— 분류 선택 —</option>${Req.CATS.map(x=>`<option value="${esc(x.key)}" ${x.key===cat?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
          ${cat?`<label class="fld">세부 유형
            <select id="rqType"><option value="">— 세부 선택 —</option>${typeList().map(x=>`<option value="${esc(x.key)}" ${x.key===type?'selected':''}>${esc(x.label)}</option>`).join('')}</select>
            <span class="muted" style="font-size:11.5px">${esc((c&&c.desc)||'')}</span></label>`:''}
          ${needTarget&&type?`<label class="fld">대상 페이지
            <select id="rqTarget"><option value="">— 페이지 선택 —</option>${featureList().map(f=>`<option value="${esc(f.key)}" data-nm="${esc(f.name)}" ${f.key===prefill.targetKey?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label>`:''}
          ${prefill.refLabel?`<div class="note" style="font-size:12px">연결 대상: <b>${esc(prefill.refLabel)}</b> <span class="muted">(${esc(prefill.refKey||'')})</span></div>`:''}
          <label class="fld">제목<input id="rqTitle" type="text" value="${esc(prefill.title||(t?t.label:''))}" placeholder="한 줄 요약"></label>
          <label class="fld">상세 내용<textarea id="rqDetail" rows="4" placeholder="무엇을·왜·어떻게 (예: P-T696 발주건 정산구분을 월정산으로 정정 요청)">${esc(prefill.detail||'')}</textarea></label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line)">
          <button class="btn ghost" id="rqCancel">취소</button><button class="btn pri" id="rqSend">${icon('send')||''} 요청 보내기</button></div>
      </div>`;
      const $=s=>ov.querySelector(s);
      const tosel=$('#rqTo'); if(tosel) tosel.onchange=e=>{ toId=e.target.value; };
      $('#rqCat').onchange=e=>{ cat=e.target.value; type=''; render(); };
      const tsel=$('#rqType'); if(tsel) tsel.onchange=e=>{ type=e.target.value; render(); };
      $('#rqCancel').onclick=close;
      $('#rqSend').onclick=send;
    }
    function close(){ ov.remove(); }
    async function send(){
      const $=s=>ov.querySelector(s); const c=Req.catOf(cat), t=Req.typeOf(cat,type);
      if(!cat||!type){ toast('유형 분류와 세부 유형을 선택하세요'); return; }
      const title=($('#rqTitle').value||'').trim(), detail=($('#rqDetail').value||'').trim();
      if(!title){ toast('제목을 입력하세요'); return; }
      let targetKey='', targetName='';
      if(c&&c.needTarget){ const ts=$('#rqTarget'); targetKey=ts?ts.value:''; targetName=ts&&ts.selectedOptions[0]?(ts.selectedOptions[0].dataset.nm||''):'';
        if(!targetKey){ toast('대상 페이지를 선택하세요'); return; } }
      const btn=$('#rqSend'); btn.disabled=true; btn.textContent='보내는 중…';
      const to=toId?handlers.find(h=>h.loginId===toId):null;
      const rec={ cat, type, typeLabel:t?t.label:'', title, detail,
        refKey:prefill.refKey||(t?t.ref:'')||'', refTab:prefill.refTab||(t?t.tab:'')||'', refId:prefill.refId||'', refLabel:prefill.refLabel||'',
        targetKey, targetName, permMode:t?t.permMode:'',
        toId:to?to.loginId:'', toName:to?to.name:'', toRole:to?to.role:'',
        fromId:me.loginId||'', fromName:me.name||me.loginId||'', fromDept:me.dept||'' };
      const saved=await Req.create(rec);
      if(saved){ toast(to?`요청을 보냈습니다 — ${to.name}님에게 전달됨`:'요청을 보냈습니다 — 부서장/관리자에게 전달됨'); try{ window.dispatchEvent(new CustomEvent('req:changed')); }catch(e){} if(window.refreshNavBadges) window.refreshNavBadges(); close(); }
      else { toast('전송 실패 — 잠시 후 다시 시도하세요'); btn.disabled=false; btn.textContent='요청 보내기'; }
    }
    document.body.appendChild(ov); ov.onclick=e=>{ if(e.target===ov) close(); }; render();
    // 담당자 목록은 비동기로 받아 셀렉트만 다시 그림(입력 중인 값은 유지)
    handlerList().then(list=>{ if(!ov.isConnected) return; handlers=list||[];
      const sel=ov.querySelector('#rqTo'); if(!sel) return;
      sel.innerHTML=`<option value="">자동 지정 — 우리 부서장 → 관리자</option>`+
        handlers.map(h=>`<option value="${esc(h.loginId)}" ${h.loginId===toId?'selected':''}>${esc(h.name)} · ${esc(ROLE_LABEL[h.role]||h.role)}${h.dept?' ('+esc(h.dept)+')':''}</option>`).join('');
      const hint=sel.parentElement&&sel.parentElement.querySelector('.muted');
      if(hint) hint.textContent = handlers.length?'결제·조치 담당자를 직접 고를 수 있습니다.':'지정 가능한 담당자가 없습니다 — 자동 전달됩니다.';
    });
  };

  /* ---------------- 요청 페이지 ---------------- */
  MODULES['home.requests']={ title:'요청하기', icon:'stamp',
    async render(root){
      const me=meU(); const handler=Req.isHandler(me);
      let list=[], section=handler?'inbox':'new';
      // 처리 결과 확인 표시(요청자 배지 해제용)
      try{ store('eduino.req.seenAt').set(new Date().toISOString()); }catch(e){}
      if(window.refreshNavBadges) setTimeout(window.refreshNavBadges, 50);

      root.innerHTML=`
        <style>
          .rq-seg{display:inline-flex;border:1px solid var(--line-2);border-radius:10px;overflow:hidden;margin-bottom:16px}
          .rq-seg button{border:0;background:var(--panel);padding:8px 16px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
          .rq-seg button:first-child{border-left:0}.rq-seg button.on{background:#0a3d62;color:#fff}
          .rq-seg .cnt{font-size:11px;opacity:.85;margin-left:4px}
          .rq-cats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px} @media(max-width:820px){.rq-cats{grid-template-columns:1fr}}
          .rq-cat{border:1px solid var(--line);border-radius:13px;background:var(--panel);box-shadow:var(--sh-sm);overflow:hidden}
          .rq-cat .h{display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid var(--line);font-weight:800;font-size:14px}
          .rq-cat .h .ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff}
          .rq-cat .h .ic svg{width:15px;height:15px}
          .rq-cat .d{font-size:11.5px;color:var(--muted);font-weight:600;margin-left:auto;text-align:right;max-width:180px;line-height:1.35}
          .rq-cat .b{padding:8px 10px;display:flex;flex-direction:column;gap:5px}
          .rq-type{display:flex;align-items:center;gap:8px;text-align:left;border:1px solid var(--line-2);background:var(--panel);border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer}
          .rq-type:hover{border-color:#0a3d62;background:var(--active-bg)}
          .rq-type .go{margin-left:auto;color:var(--muted);font-weight:800}
          .rq-list{display:flex;flex-direction:column;gap:10px}
          .rq-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:13px 15px}
          .rq-card.open{border-left:4px solid #b4530a}
          .rq-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
          .rq-cat-chip{font-size:10.5px;font-weight:800;border-radius:6px;padding:2px 8px}
          .rq-ti{font-weight:800;font-size:13.5px;color:var(--ink)}
          .rq-meta{font-size:11.5px;color:var(--muted);margin-top:3px}
          .rq-detail{font-size:12.5px;color:var(--ink-2);margin-top:7px;white-space:pre-wrap;line-height:1.5;background:var(--panel-2);border-radius:8px;padding:8px 11px}
          .rq-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
          .rq-empty{padding:34px;text-align:center;color:var(--muted);font-size:13px}
          .rq-reso{font-size:12px;margin-top:8px;border-left:3px solid #12886a;background:#eafaf3;border-radius:0 8px 8px 0;padding:7px 11px;color:var(--ink-2)}
          .rq-reso.rej{border-left-color:#8a8f98;background:#eef0f3}
        </style>
        <div class="mhead pad"><div class="mhead-row">
          <div><div class="tt">요청하기</div>
            <div class="ds">데이터 수정·권한·마스터·기능 요청을 <b>부서장/관리자</b>에게 보내고 처리 상태를 확인합니다.</div></div>
          <div class="mhead-act"><button class="btn pri" id="rqNew">${icon('plus')||''} 새 요청</button></div>
        </div></div>
        <div class="mbody">
          <div class="rq-seg" id="rqSeg">
            <button data-s="new">＋ 새 요청</button>
            <button data-s="mine">내 요청 <span class="cnt" id="rqMineCnt"></span></button>
            ${handler?`<button data-s="inbox">받은 요청 <span class="cnt" id="rqInboxCnt"></span></button>`:''}
          </div>
          <div id="rqBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>
        </div>`;

      const body=root.querySelector('#rqBody');
      root.querySelector('#rqNew').onclick=()=>openReqComposer({});
      function setSeg(){ root.querySelectorAll('#rqSeg button').forEach(b=>b.classList.toggle('on',b.dataset.s===section)); }
      root.querySelectorAll('#rqSeg button').forEach(b=>b.onclick=()=>{ section=b.dataset.s; setSeg(); draw(); });
      setSeg();

      async function load(){ const l=await Req.all(); if(!root.isConnected) return; list=l||[]; updateCnts(); draw(); }
      function updateCnts(){ const mine=Req.fromMe(list,me), inbox=Req.inbox(list,me);
        const mc=root.querySelector('#rqMineCnt'); if(mc){ const open=mine.filter(r=>Req.OPEN(r.status)).length; mc.textContent=mine.length?`(${open}/${mine.length})`:''; }
        const ic=root.querySelector('#rqInboxCnt'); if(ic){ const open=inbox.filter(r=>Req.OPEN(r.status)).length; ic.innerHTML=open?`<b style="color:#ffd9a6">${open}</b>`:`${inbox.length}`; } }

      function catChip(catKey){ const c=Req.catOf(catKey); if(!c) return ''; return `<span class="rq-cat-chip" style="color:${c.color};background:${c.color}18">${esc(c.name)}</span>`; }

      function drawNew(){
        body.innerHTML=`<div class="nx-note" style="border-left-color:#0a3d62;background:#eef4fb;margin-bottom:14px">${icon('info')||''} 아래는 <b>관리자/부서장이 조치해줄 수 있는 범위</b>입니다. 필요한 항목을 눌러 요청하세요.</div>
          <div class="rq-cats">${Req.CATS.map(c=>`<div class="rq-cat">
            <div class="h"><span class="ic" style="background:${c.color}">${icon(c.icon)||''}</span>${esc(c.name)}<span class="d">${esc(c.desc)}</span></div>
            <div class="b">${c.types.map(t=>`<button class="rq-type" data-cat="${esc(c.key)}" data-type="${esc(t.key)}">${esc(t.label)}<span class="go">＋ 요청</span></button>`).join('')}</div>
          </div>`).join('')}</div>`;
        body.querySelectorAll('.rq-type').forEach(b=>b.onclick=()=>openReqComposer({ cat:b.dataset.cat, type:b.dataset.type }));
      }

      function cardMine(r){
        return `<div class="rq-card ${Req.OPEN(r.status)?'open':''}">
          <div class="rq-top">${catChip(r.cat)} ${stBadge(r.status)} <span class="rq-ti">${esc(r.title)}</span></div>
          <div class="rq-meta">${esc(r.typeLabel||'')}${r.targetName?` · 대상: ${esc(r.targetName)}`:''}${r.toName?` · 담당 <b>${esc(r.toName)}</b>`:''} · 보냄 ${esc(fmtDay(r.createdAt))}</div>
          ${r.detail?`<div class="rq-detail">${esc(r.detail)}</div>`:''}
          ${r.status==='done'?`<div class="rq-reso">${icon('check')||''} 완료 · ${esc(r.resolvedName||'')} ${esc(fmtDay(r.resolvedAt))}${r.resolution?` — ${esc(r.resolution)}`:''}</div>`:''}
          ${r.status==='rejected'?`<div class="rq-reso rej">반려 · ${esc(r.resolvedName||'')} ${esc(fmtDay(r.resolvedAt))}${r.resolution?` — ${esc(r.resolution)}`:''}</div>`:''}
        </div>`;
      }
      function drawMine(){ const mine=Req.fromMe(list,me).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
        body.innerHTML= mine.length? `<div class="rq-list">${mine.map(cardMine).join('')}</div>`
          : `<div class="rq-empty">${icon('inbox')||''}<div>보낸 요청이 없습니다. <b>＋ 새 요청</b>에서 시작하세요.</div></div>`;
      }

      function cardInbox(r){
        const canGo=r.cat==='perm'||!!r.refKey;
        // 권한/마스터 요청은 관리자만 실제 조치 가능(팀 설정·이카운트 매핑 등 관리자 전용) → 부서장에겐 안내 표식
        const adminOnly=(r.cat==='perm'||r.cat==='master');
        const adminTag=(adminOnly && me.role!=='admin')?`<span title="이 요청은 관리자만 최종 처리(권한 부여·매핑)할 수 있습니다" style="font-size:10px;font-weight:800;border-radius:6px;padding:2px 7px;color:#8a5200;background:#fff3dc;border:1px solid #f0d3a6">관리자 처리</span>`:'';
        return `<div class="rq-card ${Req.OPEN(r.status)?'open':''}" data-id="${esc(r.id)}">
          <div class="rq-top">${catChip(r.cat)} ${stBadge(r.status)} ${adminTag} <span class="rq-ti">${esc(r.title)}</span></div>
          <div class="rq-meta">요청자 <b>${esc(r.fromName)}</b>${r.fromDept?` (${esc(r.fromDept)})`:''} · ${esc(r.typeLabel||'')}${r.targetName?` · 대상: ${esc(r.targetName)}`:''}${r.permMode?` · ${r.permMode==='edit'?'수정':'열람'}권한`:''}${
            r.toName?` · 지정 담당 <b${Req.isAssignedTo(r,me)?' style="color:#b4530a"':''}>${esc(r.toName)}</b>${Req.isAssignedTo(r,me)?' (나)':''}`:''} · ${esc(fmtDay(r.createdAt))}</div>
          ${r.detail?`<div class="rq-detail">${esc(r.detail)}</div>`:''}
          ${(r.status==='done'||r.status==='rejected')?`<div class="rq-reso ${r.status==='rejected'?'rej':''}">${r.status==='done'?'완료':'반려'} · ${esc(r.resolvedName||'')} ${esc(fmtDay(r.resolvedAt))}${r.resolution?` — ${esc(r.resolution)}`:''}</div>`:''}
          <div class="rq-acts">
            ${canGo?`<button class="btn sm" data-a="go" style="background:#0a3d62;color:#fff">↗ 바로가기${r.cat==='perm'?'(권한부여)':''}</button>`:''}
            ${Req.OPEN(r.status)?`${r.status==='sent'?`<button class="btn ghost sm" data-a="doing">처리중</button>`:''}
              <button class="btn ok sm" data-a="done">${icon('check')||''} 완료</button>
              <button class="btn ghost sm" data-a="reject">반려</button>`:`<button class="btn ghost sm" data-a="reopen">다시 열기</button>`}
          </div>
        </div>`;
      }
      function drawInbox(){ const inbox=Req.inbox(list,me).sort((a,b)=>{ const ao=Req.OPEN(a.status)?0:1, bo=Req.OPEN(b.status)?0:1; return ao-bo || String(b.createdAt).localeCompare(String(a.createdAt)); });
        body.innerHTML= inbox.length? `<div class="rq-list">${inbox.map(cardInbox).join('')}</div>`
          : `<div class="rq-empty">${icon('check2')||''}<div>처리할 요청이 없습니다.</div></div>`;
        body.querySelectorAll('.rq-card[data-id]').forEach(card=>{ const r=list.find(x=>x.id===card.dataset.id); if(!r) return;
          const act=async(a,note)=>{ const nr=await Req.transition(r,a,{by:me.loginId,byName:me.name||me.loginId,note:note||''});
            if(nr){ const i=list.findIndex(x=>x.id===r.id); if(i>=0) list[i]=nr; updateCnts(); drawInbox(); try{ window.dispatchEvent(new CustomEvent('req:changed')); }catch(e){} if(window.refreshNavBadges) window.refreshNavBadges(); } else toast('저장 실패'); };
          const g=card.querySelector('[data-a=go]'); if(g) g.onclick=()=>goRef(r);
          const d=card.querySelector('[data-a=doing]'); if(d) d.onclick=()=>act('doing');
          const dn=card.querySelector('[data-a=done]'); if(dn) dn.onclick=()=>{ const n=prompt('처리 내용(선택) — 요청자에게 함께 표시됩니다',''); if(n===null) return; act('done',n.trim()); };
          const rj=card.querySelector('[data-a=reject]'); if(rj) rj.onclick=()=>{ const n=prompt('반려 사유(선택)',''); if(n===null) return; act('rejected',n.trim()); };
          const ro=card.querySelector('[data-a=reopen]'); if(ro) ro.onclick=()=>act('reopen');
        });
      }

      function draw(){ if(section==='new') drawNew(); else if(section==='mine') drawMine(); else drawInbox(); }
      load();
    }
  };
})();
