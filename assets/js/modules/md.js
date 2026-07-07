/* MD · 상품 데이터 관리(기존 도구 iframe) + 상세이미지 변환기 */

/* ── 1) 상품 데이터 관리 도구 (기존 도구를 셸 안에 임베드) ── */
MODULES['md.product'] = {
  title:'상품 데이터 관리', icon:'grid', flush:true,
  render(root){
    root.innerHTML = `<div class="iframe-wrap"><iframe src="modules/md/product-tool.html" title="상품 데이터 관리 도구"></iframe></div>`;
  }
};

/* ── 2) 상세이미지 변환기 ── */
(function(){
  function loadImage(file){
    return new Promise((res,rej)=>{
      const url=URL.createObjectURL(file); const img=new Image();
      img.onload=()=>{ res({name:file.name, file, img, w:img.naturalWidth, h:img.naturalHeight, url}); };
      img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('이미지 로드 실패: '+file.name)); };
      img.src=url;
    });
  }
  function stripExt(n){ return n.replace(/\.[^.]+$/,''); }
  function encode(canvas, fmt, quality){
    return new Promise(res=>{ const F=FORMATS[fmt]; canvas.toBlob(b=>res(b), F.mime, F.quality?quality:undefined); });
  }
  // 소스 이미지의 [top,top+segH) 구간을 targetW 폭으로 그린 캔버스 반환
  function segmentCanvas(img, top, segH, targetW){
    const scale = targetW / img.w;
    const c = el('canvas'); c.width = targetW; c.height = Math.max(1, Math.round(segH*scale));
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality='high';
    ctx.drawImage(img.img, 0, top, img.w, segH, 0, 0, c.width, c.height);
    return c;
  }

  MODULES['md.image'] = {
    title:'상세이미지 변환기', icon:'image',
    render(root){
      // 상태
      const pf = store(STORE.platforms);
      let platforms = pf.get(null) || DEFAULT_PLATFORMS.map(p=>({...p, formats:[...p.formats]}));
      let sources = [];                     // {name,img,w,h,url}
      const sel = new Set(platforms.map(p=>p.id));  // 선택된 플랫폼
      let splitMode = 'none';               // none | auto | manual
      let splitH = 3000;                    // 자동분할 출력 높이(px)
      let manualCuts = [];                  // 수동 절단 y (기준 이미지 소스px)
      let keepOriginal = false;
      let tab = 'convert';                  // convert | settings

      function save(){ pf.set(platforms); }

      root.innerHTML = `<div class="view">
        <div class="view-hd"><div><div class="tt">상세이미지 변환기</div>
          <div class="ds">상세페이지 통이미지를 플랫폼별 규격·확장자로 한 번에 변환하고 ZIP으로 내려받습니다.</div></div></div>
        <div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--line)">
          <button class="tabbtn" data-t="convert">이미지 변환</button>
          <button class="tabbtn" data-t="settings">플랫폼 설정</button>
        </div>
        <div id="body"></div>
      </div>
      <style>
        .tabbtn{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font-size:13px;
          font-weight:600;color:var(--muted);cursor:pointer;margin-bottom:-1px}
        .tabbtn.on{color:var(--red);border-bottom-color:var(--red)}
        .drop{border:1.5px dashed var(--line-strong);border-radius:10px;padding:28px;text-align:center;cursor:pointer;background:var(--panel-2);transition:.14s}
        .drop:hover,.drop.over{border-color:var(--red);background:var(--red-soft)}
        .pf-row{display:grid;grid-template-columns:1.4fr .8fr .7fr .7fr .7fr 1fr 34px;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line-2)}
        .pf-row.hd{font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;background:var(--panel-2)}
        .fmt-tags{display:flex;gap:4px;flex-wrap:wrap}
        .fmt-tag{font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--line-2);color:var(--muted);cursor:pointer;user-select:none;border:1px solid transparent}
        .fmt-tag.on{background:var(--red-soft);color:var(--red);border-color:#f4c9cb}
        .out-item{display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:#fff}
      </style>`;
      const body = root.querySelector('#body');
      root.querySelectorAll('.tabbtn').forEach(b=>{ b.classList.toggle('on',b.dataset.t===tab);
        b.onclick=()=>{ tab=b.dataset.t; root.querySelectorAll('.tabbtn').forEach(x=>x.classList.toggle('on',x.dataset.t===tab)); draw(); }; });

      function draw(){ tab==='convert'?drawConvert():drawSettings(); }

      /* ---------- 변환 탭 ---------- */
      function drawConvert(){
        body.innerHTML = `
          <div class="card pad" style="margin-bottom:14px">
            <input type="file" id="picker" accept="image/*" multiple class="hidden">
            <div class="drop" id="drop">${icon('upload')}
              <div style="font-weight:600;margin-top:6px">상세페이지 이미지를 끌어다 놓거나 클릭</div>
              <div class="muted" style="font-size:12px;margin-top:3px">여러 장 가능 · 처리 전부 이 PC 안에서만 이뤄집니다</div></div>
            <div id="srcList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
          </div>

          <div class="card pad" style="margin-bottom:14px">
            <div class="sec-title">1 · 상품명 &amp; 대상 플랫폼</div>
            <label class="fld" style="max-width:420px;margin-bottom:12px">상품명 (파일명에 사용 · 앞에 플랫폼명이 자동으로 붙습니다)
              <input type="text" id="prod" value="${esc(productName)}" placeholder="예: 아두이노 스타터 키트"></label>
            <div id="platChips" style="display:flex;flex-wrap:wrap;gap:8px"></div>
          </div>

          <div class="card pad" style="margin-bottom:14px">
            <div class="sec-title">2 · 긴 이미지 분할</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
              <label class="chk"><input type="radio" name="sm" value="none" ${splitMode==='none'?'checked':''}> 분할 안 함</label>
              <label class="chk"><input type="radio" name="sm" value="auto" ${splitMode==='auto'?'checked':''}> 자동 분할</label>
              <label class="chk"><input type="radio" name="sm" value="manual" ${splitMode==='manual'?'checked':''}> 수동 분할</label>
              <span id="splitOpt" style="display:flex;gap:8px;align-items:center"></span>
            </div>
            <div id="manualBox" style="margin-top:12px"></div>
          </div>

          <div class="card pad">
            <div class="sec-title">3 · 변환 &amp; 저장</div>
            <label class="chk" style="margin-bottom:12px"><input type="checkbox" id="keepOrig" ${keepOriginal?'checked':''}> 원본 통이미지도 ZIP에 포함</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="btn pri lg" id="run">${icon('layers')}변환하고 ZIP 다운로드</button>
              <span class="muted" id="runInfo" style="font-size:12.5px"></span>
            </div>
            <div id="result" style="margin-top:14px"></div>
          </div>`;

        // 업로드
        const picker=body.querySelector('#picker'), drop=body.querySelector('#drop');
        drop.onclick=()=>picker.click();
        picker.onchange=e=>addFiles(e.target.files);
        ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
        ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
        drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
        renderSrc();

        // 상품명
        body.querySelector('#prod').oninput=e=>{ productName=e.target.value; };

        // 플랫폼 칩
        renderPlatChips();

        // 분할 옵션
        body.querySelectorAll('input[name=sm]').forEach(r=>r.onchange=()=>{ splitMode=r.value; renderSplitOpt(); });
        renderSplitOpt();

        body.querySelector('#keepOrig').onchange=e=>keepOriginal=e.target.checked;
        body.querySelector('#run').onclick=run;
      }

      let productName='';

      function addFiles(fileList){
        const imgs=[...fileList].filter(f=>/^image\//.test(f.type));
        if(!imgs.length){ toast('이미지 파일만 가능합니다'); return; }
        Promise.all(imgs.map(loadImage)).then(loaded=>{ sources.push(...loaded); renderSrc();
          // 자동분할 기본 높이 = 선택 플랫폼 maxH 중 최솟값
          suggestSplit();
        }).catch(err=>toast(err.message));
      }
      function renderSrc(){
        const box=body.querySelector('#srcList'); if(!box) return;
        if(!sources.length){ box.innerHTML=''; return; }
        box.innerHTML='';
        sources.forEach((s,i)=>{ const r=el('div','out-item');
          r.innerHTML=`<img src="${s.url}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--line)">
            <div style="min-width:0"><b style="font-size:12.5px">${esc(s.name)}</b>
              <div class="muted" style="font-size:11.5px">${s.w}×${s.h}px · ${bytes(s.file.size)}</div></div>
            <button class="btn ghost sm" style="margin-left:auto">${icon('x')}</button>`;
          r.querySelector('button').onclick=()=>{ URL.revokeObjectURL(s.url); sources.splice(i,1); renderSrc(); renderManual(); };
          box.appendChild(r); });
      }
      function renderPlatChips(){
        const box=body.querySelector('#platChips'); if(!box) return; box.innerHTML='';
        platforms.forEach(p=>{ const on=sel.has(p.id); const chip=el('label','pill');
          chip.style.cssText='cursor:pointer;'+(on?'border-color:var(--red);background:var(--red-soft);color:var(--red)':'');
          chip.innerHTML=`<input type="checkbox" ${on?'checked':''} style="margin:0"> ${esc(p.name)}
            <span class="fmt-tags">${p.formats.map(f=>`<span class="fmt-tag on">${FORMATS[f].label}</span>`).join('')}</span>`;
          chip.querySelector('input').onchange=e=>{ e.target.checked?sel.add(p.id):sel.delete(p.id); renderPlatChips(); suggestSplit(); };
          box.appendChild(chip); });
      }
      function selectedPlatforms(){ return platforms.filter(p=>sel.has(p.id)); }
      function suggestSplit(){
        const hs=selectedPlatforms().map(p=>p.maxH).filter(h=>h>0);
        if(hs.length){ splitH=Math.min(...hs); const inp=body.querySelector('#splitH'); if(inp) inp.value=splitH; }
      }
      function renderSplitOpt(){
        const box=body.querySelector('#splitOpt'), man=body.querySelector('#manualBox'); if(!box) return;
        if(splitMode==='auto'){
          box.innerHTML=`<span class="muted" style="font-size:12.5px">출력 페이지 높이</span>
            <input type="number" id="splitH" value="${splitH}" style="width:100px"><span class="muted" style="font-size:12.5px">px 마다</span>`;
          box.querySelector('#splitH').oninput=e=>splitH=Math.max(200,parseInt(e.target.value)||3000);
          man.innerHTML=`<div class="note">선택한 플랫폼의 세로 제한 중 가장 작은 값으로 자동 제안됩니다. (쿠팡 3,000px 등)</div>`;
        } else if(splitMode==='manual'){
          box.innerHTML='';
          renderManual();
        } else { box.innerHTML=''; man.innerHTML=''; }
      }
      function renderManual(){
        const man=body.querySelector('#manualBox'); if(!man||splitMode!=='manual') return;
        if(sources.length!==1){ man.innerHTML=`<div class="note warn">수동 분할은 이미지가 <b>1장</b>일 때 사용하세요. (현재 ${sources.length}장) — 이미지를 한 장만 올리거나 자동 분할을 이용하세요.</div>`; return; }
        const s=sources[0]; const dispW=Math.min(300,s.w); const scale=dispW/s.w; const dispH=Math.round(s.h*scale);
        man.innerHTML=`<div class="muted" style="font-size:12.5px;margin-bottom:8px">이미지를 클릭해 자르는 위치(가로선)를 추가하세요. 선을 클릭하면 삭제됩니다.
          <button class="btn sm" id="eqCut" style="margin-left:8px">균등 3등분</button>
          <button class="btn sm" id="clrCut">모두 지우기</button></div>
          <div style="position:relative;width:${dispW}px;border:1px solid var(--line);border-radius:6px;overflow:hidden;cursor:crosshair" id="cutCanvas">
            <img src="${s.url}" style="width:100%;display:block">
            <div id="cutLines"></div></div>
          <div class="muted" id="cutInfo" style="font-size:11.5px;margin-top:6px"></div>`;
        const holder=man.querySelector('#cutCanvas'), lines=man.querySelector('#cutLines');
        function drawLines(){ lines.innerHTML=''; manualCuts=manualCuts.filter(y=>y>0&&y<s.h).sort((a,b)=>a-b);
          manualCuts.forEach((y,idx)=>{ const ln=el('div'); ln.style.cssText=`position:absolute;left:0;right:0;top:${Math.round(y*scale)}px;height:2px;background:var(--red);cursor:pointer`;
            ln.title='클릭하면 삭제'; ln.onclick=e=>{ e.stopPropagation(); manualCuts.splice(idx,1); drawLines(); }; lines.appendChild(ln); });
          man.querySelector('#cutInfo').textContent = `${manualCuts.length+1}개 조각으로 분할됩니다.`;
        }
        holder.onclick=e=>{ const rect=holder.getBoundingClientRect(); const y=Math.round((e.clientY-rect.top)/scale); if(y>2&&y<s.h-2){ manualCuts.push(y); drawLines(); } };
        man.querySelector('#eqCut').onclick=()=>{ manualCuts=[Math.round(s.h/3),Math.round(s.h*2/3)]; drawLines(); };
        man.querySelector('#clrCut').onclick=()=>{ manualCuts=[]; drawLines(); };
        drawLines();
      }

      // 소스별 분할 구간(top, segH) 배열 반환 — 플랫폼 scale 기준
      function segmentsFor(img, platform){
        if(splitMode==='manual' && sources.length===1){
          const pts=[0,...manualCuts.filter(y=>y>0&&y<img.h).sort((a,b)=>a-b),img.h];
          const segs=[]; for(let i=0;i<pts.length-1;i++) segs.push([pts[i], pts[i+1]-pts[i]]); return segs;
        }
        if(splitMode==='auto'){
          const scale=(platform.width>0&&img.w>platform.width)?platform.width/img.w:1;
          const srcSeg=Math.max(50,Math.floor(splitH/scale)); const segs=[];
          for(let top=0; top<img.h; top+=srcSeg) segs.push([top, Math.min(srcSeg, img.h-top)]); return segs;
        }
        return [[0,img.h]];
      }

      async function run(){
        if(!sources.length){ toast('이미지를 먼저 올려주세요'); return; }
        const plats=selectedPlatforms(); if(!plats.length){ toast('대상 플랫폼을 선택하세요'); return; }
        const btn=body.querySelector('#run'), info=body.querySelector('#runInfo');
        btn.disabled=true; info.textContent='변환 중…';
        const files=[]; const rows=[];
        try{
          for(let si=0; si<sources.length; si++){
            const s=sources[si];
            const base=(productName.trim()||stripExt(s.name)) + (sources.length>1?`_${si+1}`:'');
            for(const p of plats){
              const targetW=(p.width>0&&s.w>p.width)?p.width:s.w;
              const segs=segmentsFor(s,p); const multi=segs.length>1;
              for(let gi=0; gi<segs.length; gi++){
                const [top,segH]=segs[gi];
                const canvas=segmentCanvas(s, top, segH, targetW);
                for(const fk of p.formats){
                  const blob=await encode(canvas, fk, p.quality);
                  if(!blob) continue;
                  const nm=`${p.prefix}_${base}${multi?'_'+(gi+1):''}.${FORMATS[fk].ext}`;
                  files.push({name:`${p.name}/${nm}`, blob});
                  rows.push({name:nm, plat:p, dim:`${canvas.width}×${canvas.height}`, size:blob.size, over:(p.maxMB>0&&blob.size>p.maxMB*1048576)});
                }
              }
            }
            if(keepOriginal) files.push({name:`_원본/${s.name}`, blob:s.file});
          }
          const zip=await makeZip(files);
          const stamp=new Date(); const ds=`${stamp.getFullYear()}${String(stamp.getMonth()+1).padStart(2,'0')}${String(stamp.getDate()).padStart(2,'0')}`;
          const zipName=`상세이미지_${(productName.trim()||'변환')}_${ds}.zip`;
          downloadBlob(zip, zipName);
          info.textContent=`완료 · 파일 ${files.length}개 · ${bytes(zip.size)}`;
          renderResult(rows, zipName);
          toast('ZIP으로 내려받았습니다');
        }catch(err){ info.textContent='오류: '+err.message; toast('변환 실패: '+err.message); }
        finally{ btn.disabled=false; }
      }
      function renderResult(rows, zipName){
        const box=body.querySelector('#result'); if(!box) return;
        if(!rows.length){ box.innerHTML=''; return; }
        const warnN=rows.filter(r=>r.over).length;
        box.innerHTML=`<div class="sec-title" style="margin-top:4px">결과 · ${esc(zipName)}</div>
          ${warnN?`<div class="note warn" style="margin-bottom:10px">${warnN}개 파일이 플랫폼 용량 상한을 초과합니다. 품질을 낮추거나 분할 높이를 줄여보세요.</div>`:''}
          <div style="overflow:auto;max-height:320px" class="sc"><table class="tbl">
            <thead><tr><th>파일명</th><th>플랫폼</th><th>크기(px)</th><th class="num">용량</th></tr></thead>
            <tbody>${rows.map(r=>`<tr><td class="mono" style="font-size:11.5px">${esc(r.name)}</td>
              <td>${esc(r.plat.name)}</td><td class="mono">${r.dim}</td>
              <td class="num" ${r.over?'style="color:var(--red);font-weight:600"':''}>${bytes(r.size)}</td></tr>`).join('')}</tbody>
          </table></div>`;
      }

      /* ---------- 플랫폼 설정 탭 ---------- */
      function drawSettings(){
        body.innerHTML=`
          <div class="card">
            <div class="card-hd">${icon('sliders')}<b>플랫폼별 변환 규격</b>
              <span style="margin-left:auto;display:flex;gap:6px">
                <button class="btn sm" id="addPlat">${icon('plus')}플랫폼 추가</button>
                <button class="btn sm" id="resetPlat">${icon('refresh')}기본값 복원</button></span></div>
            <div class="card-bd" style="padding:0">
              <div class="pf-row hd"><div>플랫폼 / 접두어</div><div>포맷</div><div>가로(px)</div><div>세로/장</div><div>용량(MB)</div><div>품질</div><div></div></div>
              <div id="pfRows"></div>
            </div>
          </div>
          <div class="note" style="margin-top:12px">가로 0 = 원본 유지 · 세로/장 0 = 분할 제한 없음 · 용량 0 = 경고 안 함.
            <b>WEBP</b>는 자사몰·네이버 등에서 지원하나 일부 오픈마켓은 미지원일 수 있어 확인이 필요합니다.
            (2026 조사 기준: 쿠팡 3,000px·5MB, 네이버 20MB, 11번가/G마켓 10MB)</div>`;
        renderPfRows();
        body.querySelector('#addPlat').onclick=()=>{ platforms.push({id:'p'+Date.now(),name:'새 플랫폼',prefix:'플랫폼',width:860,maxH:0,maxMB:0,quality:0.85,formats:['jpg']}); save(); renderPfRows(); };
        body.querySelector('#resetPlat').onclick=()=>{ if(confirm('플랫폼 설정을 기본값으로 되돌릴까요?')){ platforms=DEFAULT_PLATFORMS.map(p=>({...p,formats:[...p.formats]})); sel.clear(); platforms.forEach(p=>sel.add(p.id)); save(); renderPfRows(); toast('기본값으로 복원'); } };
      }
      function renderPfRows(){
        const box=body.querySelector('#pfRows'); if(!box) return; box.innerHTML='';
        platforms.forEach((p,i)=>{ const row=el('div','pf-row');
          const numField=(k,w)=>`<input type="number" data-k="${k}" value="${p[k]}" style="width:100%">`;
          row.innerHTML=`
            <div style="display:flex;flex-direction:column;gap:4px">
              <input type="text" data-k="name" value="${esc(p.name)}">
              <input type="text" data-k="prefix" value="${esc(p.prefix)}" style="font-size:11.5px" placeholder="파일명 접두어">
            </div>
            <div class="fmt-tags">${Object.keys(FORMATS).map(f=>`<span class="fmt-tag ${p.formats.includes(f)?'on':''}" data-f="${f}">${FORMATS[f].label}</span>`).join('')}</div>
            <div>${numField('width')}</div><div>${numField('maxH')}</div><div>${numField('maxMB')}</div>
            <div style="display:flex;align-items:center;gap:6px"><input type="range" min="0.5" max="1" step="0.01" data-k="quality" value="${p.quality}" style="flex:1">
              <span class="mono" style="font-size:11px;width:26px" data-q>${Math.round(p.quality*100)}</span></div>
            <button class="btn ghost sm" title="삭제">${icon('trash')}</button>`;
          row.querySelectorAll('input[data-k]').forEach(inp=>{ inp.onchange=inp.oninput=()=>{
            const k=inp.dataset.k; p[k]= inp.type==='number'?(parseFloat(inp.value)||0):inp.type==='range'?parseFloat(inp.value):inp.value;
            if(k==='quality') row.querySelector('[data-q]').textContent=Math.round(p.quality*100); save(); }; });
          row.querySelectorAll('.fmt-tag').forEach(tag=>{ tag.onclick=()=>{ const f=tag.dataset.f;
            const idx=p.formats.indexOf(f); if(idx>=0){ if(p.formats.length>1) p.formats.splice(idx,1); else return toast('포맷은 최소 1개'); } else p.formats.push(f);
            tag.classList.toggle('on'); save(); }; });
          row.querySelector('button[title=삭제]').onclick=()=>{ if(confirm(`'${p.name}' 삭제?`)){ platforms.splice(i,1); sel.delete(p.id); save(); renderPfRows(); } };
          box.appendChild(row);
        });
      }

      draw();
    }
  };
})();
