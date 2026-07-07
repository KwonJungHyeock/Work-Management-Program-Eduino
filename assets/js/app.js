/* ===========================================================================
   공용 스크립트: 목업 인증 · 세션 · 셸 렌더 · 공통 유틸
   =========================================================================== */
const SESSION_KEY = 'eduino.session';

/* ---- 세션 (localStorage 기반 목업) ---- */
const Auth = {
  login(id, pw){
    const emp = EMPLOYEES.find(e => e.id === id && e.pw === pw);
    if(!emp) return null;
    const user = { id: emp.id, name: emp.name, dept: emp.dept, role: emp.role };
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  },
  current(){
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  },
  logout(){ localStorage.removeItem(SESSION_KEY); },
};

/* 로그인 필요한 페이지 상단에서 호출. base = 루트까지 상대경로('' 또는 '../../') */
function requireAuth(base){
  const u = Auth.current();
  if(!u){ location.href = base + 'index.html'; return null; }
  return u;
}

/* ---- 공용 앱바 렌더 ---- */
function renderAppbar(el, user, base){
  const initial = (user.name || user.id || '?').slice(0,1);
  el.innerHTML = `
    <div class="mk"></div>
    <a class="brand" href="${base}dashboard.html">Eduino <span>Works</span></a>
    <div class="div"></div>
    <div class="title">통합 업무관리</div>
    <div class="sp"></div>
    <div class="who"><span class="avatar">${esc(initial)}</span>
      <span><b>${esc(user.name)}</b> · ${esc(user.role)}</span></div>
    <button class="btn sm ghost" id="btnLogout"><span class="ic">⎋</span>로그아웃</button>`;
  const out = el.querySelector('#btnLogout');
  if(out) out.onclick = () => { Auth.logout(); location.href = base + 'index.html'; };
}

/* ---- 유틸 ---- */
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function $(id){return document.getElementById(id);}
function el(tag, cls, html){const n=document.createElement(tag);if(cls)n.className=cls;if(html!=null)n.innerHTML=html;return n;}

function toast(msg){
  let t = document.querySelector('.toast');
  if(!t){ t = el('div','toast'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 1900);
}

function copyText(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text).then(()=>toast('복사했습니다')).catch(()=>fallbackCopy(text));
  }
  fallbackCopy(text);
}
function fallbackCopy(text){
  const ta = el('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('복사했습니다'); }catch{ toast('복사 실패'); }
  ta.remove();
}

/* 부서별 localStorage 저장 헬퍼 (초안 데이터 보관) */
function store(key){
  const K = 'eduino.'+key;
  return {
    get(def){ try{ return JSON.parse(localStorage.getItem(K)) ?? def; }catch{ return def; } },
    set(v){ localStorage.setItem(K, JSON.stringify(v)); },
  };
}
