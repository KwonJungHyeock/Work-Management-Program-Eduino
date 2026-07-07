/* ===========================================================================
   CS · 상담 메모 & 일일 결산
   - 통화 중 빠른 입력(Ctrl+Enter 저장) → 로컬 저장 → 구글 시트 동기화
   - 저장/전송은 "destination" 추상화로 분리 (지금은 sheet, 이후 notion 추가)
   =========================================================================== */
(function(){

  /* ---- 목적지(destination) 추상화 ----
     새 대상(예: 노션)은 여기 객체만 추가하면 됩니다. */
  const DESTINATIONS = {
    sheet: {
      id:'sheet', name:'구글 시트',
      configured: cfg => !!(cfg && cfg.sheetUrl),
      /* records 를 Apps Script 웹앱(doPost)으로 전송. id 기준 upsert 이므로 재시도해도 중복 없음 */
      async send(records, cfg){
        const res = await fetch(cfg.sheetUrl, {
          method:'POST',
          headers:{'Content-Type':'text/plain;charset=utf-8'}, // 프리플라이트 회피(단순 요청)
          body: JSON.stringify({ records }),
        });
        let data=null; try{ data = await res.json(); }catch{}
        if(!res.ok) throw new Error('HTTP '+res.status);
        // 응답을 못 읽어도(res.ok) 성공으로 간주 → id upsert 라 중복 위험 없음
        return { syncedIds: (data && data.synced) ? data.synced : records.map(r=>r.id) };
      },
    },
    notion: {  // 2단계 자리표시 (인터페이스만)
      id:'notion', name:'노션', placeholder:true,
      configured: ()=>false,
      async send(){ throw new Error('노션 연동은 준비 중입니다'); },
    },
  };
  const ACTIVE_DEST = 'sheet';

  /* ---- 데이터/동기화 ---- */
  const notesDB = ()=>store(STORE.csNotes);
  const cfgDB   = ()=>store(STORE.csNoteCfg);
  const getNotes = ()=>notesDB().get([]);
  const setNotes = (v)=>notesDB().set(v);
  const getCfg = ()=>cfgDB().get({ sheetUrl:'', syncMode:'batch' });
  const setCfg = (v)=>cfgDB().set(v);
  const unsynced = (list)=> (list||getNotes()).filter(r=>!r.syncedAt);

  async function syncRecords(records){
    const cfg=getCfg(), dest=DESTINATIONS[ACTIVE_DEST];
    if(!dest.configured(cfg)) return { ok:false, error:'시트 URL이 설정되지 않았습니다', synced:0 };
    if(!records.length) return { ok:true, synced:0 };
    try{
      const { syncedIds } = await dest.send(records, cfg);
      const set=new Set(syncedIds), stamp=nowISO(); const all=getNotes();
      all.forEach(r=>{ if(set.has(r.id)) r.syncedAt=stamp; });
      setNotes(all);
      return { ok:true, synced:syncedIds.length };
    }catch(err){
      // 실패: 로컬 데이터는 그대로 보존 (재시도 가능)
      return { ok:false, error: err.message||'전송 실패', synced:0 };
    }
  }

  /* ============================================================ */
  MODULES['cs.notes'] = {
    title:'상담 메모', icon:'clipboard',
    render(root){
      let tab='memo', filter='전체', lastAgent=store(STORE.csAgent).get(CS_AGENTS[0]);
      let formType=CS_INQUIRY_TYPES[0];

      root.innerHTML=`
      <style>
        .cs-head{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:16px 22px 0}
        .cs-head .tt{font-size:19px;font-weight:800}
        .cs-head .ds{font-size:13.5px;color:var(--muted);margin-top:3px}
        .cs-tabs{display:flex;gap:4px;margin-top:14px}
        .cs-tabs .t{padding:10px 16px;font-size:14.5px;font-weight:700;color:var(--muted);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1px}
        .cs-tabs .t.on{color:var(--red);border-bottom-color:var(--red)}
        .cs-body{padding:20px 22px;max-width:1200px;margin:0 auto}
        .typebtns{display:flex;gap:8px;flex-wrap:wrap}
        .typebtn{padding:10px 18px;border:2px solid var(--line-strong);border-radius:9px;background:#fff;font-size:15px;font-weight:700;color:var(--ink-2);cursor:pointer;transition:.12s}
        .typebtn:hover{border-color:var(--faint)}
        .typebtn.on{border-color:var(--red);background:var(--red);color:#fff;box-shadow:0 3px 10px rgba(227,30,36,.25)}
        .note-card{display:grid;grid-template-columns:64px 92px 1fr auto;gap:12px;align-items:start;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:#fff;margin-bottom:8px}
        .note-card .tm{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13.5px;font-weight:600}
        .note-card .memo{font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
        .note-card .sub{font-size:12.5px;color:var(--muted);margin-top:2px}
        .sum-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
        .sum-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:#fff}
        .sum-card .lb{font-size:13px;color:var(--muted)}
        .sum-card .vl{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:4px}
        .syncbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #ead9b0;background:var(--warn-bg);border-radius:8px;margin-bottom:14px;font-size:13.5px;color:#7a4d06}
        .syncbar.ok{border-color:#bfe6cf;background:var(--ok-bg);color:#0b6b41}
        .badge.synced{background:var(--ok-bg);color:var(--ok)}
        .badge.pending{background:var(--warn-bg);color:var(--warn)}
        .badge.cb{background:#eae4ff;color:#5b3fc4}
      </style>
      <div class="cs-head">
        <div class="tt">상담 메모</div>
        <div class="ds">통화 중 빠르게 기록하고(Ctrl+Enter 저장) 구글 시트로 자동 동기화합니다. 이중 입력이 필요 없습니다.</div>
        <div class="cs-tabs">
          <div class="t" data-t="memo">상담 메모</div>
          <div class="t" data-t="summary">일일 결산</div>
          <div class="t" data-t="settings">연동 설정</div>
        </div>
      </div>
      <div class="cs-body" id="csBody"></div>`;
      const body=root.querySelector('#csBody');
      root.querySelectorAll('.cs-tabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.cs-tabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=> tab==='memo'?drawMemo(): tab==='summary'?drawSummary(): drawSettings();

      /* ---------------- 상담 메모 탭 ---------------- */
      function drawMemo(){
        body.innerHTML=`
          <div class="card" style="margin-bottom:18px">
            <div class="card-hd">${icon('phone')}<b>빠른 입력</b>
              <span class="muted" style="margin-left:auto;font-size:12.5px">저장 후 폼이 즉시 초기화됩니다 · <b>Ctrl+Enter</b> 저장</span></div>
            <div class="card-bd">
              <form id="qform">
                <div style="margin-bottom:14px">
                  <label class="fld" style="margin-bottom:8px">문의유형</label>
                  <div class="typebtns" id="typebtns"></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:14px">
                  <label class="fld">담당자<input list="agentList" id="fAgent" value="${esc(lastAgent)}" autocomplete="off">
                    <datalist id="agentList">${CS_AGENTS.map(a=>`<option value="${esc(a)}">`).join('')}</datalist></label>
                  <label class="fld">고객 연락처 <span class="muted" style="font-weight:500">· 선택</span><input type="text" id="fContact" placeholder="010-0000-0000"></label>
                  <label class="fld">상품/모델 <span class="muted" style="font-weight:500">· 선택</span><input type="text" id="fProduct" placeholder="예: 스타터 키트"></label>
                </div>
                <label class="fld" style="margin-bottom:14px">메모 내용 <span class="muted" style="font-weight:500">· 필수</span>
                  <textarea id="fMemo" rows="3" placeholder="상담 내용을 입력하세요…" required></textarea></label>
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                  <label class="chk"><input type="checkbox" id="fCallback"> 후속조치(콜백) 필요</label>
                  <button type="submit" class="btn pri lg" style="margin-left:auto">${icon('save')}저장 <span style="opacity:.7;font-weight:500;font-size:12px">Ctrl+Enter</span></button>
                </div>
              </form>
            </div>
          </div>

          <div id="syncSlot"></div>

          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <h3 style="font-size:16px">오늘 기록 <span class="muted" style="font-weight:500;font-size:13.5px" id="todayCnt"></span></h3>
            <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap" id="filters"></div>
          </div>
          <div id="noteList"></div>`;

        // 유형 버튼
        const tb=body.querySelector('#typebtns');
        CS_INQUIRY_TYPES.forEach(t=>{ const b=el('button','typebtn'+(t===formType?' on':''),esc(t)); b.type='button';
          b.onclick=()=>{ formType=t; tb.querySelectorAll('.typebtn').forEach(x=>x.classList.toggle('on',x.textContent===t)); };
          tb.appendChild(b); });

        // 저장
        const form=body.querySelector('#qform');
        const submit=()=>{
          const memo=body.querySelector('#fMemo').value.trim();
          if(!memo){ body.querySelector('#fMemo').focus(); toast('메모 내용을 입력하세요'); return; }
          const agent=body.querySelector('#fAgent').value.trim()||'-';
          store(STORE.csAgent).set(agent); lastAgent=agent;
          const rec={ id:uuid(), createdAt:nowISO(), type:formType, agent,
            contact:body.querySelector('#fContact').value.trim(),
            product:body.querySelector('#fProduct').value.trim(),
            memo, callback:body.querySelector('#fCallback').checked, syncedAt:null };
          const all=getNotes(); all.push(rec); setNotes(all);
          // 폼 초기화 (유형·담당자 유지)
          body.querySelector('#fContact').value=''; body.querySelector('#fProduct').value='';
          body.querySelector('#fMemo').value=''; body.querySelector('#fCallback').checked=false;
          body.querySelector('#fMemo').focus();
          renderList(); renderSyncBar(); toast('저장되었습니다');
          // 실시간 모드면 즉시 전송 (폼은 이미 초기화되어 대기 불필요)
          const cfg=getCfg();
          if(cfg.syncMode==='realtime' && DESTINATIONS[ACTIVE_DEST].configured(cfg)){
            syncRecords([rec]).then(r=>{ renderList(); renderSyncBar(); if(!r.ok) toast('시트 전송 실패 — 로컬 보관됨'); });
          }
        };
        form.addEventListener('submit',e=>{ e.preventDefault(); submit(); });
        form.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); submit(); } });

        // 필터
        const fbar=body.querySelector('#filters');
        ['전체',...CS_INQUIRY_TYPES].forEach(f=>{ const b=el('button','btn sm'+(f===filter?' pri':''),esc(f));
          b.onclick=()=>{ filter=f; drawMemo(); }; fbar.appendChild(b); });

        renderList(); renderSyncBar();
        body.querySelector('#fMemo')?.focus();
      }

      function todayNotes(){ const t=todayStr(); return getNotes().filter(r=>todayStr(r.createdAt)===t); }
      function renderList(){
        const box=body.querySelector('#noteList'), cnt=body.querySelector('#todayCnt'); if(!box) return;
        let list=todayNotes().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
        if(cnt) cnt.textContent=`· 총 ${list.length}건`;
        if(filter!=='전체') list=list.filter(r=>r.type===filter);
        if(!list.length){ box.innerHTML=`<div class="empty">${icon('clipboard')}<div style="font-size:13.5px">${filter==='전체'?'오늘 기록이 아직 없습니다.':'해당 유형 기록이 없습니다.'}</div></div>`; return; }
        box.innerHTML=''; list.forEach(r=>box.appendChild(noteCard(r)));
      }
      function noteCard(r){
        const c=el('div','note-card');
        const sync = r.syncedAt?'<span class="badge synced">동기화됨</span>':'<span class="badge pending">미동기화</span>';
        c.innerHTML=`
          <div class="tm">${timeHM(r.createdAt)}</div>
          <div><span class="badge info">${esc(r.type)}</span></div>
          <div>
            <div class="memo">${esc(r.memo)}</div>
            <div class="sub">${esc(r.agent)}${r.product?' · '+esc(r.product):''}${r.contact?' · '+esc(r.contact):''}
              ${r.callback?' · <span class="badge cb">콜백 필요</span>':''} ${sync}</div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn ghost sm" data-a="edit">수정</button>
            <button class="btn ghost sm" data-a="del">${icon('trash')}</button>
          </div>`;
        c.querySelector('[data-a=del]').onclick=()=>{ if(confirm('이 기록을 삭제할까요?')){ setNotes(getNotes().filter(x=>x.id!==r.id)); renderList(); renderSyncBar(); } };
        c.querySelector('[data-a=edit]').onclick=()=>editCard(c,r);
        return c;
      }
      function editCard(card,r){
        const box=el('div','note-card'); box.style.gridTemplateColumns='1fr';
        box.innerHTML=`
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:10px">
            <label class="fld">유형<select id="eType">${CS_INQUIRY_TYPES.map(t=>`<option ${t===r.type?'selected':''}>${t}</option>`).join('')}</select></label>
            <label class="fld">담당자<input type="text" id="eAgent" value="${esc(r.agent)}"></label>
            <label class="fld">연락처<input type="text" id="eContact" value="${esc(r.contact||'')}"></label>
            <label class="fld">상품<input type="text" id="eProduct" value="${esc(r.product||'')}"></label>
          </div>
          <label class="fld" style="margin-bottom:10px">메모<textarea id="eMemo" rows="3">${esc(r.memo)}</textarea></label>
          <div style="display:flex;align-items:center;gap:14px">
            <label class="chk"><input type="checkbox" id="eCb" ${r.callback?'checked':''}> 콜백 필요</label>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" id="eCancel">취소</button><button class="btn pri sm" id="eSave">저장</button></span>
          </div>`;
        card.replaceWith(box);
        box.querySelector('#eCancel').onclick=()=>renderList();
        box.querySelector('#eSave').onclick=()=>{
          const all=getNotes(); const t=all.find(x=>x.id===r.id); if(t){
            t.type=box.querySelector('#eType').value; t.agent=box.querySelector('#eAgent').value.trim()||'-';
            t.contact=box.querySelector('#eContact').value.trim(); t.product=box.querySelector('#eProduct').value.trim();
            t.memo=box.querySelector('#eMemo').value.trim(); t.callback=box.querySelector('#eCb').checked;
            t.syncedAt=null; // 수정되었으므로 재동기화 필요
            setNotes(all);
          }
          renderList(); renderSyncBar(); toast('수정되었습니다');
        };
      }
      function renderSyncBar(){
        const slot=body.querySelector('#syncSlot'); if(!slot) return;
        const cfg=getCfg(), n=unsynced().length;
        if(!DESTINATIONS[ACTIVE_DEST].configured(cfg)){
          slot.innerHTML=`<div class="syncbar">${icon('alert')}구글 시트가 아직 연결되지 않았습니다. <b>연동 설정</b> 탭에서 시트 URL을 등록하세요.</div>`; return;
        }
        if(n===0){ slot.innerHTML=`<div class="syncbar ok">${icon('checkCircle')}모든 기록이 시트에 동기화되었습니다.</div>`; return; }
        slot.innerHTML=`<div class="syncbar">${icon('cloudUp')}미동기화 <b>${n}건</b>${cfg.syncMode==='realtime'?' (실시간 전송 실패분)':''}
          <button class="btn sm" id="syncNow" style="margin-left:auto">${icon('cloudUp')}시트로 동기화</button></div>`;
        slot.querySelector('#syncNow').onclick=async(e)=>{ const btn=e.currentTarget; btn.disabled=true; btn.textContent='전송 중…';
          const r=await syncRecords(unsynced()); renderList(); renderSyncBar();
          toast(r.ok?`${r.synced}건 동기화 완료`:('동기화 실패: '+r.error)); };
      }

      /* ---------------- 일일 결산 탭 ---------------- */
      function drawSummary(){
        let date=todayStr();
        body.innerHTML=`
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
            <label class="fld" style="width:200px">${icon('calendar')} 결산 날짜<input type="date" id="sumDate" value="${date}"></label>
            <div style="margin-left:auto;display:flex;gap:8px">
              <button class="btn" id="copySum">${icon('copy')}결산 텍스트 복사</button>
              <button class="btn pri" id="pushSum">${icon('cloudUp')}미동기화분 시트 전송</button></div>
          </div>
          <div id="sumWrap"></div>`;
        body.querySelector('#sumDate').onchange=e=>{ date=e.target.value; renderSum(); };
        body.querySelector('#copySum').onclick=()=>copyText(summaryText(date));
        body.querySelector('#pushSum').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false; renderSum();
          toast(r.ok?`${r.synced}건 전송 완료`:('전송 실패: '+r.error)); };
        renderSum();
        function dayNotes(){ return getNotes().filter(r=>todayStr(r.createdAt)===date); }
        function agg(list){
          const byType={}; CS_INQUIRY_TYPES.forEach(t=>byType[t]=0);
          const byAgent={}; let cbOpen=0;
          list.forEach(r=>{ byType[r.type]=(byType[r.type]||0)+1; byAgent[r.agent]=(byAgent[r.agent]||0)+1; if(r.callback&&!r.done) cbOpen++; });
          return { total:list.length, byType, byAgent, cbOpen };
        }
        function renderSum(){
          const list=dayNotes(), a=agg(list); const wrap=body.querySelector('#sumWrap');
          const cbList=list.filter(r=>r.callback);
          wrap.innerHTML=`
            <div class="sum-grid" style="margin-bottom:16px">
              <div class="sum-card"><div class="lb">총 상담 건수</div><div class="vl">${a.total}</div></div>
              ${CS_INQUIRY_TYPES.map(t=>`<div class="sum-card"><div class="lb">${t}</div><div class="vl">${a.byType[t]||0}</div></div>`).join('')}
              <div class="sum-card" style="border-color:#ead9b0;background:var(--warn-bg)"><div class="lb">콜백 필요</div><div class="vl" style="color:var(--warn)">${cbList.length}</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
              <div class="card"><div class="card-hd"><b>담당자별 처리 건수</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>담당자</th><th class="num">건수</th></tr></thead><tbody>
                  ${Object.keys(a.byAgent).length?Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join(''):'<tr><td colspan="2" class="muted" style="text-align:center;padding:16px">기록 없음</td></tr>'}
                </tbody></table></div></div>
              <div class="card"><div class="card-hd"><b>콜백 필요 목록</b></div><div class="card-bd" style="padding:0">
                <table class="tbl"><thead><tr><th>시각</th><th>유형</th><th>연락처</th><th>메모</th></tr></thead><tbody>
                  ${cbList.length?cbList.sort((x,y)=>x.createdAt.localeCompare(y.createdAt)).map(r=>`<tr><td>${timeHM(r.createdAt)}</td><td>${esc(r.type)}</td><td>${esc(r.contact||'-')}</td><td>${esc(r.memo.slice(0,40))}</td></tr>`).join(''):'<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">콜백 필요 없음</td></tr>'}
                </tbody></table></div></div>
            </div>`;
        }
        function summaryText(d){
          const list=getNotes().filter(r=>todayStr(r.createdAt)===d), a=agg(list);
          const lines=[`[${d} CS 상담 결산]`, `총 ${a.total}건`,
            ...CS_INQUIRY_TYPES.map(t=>`- ${t}: ${a.byType[t]||0}건`),
            `콜백 필요: ${list.filter(r=>r.callback).length}건`, '', '담당자별:',
            ...Object.entries(a.byAgent).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`- ${k}: ${v}건`)];
          return lines.join('\n');
        }
        window.__csSummaryText=summaryText; // (테스트 편의)
      }

      /* ---------------- 연동 설정 탭 ---------------- */
      function drawSettings(){
        const cfg=getCfg();
        body.innerHTML=`
          <div class="card" style="margin-bottom:16px;max-width:820px">
            <div class="card-hd">${icon('link')}<b>구글 시트 연동</b></div>
            <div class="card-bd">
              <label class="fld" style="margin-bottom:14px">Apps Script 웹앱 URL
                <input type="text" id="cfgUrl" value="${esc(cfg.sheetUrl)}" placeholder="https://script.google.com/macros/s/……/exec"></label>
              <div style="margin-bottom:14px">
                <label class="fld" style="margin-bottom:8px">전송 모드</label>
                <div style="display:flex;gap:20px">
                  <label class="chk"><input type="radio" name="mode" value="realtime" ${cfg.syncMode==='realtime'?'checked':''}> 실시간 (저장 시 즉시 전송)</label>
                  <label class="chk"><input type="radio" name="mode" value="batch" ${cfg.syncMode!=='realtime'?'checked':''}> 일괄 (버튼으로 모아서 전송)</label>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn pri" id="cfgSave">${icon('check')}저장</button>
                <button class="btn" id="cfgTest">${icon('cloud')}연결 테스트</button>
                <button class="btn" id="cfgPush">${icon('cloudUp')}미동기화 전체 전송</button>
                <span class="muted" id="cfgStat" style="align-self:center;font-size:13px"></span>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px;max-width:820px;opacity:.7">
            <div class="card-hd">${icon('link')}<b>노션 연동</b><span class="badge soon" style="margin-left:auto">예정</span></div>
            <div class="card-bd"><div class="muted" style="font-size:13.5px">저장/전송 로직은 목적지(destination) 추상화로 설계되어, 이후 노션 대상만 추가하면 됩니다. (현재 인터페이스만 존재)</div></div>
          </div>

          <div class="note" style="max-width:820px">
            <b>연동 방법</b> — 저장소의 <code>google-apps-script.gs</code> 코드를 구글 시트 → 확장 프로그램 → Apps Script 에 붙여넣고,
            <b>배포 → 새 배포 → 웹 앱</b>(액세스: 모든 사용자)로 배포한 뒤 나온 <b>/exec URL</b>을 위에 입력하세요.
            레코드는 <code>id</code> 기준으로 시트에 <b>upsert</b>되어 재전송해도 중복되지 않습니다.
          </div>`;
        body.querySelector('#cfgSave').onclick=()=>{
          const url=body.querySelector('#cfgUrl').value.trim();
          const mode=body.querySelector('input[name=mode]:checked').value;
          setCfg({ sheetUrl:url, syncMode:mode }); toast('설정을 저장했습니다');
        };
        body.querySelector('#cfgTest').onclick=async()=>{
          const url=body.querySelector('#cfgUrl').value.trim(), stat=body.querySelector('#cfgStat');
          if(!url){ stat.textContent='URL을 입력하세요'; return; }
          stat.textContent='테스트 중…';
          try{ const res=await fetch(url,{method:'GET'}); let d=null; try{d=await res.json();}catch{}
            stat.innerHTML = res.ok ? `<span style="color:var(--ok)">연결 성공${d&&d.sheet?` · 시트 "${esc(d.sheet)}"`:''}</span>` : `<span style="color:var(--red)">응답 오류 HTTP ${res.status}</span>`;
          }catch(err){ stat.innerHTML=`<span style="color:var(--red)">연결 실패: ${esc(err.message)}</span>`; }
        };
        body.querySelector('#cfgPush').onclick=async(e)=>{ const b=e.currentTarget; b.disabled=true;
          const r=await syncRecords(unsynced()); b.disabled=false;
          body.querySelector('#cfgStat').textContent = r.ok?`${r.synced}건 전송 완료`:('전송 실패: '+r.error); };
      }

      draw();
    }
  };
})();
