/* ===========================================================================
   홈 · 공통 [일정] — 전사 공유 달력 (날짜별 메모)
   - 월 단위 달력 · 날짜 클릭 시 해당일 메모 추가/수정/삭제
   - 팀 공유: 서버리스 /api/store 공용 컬렉션(calendar)에 저장 (공지·메모와 동일 방식)
   - 작성은 로그인 사용자 누구나 · 삭제는 작성자 본인 또는 관리자
   =========================================================================== */
(function(){
  const meU = ()=> (typeof Auth!=='undefined' && Auth.user && Auth.user()) || {};
  const isAdmin = ()=> !!(typeof Auth!=='undefined' && Auth.isAdmin && Auth.isAdmin());
  async function apiGet(qs){ const r=await fetch('/api/store?'+qs); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
  async function apiPost(body){ const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
  const collGet = async coll=>{ try{ const d=await apiGet('type=coll&coll='+encodeURIComponent(coll)); return (d&&d.items)||[]; }catch{ return null; } };
  const collPush = (coll,item)=>apiPost({op:'collPush',coll,item});
  const collDel  = (coll,id)=>apiPost({op:'collDel',coll,id});
  const COLL='calendar';

  const DOW=['일','월','화','수','목','금','토'];
  const pad=n=>String(n).padStart(2,'0');
  const dstr=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
  const parseYmd=s=>{ const p=String(s||'').split('-'); return { y:+p[0], m:(+p[1])-1, d:+p[2] }; };
  const koDate=s=>{ const {y,m,d}=parseYmd(s); const dow=new Date(y,m,d).getDay(); return `${y}년 ${m+1}월 ${d}일 (${DOW[dow]})`; };

  MODULES['home.calendar']={
    title:'일정', icon:'check2',
    render(root){
      const u=meU();
      const now=new Date();
      let viewY=now.getFullYear(), viewM=now.getMonth();      // 표시 중인 연/월
      let sel=todayStr();                                     // 선택된 날짜(YYYY-MM-DD)
      let events=[];                                          // 전체 일정(서버)
      let loaded=false;

      root.innerHTML=`
        <style>
          .cal-wrap{max-width:1080px}
          .cal-bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
          .cal-title{font-size:18px;font-weight:800;min-width:150px;text-align:center}
          .cal-nav{display:inline-flex;gap:6px}
          .cal-grid{width:100%;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel);box-shadow:var(--sh-sm)}
          .cal-hd,.cal-row{display:grid;grid-template-columns:repeat(7,1fr)}
          .cal-hd>div{padding:9px 6px;text-align:center;font-size:12px;font-weight:800;color:var(--ink-2);background:var(--panel-2);border-bottom:1px solid var(--line-2)}
          .cal-hd>div.sun{color:#e5484d}.cal-hd>div.sat{color:#3b82f6}
          .cal-cell{min-height:96px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:5px 6px;cursor:pointer;position:relative;background:var(--panel);transition:background .1s}
          .cal-cell:nth-child(7n){border-right:0}
          .cal-cell.pad{background:var(--panel-2);cursor:default}
          .cal-cell:hover:not(.pad){background:var(--zebra)}
          .cal-cell.sel{outline:2px solid var(--accent);outline-offset:-2px;z-index:1}
          .cal-dnum{font-size:12.5px;font-weight:700;color:var(--ink-2)}
          .cal-cell.today .cal-dnum{background:var(--accent);color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center}
          .cal-dnum.sun{color:#e5484d}.cal-dnum.sat{color:#3b82f6}
          .cal-ev{margin-top:3px;font-size:11px;line-height:1.35;padding:2px 6px;border-radius:5px;background:var(--info-bg);color:var(--info);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
          .cal-more{font-size:10.5px;color:var(--muted);margin-top:2px;font-weight:700}
          .cal-day{margin-top:18px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);padding:16px 18px}
          .cal-day-hd{display:flex;align-items:center;gap:10px;margin-bottom:12px}
          .cal-day-hd b{font-size:16px}
          .cal-el{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
          .cal-el:last-child{border-bottom:0}
          .cal-el-tx{flex:1;white-space:pre-wrap;word-break:break-word;font-size:13.5px;line-height:1.55;color:var(--ink)}
          .cal-el-meta{font-size:11.5px;color:var(--muted);margin-top:3px}
          .cal-add{display:flex;gap:8px;margin-top:14px;align-items:flex-end;flex-wrap:wrap}
          .cal-add textarea{flex:1;min-width:220px;min-height:44px;resize:vertical;font:inherit;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px;background:var(--panel)}
          .cal-empty{color:var(--muted);font-size:13px;padding:8px 0}
        </style>
        <div class="mhead">
          <div class="tt">일정</div>
          <div class="ds">전사 공유 달력입니다. 날짜를 클릭해 <b>일별 메모</b>를 남기고 팀원 모두와 공유하세요.</div>
        </div>
        <div class="mbody wide"><div class="cal-wrap">
          <div class="cal-bar">
            <span class="cal-nav">
              <button class="btn ghost sm" id="calPrev" title="이전 달">‹</button>
              <button class="btn ghost sm" id="calToday">오늘</button>
              <button class="btn ghost sm" id="calNext" title="다음 달">›</button>
            </span>
            <span class="cal-title" id="calTitle"></span>
            <span class="muted" id="calCount" style="margin-left:auto;font-size:12.5px"></span>
          </div>
          <div class="cal-grid">
            <div class="cal-hd">${DOW.map((d,i)=>`<div class="${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('')}</div>
            <div id="calBody"></div>
          </div>
          <div class="cal-day" id="calDay"></div>
        </div></div>`;

      const $=s=>root.querySelector(s);
      const titleEl=$('#calTitle'), bodyEl=$('#calBody'), dayEl=$('#calDay'), countEl=$('#calCount');

      const byDate=()=>{ const m={}; events.forEach(e=>{ (m[e.date]=m[e.date]||[]).push(e); }); return m; };

      function paintGrid(){
        titleEl.textContent=`${viewY}년 ${viewM+1}월`;
        const first=new Date(viewY,viewM,1).getDay();
        const dim=new Date(viewY,viewM+1,0).getDate();
        const tstr=todayStr();
        const map=byDate();
        const cells=[];
        for(let i=0;i<first;i++) cells.push(null);
        for(let d=1;d<=dim;d++) cells.push(d);
        while(cells.length%7) cells.push(null);
        let html='';
        for(let i=0;i<cells.length;i++){
          if(i%7===0) html+='<div class="cal-row">';
          const d=cells[i];
          if(d==null){ html+='<div class="cal-cell pad"></div>'; }
          else{
            const ds=dstr(viewY,viewM,d), dow=(i%7);
            const evs=map[ds]||[];
            const shown=evs.slice(0,3).map(e=>`<div class="cal-ev">${esc(e.text||'').replace(/\n/g,' ')}</div>`).join('');
            const more=evs.length>3?`<div class="cal-more">+${evs.length-3}건 더</div>`:'';
            html+=`<div class="cal-cell${ds===tstr?' today':''}${ds===sel?' sel':''}" data-d="${ds}">
              <span class="cal-dnum${dow===0?' sun':dow===6?' sat':''}">${d}</span>${shown}${more}</div>`;
          }
          if(i%7===6) html+='</div>';
        }
        bodyEl.innerHTML=html;
        bodyEl.querySelectorAll('.cal-cell[data-d]').forEach(c=>c.onclick=()=>{ sel=c.dataset.d; paintGrid(); paintDay(); });
        countEl.textContent=loaded?`이번 달 일정 ${events.filter(e=>e.date.startsWith(`${viewY}-${pad(viewM+1)}`)).length}건`:'';
      }

      function paintDay(){
        const list=events.filter(e=>e.date===sel).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
        const rows = list.length ? list.map(e=>{
          const canDel=isAdmin()||e.author===u.loginId;
          return `<div class="cal-el">
            <div class="cal-el-tx">${esc(e.text||'')}<div class="cal-el-meta">${esc(e.authorName||e.author||'')}${e.createdAt?' · '+timeHM(e.createdAt):''}</div></div>
            <span style="display:flex;gap:4px">
              ${canDel?`<button class="btn ghost sm" data-a="edit" data-id="${esc(e.id)}">수정</button>
              <button class="btn ghost sm" data-a="del" data-id="${esc(e.id)}" title="삭제">${icon('trash')}</button>`:''}
            </span></div>`;
        }).join('') : `<div class="cal-empty">등록된 일정이 없습니다. 아래에 메모를 추가하세요.</div>`;
        dayEl.innerHTML=`
          <div class="cal-day-hd">${icon('check2')}<b>${esc(koDate(sel))}</b>
            <span class="muted" style="margin-left:auto;font-size:12.5px">${list.length}건</span></div>
          <div id="calList">${loaded?rows:'<div class="cal-empty">불러오는 중…</div>'}</div>
          <div class="cal-add">
            <textarea id="calInput" placeholder="일정/메모를 입력하세요 (예: 오후 2시 발주 마감)"></textarea>
            <button class="btn pri" id="calAdd">${icon('plus')}추가</button>
          </div>`;
        dayEl.querySelectorAll('[data-a=del]').forEach(b=>b.onclick=async()=>{
          if(!confirm('이 일정을 삭제할까요?')) return;
          const id=b.dataset.id; await collDel(COLL,id); events=events.filter(x=>x.id!==id); paintGrid(); paintDay(); toast('삭제했습니다'); });
        dayEl.querySelectorAll('[data-a=edit]').forEach(b=>b.onclick=()=>editEvent(b.dataset.id));
        const inp=$('#calInput'), add=$('#calAdd');
        if(add) add.onclick=async()=>{
          const text=(inp.value||'').trim(); if(!text){ inp.focus(); return; }
          const rec={ id:uuid(), date:sel, text, author:u.loginId||'', authorName:u.name||u.loginId||'', createdAt:nowISO() };
          add.disabled=true;
          const r=await collPush(COLL,rec);
          add.disabled=false;
          if(r&&r.ok===false){ toast('저장 실패 — 서버 연결을 확인하세요'); return; }
          events.push(rec); inp.value=''; paintGrid(); paintDay(); toast('추가했습니다');
        };
        if(inp) inp.onkeydown=e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); add.click(); } };
      }

      function editEvent(id){
        const e=events.find(x=>x.id===id); if(!e) return;
        const row=dayEl.querySelector(`[data-a=edit][data-id="${id}"]`); if(!row) return;
        const cell=row.closest('.cal-el');
        cell.innerHTML=`<div class="cal-el-tx"><textarea id="calEdit" style="width:100%;min-height:60px;font:inherit;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px;background:var(--panel);resize:vertical">${esc(e.text||'')}</textarea>
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
              <button class="btn sm" id="calEditCancel">취소</button><button class="btn pri sm" id="calEditSave">저장</button></div></div>`;
        const ta=cell.querySelector('#calEdit'); ta.focus();
        cell.querySelector('#calEditCancel').onclick=()=>paintDay();
        cell.querySelector('#calEditSave').onclick=async()=>{
          const text=(ta.value||'').trim(); if(!text) return;
          e.text=text; e.editedAt=nowISO();
          const r=await collPush(COLL,e);
          if(r&&r.ok===false){ toast('저장 실패'); return; }
          paintGrid(); paintDay(); toast('수정했습니다');
        };
      }

      $('#calPrev').onclick=()=>{ viewM--; if(viewM<0){ viewM=11; viewY--; } paintGrid(); };
      $('#calNext').onclick=()=>{ viewM++; if(viewM>11){ viewM=0; viewY++; } paintGrid(); };
      $('#calToday').onclick=()=>{ const n=new Date(); viewY=n.getFullYear(); viewM=n.getMonth(); sel=todayStr(); paintGrid(); paintDay(); };

      paintGrid(); paintDay();
      (async()=>{
        const list=await collGet(COLL);
        if(!root.isConnected) return;
        events=Array.isArray(list)?list.filter(e=>e&&e.date):[];
        loaded=true; paintGrid(); paintDay();
      })();
    }
  };
})();
