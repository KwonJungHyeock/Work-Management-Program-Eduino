/* CS · 템플릿 라이브러리 (답변 템플릿 + 메일 템플릿을 한 메뉴에서 서브탭으로) */
(function(){
  const ANSWER_DEFAULTS = [
    { cat:'배송', title:'배송 지연 안내', body:'안녕하세요, 에듀이노입니다.\n주문하신 상품의 배송이 지연되어 진심으로 사과드립니다. 현재 상품을 준비하여 순차적으로 발송해 드리고 있으며, 발송되는 대로 송장번호를 문자로 안내드리겠습니다. 감사합니다.' },
    { cat:'배송', title:'송장번호 안내', body:'안녕하세요, 에듀이노입니다.\n주문하신 상품이 발송되었습니다. 배송 조회는 택배사 홈페이지에서 송장번호로 확인하실 수 있습니다. 감사합니다.' },
    { cat:'반품/교환', title:'반품 접수 안내', body:'안녕하세요, 에듀이노입니다.\n반품 요청 확인했습니다. 안내드린 반송지로 상품을 보내주시면 확인 후 환불 처리해 드리겠습니다. 왕복 배송비 관련 사항은 함께 안내드리겠습니다. 감사합니다.' },
    { cat:'제품문의', title:'호환/사용 문의', body:'안녕하세요, 에듀이노입니다.\n문의하신 제품의 호환 여부와 사용 방법은 제품 동봉 가이드 또는 홈페이지 자료실에서 확인하실 수 있습니다. 추가로 궁금하신 점은 언제든 말씀해 주세요. 감사합니다.' },
  ];
  const MAIL_DEFAULTS = [
    { cat:'견적', title:'견적서 송부', body:'안녕하세요, 에듀이노입니다.\n\n요청하신 견적서를 첨부하여 보내드립니다. 검토 후 궁금하신 점 있으시면 언제든 회신 부탁드립니다.\n\n감사합니다.\n에듀이노 드림' },
    { cat:'계산서', title:'세금계산서 발행 안내', body:'안녕하세요, 에듀이노입니다.\n\n세금계산서 발행을 위해 아래 정보를 회신 부탁드립니다.\n- 사업자등록증 사본\n- 담당자 성함 / 연락처 / 이메일\n\n확인 후 발행해 드리겠습니다. 감사합니다.\n에듀이노 드림' },
    { cat:'납품', title:'납품 일정 안내', body:'안녕하세요, 에듀이노입니다.\n\n주문하신 상품의 납품 일정을 안내드립니다. 변동 사항 발생 시 즉시 안내드리겠습니다.\n\n감사합니다.\n에듀이노 드림' },
  ];

  /* 활동 로그 — 공용 헬퍼(app.js window.actLog)로 위임 */
  const actPush = (action, area, detail)=>{ if(window.actLog) window.actLog(action, area, detail); };

  /* 라이브러리 한 벌(답변/메일)을 주어진 컨테이너에 렌더 — 헤더 없이 본문만(서브탭 내부용) */
  function renderLibrary(root, iconName, db, defaults, hint, setLabel){
    let items = db.get(null);
    // 기본 템플릿은 '메모리'로만 시드 — 저장/팀공유는 사용자가 편집하거나 [저장]을 누를 때만
    //  (빈 브라우저가 열기만 해도 기본값이 팀 공유본을 덮어쓰던 초기화 사고 방지)
    if(items===null){ items = defaults.slice(); }
    let filter='전체';
    // 명시적 저장(+팀 공유) — 업무 매뉴얼과 동일한 [저장] 동작
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
            <label class="fld" style="flex:1;min-width:120px">분류<input type="text" id="fCat" value="${esc(d.cat)}" placeholder="예: 견적"></label>
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

  /* 문자(SMS) 템플릿 기본값 — 짧은 고객 문자용 */
  const SMS_DEFAULTS = [
    { cat:'배송', title:'송장번호 안내', body:'[에듀이노] 주문하신 상품이 오늘 출고되었습니다. 송장번호: {송장번호} ({택배사}). 이용해 주셔서 감사합니다.' },
    { cat:'배송', title:'배송 지연 안내', body:'[에듀이노] 주문 상품 배송이 다소 지연되고 있습니다. 빠르게 발송해 드리겠습니다. 불편을 드려 죄송합니다.' },
    { cat:'접수', title:'교환/반품 접수 안내', body:'[에듀이노] 요청하신 교환/반품이 정상 접수되었습니다. 처리 결과는 확인 후 다시 안내드리겠습니다. 감사합니다.' },
    { cat:'입금', title:'입금 확인 안내', body:'[에듀이노] 입금이 확인되었습니다. 주문하신 상품을 순차 발송해 드리겠습니다. 감사합니다.' },
  ];
  /* 합친 메뉴: 답변 · 메일 · 문자 템플릿을 서브탭으로
     label = 활동 로그 구분명(기술상담 템플릿 기록과 섞이지 않도록 CS 전용 값으로 한정) */
  const CS_AREAS = ['답변 템플릿','메일 템플릿','문자 템플릿','CS 템플릿'];
  /* 기본(내장) 탭 — 상담메모 등 다른 화면이 참조하므로 저장키는 그대로 유지 */
  const BUILTIN = {
    answer: { icon:'chat',  storeKey:STORE.csTpl,     defaults:ANSWER_DEFAULTS, label:'답변 템플릿', hint:'자주 쓰는 CS 답변을 분류별로 저장하고 상담 메모에서 바로 불러옵니다.' },
    mail:   { icon:'mail',  storeKey:STORE.csMailTpl, defaults:MAIL_DEFAULTS,   label:'메일 템플릿', hint:'고객 메일에 자주 쓰는 양식을 저장하고 한 번에 복사합니다.' },
    sms:    { icon:'phone', storeKey:STORE.csSmsTpl,  defaults:SMS_DEFAULTS,    label:'문자 템플릿', hint:'고객 문자(SMS)에 자주 쓰는 짧은 문구를 저장하고 한 번에 복사합니다.' },
  };
  const DEFAULT_TABS = [{key:'answer',label:'답변 템플릿'},{key:'mail',label:'메일 템플릿'},{key:'sms',label:'문자 템플릿'}];
  /* 탭 구성(작업자가 추가·삭제·이름변경) — 팀 공유 설정에 저장 */
  const getTabs = ()=>{ const t=store(STORE.csTplTabs).get(null); return (Array.isArray(t)&&t.length)? t : DEFAULT_TABS.slice(); };
  const setTabs = v=> store(STORE.csTplTabs).set(v);
  const tabKeyOf = label=> 'c_'+String(label||'').trim().replace(/\s+/g,'_').toLowerCase();
  /* 탭별 데이터 저장소 — 내장 탭은 기존 키, 추가 탭은 csTplData 안의 하위 키 */
  function dbOf(key){
    if(BUILTIN[key]) return store(BUILTIN[key].storeKey);
    return { get(def){ const m=store(STORE.csTplData).get({})||{}; return m[key]!=null? m[key] : def; },
             set(v){ const m=store(STORE.csTplData).get({})||{}; m[key]=v; store(STORE.csTplData).set(m); } };
  }
  const metaOf = t=> BUILTIN[t.key] ? BUILTIN[t.key]
    : { icon:'chat', defaults:[], label:t.label, hint:`‘${t.label}’ 응대에 자주 쓰는 문구를 저장하고 한 번에 복사합니다.` };
  MODULES['cs.templates'] = {
    title:'답변·메일 템플릿', icon:'chat',
    render(root){
      let tab='answer';
      root.innerHTML=`
        <div class="mhead">
          <div class="tt">답변·메일·문자 템플릿</div>
          <div class="ds">CS 답변·고객 메일·문자 양식을 한 곳에서 관리합니다. 상담 메모의 <b>답변</b>은 <b>답변 템플릿</b>에서 불러옵니다.</div>
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
        const m=metaOf(t); renderLibrary(c, m.icon, dbOf(t.key), m.defaults, m.hint, t.label); }

      /* ── 탭 관리 — 작업자가 직접 추가·이름변경·삭제 (예: 답변 템플릿 빼고 카카오·네이버톡톡 추가) ── */
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
            if(before!==after) actPush('수정','CS 템플릿',`탭 구성: ${after}`);
            ov.remove(); renderTabs(); draw(); toast('탭 구성을 저장했습니다 · 팀에 공유됨');
          };
        }
        document.body.appendChild(ov); ov.onclick=e=>{ if(e.target===ov) ov.remove(); }; paint();
      }
      root.querySelector('#tplTabMgr').onclick=openTabMgr;

      // ── 로컬 PC 백업(내보내기) / 복원(불러오기) — 유실 대비 장치 ──
      function doExport(){ const me=(Auth.user&&Auth.user())||{};
        const data={ _type:'eduino.cs.templates.backup', exportedAt:new Date().toISOString(), by:me.name||me.loginId||'',
          tabs:getTabs(), sets:{}, custom:store(STORE.csTplData).get({})||{},
          answer:store(STORE.csTpl).get(BUILTIN.answer.defaults), mail:store(STORE.csMailTpl).get(BUILTIN.mail.defaults), sms:store(STORE.csSmsTpl).get(BUILTIN.sms.defaults) };
        getTabs().forEach(t=>{ data.sets[t.key]=dbOf(t.key).get(metaOf(t).defaults||[]); });
        try{ const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a');
          a.href=URL.createObjectURL(blob); a.download=`에듀이노_CS템플릿_백업_${todayStr()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
          toast('백업 파일을 내려받았습니다'); }catch(e){ toast('내보내기 실패'); } }
      function doImport(file){ const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result);
        const builtinN=['answer','mail','sms'].filter(k=>Array.isArray(d[k])).length;
        const setN=d.sets&&typeof d.sets==='object'? Object.keys(d.sets).length:0;
        if(!builtinN && !setN){ toast('CS 템플릿 백업 파일이 아닙니다'); return; }
        if(!confirm(`백업을 복원하면 현재 팀 템플릿을 덮어씁니다.\n내보낸 시각: ${d.exportedAt?new Date(d.exportedAt).toLocaleString('ko-KR'):'-'}${d.by?' · '+d.by:''}\n\n복원할까요?`)) return;
        if(Array.isArray(d.answer)) store(STORE.csTpl).set(d.answer);
        if(Array.isArray(d.mail)) store(STORE.csMailTpl).set(d.mail);
        if(Array.isArray(d.sms)) store(STORE.csSmsTpl).set(d.sms);
        if(d.custom && typeof d.custom==='object') store(STORE.csTplData).set(d.custom);
        if(d.sets && typeof d.sets==='object') Object.keys(d.sets).forEach(k=>{ if(Array.isArray(d.sets[k])) dbOf(k).set(d.sets[k]); });
        if(Array.isArray(d.tabs) && d.tabs.length) setTabs(d.tabs);
        if(window.SyncStore && SyncStore.configured()) SyncStore.pushSettings().catch(()=>{});
        actPush('복원','CS 템플릿', `백업 파일 복원 (${setN||builtinN}종)`);
        toast('복원했습니다 · 팀에 공유됨'); renderTabs(); draw();
      }catch(e){ toast('복원 실패 — 파일 형식을 확인하세요'); } }; rd.readAsText(file,'utf-8'); }
      const fileEl=root.querySelector('#tplFile');
      root.querySelector('#tplExport').onclick=doExport;
      root.querySelector('#tplImport').onclick=()=>fileEl.click();
      fileEl.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) doImport(f); };

      // ── 활동 로그 뷰 ──
      function renderActivity(host){
        host.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <div class="muted" style="font-size:12.5px">템플릿을 누가·언제 <b>생성/수정/삭제/복원</b>했는지 기록합니다 (최근순 · 팀 공유).</div>
            <button class="btn sm" id="actReload" style="margin-left:auto">${icon('refresh')}새로고침</button></div>
          <div style="border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:calc(100vh - 320px)"><table class="tbl" id="actT"><tbody><tr><td class="muted" style="padding:16px;text-align:center">불러오는 중…</td></tr></tbody></table></div>`;
        const AC={ '생성':'var(--ok)','수정':'#1a6dd6','삭제':'var(--danger)','복원':'#7c4dd6' };
        const fmt=iso=>{ try{ return new Date(iso).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch{ return iso||''; } };
        async function load(){ let items=[]; try{ const r=await fetch('/api/store?type=coll&coll=activity'); const d=await r.json(); items=(d&&d.items)||[]; }catch(e){}
          // CS 기본 구분명 + 현재 탭 이름(작업자가 추가한 탭)까지 이 화면의 기록으로 인정
          const mine=new Set(CS_AREAS.concat(getTabs().map(t=>t.label)));
          items=items.filter(x=>x&&x.at&&mine.has(String(x.area||'')))
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
