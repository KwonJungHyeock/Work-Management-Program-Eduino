/* ===========================================================================
   HR · 홈 · 분기 현황  (+ 직원 마스터)
   - 직원 마스터는 HR 전 화면(교육 한도·복리비 인원수·팀장 피드백 대상)의 기준 데이터
   - 저장: api/hr.js 의 'staff' (서버가 권한 확인 후에만 내줌)
   - 기본값은 절대 자동 저장하지 않는다 — 담당자가 [명세서 기준 명단 넣기]를 눌렀을 때만 기록
   =========================================================================== */
(function(){
  const KEY='hr.home';
  const TEAMS=[
    { k:'edutech', n:'에듀테크 사업팀' },
    { k:'aiot',    n:'AIoT 교육플랫폼 사업팀' },
    { k:'pet',     n:'펫테크 사업팀' },
  ];
  const teamName=k=>{ const t=TEAMS.find(x=>x.k===k); return t?t.n:(k||'미지정'); };
  const ROLES=[['member','팀원'],['lead','팀장'],['exec','이사'],['ceo','대표이사']];
  const roleName=r=>{ const x=ROLES.find(v=>v[0]===r); return x?x[1]:'팀원'; };
  /* 명세서 1장 기준 초기 명단 — 버튼을 눌렀을 때만 저장된다 */
  const SEED=[
    ['임세빈','edutech','lead'],['함인영','edutech','member'],['신아름','edutech','member'],
    ['여미림','edutech','member'],['이진환','edutech','member'],['송민희','edutech','member'],
    ['권정혁','aiot','lead'],['박주희','aiot','member'],['조서연','aiot','member'],
    ['최창조','pet','lead'],['이근재','pet','member'],
  ];
  const BUDGET=300000;   // 1인 연간 교육비 한도

  const CSS=`
    .hr-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:11px;margin-bottom:16px}
    .hr-k{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:13px 15px;box-shadow:var(--sh-sm)}
    .hr-k .v{font-size:23px;font-weight:800;line-height:1.1} .hr-k .v small{font-size:12px;font-weight:700;color:var(--muted);margin-left:2px}
    .hr-k .l{font-size:11.5px;color:var(--muted);margin-top:5px;font-weight:600}
    .hr-sec{font-size:13px;font-weight:800;margin:18px 0 9px;display:flex;align-items:center;gap:8px}
    .hr-sec .muted{font-weight:600;font-size:11.5px}
    .hr-sec .btn{margin-left:auto}
    .hr-tbl{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--panel)}
    .hr-tbl th{text-align:left;font-size:11px;color:var(--muted);font-weight:700;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--panel-2);white-space:nowrap}
    .hr-tbl td{padding:8px 10px;border-bottom:1px solid var(--line-2);vertical-align:middle}
    .hr-wrap{border:1px solid var(--line);border-radius:11px;overflow:auto}
    .hr-tag{font-size:11px;font-weight:800;border-radius:6px;padding:2px 8px;white-space:nowrap}
    .hr-empty{padding:34px;text-align:center;color:var(--muted);font-size:13px}
    .hr-f[hidden]{display:none}
    .hr-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end;border:1px solid var(--line);border-radius:11px;padding:12px 14px;background:var(--panel);margin-bottom:12px}
    .hr-f label{display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px}
    .hr-f input,.hr-f select{width:100%;height:34px;font:inherit;font-size:12.5px}
    .hr-f .a{display:flex;gap:6px}`;

  MODULES[KEY]={
    title:'홈·분기 현황', icon:'dashboard',
    render(root){
      root.innerHTML=`<style>${(window.HR&&HR.CSS)||''}${CSS}</style>
        <div class="mhead"><div class="tt">HR · 홈 · 분기 현황</div>
          <div class="ds">인사·교육 운영 기준 데이터와 이번 분기 현황입니다. 인사담당자와 대표만 열람합니다.</div></div>
        <div class="mbody wide" id="hrBody"></div>`;
      HR.guard(root.querySelector('#hrBody'), KEY, draw);
    }
  };

  async function draw(host, s){
    host.innerHTML=HR.headBar(s)+`<div class="muted" style="padding:16px">불러오는 중…</div>`;
    HR.wireHead(host, s);
    const r=await HR.api('list',{ name:'staff' });
    if(!host.isConnected) return;
    if(r.relock){ s.relock(); return; }
    if(!r.ok){ host.innerHTML=HR.headBar(s)+`<div class="hr-empty">${icon('alert')||''}<div style="margin-top:8px">${esc(r.error||'불러오지 못했습니다')}</div></div>`; HR.wireHead(host,s); return; }
    let staff=(r.items||[]).slice().sort((a,b)=>
      (TEAMS.findIndex(t=>t.k===a.team)-TEAMS.findIndex(t=>t.k===b.team)) ||
      String(a.name||'').localeCompare(String(b.name||''),'ko'));
    const canWrite=!!r.canWrite;

    const byTeam={}; staff.forEach(p=>{ byTeam[p.team]=(byTeam[p.team]||0)+1; });
    host.innerHTML=HR.headBar(s)+`
      <div class="hr-kpi">
        <div class="hr-k"><div class="v">${staff.length}<small>명</small></div><div class="l">등록 인원</div></div>
        <div class="hr-k"><div class="v">${Object.keys(byTeam).length}<small>팀</small></div><div class="l">사업팀</div></div>
        <div class="hr-k"><div class="v">${fmtNum(staff.length*BUDGET)}<small>원</small></div><div class="l">연간 교육비 한도 총액 (1인 ${fmtNum(BUDGET)}원)</div></div>
        <div class="hr-k"><div class="v">-</div><div class="l">법정의무교육 이수율 · 다음 단계에서 연결</div></div>
      </div>
      ${TEAMS.map(t=>`<span class="hr-tag" style="background:var(--panel-2);color:var(--ink-2);margin-right:6px">${esc(t.n)} ${byTeam[t.k]||0}명</span>`).join('')}
      <div class="hr-sec">${icon('users')||''} 직원 마스터 <span class="muted">교육 한도·복리비·피드백의 기준이 되는 명단</span>
        ${canWrite?`<button class="btn pri sm" id="hrAdd">${icon('plus')||''}직원 추가</button>`:''}</div>
      ${canWrite?`<div class="hr-f" id="hrForm" hidden>
        <div><label>이름</label><input id="sfName" placeholder="이름"></div>
        <div><label>소속팀</label><select id="sfTeam">${TEAMS.map(t=>`<option value="${t.k}">${esc(t.n)}</option>`).join('')}</select></div>
        <div><label>직무</label><input id="sfJob" placeholder="예: 경리/HR"></div>
        <div><label>역할</label><select id="sfRole">${ROLES.map(v=>`<option value="${v[0]}">${v[1]}</option>`).join('')}</select></div>
        <div><label>입사일</label><input id="sfJoin" type="date"></div>
        <div><label>계정 아이디(선택)</label><input id="sfLogin" placeholder="마이페이지 연결용"></div>
        <div><label>부족 역량(쉼표 구분)</label><input id="sfGap" placeholder="예: 회계, 데이터분석"></div>
        <div class="a"><button class="btn pri sm" id="sfSave">${icon('check')||''}저장</button><button class="btn ghost sm" id="sfCancel">취소</button></div>
      </div>`:''}
      <div class="hr-wrap">
        <table class="hr-tbl"><thead><tr>
          <th style="width:88px">이름</th><th style="width:150px">소속팀</th><th>직무</th>
          <th style="width:70px">역할</th><th style="width:96px">입사일</th><th>부족 역량</th>
          ${canWrite?'<th style="width:96px"></th>':''}</tr></thead>
        <tbody id="hrRows"></tbody></table>
      </div>
      ${(!staff.length&&canWrite)?`<div class="hr-empty">${icon('users')||''}
        <div style="margin:8px 0 4px;font-weight:700;color:var(--ink)">아직 등록된 직원이 없습니다</div>
        <div style="font-size:12.5px">요구사항 명세서 기준 명단(11명)을 한 번에 넣을 수 있습니다. 넣은 뒤 자유롭게 수정하세요.</div>
        <div style="margin-top:12px"><button class="btn pri sm" id="hrSeed">${icon('upload')||''}명세서 기준 명단 넣기</button></div></div>`:''}
      ${(!staff.length&&!canWrite)?`<div class="hr-empty">등록된 직원이 없습니다. 인사담당자가 명단을 등록하면 표시됩니다.</div>`:''}`;
    HR.wireHead(host, s);

    const rows=host.querySelector('#hrRows');
    rows.innerHTML=staff.map(p=>`<tr data-id="${esc(p.id)}">
      <td><b>${esc(p.name||'')}</b></td>
      <td>${esc(teamName(p.team))}</td>
      <td>${esc(p.job||'')||'<span class="muted">-</span>'}</td>
      <td>${p.role&&p.role!=='member'?`<span class="hr-tag" style="background:var(--active-bg);color:var(--red)">${esc(roleName(p.role))}</span>`:'팀원'}</td>
      <td>${esc(p.joinedAt||'')||'<span class="muted">-</span>'}</td>
      <td>${(p.gaps||[]).length?p.gaps.map(g=>`<span class="hr-tag" style="background:var(--panel-2);color:var(--ink-2);margin-right:4px">${esc(g)}</span>`).join(''):'<span class="muted">-</span>'}</td>
      ${canWrite?`<td style="white-space:nowrap"><button class="btn ghost sm" data-a="edit">수정</button><button class="btn ghost sm" data-a="del" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
    </tr>`).join('');

    if(!canWrite) return;
    const $=q=>host.querySelector(q);
    const form=$('#hrForm'); let editing=null;
    const openForm=(p)=>{ editing=p||null; form.hidden=false;
      $('#sfName').value=p?p.name||'':''; $('#sfTeam').value=p?p.team||'edutech':'edutech';
      $('#sfJob').value=p?p.job||'':''; $('#sfRole').value=p?p.role||'member':'member';
      $('#sfJoin').value=p?p.joinedAt||'':''; $('#sfGap').value=p?(p.gaps||[]).join(', '):'';
      $('#sfLogin').value=p?p.loginId||'':'';
      $('#sfName').focus(); };
    const add=$('#hrAdd'); if(add) add.onclick=()=>openForm(null);
    $('#sfCancel').onclick=()=>{ form.hidden=true; editing=null; };
    $('#sfSave').onclick=async()=>{
      const name=($('#sfName').value||'').trim();
      if(!name){ toast('이름을 입력하세요'); $('#sfName').focus(); return; }
      const item={ id:(editing&&editing.id)||uuid(), name, team:$('#sfTeam').value, job:($('#sfJob').value||'').trim(),
        role:$('#sfRole').value, joinedAt:$('#sfJoin').value||'', loginId:($('#sfLogin').value||'').trim(),
        gaps:($('#sfGap').value||'').split(',').map(x=>x.trim()).filter(Boolean) };
      $('#sfSave').disabled=true;
      const d=await HR.api('put',{ name:'staff', item });
      $('#sfSave').disabled=false;
      if(d.relock){ s.relock(); return; }
      if(!d.ok){ toast(d.error||'저장 실패'); return; }
      toast(editing?'수정했습니다':'추가했습니다'); form.hidden=true; editing=null; draw(host,s);
    };
    rows.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{
      const id=b.closest('tr').dataset.id, p=staff.find(x=>x.id===id); if(!p) return;
      if(b.dataset.a==='edit'){ openForm(p); try{ form.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} return; }
      if(!confirm(`${p.name} 님을 명단에서 삭제할까요?`)) return;
      const d=await HR.api('del',{ name:'staff', id });
      if(d.relock){ s.relock(); return; }
      if(!d.ok){ toast(d.error||'삭제 실패'); return; }
      toast('삭제했습니다'); draw(host,s);
    });
    const seed=$('#hrSeed');
    if(seed) seed.onclick=async()=>{
      if(!confirm('명세서 기준 11명을 명단에 넣을까요? 넣은 뒤 수정·삭제할 수 있습니다.')) return;
      seed.disabled=true; seed.textContent='넣는 중…';
      for(const [name,team,role] of SEED){
        const d=await HR.api('put',{ name:'staff', item:{ id:uuid(), name, team, role, job:'', joinedAt:'', gaps:[] } });
        if(d.relock){ s.relock(); return; }
        if(!d.ok){ toast(d.error||'저장 실패'); break; }
      }
      toast('명단을 등록했습니다'); draw(host,s);
    };
  }
})();
