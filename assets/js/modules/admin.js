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
        .lead-badge{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:5px;
          background:#efe9ff;color:#5b3fc4;margin-left:6px;letter-spacing:.02em}
        .off-badge{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:5px;background:var(--line-2);color:var(--muted);margin-left:6px}
        tr.inactive td{opacity:.5}
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
              <label class="fld">역할<select id="fRole"><option value="member">팀원</option><option value="lead">파트장</option></select></label>
              <label class="fld">업무 이메일<input type="text" id="fEmail" placeholder="kim@robodyne.co.kr"></label>
              <label class="fld">접속코드
                <span style="display:flex;gap:6px"><input type="text" id="fCode" placeholder="접속코드" style="flex:1">
                  <button type="button" class="btn sm" id="genCode" title="랜덤 생성">${icon('refresh')}</button></span></label>
            </div>
            <label class="chk" style="margin-top:14px"><input type="checkbox" id="fActive" checked> <b>활성 계정</b> <span class="muted" style="font-weight:500">· 끄면 로그인 차단(퇴사·휴직 시) · 상담/발주 기록은 보존됩니다</span></label>
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
      let editing=null, usersCache=[];
      const roleLabel=r=>r==='lead'?'파트장':'팀원';
      function renderPerms(sel){ const box=$('#permPick'); const S=new Set(sel||[]);
        box.innerHTML=FEATURES.map(g=>`<div class="perm-grp"><div class="perm-gl ${g.dept}">${esc(g.name)}</div>
          <div class="perm-items">${g.items.map(it=>`<label class="perm-chk"><input type="checkbox" data-perm="${it.key}" ${S.has(it.key)?'checked':''}> ${esc(it.name)}</label>`).join('')}</div></div>`).join(''); }
      const collectPerms=()=>[...$('#permPick').querySelectorAll('[data-perm]:checked')].map(c=>c.dataset.perm);
      $('#genCode').onclick=()=>{ $('#fCode').value=randCode(); };
      $('#fDept').onchange=()=>{ const cur=new Set(collectPerms()); deptDefault($('#fDept').value).forEach(k=>cur.add(k)); renderPerms([...cur]); };
      function resetForm(){ editing=null; ['fId','fName','fEmail','fCode'].forEach(i=>$('#'+i).value=''); $('#fDept').value='cs'; $('#fRole').value='member'; $('#fActive').checked=true;
        renderPerms(deptDefault('cs')); $('#fId').disabled=false; $('#editHint').textContent=''; $('#fId').focus(); }
      function fillForm(u){ editing=u.loginId; $('#fId').value=u.loginId; $('#fId').disabled=true; $('#fName').value=u.name||'';
        $('#fDept').value=u.dept||'cs'; $('#fRole').value=u.role==='lead'?'lead':'member'; $('#fActive').checked=u.active!==false; $('#fEmail').value=u.email||''; $('#fCode').value=u.code||'';
        renderPerms(Array.isArray(u.perms)&&u.perms.length?u.perms:deptDefault(u.dept||'cs'));
        $('#editHint').textContent=`'${u.loginId}' 수정 중`; $('#fName').focus(); }
      renderPerms(deptDefault('cs'));

      $('#saveUser').onclick=async()=>{
        const user={ loginId:$('#fId').value.trim(), name:$('#fName').value.trim(), dept:$('#fDept').value, role:$('#fRole').value,
          email:$('#fEmail').value.trim(), code:$('#fCode').value.trim(), active:$('#fActive').checked, perms:collectPerms() };
        if(!user.loginId||!user.code){ $('#admStat').innerHTML='<span style="color:var(--danger)">아이디와 접속코드는 필수입니다.</span>'; return; }
        // 파트장은 직무별 1명 제한
        if(user.role==='lead'){ const other=usersCache.find(x=>x.dept===user.dept && x.role==='lead' && x.loginId!==user.loginId);
          if(other){ $('#admStat').innerHTML=`<span style="color:var(--danger)">이미 ${esc(deptLabel(user.dept))} 파트장(${esc(other.name||other.loginId)})이 있습니다. 기존 파트장을 팀원으로 바꾼 뒤 지정하세요.</span>`; return; } }
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
          const rank=u=>u.role==='lead'?0:1;
          const users=(d.users||[]).sort((a,b)=>(a.dept||'').localeCompare(b.dept||'')||rank(a)-rank(b)||a.loginId.localeCompare(b.loginId));
          usersCache=users;
          $('#uCnt').textContent=`· ${users.length}명`;
          const tb=t.querySelector('tbody'); tb.innerHTML='';
          if(!users.length){ tb.innerHTML=`<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">발급된 계정이 없습니다. 위에서 발급하세요.</td></tr>`; return; }
          users.forEach(u=>{ const tr=el('tr'); if(u.active===false) tr.className='inactive';
            tr.innerHTML=`<td class="mono"><b>${esc(u.loginId)}</b></td><td>${esc(u.name||'-')}${u.role==='lead'?'<span class="lead-badge">파트장</span>':''}${u.active===false?'<span class="off-badge">비활성</span>':''}</td>
              <td><span class="dept-badge ${esc(u.dept||'')}">${esc(deptLabel(u.dept))}</span></td>
              <td class="muted">${esc(u.email||'-')}</td>
              <td class="code-cell">${esc(u.code||'-')}</td>
              <td><span style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn ghost sm" data-a="toggle">${u.active===false?'활성화':'비활성화'}</button>
                <button class="btn ghost sm" data-a="edit">수정</button>
                <button class="btn ghost sm" data-a="del">${icon('trash')}</button></span></td>`;
            tr.querySelector('[data-a=edit]').onclick=()=>{ fillForm(u); root.querySelector('.mbody').scrollIntoView({behavior:'smooth',block:'start'}); };
            tr.querySelector('[data-a=toggle]').onclick=async()=>{ const on=u.active===false;
              if(!confirm(`'${u.name||u.loginId}' 계정을 ${on?'활성화':'비활성화'}할까요?${on?'':' (로그인이 차단됩니다)'}`)) return;
              try{ await authApi('saveUser',{user:{...u, active:on}}); load(); toast(on?'활성화했습니다':'비활성화했습니다'); }catch(err){ toast(err.message); } };
            tr.querySelector('[data-a=del]').onclick=async()=>{ if(!confirm(`'${u.loginId}' 계정을 삭제할까요? (비활성화로 두면 기록·이력이 보존됩니다)`)) return;
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

  /* =========================================================================
     관리자 · 공유 범위 (팀장 전용)
     - 설정마다 "누가 공유받는가"(전사/CS/MD)를 지정
     - 저장 시 규칙(shareMap)을 공용 저장소에 올리고, 설정을 새 범위 버킷으로 재배치
     ========================================================================= */
  MODULES['admin.share']={
    title:'공유 범위', icon:'share',
    render(root){
      if(!Auth.isAdmin()){
        root.innerHTML=`<div class="view"><div class="empty">${icon('shield')}<div style="font-size:14px">관리자(팀장)만 접근할 수 있는 화면입니다.</div></div></div>`;
        return;
      }
      const SC=(typeof SHARE_SCOPES!=='undefined')?SHARE_SCOPES:[{id:'all',label:'전사'},{id:'cs',label:'CS'},{id:'md',label:'MD'}];
      // shareMap(범위 규칙 자체)은 항상 전사 → 목록에서 제외
      const ITEMS=SHARED_SETTING_KEYS.filter(k=>k!==STORE.shareMap);
      const scopeOf=k=>(typeof shareScopeOf==='function')?shareScopeOf(k):'all';

      root.innerHTML=`
      <style>
        .sh-tbl td,.sh-tbl th{vertical-align:middle}
        .sh-tbl td.nm{font-weight:600;color:var(--ink)}
        .sh-seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
        .sh-seg button{border:0;background:var(--panel);padding:7px 15px;font-size:13px;font-weight:700;
          color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
        .sh-seg button:first-child{border-left:0}
        .sh-seg button.on{background:var(--active-bg);color:var(--red)}
        .sh-note{font-size:12.5px;color:var(--muted)}
      </style>
      <div class="mhead pad">
        <div class="tt">공유 범위 설정</div>
        <div class="ds">각 설정을 <b>누가 공유받을지</b> 정합니다. 전사는 모두, CS·MD는 해당 부서 팀원끼리만 동기화됩니다.</div>
      </div>
      <div class="mbody">
        <div class="card">
          <div class="card-hd">${icon('share')}<b>설정별 공유 범위</b>
            <span class="muted" id="shStat" style="margin-left:auto;font-size:12.5px"></span></div>
          <div class="card-bd" style="padding:0">
            <table class="tbl sh-tbl"><thead><tr>
              <th style="width:42%">설정 항목</th><th>공유 범위</th></tr></thead>
              <tbody id="shBody"></tbody></table>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:16px">
          <button class="btn pri" id="shSave">${icon('check')}저장하고 재동기화</button>
          <button class="btn ghost" id="shReset">기본값으로</button>
          <span class="sh-note" id="shHint"></span>
        </div>
        <p class="sh-note" style="margin-top:14px">※ 저장하면 규칙이 전 기기에 반영되고, 각 설정이 새 범위로 즉시 재배치됩니다. 다른 부서 기기에는 다음 접속 시 정리됩니다.</p>
      </div>`;

      const $=s=>root.querySelector(s);
      const draft={};   // 편집 중인 범위 (key→scope)
      ITEMS.forEach(k=>{ draft[k]=scopeOf(k); });

      function paint(){
        $('#shBody').innerHTML=ITEMS.map(k=>{
          const label=(typeof SHARED_LABELS!=='undefined'&&SHARED_LABELS[k])||k;
          const seg=SC.map(s=>`<button data-k="${esc(k)}" data-s="${s.id}" class="${draft[k]===s.id?'on':''}">${esc(s.label)}</button>`).join('');
          return `<tr><td class="nm">${esc(label)}</td><td><span class="sh-seg">${seg}</span></td></tr>`;
        }).join('');
        $('#shBody').querySelectorAll('.sh-seg button').forEach(b=>{
          b.onclick=()=>{ draft[b.dataset.k]=b.dataset.s; paint(); };
        });
      }
      paint();

      $('#shReset').onclick=()=>{ ITEMS.forEach(k=>{ draft[k]=(typeof SHARE_DEFAULT!=='undefined'&&SHARE_DEFAULT[k])||'all'; }); paint(); $('#shHint').textContent='기본값으로 되돌렸습니다. [저장]을 눌러 적용하세요.'; };

      $('#shSave').onclick=async()=>{
        // 기본값과 다른 항목만 오버라이드로 저장 (간결하게 유지)
        const ov={};
        ITEMS.forEach(k=>{ const def=(typeof SHARE_DEFAULT!=='undefined'&&SHARE_DEFAULT[k])||'all'; if(draft[k]&&draft[k]!==def) ov[k]=draft[k]; });
        store(STORE.shareMap).set(ov);        // shareMap 자체는 전사 공유(자동 업로드 트리거)
        $('#shStat').textContent='재동기화 중…';
        try{
          if(window.SyncStore && SyncStore.configured()){ await SyncStore.pushSettings(); }
          $('#shStat').innerHTML='<span style="color:var(--ok)">저장·재배치 완료</span>';
          $('#shHint').textContent='';
        }catch(err){
          $('#shStat').innerHTML=`<span style="color:var(--danger)">${esc(err.message||'오류')}</span>`;
        }
      };
    }
  };

  /* =========================================================================
     관리자 · 감사 로그 (팀장 전용) — 계정/기록 변경 이력
     ========================================================================= */
  MODULES['admin.audit']={
    title:'감사 로그', icon:'clipboard',
    render(root){
      if(!Auth.isAdmin()){
        root.innerHTML=`<div class="view"><div class="empty">${icon('shield')}<div style="font-size:14px">관리자(팀장)만 접근할 수 있는 화면입니다.</div></div></div>`;
        return;
      }
      root.innerHTML=`
        <div class="mhead pad"><div class="tt">감사 로그</div>
          <div class="ds">계정 발급·수정·삭제와 상담/발주 기록 삭제 이력을 최근 순으로 보여줍니다. 내부 통제용(최근 500건 보관).</div></div>
        <div class="mbody"><div class="card">
          <div class="card-hd">${icon('clipboard')}<b>최근 활동</b><span class="muted" id="auCnt" style="margin-left:auto;font-size:12.5px"></span>
            <button class="btn sm" id="auReload" style="margin-left:10px">${icon('refresh')}새로고침</button></div>
          <div class="card-bd" style="padding:0"><div style="overflow:auto"><table class="tbl" id="auTable"></table></div></div>
        </div></div>`;
      const $=s=>root.querySelector(s);
      const ACT={ 'account.create':['계정 생성','var(--ok)'], 'account.update':['계정 수정','var(--info)'],
        'account.delete':['계정 삭제','var(--danger)'], 'record.delete':['기록 삭제','var(--danger)'] };
      const fmt=iso=>{ try{ return new Date(iso).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch{ return iso||''; } };
      async function load(){
        const t=$('#auTable');
        t.innerHTML=`<thead><tr><th style="width:132px">시각</th><th style="width:96px">작업</th><th>대상 / 상세</th><th style="width:110px">실행자</th></tr></thead><tbody><tr><td colspan="4" class="muted" style="text-align:center;padding:16px">불러오는 중…</td></tr></tbody>`;
        try{
          const d=await authApi('auditLog',{limit:200}); const es=d.entries||[]; $('#auCnt').textContent=`· ${es.length}건`;
          const tb=t.querySelector('tbody');
          if(!es.length){ tb.innerHTML=`<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">기록된 활동이 없습니다.</td></tr>`; return; }
          tb.innerHTML=es.map(e=>{ const a=ACT[e.action]||[e.action,'var(--muted)'];
            return `<tr><td class="mono" style="white-space:nowrap">${esc(fmt(e.at))}</td>
              <td><span style="font-weight:800;color:${a[1]}">${esc(a[0])}</span></td>
              <td><b>${esc(e.target||'')}</b>${e.detail?` <span class="muted">· ${esc(e.detail)}</span>`:''}</td>
              <td>${esc(e.actor||'-')}</td></tr>`; }).join('');
        }catch(err){ t.querySelector('tbody').innerHTML=`<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--danger)">${esc(err.message)}</td></tr>`; }
      }
      $('#auReload').onclick=load; load();
    }
  };
})();
