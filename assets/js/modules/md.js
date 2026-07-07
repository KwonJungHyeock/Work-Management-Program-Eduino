/* MD · 상품 데이터 관리(기존 도구 iframe) + 상세이미지 변환기 */

/* ── 1) 상품 데이터 관리 도구 (기존 도구를 셸 안에 임베드) ── */
MODULES['md.product'] = {
  title:'상품 데이터 관리', icon:'grid', flush:true,
  render(root){
    root.innerHTML = `<div class="iframe-wrap"><iframe src="modules/md/product-tool.html" title="상품 데이터 관리 도구"></iframe></div>`;
  }
};

/* ── 2) 상세이미지 변환기 (좌: 업로드·검수 / 우: 작업 대시보드) ── */
(function(){
  function loadImage(file){
    return new Promise((res,rej)=>{
      const url=URL.createObjectURL(file); const img=new Image();
      img.onload=()=>res({name:file.name, file, img, w:img.naturalWidth, h:img.naturalHeight, url});
      img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('이미지 로드 실패: '+file.name)); };
      img.src=url;
    });
  }
  const stripExt=n=>n.replace(/\.[^.]+$/,'');
  function encode(canvas, fmt){ const F=FORMATS[fmt];
    return new Promise(res=>canvas.toBlob(b=>res(b), F.mime, F.quality?IMG_QUALITY:undefined)); }
  function segmentCanvas(img, top, segH, targetW){
    const scale=targetW/img.w; const c=el('canvas'); c.width=targetW; c.height=Math.max(1,Math.round(segH*scale));
    const ctx=c.getContext('2d'); ctx.imageSmoothingQuality='high';
    ctx.drawImage(img.img,0,top,img.w,segH,0,0,c.width,c.height); return c;
  }
  /* 로고 이미지(있으면) → 로드 실패 시 색상 모노그램으로 자동 대체 */
  function platLogo(p, size){
    const dim = size ? `width:${size}px;height:${size}px;` : '';
    const mono = `<div class="mono-badge" style="display:${p.logo?'none':'flex'};${dim}background:${p.color||'#888'}">${esc(p.short||p.name.slice(0,1))}</div>`;
    const img = p.logo
      ? `<img class="plat-logo-img" style="${dim}" src="${esc(p.logo)}" alt="${esc(p.name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    return img + mono;
  }

  MODULES['md.image'] = {
    title:'상세이미지 변환기', icon:'image',
    render(root){
      root.style.overflow='hidden';
      const pf=store(STORE.platforms);
      // 저장된 플랫폼에 기본값의 로고/색상/short 를 backfill 하고, 신규 기본 플랫폼(옥션 등)을 병합
      function loadPlatforms(){
        const saved=pf.get(null);
        if(!saved) return DEFAULT_PLATFORMS.map(p=>({...p,formats:[...p.formats]}));
        const byId=Object.fromEntries(DEFAULT_PLATFORMS.map(d=>[d.id,d]));
        saved.forEach(p=>{ const d=byId[p.id]; if(d){ if(p.logo==null)p.logo=d.logo; if(!p.short)p.short=d.short; if(!p.color)p.color=d.color; } });
        DEFAULT_PLATFORMS.forEach(d=>{ if(!saved.some(p=>p.id===d.id)) saved.push({...d,formats:[...d.formats]}); });
        return saved;
      }
      let platforms=loadPlatforms(); pf.set(platforms); // 마이그레이션 결과 저장
      // 프리셋 (사용자 추가/수정 가능)
      const prDB=store(STORE.mdPresets);
      let presets=prDB.get(null)||DEFAULT_PRESETS.map(p=>({...p,ids:[...p.ids]}));
      const savePresets=()=>prDB.set(presets);
      let sources=[]; const sel=new Set(platforms.map(p=>p.id));
      let productName='', splitMode='none', splitH=3000, manualCuts=[], keepOriginal=false, tab='convert';
      const save=()=>pf.set(platforms);

      root.innerHTML = `
      <style>
        .conv-wrap{display:flex;flex-direction:column;height:100%}
        .conv-head{flex:none;padding:16px 22px 0;border-bottom:1px solid var(--line);background:var(--panel)}
        .conv-head .tt{font-size:19px;font-weight:800}
        .conv-head .ds{font-size:13.5px;color:var(--muted);margin-top:3px}
        .conv-tabs{display:flex;gap:4px;margin-top:14px}
        .conv-tabs .t{padding:10px 16px;font-size:14.5px;font-weight:700;color:var(--muted);cursor:pointer;
          border-bottom:2.5px solid transparent;margin-bottom:-1px}
        .conv-tabs .t.on{color:var(--red);border-bottom-color:var(--red)}
        .conv-body{flex:1;min-height:0}
        .twopane{display:grid;grid-template-columns:minmax(320px,42%) 1fr;height:100%}
        .pane-l{border-right:1px solid var(--line);background:var(--panel-2);display:flex;flex-direction:column;min-height:0}
        .pane-r{overflow:auto;padding:20px 22px}
        .pl-hd{flex:none;padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
        .pl-hd b{font-size:15px}
        .pl-scroll{flex:1;overflow:auto;padding:14px 16px}
        .drop{border:2px dashed var(--line-strong);border-radius:10px;padding:22px;text-align:center;cursor:pointer;background:#fff;transition:.14s}
        .drop:hover,.drop.over{border-color:var(--red);background:var(--red-soft)}
        .drop .ic{font-size:26px;color:var(--faint)}
        .thumb{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff;margin-top:8px}
        .thumb img{width:42px;height:42px;object-fit:cover;border-radius:5px;border:1px solid var(--line)}
        .preview-frame{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}
        .preview-frame img{width:100%;display:block}
        .cutline{position:absolute;left:0;right:0;height:3px;background:var(--red);cursor:pointer;box-shadow:0 0 0 1px #fff}
        .cutline .no{position:absolute;left:6px;top:-9px;background:var(--red);color:#fff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:10px}
        .plat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        .plat-tile{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px;border:2px solid var(--line);
          border-radius:12px;background:#fff;cursor:pointer;transition:.14s}
        .plat-tile:hover{border-color:var(--line-strong);box-shadow:var(--sh-sm)}
        .plat-tile.on{border-color:var(--red);background:var(--red-soft);box-shadow:0 3px 10px rgba(227,30,36,.12)}
        .mono-badge{border-radius:9px;color:#fff;font-weight:800;font-size:14px;flex:none;
          align-items:center;justify-content:center}
        .plat-logo-img{border-radius:9px;object-fit:contain;background:#fff;border:1px solid var(--line);display:block;flex:none}
        .plat-tile .mono-badge{width:46px;height:46px;border-radius:11px;font-size:18px}
        .plat-tile .plat-logo-img{width:46px;height:46px;border-radius:11px}
        .logo-edit{position:relative;padding:0;border:0;background:none;cursor:pointer;flex:none;line-height:0;border-radius:9px}
        .logo-edit:hover{box-shadow:0 0 0 2px var(--red-soft)}
        .logo-clear{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--ink);
          color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
        .logo-clear:hover{background:var(--red)}
        .plat-tile .pn{font-size:14.5px;font-weight:700;line-height:1.25}
        .plat-tile .pmeta{font-size:11.5px;color:var(--muted)}
        .plat-tile .ftags{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}
        .plat-tile .ftag{font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--line-2);color:var(--muted)}
        .plat-tile.on .ftag{background:#fff;color:var(--red)}
        .plat-tile .chk{position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;border:2px solid var(--line-strong);
          background:#fff;display:flex;align-items:center;justify-content:center;color:#fff}
        .plat-tile.on .chk{background:var(--red);border-color:var(--red)}
        .plat-tile .chk .ic{font-size:13px;opacity:0}.plat-tile.on .chk .ic{opacity:1}
        .pf-row{display:grid;grid-template-columns:1.5fr 1fr .8fr .8fr .8fr 40px;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line-2)}
        .pf-row.hd{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:var(--panel-2)}
        .fmt-tags{display:flex;gap:5px;flex-wrap:wrap}
        .fmt-tag{font-size:12px;font-weight:700;padding:3px 8px;border-radius:5px;background:var(--line-2);color:var(--muted);cursor:pointer;border:1.5px solid transparent}
        .fmt-tag.on{background:var(--red-soft);color:var(--red);border-color:#f4c9cb}
        .out-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:#fff}
      </style>
      <div class="conv-wrap">
        <div class="conv-head">
          <div class="tt">상세이미지 변환기</div>
          <div class="ds">통이미지를 왼쪽에서 검수하고, 오른쪽에서 플랫폼별 규격·확장자로 한 번에 변환해 ZIP으로 내려받습니다.</div>
          <div class="conv-tabs"><div class="t" data-t="convert">이미지 변환</div><div class="t" data-t="settings">플랫폼 설정</div></div>
        </div>
        <div class="conv-body" id="cbody"></div>
      </div>`;
      const cbody=root.querySelector('#cbody');
      root.querySelectorAll('.conv-tabs .t').forEach(t=>{ t.classList.toggle('on',t.dataset.t===tab);
        t.onclick=()=>{ tab=t.dataset.t; root.querySelectorAll('.conv-tabs .t').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });
      const draw=()=>tab==='convert'?drawConvert():drawSettings();

      /* ============ 변환 탭 (2분할) ============ */
      function drawConvert(){
        cbody.style.overflow='hidden';
        cbody.innerHTML=`
          <div class="twopane">
            <div class="pane-l">
              <div class="pl-hd">${icon('image')}<b>이미지 업로드 · 검수</b><span class="muted" id="srcCount" style="margin-left:auto;font-size:12.5px"></span></div>
              <div class="pl-scroll sc" id="leftScroll"></div>
            </div>
            <div class="pane-r sc" id="rightScroll"></div>
          </div>`;
        renderLeft(); renderRight();
      }

      /* ---- 왼쪽: 업로드 + 미리보기(검수) ---- */
      function renderLeft(){
        const box=cbody.querySelector('#leftScroll'); if(!box) return;
        box.innerHTML=`
          <input type="file" id="picker" accept="image/*" multiple class="hidden">
          <div class="drop" id="drop">${icon('upload')}
            <div style="font-weight:700;margin-top:6px;font-size:14.5px">이미지를 끌어다 놓거나 클릭</div>
            <div class="muted" style="font-size:12.5px;margin-top:3px">여러 장 가능 · 처리 전부 이 PC 안에서만</div></div>
          <div id="thumbs"></div>
          <div id="previewArea"></div>`;
        const picker=box.querySelector('#picker'), drop=box.querySelector('#drop');
        drop.onclick=()=>picker.click(); picker.onchange=e=>addFiles(e.target.files);
        ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
        ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
        drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
        renderThumbs(); renderPreview();
      }
      function renderThumbs(){
        const box=cbody.querySelector('#thumbs'), cnt=cbody.querySelector('#srcCount'); if(!box) return;
        if(cnt) cnt.textContent=sources.length?`${sources.length}장`:'';
        box.innerHTML=''; sources.forEach((s,i)=>{ const r=el('div','thumb');
          r.innerHTML=`<img src="${s.url}"><div style="min-width:0;flex:1"><b style="font-size:13px">${esc(s.name)}</b>
            <div class="muted" style="font-size:12px">${s.w}×${s.h}px · ${bytes(s.file.size)}</div></div>
            <button class="btn ghost sm">${icon('x')}</button>`;
          r.querySelector('button').onclick=()=>{ URL.revokeObjectURL(s.url); sources.splice(i,1); renderThumbs(); renderPreview(); renderRight(); };
          box.appendChild(r); });
      }
      function renderPreview(){
        const box=cbody.querySelector('#previewArea'); if(!box) return; box.innerHTML='';
        if(!sources.length){ box.innerHTML=`<div class="empty" style="padding:30px 10px">${icon('image')}<div style="font-size:13.5px">업로드한 이미지가 여기 표시됩니다.<br>긴 상세페이지도 이 영역에서 스크롤로 검수하세요.</div></div>`; return; }
        const manual = splitMode==='manual' && sources.length===1;
        if(manual){
          const s=sources[0];
          const tools=el('div'); tools.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px';
          tools.innerHTML=`<span class="badge red" style="background:var(--red-soft);color:var(--red)">수동 분할</span>
            <span class="muted" style="font-size:12.5px">이미지를 클릭해 자르는 위치 추가 · 선 클릭 시 삭제</span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" id="eqCut">균등 3등분</button><button class="btn sm" id="clrCut">지우기</button></span>`;
          box.appendChild(tools);
          const frame=el('div','preview-frame'); frame.style.position='relative'; frame.style.cursor='crosshair';
          frame.innerHTML=`<img src="${s.url}" id="pvImg"><div id="cutLines"></div>`;
          box.appendChild(frame);
          const info=el('div','muted'); info.style.cssText='font-size:12.5px;margin-top:6px'; box.appendChild(info);
          const imgEl=frame.querySelector('#pvImg'), lines=frame.querySelector('#cutLines');
          const scale=()=>imgEl.clientWidth/s.w;
          function drawLines(){ lines.innerHTML=''; manualCuts=manualCuts.filter(y=>y>0&&y<s.h).sort((a,b)=>a-b);
            manualCuts.forEach((y,idx)=>{ const ln=el('div','cutline'); ln.style.top=(y*scale())+'px';
              ln.innerHTML=`<span class="no">${idx+1}</span>`;
              ln.onclick=e=>{ e.stopPropagation(); manualCuts.splice(idx,1); drawLines(); };
              lines.appendChild(ln); });
            info.textContent=`${manualCuts.length+1}개 조각으로 분할됩니다.`; }
          frame.onclick=e=>{ if(e.target.classList.contains('cutline')||e.target.classList.contains('no'))return;
            const rect=imgEl.getBoundingClientRect(); const y=Math.round((e.clientY-rect.top)/scale());
            if(y>2&&y<s.h-2){ manualCuts.push(y); drawLines(); } };
          box.querySelector('#eqCut').onclick=()=>{ manualCuts=[Math.round(s.h/3),Math.round(s.h*2/3)]; drawLines(); };
          box.querySelector('#clrCut').onclick=()=>{ manualCuts=[]; drawLines(); };
          if(imgEl.complete) drawLines(); else imgEl.onload=drawLines;
        } else {
          sources.forEach((s,i)=>{ const wrap=el('div'); wrap.style.marginBottom='12px';
            wrap.innerHTML=`<div class="muted" style="font-size:12.5px;margin-bottom:4px">${i+1}. ${esc(s.name)} · ${s.w}×${s.h}px</div>
              <div class="preview-frame"><img src="${s.url}"></div>`;
            box.appendChild(wrap); });
        }
      }

      /* ---- 오른쪽: 작업 대시보드 ---- */
      function renderRight(){
        const box=cbody.querySelector('#rightScroll'); if(!box) return;
        box.innerHTML=`
          <div class="fieldset fs-blue">
            <div class="fs-hd"><span class="step">1</span>상품명 &amp; 대상 플랫폼
              <span class="hint" id="selCount"></span></div>
            <div class="fs-bd">
              <label class="fld" style="margin-bottom:14px">상품명 <span style="font-weight:500;color:var(--muted)">· 파일명 앞에 플랫폼명이 자동으로 붙습니다</span>
                <input type="text" id="prod" value="${esc(productName)}" placeholder="예: 아두이노 스타터 키트"></label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px" id="platQuick"></div>
              <div class="plat-grid" id="platGrid"></div>
            </div>
          </div>

          <div class="fieldset fs-green">
            <div class="fs-hd"><span class="step">2</span>긴 이미지 분할</div>
            <div class="fs-bd">
              <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">
                <label class="chk"><input type="radio" name="sm" value="none" ${splitMode==='none'?'checked':''}> 분할 안 함</label>
                <label class="chk"><input type="radio" name="sm" value="auto" ${splitMode==='auto'?'checked':''}> 자동 분할</label>
                <label class="chk"><input type="radio" name="sm" value="manual" ${splitMode==='manual'?'checked':''}> 수동 분할</label>
                <span id="splitOpt" style="display:flex;gap:8px;align-items:center"></span>
              </div>
              <div id="splitNote" style="margin-top:12px"></div>
            </div>
          </div>

          <div class="fieldset fs-amber">
            <div class="fs-hd"><span class="step">3</span>변환 &amp; 저장</div>
            <div class="fs-bd">
              <label class="chk" style="margin-bottom:14px"><input type="checkbox" id="keepOrig" ${keepOriginal?'checked':''}> 원본 통이미지도 ZIP에 포함</label>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <button class="btn pri lg" id="run">${icon('layers')}변환하고 ZIP 다운로드</button>
                <span class="muted" id="runInfo" style="font-size:13.5px"></span></div>
              <div id="result" style="margin-top:14px"></div>
            </div>
          </div>`;
        box.querySelector('#prod').oninput=e=>productName=e.target.value;
        renderQuick();
        renderPlatGrid();
        box.querySelectorAll('input[name=sm]').forEach(r=>r.onchange=()=>{ splitMode=r.value; renderSplitOpt(); renderPreview(); });
        renderSplitOpt();
        box.querySelector('#keepOrig').onchange=e=>keepOriginal=e.target.checked;
        box.querySelector('#run').onclick=run;
      }
      function renderPlatGrid(){
        const grid=cbody.querySelector('#platGrid'), cnt=cbody.querySelector('#selCount'); if(!grid) return;
        if(cnt) cnt.textContent=`${sel.size}개 선택`;
        grid.innerHTML='';
        platforms.forEach(p=>{ const on=sel.has(p.id); const tile=el('div','plat-tile'+(on?' on':''));
          tile.innerHTML=`<div class="chk">${icon('check')}</div>
            ${platLogo(p)}
            <div class="pn">${esc(p.name)}</div>
            <div class="pmeta">${p.width?p.width+'px':'원본'}${p.maxH?' · 세로 '+fmtNum(p.maxH):''}</div>
            <div class="ftags">${p.formats.map(f=>`<span class="ftag">${FORMATS[f].label}</span>`).join('')}</div>`;
          tile.onclick=()=>{ on?sel.delete(p.id):sel.add(p.id); renderPlatGrid(); suggestSplit(); };
          grid.appendChild(tile); });
      }
      function renderQuick(){
        const box=cbody.querySelector('#platQuick'); if(!box) return; box.innerHTML='';
        const mk=(label,fn)=>{ const b=el('button','btn sm',label); b.onclick=fn; box.appendChild(b); return b; };
        mk('전체 선택',()=>{ platforms.forEach(p=>sel.add(p.id)); renderPlatGrid(); suggestSplit(); });
        mk('해제',()=>{ sel.clear(); renderPlatGrid(); suggestSplit(); });
        const dv=el('span'); dv.style.cssText='width:1px;height:20px;background:var(--line);margin:0 3px'; box.appendChild(dv);
        presets.forEach(pr=>{ mk(pr.name,()=>{ sel.clear(); platforms.forEach(p=>{ if(pr.ids.includes(p.id)) sel.add(p.id); }); renderPlatGrid(); suggestSplit(); }); });
        const save=mk('＋ 현재선택 저장',()=>{
          const ids=[...sel]; if(!ids.length){ toast('먼저 플랫폼을 선택하세요'); return; }
          const name=(prompt('저장할 프리셋 이름','새 프리셋')||'').trim(); if(!name) return;
          presets.push({ id:'pr'+presets.length+'_'+ids.length, name, ids }); savePresets(); renderQuick(); toast('프리셋을 저장했습니다');
        });
        save.style.color='var(--muted)';
      }
      const selectedPlatforms=()=>platforms.filter(p=>sel.has(p.id));
      function suggestSplit(){ const hs=selectedPlatforms().map(p=>p.maxH).filter(h=>h>0);
        if(hs.length){ splitH=Math.min(...hs); const i=cbody.querySelector('#splitH'); if(i)i.value=splitH; } }
      function renderSplitOpt(){
        const box=cbody.querySelector('#splitOpt'), note=cbody.querySelector('#splitNote'); if(!box) return;
        if(splitMode==='auto'){ suggestSplit();
          box.innerHTML=`<span class="muted" style="font-size:13.5px">출력 페이지 높이</span>
            <input type="number" id="splitH" value="${splitH}" style="width:110px"><span class="muted" style="font-size:13.5px">px 마다</span>`;
          box.querySelector('#splitH').oninput=e=>splitH=Math.max(200,parseInt(e.target.value)||3000);
          note.innerHTML=`<div class="note">선택한 플랫폼의 세로 제한 중 가장 작은 값으로 자동 제안됩니다. (예: 쿠팡 3,000px)</div>`;
        } else if(splitMode==='manual'){ box.innerHTML='';
          note.innerHTML=`<div class="note">왼쪽 이미지에서 자르는 위치를 클릭해 지정하세요. ${sources.length!==1?'<b>이미지 1장</b>일 때 사용합니다.':''}</div>`;
        } else { box.innerHTML=''; note.innerHTML=''; }
      }

      function addFiles(list){
        const imgs=[...list].filter(f=>/^image\//.test(f.type));
        if(!imgs.length){ toast('이미지 파일만 가능합니다'); return; }
        Promise.all(imgs.map(loadImage)).then(loaded=>{ sources.push(...loaded);
          renderThumbs(); renderPreview(); renderRight(); suggestSplit();
        }).catch(err=>toast(err.message));
      }

      function segmentsFor(img, platform){
        if(splitMode==='manual' && sources.length===1){
          const pts=[0,...manualCuts.filter(y=>y>0&&y<img.h).sort((a,b)=>a-b),img.h]; const segs=[];
          for(let i=0;i<pts.length-1;i++) segs.push([pts[i],pts[i+1]-pts[i]]); return segs;
        }
        if(splitMode==='auto'){ const scale=(platform.width>0&&img.w>platform.width)?platform.width/img.w:1;
          const srcSeg=Math.max(50,Math.floor(splitH/scale)); const segs=[];
          for(let top=0;top<img.h;top+=srcSeg) segs.push([top,Math.min(srcSeg,img.h-top)]); return segs; }
        return [[0,img.h]];
      }

      async function run(){
        if(!sources.length){ toast('이미지를 먼저 올려주세요'); return; }
        const plats=selectedPlatforms(); if(!plats.length){ toast('대상 플랫폼을 선택하세요'); return; }
        const btn=cbody.querySelector('#run'), info=cbody.querySelector('#runInfo');
        btn.disabled=true; info.textContent='변환 중…';
        const files=[], rows=[];
        try{
          for(let si=0;si<sources.length;si++){ const s=sources[si];
            const base=(productName.trim()||stripExt(s.name))+(sources.length>1?`_${si+1}`:'');
            for(const p of plats){ const targetW=(p.width>0&&s.w>p.width)?p.width:s.w;
              const segs=segmentsFor(s,p), multi=segs.length>1;
              for(let gi=0;gi<segs.length;gi++){ const [top,segH]=segs[gi];
                const canvas=segmentCanvas(s,top,segH,targetW);
                for(const fk of p.formats){ const blob=await encode(canvas,fk); if(!blob)continue;
                  const nm=`${p.prefix}_${base}${multi?'_'+(gi+1):''}.${FORMATS[fk].ext}`;
                  files.push({name:`${p.name}/${nm}`,blob});
                  rows.push({name:nm,plat:p,dim:`${canvas.width}×${canvas.height}`,size:blob.size,over:(p.maxMB>0&&blob.size>p.maxMB*1048576)});
                }}}
            if(keepOriginal) files.push({name:`_원본/${s.name}`,blob:s.file});
          }
          const zip=await makeZip(files);
          const d=new Date(), ds=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
          const zipName=`상세이미지_${(productName.trim()||'변환')}_${ds}.zip`;
          downloadBlob(zip,zipName); info.textContent=`완료 · 파일 ${files.length}개 · ${bytes(zip.size)}`;
          renderResult(rows,zipName); toast('ZIP으로 내려받았습니다');
        }catch(err){ info.textContent='오류: '+err.message; toast('변환 실패: '+err.message); }
        finally{ btn.disabled=false; }
      }
      function renderResult(rows,zipName){
        const box=cbody.querySelector('#result'); if(!box||!rows.length) return;
        const warnN=rows.filter(r=>r.over).length;
        box.innerHTML=`<div class="sec-title" style="margin-top:4px">결과 · ${esc(zipName)}</div>
          ${warnN?`<div class="note warn" style="margin-bottom:10px">${warnN}개 파일이 플랫폼 용량 상한을 초과합니다. 분할 높이를 줄여보세요.</div>`:''}
          <div style="overflow:auto;max-height:280px" class="sc"><table class="tbl">
            <thead><tr><th>파일명</th><th>플랫폼</th><th>크기(px)</th><th class="num">용량</th></tr></thead>
            <tbody>${rows.map(r=>`<tr><td class="mono" style="font-size:12px">${esc(r.name)}</td><td>${esc(r.plat.name)}</td>
              <td class="mono">${r.dim}</td><td class="num" ${r.over?'style="color:var(--red);font-weight:700"':''}>${bytes(r.size)}</td></tr>`).join('')}</tbody>
          </table></div>`;
      }

      /* ============ 플랫폼 설정 탭 ============ */
      let logoTargetId=null;
      function drawSettings(){
        cbody.style.overflow='auto'; cbody.innerHTML=`<div style="padding:20px 22px;max-width:1000px">
          <input type="file" id="logoUpload" accept="image/*" class="hidden">
          <div class="card">
            <div class="card-hd">${icon('sliders')}<b>플랫폼별 변환 규격</b>
              <span style="margin-left:auto;display:flex;gap:8px">
                <button class="btn sm" id="addPlat">${icon('plus')}플랫폼 추가</button>
                <button class="btn sm" id="resetPlat">${icon('refresh')}기본값 복원</button></span></div>
            <div class="card-bd" style="padding:0">
              <div class="pf-row hd"><div>로고 · 플랫폼 / 접두어</div><div>포맷</div><div>가로(px)</div><div>세로/장</div><div>용량(MB)</div><div></div></div>
              <div id="pfRows"></div></div>
          </div>
          <div class="note" style="margin-top:14px">플랫폼의 <b>로고를 클릭</b>하면 이미지를 올려 바꿀 수 있습니다(로고 위 ✕ = 기본으로).
            가로 0 = 원본 유지 · 세로/장 0 = 분할 제한 없음 · 용량 0 = 경고 안 함.
            (2026 조사: 쿠팡 3,000px·5MB, 네이버 20MB, 11번가/G마켓 10MB)</div>

          <div class="card" style="margin-top:16px">
            <div class="card-hd">${icon('layers')}<b>프리셋</b> <span class="muted" style="font-size:12.5px">· 변환 화면의 빠른 선택 버튼</span>
              <button class="btn sm" id="addPreset" style="margin-left:auto">${icon('plus')}프리셋 추가</button></div>
            <div class="card-bd" id="presetList" style="display:grid;gap:12px"></div>
          </div>
        </div>`;
        // 로고 업로드
        const up=cbody.querySelector('#logoUpload');
        up.onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(!f||!logoTargetId) return;
          if(f.size>400*1024){ toast('로고는 400KB 이하 이미지를 권장합니다'); }
          const rd=new FileReader(); rd.onload=()=>{ const p=platforms.find(x=>x.id===logoTargetId); if(p){ p.logo=rd.result; save(); renderPfRows(); toast('로고를 변경했습니다'); } }; rd.readAsDataURL(f); };
        renderPfRows(); renderPresets();
        cbody.querySelector('#addPlat').onclick=()=>{ platforms.push({id:'p'+Date.now(),name:'새 플랫폼',prefix:'플랫폼',short:'N',color:'#6b7280',logo:'',width:860,maxH:0,maxMB:0,formats:['jpg']}); save(); renderPfRows(); };
        cbody.querySelector('#resetPlat').onclick=()=>{ if(confirm('플랫폼 설정을 기본값으로 되돌릴까요?')){ platforms=DEFAULT_PLATFORMS.map(p=>({...p,formats:[...p.formats]})); sel.clear(); platforms.forEach(p=>sel.add(p.id)); save(); renderPfRows(); toast('기본값으로 복원'); } };
        cbody.querySelector('#addPreset').onclick=()=>{ presets.push({id:'pr'+Date.now(),name:'새 프리셋',ids:[...sel]}); savePresets(); renderPresets(); };
      }
      function renderPresets(){
        const box=cbody.querySelector('#presetList'); if(!box) return; box.innerHTML='';
        if(!presets.length){ box.innerHTML='<div class="muted" style="font-size:13px">프리셋이 없습니다. “프리셋 추가”로 만들어 보세요.</div>'; return; }
        presets.forEach((pr,i)=>{ const row=el('div'); row.style.cssText='border:1px solid var(--line);border-radius:9px;padding:12px 14px';
          row.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <input type="text" value="${esc(pr.name)}" style="max-width:240px;font-weight:700" data-nm>
              <span class="muted" style="font-size:12px">${pr.ids.length}개 선택</span>
              <button class="btn ghost sm" style="margin-left:auto" data-del>${icon('trash')}삭제</button></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap" data-chips></div>`;
          row.querySelector('[data-nm]').onchange=e=>{ pr.name=e.target.value.trim()||'프리셋'; savePresets(); renderQuick&&renderQuick(); };
          row.querySelector('[data-del]').onclick=()=>{ presets.splice(i,1); savePresets(); renderPresets(); renderQuick&&renderQuick(); };
          const chips=row.querySelector('[data-chips]');
          platforms.forEach(p=>{ const on=pr.ids.includes(p.id); const c=el('button','pill');
            c.style.cssText='cursor:pointer;gap:6px;'+(on?'border-color:var(--red);background:var(--red-soft);color:var(--red)':'');
            c.innerHTML=`${platLogo(p,18)}${esc(p.name)}`;
            c.onclick=()=>{ const idx=pr.ids.indexOf(p.id); if(idx>=0)pr.ids.splice(idx,1); else pr.ids.push(p.id); savePresets(); renderPresets(); renderQuick&&renderQuick(); };
            chips.appendChild(c); });
          box.appendChild(row); });
      }
      function renderPfRows(){
        const box=cbody.querySelector('#pfRows'); if(!box) return; box.innerHTML='';
        platforms.forEach((p,i)=>{ const row=el('div','pf-row');
          const num=k=>`<input type="number" data-k="${k}" value="${p[k]}">`;
          row.innerHTML=`
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="logo-edit" title="클릭해서 로고 변경">${platLogo(p,34)}
                ${p.logo?'<span class="logo-clear" title="기본 로고로">✕</span>':''}</button>
              <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:0">
                <input type="text" data-k="name" value="${esc(p.name)}">
                <input type="text" data-k="prefix" value="${esc(p.prefix)}" style="font-size:12.5px" placeholder="파일명 접두어"></div>
            </div>
            <div class="fmt-tags">${Object.keys(FORMATS).map(f=>`<span class="fmt-tag ${p.formats.includes(f)?'on':''}" data-f="${f}">${FORMATS[f].label}</span>`).join('')}</div>
            <div>${num('width')}</div><div>${num('maxH')}</div><div>${num('maxMB')}</div>
            <button class="btn ghost sm" title="삭제">${icon('trash')}</button>`;
          row.querySelector('.logo-edit').onclick=(e)=>{
            if(e.target.classList.contains('logo-clear')){ p.logo=(DEFAULT_PLATFORMS.find(d=>d.id===p.id)||{}).logo||''; save(); renderPfRows(); return; }
            logoTargetId=p.id; cbody.querySelector('#logoUpload').click();
          };
          row.querySelectorAll('input[data-k]').forEach(inp=>inp.onchange=inp.oninput=()=>{ const k=inp.dataset.k;
            p[k]=inp.type==='number'?(parseFloat(inp.value)||0):inp.value; save(); });
          row.querySelectorAll('.fmt-tag').forEach(tag=>tag.onclick=()=>{ const f=tag.dataset.f; const idx=p.formats.indexOf(f);
            if(idx>=0){ if(p.formats.length>1)p.formats.splice(idx,1); else return toast('포맷은 최소 1개'); } else p.formats.push(f);
            tag.classList.toggle('on'); save(); });
          row.querySelector('button[title=삭제]').onclick=()=>{ if(confirm(`'${p.name}' 삭제?`)){ platforms.splice(i,1); sel.delete(p.id); save(); renderPfRows(); } };
          box.appendChild(row); });
      }

      draw();
    }
  };
})();
