/* ===========================================================================
   홈 · 공통 (대시보드 · 공지사항 · 알림)
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
  const DEPT_KO={ cs:'CS', md:'MD', admin:'관리자' };
  const roleKo=r=> r==='admin'?'관리자' : r==='lead'?'파트장':'팀원';
  /* 접속자 이름 → "부서 · 직책" (로스터 매칭 · 관리자는 별도 표기) */
  function posLabel(name, roster){
    const p=(roster||[]).find(r=>r.name===name);
    if(p){ if(p.role==='admin'||p.dept==='admin') return '관리자'; return `${DEPT_KO[p.dept]||p.dept||'-'} · ${roleKo(p.role)}`; }
    return name==='관리자' ? '관리자' : '';
  }
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
        /* 언급(멘션) */
        .nt-card.mentioned:not(.pinned):not(.done){border-left:3px solid var(--info)}
        .nt-ment{font-size:10.5px;font-weight:800;color:#fff;background:var(--info);border-radius:5px;padding:2px 7px;display:inline-flex;align-items:center;gap:3px}
        .nt-ment svg{width:11px;height:11px}
        .nt-ments{display:inline-flex;gap:5px;flex-wrap:wrap;align-items:center}
        .nt-ments .mtag{font-size:11px;font-weight:700;color:var(--muted);background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:1px 7px}
        .nt-ments .mtag.me{color:var(--info);background:var(--info-bg);border-color:color-mix(in srgb,var(--info) 30%,var(--line))}
        .mention-pick{margin-top:12px}
        .mp-cap{font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:7px}
        .mp-cap span{font-weight:500;color:var(--muted);margin-left:6px}
        .mp-chips{display:flex;gap:6px;flex-wrap:wrap}
        .mp{font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--panel);border:1px solid var(--line-strong);border-radius:7px;padding:5px 11px;cursor:pointer;transition:.1s;line-height:1.2}
        .mp:hover{border-color:var(--faint)}
        .mp.dept{font-weight:700}
        .mp.on{color:var(--info);background:var(--info-bg);border-color:var(--info);box-shadow:inset 0 0 0 1px var(--info)}
        .nt-done svg,.nt-new+.nt-title{vertical-align:middle}
        [data-pin],[data-del]{flex:none}
        .nt-body{font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;color:var(--ink-2)}
        .nt-meta{font-size:12px;color:var(--muted);margin-top:9px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .nt-tgt{font-weight:700;color:var(--ink-2);background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:1px 7px}
        .compose{border:1px solid var(--line);border-radius:13px;background:var(--panel-2);padding:16px 18px;margin-bottom:20px}
        .compose .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
        /* 댓글 */
        .nt-cmtbtn{margin-left:6px}
        .nt-cmts{margin-top:11px;border-top:1px dashed var(--line);padding-top:11px}
        .nt-cmt{font-size:13px;line-height:1.5;padding:7px 0;border-bottom:1px solid var(--line)}
        .nt-cmt:last-of-type{border-bottom:0}
        .nt-cmt .who{font-weight:800;color:var(--ink)} .nt-cmt .at{color:var(--muted);font-size:11.5px;margin-left:7px}
        .nt-cmt .txt{color:var(--ink-2);white-space:pre-wrap;word-break:break-word;margin-top:2px}
        .nt-cmt .lnk{background:none;border:0;color:var(--muted);font-size:11.5px;cursor:pointer;margin-left:7px;padding:0}
        .nt-cmt .lnk:hover{color:var(--red)}
        .nt-cmt-in{display:flex;gap:7px;margin-top:9px}
        .nt-cmt-in input{flex:1;min-width:0;height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 11px;font:inherit;font-size:13px}
        .nt-cmt-none{color:var(--muted);font-size:12.5px;padding:2px 0 4px}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">공지사항</div><div class="ds">관리자가 올린 공지입니다. <b>[확인]</b>을 눌러야 읽음 처리되고 알림에서 사라집니다.</div></div></div></div>
      <div class="mbody" id="ntBody"></div>`;
      const body=root.querySelector('#ntBody'); let roster=[];
      // 언급(멘션)된 대상인지 — 특정 직원(loginId) 또는 부서(dept)로 태그됨
      function mentionedMe(n){ return (n.mentions||[]).some(m=>(m.t==='user'&&m.v===u.loginId)||(m.t==='dept'&&m.v===u.dept)); }
      async function load(){
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        const raw=await collGet('notice');
        body.innerHTML='';
        if(isAdmin) body.appendChild(composer());
        if(raw===null){ body.insertAdjacentHTML('beforeend', empty('공용 저장소에 연결되지 않았습니다. (배포 환경에서 표시됩니다)','alert')); return; }
        // 부서 대상에 포함되거나, 나를 개별 언급한 공지도 표시
        const list=raw.filter(n=>visibleTo(n.dept||'all',u) || mentionedMe(n)).sort((a,b)=>
          (b.pinned?1:0)-(a.pinned?1:0) || String(b.createdAt).localeCompare(String(a.createdAt)));   // 고정 공지 최상단
        if(!list.length){ body.insertAdjacentHTML('beforeend', empty('아직 등록된 공지가 없습니다.','megaphone')); return; }
        list.forEach(n=>body.appendChild(card(n)));
      }
      function card(n){
        const unread=!(n.readBy||[]).includes(u.loginId);
        const done=!!n.done, pinned=!!n.pinned, mentioned=mentionedMe(n);
        const c=el('div','nt-card'+(unread&&!done?' unread':'')+(done?' done':'')+(pinned&&!done?' pinned':'')+(mentioned&&!done?' mentioned':''));
        const isMe=m=>(m.t==='user'&&m.v===u.loginId)||(m.t==='dept'&&m.v===u.dept);
        const mentTags=(n.mentions||[]).length?`<span class="nt-ments">${n.mentions.map(m=>`<span class="mtag${isMe(m)?' me':''}">${m.t==='dept'?'#':'@'}${esc(m.l||m.v)}</span>`).join('')}</span>`:'';
        c.innerHTML=`<div class="nt-top">${pinned&&!done?'<span class="nt-pin">'+icon('pin')+'필독</span>':''}${mentioned&&!done?'<span class="nt-ment">'+icon('bell')+'나 언급</span>':''}${done?'<span class="nt-done">'+icon('check')+'완료</span>':(unread?'<span class="nt-new">미확인</span>':'')}<span class="nt-title">${esc(n.title||'(제목 없음)')}</span>
            ${isAdmin?'<button class="btn ghost sm" data-pin title="'+(pinned?'고정 해제':'상단 고정(필독)')+'" style="margin-left:auto">'+(pinned?'📌':icon('pin'))+'</button><button class="btn ghost sm" data-del>'+icon('trash')+'</button>':''}</div>
          <div class="nt-body">${esc(n.body||'')}</div>
          <div class="nt-meta"><span class="nt-tgt">${esc(targetLabel(n.dept||'all',roster))}</span>${mentTags}
            <span>${esc(n.authorName||'관리자')}</span><span>·</span><span>${esc(dateShort(n.createdAt))}</span>
            ${done?`<span class="nt-donemeta">완료 · ${esc(dateShort(n.doneAt))}</span>`:''}
            <span style="margin-left:auto">읽음 ${ (n.readBy||[]).length }</span>
            <button class="btn ghost sm nt-cmtbtn" data-cmt>${icon('chat')||'💬'} 댓글 ${(n.comments||[]).length}</button>
            ${isAdmin?`<button class="btn ${done?'ghost':'ok'} sm" data-done>${done?'완료 취소':icon('check')+'완료 처리'}</button>`:''}
            ${unread?`<button class="btn pri sm" data-read>${icon('check')}확인</button>`:(!done?'<span style="color:var(--ok);font-weight:700;font-size:12px">✓ 확인함</span>':'')}</div>
          <div class="nt-cmts" data-cmtbox hidden></div>`;
        const db=c.querySelector('[data-del]'); if(db) db.onclick=async()=>{ if(confirm('이 공지를 삭제할까요?')){ await collDel('notice',n.id); load(); } };
        const rb=c.querySelector('[data-read]'); if(rb) rb.onclick=async(e)=>{ e.currentTarget.disabled=true; await markRead([n]); load();
          if(window.refreshNavBadges) window.refreshNavBadges(); };
        const dn=c.querySelector('[data-done]'); if(dn) dn.onclick=async(e)=>{ e.currentTarget.disabled=true; await markDone(n,!done); load(); };
        const pn=c.querySelector('[data-pin]'); if(pn) pn.onclick=async(e)=>{ e.currentTarget.disabled=true; await markPin(n,!pinned); load(); };
        // 댓글 — 기본 접힘, [댓글] 클릭 시 펼침
        const box=c.querySelector('[data-cmtbox]');
        function renderCmts(){
          const list=n.comments||[];
          box.innerHTML=`${list.length?list.map(cm=>`<div class="nt-cmt"><span class="who">${esc(cm.byName||cm.by||'')}</span><span class="at">${esc(dateShort(cm.at))}</span>${(cm.by===u.loginId||isAdmin)?`<button class="lnk" data-delcmt="${esc(cm.id)}">삭제</button>`:''}<div class="txt">${esc(cm.text||'')}</div></div>`).join(''):'<div class="nt-cmt-none">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</div>'}
            <div class="nt-cmt-in"><input data-cmtinput placeholder="댓글 입력 (${esc(u.name||u.loginId)})" maxlength="500"><button class="btn pri sm" data-cmtsend>등록</button></div>`;
          const send=box.querySelector('[data-cmtsend]'), inp=box.querySelector('[data-cmtinput]');
          const go=async()=>{ const t=(inp.value||'').trim(); if(!t) return; send.disabled=true; await addComment(n,t); renderCmts(); updateCmtCount();
            const ni=box.querySelector('[data-cmtinput]'); if(ni) ni.focus(); };
          if(send) send.onclick=go; if(inp) inp.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); go(); } };
          box.querySelectorAll('[data-delcmt]').forEach(b=>b.onclick=async()=>{ if(!confirm('이 댓글을 삭제할까요?')) return; await delComment(n,b.dataset.delcmt); renderCmts(); updateCmtCount(); });
        }
        function updateCmtCount(){ const cb=c.querySelector('[data-cmt]'); if(cb) cb.innerHTML=`${icon('chat')||'💬'} 댓글 ${(n.comments||[]).length}`; }
        const cbtn=c.querySelector('[data-cmt]'); if(cbtn) cbtn.onclick=()=>{ const open=box.hidden; box.hidden=!open; if(open&&!box.dataset.rendered){ renderCmts(); box.dataset.rendered='1'; } };
        return c;
      }
      async function addComment(n, text){
        n.comments=[...(n.comments||[]), { id:uuid(), by:u.loginId, byName:u.name||u.loginId, text:text.slice(0,500), at:nowISO() }];
        try{ await collPush('notice', n); }catch{}
      }
      async function delComment(n, cid){
        n.comments=(n.comments||[]).filter(cm=>cm.id!==cid);
        try{ await collPush('notice', n); }catch{}
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
          <div class="mention-pick">
            <div class="mp-cap">언급 대상<span>부서·직원을 태그하면 카드에 강조 표시되고, 태그된 직원은 대상과 무관하게 공지를 받습니다</span></div>
            <div class="mp-chips" id="mpChips"></div>
          </div>
          <div class="row">
            <label class="fld" style="margin:0">공개 범위<select id="ntTgt">${Object.entries(DEPT_LABEL).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
            <button class="btn pri" id="ntPost" style="margin-left:auto">${icon('send')}게시</button>
            <span class="muted" id="ntStat" style="font-size:12.5px"></span></div>`;
        // 언급 피커 (부서 + 개별 직원)
        const mentionSel=new Map(); const tk=m=>m.t+':'+m.v;
        function renderMps(){ const wrap=box.querySelector('#mpChips'); if(!wrap) return;
          const items=[{t:'dept',v:'cs',l:'CS 전체'},{t:'dept',v:'md',l:'MD 전체'},
            ...roster.filter(m=>m.dept==='cs'||m.dept==='md').map(m=>({t:'user',v:m.loginId,l:m.name}))];
          wrap.innerHTML='';
          if(!roster.length) wrap.innerHTML='<span class="muted" style="font-size:12px">직원 목록 불러오는 중…</span>';
          items.forEach(it=>{ const on=mentionSel.has(tk(it)); const b2=el('button','mp'+(it.t==='dept'?' dept':'')+(on?' on':'')); b2.type='button';
            b2.textContent=(it.t==='dept'?'#':'@')+it.l;
            b2.onclick=()=>{ mentionSel.has(tk(it))?mentionSel.delete(tk(it)):mentionSel.set(tk(it),it); renderMps(); };
            wrap.appendChild(b2); });
        }
        renderMps();
        box.querySelector('#ntPost').onclick=async()=>{
          const title=box.querySelector('#ntTitle').value.trim(), b=box.querySelector('#ntBodyIn').value.trim();
          if(!title&&!b){ box.querySelector('#ntStat').textContent='내용을 입력하세요'; return; }
          box.querySelector('#ntStat').textContent='게시 중…';
          await collPush('notice',{ id:uuid(), title, body:b, dept:box.querySelector('#ntTgt').value,
            mentions:[...mentionSel.values()], author:u.loginId, authorName:u.name, createdAt:nowISO(), readBy:[u.loginId] });
          toast('공지를 게시했습니다'); load();
        };
        return box;
      }
      async function markRead(unread){
        for(const n of unread){ n.readBy=[...(n.readBy||[]), u.loginId]; try{ await collPush('notice', n); }catch{} }
      }
      rosterList().then(r=>{ roster=r; if(root.isConnected) load(); }); load();   // 로스터 도착 후 재렌더(언급 직원 칩)
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
        const [notices,cbs]=await Promise.all([collGet('notice'),collGet('callbacks')]);
        if(!root.isConnected||!root.querySelector('#alBody')) return;
        const mentMe=n=>(n.mentions||[]).some(m=>(m.t==='user'&&m.v===u.loginId)||(m.t==='dept'&&m.v===u.dept));
        const unread=(notices||[]).filter(n=>(visibleTo(n.dept||'all',u)||mentMe(n)) && !(n.readBy||[]).includes(u.loginId))
          .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
        unreadCache=unread;
        const openCb=(isAdmin||u.dept==='cs')?(cbs||[]).filter(c=>!c.done).length:0;
        let html=`<div class="al-sec">미확인 공지 · ${unread.length}건</div>`;
        html+= unread.length
          ? unread.map(n=>`<div class="al-card"><div class="al-title">${esc(n.title||'(제목 없음)')}</div>
              <div class="al-body">${esc((n.body||'').slice(0,240))}${(n.body||'').length>240?'…':''}</div>
              <div class="al-meta"><span>${esc(n.authorName||'관리자')}</span><span>·</span><span>${esc(dateShort(n.createdAt))}</span>
                <button class="btn pri sm" data-read="${esc(n.id)}" style="margin-left:auto">${icon('check')}확인</button></div></div>`).join('')
          : `<div class="al-none">${icon('check')}<div style="margin-top:6px;font-size:14px">확인할 공지가 없습니다.</div></div>`;
        if(openCb){ html+=`<div class="al-sec" style="margin-top:20px">확인 필요</div>`;
          html+=`<div class="al-link" data-go="cs.notes"><div class="al-ic">${icon('clipboard')}</div><div><b>미처리 콜백 ${openCb}건</b><div class="muted" style="font-size:12px">처리 대기 탭에서 확인하세요</div></div></div>`;
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

  /* ============================ 홈 대시보드 ============================ */
  MODULES['home.dash']={
    title:'홈', icon:'dashboard',
    render(root){
      const u=meU();
      const greeting=()=>{ const h=new Date().getHours(); return h<11?'좋은 아침이에요':h<14?'점심 맛있게 드세요':h<18?'좋은 오후예요':'오늘도 수고 많으셨어요'; };
      const weekday=()=>['일','월','화','수','목','금','토'][new Date().getDay()]+'요일';
      root.innerHTML=`
      <style>
        /* 대시보드 세로 리듬 — 콘솔·요약·카드 사이 균일한 간격 */
        #dashWrap{display:flex;flex-direction:column;gap:18px}
        #dashWrap > .console{margin:0}
        .dash-2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start;margin:0}
        @media(max-width:900px){.dash-2{grid-template-columns:1fr}}
        /* 좌측 하단 임베드 달력 — 팀 일정 공유 확인용(컴팩트) */
        .dash-cal .mbody{padding:12px 12px 14px}
        .dash-cal .cal-wrap{max-width:none}
        .dash-cal .cal-bar{margin-bottom:10px}
        .dash-cal .cal-title{font-size:15px;min-width:110px}
        .dash-cal .cal-cell{min-height:60px}
        .dash-cal .cal-ev{font-size:10.5px}
        .dash-cal .cal-day{margin-top:12px;padding:13px 15px}
        .dcard{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden;box-shadow:var(--sh-sm)}
        .dcard-hd{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);
          font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);
          background:linear-gradient(180deg,var(--panel-2),color-mix(in srgb,var(--panel-2) 40%,var(--panel)))}
        .dcard-hd .ic{font-size:14px;color:var(--faint)}
        .dcard-hd .more{margin-left:auto;font-size:11.5px;font-weight:700;color:var(--muted);cursor:pointer;text-transform:none;letter-spacing:0}
        .dcard-hd .more:hover{color:var(--red)}
        .dcard-bd{padding:8px 9px}
        .drow{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;font-size:13.5px}
        .drow:hover{background:var(--hover);cursor:pointer}
        .drow .dt{font-weight:600;color:var(--ink)}
        .drow .dm{color:var(--muted);font-size:12px;margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}
        .drow .pin{width:7px;height:7px;border-radius:50%;background:var(--danger);flex:none}
        /* 접속 중 — 이니셜 아바타 + 이름/직책 2줄 */
        .prow{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:10px}
        .prow:hover{background:var(--hover)}
        .pav{width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
          font-size:13px;font-weight:800;color:#fff;position:relative}
        .pav::after{content:"";position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;
          background:#42c98a;border:2px solid var(--panel);box-shadow:0 0 0 2px rgba(66,201,138,.18)}
        .pnm{display:flex;flex-direction:column;line-height:1.3;min-width:0}
        .pnm .n{font-weight:700;color:var(--ink);font-size:13.5px}
        .pnm .r{font-size:11.5px;color:var(--muted);font-weight:600}
        .pme{margin-left:auto;font-size:11px;font-weight:800;color:var(--ok);background:var(--ok-bg);border-radius:6px;padding:2px 8px}
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
       <div id="dashWrap">
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
        <div class="dash-2">
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="dcard"><div class="dcard-hd">${icon('megaphone')}공지사항 <span class="more" data-go="home.notice">전체 보기</span></div>
              <div class="dcard-bd" id="dNotice"><div class="muted" style="padding:10px">불러오는 중…</div></div></div>
            <div class="dcard"><div class="dcard-hd">${icon('check2')}일정·달력 <span class="more" data-go="home.calendar">전체 보기</span></div>
              <div id="dashCal" class="dash-cal"><div class="muted" style="padding:12px">불러오는 중…</div></div></div>
          </div>
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

      // 헤더 '전체 보기' 링크 + 좌측 하단 팀 일정 달력(전사 공유) 임베드
      root.querySelectorAll('.dcard-hd .more[data-go]').forEach(m=>m.onclick=()=>location.hash=m.dataset.go);
      (function(){ const cal=root.querySelector('#dashCal'); if(cal && typeof embedModule==='function') embedModule(cal,'home.calendar'); })();

      // 공지 최근
      (async()=>{
        const raw=await collGet('notice');
        const box=root.querySelector('#dNotice'); if(!box || !root.isConnected) return;
        if(raw===null){ box.innerHTML=`<div class="muted" style="padding:10px">공용 저장소 연결 후 표시됩니다.</div>`; }
        else {
          const mentMe=n=>(n.mentions||[]).some(m=>(m.t==='user'&&m.v===u.loginId)||(m.t==='dept'&&m.v===u.dept));
          const list=raw.filter(n=>visibleTo(n.dept||'all',u)||mentMe(n)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
          box.innerHTML = list.length ? list.slice(0,5).map(n=>{
            const ur=!(n.readBy||[]).includes(u.loginId);
            return `<div class="drow" data-go="home.notice">${ur?'<span class="pin"></span>':'<span style="width:7px"></span>'}
              <span class="dt">${esc(n.title||'(제목 없음)')}</span><span class="dm">${esc(dateShort(n.createdAt))}</span></div>`;
          }).join('') : `<div class="muted" style="padding:10px">공지가 없습니다.</div>`;
          box.querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>location.hash='home.notice');
        }
      })();

      // 접속 중 — 이름 + 직책 (공용 저장소를 직접 조회해 sync 설정과 무관하게 안정 동작)
      (async()=>{
        const box=root.querySelector('#dPres'); if(!box) return;
        let list=null, roster=[];
        try{ const [pd,rd]=await Promise.all([apiGet('type=presence'), rosterList()]);
          list=(pd&&pd.presence)||[]; roster=rd||[]; }catch{ list=null; }
        if(!root.isConnected || !root.querySelector('#dPres')) return;
        if(list===null){ box.innerHTML=`<div class="muted" style="padding:10px">접속자 정보를 불러오지 못했습니다.</div>`; return; }
        const pm=root.querySelector('#presMore'); if(pm) pm.textContent=`${list.length}명`;
        const ckp=root.querySelector('#ckPres'); if(ckp) ckp.textContent=list.length;
        const palette=['#4f8cff','#f2724e','#42c98a','#a06bff','#ef5da8','#f7a52b','#38bdc9'];
        const initial=n=>(String(n||'?').trim()||'?').slice(0,1);
        box.innerHTML = list.length ? list.map((p,i)=>{
          const nm=p.device||'', pos=posLabel(nm,roster), me=(nm===u.name);
          return `<div class="prow"><span class="pav" style="background:${palette[i%palette.length]}">${esc(initial(nm))}</span>
            <span class="pnm"><span class="n">${esc(nm||'(이름 없음)')}</span>${pos?`<span class="r">${esc(pos)}</span>`:''}</span>
            ${me?'<span class="pme">나</span>':''}</div>`;
        }).join('') : `<div class="muted" style="padding:10px">접속자 정보가 없습니다.</div>`;
      })();

      root.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>location.hash=x.dataset.go);
    }
  };
})();
