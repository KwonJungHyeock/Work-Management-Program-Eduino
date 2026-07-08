/* ===========================================================================
   앱 셸: 사이드바 · 상단바 · 상태바 렌더 + 해시 라우팅
   모듈은 window.MODULES[key] = { title, subtitle, icon, flush?, render(el) } 로 등록
   =========================================================================== */
window.MODULES = window.MODULES || {};

function bootShell(){
  const me = requireAuth('');
  if(!me) return;

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
      <div class="quicklinks" id="quicklinks"></div>
      <div class="presence" id="presence" title="실시간 접속자 현황은 공용 서버 연동(예정) 후 표시됩니다">
        <span class="dot"></span><span id="presenceTxt">이 기기만 접속 중</span></div>
      <div class="device">
        <div class="av" id="devAv"></div>
        <div class="meta"><b id="devName"></b><br><small>이 PC</small></div>
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
  // 설정 백업/복원 (백엔드 없이 파일로 세팅 보존·이전)
  const backupBtn=el('button','qlink'); backupBtn.type='button'; backupBtn.id='btnBackup'; backupBtn.title='설정 백업/복원 (.json)';
  backupBtn.innerHTML=`${icon('save')}<span>설정 백업</span>`; backupBtn.onclick=openBackup; ql.appendChild(backupBtn);

  // 로고 클릭 → 인트로 재생 후 홈으로
  const intro=$('appIntro');
  function playIntro(then){ intro.classList.add('show'); setTimeout(()=>{ intro.classList.remove('show'); if(then)then(); }, 1400); }
  $('brandBtn').onclick=()=>playIntro(()=>{ location.hash=''; });

  // 기기 정보
  $('devName').textContent = me.device;
  $('devAv').textContent = me.device.replace(/[^0-9A-Za-z가-힣]/g,'').slice(0,2).toUpperCase() || 'PC';

  // 내비게이션
  const DEPT_COLOR = { cs:'#4d9bff', md:'#ff5257', design:'#b07cff', acct:'#42c98a' };
  const nav = $('nav');
  NAV.forEach(g=>{
    const grp = el('div','nav-group'+(g.soon?' soon':''));
    grp.style.setProperty('--dept', DEPT_COLOR[g.dept]||'#8b93a1');
    grp.innerHTML = `<div class="nav-glabel">${icon(g.icon)}<span class="txt">${esc(g.name)} · ${esc(g.full)}</span>
      ${g.soon?'<span class="badge soon cnt">예정</span>':''}</div>`;
    g.items.forEach(it=>{
      const soon = g.soon || it.soon;
      const item = el('div','nav-item'+(soon?' soon':''));
      item.dataset.key = it.key;
      item.innerHTML = `${icon(it.icon||'chevron')}<span class="txt">${esc(it.name)}</span>${soon?'<span class="badge soon">예정</span>':''}`;
      if(!soon) item.onclick = ()=>{ location.hash = it.key; };
      else item.onclick = ()=>toast('개발 예정 기능입니다');
      grp.appendChild(item);
    });
    nav.appendChild(grp);
  });

  $('btnLogout').onclick = ()=>{ Auth.logout(); location.href='index.html'; };
  $('navToggle').onclick = ()=>app.classList.toggle('nav-collapsed');
  $('presence').onclick = ()=>toast('여러 PC의 실시간 접속 현황은 서버 연동(개발 예정) 후 제공됩니다');

  function firstKey(){ for(const g of NAV) if(!g.soon) for(const it of g.items) if(!it.soon) return it.key; }

  function route(){
    const key = location.hash.replace('#','') || firstKey();
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
      `<div class="seg">${icon('monitor')}<span>기기</span><b>${esc(me.device)}</b></div>
       <div class="seg ok">${icon('check')}<span>접속 코드 인증됨</span></div>
       <div class="seg">${icon('users')}<span>접속</span><b>1</b><span>(이 기기)</span></div>
       <div class="sp"></div>
       <div class="seg">${esc(APP_NAME)} · 초안(Draft)</div>`;
  }

  // ---- 설정 백업/복원 오버레이 ----
  function openBackup(){
    const keys=Object.keys(localStorage).filter(k=>k.startsWith('eduino.'));
    const ov=el('div','modal-ov');
    ov.innerHTML=`
      <div class="modal">
        <div class="modal-hd">${icon('save')}<b>설정 백업 / 복원</b><button class="btn ghost sm" id="mClose">${icon('x')}</button></div>
        <div class="modal-bd">
          <p style="font-size:13.5px;line-height:1.65;color:var(--ink-2)">이 프로그램은 백엔드 없이 <b>이 브라우저(이 PC)에만</b> 설정을 저장합니다. 브라우저 캐시를 지우면 설정이 사라지므로, 아래에서 <b>설정 파일(.json)</b>로 백업해 두세요. 다른 PC·직원과 세팅을 공유할 때도 이 파일을 쓰면 됩니다.</p>
          <div class="muted" style="font-size:12.5px;margin:10px 0">백업 대상: 플랫폼·상품 마스터·입점사·발주/CS 연동 설정·분류·상담사·결산 양식·상담 메모 등 저장된 <b>${keys.length}</b>개 항목</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn pri" id="mExport">${icon('download')}설정 내보내기(.json)</button>
            <button class="btn" id="mImport">${icon('upload')}설정 불러오기</button>
            <input type="file" id="mFile" accept=".json,application/json" class="hidden">
          </div>
          <div class="note warn" style="margin-top:12px;font-size:12.5px">불러오기를 하면 현재 이 브라우저의 설정을 <b>덮어씁니다</b>. 필요하면 먼저 내보내기로 백업하세요. (상담 메모 등 데이터도 함께 포함됩니다)</div>
        </div>
      </div>`;
    document.body.appendChild(ov);
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

  window.addEventListener('hashchange', route);
  setStatus(); route();
}
document.addEventListener('DOMContentLoaded', bootShell);
