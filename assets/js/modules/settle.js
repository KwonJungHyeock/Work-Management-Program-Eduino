/* ===========================================================================
   일일결산 — 담당자 전달 → 파트장 상신 → 관리자 결재 → 통합 저장 + 구글시트('일일결산')
   - 자동 집계: 그날 프로그램에 쌓인 각 파트 기록(상담/발주/현황판 등)을 날짜 기준으로 합산
   - 서버 공용 컬렉션 'settlements' 에 부서·날짜당 1건(upsert)로 누적 → 전 직원/대표 공유
   - 결재(승인) 시 구글 '일일결산' 탭에 통합 내용 연동(같은 통합 URL · id 기준 갱신)
   ========================================================================= */
(function(){
  const COLL='settlements';
  const SHEET_TAB='일일결산';
  const AGG={
    cs:[{sheet:'notes',label:'상담 메모'},{sheet:'postpay',label:'후불/발주'},{sheet:'exchange',label:'교환/반품'}],
    md:[{sheet:'orders',label:'입점사 발주'},{sheet:'tsnotes',label:'TS 상담'},{sheet:'vendorchg',label:'입점사 신규/변동'},
        {sheet:'stockmgmt',label:'품절관리'},{sheet:'inspect',label:'제품검수'},{sheet:'prodmgmt',label:'상품관리'}],
  };
  const DEPT_LABEL={cs:'CS',md:'MD'};
  const meU=()=>(Auth.user&&Auth.user())||{};
  const isAdmin=()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const isLead=()=>meU().role==='lead';
  const docId=(dept,date)=>`settle:${dept}:${date}`;
  const STATUS={ draft:{l:'작성 중',c:'var(--muted)',bg:'var(--panel-2)'}, submitted:{l:'결재 상신',c:'var(--info)',bg:'var(--info-bg)'}, approved:{l:'결재 완료',c:'var(--ok)',bg:'var(--ok-bg)'} };

  async function collGetAll(){ try{ const r=await fetch('/api/store?type=coll&coll='+COLL); if(!r.ok) throw 0; const d=await r.json(); return (d&&d.items)||[]; }catch(e){ return null; } }
  async function collPush(item){ try{ return await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'collPush',coll:COLL,item})}).then(r=>r.json()); }catch(e){ return null; } }

  /* 서버 시트 기록에서 해당 날짜 집계(부서별 시트 합산) */
  async function aggregate(dept,date){
    const ym=date.slice(0,7); const specs=AGG[dept]||[];
    const packs=await Promise.all(specs.map(s=>Records.month(dept,s.sheet,ym).catch(()=>null)));
    const byCat={}, byPerson={}; let total=0;
    specs.forEach((s,i)=>{ const recs=(packs[i]||[]).filter(r=>String(r.day||r.date||'')===date);
      byCat[s.label]=recs.length; total+=recs.length;
      recs.forEach(r=>{ const w=r.whoName||r.who||'?'; byPerson[w]=(byPerson[w]||0)+1; }); });
    return {byCat,byPerson,total};
  }
  const catLine=agg=>Object.entries(agg.byCat).map(([k,v])=>`${k} ${v}`).join(' · ');
  const personLine=agg=>Object.entries(agg.byPerson).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}건`).join(', ');

  /* ---- 공통 카드 렌더(집계표) ---- */
  function aggCard(dept,agg){
    const rows=(AGG[dept]||[]).map(s=>`<tr><td>${esc(s.label)}</td><td class="stnum">${agg.byCat[s.label]||0}</td></tr>`).join('');
    const ppl=Object.entries(agg.byPerson).sort((a,b)=>b[1]-a[1]);
    return `<div class="st-agg">
      <table class="st-tbl"><tbody>${rows}<tr class="st-tot"><td>합계</td><td class="stnum">${agg.total}</td></tr></tbody></table>
      <div class="st-ppl"><div class="st-ppl-cap">담당자별</div>${ppl.length?ppl.map(([n,v])=>`<span class="st-chip">${esc(n)} <b>${v}</b></span>`).join(''):'<span class="muted" style="font-size:12.5px">기록 없음</span>'}</div>
    </div>`;
  }

  const STYLE=`<style>
    .st-agg{display:grid;grid-template-columns:minmax(220px,1fr) 1.4fr;gap:16px;align-items:start}
    @media(max-width:760px){.st-agg{grid-template-columns:1fr}}
    .st-tbl{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:12px;overflow:hidden}
    .st-tbl td{padding:9px 13px;border-bottom:1px solid var(--line);font-size:13.5px}
    .st-tbl tr:last-child td{border-bottom:none}
    .st-tbl .stnum{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;width:70px}
    .st-tbl .st-tot td{background:var(--panel-2);font-weight:800}
    .st-ppl-cap{font-size:11.5px;font-weight:800;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px}
    .st-ppl{display:flex;flex-direction:column}
    .st-ppl>div+.st-chip,.st-ppl .st-chip{display:inline-flex}
    .st-ppl{gap:0}.st-ppl .st-chip{margin:0 6px 6px 0}
    .st-chip{align-items:center;gap:5px;padding:5px 11px;border:1px solid var(--line);border-radius:20px;background:var(--panel);font-size:12.5px;font-weight:600;color:var(--ink-2)}
    .st-chip b{color:var(--ink);font-variant-numeric:tabular-nums}
    .st-card{border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--sh-sm);padding:18px 20px;margin-bottom:16px}
    .st-hd{display:flex;align-items:center;gap:10px;margin-bottom:14px}
    .st-hd .st-t{font-size:15.5px;font-weight:800}
    .st-badge{font-size:11.5px;font-weight:800;border-radius:6px;padding:3px 9px}
    .st-sec-cap{font-size:11.5px;font-weight:800;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin:16px 0 8px}
    .st-contribs{display:flex;flex-direction:column;gap:8px}
    .st-cr{border:1px solid var(--line);border-radius:10px;padding:10px 13px;background:var(--panel-2)}
    .st-cr .who{font-weight:700;font-size:13.5px}.st-cr .note{font-size:13px;color:var(--ink-2);white-space:pre-wrap;margin-top:3px;line-height:1.55}
    .st-cr .at{font-size:11.5px;color:var(--muted);margin-left:auto}
    .st-note-in{width:100%;min-height:76px;font:inherit;border:1px solid var(--line-strong);border-radius:10px;padding:10px 12px;resize:vertical}
    .st-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px;align-items:center}
    .st-meta{font-size:12.5px;color:var(--muted)}
    .st-approve{border-left:3px solid var(--info)}
    .st-approve.done{border-left-color:var(--ok)}
  </style>`;

  /* ============================ 부서 일일결산(담당자·파트장) ============================ */
  function registerSettle(dept, key){
    MODULES[key]={
      title:'일일결산', icon:'check2',
      render(root){
        const u=meU();
        root.innerHTML=`${STYLE}
          <div class="mhead pad"><div class="mhead-row">
            <div><div class="tt">${DEPT_LABEL[dept]} 일일결산</div>
              <div class="ds">그날 쌓인 기록을 자동 집계합니다. 담당자는 <b>특이사항</b>을 적고 <b>[일일결산 전달]</b>, 파트장은 <b>[결재 상신]</b> 하면 대표(관리자) 결재함으로 올라갑니다.</div></div>
            <div class="mhead-act"><label class="fld" style="margin:0">기준일 <input type="date" id="stDate" value="${todayStr()}"></label></div>
          </div></div>
          <div class="mbody" id="stBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
        const body=root.querySelector('#stBody');
        const dateEl=root.querySelector('#stDate');
        async function load(){
          const date=dateEl.value||todayStr();
          body.innerHTML=`<div class="muted" style="padding:18px">집계 중…</div>`;
          const [agg, all]=await Promise.all([aggregate(dept,date), collGetAll()]);
          if(!root.isConnected) return;
          if(all===null){ body.innerHTML=`<div class="empty">${icon('alert')}<div>서버에 연결되지 않았습니다. (배포 환경에서 동작)</div></div>`; return; }
          const doc=all.find(d=>d.id===docId(dept,date)) || { id:docId(dept,date), dept, date, status:'draft', contributors:[] };
          const st=STATUS[doc.status]||STATUS.draft;
          const mine=(doc.contributors||[]).find(c=>c.who===(u.loginId||u.name));
          const locked=doc.status==='approved';
          body.innerHTML=`
            <div class="st-card">
              <div class="st-hd"><div class="st-t">${esc(date)} · ${DEPT_LABEL[dept]} 파트 집계</div>
                <span class="st-badge" style="color:${st.c};background:${st.bg}">${st.l}</span></div>
              ${aggCard(dept,agg)}
              <div class="st-sec-cap">전달한 담당자 · ${(doc.contributors||[]).length}명</div>
              <div class="st-contribs" id="stContribs">${contribHtml(doc)}</div>
              <div class="st-sec-cap">내 특이사항 ${mine?'<span style="color:var(--ok);font-weight:700;text-transform:none">✓ 전달함</span>':''}</div>
              <textarea class="st-note-in" id="stNote" placeholder="오늘 특이사항·인수인계·이슈를 적어주세요" ${locked?'disabled':''}>${esc(mine?mine.note:'')}</textarea>
              <div class="st-actions">
                <button class="btn pri" id="stTransfer" ${locked?'disabled':''}>${icon('send')}${mine?'특이사항 수정 전달':'일일결산 전달'}</button>
                ${isLead()||isAdmin()?`<button class="btn ${doc.status==='draft'?'ok':''}" id="stSubmit" ${doc.status!=='draft'?'disabled':''}>${icon('stamp')}결재 상신</button>`:''}
                <span class="st-meta" id="stMsg"></span>
              </div>
              ${doc.status!=='draft'?`<div class="st-sec-cap">파트 종합 의견 (파트장)</div><div class="st-cr"><div class="note">${esc(doc.partNote||'(없음)')}</div><div class="at" style="margin:0">상신 ${esc(doc.submittedByName||'')} · ${esc((doc.submittedAt||'').slice(0,16).replace('T',' '))}</div></div>`:''}
              ${doc.status==='approved'?`<div class="st-meta" style="margin-top:10px;color:var(--ok);font-weight:700">✓ 대표 결재 완료 · ${esc(doc.approvedByName||'')} · ${esc((doc.approvedAt||'').slice(0,16).replace('T',' '))} · 구글 '일일결산' 시트 연동됨</div>`:''}
            </div>`;
          // 전달
          root.querySelector('#stTransfer').onclick=async(e)=>{ const note=root.querySelector('#stNote').value.trim();
            e.currentTarget.disabled=true; root.querySelector('#stMsg').textContent='전달 중…';
            const cur=all.find(d=>d.id===doc.id) || doc; cur.contributors=cur.contributors||[]; cur.dept=dept; cur.date=date; cur.status=cur.status||'draft';
            const who=u.loginId||u.name; const ex=cur.contributors.find(c=>c.who===who);
            if(ex){ ex.note=note; ex.whoName=u.name||who; ex.at=nowISO(); } else cur.contributors.push({who,whoName:u.name||who,note,at:nowISO()});
            await collPush(cur); toast('일일결산을 전달했습니다'); load(); };
          // 상신(파트장/관리자)
          const sb=root.querySelector('#stSubmit'); if(sb) sb.onclick=()=>submitFlow(dept,date,agg,all.find(d=>d.id===doc.id)||doc, load);
        }
        dateEl.onchange=load; load();
      }
    };
  }

  function contribHtml(doc){
    const cs=doc.contributors||[];
    if(!cs.length) return `<div class="muted" style="font-size:13px;padding:4px 2px">아직 전달한 담당자가 없습니다.</div>`;
    return cs.map(c=>`<div class="st-cr"><div style="display:flex;align-items:center"><span class="who">${esc(c.whoName||c.who)}</span><span class="at">${esc((c.at||'').slice(0,16).replace('T',' '))}</span></div>${c.note?`<div class="note">${esc(c.note)}</div>`:'<div class="note muted">(특이사항 없음)</div>'}</div>`).join('');
  }

  /* 파트장 상신 — 파트 종합 의견 입력 후 상태 submitted + 집계 스냅샷 저장 */
  function submitFlow(dept,date,agg,doc,after){
    const partNote=prompt(`${DEPT_LABEL[dept]} 파트 종합 의견을 입력하세요 (결재 상신)\n\n오늘 집계: ${agg.total}건 · ${catLine(agg)}`, doc.partNote||'');
    if(partNote===null) return;
    const u=meU();
    const cur={ ...doc, dept, date, status:'submitted',
      metrics:{ total:agg.total, byCat:agg.byCat, byPerson:agg.byPerson },
      partNote:partNote.trim(), submittedBy:u.loginId||u.name, submittedByName:u.name||u.loginId, submittedAt:nowISO() };
    collPush(cur).then(()=>{ toast('결재 상신했습니다 — 관리자 결재함으로 전송'); if(after) after(); });
  }

  /* ============================ 결재함(관리자) ============================ */
  MODULES['admin.approvals']={
    title:'결재함', icon:'inbox',
    render(root){
      if(!isAdmin()){ root.innerHTML=`<div class="mbody"><div class="empty">${icon('alert')}<div>관리자 전용 화면입니다.</div></div></div>`; return; }
      root.innerHTML=`${STYLE}
        <div class="mhead pad"><div class="mhead-row">
          <div><div class="tt">결재함</div><div class="ds">파트장이 상신한 일일결산을 검토하고 <b>[결재(승인)]</b> 하면 통합 일일결산으로 저장되고 구글 <b>'일일결산'</b> 시트에 연동됩니다.</div></div>
          <div class="mhead-act"><label class="fld" style="margin:0">기준일 <input type="date" id="apDate" value="${todayStr()}"></label>
            <button class="btn ghost sm" id="apCfg">${icon('cloud')}시트 연동</button></div>
        </div></div>
        <div class="mbody" id="apBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#apBody'), dateEl=root.querySelector('#apDate');
      async function load(){
        const date=dateEl.value||todayStr();
        body.innerHTML=`<div class="muted" style="padding:18px">불러오는 중…</div>`;
        const all=await collGetAll();
        if(!root.isConnected) return;
        if(all===null){ body.innerHTML=`<div class="empty">${icon('alert')}<div>서버에 연결되지 않았습니다.</div></div>`; return; }
        const docs=['cs','md'].map(dp=>all.find(d=>d.id===docId(dp,date))).filter(Boolean);
        const actionable=docs.filter(d=>d.status==='submitted'||d.status==='approved');
        if(!actionable.length){ body.innerHTML=`<div class="empty">${icon('inbox')}<div style="margin-top:6px">${esc(date)}에 상신된 일일결산이 없습니다.</div><div class="muted" style="font-size:12.5px;margin-top:4px">파트장이 상신하면 여기에 표시됩니다.</div></div>`; return; }
        body.innerHTML='';
        for(const doc of actionable){ body.appendChild(await approvalCard(doc, load)); }
      }
      async function approvalCard(doc, after){
        const dept=doc.dept; const m=doc.metrics||await aggregate(dept,doc.date);
        const done=doc.status==='approved';
        const card=el('div','st-card st-approve'+(done?' done':''));
        const ppl=Object.entries(m.byPerson||{}).sort((a,b)=>b[1]-a[1]);
        card.innerHTML=`
          <div class="st-hd"><div class="st-t">${DEPT_LABEL[dept]} · ${esc(doc.date)}</div>
            <span class="st-badge" style="color:${done?'var(--ok)':'var(--info)'};background:${done?'var(--ok-bg)':'var(--info-bg)'}">${done?'결재 완료':'결재 대기'}</span></div>
          <div class="st-agg"><table class="st-tbl"><tbody>${(AGG[dept]||[]).map(s=>`<tr><td>${esc(s.label)}</td><td class="stnum">${(m.byCat||{})[s.label]||0}</td></tr>`).join('')}<tr class="st-tot"><td>합계</td><td class="stnum">${m.total||0}</td></tr></tbody></table>
            <div><div class="st-ppl-cap">담당자별</div><div>${ppl.length?ppl.map(([n,v])=>`<span class="st-chip">${esc(n)} <b>${v}</b></span>`).join(''):'<span class="muted">기록 없음</span>'}</div></div></div>
          <div class="st-sec-cap">담당자 특이사항 · ${(doc.contributors||[]).length}명</div>
          <div class="st-contribs">${contribHtml(doc)}</div>
          <div class="st-sec-cap">파트 종합 의견</div>
          <div class="st-cr"><div class="note">${esc(doc.partNote||'(없음)')}</div><div class="at" style="margin:0">상신 ${esc(doc.submittedByName||'')} · ${esc((doc.submittedAt||'').slice(0,16).replace('T',' '))}</div></div>
          <div class="st-actions">
            ${done?`<span class="st-meta" style="color:var(--ok);font-weight:700">✓ ${esc(doc.approvedByName||'')} 결재 · ${esc((doc.approvedAt||'').slice(0,16).replace('T',' '))}</span>
                    <button class="btn ghost sm" data-a="resheet">${icon('cloudUp')}시트 재전송</button>`
                 :`<button class="btn ok" data-a="approve">${icon('stamp')}결재(승인)</button>`}
            <span class="st-meta" data-msg></span></div>`;
        const msg=card.querySelector('[data-msg]');
        const ap=card.querySelector('[data-a=approve]'); if(ap) ap.onclick=async()=>{ ap.disabled=true; msg.textContent='결재 처리 중…';
          const u=meU(); const cur={ ...doc, status:'approved', metrics:m, approvedBy:u.loginId||u.name, approvedByName:u.name||'관리자', approvedAt:nowISO() };
          await collPush(cur); const r=await pushSheet(cur,m);
          msg.innerHTML=r.ok?`<span style="color:var(--ok)">결재 완료 · 시트 전송${r.unconfirmed?'(응답 확인 불가·안전)':''}</span>`:`<span style="color:var(--danger)">결재는 저장됨 · 시트 전송 실패: ${esc(r.error||'URL 미설정')}</span>`;
          toast('결재 완료 — 통합 일일결산 저장'); setTimeout(after,900); };
        const rs=card.querySelector('[data-a=resheet]'); if(rs) rs.onclick=async()=>{ rs.disabled=true; msg.textContent='재전송 중…';
          const r=await pushSheet(doc,m); msg.innerHTML=r.ok?`<span style="color:var(--ok)">시트 재전송 완료</span>`:`<span style="color:var(--danger)">실패: ${esc(r.error||'URL 미설정')}</span>`; };
        return card;
      }
      root.querySelector('#apCfg').onclick=()=>cfgDialog(root);
      dateEl.onchange=load; load();
    }
  };

  /* 결재 시 구글 '일일결산' 시트로 전송(통합 URL · id 기준 갱신) */
  async function pushSheet(doc, m){
    const cfg=store(STORE.settleCfg).get({}); const url=cfg&&cfg.sheetUrl;
    if(!url) return { ok:false, error:'시트 URL 미설정' };
    const notes=(doc.contributors||[]).filter(c=>c.note).map(c=>`[${c.whoName||c.who}] ${c.note}`).join('\n');
    const row={ id:doc.id, '날짜':doc.date, '부서':DEPT_LABEL[doc.dept]||doc.dept, '총건수':m.total||0,
      '항목별 집계':Object.entries(m.byCat||{}).map(([k,v])=>`${k} ${v}`).join(' · '),
      '담당자별 집계':Object.entries(m.byPerson||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}건`).join(', '),
      '담당자 특이사항':notes, '파트 종합':doc.partNote||'',
      '상신자':doc.submittedByName||'', '결재자':doc.approvedByName||'', '결재일시':(doc.approvedAt||'').replace('T',' ').slice(0,16) };
    const opts={ method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({ sheet:SHEET_TAB, records:[row] }) };
    try{ const res=await fetch(url,opts); let d=null; try{d=await res.json();}catch(e){} if(d&&d.ok===false) throw new Error(d.error||'시트 처리 실패'); return {ok:true, unconfirmed:!d}; }
    catch(err){ if(/failed to fetch|networkerror|load failed|cors/i.test(err.message||'')){ try{ await fetch(url,{...opts,mode:'no-cors'}); return {ok:true, unconfirmed:true}; }catch(e2){} }
      return { ok:false, error:err.message||String(err) }; }
  }

  /* 시트 연동 설정 다이얼로그(관리자) */
  function cfgDialog(root){
    const cfg=store(STORE.settleCfg).get({});
    const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999';
    ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:560px;width:92%;padding:22px 24px;box-shadow:var(--sh-lg)">
      <div style="font-size:16px;font-weight:800;margin-bottom:6px">${icon('cloud')} 일일결산 시트 연동</div>
      <div class="muted" style="font-size:13px;line-height:1.6;margin-bottom:14px">다른 모듈과 <b>같은 통합 /exec URL</b>을 넣으세요. 결재(승인) 시 스프레드시트의 <b>'일일결산'</b> 탭에 자동으로 쌓입니다(헤더 자동 생성 · id 기준 갱신 · 재배포 불필요).</div>
      <label class="fld">웹앱 URL<input type="text" id="stUrl" value="${esc(cfg.sheetUrl||'')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" id="stTest">연결 테스트</button>
        <button class="btn" id="stClose">닫기</button>
        <button class="btn pri" id="stSave">${icon('check')}저장</button></div>
      <div class="muted" id="stCfgMsg" style="font-size:12.5px;margin-top:10px"></div></div>`;
    document.body.appendChild(ov);
    ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
    ov.querySelector('#stClose').onclick=()=>ov.remove();
    ov.querySelector('#stSave').onclick=()=>{ const url=ov.querySelector('#stUrl').value.trim();
      store(STORE.settleCfg).set({ sheetUrl:url }); ov.querySelector('#stCfgMsg').innerHTML='<span style="color:var(--ok)">저장됨 · 팀 공유</span>'; toast('일일결산 시트 URL 저장'); };
    ov.querySelector('#stTest').onclick=async()=>{ const url=ov.querySelector('#stUrl').value.trim(); const s=ov.querySelector('#stCfgMsg');
      if(!url){ s.textContent='URL을 먼저 입력하세요'; return; } s.textContent='테스트 중…';
      try{ const res=await fetch(url+(url.includes('?')?'&':'?')+'sheet='+encodeURIComponent(SHEET_TAB)); let d=null; try{d=await res.json();}catch(e){}
        s.innerHTML=res.ok?`<span style="color:var(--ok)">연결 성공 · '${SHEET_TAB}' 탭 확인</span>`:`<span style="color:var(--danger)">응답 오류(${res.status})</span>`; }
      catch(e){ s.innerHTML='<span style="color:var(--warn)">응답 확인 불가(CORS) — 전송은 정상 동작합니다</span>'; } };
  }

  registerSettle('cs','cs.settle');
  registerSettle('md','md.settle');
})();
