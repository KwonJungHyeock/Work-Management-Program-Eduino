/* ===========================================================================
   HR · 팀장 피드백 🔒  (요구사항 명세서 4-8)
   - 팀장이 팀원별 '필요 교육 의견'을 남긴다. 평가 목적이 아니라 교육 배정 참고용.
   - 열람 권한이 갈린다:
       · 인사담당자·대표(hr.feedback)  → 전체 열람
       · 팀장(hr.fbwrite)              → 자기가 쓴 것만 보이고 고칠 수 있음(서버에서 강제)
       · 팀원 본인·타 팀장             → 접근 불가
   =========================================================================== */
(function(){
  const TEAMS=[{k:'edutech',n:'에듀테크 사업팀'},{k:'aiot',n:'AIoT 교육플랫폼 사업팀'},{k:'pet',n:'펫테크 사업팀'}];
  const teamName=k=>{ const t=TEAMS.find(x=>x.k===k); return t?t.n:(k||'미지정'); };
  const quarterOf=d=>{ const x=d?new Date(d):new Date(); return `${x.getFullYear()} ${Math.floor(x.getMonth()/3)+1}분기`; };
  const QUARTERS=()=>{ const out=[], now=new Date();
    for(let i=0;i<4;i++){ const d=new Date(now.getFullYear(), now.getMonth()-i*3, 1); const q=quarterOf(d); if(!out.includes(q)) out.push(q); }
    return out; };

  HR.page('hr.feedback','팀장 피드백','팀장이 팀원에게 필요한 교육 의견을 남기는 곳입니다. 평가 자료가 아니며, 인사담당자와 대표만 전체를 열람합니다.',
  async function(host, s){
    HR.loading(host,s);
    const d=await HR.loadMany(['feedback','staff'],s); if(!d||!host.isConnected) return;
    const me=s.me||{};
    const isHR=s.has('hr.feedback');                // 전체 열람(인사담당자·대표)
    const mineOnly=!isHR;                            // 팀장 = 본인 작성분만
    let fTeam='', fQ='', editing=null;
    const staff=d.staff.slice().sort((a,b)=>
      (TEAMS.findIndex(t=>t.k===a.team)-TEAMS.findIndex(t=>t.k===b.team))||String(a.name).localeCompare(String(b.name),'ko'));

    const draw=()=>{
      const list=d.feedback.slice()
        .filter(x=>!fTeam||x.team===fTeam)
        .filter(x=>!fQ||x.quarter===fQ)
        .sort((a,b)=>String(b.at).localeCompare(String(a.at)));
      const people=[...new Set(d.feedback.map(x=>x.target).filter(Boolean))].length;
      HR.shell(host,s,`
        ${isHR?`<div class="he-kpi">
          <div class="he-k"><div class="v">${d.feedback.length}<small>건</small></div><div class="l">등록된 피드백</div></div>
          <div class="he-k"><div class="v">${people}<small>명</small></div><div class="l">의견이 등록된 팀원</div></div>
          <div class="he-k"><div class="v">${esc(quarterOf())}</div><div class="l">이번 분기</div></div>
        </div>`
        :`<div class="nx-note" style="font-size:12.5px;margin-bottom:12px">${icon('info')||''}
           <b>본인이 등록한 피드백만</b> 표시됩니다. 등록한 내용은 인사담당자와 대표가 교육 배정에 참고합니다.</div>`}
        <div class="he-bar">
          ${isHR?`<select id="fbTeam"><option value="">팀 전체</option>${TEAMS.map(t=>`<option value="${t.k}" ${t.k===fTeam?'selected':''}>${esc(t.n)}</option>`).join('')}</select>`:''}
          <select id="fbQ"><option value="">분기 전체</option>${QUARTERS().map(q=>`<option ${q===fQ?'selected':''}>${esc(q)}</option>`).join('')}</select>
          ${d.can_feedback?`<button class="btn pri sm" id="fbAdd">${icon('plus')||''}피드백 등록</button>`:''}
          <span class="he-cnt">${list.length}건${mineOnly?' · 본인 작성분':''}</span>
        </div>
        ${d.can_feedback?`<div class="he-f" id="fbForm" hidden>
          <div><label>대상 팀원</label>${staff.length
            ?`<select id="fbTarget">${staff.map(p=>`<option value="${esc(p.name)}|${esc(p.team||'')}">${esc(p.name)} · ${esc(teamName(p.team))}</option>`).join('')}</select>`
            :`<input id="fbTargetTxt" placeholder="팀원 이름">`}</div>
          <div><label>분기</label><select id="fbQuarter">${QUARTERS().map(q=>`<option>${esc(q)}</option>`).join('')}</select></div>
          <div class="wide"><label>필요한 교육·의견</label><textarea id="fbNote" placeholder="예: 견적 실무에서 회계 기초가 더 필요해 보임"></textarea></div>
          <div class="a"><button class="btn pri sm" id="fbSave">${icon('check')||''}저장</button><button class="btn ghost sm" id="fbCancel">취소</button></div>
        </div>`:''}
        ${list.length?`<div class="he-wrap"><table class="he-tbl">
          <thead><tr><th style="width:86px">대상</th><th style="width:150px">소속팀</th><th>필요한 교육·의견</th>
            <th style="width:110px">분기</th>${isHR?'<th style="width:86px">작성자</th>':''}
            <th style="width:96px">작성일</th>${d.can_feedback?'<th style="width:104px" class="act"></th>':''}</tr></thead>
          <tbody>${list.map(x=>`<tr>
            <td><b>${esc(x.target||'')}</b></td><td style="white-space:nowrap">${esc(teamName(x.team))}</td>
            <td style="white-space:pre-wrap;line-height:1.5">${esc(x.note||'')}</td>
            <td>${esc(x.quarter||'')}</td>
            ${isHR?`<td>${esc(x.by||'')}</td>`:''}
            <td>${esc(String(x.at||'').slice(0,10))}</td>
            ${d.can_feedback?`<td class="act">${(x.byId===me.loginId||isHR)
              ?`<button class="btn ghost sm" data-e="${esc(x.id)}">수정</button><button class="btn ghost sm" data-d="${esc(x.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button>`
              :'<span class="muted">-</span>'}</td>`:''}
          </tr>`).join('')}</tbody></table></div>`
        :`<div class="he-empty">${icon('chat')||icon('inbox')||''}
            <div style="margin-top:8px">${mineOnly?'등록한 피드백이 없습니다.':'등록된 피드백이 없습니다.'}</div>
            ${d.can_feedback?'<div style="font-size:12px;margin-top:4px">[피드백 등록]으로 팀원에게 필요한 교육 의견을 남겨 주세요.</div>':''}</div>`}`);

      const $=x=>host.querySelector(x);
      const tSel=$('#fbTeam'); if(tSel) tSel.onchange=e=>{ fTeam=e.target.value; draw(); };
      $('#fbQ').onchange=e=>{ fQ=e.target.value; draw(); };
      if(!d.can_feedback) return;
      const form=$('#fbForm');
      const open=x=>{ editing=x||null; form.hidden=false;
        const tg=$('#fbTarget'); if(tg&&x) tg.value=`${x.target}|${x.team||''}`;
        const tt=$('#fbTargetTxt'); if(tt) tt.value=x?x.target||'':'';
        $('#fbQuarter').value=(x&&x.quarter)||quarterOf();
        $('#fbNote').value=x?x.note||'':''; $('#fbNote').focus(); };
      $('#fbAdd').onclick=()=>open(null);
      $('#fbCancel').onclick=()=>{ form.hidden=true; editing=null; };
      $('#fbSave').onclick=async()=>{
        let target='', team='';
        const tg=$('#fbTarget');
        if(tg){ const v=(tg.value||'').split('|'); target=v[0]||''; team=v[1]||''; }
        else { target=($('#fbTargetTxt').value||'').trim(); }
        const note=($('#fbNote').value||'').trim();
        if(!target){ toast('대상 팀원을 지정하세요'); return; }
        if(!note){ toast('필요한 교육·의견을 입력하세요'); return; }
        const item={ id:(editing&&editing.id)||uuid(), target, team:team||(editing&&editing.team)||'',
          quarter:$('#fbQuarter').value, note,
          by:(editing&&editing.by)||me.name||'', byId:(editing&&editing.byId)||me.loginId||'',
          at:(editing&&editing.at)||nowISO() };
        $('#fbSave').disabled=true; const r=await HR.api('put',{ name:'feedback', item }); $('#fbSave').disabled=false;
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'저장 실패'); return; }
        d.feedback=editing?d.feedback.map(x=>x.id===item.id?item:x):d.feedback.concat([item]);
        toast(editing?'수정했습니다':'등록했습니다'); form.hidden=true; editing=null; draw();
      };
      host.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{ open(d.feedback.find(x=>x.id===b.dataset.e)); form.scrollIntoView({behavior:'smooth',block:'center'}); });
      host.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 피드백을 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'feedback', id:b.dataset.d });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.feedback=d.feedback.filter(x=>x.id!==b.dataset.d); toast('삭제했습니다'); draw();
      });
    };
    draw();
  }, ['hr.feedback','hr.fbwrite']);
})();
