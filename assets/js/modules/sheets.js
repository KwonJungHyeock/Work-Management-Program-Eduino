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
  /* 담당자(상담사)별 고정 컬러 — 이름 해시로 팔레트에서 배정(일관됨) */
  const NAME_PALETTE=['#2f6fed','#0f9d8e','#e0743a','#7a5af0','#1a8f4a','#e0518f','#0d8bd9','#b26a00','#8e44ad','#d4327a'];
  function colorForName(n){ const s=String(n||''); let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return NAME_PALETTE[h%NAME_PALETTE.length]; }

  function build(cfg){
    MODULES[cfg.key]={
      title:cfg.title, icon:cfg.icon||'sheet',
      render(root){
        const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
        const _me=(Auth.user&&Auth.user())||{};
        // 기록 삭제 = 파트장급(파트장·관리자) · 단 cfg.delByDept 시 해당 부서 담당자도 삭제 가능
        const canDel=isAdmin || _me.role==='lead' || (cfg.delByDept && _me.dept===cfg.dept);
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
          .sv-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 290px);background:var(--panel);box-shadow:var(--sh-sm)}
          table.sv{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
          table.sv th{position:sticky;top:0;z-index:2;background:var(--panel-2);color:var(--ink-2);font-size:11.5px;font-weight:800;
            letter-spacing:.02em;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
          table.sv td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-2)}
          table.sv tr:nth-child(even) td{background:var(--zebra)}
          table.sv tbody tr:hover td{background:var(--hover)}
          table.sv td.num{text-align:right;font-variant-numeric:tabular-nums}
          table.sv td.wrap{white-space:pre-wrap;word-break:break-word;line-height:1.45}
          table.sv td.who{font-weight:700;color:var(--ink)}
          .sv-del{border:0;background:none;color:var(--faint);cursor:pointer;padding:2px 5px;border-radius:5px}
          .sv-del:hover{background:var(--danger-soft);color:var(--danger)}
          .sv-empty{padding:44px;text-align:center;color:var(--muted);font-size:14px}
          .sv-note{font-size:12px;color:var(--faint);margin-top:10px}
          table.sv tr.sv-grp td:first-child{box-shadow:inset 3px 0 0 var(--info)}
          .sv-mv{border:1px solid var(--line-2);background:var(--panel);color:var(--muted);cursor:pointer;border-radius:5px;padding:2px 6px;font-size:11px;line-height:1}
          .sv-mv:hover{background:var(--hover);color:var(--ink)}
        </style>
        <div class="mhead pad">
          <div class="tt">${esc(cfg.title)}</div>
          <div class="ds">${esc(cfg.desc)}</div>
        </div>
        <div class="mbody wide">
          <div class="sv-ctrl">
            <span class="seg" id="segR">
              <button data-r="today">오늘</button><button data-r="7">7일</button>
              <button data-r="30">30일</button><button data-r="month" class="on">이번달</button>
              <button data-r="custom">지정</button></span>
            <span class="sv-dates" id="dates"><input type="date" id="dFrom"> ~ <input type="date" id="dTo"></span>
            <select class="sv-in" id="fWho"><option value="">${esc(cfg.whoLabel||'담당자')} 전체</option></select>
            ${(cfg.filters||[]).map(f=>`<select class="sv-in" data-fk="${esc(f.k)}"><option value="">${esc(f.label)} 전체</option></select>`).join('')}
            <input class="sv-in" id="fQ" type="text" placeholder="검색어…">
            <span class="sv-sp"></span>
            ${(isAdmin&&cfg.sheetPush)?`<button class="btn ghost sm" id="btnPush">${icon('cloudUp')}시트로 전송</button>`:''}
            ${isAdmin?`<button class="btn ghost sm" id="btnCsv">${icon('download')}CSV</button>`:''}
            <button class="btn ghost sm" id="btnReload">${icon('refresh')}</button>
          </div>
          <p class="sv-meta" id="meta"></p>
          <div class="sv-wrap"><table class="sv" id="tbl"></table></div>
          <p class="sv-note">구글시트는 백업으로 병행됩니다. 이 표가 프로그램 내 기본 기록(전 담당자 공유)입니다.${cfg.editable?' · 행의 <b>[수정]</b>으로 고치면 내부 기록과 구글시트에 함께 반영됩니다.':''}${canDel?' 파트장·관리자는 기록을 삭제할 수 있습니다.':''}</p>
        </div>`;

        const $=s=>root.querySelector(s);
        let preset='month', custom={from:todayStr(), to:todayStr()}, all=[], who='', q='', editId=null;
        const fvals={};   // 컬럼 필터 값 { 컬럼키: 선택값 }
        const myDept=(Auth.user&&Auth.user()||{}).dept;
        const canEdit=!!cfg.editable && (isAdmin || myDept===cfg.dept);
        const canReorder=!!cfg.reorderable && canEdit;
        const hasActions=canDel||canEdit;
        const dayOf=r=>String(r.day||r.date||'').slice(0,10);
        const ordOf=r=> r.ord!=null ? Number(r.ord) : (r.createdAt ? (Date.parse(r.createdAt)||0) : 0);

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
          (cfg.filters||[]).forEach(f=>{ const v=fvals[f.k]; if(v) rows=rows.filter(r=>String(r[f.k]??'').trim()===v); });
          if(q){ const s=q.toLowerCase(); rows=rows.filter(r=>cfg.cols.some(c=>String(r[c.k]??'').toLowerCase().includes(s))); }
          if(cfg.ordKey){
            // 발주 기록: 날짜 내림차순 + 같은 주문서(orderGroup) 인접 + 입력순(ord) 오름차순
            const gkey=r=>cfg.groupKey?String(r[cfg.groupKey]||r.id):r.id;
            const gmin={}; rows.forEach(r=>{ const g=gkey(r), o=ordOf(r); if(gmin[g]==null||o<gmin[g]) gmin[g]=o; });
            rows.sort((a,b)=> dayOf(b).localeCompare(dayOf(a)) || (gmin[gkey(a)]-gmin[gkey(b)]) || (ordOf(a)-ordOf(b)));
          } else {
            rows.sort((a,b)=>String(b.day||b.date||'').localeCompare(String(a.day||a.date||''))
              || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
          }
          return {rows,from,to};
        }
        function cell(r,c){
          // 계산 컬럼(예: 처리현황) — 저장값이 아니라 다른 칸으로부터 파생 표시
          if(c.compute){ const cv=c.compute(r);
            if(c.badge){ const okc=/완료/.test(cv); const col=okc?'var(--ok)':'var(--danger)', bg=okc?'var(--ok-bg)':'var(--danger-soft)';
              return `<td style="white-space:nowrap"><span style="display:inline-block;font-weight:700;border-radius:6px;padding:2px 9px;color:${col};background:${bg}">${esc(cv)}</span></td>`; }
            return `<td style="white-space:nowrap">${esc(cv)}</td>`; }
          let v=r[c.k]; if(c.money) v=fmtNum(v)+'원'; else if(c.num) v=fmtNum(v); else v=v==null?'':String(v);
          if(c.wrap) v=v.replace(/[ \t]*\n[ \t]*(?:\n[ \t]*)+/g,'\n');   // 빈 줄 접어 1·2번 줄이 이어지게(행 높이 절약)
          // 담당자 컬러 배지(상담사별 색 구분)
          if(c.color && v){ const col=colorForName(v);
            return `<td style="white-space:nowrap"><span style="display:inline-block;font-weight:800;color:${col};background:${col}1a;border-radius:6px;padding:2px 9px">${esc(v)}</span></td>`; }
          // 구분/분류/상태 값별 색상 배지
          if(c.tag && v && typeof tagBadge==='function'){ const cl=tagColor(v);
            return `<td style="white-space:nowrap"><span style="display:inline-block;font-weight:700;border-radius:6px;padding:2px 9px;background:${cl.bg};color:${cl.fg}">${esc(v)}</span></td>`; }
          const cls=(c.wrap?'wrap ':'')+(c.num?'num ':'')+(c.k==='whoName'?'who ':'');
          // wrap 칸(내용·답변·품명·비고)은 남는 폭을 흡수하도록 max 제거 → 표가 오른쪽까지 채워짐
          return `<td class="${cls.trim()}" ${c.wrap?`style="min-width:${c.w||180}px"`:`style="white-space:nowrap"`}>${esc(v)}</td>`;
        }
        function editCell(r,c){
          if(c.compute) return cell(r,c);   // 계산 컬럼은 편집 불가 — 그대로 표시(저장 후 자동 갱신)
          const v=r[c.k]==null?'':String(r[c.k]);
          const inp = c.options
            ? `<select data-k="${esc(c.k)}" style="font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px">${c.options.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`
            : c.wrap
            ? `<textarea data-k="${esc(c.k)}" rows="2" style="width:100%;min-width:${(c.w||160)}px;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px">${esc(v)}</textarea>`
            : `<input data-k="${esc(c.k)}" type="${c.k==='date'?'date':(c.num?'number':'text')}" value="${esc(v)}" style="width:${(c.w||90)}px;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px">`;
          return `<td style="white-space:nowrap">${inp}</td>`;
        }
        function actionCell(r){
          if(editId===r.id){
            return `<td style="white-space:nowrap"><span style="display:flex;gap:4px">
              <button class="btn pri sm" data-a="save">${icon('check')}</button>
              <button class="btn ghost sm" data-a="cancel">취소</button></span></td>`;
          }
          return `<td style="white-space:nowrap"><span style="display:flex;gap:4px;justify-content:flex-end;align-items:center">
            ${canReorder?`<button class="sv-mv" data-a="up" data-id="${esc(r.id)}" title="위로 이동">▲</button><button class="sv-mv" data-a="down" data-id="${esc(r.id)}" title="아래로 이동">▼</button>`:''}
            ${canEdit?`<button class="btn ghost sm" data-a="edit" data-id="${esc(r.id)}">수정</button>`:''}
            ${canDel?`<button class="sv-del" data-id="${esc(r.id)}" data-day="${esc(r.day||r.date||'')}" data-who="${esc(r.who||'')}" title="삭제">${icon('trash')}</button>`:''}
          </span></td>`;
        }
        function paint(){
          if(!root.isConnected || !$('#tbl')) return;
          const {rows,from,to}=filtered();
          $('#meta').textContent=`${from} ~ ${to} · 총 ${rows.length.toLocaleString()}건`;
          const CAP=2000; const show=rows.slice(0,CAP);
          const head=`<thead><tr>${cfg.cols.map(c=>`<th>${esc(c.h)}</th>`).join('')}${hasActions?'<th></th>':''}</tr></thead>`;
          // 같은 주문서(orderGroup)가 2건 이상이면 그룹 표시(왼쪽 강조선)
          const grpCnt={}; if(cfg.groupKey) show.forEach(r=>{ const g=r[cfg.groupKey]; if(g) grpCnt[g]=(grpCnt[g]||0)+1; });
          const body=show.length? `<tbody>${show.map(r=>{ const g=cfg.groupKey&&r[cfg.groupKey]; const grouped=g&&grpCnt[g]>1;
            return `<tr${grouped?' class="sv-grp"':''}>${cfg.cols.map(c=>(editId===r.id?editCell(r,c):cell(r,c))).join('')}${hasActions?actionCell(r):''}</tr>`;
          }).join('')}</tbody>` : '';
          $('#tbl').innerHTML=head+body;
          if(!show.length){ $('#tbl').innerHTML=`<tbody><tr><td class="sv-empty" colspan="${cfg.cols.length+1}">해당 기간의 기록이 없습니다.</td></tr></tbody>`; }
          if(rows.length>CAP) $('#meta').textContent+=` (앞 ${CAP}건 표시 · 기간을 좁혀 보세요)`;
          wireRowActions();
        }
        function wireRowActions(){
          $('#tbl').querySelectorAll('[data-a=edit]').forEach(b=>b.onclick=()=>{ editId=b.dataset.id; paint(); });
          $('#tbl').querySelectorAll('[data-a=cancel]').forEach(b=>b.onclick=()=>{ editId=null; paint(); });
          $('#tbl').querySelectorAll('[data-a=save]').forEach(b=>b.onclick=async(e)=>{
            const tr=e.currentTarget.closest('tr'); const old=all.find(x=>x.id===editId); if(!old) return;
            const rec={...old}; tr.querySelectorAll('[data-k]').forEach(inp=>{ rec[inp.dataset.k]=inp.value; });
            e.currentTarget.disabled=true; e.currentTarget.textContent='…';
            try{ await cfg.onSave(rec, old); Object.assign(old, rec); editId=null; paintWho(); paint(); toast('수정했습니다'); }
            catch(err){ toast(err.message||'수정 실패'); e.currentTarget.disabled=false; }
          });
          if(canDel) $('#tbl').querySelectorAll('.sv-del').forEach(b=>b.onclick=async()=>{
            if(!confirm('이 기록을 서버에서 삭제할까요? (되돌릴 수 없음)')) return;
            const day=b.dataset.day; await Records.del(cfg.dept,cfg.sheet,b.dataset.id,(day||'').slice(0,7),b.dataset.who,day);
            all=all.filter(x=>x.id!==b.dataset.id); paintWho(); paint(); toast('삭제했습니다');
          });
          if(canReorder){
            $('#tbl').querySelectorAll('[data-a=up]').forEach(b=>b.onclick=()=>move(b.dataset.id,-1));
            $('#tbl').querySelectorAll('[data-a=down]').forEach(b=>b.onclick=()=>move(b.dataset.id,1));
          }
        }
        // 발주 기록 항목 이동(순서 변경) — 같은 날짜 안에서 인접 행과 입력순(ord)을 맞바꿔 저장
        async function move(id,dir){
          const {rows}=filtered(); const i=rows.findIndex(r=>r.id===id); if(i<0) return;
          const j=i+dir; if(j<0||j>=rows.length) return;
          const a=rows[i], b=rows[j];
          if(dayOf(a)!==dayOf(b)){ toast('같은 날짜 안에서만 이동할 수 있습니다'); return; }
          const ao=ordOf(a), bo=ordOf(b); a.ord=(bo===ao?bo-1:bo); b.ord=ao;   // 동일값이면 살짝 벌려 순서 확정
          paint();
          try{ if(cfg.onSave){ await cfg.onSave(a,a); await cfg.onSave(b,b); } }
          catch(err){ toast('순서 저장 실패 — 새로고침 후 다시 시도'); }
        }
        function paintWho(){
          const names=[...new Set(all.map(r=>r.whoName||r.agent).filter(Boolean))].sort();
          const cur=who; $('#fWho').innerHTML=`<option value="">${esc(cfg.whoLabel||'담당자')} 전체</option>`+names.map(n=>`<option ${n===cur?'selected':''}>${esc(n)}</option>`).join('');
        }
        function paintFilters(){
          (cfg.filters||[]).forEach(f=>{ const sel=root.querySelector(`[data-fk="${f.k}"]`); if(!sel) return;
            const vals=[...new Set(all.map(r=>String(r[f.k]??'').trim()).filter(Boolean))].sort();
            const cur=fvals[f.k]||''; if(cur && !vals.includes(cur)){ fvals[f.k]=''; }
            sel.innerHTML=`<option value="">${esc(f.label)} 전체</option>`+vals.map(v=>`<option ${v===(fvals[f.k]||'')?'selected':''}>${esc(v)}</option>`).join('');
          });
        }

        $('#segR').querySelectorAll('button').forEach(b=>b.onclick=()=>{ preset=b.dataset.r;
          $('#segR').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
          $('#dates').classList.toggle('on',preset==='custom');
          if(preset==='custom'){ $('#dFrom').value=custom.from; $('#dTo').value=custom.to; }
          load(); });
        $('#dFrom').onchange=()=>{ custom.from=$('#dFrom').value||custom.from; load(); };
        $('#dTo').onchange=()=>{ custom.to=$('#dTo').value||custom.to; load(); };
        $('#fWho').onchange=()=>{ who=$('#fWho').value; paint(); };
        (cfg.filters||[]).forEach(f=>{ const sel=root.querySelector(`[data-fk="${f.k}"]`); if(sel) sel.onchange=()=>{ fvals[f.k]=sel.value; paint(); }; });
        $('#fQ').oninput=()=>{ q=$('#fQ').value.trim(); paint(); };
        $('#btnReload').onclick=load;
        const csvBtn=$('#btnCsv');   // 시트 다운로드(CSV)는 관리자만 (팀원 화면엔 버튼 미표시)
        if(csvBtn) csvBtn.onclick=()=>{
          if(!isAdmin){ toast('시트 다운로드는 관리자만 가능합니다'); return; }
          const {rows,from,to}=filtered();
          const header=cfg.cols.map(c=>c.h);
          const lines=[header, ...rows.map(r=>cfg.cols.map(c=>{ let v=c.compute?c.compute(r):r[c.k]; if(c.money) v=fmtNum(v); return v==null?'':String(v); }))];
          const csv='﻿'+lines.map(r=>r.map(c=>/[",\n]/.test(String(c))?'"'+String(c).replace(/"/g,'""')+'"':c).join(',')).join('\r\n');
          downloadBlob(new Blob([csv],{type:'text/csv'}), `${cfg.title}_${from}_${to}.csv`);
          toast('CSV로 저장했습니다');
        };

        // 기존 누적 기록을 구글 시트로 일괄 전송(백필) — 관리자만 · 현재 필터/기간 대상
        const pushBtn=$('#btnPush');
        if(pushBtn) pushBtn.onclick=async()=>{
          const sp=cfg.sheetPush; if(!sp) return;
          const url=(store(sp.urlKey).get({})||{}).sheetUrl||'';
          if(!url){ toast(`먼저 ‘${cfg.title}’ 연동 설정에서 시트 URL을 저장하세요`); return; }
          const {rows,from,to}=filtered();
          if(!rows.length){ toast('전송할 기록이 없습니다 (기간을 넓혀보세요)'); return; }
          const dupNote = sp.cols ? '\n※ 발주표는 추가(append) 방식이라 여러 번 누르면 중복될 수 있습니다 — 한 번만 실행하세요.' : '\n(id 기준으로 중복 없이 갱신됩니다)';
          if(!confirm(`${from}~${to} · ${rows.length.toLocaleString()}건을 시트 "${sp.tab}" 탭으로 전송할까요?${dupNote}`)) return;
          pushBtn.disabled=true; const org=pushBtn.innerHTML; pushBtn.innerHTML=`${icon('cloud')}전송 중…`;
          const payload = sp.cols ? { sheet:sp.tab, cols:sp.cols, rows: rows.map(sp.row) } : { sheet:sp.tab, records: rows.map(sp.row) };
          const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) };
          let ok=false, unconf=false, errMsg='';
          try{ const res=await fetch(url,opts); if(!res.ok) throw new Error('HTTP '+res.status); let d=null; try{d=await res.json();}catch(e){} if(d&&d.ok===false) throw new Error(d.error||'시트 처리 실패'); ok=true; }
          catch(err){ if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){ try{ await fetch(url,{...opts,mode:'no-cors'}); ok=true; unconf=true; }catch(e){} } else errMsg=err.message||'전송 실패'; }
          pushBtn.disabled=false; pushBtn.innerHTML=org;
          toast(ok?`시트 "${sp.tab}"에 ${rows.length.toLocaleString()}건 전송${unconf?' (응답 확인 불가·재전송 안전)':''}`:`전송 실패: ${errMsg}`);
        };

        async function load(){
          if(!$('#meta')) return; $('#meta').textContent='불러오는 중…'; $('#tbl').innerHTML='';
          const {from,to}=range();
          const ms=monthsBetween(from,to);
          const packs=await Promise.all(ms.map(m=>Records.month(cfg.dept,cfg.sheet,m)));
          if(!root.isConnected || !$('#meta')) return;   // 이동 후 지연 렌더 방지
          if(packs.some(p=>p===null)){ $('#meta').textContent='';
            $('#tbl').innerHTML=`<tbody><tr><td class="sv-empty" colspan="${cfg.cols.length+1}">서버에서 기록을 불러오지 못했습니다. 연동 상태를 확인하세요.</td></tr></tbody>`; return; }
          const map={}; packs.forEach(p=>(p||[]).forEach(r=>{ if(r&&r.id) map[r.id]=r; }));
          all=Object.values(map);
          paintWho(); paintFilters(); paint();
        }
        load();
      }
    };
  }

  build({ key:'cs.records', dept:'cs', sheet:'notes', title:'상담 기록', icon:'sheet',
    desc:'전 상담사의 상담 메모가 서버에 누적됩니다. 저장 시 자동 반영되며 구글시트는 백업으로 병행됩니다.',
    editable:true, delByDept:true, whoLabel:'상담사',
    filters:[ {k:'category',label:'분류'}, {k:'customerType',label:'고객유형'} ],
    // 기존 누적 기록 → 구글시트 CS상담메모 탭 일괄 전송(백필)
    sheetPush:{ tab:'CS상담메모', urlKey:STORE.csNoteCfg,
      row:r=>{ const o={id:r.id}; for(const k in CS_SHEET_MAP) o[CS_SHEET_MAP[k]] = (k==='agent'?(r.agent||r.whoName||''):(r[k]!=null?r[k]:'')); return o; } },
    onSave: async(rec, old)=>{
      rec.agent = rec.whoName || rec.agent;                         // 상담사 편집 반영
      const oldM=String(old.day||old.date||'').slice(0,7), newM=String(rec.date||'').slice(0,7);
      if(window.Records && oldM && newM && oldM!==newM) await Records.del('cs','notes',rec.id,oldM,old.who,old.day||old.date);
      if(window.Records) await Records.pushCS(rec);                 // 내부 상담 기록 갱신(중복 없이 덮어씀)
      if(window.CSSheet && CSSheet.configured()) CSSheet.send([rec]); // 구글시트 갱신(id 기준 upsert)
    },
    cols:[ {k:'date',h:'날짜',w:96}, {k:'whoName',h:'상담사',w:80,color:true}, {k:'category',h:'분류',w:78,tag:true},
      {k:'route',h:'주문경로',w:78}, {k:'customerType',h:'고객유형',w:78}, {k:'name',h:'이름/학교/업체',w:150}, {k:'contact',h:'연락처',w:120},
      {k:'prodCategory',h:'상품분류',w:90}, {k:'prodCode',h:'상품코드',w:84},
      {k:'content',h:'내용',w:260,wrap:true}, {k:'answer',h:'답변',w:200,wrap:true} ] });

  build({ key:'md.tsrecords', dept:'md', sheet:'tsnotes', title:'TS상담 기록', icon:'sheet',
    desc:'전 담당자의 TS(기술상담) 기록이 서버에 누적됩니다. 저장 시 자동 반영되며 구글시트는 백업으로 병행됩니다.',
    editable:true, whoLabel:'담당자',
    filters:[ {k:'platform',label:'문의플랫폼'}, {k:'prodType',label:'상품구분'} ],
    sheetPush:{ tab:'TS상담메모', urlKey:STORE.tsNoteCfg,
      row:r=>{ const o={id:r.id}; for(const k in TS_SHEET_MAP) o[TS_SHEET_MAP[k]] = (k==='agent'?(r.agent||r.whoName||''):(r[k]!=null?r[k]:'')); return o; } },
    onSave: async(rec, old)=>{
      rec.agent = rec.whoName || rec.agent;                         // 담당자 편집 반영
      const oldM=String(old.day||old.date||'').slice(0,7), newM=String(rec.date||'').slice(0,7);
      if(window.Records && oldM && newM && oldM!==newM) await Records.del('md','tsnotes',rec.id,oldM,old.who,old.day||old.date);
      if(window.Records) await Records.pushTS(rec);                 // 내부 TS 기록 갱신(중복 없이 덮어씀)
      if(window.TSSheet && TSSheet.configured()) TSSheet.send([rec]); // 구글시트 갱신(id 기준 upsert)
    },
    cols:[ {k:'date',h:'날짜',w:96}, {k:'whoName',h:'담당자',w:80,color:true}, {k:'platform',h:'문의플랫폼',w:90},
      {k:'prodType',h:'상품구분',w:90}, {k:'prodCode',h:'상품코드',w:90}, {k:'prodName',h:'제품명',w:180,wrap:true},
      {k:'customer',h:'고객정보',w:140,wrap:true}, {k:'content',h:'문의사항',w:240,wrap:true},
      {k:'answerSummary',h:'답변요약',w:200,wrap:true}, {k:'answer',h:'답변원본',w:240,wrap:true}, {k:'remark',h:'비고',w:120,wrap:true} ] });

  build({ key:'md.records', dept:'md', sheet:'orders', title:'발주 기록', icon:'sheet',
    desc:'전 담당자의 발주 내역이 서버에 누적됩니다. 같은 주문서는 묶여서 입력순으로 표시되며, ▲▼로 순서를 바꿀 수 있습니다. 구글시트는 백업으로 병행됩니다.',
    editable:true, whoLabel:'담당자', reorderable:true, ordKey:'ord', groupKey:'orderGroup',
    // 기존 발주 내역 → 구글시트 입점사발주 탭 일괄 전송(백필) · CS와 동일 records+id upsert(중복 없음)
    sheetPush:{ tab:'입점사발주', urlKey:STORE.mdOrderCfg,
      row:r=>({ id:r.id, '일자':r.date||r.day||'', '구분':r.gubun||'', '주문경로':r.route||'', '주문자명':r.orderer||'', '입점사명':r.vendor||'',
        '정산구분':r.settle||'', '자체상품코드':r.selfCode||r.code||'', '품명':r.name||'', '수량':(r.qty!=null?r.qty:''),
        '출고송장/입고':r.invoice||'', '발주':'O', '배송정보/비고':r.shipInfo||'' }) },
    onSave: async(rec, old)=>{
      rec.handler = rec.whoName || rec.handler;                      // 담당자 편집 반영(귀속도 이 담당자로)
      const oldM=String(old.day||old.date||'').slice(0,7), newM=String(rec.date||'').slice(0,7);
      if(window.Records && oldM && newM && oldM!==newM) await Records.del('md','orders',rec.id,oldM,old.who,old.day||old.date);
      if(window.Records) await Records.pushMD(rec);                  // 내부 발주 기록 갱신(중복 없이 덮어씀 · 송장번호 포함)
    },
    cols:[ {k:'date',h:'일자',w:104,compute:r=>{ const d=String(r.date||''); return /^\d{4}-\d{2}-\d{2}/.test(d)?d.slice(0,10):(String(r.day||'').slice(0,10)||d); }},
      {k:'whoName',h:'담당자',w:80,color:true}, {k:'gubun',h:'구분',w:70,tag:true},
      {k:'route',h:'주문경로',w:88}, {k:'orderer',h:'주문자명',w:100}, {k:'vendor',h:'입점사명',w:120},
      {k:'settle',h:'정산구분',w:78,tag:true}, {k:'selfCode',h:'자체상품코드',w:104},
      {k:'name',h:'품명',w:240,wrap:true}, {k:'qty',h:'수량',w:52,num:true},
      {k:'ship',h:'배송비',w:78,num:true,money:true},
      {k:'orderStatus',h:'발주 진행여부',w:96,tag:true,options:['발주전','발주완료']},   // 입점사에 발주 넣었는지
      {k:'invoice',h:'송장번호',w:120},                              // 발주 등록 시 비움 → 출고 후 담당자가 수기 입력
      {k:'shipInfo',h:'배송정보/비고',w:180,wrap:true},
      {k:'__pstatus',h:'처리현황',w:118,compute:r=>((r.invoice||'').toString().trim()?'송장번호 입력완료':'송장번호 입력필요'),badge:true} ] });
})();
