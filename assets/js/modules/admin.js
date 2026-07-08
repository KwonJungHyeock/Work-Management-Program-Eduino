/* ===========================================================================
   관리자 · 팀원 계정 관리 (팀장 전용)
   - 아이디·접속코드·이름·부서(CS/MD)·업무메일을 발급/수정/삭제
   - 서버(/api/auth)에서 관리자 인증 후 KV 계정 저장소를 다룸
   =========================================================================== */
(function(){
  async function authApi(op, extra){
    const admin=Auth.adminAuth();
    const res=await fetch('/api/auth',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ op, admin, ...(extra||{}) }) });
    let d=null; try{ d=await res.json(); }catch{}
    if(!d) throw new Error('서버 오류 '+res.status);
    if(!d.ok) throw new Error(d.error||'요청 실패');
    return d;
  }
  const DEPTS=[['cs','CS · 고객 상담'],['md','MD · 상품 기획']];
  const deptLabel=d=>({cs:'CS',md:'MD'}[d]||d||'-');
  // 권한 부여용 기능 목록 (사이드바 NAV의 CS·MD 기능에서 생성)
  const FEATURES=(typeof NAV!=='undefined'?NAV:[]).filter(g=>g.dept==='cs'||g.dept==='md')
    .map(g=>({dept:g.dept,name:g.name,items:(g.items||[]).map(it=>({key:it.key,name:it.name}))}));
  const deptDefault=dept=>{ const g=FEATURES.find(x=>x.dept===dept); return g?g.items.map(it=>it.key):[]; };
  const randCode=()=>{ const s='ABCDEFGHJKLMNPRSTUVWXYZ23456789'; let o=''; for(let i=0;i<6;i++) o+=s[Math.floor((crypto.getRandomValues(new Uint32Array(1))[0]/4294967296)*s.length)]; return 'ED-'+o; };

  MODULES['admin.users']={
    title:'팀원 계정', icon:'users',
    render(root){
      if(!Auth.isAdmin()){
        root.innerHTML=`<div class="view"><div class="empty">${icon('shield')}<div style="font-size:14px">관리자(팀장)만 접근할 수 있는 화면입니다.</div></div></div>`;
        return;
      }
      root.innerHTML=`
      <style>
        .adm-tbl td,.adm-tbl th{vertical-align:middle}
        .code-cell{font-family:var(--mono);letter-spacing:.02em}
        .dept-badge{display:inline-block;font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px}
        .dept-badge.cs{background:#e7f0ff;color:#2d6cdf}.dept-badge.md{background:#ffe9ea;color:#e0313b}
        .u-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end}
        .u-form .fld{margin:0}
        .perm-sec{margin-top:16px;border-top:1px solid var(--line-2);padding-top:14px}
        .perm-cap{font-size:13px;font-weight:800;margin-bottom:11px}
        .perm-pick{display:flex;gap:22px;flex-wrap:wrap}
        .perm-grp{min-width:180px}
        .perm-gl{font-size:11px;font-weight:800;letter-spacing:.05em;margin-bottom:8px;text-transform:uppercase}
        .perm-gl.cs{color:#2d6cdf}.perm-gl.md{color:#e0313b}
        .perm-items{display:flex;flex-direction:column;gap:8px}
        .perm-chk{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;font-weight:600;color:var(--ink-2)}
        .perm-chk input{width:16px;height:16px}
      </style>
      <div class="mhead pad">
        <div class="tt">팀원 계정 관리</div>
        <div class="ds">아이디·접속코드를 발급하면 팀원이 그 정보로 로그인합니다. 접속코드는 서버에서만 검증됩니다.</div>
      </div>
      <div class="mbody">
        <div class="card" style="margin-bottom:18px">
          <div class="card-hd">${icon('plus')}<b>계정 발급 / 수정</b>
            <span class="muted" id="editHint" style="margin-left:auto;font-size:12.5px"></span></div>
          <div class="card-bd">
            <div class="u-form">
              <label class="fld">아이디<input type="text" id="fId" placeholder="cs.kim" autocomplete="off"></label>
              <label class="fld">이름<input type="text" id="fName" placeholder="김상담"></label>
              <label class="fld">부서<select id="fDept">${DEPTS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
              <label class="fld">업무 이메일<input type="text" id="fEmail" placeholder="kim@robodyne.co.kr"></label>
              <label class="fld">접속코드
                <span style="display:flex;gap:6px"><input type="text" id="fCode" placeholder="접속코드" style="flex:1">
                  <button type="button" class="btn sm" id="genCode" title="랜덤 생성">${icon('refresh')}</button></span></label>
            </div>
            <div class="perm-sec">
              <div class="perm-cap">열람 권한 <span class="muted" style="font-weight:500">· 체크한 기능만 사용할 수 있습니다 (부서 선택 시 자동 체크)</span></div>
              <div class="perm-pick" id="permPick"></div>
            </div>
            <div style="display:flex;align-items:center;gap:14px;margin-top:16px">
              <button class="btn pri" id="saveUser">${icon('check')}저장</button>
              <span class="muted" id="admStat" style="font-size:12.5px"></span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-hd">${icon('users')}<b>팀원 목록</b> <span class="muted" id="uCnt" style="font-size:12.5px"></span>
            <button class="btn sm" id="reload" style="margin-left:auto">${icon('refresh')}새로고침</button></div>
          <div class="card-bd" style="padding:0"><div style="overflow:auto"><table class="tbl adm-tbl" id="uTable"></table></div></div>
        </div>
      </div>`;

      const $=s=>root.querySelector(s);
      let editing=null;
      function renderPerms(sel){ const box=$('#permPick'); const S=new Set(sel||[]);
        box.innerHTML=FEATURES.map(g=>`<div class="perm-grp"><div class="perm-gl ${g.dept}">${esc(g.name)}</div>
          <div class="perm-items">${g.items.map(it=>`<label class="perm-chk"><input type="checkbox" data-perm="${it.key}" ${S.has(it.key)?'checked':''}> ${esc(it.name)}</label>`).join('')}</div></div>`).join(''); }
      const collectPerms=()=>[...$('#permPick').querySelectorAll('[data-perm]:checked')].map(c=>c.dataset.perm);
      $('#genCode').onclick=()=>{ $('#fCode').value=randCode(); };
      $('#fDept').onchange=()=>{ const cur=new Set(collectPerms()); deptDefault($('#fDept').value).forEach(k=>cur.add(k)); renderPerms([...cur]); };
      function resetForm(){ editing=null; ['fId','fName','fEmail','fCode'].forEach(i=>$('#'+i).value=''); $('#fDept').value='cs';
        renderPerms(deptDefault('cs')); $('#fId').disabled=false; $('#editHint').textContent=''; $('#fId').focus(); }
      function fillForm(u){ editing=u.loginId; $('#fId').value=u.loginId; $('#fId').disabled=true; $('#fName').value=u.name||'';
        $('#fDept').value=u.dept||'cs'; $('#fEmail').value=u.email||''; $('#fCode').value=u.code||'';
        renderPerms(Array.isArray(u.perms)&&u.perms.length?u.perms:deptDefault(u.dept||'cs'));
        $('#editHint').textContent=`'${u.loginId}' 수정 중`; $('#fName').focus(); }
      renderPerms(deptDefault('cs'));

      $('#saveUser').onclick=async()=>{
        const user={ loginId:$('#fId').value.trim(), name:$('#fName').value.trim(), dept:$('#fDept').value,
          email:$('#fEmail').value.trim(), code:$('#fCode').value.trim(), perms:collectPerms() };
        if(!user.loginId||!user.code){ $('#admStat').innerHTML='<span style="color:var(--danger)">아이디와 접속코드는 필수입니다.</span>'; return; }
        $('#admStat').textContent='저장 중…';
        try{ await authApi('saveUser',{user}); $('#admStat').innerHTML='<span style="color:var(--ok)">저장되었습니다.</span>'; resetForm(); load(); }
        catch(err){ $('#admStat').innerHTML=`<span style="color:var(--danger)">${esc(err.message)}</span>`; }
      };
      $('#reload').onclick=load;

      async function load(){
        const t=$('#uTable');
        t.innerHTML=`<thead><tr><th>아이디</th><th>이름</th><th>부서</th><th>업무 이메일</th><th>접속코드</th><th style="width:120px"></th></tr></thead>
          <tbody><tr><td colspan="6" class="muted" style="text-align:center;padding:16px">불러오는 중…</td></tr></tbody>`;
        try{
          const d=await authApi('listUsers');
          const users=(d.users||[]).sort((a,b)=>(a.dept||'').localeCompare(b.dept||'')||a.loginId.localeCompare(b.loginId));
          $('#uCnt').textContent=`· ${users.length}명`;
          const tb=t.querySelector('tbody'); tb.innerHTML='';
          if(!users.length){ tb.innerHTML=`<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">발급된 계정이 없습니다. 위에서 발급하세요.</td></tr>`; return; }
          users.forEach(u=>{ const tr=el('tr');
            tr.innerHTML=`<td class="mono"><b>${esc(u.loginId)}</b></td><td>${esc(u.name||'-')}</td>
              <td><span class="dept-badge ${esc(u.dept||'')}">${esc(deptLabel(u.dept))}</span></td>
              <td class="muted">${esc(u.email||'-')}</td>
              <td class="code-cell">${esc(u.code||'-')}</td>
              <td><span style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn ghost sm" data-a="edit">수정</button>
                <button class="btn ghost sm" data-a="del">${icon('trash')}</button></span></td>`;
            tr.querySelector('[data-a=edit]').onclick=()=>{ fillForm(u); root.querySelector('.mbody').scrollIntoView({behavior:'smooth',block:'start'}); };
            tr.querySelector('[data-a=del]').onclick=async()=>{ if(!confirm(`'${u.loginId}' 계정을 삭제할까요?`)) return;
              try{ await authApi('deleteUser',{loginId:u.loginId}); load(); }catch(err){ toast(err.message); } };
            tb.appendChild(tr);
          });
        }catch(err){
          t.querySelector('tbody').innerHTML=`<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--danger)">${esc(err.message)}</td></tr>`;
        }
      }
      load();
    }
  };
})();
