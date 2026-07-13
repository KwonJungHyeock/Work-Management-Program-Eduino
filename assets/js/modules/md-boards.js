/* ===========================================================================
   MD · 현황판 공용 엔진 (buildBoard) — 노션 시트 구조 그대로 프로그램 내 이관
   - 입점사 신규/변동사항 · 품절관리 현황 · 제품검수 현황 · 상품관리 현황
   - 입력 폼 + 팀 공유 표(서버 시트 누적) + 기간/담당자 필터 + CSV + 행 수정/삭제
   - 저장: Records.pushRaw(dept, sheet, rec) (담당자=처리자 필드 귀속) · 조회: Records.month
   - 상품코드(자체코드) 입력 시 제품명 자동연동(카탈로그 API)
   =========================================================================== */
(function(){
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays=(s,n)=>{ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return ymd(d); };
  const monthsBetween=(from,to)=>{ const out=[]; let y=+from.slice(0,4), m=+from.slice(5,7);
    const ey=+to.slice(0,4), em=+to.slice(5,7); let g=0;
    while((y<ey||(y===ey&&m<=em))&&g++<60){ out.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++;} } return out; };
  const NAME_PALETTE=['#2f6fed','#0f9d8e','#e0743a','#7a5af0','#1a8f4a','#e0518f','#0d8bd9','#b26a00','#8e44ad','#d4327a'];
  function colorForName(n){ const s=String(n||''); let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return NAME_PALETTE[h%NAME_PALETTE.length]; }

  /* 상품코드 → 제품명 조회 (카탈로그, 캐시) */
  const codeCache={};
  async function lookupProduct(code){
    const c=String(code||'').trim().toUpperCase(); if(!c) return null;
    if(Object.prototype.hasOwnProperty.call(codeCache,c)) return codeCache[c];
    try{ const r=await fetch('/api/catalog?code='+encodeURIComponent(c)); const d=await r.json();
      const p=(d&&d.product)||null; codeCache[c]=p; return p; }catch(e){ return null; }
  }

  function buildBoard(cfg){
    // cfg: { key, title, icon, sheet, desc, fields:[{k,label,type,options?,w?,req?}], whoField, codeField, nameField, statusField }
    MODULES[cfg.key]={
      title:cfg.title, icon:cfg.icon||'clipboard',
      render(root){
        const isAdmin=!!(Auth.isAdmin&&Auth.isAdmin());
        const me=(Auth.user&&Auth.user())||{};
        // 담당자 목록 (사용자 편집 · 로컬 저장) — whoField 가 select/agent 인 경우
        const whoCfg = cfg.fields.find(f=>f.k===cfg.whoField);
        const agentsKey = 'eduino.md.board.'+cfg.sheet+'.agents';
        const getAgents=()=> store(agentsKey).get((whoCfg&&whoCfg.options)?whoCfg.options.slice():[]);
        const setAgents=(v)=> store(agentsKey).set(v);

        root.innerHTML=`
        <style>
          .bd-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;margin-bottom:20px;box-shadow:var(--sh)}
          .bd-hd{display:flex;align-items:center;gap:10px;padding:14px 20px;background:linear-gradient(180deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);font-weight:800;font-size:15.5px}
          .bd-hd .bd-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--red-soft);color:var(--red)}
          .bd-hd .bd-ic svg{width:15px;height:15px}
          .bd-bd{padding:18px 20px}
          .bd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px 16px;align-items:start}
          .bd-f{display:flex;flex-direction:column;gap:6px}
          .bd-f.wide{grid-column:1 / -1}
          .bd-f label{font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
          .bd-f label .req{color:var(--red);margin-left:3px}
          .bd-f input,.bd-f select,.bd-f textarea{height:40px;font-size:14px;border:1px solid var(--line-strong);border-radius:9px;padding:0 11px;background:var(--panel);width:100%}
          .bd-f textarea{height:auto;min-height:64px;padding:9px 11px;resize:vertical;line-height:1.5}
          .bd-f input:focus,.bd-f select:focus,.bd-f textarea:focus{border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft);outline:none}
          .bd-chips{display:flex;gap:7px;flex-wrap:wrap}
          .bd-chip{display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--line-strong);border-radius:8px;background:var(--panel);font-size:13.5px;font-weight:600;color:var(--ink-2);cursor:pointer;transition:.12s;user-select:none}
          .bd-chip:hover{border-color:var(--faint);background:var(--panel-2)}
          .bd-chip.on{border-color:var(--red);background:var(--red-soft);color:var(--red);font-weight:700;box-shadow:inset 0 0 0 1px var(--red)}
          .bd-code-hint{font-size:12px;color:var(--info);min-height:15px}
          .bd-code-hint.warn{color:var(--warn)}
          .bd-actions{display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap}
          .bd-ctrl{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;margin-bottom:12px}
          .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
          .seg button{border:0;background:var(--panel);padding:7px 13px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;border-left:1px solid var(--line-2)}
          .seg button:first-child{border-left:0}
          .seg button.on{background:var(--active-bg);color:var(--red)}
          .bd-dates{display:none;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
          .bd-dates.on{display:inline-flex}
          .bd-in{height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;font-size:13px;min-width:120px}
          .bd-sp{flex:1}
          .bd-meta{font-size:12.5px;color:var(--muted);margin:0 0 8px;font-weight:600}
          .bd-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 430px);min-height:160px;background:var(--panel);box-shadow:var(--sh-sm)}
          table.bd{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
          table.bd th{position:sticky;top:0;z-index:2;background:#f4f6f9;color:var(--ink-2);font-size:11.5px;font-weight:800;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
          table.bd td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink-2)}
          table.bd tr:nth-child(even) td{background:var(--zebra)}
          table.bd td.wrap{white-space:pre-wrap;word-break:break-word;line-height:1.45;min-width:180px}
          table.bd td.who{font-weight:700}
          .bd-badge{display:inline-block;font-weight:700;border-radius:6px;padding:2px 9px;font-size:12px;background:var(--line-2);color:var(--muted)}
          .bd-del{border:0;background:none;color:var(--faint);cursor:pointer;padding:2px 5px;border-radius:5px}
          .bd-del:hover{background:var(--danger-soft);color:var(--danger)}
          .bd-empty{padding:40px;text-align:center;color:var(--muted);font-size:14px}
        </style>
        <div class="mhead pad"><div class="tt">${esc(cfg.title)}</div><div class="ds">${esc(cfg.desc)}</div></div>
        <div class="mbody wide">
          <div class="bd-card">
            <div class="bd-hd"><span class="bd-ic">${icon('plus')}</span>새 기록 입력</div>
            <div class="bd-bd"><form id="bForm"><div class="bd-grid" id="fGrid"></div>
              <div class="bd-actions">
                <button type="submit" class="btn pri lg">${icon('save')}저장</button>
                <span class="muted" id="fMsg" style="font-size:13px"></span></div>
            </div></form></div>
          </div>

          <div class="bd-ctrl">
            <span class="seg" id="segR">
              <button data-r="today">오늘</button><button data-r="7">7일</button>
              <button data-r="30">30일</button><button data-r="month" class="on">이번달</button>
              <button data-r="custom">지정</button></span>
            <span class="bd-dates" id="dates"><input type="date" id="dFrom"> ~ <input type="date" id="dTo"></span>
            ${cfg.whoField?`<select class="bd-in" id="fWho"><option value="">${esc((whoCfg&&whoCfg.label)||'담당자')} 전체</option></select>`:''}
            <input class="bd-in" id="fQ" type="text" placeholder="검색어…">
            <span class="bd-sp"></span>
            <button class="btn ghost sm" id="btnCsv">${icon('download')}CSV</button>
            <button class="btn ghost sm" id="btnReload">${icon('refresh')}</button>
          </div>
          <p class="bd-meta" id="meta"></p>
          <div class="bd-wrap"><table class="bd" id="tbl"></table></div>
          <p class="bd-meta" style="margin-top:10px;color:var(--faint)">팀 공유 기록입니다 · 저장 시 서버에 누적되어 모든 담당자에게 보입니다.${isAdmin?' 관리자는 행을 삭제할 수 있습니다.':''}</p>
        </div>`;

        const $=s=>root.querySelector(s);
        const form={};  // 폼 상태 (칩 선택값 등)
        cfg.fields.forEach(f=>{ form[f.k] = f.type==='date' ? todayStr() : ''; });

        /* ---- 입력 폼 렌더 ---- */
        const grid=$('#fGrid');
        cfg.fields.forEach(f=>{
          const wrap=el('div','bd-f'+((f.type==='textarea')?' wide':''));
          const lab=`<label>${esc(f.label)}${f.req?'<span class="req">*</span>':''}</label>`;
          if(f.type==='agent' || (f.type==='select' && f.k===cfg.whoField)){
            wrap.innerHTML=lab+`<div class="bd-chips" data-agentchips></div>`;
            grid.appendChild(wrap); renderAgentChips(wrap.querySelector('[data-agentchips]'), f);
          } else if(f.type==='select'){
            wrap.innerHTML=lab+`<select data-k="${esc(f.k)}"><option value="">(선택)</option>${(f.options||[]).map(o=>`<option>${esc(o)}</option>`).join('')}</select>`;
            grid.appendChild(wrap);
            wrap.querySelector('select').onchange=e=>form[f.k]=e.target.value;
          } else if(f.type==='toggle'){
            wrap.innerHTML=lab+`<label style="display:flex;align-items:center;gap:8px;height:40px;font-size:14px;font-weight:600;cursor:pointer"><input type="checkbox" data-k="${esc(f.k)}" style="width:18px;height:18px"> ${esc(f.onLabel||'완료')}</label>`;
            grid.appendChild(wrap);
            wrap.querySelector('input').onchange=e=>form[f.k]=e.target.checked?(f.onLabel||'완료'):'';
          } else if(f.type==='textarea'){
            wrap.innerHTML=lab+`<textarea data-k="${esc(f.k)}" placeholder="${esc(f.ph||'')}"></textarea>`;
            grid.appendChild(wrap);
            wrap.querySelector('textarea').oninput=e=>form[f.k]=e.target.value;
          } else if(f.type==='number'){
            wrap.innerHTML=lab+`<input type="number" data-k="${esc(f.k)}" placeholder="${esc(f.ph||'')}" min="0" ${f.max?`max="${f.max}"`:''}>`;
            grid.appendChild(wrap);
            wrap.querySelector('input').oninput=e=>form[f.k]=e.target.value;
          } else { // text / date / code
            const t = f.type==='date'?'date':'text';
            wrap.innerHTML=lab+`<input type="${t}" data-k="${esc(f.k)}" ${f.type==='date'?`value="${esc(form[f.k])}"`:''} placeholder="${esc(f.ph||'')}" ${f.k===cfg.codeField?'autocomplete="off"':''}>`+
              (f.k===cfg.codeField?`<div class="bd-code-hint" data-codehint></div>`:'');
            grid.appendChild(wrap);
            const inp=wrap.querySelector('input');
            inp.oninput=e=>form[f.k]=e.target.value;
            if(f.k===cfg.codeField) wireCodeLookup(inp, wrap.querySelector('[data-codehint]'));
          }
        });

        function renderAgentChips(box, f){
          const list=getAgents();
          box.innerHTML='';
          list.forEach(a=>{ const b=el('button','bd-chip'+(form[f.k]===a?' on':'')); b.type='button'; b.textContent=a;
            b.onclick=()=>{ form[f.k]=(form[f.k]===a?'':a); renderAgentChips(box,f); };
            box.appendChild(b); });
          if(isAdmin){ const add=el('button','bd-chip'); add.type='button'; add.textContent='＋'; add.title='담당자 추가';
            add.style.cssText='color:var(--muted);border-style:dashed';
            add.onclick=()=>{ const v=(prompt('추가할 담당자 이름','')||'').trim(); if(!v) return;
              const cur=getAgents(); if(!cur.includes(v)){ cur.push(v); setAgents(cur); } form[f.k]=v; renderAgentChips(box,f); };
            box.appendChild(add); }
        }
        function wireCodeLookup(inp, hint){
          const nameField = cfg.nameField;
          let seq=0, tmr=null;
          const run=()=>{ const code=inp.value.trim(); const my=++seq;
            if(!code){ hint.textContent=''; hint.className='bd-code-hint'; return; }
            hint.textContent='조회 중…'; hint.className='bd-code-hint';
            lookupProduct(code).then(p=>{ if(my!==seq||!root.isConnected) return;
              if(p){ hint.textContent='✓ '+(p.name||'(이름 없음)'); hint.className='bd-code-hint';
                if(nameField){ const nEl=grid.querySelector(`[data-k="${nameField}"]`);
                  if(nEl && (!nEl.value.trim() || nEl.dataset.auto==='1')){ nEl.value=p.name||''; nEl.dataset.auto='1'; form[nameField]=p.name||''; } } }
              else { hint.textContent='미등록 코드 — 제품명을 직접 입력'; hint.className='bd-code-hint warn'; }
            }); };
          inp.addEventListener('input',()=>{ clearTimeout(tmr); tmr=setTimeout(run,300); });
          if(cfg.nameField){ const nEl=grid.querySelector(`[data-k="${cfg.nameField}"]`); if(nEl) nEl.addEventListener('input',()=>{ nEl.dataset.auto=''; }); }
        }

        /* ---- 저장 ---- */
        let all=[];
        $('#bForm').addEventListener('submit',e=>{ e.preventDefault();
          const reqMiss=cfg.fields.find(f=>f.req && !String(form[f.k]||'').trim());
          if(reqMiss){ $('#fMsg').textContent='필수 항목: '+reqMiss.label; return; }
          if(cfg.titleField && !String(form[cfg.titleField]||'').trim()){ $('#fMsg').textContent='필수 항목: '+(cfg.fields.find(f=>f.k===cfg.titleField)||{}).label; return; }
          const who = cfg.whoField ? (form[cfg.whoField]||'') : (me.name||'');
          const dateVal = cfg.dateField ? (form[cfg.dateField]||todayStr()) : todayStr();
          const rec={ id:uuid(), createdAt:nowISO(), day: (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)?dateVal:todayStr()),
            who: me.loginId||('@'+(who||'?')), whoName: who };
          cfg.fields.forEach(f=>{ rec[f.k]= form[f.k]!=null?form[f.k]:''; });
          all.unshift(rec); paint();
          if(window.Records) Records.pushRaw('md', cfg.sheet, rec);
          // 폼 리셋(담당자/날짜는 유지)
          cfg.fields.forEach(f=>{ if(f.k===cfg.whoField) return; if(f.type==='date'){ form[f.k]=todayStr(); return; } form[f.k]=''; });
          resetInputs();
          $('#fMsg').textContent='저장되었습니다'; setTimeout(()=>{ if($('#fMsg')) $('#fMsg').textContent=''; }, 2500);
        });
        function resetInputs(){
          grid.querySelectorAll('[data-k]').forEach(inp=>{ const k=inp.dataset.k; const f=cfg.fields.find(x=>x.k===k);
            if(!f) return;
            if(f.type==='toggle'){ inp.checked=false; }
            else if(f.type==='date'){ inp.value=form[k]; }
            else { inp.value=''; inp.dataset.auto=''; }
          });
          grid.querySelectorAll('[data-codehint]').forEach(h=>h.textContent='');
          grid.querySelectorAll('[data-agentchips]').forEach((box)=>{ const f=cfg.fields.find(x=>x.k===cfg.whoField); if(f) renderAgentChips(box,f); });
        }

        /* ---- 표(조회) ---- */
        let preset='month', custom={from:todayStr(),to:todayStr()}, who='', q='', editId=null;
        function range(){ const to=todayStr();
          if(preset==='today') return {from:to,to};
          if(preset==='7') return {from:addDays(to,-6),to};
          if(preset==='30') return {from:addDays(to,-29),to};
          if(preset==='month') return {from:to.slice(0,8)+'01',to};
          return {from:custom.from<=custom.to?custom.from:custom.to, to:custom.from<=custom.to?custom.to:custom.from};
        }
        const showCols = cfg.fields.filter(f=>!f.hideInTable);
        function filtered(){ const {from,to}=range();
          let rows=all.filter(r=>{ const d=r.day||r[cfg.dateField]||''; return d>=from&&d<=to; });
          if(cfg.whoField && who) rows=rows.filter(r=>(r.whoName||r[cfg.whoField]||'')===who);
          if(q){ const s=q.toLowerCase(); rows=rows.filter(r=>showCols.some(c=>String(r[c.k]??'').toLowerCase().includes(s))); }
          rows.sort((a,b)=>String(b.day||'').localeCompare(String(a.day||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
          return {rows,from,to};
        }
        function fmtCell(r,c){
          let v=r[c.k]; v = v==null?'':String(v);
          if(c.k===cfg.whoField && v){ const col=colorForName(v); return `<td style="white-space:nowrap"><span class="bd-badge" style="color:${col};background:${col}1a">${esc(v)}</span></td>`; }
          if(c.type==='select' && v){ return `<td style="white-space:nowrap"><span class="bd-badge">${esc(v)}</span></td>`; }
          if(c.type==='toggle'){ return `<td style="white-space:nowrap">${v?`<span class="bd-badge" style="color:var(--ok);background:var(--ok-bg)">${esc(v)}</span>`:'<span class="muted">-</span>'}</td>`; }
          const cls=(c.type==='textarea'?'wrap ':'');
          return `<td class="${cls.trim()}" ${c.type==='textarea'?'':'style="white-space:nowrap"'}>${esc(v)}</td>`;
        }
        function paint(){
          if(!root.isConnected || !$('#tbl')) return;
          const {rows,from,to}=filtered();
          $('#meta').textContent=`${from} ~ ${to} · 총 ${rows.length.toLocaleString()}건`;
          const hasAct=isAdmin;
          const head=`<thead><tr>${showCols.map(c=>`<th>${esc(c.label)}</th>`).join('')}${hasAct?'<th></th>':''}</tr></thead>`;
          if(!rows.length){ $('#tbl').innerHTML=head+`<tbody><tr><td class="bd-empty" colspan="${showCols.length+1}">해당 기간의 기록이 없습니다.</td></tr></tbody>`; return; }
          const CAP=1500; const show=rows.slice(0,CAP);
          $('#tbl').innerHTML=head+`<tbody>${show.map(r=> editId===r.id ? editRow(r,hasAct) : `<tr>${showCols.map(c=>fmtCell(r,c)).join('')}${hasAct?actionCell(r):''}</tr>`).join('')}</tbody>`;
          if(rows.length>CAP) $('#meta').textContent+=` (앞 ${CAP}건 표시)`;
          wire();
        }
        function actionCell(r){ return `<td style="white-space:nowrap"><span style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn ghost sm" data-a="edit" data-id="${esc(r.id)}">수정</button>
          <button class="bd-del" data-a="del" data-id="${esc(r.id)}" title="삭제">${icon('trash')}</button></span></td>`; }
        function editRow(r,hasAct){
          const cells=showCols.map(c=>{
            const v=r[c.k]==null?'':String(r[c.k]);
            if(c.type==='select'||c.type==='agent'){ const opts=(c.type==='agent'?getAgents():(c.options||[]));
              return `<td><select data-k="${esc(c.k)}"><option value="">(선택)</option>${[...new Set([...opts,v].filter(Boolean))].map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select></td>`; }
            if(c.type==='toggle'){ return `<td><input type="checkbox" data-k="${esc(c.k)}" ${v?'checked':''} data-on="${esc(c.onLabel||'완료')}"></td>`; }
            if(c.type==='textarea'){ return `<td><textarea data-k="${esc(c.k)}" rows="2" style="width:100%;min-width:160px;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px">${esc(v)}</textarea></td>`; }
            const t=c.type==='date'?'date':(c.type==='number'?'number':'text');
            return `<td><input data-k="${esc(c.k)}" type="${t}" value="${esc(v)}" style="width:${c.type==='textarea'?'160':'110'}px;font:inherit;border:1px solid var(--line-2);border-radius:6px;padding:5px 7px"></td>`;
          }).join('');
          return `<tr>${cells}${hasAct?`<td style="white-space:nowrap"><span style="display:flex;gap:4px">
            <button class="btn pri sm" data-a="save" data-id="${esc(r.id)}">${icon('check')}</button>
            <button class="btn ghost sm" data-a="cancel">취소</button></span></td>`:''}</tr>`;
        }
        function wire(){
          $('#tbl').querySelectorAll('[data-a=edit]').forEach(b=>b.onclick=()=>{ editId=b.dataset.id; paint(); });
          $('#tbl').querySelectorAll('[data-a=cancel]').forEach(b=>b.onclick=()=>{ editId=null; paint(); });
          $('#tbl').querySelectorAll('[data-a=save]').forEach(b=>b.onclick=async(e)=>{
            const tr=e.currentTarget.closest('tr'); const old=all.find(x=>x.id===editId); if(!old) return;
            const rec={...old};
            tr.querySelectorAll('[data-k]').forEach(inp=>{ const k=inp.dataset.k;
              rec[k]= inp.type==='checkbox' ? (inp.checked?(inp.dataset.on||'완료'):'') : inp.value; });
            if(cfg.whoField) rec.whoName=rec[cfg.whoField]||rec.whoName;
            if(cfg.dateField) rec.day = /^\d{4}-\d{2}-\d{2}$/.test(rec[cfg.dateField]||'')?rec[cfg.dateField]:rec.day;
            e.currentTarget.disabled=true;
            Object.assign(old,rec); editId=null; paintWho(); paint();
            if(window.Records){ const oldM=String(old.day||'').slice(0,7); await Records.pushRaw('md',cfg.sheet,rec); }
            toast('수정했습니다');
          });
          if(isAdmin) $('#tbl').querySelectorAll('[data-a=del]').forEach(b=>b.onclick=async()=>{
            if(!confirm('이 기록을 서버에서 삭제할까요? (되돌릴 수 없음)')) return;
            const r=all.find(x=>x.id===b.dataset.id); if(!r) return;
            await Records.del('md',cfg.sheet,r.id,(r.day||'').slice(0,7),r.who,r.day);
            all=all.filter(x=>x.id!==r.id); paintWho(); paint(); toast('삭제했습니다');
          });
        }
        function paintWho(){ if(!cfg.whoField) return; const sel=$('#fWho'); if(!sel) return;
          const names=[...new Set(all.map(r=>r.whoName||r[cfg.whoField]).filter(Boolean))].sort();
          sel.innerHTML=`<option value="">${esc((whoCfg&&whoCfg.label)||'담당자')} 전체</option>`+names.map(n=>`<option ${n===who?'selected':''}>${esc(n)}</option>`).join('');
        }

        $('#segR').querySelectorAll('button').forEach(b=>b.onclick=()=>{ preset=b.dataset.r;
          $('#segR').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
          $('#dates').classList.toggle('on',preset==='custom');
          if(preset==='custom'){ $('#dFrom').value=custom.from; $('#dTo').value=custom.to; }
          load(); });
        $('#dFrom').onchange=()=>{ custom.from=$('#dFrom').value||custom.from; load(); };
        $('#dTo').onchange=()=>{ custom.to=$('#dTo').value||custom.to; load(); };
        if($('#fWho')) $('#fWho').onchange=()=>{ who=$('#fWho').value; paint(); };
        $('#fQ').oninput=()=>{ q=$('#fQ').value.trim(); paint(); };
        $('#btnReload').onclick=load;
        $('#btnCsv').onclick=()=>{ const {rows,from,to}=filtered();
          const header=showCols.map(c=>c.label);
          const lines=[header,...rows.map(r=>showCols.map(c=>r[c.k]==null?'':String(r[c.k])))];
          const csv='﻿'+lines.map(r=>r.map(c=>/[",\n]/.test(String(c))?'"'+String(c).replace(/"/g,'""')+'"':c).join(',')).join('\r\n');
          downloadBlob(new Blob([csv],{type:'text/csv'}),`${cfg.title}_${from}_${to}.csv`); toast('CSV로 저장했습니다'); };

        async function load(){
          if(!$('#meta')) return; $('#meta').textContent='불러오는 중…';
          const {from,to}=range(); const ms=monthsBetween(from,to);
          const packs=await Promise.all(ms.map(m=>Records.month('md',cfg.sheet,m)));
          if(!root.isConnected||!$('#meta')) return;
          if(packs.some(p=>p===null)){ $('#meta').textContent='서버에서 기록을 불러오지 못했습니다.'; return; }
          const map={}; packs.forEach(p=>(p||[]).forEach(r=>{ if(r&&r.id) map[r.id]=r; }));
          all=Object.values(map); paintWho(); paint();
        }
        load();
      }
    };
  }

  /* ── 1) 입점사 신규/변동사항 ── */
  buildBoard({ key:'md.vendorchg', title:'입점사 신규/변동사항', icon:'truck', sheet:'vendorchg',
    desc:'신규 제품·입점사 / 공급가 변동·이슈 등 입점사 관련 과업을 팀 공유로 기록·관리합니다.',
    titleField:'title', whoField:'assignee', dateField:'sdate',
    fields:[
      { k:'title', label:'타이틀(업무 내용)', type:'text', req:true, ph:'예: OO사 신규 입점 / △△ 공급가 인상' },
      { k:'status', label:'진행상태', type:'select', options:['신규 제품/입점사','기존 공급가변동/이슈','신규입점','대기 업무','프로모션 현황','보류','아카이브'] },
      { k:'gubun', label:'프로젝트 구분', type:'select', options:['MD','CS','디자이너','물류','마케팅','팀장','프로모션'] },
      { k:'assignee', label:'담당자', type:'agent', options:[] },
      { k:'sdate', label:'시작일', type:'date' },
      { k:'edate', label:'종료(예정)일', type:'date' },
      { k:'progress', label:'진행율(%)', type:'number', max:100, ph:'0~100' },
      { k:'note', label:'설명/비고', type:'textarea', ph:'상세 내용·이슈·조치' },
    ] });

  /* ── 2) 품절관리 현황 ── */
  buildBoard({ key:'md.stock', title:'품절관리 현황', icon:'box', sheet:'stockmgmt',
    desc:'제품별 판매·품절·단종 상태와 처리 내역을 팀 공유로 기록합니다. 자체코드 입력 시 제품명이 자동 연동됩니다.',
    titleField:'name', whoField:'handler', dateField:'date', codeField:'code', nameField:'name',
    fields:[
      { k:'date', label:'날짜', type:'date' },
      { k:'gubun', label:'분류', type:'select', options:['판매','품절','단종'] },
      { k:'own', label:'자사/입점사', type:'select', options:['자사 키트','자사 부품','입점사 키트','입점사 부품'] },
      { k:'vendor', label:'입점사명', type:'text', ph:'입점사명' },
      { k:'code', label:'자체코드', type:'code', ph:'예: P-AP3' },
      { k:'name', label:'상품관리(제품명)', type:'text', req:true, ph:'자체코드 입력 시 자동' },
      { k:'handler', label:'처리자', type:'agent', options:['여미림','이진환','신아름'] },
      { k:'content', label:'처리내용', type:'textarea', ph:'처리 내용' },
      { k:'status', label:'상태', type:'toggle', onLabel:'완료' },
      { k:'remark', label:'특이사항', type:'textarea', ph:'특이사항' },
    ] });

  /* ── 3) 제품검수 현황 (검수 내역) ── */
  buildBoard({ key:'md.inspect', title:'제품검수 현황', icon:'check', sheet:'inspect',
    desc:'입고 제품의 동작·외관·상세페이지 검수 내역을 기록합니다. 상품코드 입력 시 제품명이 자동 연동됩니다.',
    titleField:'title', whoField:'assignee', dateField:'idate', codeField:'code', nameField:'name',
    fields:[
      { k:'title', label:'검수(제목)', type:'text', req:true, ph:'예: OO 입고 검수' },
      { k:'idate', label:'입고일자', type:'date' },
      { k:'cdate', label:'검수일자', type:'date' },
      { k:'assignee', label:'담당자', type:'agent', options:['권정혁','여미림','박주희','김성우','이진환'] },
      { k:'code', label:'상품코드', type:'code', ph:'예: C-19' },
      { k:'name', label:'제품명', type:'text', ph:'상품코드 입력 시 자동' },
      { k:'func', label:'동작 기능', type:'select', options:['O','-','🔺'] },
      { k:'appear', label:'외관 및 구성품', type:'select', options:['O','🔺'] },
      { k:'detail', label:'상세페이지 수정', type:'select', options:['완료','O','요청'] },
      { k:'remark', label:'특이사항', type:'textarea', ph:'특이사항' },
    ] });

  /* ── 4) 상품관리 현황 ── */
  buildBoard({ key:'md.prodmgmt', title:'상품관리 현황', icon:'grid', sheet:'prodmgmt',
    desc:'판매·가격·썸네일·상세페이지 등 상품 관리 작업 처리 내역을 팀 공유로 기록합니다. 자체코드 입력 시 제품명이 자동 연동됩니다.',
    titleField:'name', whoField:'handler', dateField:'date', codeField:'code', nameField:'name',
    fields:[
      { k:'name', label:'상품관리(제품명)', type:'text', req:true, ph:'자체코드 입력 시 자동' },
      { k:'date', label:'날짜', type:'date' },
      { k:'handler', label:'처리자', type:'agent', options:['여미림','신아름','이진환'] },
      { k:'gubun', label:'분류', type:'select', options:['판매','품절','가격','신규상품','단종','썸네일','상세페이지'] },
      { k:'code', label:'자체코드', type:'code', ph:'예: P-AJ26' },
      { k:'content', label:'처리내용', type:'textarea', ph:'처리 내용' },
      { k:'status', label:'상태', type:'toggle', onLabel:'완료' },
      { k:'remark', label:'특이사항', type:'textarea', ph:'특이사항' },
    ] });
})();
