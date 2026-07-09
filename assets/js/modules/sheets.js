/* ===========================================================================
   프로그램 내 "누적 시트" 뷰 — 전 직원 업무 기록을 서버에서 읽어 표로 조회
   - CS 상담 기록(sheet 'notes'), MD 발주 기록(sheet 'orders')
   - 기간/담당자/검색 필터 + CSV 내보내기 · 관리자만 행 삭제
   - 열람 권한은 shell 에서 담당 직무 + 관리자 전체로 게이트
   =========================================================================== */
(function(){
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays=(s,n)=>{ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return ymd(d); };
  const monthsBetween=(from,to)=>{ const out=[]; let y=Number(from.slice(0,4)), m=Number(from.slice(5,7));
    const ey=Number(to.slice(0,4)), em=Number(to.slice(5,7)); let g=0;
    while((y<ey||(y===ey&&m<=em))&&g++<60){ out.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++;} } return out; };
  const fmtNum=n=>{ const x=Number(n); return isFinite(x)?x.toLocaleString():(n??''); };

  function build(cfg){
    MODULES[cfg.key]={
      title:cfg.title, icon:cfg.icon||'sheet',
      render(root){
        const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
        root.innerHTML=`
        <style>
          .sv-ctrl{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin-bottom:14px}
          .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
          .seg button{border:0;background:var(--panel);padding:7px 13px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
          .seg button:first-child{border-left:0}
          .seg button.on{background:var(--active-bg);color:var(--red)}
          .sv-dates{display:none;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
          .sv-dates.on{display:inline-flex}
          .sv-dates input{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 9px;font-size:13px}
          .sv-in{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 11px;font-size:13px;min-width:120px}
          .sv-sp{flex:1}
          .sv-meta{font-size:12.5px;color:var(--muted);margin:0 0 8px;font-weight:600}
          .sv-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 290px);background:#fff;box-shadow:var(--sh-sm)}
          table.sv{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
          table.sv th{position:sticky;top:0;z-index:2;background:#f4f6f9;color:var(--ink-2);font-size:11.5px;font-weight:800;
            letter-spacing:.02em;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
          table.sv td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-2)}
          table.sv tr:nth-child(even) td{background:var(--zebra)}
          table.sv td.num{text-align:right;font-variant-numeric:tabular-nums}
          table.sv td.wrap{white-space:pre-wrap;word-break:break-word;line-height:1.45}
          table.sv td.who{font-weight:700;color:var(--ink)}
          .sv-del{border:0;background:none;color:var(--faint);cursor:pointer;padding:2px 5px;border-radius:5px}
          .sv-del:hover{background:var(--danger-soft);color:var(--danger)}
          .sv-empty{padding:44px;text-align:center;color:var(--muted);font-size:14px}
          .sv-note{font-size:12px;color:var(--faint);margin-top:10px}
        </style>
        <div class="mhead pad">
          <div class="tt">${esc(cfg.title)}</div>
          <div class="ds">${esc(cfg.desc)}</div>
        </div>
        <div class="mbody">
          <div class="sv-ctrl">
            <span class="seg" id="segR">
              <button data-r="today">오늘</button><button data-r="7">7일</button>
              <button data-r="30">30일</button><button data-r="month" class="on">이번달</button>
              <button data-r="custom">지정</button></span>
            <span class="sv-dates" id="dates"><input type="date" id="dFrom"> ~ <input type="date" id="dTo"></span>
            <select class="sv-in" id="fWho"><option value="">담당자 전체</option></select>
            <input class="sv-in" id="fQ" type="text" placeholder="검색어…">
            <span class="sv-sp"></span>
            <button class="btn ghost sm" id="btnCsv">${icon('download')}CSV</button>
            <button class="btn ghost sm" id="btnReload">${icon('refresh')}</button>
          </div>
          <p class="sv-meta" id="meta"></p>
          <div class="sv-wrap"><table class="sv" id="tbl"></table></div>
          <p class="sv-note">구글시트는 백업으로 병행됩니다. 이 표가 프로그램 내 기본 기록(전 담당자 공유)입니다.${isAdmin?' · 관리자는 행을 삭제할 수 있습니다.':''}</p>
        </div>`;

        const $=s=>root.querySelector(s);
        let preset='month', custom={from:todayStr(), to:todayStr()}, all=[], who='', q='';

        function range(){ const to=todayStr();
          if(preset==='today') return {from:to,to};
          if(preset==='7') return {from:addDays(to,-6),to};
          if(preset==='30') return {from:addDays(to,-29),to};
          if(preset==='month') return {from:to.slice(0,8)+'01',to};
          return {from:custom.from<=custom.to?custom.from:custom.to, to:custom.from<=custom.to?custom.to:custom.from};
        }
        function filtered(){
          const {from,to}=range();
          let rows=all.filter(r=>{ const d=r.day||r.date||''; return d>=from&&d<=to; });
          if(who) rows=rows.filter(r=>(r.whoName||r.agent||'')===who);
          if(q){ const s=q.toLowerCase(); rows=rows.filter(r=>cfg.cols.some(c=>String(r[c.k]??'').toLowerCase().includes(s))); }
          rows.sort((a,b)=>String(b.day||b.date||'').localeCompare(String(a.day||a.date||''))
            || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
          return {rows,from,to};
        }
        function cell(r,c){
          let v=r[c.k]; if(c.money) v=fmtNum(v)+'원'; else if(c.num) v=fmtNum(v); else v=v==null?'':String(v);
          const cls=(c.wrap?'wrap ':'')+(c.num?'num ':'')+(c.k==='whoName'?'who ':'');
          return `<td class="${cls.trim()}" ${c.wrap?`style="min-width:${c.w||160}px;max-width:${(c.w||160)+120}px"`:`style="white-space:nowrap"`}>${esc(v)}</td>`;
        }
        function paint(){
          const {rows,from,to}=filtered();
          $('#meta').textContent=`${from} ~ ${to} · 총 ${rows.length.toLocaleString()}건`;
          const CAP=2000; const show=rows.slice(0,CAP);
          const head=`<thead><tr>${cfg.cols.map(c=>`<th>${esc(c.h)}</th>`).join('')}${isAdmin?'<th></th>':''}</tr></thead>`;
          const body=show.length? `<tbody>${show.map(r=>`<tr>${cfg.cols.map(c=>cell(r,c)).join('')}${
            isAdmin?`<td style="white-space:nowrap"><button class="sv-del" data-id="${esc(r.id)}" data-day="${esc(r.day||r.date||'')}" data-who="${esc(r.who||'')}" title="삭제">${icon('trash')}</button></td>`:''
          }</tr>`).join('')}</tbody>` : '';
          $('#tbl').innerHTML=head+body;
          if(!show.length){ $('#tbl').innerHTML=`<tbody><tr><td class="sv-empty" colspan="${cfg.cols.length+1}">해당 기간의 기록이 없습니다.</td></tr></tbody>`; }
          if(rows.length>CAP) $('#meta').textContent+=` (앞 ${CAP}건 표시 · 기간을 좁혀 보세요)`;
          if(isAdmin) $('#tbl').querySelectorAll('.sv-del').forEach(b=>b.onclick=async()=>{
            if(!confirm('이 기록을 서버에서 삭제할까요? (되돌릴 수 없음)')) return;
            const day=b.dataset.day; await Records.del(cfg.dept,cfg.sheet,b.dataset.id,(day||'').slice(0,7),b.dataset.who,day);
            all=all.filter(x=>x.id!==b.dataset.id); paintWho(); paint(); toast('삭제했습니다');
          });
        }
        function paintWho(){
          const names=[...new Set(all.map(r=>r.whoName||r.agent).filter(Boolean))].sort();
          const cur=who; $('#fWho').innerHTML=`<option value="">담당자 전체</option>`+names.map(n=>`<option ${n===cur?'selected':''}>${esc(n)}</option>`).join('');
        }

        $('#segR').querySelectorAll('button').forEach(b=>b.onclick=()=>{ preset=b.dataset.r;
          $('#segR').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
          $('#dates').classList.toggle('on',preset==='custom');
          if(preset==='custom'){ $('#dFrom').value=custom.from; $('#dTo').value=custom.to; }
          load(); });
        $('#dFrom').onchange=()=>{ custom.from=$('#dFrom').value||custom.from; load(); };
        $('#dTo').onchange=()=>{ custom.to=$('#dTo').value||custom.to; load(); };
        $('#fWho').onchange=()=>{ who=$('#fWho').value; paint(); };
        $('#fQ').oninput=()=>{ q=$('#fQ').value.trim(); paint(); };
        $('#btnReload').onclick=load;
        $('#btnCsv').onclick=()=>{
          const {rows,from,to}=filtered();
          const header=cfg.cols.map(c=>c.h);
          const lines=[header, ...rows.map(r=>cfg.cols.map(c=>{ let v=r[c.k]; if(c.money) v=fmtNum(v); return v==null?'':String(v); }))];
          const csv='﻿'+lines.map(r=>r.map(c=>/[",\n]/.test(String(c))?'"'+String(c).replace(/"/g,'""')+'"':c).join(',')).join('\r\n');
          downloadBlob(new Blob([csv],{type:'text/csv'}), `${cfg.title}_${from}_${to}.csv`);
          toast('CSV로 저장했습니다');
        };

        async function load(){
          $('#meta').textContent='불러오는 중…'; $('#tbl').innerHTML='';
          const {from,to}=range();
          const ms=monthsBetween(from,to);
          const packs=await Promise.all(ms.map(m=>Records.month(cfg.dept,cfg.sheet,m)));
          if(packs.some(p=>p===null)){ $('#meta').textContent='';
            $('#tbl').innerHTML=`<tbody><tr><td class="sv-empty" colspan="${cfg.cols.length+1}">서버에서 기록을 불러오지 못했습니다. 연동 상태를 확인하세요.</td></tr></tbody>`; return; }
          const map={}; packs.forEach(p=>(p||[]).forEach(r=>{ if(r&&r.id) map[r.id]=r; }));
          all=Object.values(map);
          paintWho(); paint();
        }
        load();
      }
    };
  }

  build({ key:'cs.records', dept:'cs', sheet:'notes', title:'상담 기록', icon:'sheet',
    desc:'전 상담사의 상담 메모가 서버에 누적됩니다. 저장 시 자동 반영되며 구글시트는 백업으로 병행됩니다.',
    cols:[ {k:'date',h:'날짜',w:96}, {k:'whoName',h:'상담사',w:80}, {k:'category',h:'분류',w:78},
      {k:'customerType',h:'고객유형',w:74}, {k:'name',h:'주문자/학교/업체',w:150}, {k:'contact',h:'연락처',w:120},
      {k:'prodCategory',h:'상품분류',w:90}, {k:'prodCode',h:'상품코드',w:84},
      {k:'content',h:'내용',w:260,wrap:true}, {k:'answer',h:'답변',w:200,wrap:true} ] });

  build({ key:'md.records', dept:'md', sheet:'orders', title:'발주 기록', icon:'sheet',
    desc:'전 담당자의 발주 내역이 서버에 누적됩니다. 저장 시 자동 반영되며 구글시트는 백업으로 병행됩니다.',
    cols:[ {k:'date',h:'일자',w:96}, {k:'whoName',h:'담당자',w:80}, {k:'gubun',h:'구분',w:70},
      {k:'route',h:'주문경로',w:88}, {k:'orderer',h:'주문자명',w:100}, {k:'vendor',h:'입점사명',w:120},
      {k:'settle',h:'정산구분',w:78}, {k:'selfCode',h:'자체상품코드',w:104},
      {k:'name',h:'품명',w:240,wrap:true}, {k:'qty',h:'수량',w:52,num:true},
      {k:'ship',h:'배송비',w:78,num:true,money:true}, {k:'shipInfo',h:'배송정보/비고',w:180,wrap:true} ] });
})();
