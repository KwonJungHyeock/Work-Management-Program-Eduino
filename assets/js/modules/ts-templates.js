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

  /* 라이브러리 한 벌을 컨테이너에 렌더 (CS 템플릿과 동일 UI · 서브탭 본문용) */
  function renderLibrary(root, iconName, storeKey, defaults, hint){
    const db = store(storeKey);
    let items = db.get(null);
    if(items===null){ items = defaults.slice(); db.set(items); }
    let filter='전체';
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="muted" style="font-size:12.5px">${esc(hint)}</div>
        <button class="btn pri" id="add" style="margin-left:auto">${icon('plus')}새 템플릿</button>
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
        c.querySelector('[data-a=del]').onclick=()=>{ if(confirm('이 템플릿을 삭제할까요?')){ items.splice(idx,1); db.set(items); renderCats(); renderList(); } };
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
        catBar.style.display='flex'; renderCats(); renderList(); toast(isNew?'추가했습니다':'수정했습니다'); };
    }
    root.querySelector('#add').onclick=()=>editForm(null);
    renderCats(); renderList();
  }

  /* 서브탭: 메일 템플릿 · 채팅 템플릿 */
  const SUBS = {
    mail: { icon:'mail', storeKey:STORE.tsMailTpl, defaults:MAIL_DEFAULTS, label:'메일 템플릿', hint:'기술상담 메일 회신에 자주 쓰는 양식을 분류별로 저장하고 한 번에 복사합니다.' },
    chat: { icon:'chat', storeKey:STORE.tsChatTpl, defaults:CHAT_DEFAULTS, label:'채팅 템플릿', hint:'게시판·카톡·톡톡 등 채팅 응대에 자주 쓰는 짧은 답변을 저장하고 한 번에 복사합니다.' },
  };
  MODULES['md.tstpl'] = {
    title:'기술상담 템플릿', icon:'chat',
    render(root){
      let tab='mail';
      root.innerHTML=`
        <div class="mhead">
          <div class="tt">기술상담 템플릿</div>
          <div class="ds">기술상담(TS) 응대에 자주 쓰는 <b>메일</b>·<b>채팅</b> 답변 양식을 저장하고 재사용합니다. (MD 팀 공유)</div>
          <div class="mtabs">
            <div class="t" data-t="mail">메일 템플릿</div>
            <div class="t" data-t="chat">채팅 템플릿</div>
          </div>
        </div>
        <div class="mbody" id="tplBody"></div>`;
      const body=root.querySelector('#tplBody');
      root.querySelectorAll('.mtabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.mtabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      function draw(){ const s=SUBS[tab]; body.innerHTML=''; const c=el('div'); body.appendChild(c);
        renderLibrary(c, s.icon, s.storeKey, s.defaults, s.hint); }
      draw();
    }
  };
})();
