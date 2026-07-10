/* CS · 템플릿 라이브러리 (답변 템플릿 + 메일 템플릿) */
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

  function buildLibrary(key, title, iconName, storeKey, defaults, desc){
    MODULES[key] = {
      title, icon:iconName,
      render(root){
        const db = store(storeKey);
        let items = db.get(null);
        if(items===null){ items = defaults.slice(); db.set(items); }
        let filter='전체';

        root.innerHTML = `
          <div class="mhead pad"><div class="mhead-row">
            <div><div class="tt">${esc(title)}</div>
              <div class="ds">${esc(desc)}</div></div>
            <div class="mhead-act"><button class="btn pri" id="add">${icon('plus')}새 템플릿</button></div></div></div>
          <div class="mbody">
            <div id="cats" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px"></div>
            <div id="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px"></div>
          </div>`;
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
            catBar.style.display='flex'; renderCats(); renderList(); toast(isNew?'추가했습니다':'수정했습니다'); };
        }
        root.querySelector('#add').onclick=()=>editForm(null);
        renderCats(); renderList();
      }
    };
  }

  buildLibrary('cs.templates','답변 템플릿','chat', STORE.csTpl, ANSWER_DEFAULTS,
    '자주 쓰는 CS 답변을 분류별로 저장하고 상담 메모에서 바로 불러옵니다.');
  buildLibrary('cs.mailtpl','메일 템플릿','mail', STORE.csMailTpl, MAIL_DEFAULTS,
    '고객 메일에 자주 쓰는 양식을 저장하고 한 번에 복사합니다.');
})();
