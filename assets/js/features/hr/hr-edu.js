/* ===========================================================================
   HR · 교육 매칭 + 마이페이지  (요구사항 명세서 4-2 ~ 4-7)
     hr.share   추천도서·강의 공유 (커뮤니티)
     hr.match   맞춤 추천 (부족 역량 → 카탈로그 자동 매칭 상위 3개)
     hr.catalog 강의 카탈로그
     hr.apply   신청 현황 (전 직원 · 예산 소진율)
     hr.mypage  나의 교육·잔여한도 (본인)
     hr.review  교육 후기 (별점 + 후기)
   저장은 모두 api/hr.js 경유 — 서버가 권한을 확인한 뒤에만 내주고 받는다.
   =========================================================================== */
(function(){
  const BUDGET=300000;                                    // 1인 연간 교육비 한도
  const ST=['추천대기','신청완료','수강중','수강완료'];
  const ST_COLOR={ '추천대기':['#b4530a','#fff4e6'], '신청완료':['#0a63c2','#e8f1fc'], '수강중':['#6d3fd6','#f0ebfe'], '수강완료':['#12886a','#e6f7f0'] };
  const TEAMS={ edutech:'에듀테크 사업팀', aiot:'AIoT 교육플랫폼 사업팀', pet:'펫테크 사업팀' };
  const yearOf=s=>String(s||'').slice(0,4);
  const thisYear=()=>String(new Date().getFullYear());
  const stBadge=v=>{ const c=ST_COLOR[v]||['#5b6675','#eef1f6'];
    return `<span class="he-st" style="color:${c[0]};background:${c[1]}">${esc(v||'')}</span>`; };


  /* 여러 데이터 묶음을 한 번에 읽는다. 권한 밖이면 빈 배열로 두고 화면은 계속 그린다. */
  async function loadMany(names, s){
    const out={};
    for(const n of names){
      const r=await HR.api('list',{ name:n });
      if(r.relock){ s.relock(); return null; }
      out[n]=r.ok?(r.items||[]):[]; out['can_'+n]=!!(r.ok&&r.canWrite); out['err_'+n]=r.ok?'':(r.error||'');
    }
    return out;
  }
  const page=(key,title,desc,draw)=>{ MODULES[key]={ title, icon:'clipboard', render(root){
    root.innerHTML=`<style>${(window.HR&&HR.CSS)||''}</style>
      <div class="mhead"><div class="tt">${esc(title)}</div><div class="ds">${desc}</div></div>
      <div class="mbody wide" id="heBody"></div>`;
    HR.guard(root.querySelector('#heBody'), key, draw); } }; };
  const shell=(host,s,html)=>{ host.innerHTML=HR.headBar(s)+html; HR.wireHead(host,s); };
  const loading=(host,s)=>shell(host,s,`<div class="muted" style="padding:16px">불러오는 중…</div>`);

  /* ───────────────────── 4-2 추천도서·강의 공유 ───────────────────── */
  page('hr.share','추천도서·강의 공유','팀원들이 서로에게 권하는 도서·강의를 모읍니다. 누구나 자유롭게 등록할 수 있습니다.',
  async function(host, s){
    loading(host,s);
    const d=await loadMany(['share'],s); if(!d||!host.isConnected) return;
    let filter='all';
    const me=s.me||{};
    const draw=()=>{
      const list=d.share.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)))
        .filter(x=>filter==='all'||x.type===filter);
      shell(host,s,`
        <div class="he-bar">
          ${[['all','전체'],['book','도서'],['course','강의']].map(([k,n])=>`<button class="he-chip${filter===k?' on':''}" data-f="${k}">${n}</button>`).join('')}
          ${d.can_share?`<button class="btn pri sm" id="shAdd" style="margin-left:8px">${icon('plus')||''}등록</button>`:''}
          <span class="he-cnt">${list.length}건</span>
        </div>
        ${d.can_share?`<div class="he-f" id="shForm" hidden>
          <div><label>유형</label><select id="shType"><option value="book">도서</option><option value="course">강의</option></select></div>
          <div><label>제목</label><input id="shTitle" placeholder="도서명 또는 강의명"></div>
          <div><label>추천자</label><input id="shBy" value="${esc(me.name||'')}"></div>
          <div class="wide"><label>한줄평</label><textarea id="shNote" placeholder="어떤 점이 좋았는지 간단히"></textarea></div>
          <div class="a"><button class="btn pri sm" id="shSave">${icon('check')||''}등록</button><button class="btn ghost sm" id="shCancel">취소</button></div>
        </div>`:''}
        ${list.length?`<div class="he-feed">${list.map(x=>`<div class="he-card ${x.type==='book'?'book':'course'}">
          <span class="he-tag" style="${x.type==='book'?'color:#0a63c2;background:#e8f1fc':'color:#7c4dd6;background:#f0ebfe'}">${x.type==='book'?'도서':'강의'}</span>
          <div class="t">${esc(x.title||'')}</div>
          <div class="m">${esc(x.by||'')} · ${esc(String(x.at||'').slice(0,10))}</div>
          ${x.note?`<div class="c">${esc(x.note)}</div>`:''}
          ${(d.can_share&&(x.byId===me.loginId))?`<div style="margin-top:8px"><button class="btn ghost sm" data-del="${esc(x.id)}" style="color:var(--danger)">삭제</button></div>`:''}
        </div>`).join('')}</div>`
        :`<div class="he-empty">${icon('inbox')||''}<div style="margin-top:8px">아직 등록된 추천이 없습니다.${d.can_share?' 첫 추천을 남겨보세요.':''}</div></div>`}`);
      host.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{ filter=b.dataset.f; draw(); });
      const add=host.querySelector('#shAdd'); if(add) add.onclick=()=>{ host.querySelector('#shForm').hidden=false; host.querySelector('#shTitle').focus(); };
      const cancel=host.querySelector('#shCancel'); if(cancel) cancel.onclick=()=>{ host.querySelector('#shForm').hidden=true; };
      const save=host.querySelector('#shSave');
      if(save) save.onclick=async()=>{
        const title=(host.querySelector('#shTitle').value||'').trim();
        if(!title){ toast('제목을 입력하세요'); return; }
        const item={ id:uuid(), type:host.querySelector('#shType').value, title,
          by:(host.querySelector('#shBy').value||'').trim()||me.name||'', byId:me.loginId||'',
          note:(host.querySelector('#shNote').value||'').trim(), at:nowISO() };
        save.disabled=true; const r=await HR.api('put',{ name:'share', item }); save.disabled=false;
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'등록 실패'); return; }
        d.share.push(item); toast('등록했습니다'); draw();
      };
      host.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 추천을 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'share', id:b.dataset.del });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.share=d.share.filter(x=>x.id!==b.dataset.del); toast('삭제했습니다'); draw();
      });
    };
    draw();
  });

  /* ───────────────────── 4-4 강의 카탈로그 ───────────────────── */
  page('hr.catalog','강의 카탈로그','교육 매칭에 쓰이는 강의 목록입니다. 카테고리는 직원의 부족 역량과 맞춰집니다.',
  async function(host, s){
    loading(host,s);
    const d=await loadMany(['catalog'],s); if(!d||!host.isConnected) return;
    let cat='', q='', editing=null;
    const cats=()=>[...new Set(d.catalog.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
    const draw=()=>{
      const list=d.catalog.slice()
        .filter(x=>!cat||x.category===cat)
        .filter(x=>!q||((x.title||'')+(x.platform||'')).toLowerCase().includes(q.toLowerCase()))
        .sort((a,b)=>(Number(b.recommends)||0)-(Number(a.recommends)||0)||String(a.title).localeCompare(String(b.title),'ko'));
      shell(host,s,`
        <div class="he-bar">
          <select id="cgCat"><option value="">카테고리 전체</option>${cats().map(c=>`<option ${c===cat?'selected':''}>${esc(c)}</option>`).join('')}</select>
          <input class="q" id="cgQ" placeholder="강의명·플랫폼 검색" value="${esc(q)}">
          ${d.can_catalog?`<button class="btn pri sm" id="cgAdd">${icon('plus')||''}강의 등록</button>`:''}
          <span class="he-cnt">${list.length}개</span>
        </div>
        ${d.can_catalog?`<div class="he-f" id="cgForm" hidden>
          <div><label>강의명</label><input id="cgTitle" placeholder="강의명"></div>
          <div><label>플랫폼</label><input id="cgPlat" placeholder="예: 인프런, 패스트캠퍼스"></div>
          <div><label>카테고리</label><input id="cgCatIn" list="cgCatList" placeholder="예: 회계">
            <datalist id="cgCatList">${cats().map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
          <div><label>가격(원)</label><input id="cgPrice" type="number" min="0" step="1000" placeholder="0"></div>
          <div class="wide"><label>링크(선택)</label><input id="cgUrl" placeholder="https://"></div>
          <div class="a"><button class="btn pri sm" id="cgSave">${icon('check')||''}저장</button><button class="btn ghost sm" id="cgCancel">취소</button></div>
        </div>`:''}
        ${list.length?`<div class="he-wrap"><table class="he-tbl">
          <thead><tr><th>강의명</th><th style="width:130px">플랫폼</th><th style="width:110px">카테고리</th>
            <th style="width:90px">가격</th><th style="width:80px">추천횟수</th>${d.can_catalog?'<th style="width:96px"></th>':''}</tr></thead>
          <tbody>${list.map(x=>`<tr>
            <td><b>${esc(x.title||'')}</b>${x.url?` <a href="${esc(x.url)}" target="_blank" rel="noopener" style="font-size:11px">↗</a>`:''}</td>
            <td>${esc(x.platform||'')||'<span class="muted">-</span>'}</td>
            <td>${x.category?`<span class="he-tag">${esc(x.category)}</span>`:'<span class="muted">-</span>'}</td>
            <td class="num">${fmtNum(x.price||0)}원</td>
            <td class="num">${Number(x.recommends)||0}회</td>
            ${d.can_catalog?`<td style="white-space:nowrap"><button class="btn ghost sm" data-e="${esc(x.id)}">수정</button><button class="btn ghost sm" data-d="${esc(x.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
          </tr>`).join('')}</tbody></table></div>`
        :`<div class="he-empty">${icon('clipboard')||''}<div style="margin-top:8px">조건에 맞는 강의가 없습니다.${d.can_catalog?' [강의 등록]으로 추가하세요.':''}</div></div>`}`);
      const $=x=>host.querySelector(x);
      $('#cgCat').onchange=e=>{ cat=e.target.value; draw(); };
      let t=null; $('#cgQ').oninput=e=>{ clearTimeout(t); t=setTimeout(()=>{ q=e.target.value; draw(); },250); };
      if(!d.can_catalog) return;
      const form=$('#cgForm');
      const open=(x)=>{ editing=x||null; form.hidden=false;
        $('#cgTitle').value=x?x.title||'':''; $('#cgPlat').value=x?x.platform||'':'';
        $('#cgCatIn').value=x?x.category||'':''; $('#cgPrice').value=x?(x.price||''):'';
        $('#cgUrl').value=x?x.url||'':''; $('#cgTitle').focus(); };
      $('#cgAdd').onclick=()=>open(null);
      $('#cgCancel').onclick=()=>{ form.hidden=true; editing=null; };
      $('#cgSave').onclick=async()=>{
        const title=($('#cgTitle').value||'').trim(); if(!title){ toast('강의명을 입력하세요'); return; }
        const item={ id:(editing&&editing.id)||uuid(), title, platform:($('#cgPlat').value||'').trim(),
          category:($('#cgCatIn').value||'').trim(), price:Number($('#cgPrice').value)||0,
          url:($('#cgUrl').value||'').trim(), recommends:(editing&&Number(editing.recommends))||0 };
        $('#cgSave').disabled=true; const r=await HR.api('put',{ name:'catalog', item }); $('#cgSave').disabled=false;
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'저장 실패'); return; }
        if(editing) d.catalog=d.catalog.map(y=>y.id===item.id?item:y); else d.catalog.push(item);
        toast(editing?'수정했습니다':'등록했습니다'); form.hidden=true; editing=null; draw();
      };
      host.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{ open(d.catalog.find(x=>x.id===b.dataset.e)); form.scrollIntoView({behavior:'smooth',block:'center'}); });
      host.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 강의를 카탈로그에서 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'catalog', id:b.dataset.d });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.catalog=d.catalog.filter(x=>x.id!==b.dataset.d); toast('삭제했습니다'); draw();
      });
    };
    draw();
  });

  /* ───────────────────── 4-3 맞춤 추천 ───────────────────── */
  page('hr.match','맞춤 추천','직원의 부족 역량 카테고리에 맞는 강의를 카탈로그에서 자동으로 찾아 상위 3개를 제안합니다.',
  async function(host, s){
    loading(host,s);
    const d=await loadMany(['staff','catalog','apply'],s); if(!d||!host.isConnected) return;
    let pick='';
    const draw=()=>{
      const staff=d.staff.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
      const p=staff.find(x=>x.id===pick);
      const gaps=(p&&p.gaps)||[];
      const mine=p?d.apply.filter(a=>a.staffId===p.id):[];
      const used=mine.filter(a=>yearOf(a.appliedAt)===thisYear()).reduce((t,a)=>t+(Number(a.price)||0),0);
      let recs=[];
      if(p){
        recs=d.catalog.filter(c=>gaps.some(g=>String(c.category||'').trim()===String(g).trim()))
          .filter(c=>!mine.some(a=>a.catalogId===c.id))
          .sort((a,b)=>(Number(b.recommends)||0)-(Number(a.recommends)||0)||(Number(a.price)||0)-(Number(b.price)||0))
          .slice(0,3);
      }
      shell(host,s,`
        <div class="he-bar">
          <select id="mtWho" style="min-width:200px"><option value="">직원을 선택하세요</option>
            ${staff.map(x=>`<option value="${esc(x.id)}" ${x.id===pick?'selected':''}>${esc(x.name)} · ${esc(TEAMS[x.team]||'')}</option>`).join('')}</select>
        </div>
        ${!d.staff.length?`<div class="he-empty">직원 마스터가 비어 있습니다. [홈·분기 현황]에서 명단을 먼저 등록하세요.</div>`:''}
        ${p?`<div class="he-pick">
            <span class="n">${esc(p.name)}</span><span class="he-tag">${esc(TEAMS[p.team]||'')}</span>
            <span class="muted" style="font-size:12px">부족 역량:</span>
            ${gaps.length?gaps.map(g=>`<span class="he-tag" style="color:var(--red);background:var(--active-bg)">${esc(g)}</span>`).join(''):'<span class="muted" style="font-size:12px">미등록 — [홈·분기 현황]에서 입력하면 추천이 정확해집니다</span>'}
            <span style="margin-left:auto;font-size:12px;color:var(--muted)">올해 사용 <b style="color:var(--ink)">${fmtNum(used)}원</b> / 잔여 <b style="color:var(--ink)">${fmtNum(Math.max(0,BUDGET-used))}원</b></span>
          </div>
          <div class="he-sec">${icon('clipboard')||''} 추천 강의 <span class="muted">카테고리 일치 · 추천 많은 순</span></div>
          ${recs.length?recs.map((c,i)=>`<div class="he-rec">
              <span class="r">${i+1}</span>
              <div class="g"><b>${esc(c.title)}</b>
                <div>${esc(c.platform||'')}${c.category?` · <span class="he-tag">${esc(c.category)}</span>`:''} · 추천 ${Number(c.recommends)||0}회</div></div>
              <b style="font-variant-numeric:tabular-nums">${fmtNum(c.price||0)}원</b>
              ${d.can_apply?`<button class="btn pri sm" data-rec="${esc(c.id)}">${icon('check')||''}이 강의로 신청 등록</button>`:''}
            </div>`).join('')
            :`<div class="he-empty">${gaps.length?'부족 역량과 맞는 강의가 카탈로그에 없습니다. [강의 카탈로그]에 해당 카테고리 강의를 등록하세요.':'부족 역량이 등록되어 있지 않아 추천할 수 없습니다.'}</div>`}
          ${mine.length?`<div class="he-sec">${icon('check')||''} 이 직원의 신청 내역 <span class="muted">${mine.length}건</span></div>
            <div class="he-wrap"><table class="he-tbl"><thead><tr><th>강의</th><th style="width:90px">금액</th><th style="width:88px">상태</th><th style="width:96px">신청일</th></tr></thead>
            <tbody>${mine.sort((a,b)=>String(b.appliedAt).localeCompare(String(a.appliedAt))).map(a=>`<tr>
              <td>${esc(a.title||'')}</td><td class="num">${fmtNum(a.price||0)}원</td><td>${stBadge(a.status)}</td>
              <td>${esc(String(a.appliedAt||'').slice(0,10))}</td></tr>`).join('')}</tbody></table></div>`:''}`
        :''}`);
      host.querySelector('#mtWho').onchange=e=>{ pick=e.target.value; draw(); };
      host.querySelectorAll('[data-rec]').forEach(b=>b.onclick=async()=>{
        const c=d.catalog.find(x=>x.id===b.dataset.rec); if(!c||!p) return;
        if(!confirm(`${p.name} 님에게 '${c.title}' 신청을 등록할까요?`)) return;
        b.disabled=true;
        const item={ id:uuid(), staffId:p.id, staffName:p.name, staffLogin:p.loginId||'', team:p.team||'',
          catalogId:c.id, title:c.title, category:c.category||'', platform:c.platform||'',
          price:Number(c.price)||0, status:'추천대기', appliedAt:nowISO() };
        const r=await HR.api('put',{ name:'apply', item });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ b.disabled=false; toast(r.error||'등록 실패'); return; }
        d.apply.push(item);
        if(d.can_catalog){   // 추천횟수 +1 (카탈로그 수정 권한이 있을 때만)
          const up={ ...c, recommends:(Number(c.recommends)||0)+1 };
          const r2=await HR.api('put',{ name:'catalog', item:up });
          if(r2.ok) d.catalog=d.catalog.map(x=>x.id===c.id?up:x);
        }
        toast('신청을 등록했습니다 · [신청 현황]에서 진행 상태를 관리하세요'); draw();
      });
    };
    draw();
  });

  /* ───────────────────── 4-5 신청 현황 ───────────────────── */
  page('hr.apply','신청 현황','전 직원의 교육 신청 상태와 예산 사용 현황입니다. (1인 연 30만원 한도)',
  async function(host, s){
    loading(host,s);
    const d=await loadMany(['apply','staff'],s); if(!d||!host.isConnected) return;
    let year=thisYear(), fSt='', q='';
    const draw=()=>{
      const years=[...new Set(d.apply.map(a=>yearOf(a.appliedAt)).filter(Boolean))]; if(!years.includes(thisYear())) years.push(thisYear());
      const inYear=d.apply.filter(a=>yearOf(a.appliedAt)===year);
      const list=inYear.filter(a=>!fSt||a.status===fSt)
        .filter(a=>!q||((a.staffName||'')+(a.title||'')).toLowerCase().includes(q.toLowerCase()))
        .sort((a,b)=>String(b.appliedAt).localeCompare(String(a.appliedAt)));
      const headcount=d.staff.length||0;
      const total=headcount*BUDGET, used=inYear.reduce((t,a)=>t+(Number(a.price)||0),0);
      const rate=total?Math.round(used/total*100):0;
      shell(host,s,`
        <div class="he-kpi">
          <div class="he-k"><div class="v">${inYear.length}<small>건</small></div><div class="l">${esc(year)}년 신청</div></div>
          <div class="he-k"><div class="v">${inYear.filter(a=>a.status==='수강완료').length}<small>건</small></div><div class="l">수강 완료</div></div>
          <div class="he-k"><div class="v">${fmtNum(used)}<small>원</small></div><div class="l">사용 금액</div></div>
          <div class="he-k"><div class="v">${rate}<small>%</small></div><div class="l">예산 소진율 · 총액 ${fmtNum(total)}원 (${headcount}명)</div>
            <div class="he-bw"><div class="he-bb ${rate>100?'over':rate>80?'warn':''}" style="width:${Math.min(100,rate)}%"></div></div></div>
        </div>
        <div class="he-bar">
          <select id="apYear">${years.sort().reverse().map(y=>`<option ${y===year?'selected':''}>${esc(y)}</option>`).join('')}</select>
          <select id="apSt"><option value="">상태 전체</option>${ST.map(v=>`<option ${v===fSt?'selected':''}>${esc(v)}</option>`).join('')}</select>
          <input class="q" id="apQ" placeholder="직원명·강의명 검색" value="${esc(q)}">
          <span class="he-cnt">${list.length}건</span>
        </div>
        ${list.length?`<div class="he-wrap"><table class="he-tbl">
          <thead><tr><th style="width:80px">직원</th><th style="width:130px">소속팀</th><th>강의</th>
            <th style="width:100px">카테고리</th><th style="width:90px">금액</th><th style="width:116px">상태</th>
            <th style="width:96px">신청일</th>${d.can_apply?'<th style="width:52px"></th>':''}</tr></thead>
          <tbody>${list.map(a=>`<tr data-id="${esc(a.id)}">
            <td><b>${esc(a.staffName||'')}</b></td><td style="white-space:nowrap">${esc(TEAMS[a.team]||'')}</td>
            <td>${esc(a.title||'')}${a.platform?`<div class="muted" style="font-size:11px">${esc(a.platform)}</div>`:''}</td>
            <td>${a.category?`<span class="he-tag">${esc(a.category)}</span>`:'<span class="muted">-</span>'}</td>
            <td class="num">${fmtNum(a.price||0)}원</td>
            <td>${d.can_apply?`<select data-st="${esc(a.id)}" style="width:100%;height:30px;font-size:12px">${ST.map(v=>`<option ${v===a.status?'selected':''}>${esc(v)}</option>`).join('')}</select>`:stBadge(a.status)}</td>
            <td>${esc(String(a.appliedAt||'').slice(0,10))}</td>
            ${d.can_apply?`<td><button class="btn ghost sm" data-d="${esc(a.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
          </tr>`).join('')}</tbody></table></div>`
        :`<div class="he-empty">${icon('inbox')||''}<div style="margin-top:8px">해당 조건의 신청 내역이 없습니다. [맞춤 추천]에서 등록할 수 있습니다.</div></div>`}`);
      const $=x=>host.querySelector(x);
      $('#apYear').onchange=e=>{ year=e.target.value; draw(); };
      $('#apSt').onchange=e=>{ fSt=e.target.value; draw(); };
      let t=null; $('#apQ').oninput=e=>{ clearTimeout(t); t=setTimeout(()=>{ q=e.target.value; draw(); },250); };
      host.querySelectorAll('[data-st]').forEach(sel=>sel.onchange=async()=>{
        const a=d.apply.find(x=>x.id===sel.dataset.st); if(!a) return;
        const up={ ...a, status:sel.value, doneAt:sel.value==='수강완료'?nowISO():(a.doneAt||'') };
        const r=await HR.api('put',{ name:'apply', item:up });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'변경 실패'); draw(); return; }
        d.apply=d.apply.map(x=>x.id===a.id?up:x); toast(`상태를 '${sel.value}'로 변경했습니다`); draw();
      });
      host.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 신청 내역을 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'apply', id:b.dataset.d });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.apply=d.apply.filter(x=>x.id!==b.dataset.d); toast('삭제했습니다'); draw();
      });
    };
    draw();
  });

  /* ───────────────────── 4-6 나의 교육·잔여한도 ───────────────────── */
  page('hr.mypage','나의 교육·잔여한도','본인의 교육 신청 내역과 남은 교육비입니다.',
  async function(host, s){
    loading(host,s);
    const d=await loadMany(['apply','legal'],s); if(!d||!host.isConnected) return;
    const me=s.me||{};
    /* 서버가 본인 행만 내려주는 경우(일반 직원)와 전체를 보는 경우(담당자) 모두 대응 */
    const mine=d.apply.filter(a=>!a.staffLogin || a.staffLogin===me.loginId || a.staffName===me.name);
    const year=thisYear();
    const inYear=mine.filter(a=>yearOf(a.appliedAt)===year);
    const used=inYear.reduce((t,a)=>t+(Number(a.price)||0),0);
    const left=Math.max(0,BUDGET-used), rate=Math.round(used/BUDGET*100);

    /* 나의 법정의무교육 — 영상 시청 후 [이수 요청] → 인사담당자 승인 시 '이수'로 바뀐다 */
    const L_ST={ '미이수':['#8a8f98','#eef0f3'], '요청':['#b4530a','#fff4e6'], '이수':['#12886a','#e6f7f0'] };
    const courses=d.legal.filter(x=>x.kind==='course');
    const myRec=c=>d.legal.find(x=>x.kind==='record'&&x.courseId===c.id&&x.year===year
      &&(x.staffLogin===me.loginId||x.staffName===me.name));
    const legalHtml=()=>{
      if(!courses.length) return '';
      const doneN=courses.filter(c=>{ const r=myRec(c); return r&&r.status==='이수'; }).length;
      return `<div class="he-sec">${icon('shield')||icon('check')||''} 나의 법정의무교육
          <span class="muted">${esc(year)}년 · ${doneN}/${courses.length}건 이수</span></div>
        <div class="he-wrap" style="margin-bottom:6px"><table class="he-tbl">
          <thead><tr><th>교육명</th><th style="width:130px">주기</th><th style="width:90px" class="mid">영상</th>
            <th style="width:96px" class="mid">상태</th><th style="width:116px" class="act"></th></tr></thead>
          <tbody>${courses.map(c=>{ const r=myRec(c), st=(r&&r.status)||'미이수', col=L_ST[st]||L_ST['미이수'];
            return `<tr>
              <td><b>${esc(c.name||'')}</b></td><td>${esc(c.cycle||'')||'<span class="muted">-</span>'}</td>
              <td class="mid">${c.url?`<a href="${esc(c.url)}" target="_blank" rel="noopener">시청 ↗</a>`:'<span class="muted">-</span>'}</td>
              <td class="mid"><span class="he-st" style="color:${col[0]};background:${col[1]}">${esc(st)}</span></td>
              <td class="act">${st==='미이수'
                ?`<button class="btn sm" data-lreq="${esc(c.id)}">${icon('check')||''}이수 요청</button>`
                :st==='요청'?'<span class="muted" style="font-size:11.5px">승인 대기 중</span>':''}</td>
            </tr>`; }).join('')}</tbody></table></div>`;
    };

    const paint=()=>{
    shell(host,s,`
      <div class="he-kpi">
        <div class="he-k"><div class="v">${fmtNum(BUDGET)}<small>원</small></div><div class="l">${esc(year)}년 연간 한도</div></div>
        <div class="he-k"><div class="v">${fmtNum(used)}<small>원</small></div><div class="l">사용 금액</div></div>
        <div class="he-k"><div class="v" style="color:${left?'var(--ok)':'var(--danger)'}">${fmtNum(left)}<small>원</small></div><div class="l">잔여 금액</div>
          <div class="he-bw"><div class="he-bb ${rate>100?'over':rate>80?'warn':''}" style="width:${Math.min(100,rate)}%"></div></div></div>
        <div class="he-k"><div class="v">${inYear.filter(a=>a.status==='수강완료').length}<small>건</small></div><div class="l">이수 완료 · 신청 ${inYear.length}건</div></div>
      </div>
      ${legalHtml()}
      <div class="he-sec">${icon('clipboard')||''} 나의 신청 내역 <span class="muted">${mine.length}건</span></div>
      ${mine.length?`<div class="he-wrap"><table class="he-tbl">
        <thead><tr><th>강의</th><th style="width:110px">카테고리</th><th style="width:90px">금액</th>
          <th style="width:88px">상태</th><th style="width:96px">신청일</th></tr></thead>
        <tbody>${mine.sort((a,b)=>String(b.appliedAt).localeCompare(String(a.appliedAt))).map(a=>`<tr>
          <td><b>${esc(a.title||'')}</b>${a.platform?`<div class="muted" style="font-size:11px">${esc(a.platform)}</div>`:''}</td>
          <td>${a.category?`<span class="he-tag">${esc(a.category)}</span>`:'<span class="muted">-</span>'}</td>
          <td class="num">${fmtNum(a.price||0)}원</td><td>${stBadge(a.status)}</td>
          <td>${esc(String(a.appliedAt||'').slice(0,10))}</td></tr>`).join('')}</tbody></table></div>`
      :`<div class="he-empty">${icon('inbox')||''}<div style="margin-top:8px">아직 신청한 교육이 없습니다.</div>
        <div style="font-size:12px;margin-top:4px">인사담당자가 [맞춤 추천]으로 등록하거나, 필요한 교육을 요청하세요.</div></div>`}`);

    /* 이수 요청 — 본인 행만 쓸 수 있도록 staffLogin 을 함께 저장(서버가 검사) */
    host.querySelectorAll('[data-lreq]').forEach(b=>b.onclick=async()=>{
      const c=courses.find(x=>x.id===b.dataset.lreq); if(!c) return;
      if(!confirm(`'${c.name}' 영상을 모두 시청하셨나요? 이수를 요청합니다.`)) return;
      const cur=myRec(c);
      const item={ id:(cur&&cur.id)||uuid(), kind:'record', year, courseId:c.id,
        staffId:(cur&&cur.staffId)||'', staffName:me.name||'', staffLogin:me.loginId||'',
        status:'요청', reqAt:nowISO(), doneAt:'' };
      b.disabled=true; const r=await HR.api('put',{ name:'legal', item });
      if(r.relock){ s.relock(); return; }
      if(!r.ok){ b.disabled=false; toast(r.error||'요청 실패'); return; }
      toast('이수를 요청했습니다 · 인사담당자 승인 후 처리됩니다');
      d.legal=cur?d.legal.map(x=>x.id===item.id?item:x):d.legal.concat([item]);
      paint();
    });
    };
    paint();
  });

  /* ───────────────────── 4-7 교육 후기 ───────────────────── */
  page('hr.review','교육 후기','이수한 교육에 대한 후기입니다. 별점과 함께 남겨 주시면 다음 추천에 도움이 됩니다.',
  async function(host, s){
    loading(host,s);
    const d=await loadMany(['review','apply'],s); if(!d||!host.isConnected) return;
    const me=s.me||{};
    const stars=n=>'★'.repeat(Math.max(0,Math.min(5,Number(n)||0)))+'☆'.repeat(5-Math.max(0,Math.min(5,Number(n)||0)));
    /* 후기를 쓸 수 있는 대상 = 본인의 '수강완료' 건 중 아직 후기가 없는 것 */
    const done=d.apply.filter(a=>a.status==='수강완료' && (!a.staffLogin || a.staffLogin===me.loginId || a.staffName===me.name))
      .filter(a=>!d.review.some(v=>v.applyId===a.id));
    const draw=()=>{
      const list=d.review.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));
      const avg=list.length?(list.reduce((t,v)=>t+(Number(v.stars)||0),0)/list.length).toFixed(1):'-';
      shell(host,s,`
        <div class="he-kpi">
          <div class="he-k"><div class="v">${list.length}<small>건</small></div><div class="l">등록된 후기</div></div>
          <div class="he-k"><div class="v"><span class="he-star">${avg==='-'?'-':stars(Math.round(avg))}</span></div><div class="l">평균 별점 ${avg}</div></div>
        </div>
        ${d.can_review?(done.length?`<div class="he-f" id="rvForm">
          <div class="wide"><label>후기를 남길 교육</label><select id="rvApply">${done.map(a=>`<option value="${esc(a.id)}">${esc(a.title)} (${esc(String(a.appliedAt||'').slice(0,10))})</option>`).join('')}</select></div>
          <div><label>별점</label><select id="rvStar">${[5,4,3,2,1].map(n=>`<option value="${n}">${stars(n)} ${n}점</option>`).join('')}</select></div>
          <div class="wide"><label>후기</label><textarea id="rvText" placeholder="도움이 된 점, 아쉬운 점을 적어 주세요"></textarea></div>
          <div class="a"><button class="btn pri sm" id="rvSave">${icon('check')||''}후기 등록</button></div>
        </div>`:`<div class="nx-note" style="font-size:12.5px;margin-bottom:12px">${icon('info')||''} 후기를 남길 수 있는 <b>수강완료</b> 교육이 없습니다. 교육을 이수하면 여기에서 후기를 남길 수 있습니다.</div>`):''}
        ${list.length?`<div class="he-feed">${list.map(v=>`<div class="he-card course">
          <div class="he-star">${stars(v.stars)}</div>
          <div class="t">${esc(v.title||'')}</div>
          <div class="m">${esc(v.by||'')} · ${esc(String(v.at||'').slice(0,10))}</div>
          ${v.text?`<div class="c">${esc(v.text)}</div>`:''}
          ${(v.byId&&v.byId===me.loginId)?`<div style="margin-top:8px"><button class="btn ghost sm" data-del="${esc(v.id)}" style="color:var(--danger)">삭제</button></div>`:''}
        </div>`).join('')}</div>`
        :`<div class="he-empty">${icon('inbox')||''}<div style="margin-top:8px">아직 등록된 후기가 없습니다.</div></div>`}`);
      const save=host.querySelector('#rvSave');
      if(save) save.onclick=async()=>{
        const ap=d.apply.find(a=>a.id===host.querySelector('#rvApply').value); if(!ap) return;
        const item={ id:uuid(), applyId:ap.id, title:ap.title||'', catalogId:ap.catalogId||'',
          by:me.name||'', byId:me.loginId||'', stars:Number(host.querySelector('#rvStar').value)||5,
          text:(host.querySelector('#rvText').value||'').trim(), at:nowISO() };
        save.disabled=true; const r=await HR.api('put',{ name:'review', item }); save.disabled=false;
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'등록 실패'); return; }
        d.review.push(item); done.splice(done.findIndex(a=>a.id===ap.id),1);
        toast('후기를 등록했습니다'); draw();
      };
      host.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 후기를 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'review', id:b.dataset.del });
        if(r.relock){ s.relock(); return; }
        if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.review=d.review.filter(x=>x.id!==b.dataset.del); toast('삭제했습니다'); draw();
      });
    };
    draw();
  });
})();
