/* MD · 기술상담(TS) 템플릿 라이브러리 — 메일 답변 · 채팅 답변 양식을 서브탭으로
   - CS [답변·메일 템플릿]과 동일한 카드 UI/조작(분류 필터·추가·수정·삭제·복사)
   - 기술상담(TS) 응대에 자주 쓰는 메일/채팅 답변 양식을 저장·재사용 (MD 팀 공유) */
(function(){
  /* 기술상담 메일 답변 기본 양식 */
  const MAIL_DEFAULTS = [
    { cat:'제품문의', title:'호환/사용 회신', body:'안녕하세요, 에듀이노 기술지원팀입니다.\n\n문의하신 제품의 호환 여부와 사용 방법을 안내드립니다.\n\n- 제품명 :\n- 호환 여부 :\n- 사용 방법 :\n\n동봉된 가이드 또는 홈페이지 자료실에서도 확인하실 수 있으며, 추가로 궁금하신 점 있으시면 언제든 회신 부탁드립니다.\n\n감사합니다.\n에듀이노 기술지원팀 드림' },
    { cat:'불량/AS', title:'불량 접수 안내', body:'안녕하세요, 에듀이노 기술지원팀입니다.\n\n제품 이상 증상 관련 문의 확인했습니다. 정확한 확인을 위해 아래 정보를 회신 부탁드립니다.\n\n- 증상 (사진/영상 첨부 시 도움) :\n- 구매처 / 주문번호 :\n- 제품 수령일 :\n\n확인 후 교환·수리 등 처리 방안을 안내드리겠습니다. 불편을 드려 죄송합니다.\n\n감사합니다.\n에듀이노 기술지원팀 드림' },
    { cat:'자료요청', title:'예제코드/드라이버 안내', body:'안녕하세요, 에듀이노 기술지원팀입니다.\n\n요청하신 예제코드 및 드라이버 자료를 안내드립니다.\n\n- 다운로드 링크 :\n- 설치/사용 방법 :\n\n적용 중 문제가 있으시면 화면 캡처와 함께 회신 주시면 빠르게 도와드리겠습니다.\n\n감사합니다.\n에듀이노 기술지원팀 드림' },
  ];
  /* 기술상담 채팅(게시판·카톡·톡톡) 답변 기본 양식 — 짧고 즉답용 */
  const CHAT_DEFAULTS = [
    { cat:'제품문의', title:'호환 문의 즉답', body:'안녕하세요, 에듀이노입니다 :) 문의하신 제품은 OO와 호환됩니다. 연결 방법은 상품 상세페이지 하단 가이드를 참고해 주세요. 추가로 궁금하신 점 있으면 말씀해 주세요!' },
    { cat:'사용방법', title:'예제코드 안내', body:'안녕하세요, 에듀이노입니다. 해당 제품 예제코드는 홈페이지 자료실 > 상품명 검색에서 받으실 수 있어요. 적용 중 막히는 부분 있으면 화면 캡처 보내주시면 바로 확인해 드리겠습니다!' },
    { cat:'불량/AS', title:'증상 확인 요청', body:'불편을 드려 죄송합니다. 정확한 확인을 위해 ①증상 사진/영상 ②주문번호 ③수령일을 남겨주시면 바로 확인 후 처리 방법 안내드리겠습니다.' },
    { cat:'재고/배송', title:'재고 확인 안내', body:'안녕하세요, 에듀이노입니다. 문의하신 상품 재고 확인 후 순차 안내드리겠습니다. 급하신 경우 필요 수량과 희망 납기를 남겨주시면 함께 확인해 드릴게요!' },
  ];

  /* 활동 로그 — 공용 헬퍼(app.js window.actLog)로 위임 */
  const actPush = (action, area, detail)=>{ if(window.actLog) window.actLog(action, area, detail); };

  /* 라이브러리 한 벌을 컨테이너에 렌더 (CS 템플릿과 동일 UI · 서브탭 본문용) */
  function renderLibrary(root, iconName, db, defaults, hint, setLabel){
    let items = db.get(null);
    // 기본 템플릿은 '메모리'로만 시드 — 저장/팀공유는 사용자가 편집하거나 [저장]을 누를 때만
    //  (빈 브라우저가 열기만 해도 기본값이 팀 공유본을 덮어쓰던 초기화 사고 방지)
    if(items===null){ items = defaults.slice(); }
    let filter='전체';
    // 명시적 저장(+팀 공유) — 업무 매뉴얼·CS 템플릿과 동일한 [저장] 동작
    const saveShare=(msg)=>{ db.set(items);
      if(window.SyncStore && SyncStore.configured()){
        SyncStore.pushSettings().then(()=>toast((msg||'저장했습니다')+' · 팀에 공유됨')).catch(()=>toast('저장됨(로컬) · 공유는 잠시 후 자동 재시도'));
      } else toast(msg||'저장했습니다'); };
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="muted" style="font-size:12.5px">${esc(hint)}</div>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button class="btn" id="save">${icon('save')}저장</button>
          <button class="btn pri" id="add">${icon('plus')}새 템플릿</button></span>
      </div>
      <div id="cats" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px"></div>
      <div id="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px"></div>`;
    const catBar=root.querySelector('#cats'), list=root.querySelector('#list');
    const cats=()=>['전체',...new Set(items.map(i=>i.cat))];
    function renderCats(){ catBar.innerHTML='';
      cats().forEach(c=>{ const b=el('button','btn sm'+(c===filter?' pri':''),esc(c));
        b.onclick=()=>{ filter=c; renderCats(); renderList(); }; catBar.appendChild(b); }); }
    function renderList(){ list.innerHTML='';
      const view=items.filter(i=>filter==='전체'||i.cat===filter);
      if(!view.length){ list.innerHTML=`<div class="empty">${icon(iconName)}<div>템플릿이 없습니다.</div></div>`; return; }
      view.forEach(it=>{ const idx=items.indexOf(it); const c=el('div','card');
        c.innerHTML=`<div class="card-hd"><span class="badge info">${esc(it.cat)}</span><b>${esc(it.title)}</b>
          <span style="margin-left:auto;display:flex;gap:4px">
            <button class="btn ghost sm" data-a="edit">수정</button>
            <button class="btn ghost sm" data-a="del">${icon('trash')}</button></span></div>
          <div class="card-bd">
            <div style="white-space:pre-wrap;font-size:13px;line-height:1.65;color:var(--ink-2);
              max-height:150px;overflow:auto;background:var(--panel-2);border:1px solid var(--line);
              border-radius:6px;padding:10px" class="sc">${esc(it.body)}</div>
            <button class="btn block" data-a="copy" style="margin-top:10px">${icon('copy')}복사</button></div>`;
        c.querySelector('[data-a=copy]').onclick=()=>copyText(it.body);
        c.querySelector('[data-a=del]').onclick=()=>{ if(confirm('이 템플릿을 삭제할까요?')){ const t=it.title; items.splice(idx,1); db.set(items); actPush('삭제', setLabel, t); renderCats(); renderList(); } };
        c.querySelector('[data-a=edit]').onclick=()=>editForm(it,idx);
        list.appendChild(c); });
    }
    function editForm(it,idx){ const isNew=!it; const d=it||{cat:'',title:'',body:''};
      const c=el('div','card'); c.style.gridColumn='1/-1';
      c.innerHTML=`<div class="card-hd"><b>${isNew?'새 템플릿':'템플릿 수정'}</b></div>
        <div class="card-bd">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <label class="fld" style="flex:1;min-width:120px">분류<input type="text" id="fCat" value="${esc(d.cat)}" placeholder="예: 제품문의"></label>
            <label class="fld" style="flex:2;min-width:200px">제목<input type="text" id="fTitle" value="${esc(d.title)}" placeholder="템플릿 제목"></label></div>
          <label class="fld">내용<textarea id="fBody" rows="7" placeholder="템플릿 내용...">${esc(d.body)}</textarea></label>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button class="btn" id="cCancel">취소</button><button class="btn pri" id="cSave">저장</button></div></div>`;
      list.replaceChildren(c); catBar.style.display='none';
      root.querySelector('#cCancel').onclick=()=>{ catBar.style.display='flex'; renderList(); };
      root.querySelector('#cSave').onclick=()=>{ const rec={cat:(root.querySelector('#fCat').value.trim()||'기타'),
        title:(root.querySelector('#fTitle').value.trim()||'제목 없음'), body:root.querySelector('#fBody').value};
        if(isNew) items.unshift(rec); else items[idx]=rec; db.set(items);
        actPush(isNew?'생성':'수정', setLabel, rec.title);
        catBar.style.display='flex'; renderCats(); renderList(); toast(isNew?'추가했습니다':'수정했습니다'); };
    }
    root.querySelector('#add').onclick=()=>editForm(null);
    root.querySelector('#save').onclick=()=>saveShare('저장했습니다');
    renderCats(); renderList();
  }

  /* 서브탭: 메일 템플릿 · 채팅 템플릿 */
  // area = 활동 로그에 남는 구분명(CS 템플릿 기록과 섞이지 않도록 '기술상담' 접두)
  const TS_AREAS = ['기술상담 메일 템플릿','기술상담 채팅 템플릿','기술상담 템플릿'];
  const BUILTIN = {
    mail: { icon:'mail', storeKey:STORE.tsMailTpl, defaults:MAIL_DEFAULTS, label:'메일 템플릿', hint:'기술상담 메일 회신에 자주 쓰는 양식을 분류별로 저장하고 한 번에 복사합니다.' },
    chat: { icon:'chat', storeKey:STORE.tsChatTpl, defaults:CHAT_DEFAULTS, label:'채팅 템플릿', hint:'게시판·카톡·톡톡 등 채팅 응대에 자주 쓰는 짧은 답변을 저장하고 한 번에 복사합니다.' },
  };
  const DEFAULT_TABS = [{key:'mail',label:'메일 템플릿'},{key:'chat',label:'채팅 템플릿'}];
  /* 탭 구성(작업자가 추가·삭제·이름변경) — 팀 공유 설정에 저장 */
  const getTabs = ()=>{ const t=store(STORE.tsTplTabs).get(null); return (Array.isArray(t)&&t.length)? t : DEFAULT_TABS.slice(); };
  const setTabs = v=> store(STORE.tsTplTabs).set(v);
  const tabKeyOf = label=> 'c_'+String(label||'').trim().replace(/\s+/g,'_').toLowerCase();
  function dbOf(key){
    if(BUILTIN[key]) return store(BUILTIN[key].storeKey);
    return { get(def){ const m=store(STORE.tsTplData).get({})||{}; return m[key]!=null? m[key] : def; },
             set(v){ const m=store(STORE.tsTplData).get({})||{}; m[key]=v; store(STORE.tsTplData).set(m); } };
  }
  const metaOf = t=> BUILTIN[t.key] ? BUILTIN[t.key]
    : { icon:'chat', defaults:[], label:t.label, hint:`‘${t.label}’ 응대에 자주 쓰는 문구를 저장하고 한 번에 복사합니다.` };
  MODULES['md.tstpl'] = {
    title:'기술상담 템플릿', icon:'chat',
    render(root){
      let tab='mail';
      root.innerHTML=`
        <div class="mhead">
          <div class="tt">기술상담 템플릿</div>
          <div class="ds">기술상담(TS) 응대에 자주 쓰는 <b>메일</b>·<b>채팅</b> 답변 양식을 저장하고 재사용합니다. (MD 팀 공유)</div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
            <div class="mtabs" style="margin:0" id="tplTabs"></div>
            <span style="margin-left:auto;display:flex;gap:8px">
              <button class="btn sm" id="tplTabMgr" title="탭 추가·이름변경·삭제">${icon('grid')}탭 관리</button>
              <button class="btn sm" id="tplExport" title="현재 팀 템플릿을 내 PC에 백업 파일(.json)로 저장">${icon('download')}내보내기</button>
              <button class="btn sm" id="tplImport" title="백업 파일(.json)에서 템플릿 복원">${icon('upload')}복원</button>
            </span>
          </div>
        </div>
        <input type="file" id="tplFile" accept="application/json,.json" style="display:none">
        <div class="mbody" id="tplBody"><div class="muted" style="padding:18px">불러오는 중…</div></div>`;
      const body=root.querySelector('#tplBody'), tabBar=root.querySelector('#tplTabs');
      const areaOf = label => '기술상담 '+label;   // 활동 로그 구분명(CS와 구분)
      function renderTabs(){
        const list=getTabs();
        if(!list.some(t=>t.key===tab) && tab!=='activity') tab=(list[0]||{}).key||'activity';
        tabBar.innerHTML=list.map(t=>`<div class="t${t.key===tab?' on':''}" data-t="${esc(t.key)}">${esc(t.label)}</div>`).join('')
          +`<div class="t${tab==='activity'?' on':''}" data-t="activity">활동 로그</div>`;
        tabBar.querySelectorAll('.t').forEach(t=>t.onclick=()=>{ tab=t.dataset.t; renderTabs(); draw(); });
      }
      function draw(){ body.innerHTML=''; const c=el('div'); body.appendChild(c);
        if(tab==='activity'){ renderActivity(c); return; }
        const t=getTabs().find(x=>x.key===tab); if(!t){ c.innerHTML='<div class="muted" style="padding:18px">탭이 없습니다. [탭 관리]에서 추가하세요.</div>'; return; }
        const m=metaOf(t); renderLibrary(c, m.icon, dbOf(t.key), m.defaults, m.hint, areaOf(t.label)); }

      /* ── 탭 관리 — 작업자가 직접 추가·이름변경·삭제 ── */
      function openTabMgr(){
        const draft=getTabs().slice();
        const ov=el('div','modal-ov'); ov.style.cssText='position:fixed;inset:0;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
        function paint(){
          ov.innerHTML=`<div style="background:var(--panel);border:1px solid var(--line);border-radius:16px;max-width:520px;width:97%;max-height:calc(100vh - 60px);display:flex;flex-direction:column;box-shadow:var(--sh-lg)">
            <div style="padding:16px 20px 12px;border-bottom:1px solid var(--line)">
              <div style="font-size:16px;font-weight:800">${icon('grid')||''} 템플릿 탭 관리</div>
              <div class="muted" style="font-size:12.5px;margin-top:3px">필요한 탭만 남기고 자유롭게 구성하세요. (예: 카카오 · 네이버톡톡)</div></div>
            <div style="padding:12px 20px;overflow:auto;flex:1">
              <div style="display:flex;flex-direction:column;gap:7px">
                ${draft.map((t,i)=>`<div style="display:flex;gap:7px;align-items:center">
                  <input data-i="${i}" value="${esc(t.label)}" style="flex:1;height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;font:inherit;font-size:13px;background:var(--panel);color:var(--ink)">
                  <button class="btn ghost sm" data-up="${i}" ${i===0?'disabled':''} title="위로">▲</button>
                  <button class="btn ghost sm" data-dn="${i}" ${i===draft.length-1?'disabled':''} title="아래로">▼</button>
                  <button class="btn ghost sm" data-del="${i}" title="이 탭 삭제">✕</button></div>`).join('')
                 || '<div class="muted" style="font-size:13px;padding:8px 0">탭이 없습니다. 아래에서 추가하세요.</div>'}
              </div>
              <div style="display:flex;gap:7px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--line-2)">
                <input id="tmNew" placeholder="새 탭 이름 (예: 카카오)" style="flex:1;height:34px;border:1px solid var(--line-2);border-radius:8px;padding:0 10px;font:inherit;font-size:13px;background:var(--panel);color:var(--ink)">
                <button class="btn sm" id="tmAdd">＋ 추가</button></div>
              <div class="muted" style="font-size:11.5px;margin-top:10px">※ 탭을 지워도 그 안의 템플릿은 보관됩니다. 같은 이름으로 다시 추가하면 되살아납니다.</div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line)">
              <button class="btn ghost" id="tmCancel">취소</button><button class="btn pri" id="tmSave">${icon('save')||''}저장</button></div></div>`;
          ov.querySelectorAll('[data-i]').forEach(inp=>inp.onchange=()=>{ draft[+inp.dataset.i].label=inp.value.trim()||draft[+inp.dataset.i].label; });
          ov.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ draft.splice(+b.dataset.del,1); paint(); });
          ov.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.up; [draft[i-1],draft[i]]=[draft[i],draft[i-1]]; paint(); });
          ov.querySelectorAll('[data-dn]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.dn; [draft[i+1],draft[i]]=[draft[i],draft[i+1]]; paint(); });
          ov.querySelector('#tmAdd').onclick=()=>{ const e2=ov.querySelector('#tmNew'); const nm=(e2.value||'').trim();
            if(!nm){ toast('탭 이름을 입력하세요'); e2.focus(); return; }
            const key=tabKeyOf(nm);
            if(draft.some(t=>t.key===key||t.label===nm)){ toast('이미 있는 탭입니다'); return; }
            draft.push({key,label:nm}); paint(); };
          ov.querySelector('#tmCancel').onclick=()=>ov.remove();
          ov.querySelector('#tmSave').onclick=()=>{
            if(!draft.length){ toast('탭이 최소 1개는 있어야 합니다'); return; }
            const before=getTabs().map(t=>t.label).join(','), after=draft.map(t=>t.label).join(',');
            setTabs(draft);
            if(window.SyncStore && SyncStore.configured()) SyncStore.pushSettings().catch(()=>{});
            if(before!==after) actPush('수정', TS_AREAS[2], `탭 구성: ${after}`);
            ov.remove(); renderTabs(); draw(); toast('탭 구성을 저장했습니다 · 팀에 공유됨');
          };
        }
        document.body.appendChild(ov); ov.onclick=e=>{ if(e.target===ov) ov.remove(); }; paint();
      }
      root.querySelector('#tplTabMgr').onclick=openTabMgr;

      // ── 로컬 PC 백업(내보내기) / 복원(불러오기) — 유실 대비 장치 ──
      function doExport(){ const me=(Auth.user&&Auth.user())||{};
        const data={ _type:'eduino.ts.templates.backup', exportedAt:new Date().toISOString(), by:me.name||me.loginId||'',
          tabs:getTabs(), sets:{}, custom:store(STORE.tsTplData).get({})||{},
          mail:store(STORE.tsMailTpl).get(BUILTIN.mail.defaults), chat:store(STORE.tsChatTpl).get(BUILTIN.chat.defaults) };
        getTabs().forEach(t=>{ data.sets[t.key]=dbOf(t.key).get(metaOf(t).defaults||[]); });
        try{ const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a');
          a.href=URL.createObjectURL(blob); a.download=`에듀이노_기술상담템플릿_백업_${todayStr()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
          toast('백업 파일을 내려받았습니다'); }catch(e){ toast('내보내기 실패'); } }
      function doImport(file){ const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result);
        const n=['mail','chat'].filter(k=>Array.isArray(d[k])).length + (d.sets&&typeof d.sets==='object'?Object.keys(d.sets).length:0);
        if(!n){ toast('기술상담 템플릿 백업 파일이 아닙니다'); return; }
        if(!confirm(`백업을 복원하면 현재 팀 템플릿을 덮어씁니다.\n내보낸 시각: ${d.exportedAt?new Date(d.exportedAt).toLocaleString('ko-KR'):'-'}${d.by?' · '+d.by:''}\n\n복원할까요?`)) return;
        if(Array.isArray(d.mail)) store(STORE.tsMailTpl).set(d.mail);
        if(Array.isArray(d.chat)) store(STORE.tsChatTpl).set(d.chat);
        if(d.custom && typeof d.custom==='object') store(STORE.tsTplData).set(d.custom);
        if(d.sets && typeof d.sets==='object') Object.keys(d.sets).forEach(k=>{ if(Array.isArray(d.sets[k])) dbOf(k).set(d.sets[k]); });
        if(Array.isArray(d.tabs) && d.tabs.length) setTabs(d.tabs);
        if(window.SyncStore && SyncStore.configured()) SyncStore.pushSettings().catch(()=>{});
        actPush('복원', TS_AREAS[2], `백업 파일 복원 (${n}종)`);
        toast('복원했습니다 · 팀에 공유됨'); renderTabs(); draw();
      }catch(e){ toast('복원 실패 — 파일 형식을 확인하세요'); } }; rd.readAsText(file,'utf-8'); }
      const fileEl=root.querySelector('#tplFile');
      root.querySelector('#tplExport').onclick=doExport;
      root.querySelector('#tplImport').onclick=()=>fileEl.click();
      fileEl.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) doImport(f); };

      // ── 활동 로그 뷰 (기술상담 템플릿 관련 기록만) ──
      function renderActivity(host){
        host.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <div class="muted" style="font-size:12.5px">템플릿을 누가·언제 <b>생성/수정/삭제/복원</b>했는지 기록합니다 (최근순 · 팀 공유).</div>
            <button class="btn sm" id="actReload" style="margin-left:auto">${icon('refresh')}새로고침</button></div>
          <div style="border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 320px)"><table class="tbl" id="actT"><tbody><tr><td class="muted" style="padding:16px;text-align:center">불러오는 중…</td></tr></tbody></table></div>`;
        const AC={ '생성':'var(--ok)','수정':'#1a6dd6','삭제':'var(--danger)','복원':'#7c4dd6' };
        const fmt=iso=>{ try{ return new Date(iso).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch{ return iso||''; } };
        async function load(){ let items=[]; try{ const r=await fetch('/api/store?type=coll&coll=activity'); const d=await r.json(); items=(d&&d.items)||[]; }catch(e){}
          items=items.filter(x=>x&&x.at&&/^기술상담/.test(String(x.area||'')))
            .sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,300);
          const t=host.querySelector('#actT'); if(!t) return;
          t.innerHTML=`<thead><tr><th style="width:118px">시각</th><th style="width:66px">작업</th><th>구분 / 대상</th><th style="width:104px">실행자</th></tr></thead><tbody>${
            items.length? items.map(e=>`<tr><td class="mono" style="white-space:nowrap">${esc(fmt(e.at))}</td>
              <td><b style="color:${AC[e.action]||'var(--muted)'}">${esc(e.action||'')}</b></td>
              <td>${esc(e.area||'')}${e.detail?` · <b>${esc(e.detail)}</b>`:''}</td>
              <td>${esc(e.who||'-')}</td></tr>`).join('')
            : `<tr><td colspan="4" class="muted" style="text-align:center;padding:18px">기록된 활동이 없습니다.</td></tr>`}</tbody>`;
        }
        const rb=host.querySelector('#actReload'); if(rb) rb.onclick=load; load();
      }

      // 최신 팀 템플릿을 먼저 받아온 뒤 렌더 — 로컬이 비어 있어도 서버본으로 채워지므로 기본값이 공유본을 덮지 않음
      (async()=>{ if(window.SyncStore && SyncStore.configured()){ try{ await SyncStore.pullSettings(); }catch(e){} } if(root.isConnected){ renderTabs(); draw(); } })();
    }
  };
})();
