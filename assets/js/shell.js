/* ===========================================================================
   앱 셸: 사이드바 · 상단바 · 상태바 렌더 + 해시 라우팅
   모듈은 window.MODULES[key] = { title, subtitle, icon, flush?, render(el) } 로 등록
   =========================================================================== */
window.MODULES = window.MODULES || {};

function bootShell(){
  const me = requireAuth('');
  if(!me) return;
  let presenceCount = 1;

  // 공용 설정 자동 받기(옵션): 세션당 1회, 적용되면 새로고침 후 최신 설정으로 렌더
  if(window.SyncStore && SyncStore.configured() && SyncStore.getCfg().autoPull && !sessionStorage.getItem('eduino.pulled')){
    sessionStorage.setItem('eduino.pulled','1');
    SyncStore.pullSettings().then(r=>{ if(r && r.applied) location.reload(); }).catch(()=>{});
  }

  const app = el('div','app'); app.id='app';
  app.innerHTML = `
    <aside class="side">
      <button class="side-brand" id="brandBtn" title="홈으로 이동">
        <img class="brand-mark" src="assets/brand/eduino-mark.svg" alt="에듀이노">
        <span class="nm"><b>에듀이노</b><small>통합 업무관리</small></span></button>
      <nav class="side-nav sc" id="nav"></nav>
      <div class="side-foot">
        <button class="btn ghost block" id="btnLogout" style="justify-content:flex-start">${icon('logout')}<span class="txt">로그아웃</span></button>
      </div>
    </aside>
    <header class="top">
      <div class="navtoggle" id="navToggle" title="메뉴 접기/펼치기">${icon('menu')}</div>
      <div class="crumb" id="crumb"></div>
      <div class="sp"></div>
      <div class="syncchip ok" id="syncChip" title="상담·발주는 서버에 저장됩니다. 구글시트 백업 미전송분은 90초마다 자동 재시도됩니다.">${icon('check')}<span>저장 정상</span></div>
      <div class="quicklinks" id="quicklinks"></div>
      <div class="presence" id="presence" title="실시간 접속자 현황은 공용 서버 연동(예정) 후 표시됩니다">
        <span class="dot"></span><span id="presenceTxt">이 기기만 접속 중</span></div>
      <div class="device">
        <div class="av" id="devAv"></div>
        <div class="meta"><b id="devName"></b><br><small id="devRole">이 PC</small></div>
      </div>
    </header>
    <main class="main sc" id="main"></main>
    <footer class="status" id="status"></footer>
    <div class="app-intro" id="appIntro">
      <div class="ai-mark"><img src="assets/brand/eduino-mark.svg" alt="에듀이노"><div class="ai-nm">${esc(APP_NAME_FULL)}</div></div>
    </div>`;
  document.body.innerHTML=''; document.body.appendChild(app);

  // 상단 사내 바로가기 링크
  const ql=$('quicklinks');
  (typeof QUICK_LINKS!=='undefined'?QUICK_LINKS:[]).forEach(l=>{
    const a=el('a','qlink'); a.href=l.url; a.target='_blank'; a.rel='noopener noreferrer'; a.title=l.name;
    a.innerHTML=`${icon('external')}<span>${esc(l.name)}</span>`; ql.appendChild(a);
  });
  // 설정 백업/복원 (관리자 전용 · 팀원은 실무만) — 설정은 관리자가 일괄 관리
  if(me.user && me.user.role==='admin'){
    const backupBtn=el('button','qlink'); backupBtn.type='button'; backupBtn.id='btnBackup'; backupBtn.title='설정 백업/복원 (.json)';
    backupBtn.innerHTML=`${icon('save')}<span>설정 백업</span>`; backupBtn.onclick=openBackup; ql.appendChild(backupBtn);
  }

  // 로고 클릭 → 인트로 재생 후 홈으로
  const intro=$('appIntro');
  function playIntro(then){ intro.classList.add('show'); setTimeout(()=>{ intro.classList.remove('show'); if(then)then(); }, 1400); }
  $('brandBtn').onclick=()=>playIntro(()=>{ location.hash=''; });

  // 로그인 사용자 정보
  const deptLabel = { cs:'CS · 고객 상담', md:'MD · 상품 기획', admin:'관리자' };
  const uName = (me.user && me.user.name) || me.device || '';
  $('devName').textContent = uName;
  $('devRole').textContent = (me.user && (deptLabel[me.user.dept] || (me.user.role==='admin'?'관리자':'')) ) || '이 PC';
  $('devAv').textContent = uName.replace(/[^0-9A-Za-z가-힣]/g,'').slice(0,2).toUpperCase() || 'PC';

  // 계정 권한 (관리자가 기능별로 부여 · 관리자는 전체 · 공통(홈)은 누구나)
  const isAdmin = !!(me.user && me.user.role==='admin');
  const myDept = me.user && me.user.dept;
  const isLead = !!(me.user && me.user.role==='lead' && (myDept==='cs'||myDept==='md'));   // 파트장(직무별)
  const perms = Array.isArray(me.user && me.user.perms) ? me.user.perms : null;
  const commonDepts = new Set(NAV.filter(g=>g.common).map(g=>g.dept));
  const deptOpen = new Set(typeof DEPT_OPEN_KEYS!=='undefined'?DEPT_OPEN_KEYS:[]);
  const hasPerm = (key)=>{ const d=String(key||'').split('.')[0];
    if(commonDepts.has(d)) return true;
    if(isAdmin) return true;
    if(isLead && key==='admin.insights') return true;  // 파트장 → 자기 파트 업무 현황
    if(deptOpen.has(key) && d===myDept) return true;   // 누적 시트 등 직무 기본 열람
    if(perms) return perms.includes(key);
    return d===myDept; };   // 폴백(권한정보 없는 옛 계정)
  const canAccess = (key)=>{ const d=String(key||'').split('.')[0];
    if(commonDepts.has(d)) return true;
    if(d==='admin') return isAdmin || (isLead && key==='admin.insights');
    return hasPerm(key); };

  // 내비게이션 — 공통(홈)은 항상, CS·MD는 표시하되 권한 없는 기능은 잠금
  const DEPT_COLOR = { home:'#5b6b7f', cs:'#4d9bff', md:'#ff5257', admin:'#f0a020' };
  const nav = $('nav');
  NAV.forEach(g=>{
    if(g.adminOnly && !isAdmin) return;              // 관리자 전용은 관리자만
    const grp = el('div','nav-group'+(g.common?' nav-group-top':''));
    grp.style.setProperty('--dept', DEPT_COLOR[g.dept]||'#8b93a1');
    // 홈(공통)은 제목 없이 버튼만 — 업무 기능이 메인이므로 상단은 간결하게
    grp.innerHTML = g.common ? '' : `<div class="nav-glabel"><span class="gi">${icon(g.icon)}</span>
      <span class="gtx"><b>${esc(g.name)}</b><small>${esc(g.full)}</small></span></div>`;
    g.items.forEach(it=>{
      const locked = !g.common && g.dept!=='admin' && !hasPerm(it.key);
      const item = el('div','nav-item'+(locked?' locked':'')); item.dataset.key = it.key;
      item.innerHTML = `${icon(it.icon||'chevron')}<span class="txt">${esc(it.name)}</span>${locked?`<span class="lock">${icon('lock')}</span>`:`<span class="nav-badge" style="display:none;margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--danger);color:#fff;font-size:11px;font-weight:800;line-height:18px;text-align:center"></span>`}`;
      item.onclick = ()=>{ location.hash = it.key; };
      grp.appendChild(item);
    });
    nav.appendChild(grp);
  });

  // 파트장 전용 그룹 — 자기 파트 업무 현황 (관리자는 관리자 그룹에서 접근)
  if(isLead && !isAdmin){
    const lg=el('div','nav-group'); lg.style.setProperty('--dept', DEPT_COLOR[myDept]||'#8b93a1');
    lg.innerHTML=`<div class="nav-glabel"><span class="gi">${icon('shield')}</span>
      <span class="gtx"><b>파트 관리</b><small>${myDept==='cs'?'CS':'MD'} 파트장</small></span></div>`;
    const it=el('div','nav-item'); it.dataset.key='admin.insights';
    it.innerHTML=`${icon('chart')}<span class="txt">우리 파트 현황</span>`;
    it.onclick=()=>{ location.hash='admin.insights'; };
    lg.appendChild(it); nav.appendChild(lg);
  }

  // 사이드바 알림 배지 — 미처리 콜백(CS·관리자) · 안 읽은 공지(전원)
  const setBadge=(key,n)=>{ const s=nav.querySelector(`.nav-item[data-key="${key}"] .nav-badge`); if(!s) return;
    s.textContent = n>99?'99+':(n||''); s.style.display = n?'':'none'; };
  async function fetchColl(coll){ try{ const r=await fetch('/api/store?type=coll&coll='+coll); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }
  const noticeVisible=(dept)=>{ dept=dept||'all'; return dept==='all'||dept===myDept||isAdmin; };
  async function updateBadges(){
    try{
      const uid=me.user.loginId;
      let cbOpen=0, unreadN=0, myMemo=0;
      if(isAdmin || myDept==='cs'){ const cbs=await fetchColl('callbacks'); if(cbs){ cbOpen=cbs.filter(c=>!c.done).length; setBadge('cs.notes', cbOpen); } }
      const nts=await fetchColl('notice');
      if(nts){ unreadN=nts.filter(x=>noticeVisible(x.dept) && !((x.readBy||[]).includes(uid))).length; setBadge('home.notice', unreadN); }
      const mms=await fetchColl('memo');
      if(mms){ myMemo=mms.filter(m=>!m.done && noticeVisible(m.to||'all') && m.author!==uid).length; }
      // 알림 = 미확인 공지 + 나에게 온 메모 + (CS/관리자) 미처리 콜백
      setBadge('home.alerts', unreadN + myMemo + cbOpen);
    }catch(e){}
  }
  window.refreshNavBadges = updateBadges;
  updateBadges();
  setInterval(updateBadges, 90000);
  window.addEventListener('focus', updateBadges);
  window.addEventListener('hashchange', ()=>setTimeout(updateBadges, 800));

  // 동기화 상태 칩 — 구글시트 백업 미전송분(내부 서버 저장은 별개로 정상)
  function updateSyncChip(){
    const chip=$('syncChip'); if(!chip) return; let pending=0;
    const cnt=(key)=>{ try{ (JSON.parse(localStorage.getItem(key)||'[]')||[]).forEach(r=>{ if(r&&r.synced===false) pending++; }); }catch(e){} };
    cnt(STORE.csNotes); cnt('eduino.md.orders');
    if(pending>0){ chip.className='syncchip warn'; chip.innerHTML=`${icon('cloudUp')}<span>백업 미전송 ${pending>99?'99+':pending}</span>`; }
    else { chip.className='syncchip ok'; chip.innerHTML=`${icon('check')}<span>저장 정상</span>`; }
  }
  window.refreshSyncChip = updateSyncChip;
  updateSyncChip();
  setInterval(updateSyncChip, 15000);
  window.addEventListener('focus', updateSyncChip);
  window.addEventListener('hashchange', ()=>setTimeout(updateSyncChip, 400));

  $('btnLogout').onclick = ()=>{ Auth.logout(); location.href='index.html'; };
  $('navToggle').onclick = ()=>app.classList.toggle('nav-collapsed');
  $('presence').onclick = ()=>toast('여러 PC의 실시간 접속 현황은 서버 연동(개발 예정) 후 제공됩니다');

  function firstKey(){
    for(const g of NAV){
      if(g.adminOnly){ if(isAdmin && g.items.length) return g.items[0].key; continue; }
      for(const it of g.items) if(hasPerm(it.key)) return it.key;
    }
    for(const g of NAV){ if(!g.adminOnly && g.items.length) return g.items[0].key; }  // 권한 없으면 첫 항목(잠금 화면)
    return '';
  }

  function route(){
    let key = location.hash.replace('#','') || firstKey();
    if(key && !canAccess(key)){
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('on', n.dataset.key===key));
      const main=$('main'); main.className='main sc';
      main.innerHTML=`<div class="view"><div class="perm-deny">${icon('lock')}
        <div class="pd-t">접근 권한이 없습니다</div>
        <div class="pd-d">이 기능은 계정에 부여된 권한이 없습니다.<br>필요하시면 관리자(팀장)에게 요청하세요.</div></div></div>`;
      setCrumb(key); return;
    }
    const mod = MODULES[key];
    // 활성 표시
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('on', n.dataset.key===key));
    const main = $('main');
    if(!mod){ main.className='main sc'; main.innerHTML=`<div class="view"><div class="empty">${icon('info')}<div>준비 중인 기능입니다.</div></div></div>`; setCrumb(key); return; }
    setCrumb(key, mod);
    main.className = 'main sc'+(mod.flush?' flush':'');
    main.style.position = mod.flush?'relative':'';
    main.style.overflow = '';   // 모듈이 자체 스크롤을 쓰면 render 안에서 재설정
    main.innerHTML='';
    mod.render(main, { me });
  }
  function setCrumb(key, mod){
    const [dept] = key.split('.');
    const g = NAV.find(x=>x.dept===dept);
    $('crumb').innerHTML = `<span class="s">${esc(g?g.name:'')}</span>${icon('chevron')}
      <span class="t">${esc(mod?mod.title:'')}</span>`;
    document.title = (mod?mod.title+' · ':'')+APP_NAME;
  }
  function setStatus(){
    $('status').innerHTML =
      `<div class="seg">${icon('monitor')}<span>사용자</span><b>${esc(uName)}</b>${me.user&&me.user.dept?`<span>· ${esc(deptLabel[me.user.dept]||me.user.dept)}</span>`:''}</div>
       <div class="seg ok">${icon('check')}<span>로그인됨</span></div>
       <div class="seg">${icon('users')}<span>접속</span><b>${presenceCount}</b><span>${presenceCount>1?'명':'(이 기기)'}</span></div>
       <div class="sp"></div>
       <div class="seg">${esc(APP_NAME)} · 초안(Draft)</div>`;
  }

  // ---- 설정 백업/복원 오버레이 ----
  function openBackup(){
    const keys=Object.keys(localStorage).filter(k=>k.startsWith('eduino.'));
    const ov=el('div','modal-ov');
    ov.innerHTML=`
      <div class="modal">
        <div class="modal-hd">${icon('save')}<b>연동 상태 · 설정 백업</b><button class="btn ghost sm" id="mClose">${icon('x')}</button></div>
        <div class="modal-bd">
          <div id="integStatus" style="margin-bottom:16px"></div>
          <div style="border-top:1px solid var(--line);margin:0 0 14px"></div>
          <p style="font-size:13.5px;line-height:1.65;color:var(--ink-2)">설정은 <b>서버(공용 저장소)에 저장·공유</b>됩니다. 관리자가 설정하면 <b>팀원 전체에 자동 반영</b>되고, 브라우저 캐시를 지워도 <b>다시 접속하면 복원</b>됩니다. 아래 <b>.json 백업</b>은 만약을 위한 추가 안전장치입니다.</p>
          <div class="muted" style="font-size:12.5px;margin:10px 0">백업 대상: 플랫폼·상품 마스터·입점사·발주/CS 연동 설정·분류·상담사·결산 양식·상담 메모 등 저장된 <b>${keys.length}</b>개 항목</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn pri" id="mExport">${icon('download')}설정 내보내기(.json)</button>
            <button class="btn" id="mImport">${icon('upload')}설정 불러오기</button>
            <input type="file" id="mFile" accept=".json,application/json" class="hidden">
          </div>
          <div class="note warn" style="margin-top:12px;font-size:12.5px">불러오기를 하면 현재 이 브라우저의 설정을 <b>덮어씁니다</b>. 필요하면 먼저 내보내기로 백업하세요. (상담 메모 등 데이터도 함께 포함됩니다)</div>

          <div style="border-top:1px solid var(--line);margin:16px 0 14px"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <b style="font-size:14px">월간 데이터 백업</b>
            <span class="muted" style="margin-left:auto;font-size:12px">상담·발주 기록(서버)을 월 단위로</span>
          </div>
          <p class="muted" style="font-size:12.5px;line-height:1.6;margin-bottom:8px">선택한 달의 <b>상담 기록 + 발주 기록 전체</b>를 서버에서 받아 JSON 파일 하나로 저장합니다. (매월 백업용)</p>
          <div class="note" id="autoBkNote" style="font-size:12.5px;margin-bottom:10px">${icon('refresh')} <b>자동 백업</b>: 매월 1일 서버가 지난달·이번달 기록을 스냅샷으로 보관합니다. <span id="autoBkStat" class="muted">확인 중…</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
            <input type="month" id="mBkMonth" style="height:36px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;font-size:13px">
            <button class="btn pri sm" id="mBkDown">${icon('download')}이 달 데이터 백업(JSON)</button>
            <span class="muted" id="mBkStat" style="font-size:12.5px"></span>
          </div>

          <div style="border-top:1px solid var(--line);margin:16px 0 14px"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <b style="font-size:14px">공용 저장소 동기화</b>
            <span class="badge ${SyncStore&&SyncStore.configured()?'live':'soon'}" style="margin-left:auto">${SyncStore&&SyncStore.configured()?'연결됨':'미연결'}</span>
          </div>
          <p class="muted" style="font-size:12.5px;line-height:1.6;margin-bottom:10px">팀(4명)이 같은 설정을 공유하고 캐시가 지워져도 <b>[받기]</b>로 복원됩니다. 접속자 현황도 함께 표시됩니다. 두 방식 중 하나를 URL로 지정하세요.
            <br>· <b>Vercel 백엔드(권장)</b>: 아래 <b>[Vercel 백엔드 사용]</b> 클릭 (Vercel에 KV 스토어 연결 필요, CORS 없음·자동)
            <br>· 구글시트: <span class="mono" style="font-size:11.5px">google-apps-script-sync.gs</span> 배포 후 <span class="mono">/exec</span> URL 입력</p>
          <label class="fld" style="margin-bottom:10px">웹 앱 URL<input type="text" id="mSyncUrl" placeholder="https://script.google.com/macros/s/……/exec"></label>
          <label class="chk" style="margin-bottom:8px;font-size:13px"><input type="checkbox" id="mAutoPull"> 접속(부팅) 시 공용 설정 자동으로 받기</label>
          <label class="chk" style="margin-bottom:10px;font-size:13px"><input type="checkbox" id="mAutoPush"> 설정 변경 시 공용에 자동으로 올리기 <span class="muted" style="font-weight:400">(수동 [올리기] 불필요)</span></label>
          <div class="note" style="font-size:12px;margin-bottom:10px"><b>[공용에 올리기]</b> 하면 올라가는 항목: <span id="mSyncItems"></span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="btn sm" id="mSyncVercel">${icon('cloud')}Vercel 백엔드 사용</button>
            <button class="btn sm" id="mSyncSave">${icon('check')}저장</button>
            <button class="btn sm pri" id="mSyncPush">${icon('cloudUp')}공용에 올리기</button>
            <button class="btn sm" id="mSyncPull">${icon('download')}공용 설정 받기</button>
            <button class="btn sm" id="mSyncCode">${icon('copy')}구글 설치 코드</button>
            <span class="muted" id="mSyncStat" style="font-size:12.5px"></span>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    // 월간 데이터 백업 — 선택한 달의 상담/발주 기록을 서버에서 받아 JSON 하나로
    // 자동 백업 상태
    (async()=>{ const st=ov.querySelector('#autoBkStat'); if(!st) return;
      try{ const r=await fetch('/api/backup-snapshot?type=meta'); const d=await r.json();
        if(d&&d.ok&&d.lastAt){ const when=new Date(d.lastAt).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
          st.innerHTML=`최근 스냅샷 <b>${esc(d.lastMonth||'')}</b> · ${esc(when)} · 보관 ${d.months?d.months.length:0}개월`; }
        else st.textContent='아직 자동 백업 실행 전(다음 1일에 첫 스냅샷 생성)'; }
      catch(e){ st.textContent='상태 확인 실패'; } })();
    (function(){ const mSel=ov.querySelector('#mBkMonth'); if(!mSel) return;
      const d=new Date(); mSel.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      async function getSheet(dept,sheet,ym){ try{ const r=await fetch(`/api/store?type=sheet&dept=${dept}&sheet=${sheet}&month=${ym}`); if(!r.ok) throw 0; const j=await r.json(); return (j&&j.records)||[]; }catch(e){ return null; } }
      ov.querySelector('#mBkDown').onclick=async()=>{
        const ym=mSel.value, stat=ov.querySelector('#mBkStat');
        if(!/^\d{4}-\d{2}$/.test(ym)){ stat.textContent='월을 선택하세요'; return; }
        stat.textContent='불러오는 중…';
        const [cs,md]=await Promise.all([getSheet('cs','notes',ym), getSheet('md','orders',ym)]);
        if(cs===null||md===null){ stat.innerHTML='<span style="color:var(--danger)">서버에서 불러오지 못했습니다</span>'; return; }
        const payload={ app:'eduino', type:'monthly-data-backup', month:ym, exportedAt:new Date().toISOString(), counts:{ cs:cs.length, md:md.length }, cs, md };
        downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}), `eduino_data_${ym}.json`);
        stat.innerHTML=`<span style="color:var(--ok)">상담 ${cs.length} · 발주 ${md.length}건 저장</span>`;
      };
    })();

    // 연동 상태 (공용 저장소 · CS 상담 시트 · 발주 시트)
    function renderInteg(){
      const rows=[
        { name:'공용 저장소', desc:'팀 설정 공유·접속자 현황', url:(window.SyncStore?SyncStore.getCfg().url:'') },
        { name:'CS 상담 시트', desc:'상담 메모 기록',        url:(store(STORE.csNoteCfg).get({}).sheetUrl||'') },
        { name:'발주 시트',    desc:'입점사 발주 기록',       url:(store(STORE.mdOrderCfg).get({}).sheetUrl||'') },
      ];
      const box=ov.querySelector('#integStatus');
      box.innerHTML=`<div style="font-size:14px;font-weight:800;margin-bottom:9px">연동 상태</div>
        <div class="integ-list">${rows.map((r,i)=>`
          <div class="integ-row">
            <span class="integ-dot ${r.url?'on':'off'}"></span>
            <div class="integ-nm"><b>${esc(r.name)}</b><span>${esc(r.desc)}</span></div>
            <span class="badge ${r.url?'live':'soon'}">${r.url?'연결됨':'미연결'}</span>
            <button class="btn ghost sm" data-test="${i}" ${r.url?'':'disabled'}>테스트</button>
          </div>`).join('')}</div>
        <div class="muted" id="integStat" style="font-size:12px;margin-top:8px"></div>`;
      box.querySelectorAll('[data-test]').forEach(b=>b.onclick=async()=>{
        const r=rows[+b.dataset.test], st=box.querySelector('#integStat');
        st.textContent=`${r.name} 테스트 중…`;
        try{ const res=await fetch(r.url,{method:'GET'}); let d=null; try{d=await res.json();}catch{}
          st.innerHTML = res.ok ? `<span style="color:var(--ok)">${esc(r.name)} 연결 성공${d&&d.sheet?` · 시트 "${esc(d.sheet)}"`:''}</span>`
                                : `<span style="color:var(--danger)">${esc(r.name)} 응답 오류 HTTP ${res.status}</span>`;
        }catch(err){ st.innerHTML=`<span style="color:var(--danger)">${esc(r.name)} 연결 실패: ${esc(err.message)}</span>`; }
      });
    }
    renderInteg();
    // 올라가는 항목 목록
    const items=SHARED_SETTING_KEYS.filter(k=>localStorage.getItem(k)!=null).map(k=>SHARED_LABELS[k]||k);
    ov.querySelector('#mSyncItems').textContent = items.length?items.join(' · '):'(아직 저장된 설정 없음 — 각 기능에서 설정 후 올리기)';

    // 공용 동기화 값 채우기 + 핸들러
    const scfg = (window.SyncStore?SyncStore.getCfg():{url:'',autoPull:false,autoPush:true});
    ov.querySelector('#mSyncUrl').value = scfg.url||'';
    ov.querySelector('#mAutoPull').checked = !!scfg.autoPull;
    ov.querySelector('#mAutoPush').checked = scfg.autoPush!==false;
    const sStat = ov.querySelector('#mSyncStat');
    const readCfg = ()=>({ url:ov.querySelector('#mSyncUrl').value.trim(), autoPull:ov.querySelector('#mAutoPull').checked, autoPush:ov.querySelector('#mAutoPush').checked });
    ov.querySelector('#mSyncVercel').onclick = ()=>{ ov.querySelector('#mSyncUrl').value='/api/store'; ov.querySelector('#mAutoPull').checked=true; ov.querySelector('#mAutoPush').checked=true;
      SyncStore.setCfg({ url:'/api/store', autoPull:true, autoPush:true }); renderInteg(); sStat.innerHTML='Vercel 백엔드(<span class="mono">/api/store</span>)로 설정됨 · [공용에 올리기]로 첫 업로드'; toast('Vercel 백엔드로 설정'); };
    ov.querySelector('#mSyncSave').onclick = ()=>{ SyncStore.setCfg(readCfg()); sStat.textContent='저장했습니다'; renderInteg(); toast('공용 동기화 설정 저장'); };
    ov.querySelector('#mSyncPush').onclick = async(e)=>{ const b=e.currentTarget; b.disabled=true; sStat.textContent='올리는 중…';
      SyncStore.setCfg(readCfg());
      try{ const r=await SyncStore.pushSettings(); sStat.textContent = r.saved?`설정 ${r.saved}개 올림${r.unconfirmed?' (시트에서 확인)':''}`:'올릴 설정 없음'; }
      catch(err){ sStat.textContent='실패: '+err.message; } b.disabled=false; };
    ov.querySelector('#mSyncPull').onclick = async(e)=>{ const b=e.currentTarget; b.disabled=true; sStat.textContent='받는 중…';
      SyncStore.setCfg(readCfg());
      try{ const r=await SyncStore.pullSettings(); sStat.textContent=`설정 ${r.applied}개 적용 · 새로고침합니다`;
        if(r.applied) setTimeout(()=>location.reload(),700); else sStat.textContent='받을 공용 설정이 없습니다'; }
      catch(err){ sStat.textContent='실패: '+err.message; b.disabled=false; } };
    ov.querySelector('#mSyncCode').onclick = async()=>{ try{ const r=await fetch('google-apps-script-sync.gs'); if(!r.ok)throw 0; copyText(await r.text()); }catch{ toast('코드 파일을 불러오지 못했습니다'); } };
    const close=()=>ov.remove();
    ov.addEventListener('click',e=>{ if(e.target===ov) close(); });
    ov.querySelector('#mClose').onclick=close;
    ov.querySelector('#mExport').onclick=()=>{
      const out={ _app:'eduino-works', _exportedAt:nowISO(), device:store(STORE.device).get(''), data:{} };
      Object.keys(localStorage).filter(k=>k.startsWith('eduino.')).forEach(k=>{ out.data[k]=localStorage.getItem(k); });
      downloadBlob(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}), `에듀이노설정_${todayStr()}.json`);
      toast('설정을 내보냈습니다');
    };
    ov.querySelector('#mImport').onclick=()=>ov.querySelector('#mFile').click();
    ov.querySelector('#mFile').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(!f) return;
      const rd=new FileReader();
      rd.onload=()=>{ try{
          const j=JSON.parse(rd.result); const d=(j&&j.data)?j.data:j;
          const entries=Object.entries(d||{}).filter(([k,v])=>k.startsWith('eduino.')&&typeof v==='string');
          if(!entries.length){ toast('올바른 설정 파일이 아닙니다'); return; }
          if(!confirm(`설정 ${entries.length}개 항목을 불러와 현재 설정을 덮어쓸까요?`)) return;
          entries.forEach(([k,v])=>localStorage.setItem(k,v));
          toast('설정을 불러왔습니다 · 새로고침합니다'); setTimeout(()=>location.reload(),700);
        }catch{ toast('파일을 읽지 못했습니다 (JSON 형식 확인)'); } };
      rd.readAsText(f,'utf-8'); };
  }

  // ---- 접속자 현황 (공용 저장소 연동 시) ----
  let presencePop=null, lastPresence=null;
  function renderPresencePop(){
    if(!presencePop) return;
    const list=lastPresence;
    const bd = list==null ? '<div class="muted" style="padding:4px 2px">불러오는 중…</div>'
      : (list.length ? list.map(p=>`<div class="pp-row"><span class="pp-dot"></span><b>${esc(p.device)}</b>${p.device===me.device?'<span class="pp-me">나</span>':''}</div>`).join('')
                     : '<div class="muted" style="padding:4px 2px">표시할 접속자가 없습니다</div>');
    presencePop.innerHTML=`<div class="pp-hd">접속자 현황${list?` <span class="muted">· ${list.length}명</span>`:''}</div><div class="pp-bd">${bd}</div>`;
  }
  function outsidePop(e){ const box=$('presence'); if(presencePop && !presencePop.contains(e.target) && !box.contains(e.target)) closePresencePop(); }
  function closePresencePop(){ if(presencePop){ presencePop.remove(); presencePop=null; } document.removeEventListener('mousedown', outsidePop); }
  function togglePresencePop(){
    if(presencePop){ closePresencePop(); return; }
    const box=$('presence'), r=box.getBoundingClientRect();
    presencePop=el('div','presence-pop');
    presencePop.style.cssText=`position:fixed;top:${Math.round(r.bottom+8)}px;right:${Math.round(window.innerWidth-r.right)}px`;
    document.body.appendChild(presencePop); renderPresencePop();
    SyncStore.presence().then(l=>{ lastPresence=l; renderPresencePop(); });
    setTimeout(()=>document.addEventListener('mousedown', outsidePop),0);
  }
  function startPresence(){
    if(!(window.SyncStore && SyncStore.configured())) return;
    const txt=$('presenceTxt'), box=$('presence');
    async function tick(){
      if(document.hidden) return;               // 탭 숨김 시 폴링 절약(무료 한도 보호)
      await SyncStore.beat();
      const list=await SyncStore.presence();
      if(!list) return;
      lastPresence=list; presenceCount=Math.max(1, list.length);
      txt.textContent=`${presenceCount}명 접속 중`;
      box.title='클릭하면 접속자 목록 보기';
      box.style.cursor='pointer';
      setStatus(); renderPresencePop();
    }
    box.onclick=togglePresencePop;
    tick();
    setInterval(tick, 90000);   // 접속 하트비트 90초(TTL 3분) — KV 명령 수 절감
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tick(); });
  }

  window.addEventListener('hashchange', route);
  setStatus(); route(); startPresence();
}
document.addEventListener('DOMContentLoaded', bootShell);
