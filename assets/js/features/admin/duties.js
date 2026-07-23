/* ===========================================================================
   관리자 · 직무 범위 관리 (admin.duties)
   - 직원별 직무 지도(상시/담당/서브 → 업무그룹 → 세부업무) 편집
   - 엑셀/CSV 일괄등록(공용 XlsxLite) · 현황판(직원별 업무량·그룹 커버리지)
   - 지시 매칭 미리보기(Duties.match) — 2단계 '업무 지시' 기능의 엔진 검증
   ========================================================================= */
(function(){
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const me = ()=> (Auth.user&&Auth.user())||{};
  const DL = (window.Duties&&Duties.DEPT_LABEL)||{acct:'경리',cs:'CS',md:'MD',logi:'물류',admin:'관리자'};
  const WOPT = [{v:3,t:'상시(3)'},{v:2,t:'담당(2)'},{v:1,t:'서브(1)'}];
  const uid = ()=> 'd'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
  const clone = o=>JSON.parse(JSON.stringify(o));
  const csvCell = v=>{ v=String(v==null?'':v); return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };

  MODULES['admin.duties']={
    title:'직무 범위', icon:'clipboard',
    render(root){
      if(!isAdmin()){ root.innerHTML='<div class="mhead"><div class="tt">직무 범위</div></div><div class="mbody"><div class="muted" style="padding:30px">관리자만 접근할 수 있습니다.</div></div>'; return; }
      let people=[], selId=null, cur=null, seeded=false;

      root.innerHTML=`
      <style>
        .du-wrap{display:grid;grid-template-columns:230px 1fr;gap:18px;align-items:start}
        .du-side{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
        .du-side .hd{padding:10px 12px;border-bottom:1px solid var(--line);font-weight:800;font-size:12.5px;display:flex;align-items:center;gap:6px}
        .du-p{padding:9px 12px;border-bottom:1px solid var(--line-2);cursor:pointer;display:flex;align-items:center;gap:8px}
        .du-p:hover{background:var(--hover)} .du-p.on{background:var(--info-bg)}
        .du-p .nm{font-weight:700;font-size:13px} .du-p .rl{font-size:10.5px;color:var(--muted)}
        .du-dept{font-size:10px;font-weight:800;padding:1px 6px;border-radius:5px;background:var(--chip,#eef);color:var(--ink-2)}
        /* 직무 편집 — 가로 3열(상시/담당/서브) 카드 레이아웃 */
        .du-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;align-items:start}
        @media(max-width:1080px){.du-cols{grid-template-columns:1fr}}
        .du-col{border:1px solid var(--line);border-top-width:3px;border-radius:11px;background:var(--panel);overflow:hidden}
        .du-col.tier-a{border-top-color:var(--info)} .du-col.tier-b{border-top-color:var(--ok)} .du-col.tier-c{border-top-color:var(--muted)}
        .du-col-hd{padding:9px 12px;font-weight:800;font-size:13px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--line-2)}
        .du-col.tier-a .du-col-hd{background:var(--info-bg);color:var(--info)}
        .du-col.tier-b .du-col-hd{background:var(--ok-bg,#e9f9f0);color:#2f8f4e}
        .du-col.tier-c .du-col-hd{background:var(--panel-2,#f4f6fa);color:var(--ink-2)}
        .du-col-hd span{margin-left:auto;font-size:11px;font-weight:700;opacity:.85}
        .du-col-body{padding:8px 9px}
        .du-sec2{border:1px solid var(--line-2);border-radius:9px;margin-bottom:8px;background:var(--panel)}
        .du-sec2 .s2h{display:flex;gap:5px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--line-2);background:var(--panel-2,#f7f9fc)}
        .du-sec2 .s2h input.lab{font:inherit;font-weight:800;font-size:12px;border:1px solid transparent;background:transparent;border-radius:6px;padding:3px 6px;flex:1;min-width:0}
        .du-sec2 .s2h input.lab:focus{border-color:var(--line-2);background:var(--panel)}
        /* 구분(tier) 색상 — 상시(파랑)·담당(초록)·서브(회색) */
        .du-sec{border:1px solid var(--line);border-left-width:4px;border-radius:10px;margin-bottom:10px;overflow:hidden;background:var(--panel)}
        .du-sec .sh{display:flex;gap:7px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line-2)}
        .du-sec .sh .cv{cursor:pointer;color:var(--muted);font-size:12px;width:16px;flex:0 0 auto;transition:transform .12s}
        .du-sec.col .cv{transform:rotate(-90deg)} .du-sec.col .grps,.du-sec.col .gadd{display:none}
        .du-sec .sh input.lab{font:inherit;font-weight:800;font-size:12.5px;border:1px solid transparent;background:transparent;border-radius:6px;padding:3px 6px;flex:1;min-width:0}
        .du-sec .sh input.lab:focus{border-color:var(--line-2);background:var(--panel)}
        .du-sec .sh .cnt{font-size:10.5px;color:var(--muted);font-weight:700}
        .du-sec.tier-a{border-left-color:var(--info)} .du-sec.tier-a .sh{background:var(--info-bg)}
        .du-sec.tier-b{border-left-color:var(--ok)}   .du-sec.tier-b .sh{background:var(--ok-bg,#e9f9f0)}
        .du-sec.tier-c{border-left-color:var(--muted)}.du-sec.tier-c .sh{background:var(--panel-2,#f4f6fa)}
        .du-grp{padding:6px 10px 6px 12px;border-bottom:1px solid var(--line-2)}
        .du-grp:last-child{border-bottom:0}
        .du-grp .gh{display:flex;gap:6px;align-items:center;margin-bottom:3px}
        .du-grp .gh input{font:inherit;font-weight:700;font-size:12px;border:1px solid transparent;background:transparent;border-radius:6px;padding:2px 6px;flex:1;min-width:0}
        .du-grp .gh input:focus{border-color:var(--line-2);background:var(--panel)}
        .du-it{display:flex;gap:5px;align-items:center;margin:1px 0 1px 12px}
        .du-it input{font:inherit;font-size:12px;border:1px solid transparent;background:transparent;border-radius:6px;padding:2px 6px;flex:1;min-width:0}
        .du-it input:hover{background:var(--hover)} .du-it input:focus{border-color:var(--line-2);background:var(--panel)}
        .du-it .du-x,.du-grp .gh .du-x{width:20px;height:20px;opacity:.35} .du-it:hover .du-x,.du-grp:hover .gh .du-x{opacity:1}
        .du-x{border:1px solid var(--line-2);background:var(--panel);border-radius:6px;width:24px;height:24px;line-height:1;cursor:pointer;color:var(--muted);flex:0 0 auto}
        .du-x:hover{color:var(--danger);border-color:var(--danger)}
        .du-add{font-size:11.5px;color:var(--info);background:none;border:1px dashed var(--line-2);border-radius:7px;padding:4px 9px;cursor:pointer}
        .du-add:hover{border-color:var(--info)}
        .du-cov{border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin-bottom:7px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .du-cov .g{font-weight:700;font-size:12.5px;flex:1;min-width:160px}
        .du-chip{font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:var(--info-bg);color:var(--info)}
        .du-solo{background:var(--warn-bg);color:var(--warn)}
        .du-load{display:flex;align-items:center;gap:8px;margin:5px 0}
        .du-load .bar{height:12px;border-radius:6px;background:var(--info);min-width:2px}
        .du-mtest input{width:100%;font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:9px 11px}
        .du-hit{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}
        .du-hit .nm{font-weight:800;font-size:14px} .du-hit .rl{font-size:11px;color:var(--muted);margin-left:6px}
        .du-hit .why{font-size:11.5px;color:var(--ink-2);margin:4px 0 0 0;line-height:1.6}
        .du-hit .why b{color:var(--info)}
      </style>
      <div class="mhead">
        <div class="tt">직무 범위</div>
        <div class="ds">직원별 직무 지도(상시/담당/서브 → 업무그룹 → 세부업무)를 관리합니다. 지시 매칭의 기준이 됩니다.</div>
      </div>
      <div class="mbody wide" id="duBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#duBody');

      // 편집 DOM → cur 모델 반영(재렌더/저장 전) — data-si/gi 로 매핑(구조는 add/remove가 관리)
      function syncDom(){
        if(!cur) return;
        body.querySelectorAll('.du-sec2').forEach(se=>{
          const sec=cur.sections[+se.dataset.si]; if(!sec) return;
          const lab=se.querySelector('.lab'); if(lab) sec.label=lab.value.trim();
          se.querySelectorAll('.du-grp').forEach(ge=>{
            const gr=sec.groups[+ge.dataset.gi]; if(!gr) return;
            const gn=ge.querySelector('.gname'); if(gn) gr.name=gn.value.trim();
            const items=[]; ge.querySelectorAll('.du-it input').forEach(ii=>{ items.push(ii.value.trim()); });
            gr.items=items;
          });
        });
        const dn=body.querySelector('#duName'), dd=body.querySelector('#duDept'), dr=body.querySelector('#duRole');
        if(dn) cur.name=dn.value.trim(); if(dd) cur.dept=dd.value; if(dr) cur.role=dr.value;
      }
      // 저장 직전 빈 세부업무/빈 그룹 정리
      function cleanup(){ (cur.sections||[]).forEach(s=>{ (s.groups||[]).forEach(g=>{ g.items=(g.items||[]).filter(x=>String(x).trim()); }); s.groups=(s.groups||[]).filter(g=>String(g.name).trim()||g.items.length); }); cur.sections=(cur.sections||[]).filter(s=>String(s.label).trim()||s.groups.length); }

      function draw(){ drawEdit(); }

      function sideHtml(){
        return `<div class="du-side"><div class="hd">${icon('users')}팀원 <span class="muted" style="font-weight:600;margin-left:auto">${people.length}명</span></div>
          ${people.map(p=>`<div class="du-p ${p.id===selId?'on':''}" data-id="${esc(p.id)}">
            <div style="flex:1;min-width:0"><div class="nm">${esc(p.name||'(이름)')}</div><div class="rl">${p.role==='lead'?'파트장':'팀원'}</div></div>
            <span class="du-dept">${esc(DL[p.dept]||p.dept||'-')}</span></div>`).join('')}
          <div style="padding:9px 12px"><button class="du-add" id="duNew">${icon('plus')} 새 직원</button></div>
        </div>`;
      }

      function drawEdit(){
        body.innerHTML=`
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <button class="btn sm" id="duTmpl">${icon('download')}엑셀 양식</button>
            <input type="file" id="duFile" accept=".xlsx,.csv,.tsv,.txt" style="display:none"><button class="btn sm pri" id="duUp">${icon('upload')}엑셀 일괄등록</button>
            <button class="btn sm" id="duExp">${icon('download')}현재 데이터 내보내기</button>
          </div>
          ${seeded?`<div class="hl" style="border:1px solid var(--warn);background:var(--warn-bg);border-radius:9px;padding:9px 13px;margin-bottom:12px;font-size:12.5px">기본 시드(5명)를 표시 중입니다. 아무 직원이나 <b>저장</b>하거나 <b>[시드 서버 저장]</b>을 누르면 팀 공유 데이터로 승격됩니다. <button class="btn sm" id="duSeed" style="margin-left:8px">시드 서버 저장</button></div>`:''}
          <div class="du-wrap">
            ${sideHtml()}
            <div id="duMain">${cur?editorHtml():`<div class="muted" style="padding:30px">왼쪽에서 직원을 선택하거나 <b>[새 직원]</b>을 추가하세요.</div>`}</div>
          </div>`;
        wireSide();
        body.querySelector('#duTmpl').onclick=()=>downloadBlob(new Blob([templateCsv()],{type:'text/csv;charset=utf-8'}),'직무범위_일괄등록양식.csv');
        body.querySelector('#duExp').onclick=()=>downloadBlob(new Blob([exportCsv()],{type:'text/csv;charset=utf-8'}),'직무범위_현재데이터.csv');
        const fEl=body.querySelector('#duFile');
        body.querySelector('#duUp').onclick=()=>fEl.click();
        fEl.onchange=async()=>{ const f=fEl.files&&fEl.files[0]; fEl.value=''; if(!f) return;
          if(!window.XlsxLite){ toast('파서를 불러오지 못했습니다'); return; }
          try{ const {rows}=await XlsxLite.parseFile(f); await importRows(rows); }
          catch(e){ toast('파일 처리 실패: '+(e.message||e)); } };
        const seedBtn=body.querySelector('#duSeed'); if(seedBtn) seedBtn.onclick=async()=>{ seedBtn.disabled=true; const n=await Duties.seedToServer(); toast(`시드 ${n}명 서버 저장`); await reload(); };
        if(cur) wireEditor();
      }

      function editorHtml(){
        return `<div style="display:flex;gap:8px;align-items:end;margin-bottom:14px;flex-wrap:wrap">
            <div><div class="muted" style="font-size:11px;font-weight:800;margin-bottom:3px">이름</div><input id="duName" value="${esc(cur.name||'')}" style="font:inherit;font-weight:800;font-size:15px;border:1px solid var(--line-2);border-radius:8px;padding:7px 10px;width:150px"></div>
            <div><div class="muted" style="font-size:11px;font-weight:800;margin-bottom:3px">부서</div><select id="duDept" style="font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:8px 10px">${Object.keys(DL).map(k=>`<option value="${k}" ${cur.dept===k?'selected':''}>${DL[k]}</option>`).join('')}</select></div>
            <div><div class="muted" style="font-size:11px;font-weight:800;margin-bottom:3px">역할</div><select id="duRole" style="font:inherit;font-size:13px;border:1px solid var(--line-2);border-radius:8px;padding:8px 10px"><option value="member" ${cur.role!=='lead'?'selected':''}>팀원</option><option value="lead" ${cur.role==='lead'?'selected':''}>파트장</option></select></div>
            <div style="flex:1"></div>
            <button class="btn ghost" id="duDel" style="color:var(--danger)">${icon('trash')}직원 삭제</button>
            <button class="btn pri" id="duSave">${icon('save')}저장</button>
          </div>
          <div class="du-cols">${TIERS.map(colHtml).join('')}</div>
          <div id="duMsg" class="muted" style="font-size:12.5px;margin-top:8px;min-height:16px"></div>`;
      }
      const TIERS=[{w:3,label:'상시',cls:'tier-a'},{w:2,label:'담당',cls:'tier-b'},{w:1,label:'서브',cls:'tier-c'}];
      const tierW = w=> w>=3?3:w===2?2:1;
      function colHtml(t){
        const secs=(cur.sections||[]).map((s,i)=>({s,i})).filter(x=>tierW(x.s.w||1)===t.w);
        const cnt=secs.reduce((a,x)=>a+(x.s.groups||[]).reduce((b,g)=>b+(g.items||[]).length,0),0);
        return `<div class="du-col ${t.cls}">
          <div class="du-col-hd">${esc(t.label)} <span>${cnt}업무</span></div>
          <div class="du-col-body">
            ${secs.map(x=>secHtml(x.s,x.i)).join('')||'<div class="muted" style="font-size:11.5px;padding:8px 4px">구분 없음</div>'}
            <button class="du-add" data-act="addsec" data-w="${t.w}" style="width:100%;justify-content:center;margin-top:2px">${icon('plus')} 구분 추가</button>
          </div></div>`;
      }
      function secHtml(sec,si){
        return `<div class="du-sec2" data-si="${si}">
          <div class="s2h"><input class="lab" value="${esc(sec.label||'')}" placeholder="구분 이름(예: 상시-공통)"><button class="du-x" data-act="delsec" data-si="${si}" title="구분 삭제">✕</button></div>
          <div class="grps">${(sec.groups||[]).map((g,gi)=>grpHtml(g,si,gi)).join('')}</div>
          <div style="padding:4px 8px 7px"><button class="du-add" data-act="addgrp" data-si="${si}" style="padding:2px 8px;font-size:11px">${icon('plus')} 업무그룹</button></div>
        </div>`;
      }
      function grpHtml(gr,si,gi){
        return `<div class="du-grp" data-si="${si}" data-gi="${gi}">
          <div class="gh"><input class="gname" value="${esc(gr.name||'')}" placeholder="업무그룹"><button class="du-x" data-act="delgrp" data-si="${si}" data-gi="${gi}" title="그룹 삭제">✕</button></div>
          ${(gr.items||[]).map((it,ii)=>`<div class="du-it"><span style="color:var(--faint);font-size:10px">•</span><input value="${esc(it)}" placeholder="세부업무"><button class="du-x" data-act="delit" data-si="${si}" data-gi="${gi}" data-ii="${ii}" title="삭제">✕</button></div>`).join('')}
          <div style="margin:2px 0 2px 12px"><button class="du-add" data-act="addit" data-si="${si}" data-gi="${gi}" style="padding:1px 7px;font-size:10.5px">${icon('plus')} 세부업무</button></div>
        </div>`;
      }
      function wireEditor(){
        const m=body.querySelector('#duMain');
        m.querySelector('#duSave').onclick=async()=>{ syncDom(); cleanup(); const msg=body.querySelector('#duMsg');
          if(!cur.name){ msg.innerHTML='<span style="color:var(--danger)">이름을 입력하세요.</span>'; return; }
          cur.updatedBy=me().name||me().loginId||''; cur.updatedAt=new Date().toISOString();
          msg.innerHTML='<span style="color:var(--info)">저장 중…</span>';
          const ok=await Duties.save(clone(cur));
          if(ok){ toast(cur.name+' 직무 저장'); await reload(cur.id); } else msg.innerHTML='<span style="color:var(--danger)">저장 실패</span>';
        };
        m.querySelector('#duDel').onclick=async()=>{ if(!confirm(`'${cur.name}' 직무 데이터를 삭제할까요?`)) return;
          if(seeded){ toast('시드는 [시드 서버 저장] 후 삭제하세요'); return; }
          const ok=await Duties.remove(cur.id); if(ok){ toast('삭제'); selId=null; cur=null; await reload(); } else toast('삭제 실패'); };
        m.querySelectorAll('[data-act]').forEach(btn=>{ btn.onclick=()=>{
          const act=btn.dataset.act; syncDom();
          if(act==='addsec'){ cur.sections.push({label:'',w:+btn.dataset.w||2,groups:[{name:'',items:['']}]}); drawEdit(); return; }
          const si=+btn.dataset.si, sec=cur.sections[si]; if(!sec) return;
          if(act==='delsec'){ cur.sections.splice(si,1); }
          else { const gi=+btn.dataset.gi;
            if(act==='addgrp') sec.groups.push({name:'',items:['']});
            else if(act==='delgrp') sec.groups.splice(gi,1);
            else if(act==='addit') sec.groups[gi].items.push('');
            else if(act==='delit') sec.groups[gi].items.splice(+btn.dataset.ii,1);
          }
          drawEdit();
        }; });
      }
      function wireSide(){
        body.querySelectorAll('.du-p').forEach(p=>p.onclick=()=>{ syncDom(); selId=p.dataset.id; cur=clone(people.find(x=>x.id===selId)); drawEdit(); });
        const nw=body.querySelector('#duNew'); if(nw) nw.onclick=()=>{ syncDom(); cur={ id:uid(), name:'', dept:'cs', role:'member', sections:[{label:'상시-담당',w:3,groups:[{name:'',items:['']}]}] }; selId=cur.id; people=people.concat([cur]); drawEdit(); };
        // 현황판/엑셀 버튼은 board에서
      }


      /* ── 엑셀 양식/내보내기/가져오기 ──
         컬럼: 이름 · 부서 · 역할 · 구분 · 가중치 · 업무그룹 · 세부업무  (세부업무 1개 = 1행) */
      const COLS=['이름','부서','역할','구분','가중치','업무그룹','세부업무'];
      function templateCsv(){
        const ex=[
          ['홍길동','CS','팀원','상시-담당','3','주문관리-카페24/오픈마켓','채널 상담(카카오/네이버톡톡)'],
          ['홍길동','CS','팀원','상시-담당','3','주문관리-카페24/오픈마켓','배송 관리(발송지연/교환/반품)'],
          ['홍길동','CS','팀원','서브','1','택배','택배 운임 월정산'],
        ];
        return '﻿'+[COLS, ...ex].map(r=>r.map(csvCell).join(',')).join('\r\n');
      }
      function exportCsv(){
        const rows=[COLS];
        people.forEach(p=>(p.sections||[]).forEach(s=>(s.groups||[]).forEach(g=>{
          const its=(g.items||[]).length?g.items:[''];
          its.forEach(it=>rows.push([p.name, DL[p.dept]||p.dept||'', p.role==='lead'?'파트장':'팀원', s.label||'', String(s.w||1), g.name||'', it]));
        })));
        return '﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
      }
      async function importRows(rows){
        rows=(rows||[]).filter(r=>Array.isArray(r)&&r.some(c=>String(c==null?'':c).trim()!==''));
        if(rows.length<2){ toast('데이터 행이 없습니다'); return; }
        const nrm=s=>String(s==null?'':s).replace(/\s+/g,'').toLowerCase();
        const header=rows[0].map(nrm); const idx={};
        ['이름','부서','역할','구분','가중치','업무그룹','세부업무'].forEach(l=>{ idx[l]=header.indexOf(nrm(l)); });
        let start=1; if(idx['이름']<0){ // 헤더 없음 → 순서 가정
          COLS.forEach((l,i)=>idx[l]=i); start=0; }
        const deptKey=v=>{ v=String(v||'').trim(); for(const k in DL){ if(DL[k]===v||k===v) return k; } return v.toLowerCase()||'cs'; };
        // 이름별로 사람 구성
        const byName={};
        for(let r=start;r<rows.length;r++){ const row=rows[r]||[]; const get=l=>String(row[idx[l]]==null?'':row[idx[l]]).trim();
          const name=get('이름'); if(!name) continue;
          const p=byName[name]||(byName[name]={ name, dept:deptKey(get('부서')), role:/파트장|lead/i.test(get('역할'))?'lead':'member', sections:[] });
          const label=get('구분')||'담당'; const w=+get('가중치')|| (/상시/.test(label)?3:/서브/.test(label)?1:2);
          let sec=p.sections.find(s=>s.label===label); if(!sec){ sec={label,w,groups:[]}; p.sections.push(sec); }
          const gname=get('업무그룹'); if(!gname) continue;
          let gr=sec.groups.find(x=>x.name===gname); if(!gr){ gr={name:gname,items:[]}; sec.groups.push(gr); }
          const it=get('세부업무'); if(it) gr.items.push(it);
        }
        const list=Object.values(byName); if(!list.length){ toast('인식된 직원이 없습니다'); return; }
        // 같은 이름 있으면 id 유지(덮어쓰기), 없으면 신규
        let n=0; for(const np of list){ const ex=people.find(x=>x.name===np.name); np.id=ex?ex.id:uid();
          np.updatedBy=me().name||me().loginId||''; np.updatedAt=new Date().toISOString();
          if(await Duties.save(np)) n++; }
        toast(`직무 데이터 ${n}명 일괄 반영`); await reload();
      }

      async function reload(keepId){ people=await Duties.load(true); seeded=!!people._seeded;
        if(!root.isConnected) return;
        if(keepId){ selId=keepId; cur=clone(people.find(x=>x.id===keepId)||null); }
        else if(selId){ const s=people.find(x=>x.id===selId); cur=s?clone(s):null; if(!s) selId=null; }
        draw(); }

      (async()=>{ people=await Duties.load(); seeded=!!people._seeded; if(!root.isConnected) return;
        if(people.length){ selId=people[0].id; cur=clone(people[0]); } draw(); })();
    }
  };

  /* ── 팀 설정 컨테이너 — 팀원 계정 + 직무 범위를 한 곳에서(탭) ── */
  MODULES['admin.team']={
    title:'팀 설정', icon:'users',
    render(root){
      if(!isAdmin()){ root.innerHTML='<div class="mhead"><div class="tt">팀 설정</div></div><div class="mbody"><div class="muted" style="padding:30px">관리자만 접근할 수 있습니다.</div></div>'; return; }
      const SUBS=[
        { t:'users',  label:'팀원 계정' },
        { t:'duties', label:'직무 범위' },
        { t:'board',  label:'업무지시현황' },
      ];
      let tab=(window.__teamTab && SUBS.some(s=>s.t===window.__teamTab))?window.__teamTab:'users';
      window.__teamTab=null;
      root.innerHTML=`
        <div class="mhead">
          <div class="tt">팀 설정</div>
          <div class="ds">팀원 계정·권한, 직무 범위, 업무 지시 현황을 한 곳에서 관리합니다.</div>
          <div class="mtabs">${SUBS.map(s=>`<div class="t" data-t="${s.t}">${esc(s.label)}</div>`).join('')}</div>
        </div>
        <div class="mbody wide" id="tmBody"></div>`;
      const body=root.querySelector('#tmBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      function draw(){
        if(tab==='users') embedModule(body,'admin.users');
        else if(tab==='duties') embedModule(body,'admin.duties');
        else { body.innerHTML=''; if(window.renderAssignBoard) window.renderAssignBoard(body); }
      }
      draw();
    }
  };
})();
