/* ===========================================================================
   홈 · 공통 (대시보드 · 공지사항 · 업무 메모)
   - 팀 공유 데이터는 서버리스 /api/store 의 공용 컬렉션(notice·memo)에 저장
   - 같은 도메인이라 별도 설정 없이 배포 환경에서 바로 동작
   =========================================================================== */
(function(){
  const meU = ()=> (typeof Auth!=='undefined' && Auth.user && Auth.user()) || {};
  async function apiGet(qs){ const r=await fetch('/api/store?'+qs); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
  async function apiPost(body){ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
  const collGet = async coll=>{ try{ const d=await apiGet('type=coll&coll='+encodeURIComponent(coll)); return (d&&d.items)||[]; }catch{ return null; } };
  const collPush = (coll,item)=>apiPost({op:'collPush',coll,item});
  const collDel  = (coll,id)=>apiPost({op:'collDel',coll,id});
  async function rosterList(){ try{ const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'roster'})}); const d=await r.json(); return (d&&d.roster)||[]; }catch{ return []; } }

  const DEPT_LABEL={ all:'전체', cs:'CS', md:'MD' };
  const targetLabel=(t,roster)=> DEPT_LABEL[t] || (roster&&(roster.find(r=>r.loginId===t)||{}).name) || t;
  const visibleTo=(target,u)=> target==='all' || target===u.dept || target===u.loginId;
  const dateShort=iso=>{ const d=new Date(iso); const t=todayStr(); const ds=todayStr(iso);
    return ds===t ? timeHM(iso) : `${d.getMonth()+1}/${d.getDate()}`; };
  const empty=(t,ic)=>`<div class="empty">${icon(ic||'info')}<div style="font-size:13.5px">${esc(t)}</div></div>`;

  /* ============================ 공지사항 ============================ */
  MODULES['home.notice']={
    title:'공지사항', icon:'megaphone',
    render(root){
      const u=meU(), isAdmin=(typeof Auth!=='undefined'&&Auth.isAdmin&&Auth.isAdmin());
      root.innerHTML=`
      <style>
        .nt-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:15px 18px;margin-bottom:11px;box-shadow:var(--sh-sm);position:relative;transition:opacity .15s,background .15s}
        .nt-card.unread{border-left:3px solid var(--red)}
        /* 완료 처리 — 색을 살짝 연하게(마감된 업무 시각적 구분) */
        .nt-card.done{background:var(--panel-2);opacity:.68;border-left:3px solid var(--ok)}
        .nt-card.done .nt-title{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--faint)}
        .nt-card.done .nt-body{color:var(--muted)}
        .nt-top{display:flex;align-items:center;gap:9px;margin-bottom:7px}
        .nt-title{font-size:15.5px;font-weight:800}
        .nt-new{font-size:10.5px;font-weight:800;color:#fff;background:var(--red);border-radius:5px;padding:2px 6px}
        .nt-done{font-size:10.5px;font-weight:800;color:#fff;background:var(--ok);border-radius:5px;padding:2px 7px;display:inline-flex;align-items:center;gap:3px}
        .nt-donemeta{font-weight:700;color:var(--ok)}
        /* 상단 고정(필독) */
        .nt-card.pinned{border-left:3px solid var(--warn);background:linear-gradient(90deg,color-mix(in srgb,var(--warn) 7%,var(--panel)),var(--panel) 60%)}
        .nt-pin{font-size:10.5px;font-weight:800;color:#fff;background:var(--warn);border-radius:5px;padding:2px 7px;display:inline-flex;align-items:center;gap:3px}
        .nt-pin svg{width:11px;height:11px}
        .nt-done svg,.nt-new+.nt-title{vertical-align:middle}
        [data-pin],[data-del]{flex:none}
        .nt-body{font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;color:var(--ink-2)}
        .nt-meta{font-size:12px;color:var(--muted);margin-top:9px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .nt-tgt{font-weight:700;color:var(--ink-2);background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:1px 7px}
        .compose{border:1px solid var(--line);border-radius:13px;background:var(--panel-2);padding:16px 18px;margin-bottom:20px}
        .compose .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">공지사항</div><div class="ds">관리자가 올린 공지입니다. <b>[확인]</b>을 눌러야 읽음 처리되고 알림에서 사라집니다.</div></div></div></div>
      <div class="mbody" id="ntBody"></div>`;
      const body=root.querySelector('#ntBody'); let roster=[];
      async function load(){
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        const raw=await collGet('notice');
        body.innerHTML='';
        if(isAdmin) body.appendChild(composer());
        if(raw===null){ body.insertAdjacentHTML('beforeend', empty('공용 저장소에 연결되지 않았습니다. (배포 환경에서 표시됩니다)','alert')); return; }
        const list=raw.filter(n=>visibleTo(n.dept||'all',u)).sort((a,b)=>
          (b.pinned?1:0)-(a.pinned?1:0) || String(b.createdAt).localeCompare(String(a.createdAt)));   // 고정 공지 최상단
        if(!list.length){ body.insertAdjacentHTML('beforeend', empty('아직 등록된 공지가 없습니다.','megaphone')); return; }
        list.forEach(n=>body.appendChild(card(n)));
      }
      function card(n){
        const unread=!(n.readBy||[]).includes(u.loginId);
        const done=!!n.done, pinned=!!n.pinned;
        const c=el('div','nt-card'+(unread&&!done?' unread':'')+(done?' done':'')+(pinned&&!done?' pinned':''));
        c.innerHTML=`<div class="nt-top">${pinned&&!done?'<span class="nt-pin">'+icon('pin')+'필독</span>':''}${done?'<span class="nt-done">'+icon('check')+'완료</span>':(unread?'<span class="nt-new">미확인</span>':'')}<span class="nt-title">${esc(n.title||'(제목 없음)')}</span>
            ${isAdmin?'<button class="btn ghost sm" data-pin title="'+(pinned?'고정 해제':'상단 고정(필독)')+'" style="margin-left:auto">'+(pinned?'📌':icon('pin'))+'</button><button class="btn ghost sm" data-del>'+icon('trash')+'</button>':''}</div>
          <div class="nt-body">${esc(n.body||'')}</div>
          <div class="nt-meta"><span class="nt-tgt">${esc(targetLabel(n.dept||'all',roster))}</span>
            <span>${esc(n.authorName||'관리자')}</span><span>·</span><span>${esc(dateShort(n.createdAt))}</span>
            ${done?`<span class="nt-donemeta">완료 · ${esc(dateShort(n.doneAt))}</span>`:''}
            <span style="margin-left:auto">읽음 ${ (n.readBy||[]).length }</span>
            ${isAdmin?`<button class="btn ${done?'ghost':'ok'} sm" data-done>${done?'완료 취소':icon('check')+'완료 처리'}</button>`:''}
            ${unread?`<button class="btn pri sm" data-read>${icon('check')}확인</button>`:(!done?'<span style="color:var(--ok);font-weight:700;font-size:12px">✓ 확인함</span>':'')}</div>`;
        const db=c.querySelector('[data-del]'); if(db) db.onclick=async()=>{ if(confirm('이 공지를 삭제할까요?')){ await collDel('notice',n.id); load(); } };
        const rb=c.querySelector('[data-read]'); if(rb) rb.onclick=async(e)=>{ e.currentTarget.disabled=true; await markRead([n]); load();
          if(window.refreshNavBadges) window.refreshNavBadges(); };
        const dn=c.querySelector('[data-done]'); if(dn) dn.onclick=async(e)=>{ e.currentTarget.disabled=true; await markDone(n,!done); load(); };
        const pn=c.querySelector('[data-pin]'); if(pn) pn.onclick=async(e)=>{ e.currentTarget.disabled=true; await markPin(n,!pinned); load(); };
        return c;
      }
      async function markDone(n, done){
        n.done=done; n.doneAt=done?nowISO():''; n.doneBy=done?u.loginId:'';
        try{ await collPush('notice', n); }catch{}
        toast(done?'업무 완료로 표시했습니다':'완료 표시를 해제했습니다');
      }
      async function markPin(n, pinned){
        n.pinned=pinned; try{ await collPush('notice', n); }catch{}
        toast(pinned?'상단에 고정했습니다 (필독)':'고정을 해제했습니다');
      }
      function composer(){
        const box=el('div','compose');
        box.innerHTML=`<div style="font-weight:800;font-size:14px;margin-bottom:4px">${icon('megaphone')} 공지 작성</div>
          <input type="text" id="ntTitle" placeholder="제목" style="width:100%;margin-top:8px">
          <textarea id="ntBodyIn" rows="3" placeholder="공지 내용" style="width:100%;margin-top:10px"></textarea>
          <div class="row">
            <label class="fld" style="margin:0">대상<select id="ntTgt">${Object.entries(DEPT_LABEL).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
            <button class="btn pri" id="ntPost" style="margin-left:auto">${icon('send')}게시</button>
            <span class="muted" id="ntStat" style="font-size:12.5px"></span></div>`;
        box.querySelector('#ntPost').onclick=async()=>{
          const title=box.querySelector('#ntTitle').value.trim(), b=box.querySelector('#ntBodyIn').value.trim();
          if(!title&&!b){ box.querySelector('#ntStat').textContent='내용을 입력하세요'; return; }
          box.querySelector('#ntStat').textContent='게시 중…';
          await collPush('notice',{ id:uuid(), title, body:b, dept:box.querySelector('#ntTgt').value,
            author:u.loginId, authorName:u.name, createdAt:nowISO(), readBy:[u.loginId] });
          toast('공지를 게시했습니다'); load();
        };
        return box;
      }
      async function markRead(unread){
        for(const n of unread){ n.readBy=[...(n.readBy||[]), u.loginId]; try{ await collPush('notice', n); }catch{} }
      }
      rosterList().then(r=>{ roster=r; }); load();
    }
  };

  /* ============================ 알림 센터 ============================ */
  MODULES['home.alerts']={
    title:'알림', icon:'bell',
    render(root){
      const u=meU(), isAdmin=(typeof Auth!=='undefined'&&Auth.isAdmin&&Auth.isAdmin());
      root.innerHTML=`
      <style>
        .al-sec{font-size:12px;font-weight:800;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin:4px 2px 11px}
        .al-card{border:1px solid var(--line);border-left:3px solid var(--red);border-radius:11px;background:var(--panel);padding:13px 16px;margin-bottom:10px;box-shadow:var(--sh-sm)}
        .al-title{font-size:14.5px;font-weight:800}
        .al-body{font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--ink-2);margin-top:5px}
        .al-meta{font-size:12px;color:var(--muted);margin-top:9px;display:flex;gap:9px;align-items:center}
        .al-link{display:flex;align-items:center;gap:11px;border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:12px 16px;margin-bottom:10px;cursor:pointer;box-shadow:var(--sh-sm);transition:.12s}
        .al-link:hover{border-color:var(--red);transform:translateY(-1px)}
        .al-ic{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--red-soft);color:var(--red)}
        .al-none{padding:44px;text-align:center;color:var(--muted)}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">알림</div><div class="ds">확인이 필요한 공지·업무를 모아 보여줍니다. 공지는 <b>[확인]</b>을 눌러야 사라집니다.</div></div>
        <div class="mhead-act"><button class="btn" id="alAllRead">${icon('check')}공지 모두 확인</button></div></div></div>
      <div class="mbody" id="alBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#alBody'); let unreadCache=[];
      async function markRead(list){ for(const n of list){ n.readBy=[...(n.readBy||[]),u.loginId]; try{ await collPush('notice',n); }catch{} } }
      async function load(){
        const [notices,memos,cbs]=await Promise.all([collGet('notice'),collGet('memo'),collGet('callbacks')]);
        if(!root.isConnected||!root.querySelector('#alBody')) return;
        const unread=(notices||[]).filter(n=>visibleTo(n.dept||'all',u) && !(n.readBy||[]).includes(u.loginId))
          .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
        unreadCache=unread;
        const myMemo=(memos||[]).filter(m=>!m.done && visibleTo(m.to||'all',u) && m.author!==u.loginId).length;
        const openCb=(isAdmin||u.dept==='cs')?(cbs||[]).filter(c=>!c.done).length:0;
        let html=`<div class="al-sec">미확인 공지 · ${unread.length}건</div>`;
        html+= unread.length
          ? unread.map(n=>`<div class="al-card"><div class="al-title">${esc(n.title||'(제목 없음)')}</div>
              <div class="al-body">${esc((n.body||'').slice(0,240))}${(n.body||'').length>240?'…':''}</div>
              <div class="al-meta"><span>${esc(n.authorName||'관리자')}</span><span>·</span><span>${esc(dateShort(n.createdAt))}</span>
                <button class="btn pri sm" data-read="${esc(n.id)}" style="margin-left:auto">${icon('check')}확인</button></div></div>`).join('')
          : `<div class="al-none">${icon('check')}<div style="margin-top:6px;font-size:14px">확인할 공지가 없습니다.</div></div>`;
        if(myMemo||openCb){ html+=`<div class="al-sec" style="margin-top:20px">확인 필요</div>`;
          if(openCb) html+=`<div class="al-link" data-go="cs.notes"><div class="al-ic">${icon('clipboard')}</div><div><b>미처리 콜백 ${openCb}건</b><div class="muted" style="font-size:12px">처리 대기 탭에서 확인하세요</div></div></div>`;
          if(myMemo) html+=`<div class="al-link" data-go="home.memo"><div class="al-ic">${icon('send')}</div><div><b>나에게 온 업무 메모 ${myMemo}건</b><div class="muted" style="font-size:12px">업무 메모에서 확인하세요</div></div></div>`;
        }
        body.innerHTML=html;
        body.querySelectorAll('[data-read]').forEach(btn=>btn.onclick=async()=>{ btn.disabled=true; const n=unread.find(x=>x.id===btn.dataset.read);
          if(n) await markRead([n]); load(); if(window.refreshNavBadges) window.refreshNavBadges(); });
        body.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>location.hash=x.dataset.go);
      }
      root.querySelector('#alAllRead').onclick=async(e)=>{ if(!unreadCache.length){ toast('확인할 공지가 없습니다'); return; }
        e.currentTarget.disabled=true; await markRead(unreadCache); toast('모든 공지를 확인했습니다'); load(); if(window.refreshNavBadges) window.refreshNavBadges(); };
      load();
    }
  };

  /* ============================ 업무 메모 ============================ */
  MODULES['home.memo']={
    title:'업무 메모', icon:'send',
    render(root){
      const u=meU();
      root.innerHTML=`
      <style>
        .mm-card{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:13px 16px;margin-bottom:10px;box-shadow:var(--sh-sm)}
        .mm-card.done{opacity:.6;background:var(--panel-2)}
        .mm-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
        .mm-to{font-size:11.5px;font-weight:800;color:#5b3fc4;background:#eae4ff;border-radius:5px;padding:2px 8px}
        .mm-body{font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
        .mm-meta{font-size:12px;color:var(--muted);margin-top:8px;display:flex;gap:9px;align-items:center}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">업무 메모</div><div class="ds">직원·부서에게 메모를 남깁니다. (교대 인수인계·재통화 요청 등) 처리하면 완료로 내려집니다.</div></div></div></div>
      <div class="mbody" id="mmBody"></div>`;
      const body=root.querySelector('#mmBody'); let roster=[];
      async function load(){
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        const raw=await collGet('memo');
        body.innerHTML=''; body.appendChild(composer());
        if(raw===null){ body.insertAdjacentHTML('beforeend', empty('공용 저장소에 연결되지 않았습니다. (배포 환경에서 표시됩니다)','alert')); return; }
        // 나에게 보이는 것 + 내가 쓴 것
        const list=raw.filter(m=>visibleTo(m.to||'all',u) || m.author===u.loginId)
          .sort((a,b)=>(a.done?1:0)-(b.done?1:0) || String(b.createdAt).localeCompare(String(a.createdAt)));
        if(!list.length){ body.insertAdjacentHTML('beforeend', empty('메모가 없습니다.','send')); return; }
        list.forEach(m=>body.appendChild(card(m)));
      }
      function card(m){
        const mine=m.author===u.loginId, c=el('div','mm-card'+(m.done?' done':''));
        c.innerHTML=`<div class="mm-top"><span class="mm-to">→ ${esc(targetLabel(m.to||'all',roster))}</span>
            <span class="muted" style="font-size:12px">${esc(m.authorName||m.author||'')}</span>
            ${m.done?'<span class="badge synced" style="background:var(--ok-bg);color:var(--ok)">완료</span>':''}
            <span style="margin-left:auto;display:flex;gap:4px">
              <button class="btn ghost sm" data-a="toggle">${m.done?'되돌리기':'완료'}</button>
              ${mine?'<button class="btn ghost sm" data-a="del">'+icon('trash')+'</button>':''}</span></div>
          <div class="mm-body">${esc(m.body||'')}</div>
          <div class="mm-meta">${esc(dateShort(m.createdAt))}</div>`;
        c.querySelector('[data-a=toggle]').onclick=async()=>{ m.done=!m.done; m.doneBy=m.done?u.loginId:null; await collPush('memo',m); load(); };
        const db=c.querySelector('[data-a=del]'); if(db) db.onclick=async()=>{ if(confirm('이 메모를 삭제할까요?')){ await collDel('memo',m.id); load(); } };
        return c;
      }
      function composer(){
        const box=el('div','compose');
        const people=roster.filter(r=>r.loginId!==u.loginId);
        box.innerHTML=`<div style="font-weight:800;font-size:14px;margin-bottom:4px">${icon('send')} 메모 남기기</div>
          <textarea id="mmIn" rows="2" placeholder="메모 내용 (예: 홍길동님 재통화 요청 · 오후 배송 마감 확인)" style="width:100%;margin-top:8px"></textarea>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">
            <label class="fld" style="margin:0">받는 대상<select id="mmTo">
              <option value="all">전체</option><option value="cs">CS</option><option value="md">MD</option>
              ${people.length?'<optgroup label="직원">'+people.map(p=>`<option value="${esc(p.loginId)}">${esc(p.name)} (${DEPT_LABEL[p.dept]||p.dept||'-'})</option>`).join('')+'</optgroup>':''}
            </select></label>
            <button class="btn pri" id="mmPost" style="margin-left:auto">${icon('send')}남기기</button>
            <span class="muted" id="mmStat" style="font-size:12.5px"></span></div>`;
        box.querySelector('#mmPost').onclick=async()=>{
          const b=box.querySelector('#mmIn').value.trim(); if(!b){ box.querySelector('#mmStat').textContent='내용을 입력하세요'; return; }
          box.querySelector('#mmStat').textContent='남기는 중…';
          await collPush('memo',{ id:uuid(), to:box.querySelector('#mmTo').value, body:b, author:u.loginId, authorName:u.name, createdAt:nowISO(), done:false });
          toast('메모를 남겼습니다'); load();
        };
        return box;
      }
      rosterList().then(r=>{ roster=r; load(); });
    }
  };

  /* ============================ 홈 대시보드 ============================ */
  MODULES['home.dash']={
    title:'홈', icon:'dashboard',
    render(root){
      const u=meU();
      const greeting=()=>{ const h=new Date().getHours(); return h<11?'좋은 아침이에요':h<14?'점심 맛있게 드세요':h<18?'좋은 오후예요':'오늘도 수고 많으셨어요'; };
      const weekday=()=>['일','월','화','수','목','금','토'][new Date().getDay()]+'요일';
      const localNotes=()=>{ try{ return JSON.parse(localStorage.getItem(STORE.csNotes)||'[]'); }catch{ return []; } };
      root.innerHTML=`
      <style>
        .dash-2{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:start;margin-top:16px}
        @media(max-width:900px){.dash-2{grid-template-columns:1fr}}
        .dcard{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);overflow:hidden;box-shadow:var(--sh-sm)}
        .dcard-hd{display:flex;align-items:center;gap:8px;padding:11px 15px;border-bottom:1px solid var(--line);
          font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:var(--panel-2)}
        .dcard-hd .ic{font-size:14px;color:var(--faint)}
        .dcard-hd .more{margin-left:auto;font-size:11.5px;font-weight:700;color:var(--muted);cursor:pointer;text-transform:none;letter-spacing:0}
        .dcard-hd .more:hover{color:var(--red)}
        .dcard-bd{padding:7px 8px}
        .drow{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:7px;font-size:13.5px}
        .drow:hover{background:var(--hover);cursor:pointer}
        .drow .dt{font-weight:600;color:var(--ink)}
        .drow .dm{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}
        .drow .pin{width:7px;height:7px;border-radius:50%;background:var(--danger);flex:none}
        /* 개인 할 일(To-Do) */
        .todo-row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:7px;font-size:13.5px}
        .todo-row:hover{background:var(--hover)}
        .todo-row:hover .todo-x{opacity:1}
        .todo-ck{width:19px;height:19px;flex:none;border:1.5px solid var(--line-strong);border-radius:6px;background:var(--panel);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#fff}
        .todo-ck svg{width:13px;height:13px}
        .todo-row.done .todo-ck{background:var(--ok);border-color:var(--ok)}
        .todo-tx{flex:1;color:var(--ink);word-break:break-word;line-height:1.4}
        .todo-row.done .todo-tx{color:var(--faint);text-decoration:line-through}
        .todo-x{flex:none;border:0;background:none;color:var(--faint);cursor:pointer;opacity:0;transition:opacity .12s;padding:3px;border-radius:5px}
        .todo-x:hover{color:var(--danger);background:var(--danger-soft)} .todo-x svg{width:14px;height:14px}
        .todo-add{display:flex;gap:7px;padding:8px;border-top:1px solid var(--line);margin-top:4px}
        .todo-add input{flex:1;height:34px;font-size:13.5px}
        .ql-row{display:flex;gap:8px;flex-wrap:wrap;padding:5px 8px 10px}
        .ql-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border:1px solid var(--line-strong);border-radius:8px;
          font-size:13px;font-weight:600;color:var(--ink-2);text-decoration:none;background:var(--panel)}
        .ql-chip:hover{border-color:var(--red);color:var(--red);background:var(--red-soft)}
        .ql-chip .ic{color:var(--faint)}.ql-chip:hover .ic{color:var(--red)}
        .pp-dot2{width:8px;height:8px;border-radius:50%;background:#42c98a;box-shadow:0 0 0 3px rgba(66,201,138,.18);flex:none}
      </style>
      <div class="mbody">
        <div class="console">
          <div>
            <div class="hi">${greeting()}, ${esc(u.name||'')}님</div>
            <div class="sub">${esc({cs:'CS · 고객 상담',md:'MD · 상품 기획',admin:'관리자'}[u.dept]||'통합 업무관리')} · 통합 업무관리 콘솔</div>
          </div>
          <div class="c-right">
            <div class="c-metric"><small>오늘</small><b class="mono">${todayStr()} <span style="color:#818da0">(${weekday()})</span></b></div>
            <div class="c-metric"><small>현재 시각</small><b class="mono" id="ckClock">--:--:--</b></div>
            <div class="c-metric"><small>접속</small><span class="c-live"><i></i><span id="ckPres">–</span>명</span></div>
          </div>
        </div>
        <div class="tile-row" id="statRow">${Array.from({length:4}).map(()=>`<div class="tile" style="--tc:var(--line-strong)"><div class="skel skel-line" style="width:56%"></div><div class="skel skel-line" style="width:40%;height:24px;margin-top:10px"></div></div>`).join('')}</div>
        <div class="dash-2">
          <div class="dcard"><div class="dcard-hd">${icon('megaphone')}공지사항 <span class="more" data-go="home.notice">전체 보기</span></div>
            <div class="dcard-bd" id="dNotice"><div class="muted" style="padding:10px">불러오는 중…</div></div></div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="dcard"><div class="dcard-hd">${icon('users')}접속 중 <span class="more" id="presMore"></span></div>
              <div class="dcard-bd" id="dPres"><div class="muted" style="padding:10px">…</div></div></div>
            <div class="dcard"><div class="dcard-hd">${icon('external')}바로가기</div>
              <div class="ql-row" id="dQuick"></div></div>
            <div class="dcard"><div class="dcard-hd">${icon('check2')}개인 할 일<span class="more" style="cursor:default">나만 보기</span></div>
              <div class="dcard-bd"><div id="todoList"></div>
                <div class="todo-add"><input id="todoIn" placeholder="할 일 추가 후 Enter" maxlength="80" autocomplete="off"><button class="btn sm pri" id="todoAdd">${icon('plus')}</button></div></div></div>
          </div>
        </div>
      </div>`;
      // 개인 할 일(To-Do) — 이 기기에만 저장(나만 보기)
      (function(){
        const KEY='eduino.todo.'+(u.loginId||'me');
        const get=()=>{ try{ return JSON.parse(localStorage.getItem(KEY)||'[]')||[]; }catch(e){ return []; } };
        const set=v=>localStorage.setItem(KEY,JSON.stringify(v));
        const listEl=root.querySelector('#todoList'), inp=root.querySelector('#todoIn');
        function draw(){ const items=get();
          listEl.innerHTML = items.length ? items.map(t=>`
            <div class="todo-row${t.done?' done':''}" data-id="${t.id}">
              <button class="todo-ck" data-a="tg" title="완료 토글">${t.done?icon('check2'):''}</button>
              <span class="todo-tx">${esc(t.text)}</span>
              <button class="todo-x" data-a="rm" title="삭제">${icon('x')}</button></div>`).join('')
            : `<div class="muted" style="padding:9px 8px;font-size:13px">할 일이 없습니다. 아래에서 추가하세요.</div>`;
          listEl.querySelectorAll('.todo-row').forEach(row=>{ const id=row.dataset.id;
            row.querySelector('[data-a=tg]').onclick=()=>{ const v=get().map(x=>x.id===id?{...x,done:!x.done}:x); set(v); draw(); };
            row.querySelector('[data-a=rm]').onclick=()=>{ set(get().filter(x=>x.id!==id)); draw(); }; });
        }
        function add(){ const tx=(inp.value||'').trim(); if(!tx) return;
          const v=get(); v.unshift({id:uuid(),text:tx,done:false}); set(v); inp.value=''; draw(); inp.focus(); }
        root.querySelector('#todoAdd').onclick=add;
        inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } });
        draw();
      })();
      // 콘솔 라이브 시계
      (function(){ const el2=root.querySelector('#ckClock');
        const tick=()=>{ if(!root.isConnected){ clearInterval(t); return; } if(el2){ const d=new Date();
          el2.textContent=[d.getHours(),d.getMinutes(),d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':'); } };
        const t=setInterval(tick,1000); tick(); })();

      // 바로가기
      const ql=root.querySelector('#dQuick');
      (typeof QUICK_LINKS!=='undefined'?QUICK_LINKS:[]).forEach(l=>{ const a=el('a','ql-chip'); a.href=l.url; a.target='_blank'; a.rel='noopener noreferrer';
        a.innerHTML=`${icon('external')}${esc(l.name)}`; ql.appendChild(a); });

      // 통계 카드
      function renderStats(nUnreadNotice, nMemo, nCbOpen){
        const notes=localNotes();
        const todayCs=notes.filter(r=>todayStr(r.createdAt)===todayStr()).length;
        const cards=[
          { k:'home.notice', ic:'megaphone', l:'미확인 공지', v:nUnreadNotice, c:'var(--d1)' },
          { k:'home.memo',   ic:'send',      l:'새 메모',     v:nMemo, c:'var(--d4)' },
        ];
        if(u.dept==='cs'||u.role==='admin'){
          cards.push({ k:'cs.notes', ic:'clipboard', l:'미처리 콜백', v:nCbOpen, c:'var(--d3)' });
          cards.push({ k:'cs.notes', ic:'headset',   l:'오늘 상담',   v:todayCs, c:'var(--d1)' });
        }
        if(u.role==='lead'){ cards.push({ k:'admin.insights', ic:'chart', l:'우리 파트 현황', link:true, c:'var(--d2)' }); }
        const row=root.querySelector('#statRow'); if(!row) return; row.innerHTML='';
        cards.forEach(c=>{ const d=el('div','tile click'); d.style.setProperty('--tc',c.c);
          d.innerHTML=c.link
            ? `<div class="tl">${icon(c.ic)}${c.l}</div><div class="tv" style="font-size:17px;color:var(--muted);font-weight:700;margin-top:9px">열기 →</div>`
            : `<div class="tl">${icon(c.ic)}${c.l}</div><div class="tv">${c.v}<small>건</small></div>`;
          d.onclick=()=>{ location.hash=c.k; }; row.appendChild(d); });
      }

      // 공지 최근
      (async()=>{
        const raw=await collGet('notice');
        const box=root.querySelector('#dNotice'); if(!box || !root.isConnected) return;
        if(raw===null){ box.innerHTML=`<div class="muted" style="padding:10px">공용 저장소 연결 후 표시됩니다.</div>`; renderStats(0,0,0); }
        else {
          const list=raw.filter(n=>visibleTo(n.dept||'all',u)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
          const unread=list.filter(n=>!(n.readBy||[]).includes(u.loginId)).length;
          box.innerHTML = list.length ? list.slice(0,5).map(n=>{
            const ur=!(n.readBy||[]).includes(u.loginId);
            return `<div class="drow" data-go="home.notice">${ur?'<span class="pin"></span>':'<span style="width:7px"></span>'}
              <span class="dt">${esc(n.title||'(제목 없음)')}</span><span class="dm">${esc(dateShort(n.createdAt))}</span></div>`;
          }).join('') : `<div class="muted" style="padding:10px">공지가 없습니다.</div>`;
          box.querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>location.hash='home.notice');
          // 메모·미처리 콜백 카운트도 함께
          const memos=await collGet('memo');
          const nMemo=(memos||[]).filter(m=>!m.done && (visibleTo(m.to||'all',u)) && m.author!==u.loginId).length;
          const cbs=await collGet('callbacks');
          const nCb=(cbs||[]).filter(c=>!c.done).length;
          renderStats(unread, nMemo, nCb);
        }
      })();

      // 접속자
      (async()=>{
        const box=root.querySelector('#dPres'); if(!box) return;
        if(!(window.SyncStore && SyncStore.configured())){ box.innerHTML=`<div class="muted" style="padding:10px">공용 저장소 연결 시 표시됩니다.</div>`; return; }
        const list=await SyncStore.presence();
        if(!root.isConnected || !root.querySelector('#dPres')) return;
        if(!list){ box.innerHTML=`<div class="muted" style="padding:10px">불러오지 못했습니다.</div>`; return; }
        const pm=root.querySelector('#presMore'); if(pm) pm.textContent=`${list.length}명`;
        const ckp=root.querySelector('#ckPres'); if(ckp) ckp.textContent=list.length;
        box.innerHTML = list.length? list.map(p=>`<div class="drow"><span class="pp-dot2"></span><span class="dt">${esc(p.device)}</span>${p.device===u.name?'<span class="dm">나</span>':''}</div>`).join('')
          : `<div class="muted" style="padding:10px">접속자 정보가 없습니다.</div>`;
      })();

      root.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>location.hash=x.dataset.go);
    }
  };
})();
