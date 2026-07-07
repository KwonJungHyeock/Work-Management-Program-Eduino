/* CS · 답변 템플릿 라이브러리 */
MODULES['cs.templates'] = {
  title:'답변 템플릿', icon:'chat',
  render(root){
    const db = store(STORE.csTpl);
    const DEFAULTS = [
      { cat:'배송', title:'배송 지연 안내', body:'안녕하세요, 에듀이노입니다.\n주문하신 상품의 배송이 지연되어 진심으로 사과드립니다. 현재 상품은 준비 중이며, {날짜}까지 발송될 예정입니다. 발송 시 송장번호를 문자로 안내드리겠습니다. 감사합니다.' },
      { cat:'배송', title:'송장번호 안내', body:'안녕하세요, 에듀이노입니다.\n주문하신 상품이 오늘 발송되었습니다.\n택배사: {택배사} / 송장번호: {송장번호}\n배송 조회는 택배사 홈페이지에서 확인하실 수 있습니다. 감사합니다.' },
      { cat:'반품/교환', title:'반품 접수 안내', body:'안녕하세요, 에듀이노입니다.\n반품 요청 확인했습니다. 아래 주소로 상품을 보내주시면 확인 후 환불 처리해 드리겠습니다.\n[반송지] {주소}\n왕복 배송비 안내: {배송비}. 감사합니다.' },
      { cat:'제품문의', title:'호환/사용 문의', body:'안녕하세요, 에듀이노입니다.\n문의하신 제품은 {대상}과 호환되며, 사용 방법은 제품 동봉 가이드 또는 홈페이지 자료실에서 확인하실 수 있습니다. 추가 문의는 언제든 말씀해 주세요. 감사합니다.' },
    ];
    let items = db.get(null);
    if(items===null){ items = DEFAULTS.slice(); db.set(items); }
    let filter='전체';

    root.innerHTML = `<div class="view">
      <div class="view-hd"><div><div class="tt">답변 템플릿</div>
        <div class="ds">자주 쓰는 CS 답변을 분류별로 저장하고 한 번에 복사합니다 · <span class="mono">{중괄호}</span>는 상황에 맞게 수정</div></div>
        <div class="actions"><button class="btn pri" id="add">${icon('plus')}새 템플릿</button></div></div>
      <div id="cats" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"></div>
      <div id="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px"></div>
    </div>`;
    const catBar=root.querySelector('#cats'), list=root.querySelector('#list');

    const cats=()=>['전체',...new Set(items.map(i=>i.cat))];
    function renderCats(){ catBar.innerHTML='';
      cats().forEach(c=>{ const b=el('button','btn sm'+(c===filter?' pri':''),esc(c));
        b.onclick=()=>{ filter=c; renderCats(); renderList(); }; catBar.appendChild(b); }); }
    function renderList(){ list.innerHTML='';
      const view=items.filter(i=>filter==='전체'||i.cat===filter);
      if(!view.length){ list.innerHTML=`<div class="empty">${icon('chat')}<div>템플릿이 없습니다.</div></div>`; return; }
      view.forEach(it=>{ const idx=items.indexOf(it); const c=el('div','card');
        c.innerHTML=`<div class="card-hd"><span class="badge info">${esc(it.cat)}</span><b>${esc(it.title)}</b>
          <span style="margin-left:auto;display:flex;gap:4px">
            <button class="btn ghost sm" data-a="edit">수정</button>
            <button class="btn ghost sm" data-a="del">${icon('trash')}</button></span></div>
          <div class="card-bd">
            <div style="white-space:pre-wrap;font-size:13px;line-height:1.65;color:var(--ink-2);
              max-height:150px;overflow:auto;background:var(--panel-2);border:1px solid var(--line);
              border-radius:6px;padding:10px" class="sc">${esc(it.body)}</div>
            <div data-fill></div>
            <div style="display:flex;gap:6px;margin-top:10px" data-actions></div></div>`;
        const vars=[...new Set((it.body.match(/\{([^}]+)\}/g)||[]).map(s=>s.slice(1,-1)))];
        const actions=c.querySelector('[data-actions]'), fillBox=c.querySelector('[data-fill]');
        if(vars.length){
          actions.innerHTML=`<button class="btn pri" style="flex:1" data-a="fill">${icon('edit')}채워서 복사</button>
            <button class="btn" data-a="raw">원문 복사</button>`;
          c.querySelector('[data-a=raw]').onclick=()=>copyText(it.body);
          c.querySelector('[data-a=fill]').onclick=()=>{
            if(fillBox.dataset.open){ // 이미 열림 → 채워서 복사
              const vals={}; fillBox.querySelectorAll('input').forEach(inp=>vals[inp.dataset.v]=inp.value);
              const out=it.body.replace(/\{([^}]+)\}/g,(m,k)=> vals[k]!=null&&vals[k]!==''?vals[k]:m);
              copyText(out); return;
            }
            fillBox.dataset.open='1';
            fillBox.innerHTML=`<div style="margin-top:10px;padding:10px;background:var(--info-bg);border:1px solid #cfe0f7;border-radius:6px;display:grid;gap:8px">
              ${vars.map(v=>`<label class="fld" style="font-size:12px">${esc(v)}<input type="text" data-v="${esc(v)}" placeholder="${esc(v)} 입력"></label>`).join('')}</div>`;
            fillBox.querySelector('input')?.focus();
            c.querySelector('[data-a=fill]').innerHTML=`${icon('copy')}입력값으로 복사`;
          };
        } else {
          actions.innerHTML=`<button class="btn block" data-a="copy">${icon('copy')}복사</button>`;
          c.querySelector('[data-a=copy]').onclick=()=>copyText(it.body);
        }
        c.querySelector('[data-a=del]').onclick=()=>{ if(confirm('이 템플릿을 삭제할까요?')){ items.splice(idx,1); db.set(items); renderCats(); renderList(); } };
        c.querySelector('[data-a=edit]').onclick=()=>editForm(it,idx);
        list.appendChild(c); });
    }
    function editForm(it,idx){ const isNew=!it; const d=it||{cat:'',title:'',body:''};
      const c=el('div','card'); c.style.gridColumn='1/-1';
      c.innerHTML=`<div class="card-hd"><b>${isNew?'새 템플릿':'템플릿 수정'}</b></div>
        <div class="card-bd">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <label class="fld" style="flex:1;min-width:120px">분류<input type="text" id="fCat" value="${esc(d.cat)}" placeholder="예: 배송"></label>
            <label class="fld" style="flex:2;min-width:200px">제목<input type="text" id="fTitle" value="${esc(d.title)}" placeholder="템플릿 제목"></label></div>
          <label class="fld">내용<textarea id="fBody" rows="6" placeholder="답변 내용...">${esc(d.body)}</textarea></label>
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
