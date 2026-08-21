/* ===========================================================================
   업무·요청 통합 뷰모델(WorkList)
   - 업무지시(Assign) + 요청(Req) 두 종류를 '한 줄(row)' 규격으로 정규화
   - 거르기(who·영역·상태·검색·완료포함) · 정렬 · 묶기 · 조건 ↔ 주소(QS) 변환
   - DOM 을 만들지 않는다(그리기는 tasks.js). 저장 형식은 건드리지 않는다.
   =========================================================================== */
(function(){
  const ST      = { wait:'대기', doing:'진행', review:'검토', done:'완료', reject:'반려' };
  const ST_SEQ  = ['wait','doing','review','done','reject'];
  const OPEN_ST = { wait:1, doing:1, review:1 };
  const DEPT    = (window.Duties&&Duties.DEPT_LABEL)||{cs:'CS',md:'MD',logi:'물류',acct:'경리',admin:'관리자'};
  const AREAS   = ['cs','md','logi','acct','admin'].filter(k=>DEPT[k]).map(k=>({k, n:DEPT[k]}));
  const PROG    = { wait:0, doing:50, review:80, done:100, reject:100 };

  const day = s=>String(s||'').slice(0,10);
  const txt = r=>((r.title||'')+' '+(r.detail||'')+' '+(r.owner||'')+' '+(r.from||'')).toLowerCase();

  /* ── 정규화 ── */
  function fromAssign(a){
    const st = a.status==='sent'?'wait' : a.status==='accepted'?'doing' : a.status==='submitted'?'review' : 'done';
    return { kind:'assign', id:a.id, raw:a, title:a.title||'', detail:a.detail||'',
      area:a.toDept||'', owner:a.toName||'', ownerId:a.toId||'', from:a.fromName||'', fromId:a.fromId||'',
      st, stLabel:ST[st], due:day(a.due), pri:a.priority==='urgent'?1:0, prog:PROG[st],
      createdAt:a.createdAt||'', endAt:a.doneAt||'' };
  }
  function fromReq(r){
    const st = r.status==='sent'?'wait' : r.status==='doing'?'doing' : r.status==='done'?'done' : 'reject';
    return { kind:'req', id:r.id, raw:r, title:r.title||'', detail:r.detail||'',
      area:r.fromDept||'', owner:r.toName||'', ownerId:r.toId||'', from:r.fromName||'', fromId:r.fromId||'',
      st, stLabel:ST[st], due:'', pri:0, prog:PROG[st], cat:r.cat||'',
      createdAt:r.createdAt||'', endAt:r.resolvedAt||'' };
  }

  /* ── who(담당) 기준으로 원본 → row 목록
       me   : 나에게 온 것   (배정된 업무지시 + 내가 처리할 요청)
       sent : 내가 보낸 것   (내가 지시한 업무 + 내가 보낸 요청)
       all  : 전체           (업무지시 전체 + 내가 볼 수 있는 요청)
     ※ 요청은 열람 범위를 넓히지 않는다 — 처리자만 남의 요청을 본다(기존 규칙 그대로) */
  function rows(assigns, reqs, me, who){
    assigns=assigns||[]; reqs=reqs||[]; me=me||{};
    const A=window.Assign, R=window.Req;
    const handler = !!(R&&R.isHandler&&R.isHandler(me));
    let as=[], rs=[];
    if(who==='sent'){ as=A?A.fromMe(assigns,me):[]; rs=R?R.fromMe(reqs,me):[]; }
    else if(who==='all'){ as=assigns.slice();
      const inb=(R&&handler)?R.inbox(reqs,me):[], mine=R?R.fromMe(reqs,me):[];
      const seen={}; rs=inb.concat(mine).filter(x=>seen[x.id]?false:(seen[x.id]=1)); }
    else { as=A?A.mine(assigns,me):[]; rs=(R&&handler)?R.inbox(reqs,me):[]; }
    return as.map(fromAssign).concat(rs.map(fromReq));
  }

  /* ── 거르기 ── */
  function apply(list, f){
    f=f||{}; const q=String(f.q||'').trim().toLowerCase();
    const areas=(f.areas||[]).filter(Boolean);
    return (list||[]).filter(r=>{
      if(f.st){ if(r.st!==f.st) return false; }
      else if(!f.done && !OPEN_ST[r.st]) return false;     // 완료 포함 꺼짐 → 완료·반려 숨김
      if(areas.length && areas.indexOf(r.area)<0) return false;
      if(f.kind && r.kind!==f.kind) return false;
      if(q && txt(r).indexOf(q)<0) return false;
      return true;
    });
  }

  /* ── 정렬 ── */
  const SORTS={ due:'기한순', pri:'우선순위순', 'new':'최신 작성순' };
  function sort(list, key){
    const byNew=(a,b)=>String(b.createdAt).localeCompare(String(a.createdAt));
    const byDue=(a,b)=>{ if(!a.due&&!b.due) return byNew(a,b); if(!a.due) return 1; if(!b.due) return -1;
      return a.due<b.due?-1:a.due>b.due?1:byNew(a,b); };
    const arr=(list||[]).slice();
    if(key==='pri') return arr.sort((a,b)=> (b.pri-a.pri) || byDue(a,b));
    if(key==='new') return arr.sort(byNew);
    return arr.sort(byDue);
  }

  /* ── 묶기 ── */
  const GROUPS={ '':'묶지 않음', area:'영역', st:'상태', owner:'담당', due:'기한' };
  function dueBucket(due, today){
    if(!due) return { k:'z', n:'기한 없음' };
    if(due<today) return { k:'a', n:'기한 지남' };
    if(due===today) return { k:'b', n:'오늘' };
    const d=new Date(today); d.setDate(d.getDate()+7);
    return due<=d.toISOString().slice(0,10) ? { k:'c', n:'이번 주' } : { k:'d', n:'이후' };
  }
  function group(list, key, today){
    if(!key) return [{ k:'', name:'', rows:list||[] }];
    today=today||new Date().toISOString().slice(0,10);
    const map={}, order=[];
    (list||[]).forEach(r=>{
      let k,n;
      if(key==='area'){ const i=AREAS.findIndex(a=>a.k===r.area);   // 부서 순서를 그대로 따르게(코드 알파벳순 방지)
        k=(i<0?'99':String(100+i))+(r.area||''); n=DEPT[r.area]||'영역 미지정'; }
      else if(key==='st'){ k=String(ST_SEQ.indexOf(r.st)); n=r.stLabel; }
      else if(key==='owner'){ k=r.owner||'zz'; n=r.owner||'담당 미지정'; }
      else { const b=dueBucket(r.due,today); k=b.k; n=b.n; }
      if(!map[k]){ map[k]={ k, name:n, rows:[] }; order.push(k); }
      map[k].rows.push(r);
    });
    return order.sort().map(k=>{ const g=map[k];
      g.open=g.rows.filter(r=>OPEN_ST[r.st]).length; g.done=g.rows.length-g.open;
      g.rate=g.rows.length?Math.round(g.done/g.rows.length*100):0; return g; });
  }

  /* ── 조건 ↔ 주소(QS) ── 링크를 그대로 보내면 같은 화면이 열린다 */
  const DEFAULTS={ view:'sheet', who:'me', areas:[], st:'', q:'', done:false, sort:'due', group:'' };
  function parseQS(qs){
    const f={ ...DEFAULTS, areas:[] }; if(!qs) return f;
    String(qs).split('&').forEach(p=>{ if(!p) return; const i=p.indexOf('=');
      const k=decodeURIComponent(i<0?p:p.slice(0,i)), v=i<0?'':decodeURIComponent(p.slice(i+1).replace(/\+/g,' '));
      if(k==='area') f.areas=v?v.split(',').filter(Boolean):[];
      else if(k==='done') f.done=(v==='1'||v==='true');
      else if(k in f) f[k]=v; });
    if(!SORTS[f.sort]) f.sort='due';
    if(!(f.group in GROUPS)) f.group='';
    if(['me','sent','all'].indexOf(f.who)<0) f.who='me';
    if(['sheet','card'].indexOf(f.view)<0) f.view='sheet';
    return f;
  }
  function toQS(f){
    const out=[]; const add=(k,v)=>out.push(k+'='+encodeURIComponent(v));
    if(f.view!==DEFAULTS.view) add('view',f.view);
    if(f.who!==DEFAULTS.who) add('who',f.who);
    if((f.areas||[]).length) add('area',f.areas.join(','));
    if(f.st) add('st',f.st);
    if(f.q) add('q',f.q);
    if(f.done) add('done','1');
    if(f.sort!==DEFAULTS.sort) add('sort',f.sort);
    if(f.group) add('group',f.group);
    return out.join('&');
  }
  /* 걸려 있는 조건을 사람 말로 — 빈 목록 안내에 그대로 쓴다 */
  function describe(f){
    const out=[];
    if(f.q) out.push(`검색 "${f.q}"`);
    if((f.areas||[]).length) out.push('영역 '+f.areas.map(k=>DEPT[k]||k).join('·'));
    if(f.st) out.push('상태 '+(ST[f.st]||f.st));
    if(f.who==='sent') out.push('내가 보낸 것');
    else if(f.who==='me') out.push('나에게 온 것');
    if(!f.done && !f.st) out.push('완료 숨김');
    return out;
  }

  window.WorkList={ ST, ST_SEQ, OPEN_ST, AREAS, DEPT, SORTS, GROUPS, DEFAULTS,
    fromAssign, fromReq, rows, apply, sort, group, parseQS, toQS, describe };
})();
