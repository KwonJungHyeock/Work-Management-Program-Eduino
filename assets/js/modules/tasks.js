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
        ${icon('users')} ${esc2(picked.name)} <span style="font-weight:600;font-size:11px;color:var(--ink-2)">${DL[picked.dept]||picked.dept||''} · ${picked.role==='lead'?'파트장':picked.role==='manager'?'팀장':'팀원'}${picked.loginId?'':' · 미등록계정'}</span>
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
      const DEPTCOLOR={cs:'#2d6cdf',md:'#e0313b',logi:'#12886a',acct:'#b45309',hq:'#6d3fd6',admin:'#b45309'};
      const DEPTTINT ={cs:'#eaf1ff',md:'#ffecef',logi:'#e6f7f0',acct:'#fbeeda',hq:'#f0ebfe',admin:'#fbeeda'};
      box.innerHTML=`<div class="muted" style="font-size:11px;font-weight:800;margin-bottom:6px">추천 담당자 · 클릭해 선택</div>`+
        res.slice(0,4).map(r=>{ const col=DEPTCOLOR[r.person.dept]||'#5a6474', tint=DEPTTINT[r.person.dept]||'#eef1f6';
          const on=picked&&picked.name===r.person.name;
          const groups=[...new Set(r.hits.map(h=>h.group).filter(Boolean))].slice(0,3);
          return `<button type="button" class="acCand" data-n="${esc2(r.person.name)}" style="display:block;width:100%;text-align:left;border:1px solid ${on?col:'var(--line-2)'};border-left:4px solid ${col};background:${on?tint:'var(--panel)'};border-radius:10px;padding:9px 12px;margin-bottom:7px;cursor:pointer">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-weight:800;font-size:14px;color:var(--ink)">${esc2(r.person.name)}</span>
              <span style="font-size:11px;font-weight:700;color:${col}">${DL[r.person.dept]||r.person.dept} · ${r.person.role==='lead'?'파트장':r.person.role==='manager'?'팀장':'팀원'}</span>
              <span style="margin-left:auto;font-size:11px;font-weight:800;color:${col};background:${tint};border-radius:10px;padding:2px 9px">적합도 ${Math.round(r.score/max*100)}%</span>
            </div>
            <div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px">${groups.map(g=>`<span style="font-size:11.5px;font-weight:700;color:${col};background:${tint};border:1px solid ${col}22;border-radius:6px;padding:2px 8px">${esc2(g)}</span>`).join('')}</div>
          </button>`; }).join('');
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

  /* ─────────────────────── 업무지시현황 보드(현황판) ─────────────────────── */
  async function renderAssignBoard(host, opt){
    opt=opt||{}; const u=me();
    host.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
    let list=[]; try{ list=await Assign.all()||[]; }catch(e){}
    if(!host.isConnected) return;
    let fSt='all', fWho='all', q='';
    const today=new Date().toISOString().slice(0,10);
    const isLate=a=>a.due && a.status!=='done' && a.due<today;

    const st=document.createElement('div'); host.innerHTML=''; host.appendChild(st);
    st.innerHTML=`<style>
      .ab-kpi{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px}
      .ab-k{border:1px solid var(--line);border-radius:11px;padding:11px 13px;background:var(--panel)}
      .ab-k .v{font-size:24px;font-weight:800;line-height:1} .ab-k .l{font-size:11px;color:var(--muted);margin-top:5px;font-weight:600}
      .ab-k.warn{border-color:var(--warn)} .ab-k.warn .v{color:var(--warn)}
      .ab-k.rev{border-color:#8b5cf6} .ab-k.rev .v{color:#8b5cf6}
      .ab-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
      .ab-bar select,.ab-bar input{font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:7px 10px}
      .ab-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
      .ab-tbl th{text-align:left;font-size:11px;color:var(--muted);font-weight:700;padding:7px 9px;border-bottom:1px solid var(--line)}
      .ab-tbl td{padding:8px 9px;border-bottom:1px solid var(--line-2);vertical-align:top}
      .ab-tbl tr.row{cursor:pointer} .ab-tbl tr.row:hover{background:var(--hover)}
      .ab-tbl tr.late td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
      .ab-agg{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:8px}
      .ab-agg th,.ab-agg td{padding:6px 10px;border-bottom:1px solid var(--line-2);text-align:center}
      .ab-agg th{color:var(--muted);font-size:11px;font-weight:700} .ab-agg td:first-child,.ab-agg th:first-child{text-align:left;font-weight:700}
      .ab-agg .barwrap{height:7px;border-radius:4px;background:var(--line-2);overflow:hidden;min-width:60px} .ab-agg .bar{height:100%;background:var(--ok)}
      .ab-tl{font-size:11.5px;color:var(--ink-2);line-height:1.7;padding:2px 0 2px 6px;border-left:2px solid var(--line-2);margin-left:2px}
    </style>
      <div class="ab-kpi" id="abKpi"></div>
      <div class="card" style="margin-bottom:14px"><div class="card-hd">${icon('users')}<b>담당자별 지시 집계</b> <span class="muted" style="font-size:11.5px;margin-left:auto">받은 지시 · 진행 · 완료 · 완료율</span></div>
        <div style="padding:4px 2px" id="abAgg"></div></div>
      <div class="ab-bar">
        <select id="abSt"><option value="all">상태 전체</option><option value="sent">요청</option><option value="accepted">진행</option><option value="submitted">완료보고</option><option value="done">완료</option><option value="late">지연</option></select>
        <select id="abWho"><option value="all">담당자 전체</option></select>
        <input id="abQ" placeholder="제목·내용 검색" style="flex:1;min-width:160px">
        <span class="muted" id="abCnt" style="font-size:12px"></span>
      </div>
      <div style="overflow:auto;border:1px solid var(--line);border-radius:11px">
        <table class="ab-tbl"><thead><tr><th style="width:78px">상태</th><th>업무</th><th style="width:88px">담당자</th><th style="width:88px">지시자</th><th style="width:92px">지시일</th><th style="width:92px">마감</th></tr></thead><tbody id="abRows"></tbody></table>
      </div>`;
    const whoSel=st.querySelector('#abWho');
    [...new Set(list.map(a=>a.toName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko')).forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; whoSel.appendChild(o); });

    function drawKpi(){
      const k=st.querySelector('#abKpi');
      const c={sent:0,accepted:0,submitted:0,done:0,late:0}; list.forEach(a=>{ c[a.status]=(c[a.status]||0)+1; if(isLate(a)) c.late++; });
      k.innerHTML=`
        <div class="ab-k"><div class="v">${list.length}</div><div class="l">전체 지시</div></div>
        <div class="ab-k"><div class="v">${c.accepted||0}</div><div class="l">진행 중</div></div>
        <div class="ab-k rev"><div class="v">${c.submitted||0}</div><div class="l">완료보고(확인 필요)</div></div>
        <div class="ab-k"><div class="v">${c.done||0}</div><div class="l">완료</div></div>
        <div class="ab-k warn"><div class="v">${c.late||0}</div><div class="l">지연(마감 초과)</div></div>`;
    }
    function drawAgg(){
      const box=st.querySelector('#abAgg');
      const by={}; list.forEach(a=>{ const n=a.toName||'(미지정)'; const o=by[n]||(by[n]={recv:0,acc:0,sub:0,done:0}); o.recv++; if(a.status==='accepted')o.acc++; else if(a.status==='submitted')o.sub++; else if(a.status==='done')o.done++; });
      const rows=Object.entries(by).sort((a,b)=>b[1].recv-a[1].recv);
      if(!rows.length){ box.innerHTML='<div class="muted" style="font-size:12.5px;padding:6px">아직 지시 내역이 없습니다.</div>'; return; }
      box.innerHTML=`<table class="ab-agg"><thead><tr><th>담당자</th><th>받음</th><th>진행</th><th>완료보고</th><th>완료</th><th style="width:120px">완료율</th></tr></thead><tbody>
        ${rows.map(([n,o])=>{ const rate=o.recv?Math.round(o.done/o.recv*100):0; return `<tr><td>${esc2(n)}</td><td>${o.recv}</td><td>${o.acc}</td><td>${o.sub}</td><td>${o.done}</td>
          <td><div style="display:flex;align-items:center;gap:7px"><div class="barwrap"><div class="bar" style="width:${rate}%"></div></div><b style="font-size:11.5px">${rate}%</b></div></td></tr>`; }).join('')}</tbody></table>`;
    }
    function filtered(){ return list.filter(a=>{
      if(fSt==='late'){ if(!isLate(a)) return false; } else if(fSt!=='all' && a.status!==fSt) return false;
      if(fWho!=='all' && a.toName!==fWho) return false;
      if(q && !((a.title||'')+(a.detail||'')).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    }).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))); }
    function drawRows(){
      const tb=st.querySelector('#abRows'), rows=filtered();
      st.querySelector('#abCnt').textContent=`${rows.length}건`;
      tb.innerHTML=rows.length?rows.map(a=>`<tr class="row ${isLate(a)?'late':''}" data-id="${esc2(a.id)}">
        <td>${stPill(a.status)}</td>
        <td><b>${esc2(a.title)}</b>${a.priority==='urgent'?' <span style="color:var(--danger);font-size:11px;font-weight:800">급함</span>':''}${a.detail?`<div class="muted" style="font-size:11.5px;margin-top:2px">${esc2(a.detail.slice(0,60))}${a.detail.length>60?'…':''}</div>`:''}</td>
        <td>${esc2(a.toName||'-')}</td><td>${esc2(a.fromName||'-')}</td><td>${fmtDate(a.createdAt)}</td>
        <td>${a.due?`<span style="${isLate(a)?'color:var(--danger);font-weight:700':''}">${fmtDate(a.due)}</span>`:'-'}</td></tr>
        <tr class="detail" data-for="${esc2(a.id)}" style="display:none"><td colspan="6" style="background:var(--panel-2,#f7f9fc)"><div id="det-${esc2(a.id)}"></div></td></tr>`).join('')
        :'<tr><td colspan="6" class="muted" style="padding:24px;text-align:center">해당하는 지시가 없습니다.</td></tr>';
      tb.querySelectorAll('tr.row').forEach(tr=>tr.onclick=()=>{ const d=tb.querySelector(`tr.detail[data-for="${CSS.escape(tr.dataset.id)}"]`); if(!d) return;
        const open=d.style.display==='none'; d.style.display=open?'table-row':'none'; if(open) drawDetail(tr.dataset.id); });
    }
    function drawDetail(id){
      const a=list.find(x=>x.id===id); if(!a) return; const box=st.querySelector(`#det-${CSS.escape(id)}`); if(!box) return;
      const canReview=(a.fromId===u.loginId || a.fromName===u.name || isAdmin());
      const tl=(a.timeline||[]).map(t=>`${fmtDT(t.at)} · <b>${S[t.act]||t.act}</b>${t.byName?' · '+esc2(t.byName):''}${t.note?' — '+esc2(t.note):''}`).join('<br>');
      box.innerHTML=`<div style="padding:10px 4px">
        <div style="font-size:12.5px;line-height:1.6">${a.detail?esc2(a.detail)+'<br>':''}${a.reportFormat?`<span class="muted">보고 형태: ${esc2(a.reportFormat)}</span><br>`:''}
          ${a.progressNote?`<span class="muted">진행/보고: </span>${esc2(a.progressNote)}<br>`:''}${a.feedback?`<span style="color:var(--warn)">피드백: ${esc2(a.feedback)}</span><br>`:''}</div>
        ${tl?`<div class="ab-tl" style="margin-top:8px">${tl}</div>`:''}
        ${canReview&&a.status==='submitted'?`<div style="margin-top:10px;display:flex;gap:6px"><button class="btn pri sm" data-b="done" data-id="${esc2(a.id)}">${icon('check')}완료 확정</button><button class="btn ghost sm" data-b="fb" data-id="${esc2(a.id)}">반려·피드백</button></div>`:''}
        ${canReview?`<div style="margin-top:8px"><button class="btn ghost sm" data-b="del" data-id="${esc2(a.id)}" style="color:var(--danger)">${icon('trash')}삭제</button></div>`:''}
      </div>`;
      box.querySelectorAll('[data-b]').forEach(btn=>btn.onclick=async(e)=>{ e.stopPropagation(); const act=btn.dataset.b, rec=list.find(x=>x.id===btn.dataset.id);
        const by={by:u.loginId||'',byName:u.name||u.loginId||''};
        if(act==='done'){ await Assign.transition(rec,'done',by); toast('완료 확정'); }
        else if(act==='fb'){ const n=prompt('피드백/재요청 내용'); if(n==null) return; await Assign.transition(rec,'feedback',{...by,note:n}); toast('피드백 전달'); }
        else if(act==='del'){ if(!confirm('이 지시를 삭제할까요?')) return; await Assign.remove(rec.id); toast('삭제'); }
        document.dispatchEvent(new CustomEvent('assign:changed')); renderAssignBoard(host, opt);
      });
    }
    st.querySelector('#abSt').onchange=e=>{ fSt=e.target.value; drawRows(); };
    st.querySelector('#abWho').onchange=e=>{ fWho=e.target.value; drawRows(); };
    st.querySelector('#abQ').oninput=e=>{ q=e.target.value; drawRows(); };
    drawKpi(); drawAgg(); drawRows();
  }
  window.renderAssignBoard = renderAssignBoard;

  /* ─────────────────────── 우측 하단 지시함 위젯 + 알림 배지 ─────────────────────── */
  let widgetCache=[];
  function actionableCount(list, u){
    const mine=Assign.mine(list,u).filter(a=>a.status==='sent').length;         // 수락 대기
    const rev =Assign.fromMe(list,u).filter(a=>a.status==='submitted').length;  // 완료보고 확인 대기
    return { mine, rev, total:mine+rev };
  }
  function setNavBadge(n){ const s=document.querySelector('.nav-item[data-key="home.mytasks"] .nav-badge'); if(s){ if(n>0){ s.textContent=n>99?'99+':n; s.style.display='inline-block'; } else s.style.display='none'; } }

  async function refreshTaskWidget(){
    const u=me(); if(!u||!u.loginId&&!u.name) return;
    let list=null; try{ list=await Assign.all(); }catch(e){ list=null; }
    if(list) widgetCache=list;
    const fab=document.getElementById('taskFab'); if(!fab) return;
    const {mine,rev,total}=actionableCount(widgetCache,u);
    const b=fab.querySelector('.tf-badge');
    if(total>0){ b.textContent=total>99?'99+':total; b.style.display='flex'; } else b.style.display='none';
    setNavBadge(mine);
    const panel=document.getElementById('taskPanel');
    if(panel && panel.classList.contains('open')) drawPanel();
    return {mine,rev,total};
  }
  window.refreshTaskWidget = refreshTaskWidget;

  function drawPanel(){
    const panel=document.getElementById('taskPanel'); if(!panel) return; const u=me();
    const recv=Assign.mine(widgetCache,u).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    const rev =Assign.fromMe(widgetCache,u).filter(a=>a.status==='submitted').sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));
    const card=a=>`<div class="tp-card" data-id="${esc2(a.id)}">
        <div style="display:flex;gap:8px;align-items:center"><b style="flex:1;font-size:13px">${esc2(a.title)}</b>${stPill(a.status)}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">지시: ${esc2(a.fromName||'?')}${a.due?' · 마감 '+fmtDate(a.due):''}${a.priority==='urgent'?' · <b style="color:var(--danger)">급함</b>':''}</div>
        ${a.detail?`<div style="font-size:12px;color:var(--ink-2);margin-top:5px;line-height:1.5">${esc2(a.detail)}</div>`:''}
        ${a.reportFormat?`<div style="font-size:11px;color:var(--muted);margin-top:4px">보고: ${esc2(a.reportFormat)}</div>`:''}
        ${a.status==='sent'?`<div style="margin-top:8px;display:flex;gap:6px"><button class="btn pri sm" data-act="accept" data-id="${esc2(a.id)}">${icon('check')}수락</button><button class="btn ghost sm" data-act="reject" data-id="${esc2(a.id)}">반려</button></div>`:''}
      </div>`;
    const revCard=a=>`<div class="tp-card" data-id="${esc2(a.id)}">
        <div style="display:flex;gap:8px;align-items:center"><b style="flex:1;font-size:13px">${esc2(a.title)}</b>${stPill(a.status)}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">담당: ${esc2(a.toName||'?')} · 완료보고 ${fmtDT(a.submittedAt)}</div>
        ${a.progressNote?`<div style="font-size:12px;color:var(--ink-2);margin-top:5px;line-height:1.5">${esc2(a.progressNote)}</div>`:''}
        <div style="margin-top:8px;display:flex;gap:6px"><button class="btn pri sm" data-act="done" data-id="${esc2(a.id)}">${icon('check')}완료 확정</button><button class="btn ghost sm" data-act="feedback" data-id="${esc2(a.id)}">반려·피드백</button></div>
      </div>`;
    panel.querySelector('.tp-body').innerHTML=`
      <div class="tp-sec">내게 온 업무 <span>${recv.length}</span></div>
      ${recv.length?recv.map(card).join(''):'<div class="tp-empty">받은 업무 지시가 없습니다.</div>'}
      ${rev.length?`<div class="tp-sec" style="margin-top:12px">내가 지시 · 완료보고 확인 <span>${rev.length}</span></div>${rev.map(revCard).join('')}`:''}`;
    panel.querySelectorAll('[data-act]').forEach(btn=>btn.onclick=()=>handleAct(btn.dataset.act, btn.dataset.id));
  }

  async function handleAct(act, id){
    const rec=widgetCache.find(a=>a.id===id); if(!rec) return; const u=me();
    const by={by:u.loginId||'',byName:u.name||u.loginId||''};
    if(act==='accept'){ await Assign.transition(rec,'accepted',by); toast('업무를 수락했습니다 · [내 업무]에서 진행하세요'); }
    else if(act==='reject'){ if(!confirm('이 업무 지시를 반려할까요?')) return; await Assign.transition(rec,'feedback',{...by,note:'담당자 반려'}); toast('반려했습니다'); }
    else if(act==='done'){ await Assign.transition(rec,'done',by); toast('완료 확정 처리했습니다'); }
    else if(act==='feedback'){ const note=prompt('피드백/재요청 내용을 입력하세요'); if(note==null) return; await Assign.transition(rec,'feedback',{...by,note}); toast('담당자에게 피드백을 전달했습니다'); }
    document.dispatchEvent(new CustomEvent('assign:changed')); await refreshTaskWidget();
  }

  function initTaskWidget(){
    if(document.getElementById('taskFab')) return;
    const wrap=el('div'); wrap.id='taskWidget';
    wrap.innerHTML=`
      <style>
        #taskFab{position:fixed;right:22px;bottom:22px;z-index:9500;width:52px;height:52px;border-radius:50%;background:var(--info);color:#fff;border:none;box-shadow:0 6px 20px rgba(20,40,74,.28);cursor:pointer;display:flex;align-items:center;justify-content:center}
        #taskFab:hover{filter:brightness(1.05)} #taskFab .ic svg{width:24px;height:24px}
        #taskFab .tf-badge{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--danger);color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;border:2px solid var(--panel)}
        #taskPanel{position:fixed;right:22px;bottom:84px;z-index:9500;width:360px;max-width:calc(100vw - 32px);max-height:min(560px,calc(100vh - 120px));background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(20,40,74,.24);display:none;flex-direction:column;overflow:hidden}
        #taskPanel.open{display:flex}
        #taskPanel .tp-hd{padding:13px 16px;border-bottom:1px solid var(--line);font-weight:800;font-size:14px;display:flex;align-items:center;gap:8px}
        #taskPanel .tp-body{padding:12px 14px;overflow-y:auto}
        #taskPanel .tp-sec{font-size:11px;font-weight:800;color:var(--muted);margin:2px 0 7px;text-transform:none}
        #taskPanel .tp-sec span{background:var(--info-bg);color:var(--info);border-radius:8px;padding:1px 7px;margin-left:4px}
        #taskPanel .tp-card{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--panel)}
        #taskPanel .tp-empty{color:var(--muted);font-size:12.5px;padding:14px 4px;text-align:center}
      </style>
      <button id="taskFab" title="업무 지시함">${icon('inbox')}<span class="tf-badge"></span></button>
      <div id="taskPanel"><div class="tp-hd">${icon('inbox')} 업무 지시함 <span style="margin-left:auto;font-size:11px;font-weight:600;color:var(--muted)">수락하면 [내 업무]에 기록됩니다</span></div><div class="tp-body"></div></div>`;
    document.body.appendChild(wrap);
    const fab=document.getElementById('taskFab'), panel=document.getElementById('taskPanel');
    fab.onclick=()=>{ const open=panel.classList.toggle('open'); if(open) drawPanel(); };
    document.addEventListener('click',e=>{ if(panel.classList.contains('open') && !panel.contains(e.target) && e.target!==fab && !fab.contains(e.target)) panel.classList.remove('open'); });
    document.addEventListener('assign:changed',()=>refreshTaskWidget());
    refreshTaskWidget();
    clearInterval(window.__taskPoll); window.__taskPoll=setInterval(refreshTaskWidget, 60000);
  }
  window.initTaskWidget = initTaskWidget;

  /* ─────────────────────── 홈 · 내 업무(개인 업무 현황) ─────────────────────── */
  MODULES['home.mytasks']={
    title:'내 업무', icon:'inbox',
    render(root){
      const u=me();
      root.innerHTML=`
        <style>
          .mt-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
          .mt-card{border:1px solid var(--line);border-left:3px solid var(--line-2);border-radius:11px;background:var(--panel);padding:13px 15px;box-shadow:var(--sh-sm)}
          .mt-card.s-sent{border-left-color:var(--warn)} .mt-card.s-accepted{border-left-color:var(--info)}
          .mt-card.s-submitted{border-left-color:#8b5cf6} .mt-card.s-done{border-left-color:var(--ok);opacity:.72}
          .mt-t{font-weight:800;font-size:14px;margin-bottom:3px} .mt-meta{font-size:11.5px;color:var(--muted)}
          .mt-detail{font-size:12.5px;color:var(--ink-2);margin:7px 0;line-height:1.55}
          .mt-fb{font-size:12px;background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:7px 10px;margin:6px 0}
          .mt-sechd{font-size:12.5px;font-weight:800;margin:16px 0 9px;display:flex;align-items:center;gap:7px}
        </style>
        <div class="mhead"><div class="tt">내 업무</div><div class="ds">내게 지시된 업무만 표시됩니다. 수락 → 진행 → 완료 순으로 처리하세요.</div>
          <div class="mhead-act"><button class="btn ghost sm" id="mtReload">${icon('refresh')||''}새로고침</button></div></div>
        <div class="mbody wide" id="mtBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#mtBody');
      root.querySelector('#mtReload').onclick=()=>load();
      async function load(){ let list=[]; try{ list=await Assign.all()||[]; }catch(e){} if(!root.isConnected) return;
        const mine=Assign.mine(list,u);
        const active=mine.filter(a=>a.status!=='done').sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
        const done=mine.filter(a=>a.status==='done').sort((a,b)=>String(b.doneAt).localeCompare(String(a.doneAt)));
        if(!mine.length){ body.innerHTML=`<div class="muted" style="padding:40px;text-align:center">${icon('inbox')}<div style="margin-top:8px">받은 업무 지시가 없습니다.</div></div>`; return; }
        body.innerHTML=`
          <div class="mt-sechd">${icon('clipboard')} 진행 중 · ${active.length}건</div>
          <div class="mt-col">${active.map(cardHtml).join('')||'<div class="muted" style="font-size:12.5px">진행 중인 업무가 없습니다.</div>'}</div>
          ${done.length?`<div class="mt-sechd">${icon('check')} 완료 · ${done.length}건</div><div class="mt-col">${done.map(cardHtml).join('')}</div>`:''}`;
        body.querySelectorAll('[data-act]').forEach(btn=>btn.onclick=()=>act(btn.dataset.act, btn.dataset.id));
      }
      function cardHtml(a){
        return `<div class="mt-card s-${a.status}">
          <div style="display:flex;gap:8px;align-items:center"><div class="mt-t" style="flex:1">${esc2(a.title)}</div>${stPill(a.status)}</div>
          <div class="mt-meta">지시: ${esc2(a.fromName||'?')} · ${fmtDate(a.createdAt)}${a.due?' · 마감 '+fmtDate(a.due):''}${a.priority==='urgent'?' · <b style="color:var(--danger)">급함</b>':''}</div>
          ${a.detail?`<div class="mt-detail">${esc2(a.detail)}</div>`:''}
          ${a.reportFormat?`<div class="mt-meta">보고 형태: ${esc2(a.reportFormat)}</div>`:''}
          ${a.feedback?`<div class="mt-fb">${icon('megaphone')} 피드백: ${esc2(a.feedback)}</div>`:''}
          <div style="margin-top:9px;display:flex;gap:6px;flex-wrap:wrap">
            ${a.status==='sent'?`<button class="btn pri sm" data-act="accept" data-id="${esc2(a.id)}">${icon('check')}수락</button><button class="btn ghost sm" data-act="reject" data-id="${esc2(a.id)}">반려</button>`:''}
            ${a.status==='accepted'?`<button class="btn pri sm" data-act="submit" data-id="${esc2(a.id)}">${icon('check')}완료 보고</button><button class="btn ghost sm" data-act="note" data-id="${esc2(a.id)}">진행 메모</button>`:''}
            ${a.status==='submitted'?`<span class="muted" style="font-size:12px">지시자 확인 대기 중…</span>`:''}
            ${a.status==='done'?`<span class="muted" style="font-size:12px">완료 · ${fmtDT(a.doneAt)}</span>`:''}
          </div></div>`;
      }
      async function act(action, id){ let list=[]; try{ list=await Assign.all()||[]; }catch(e){} const rec=list.find(a=>a.id===id); if(!rec) return;
        const by={by:u.loginId||'',byName:u.name||u.loginId||''};
        if(action==='accept'){ await Assign.transition(rec,'accepted',by); toast('수락 · 진행 상태로 이동'); }
        else if(action==='reject'){ if(!confirm('반려할까요?')) return; await Assign.transition(rec,'feedback',{...by,note:'담당자 반려'}); toast('반려'); }
        else if(action==='note'){ const n=prompt('진행 메모(지시자에게 함께 전달됩니다)', rec.progressNote||''); if(n==null) return; await Assign.transition(rec,'progress',{...by,note:n}); toast('진행 메모 저장'); }
        else if(action==='submit'){ const n=prompt('완료 보고 내용(선택)', rec.progressNote||''); if(n==null) return; await Assign.transition(rec,'submitted',{...by,note:n}); toast('완료 보고 · 지시자에게 알림'); }
        document.dispatchEvent(new CustomEvent('assign:changed')); load();
      }
      load();
    }
  };
})();
