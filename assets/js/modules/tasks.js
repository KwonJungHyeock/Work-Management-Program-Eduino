/* ===========================================================================
   업무 지시(Assignments) UI
   - openAssignComposer(): 팀장/관리자 업무요청 작성(담당자 매칭·선택 + 보고형태 + 발송)
   - 우측 하단 지시함 위젯(내게 온 지시 알림·수락) + 알림 배지
   - MODULES['home.mytasks'] : 홈 개인 업무 현황(수락·진행·완료, 본인 것만)
   - renderAssignBoard(el): 업무지시현황(현황판) — 지시자·관리자용 진행 추적
   - renderAssignStats(el): 업무현황 · 개인 업무지시 집계 탭
   ========================================================================= */
(function(){
  const me = ()=> (Auth.user&&Auth.user())||{};
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const isLeadUp = ()=>{ const u=me(); return isAdmin() || u.role==='lead' || u.role==='admin'; };
  const DL = (window.Duties&&Duties.DEPT_LABEL)||{acct:'경리',cs:'CS',md:'MD',logi:'물류',admin:'관리자'};
  const S = (window.Assign&&Assign.STATUS)||{sent:'요청',accepted:'진행',submitted:'완료보고',done:'완료'};
  const esc2 = s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtDate = s=> String(s||'').slice(0,10);
  const fmtDT = s=>{ s=String(s||''); return s?s.slice(0,10)+' '+s.slice(11,16):''; };
  const REPORT_PRESETS = ['완료 후 메신저 보고','결과 파일 업로드','구두 보고','메일 회신','프로그램 내 기록'];

  function stPill(st){
    const c={sent:'var(--warn)',accepted:'var(--info)',submitted:'#8b5cf6',done:'var(--ok)'}[st]||'var(--muted)';
    const bg={sent:'var(--warn-bg)',accepted:'var(--info-bg)',submitted:'#ede9fe',done:'var(--ok-bg,#e8f8ef)'}[st]||'var(--panel-2)';
    return `<span style="font-size:11px;font-weight:800;color:${c};background:${bg};border-radius:6px;padding:2px 9px;white-space:nowrap">${S[st]||st}</span>`;
  }

  /* ─────────────────────────── 업무요청 작성(Composer) ─────────────────────────── */
  async function openAssignComposer(prefill){
    prefill=prefill||{};
    let people=[]; try{ people=await Duties.load(); }catch(e){ people=[]; }
    let roster=[]; try{ roster=(window.Records&&await Records.roster())||[]; }catch(e){ roster=[]; }
    // 담당 후보 = 직무 지도 인물(매칭용). loginId 는 발송 시 roster 로 join
    const rosterByName={}; roster.forEach(r=>{ rosterByName[r.name]=r; });
    let picked=null;   // {name,dept,role,loginId}

    const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px';
    ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:680px;width:96%;max-height:calc(100vh - 48px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
      <div style="padding:16px 22px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
        <div style="font-size:16px;font-weight:800;flex:1">${icon('send')||icon('mail')} 업무 요청</div>
        <button class="btn ghost sm" id="acClose">${icon('x')}</button></div>
      <div style="padding:16px 22px;overflow-y:auto">
        <div style="margin-bottom:12px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">업무 제목</div>
          <input id="acTitle" placeholder="예: 쿠팡 반품 건 처리" value="${esc2(prefill.title||'')}" style="width:100%;font:inherit;font-size:14px;font-weight:700;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px"></div>
        <div style="margin-bottom:12px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">업무 내용</div>
          <textarea id="acDetail" placeholder="구체적인 지시 내용을 적으면, 애매할 때 아래에서 담당 후보를 추천합니다." style="width:100%;min-height:72px;font:inherit;font-size:13px;line-height:1.6;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px;resize:vertical">${esc2(prefill.detail||'')}</textarea></div>

        <div style="margin-bottom:12px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">담당자</div>
          <div id="acPicked" style="margin-bottom:6px"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="acDirect" style="font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:8px 10px;min-width:180px">
              <option value="">직접 선택…</option>
              ${people.map(p=>`<option value="${esc2(p.name)}">${esc2(p.name)} · ${DL[p.dept]||p.dept} · ${p.role==='lead'?'파트장':'팀원'}</option>`).join('')}
            </select>
            <span class="muted" style="font-size:12px">또는 아래 추천에서 선택</span>
          </div>
          <div id="acMatch" style="margin-top:8px"></div>
        </div>

        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px">
          <div style="flex:1;min-width:220px"><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">보고 형태</div>
            <input id="acReport" placeholder="완료 시 어떻게 보고할지" style="width:100%;font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:8px 11px">
            <div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">${REPORT_PRESETS.map(r=>`<button type="button" class="acRp" style="font-size:11px;border:1px solid var(--line-2);background:var(--panel);border-radius:14px;padding:3px 10px;cursor:pointer">${esc2(r)}</button>`).join('')}</div></div>
          <div><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">우선순위</div>
            <select id="acPri" style="font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:8px 10px"><option value="normal">보통</option><option value="urgent">급함</option></select></div>
          <div><div class="muted" style="font-size:11.5px;font-weight:800;margin-bottom:4px">마감(선택)</div>
            <input type="date" id="acDue" style="font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:7px 10px"></div>
        </div>
        <div id="acMsg" class="muted" style="font-size:12.5px;min-height:16px"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding:14px 22px;border-top:1px solid var(--line)">
        <button class="btn ghost" id="acCancel">취소</button>
        <button class="btn pri" id="acSend">${icon('send')||icon('mail')} 발송</button></div>
    </div>`;
    document.body.appendChild(ov);
    const $=s=>ov.querySelector(s);
    const close=()=>ov.remove(); ov.onclick=e=>{ if(e.target===ov) close(); };
    $('#acClose').onclick=close; $('#acCancel').onclick=close;
    ov.querySelectorAll('.acRp').forEach(b=>b.onclick=()=>{ $('#acReport').value=b.textContent; });

    function drawPicked(){ const box=$('#acPicked');
      if(!picked){ box.innerHTML=''; return; }
      box.innerHTML=`<span style="display:inline-flex;align-items:center;gap:8px;background:var(--info-bg);color:var(--info);border-radius:8px;padding:5px 10px;font-weight:800;font-size:13px">
        ${icon('users')} ${esc2(picked.name)} <span style="font-weight:600;font-size:11px;color:var(--ink-2)">${DL[picked.dept]||picked.dept||''} · ${picked.role==='lead'?'파트장':'팀원'}${picked.loginId?'':' · 미등록계정'}</span>
        <button type="button" id="acUnpick" style="border:0;background:none;cursor:pointer;color:var(--muted);font-weight:800">✕</button></span>`;
      const up=$('#acUnpick'); if(up) up.onclick=()=>{ picked=null; $('#acDirect').value=''; drawPicked(); };
    }
    function pick(name){ const p=people.find(x=>x.name===name)||{name}; const r=rosterByName[name];
      picked={ name, dept:p.dept||(r&&r.dept)||'', role:p.role||(r&&r.role)||'member', loginId:(r&&r.loginId)||'' }; drawPicked(); refreshMatch(); }
    $('#acDirect').onchange=()=>{ if($('#acDirect').value) pick($('#acDirect').value); };

    function refreshMatch(){
      const box=$('#acMatch'); const q=($('#acTitle').value+' '+$('#acDetail').value).trim();
      if(!q){ box.innerHTML=''; return; }
      let res=[]; try{ res=Duties.match(q,{}); }catch(e){ res=[]; }
      if(!res.length){ box.innerHTML='<div class="muted" style="font-size:12px">추천 후보 없음 — 위에서 직접 선택하세요.</div>'; return; }
      const max=res[0].score||1;
      box.innerHTML=`<div class="muted" style="font-size:11px;font-weight:800;margin-bottom:5px">추천 담당자 (클릭해 선택)</div>`+
        res.slice(0,4).map((r,i)=>`<button type="button" class="acCand" data-n="${esc2(r.person.name)}" style="display:block;width:100%;text-align:left;border:1px solid ${picked&&picked.name===r.person.name?'var(--info)':'var(--line-2)'};background:${picked&&picked.name===r.person.name?'var(--info-bg)':'var(--panel)'};border-radius:9px;padding:8px 11px;margin-bottom:6px;cursor:pointer">
          <div style="font-weight:800;font-size:13px">${i===0?'🎯 ':''}${esc2(r.person.name)} <span style="font-weight:600;font-size:11px;color:var(--muted)">${DL[r.person.dept]||r.person.dept} · ${r.person.role==='lead'?'파트장':'팀원'} · 적합도 ${Math.round(r.score/max*100)}%</span></div>
          <div style="font-size:11.5px;color:var(--ink-2);margin-top:3px;line-height:1.5">${r.hits.slice(0,2).map(h=>`· <b style="color:var(--info)">${esc2(h.group)}</b>${h.item?' — '+esc2(h.item):''}`).join('<br>')}</div></button>`).join('');
      box.querySelectorAll('.acCand').forEach(b=>b.onclick=()=>pick(b.dataset.n));
    }
    let mt=null; const onQ=()=>{ clearTimeout(mt); mt=setTimeout(refreshMatch,250); };
    $('#acTitle').oninput=onQ; $('#acDetail').oninput=onQ;
    if(prefill.title||prefill.detail) refreshMatch();

    $('#acSend').onclick=async()=>{
      const title=$('#acTitle').value.trim(), msg=$('#acMsg');
      if(!title){ msg.innerHTML='<span style="color:var(--danger)">업무 제목을 입력하세요.</span>'; return; }
      if(!picked){ msg.innerHTML='<span style="color:var(--danger)">담당자를 선택하세요.</span>'; return; }
      const u=me();
      const rec={ title, detail:$('#acDetail').value.trim(), reportFormat:$('#acReport').value.trim(),
        fromId:u.loginId||'', fromName:u.name||u.loginId||'', toId:picked.loginId||'', toName:picked.name, toDept:picked.dept||'',
        priority:$('#acPri').value, due:$('#acDue').value||'' };
      $('#acSend').disabled=true; msg.innerHTML='<span style="color:var(--info)">발송 중…</span>';
      const sent=await Assign.send(rec);
      if(sent){ toast(`${picked.name}님에게 업무를 지시했습니다`); close(); if(window.refreshTaskWidget) window.refreshTaskWidget(); document.dispatchEvent(new CustomEvent('assign:changed')); }
      else { $('#acSend').disabled=false; msg.innerHTML='<span style="color:var(--danger)">발송 실패 — 잠시 후 다시 시도</span>'; }
    };
  }
  window.openAssignComposer = openAssignComposer;
})();
