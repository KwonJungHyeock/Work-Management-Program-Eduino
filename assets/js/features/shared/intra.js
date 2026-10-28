/* ===========================================================================
   자료 서버 모니터링 — 따로 띄워 둔 자료(인사이트) 서버를 프로그램 안에서 본다
   - 들어올 때마다 접속코드를 물어보고, 맞아야 화면이 열린다.
   - 주소가 https:// 면 프로그램 안에 그대로 끼워 넣는다(임베드).
     http:// 면 브라우저가 혼합 콘텐츠로 막으므로 끼워 넣지 못하고 새 탭으로 보낸다.
     (HTTPS 페이지 안의 HTTP 화면 차단은 우회 방법이 없다 — 서버를 https 로 열어야 한다)
   - 주소·안내문·접속코드는 관리자가 이 화면에서 등록한다(코드에 박아 두지 않는다).
   - 접속코드는 해시만 저장한다. api/store 는 호출자 인증이 없어 설정이 그대로
     읽히므로 평문을 두면 주소만 알면 누구나 가져갈 수 있다.
   ========================================================================= */
(function(){
  const isAdmin = ()=>!!(Auth.isAdmin&&Auth.isAdmin());
  const cfgStore = ()=>store(STORE.intraCfg);
  const getCfg = ()=>Object.assign({ name:'', url:'', desc:'', codeHash:'', embed:true }, cfgStore().get(null)||{});

  /* 접속코드 해시 — 평문을 저장소에 남기지 않기 위한 것.
     짧은 숫자 코드는 해시여도 대입으로 풀리므로, 진짜 보호는 서버 자체 인증에 둔다. */
  const SALT='eduino.intra.v1|';
  async function hashCode(code){
    const txt=SALT+String(code||'').trim();
    try{
      if(crypto && crypto.subtle && crypto.subtle.digest){
        const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
        return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
      }
    }catch(e){}
    let h=0; for(let i=0;i<txt.length;i++) h=(h*31+txt.charCodeAt(i))>>>0;   // 보안 컨텍스트가 아닐 때의 대체
    return 'f'+h.toString(16);
  }
  const hostOf = u=>{ try{ return new URL(u).host; }catch(e){ return String(u||'').replace(/^\w+:\/\//,'').split('/')[0]; } };
  const maskHost = u=>{ const h=hostOf(u); if(!h) return ''; const [ip,port]=h.split(':');
    const seg=String(ip).split('.'); if(seg.length===4) return `${seg[0]}.${seg[1]}.***.***${port?':'+port:''}`;
    return h.length>6 ? h.slice(0,3)+'***' : '***'; };
  const isHttps = u=>/^https:\/\//i.test(String(u||''));
  /* 프로그램이 https 로 열려 있으면 http 화면은 끼워 넣을 수 없다(브라우저 차단).
     프로그램 자체가 http(사내 테스트) 면 http 도 끼워 넣을 수 있다. */
  const pageHttps = ()=>location.protocol==='https:';
  const canEmbed = u=>!!String(u||'').trim() && (isHttps(u) || !pageHttps());

  MODULES['home.intra']={
    title:'자료 서버', icon:'lock', flush:true,
    render(root){
      let cfg=getCfg(), unlocked=false, setup=false, tries=0, loadTimer=null;

      root.style.display='flex'; root.style.flexDirection='column';
      root.innerHTML=`
      <style>
        .it-wrap{max-width:620px;margin:min(7vh,56px) auto 0;padding:0 20px}
        .it-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--sh);padding:30px 28px;text-align:center}
        .it-ic{width:56px;height:56px;margin:0 auto 14px;border-radius:16px;display:flex;align-items:center;justify-content:center;
          background:var(--red-soft);color:var(--red);font-size:25px}
        .it-card.ok .it-ic{background:var(--ok-bg);color:var(--ok)}
        .it-card.warn .it-ic{background:var(--warn-bg);color:var(--warn)}
        .it-t{font-size:17px;font-weight:800;letter-spacing:-.01em}
        .it-d{font-size:13.5px;color:var(--muted);line-height:1.65;margin-top:7px}
        .it-form{display:flex;gap:8px;justify-content:center;margin-top:18px}
        .it-form input{width:190px;height:42px;text-align:center;font-size:17px;font-weight:700;letter-spacing:.22em;font-family:var(--mono)}
        .it-err{min-height:19px;font-size:12.5px;font-weight:700;color:var(--danger);margin-top:9px}
        .it-meta{font-size:12px;color:var(--faint);margin-top:14px;padding-top:14px;border-top:1px solid var(--line-2);line-height:1.6}
        .it-addr{display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px}
        .it-addr code{font-family:var(--mono);font-size:13.5px;font-weight:700;color:var(--ink-2);
          background:var(--panel-2);border:1px solid var(--line);border-radius:7px;padding:7px 11px}
        .it-note{font-size:12.5px;color:var(--ink-2);background:var(--info-bg);border:1px solid #cfe0f7;
          border-radius:9px;padding:11px 14px;line-height:1.65;margin-top:16px;text-align:left}
        .it-note.warn{background:var(--warn-bg);border-color:#ead9b0;color:#7a4d06}
        .it-setup{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--sh-sm);
          padding:18px 20px;margin-top:18px;text-align:left}
        .it-setup h4{font-size:14px;font-weight:800;margin:0 0 4px}
        .it-setup .sd{font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px}
        .it-grid{display:grid;gap:12px}
        .it-f{display:flex;flex-direction:column;gap:5px}
        .it-f label{font-size:11.5px;font-weight:700;color:var(--muted)}
        .it-f label em{font-style:normal;font-weight:500;color:var(--faint);margin-left:5px}
        .it-act{display:flex;gap:8px;align-items:center;margin-top:16px}
        .it-act .sp{flex:1;font-size:12px;color:var(--muted)}
        @keyframes it-shake{0%,100%{transform:none}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
        .it-shake{animation:it-shake .22s}
        /* 임베드(프로그램 안에서 보기) */
        .it-live{position:absolute;inset:0;display:flex;flex-direction:column}
        .it-bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel-2)}
        .it-bar .nm{font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px}
        .it-bar .nm .ic{color:var(--ok)}
        .it-bar code{font-family:var(--mono);font-size:11.5px;color:var(--muted);background:var(--panel);
          border:1px solid var(--line);border-radius:6px;padding:2px 8px}
        .it-bar .sp{flex:1}
        .it-frame{flex:1;min-height:0;position:relative;background:var(--panel)}
        .it-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#fff}
        .it-load{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:10px;color:var(--muted);font-size:13px;background:var(--panel);z-index:2}
        .it-load.gone{display:none}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt" id="itTitle">자료 서버</div>
          <div class="ds" id="itDs">따로 띄워 둔 자료 서버를 프로그램 안에서 봅니다. 접속코드를 확인한 뒤 열립니다.</div></div>
        <div class="mhead-act" id="itHeadAct"></div>
      </div></div>
      <div style="flex:1;min-height:0;position:relative;overflow:auto" id="itBody"></div>`;

      const body=root.querySelector('#itBody'), headAct=root.querySelector('#itHeadAct');
      const title=root.querySelector('#itTitle'), dsEl=root.querySelector('#itDs');

      const embedMode=()=>cfg.embed!==false && canEmbed(cfg.url);

      function openTab(){ let w=null; try{ w=window.open(cfg.url,'_blank','noopener'); }catch(e){} return !!w; }

      function draw(){
        clearTimeout(loadTimer);
        if(cfg.name) title.textContent=cfg.name;
        dsEl.innerHTML = embedMode()
          ? '따로 띄워 둔 자료 서버를 <b>프로그램 안에서</b> 봅니다. 접속코드를 확인한 뒤 열립니다.'
          : '따로 띄워 둔 자료 서버로 건너갑니다. 접속코드를 확인한 뒤 <b>새 탭</b>으로 열립니다.';
        headAct.innerHTML = isAdmin()
          ? `<button class="btn ghost sm" id="itCfgBtn">${icon('settings')||icon('sliders')||''}${setup?'설정 닫기':'주소·접속코드 설정'}</button>` : '';

        // 임베드로 열린 상태 — 전체 화면을 iframe 이 차지한다
        if(unlocked && embedMode() && !setup){
          body.style.overflow='hidden';
          body.innerHTML=`<div class="it-live">
            <div class="it-bar">
              <span class="nm">${icon('check')}${esc(cfg.name||'자료 서버')}</span>
              <code>${esc(hostOf(cfg.url))}</code>
              <span class="sp"></span>
              <button class="btn ghost sm" id="itReload">${icon('refresh')}새로고침</button>
              <button class="btn ghost sm" id="itPop">${icon('external')}새 탭</button>
              <button class="btn ghost sm" id="itLock">${icon('lock')}잠그기</button>
            </div>
            <div class="it-frame">
              <div class="it-load" id="itLoad">${icon('refresh')}<div>자료 서버를 불러오는 중…</div>
                <div style="font-size:12px;color:var(--faint)">사내망에 연결돼 있어야 열립니다</div></div>
              <iframe id="itFrame" src="${esc(cfg.url)}" title="${esc(cfg.name||'자료 서버')}"
                referrerpolicy="no-referrer"></iframe>
            </div>
          </div>`;
          wireLive(); return;
        }

        body.style.overflow='auto';
        const notReady=!String(cfg.url||'').trim();
        let html='';
        if(notReady){
          html=`<div class="it-card">
            <div class="it-ic">${icon('link')||icon('folder')||''}</div>
            <div class="it-t">아직 주소가 등록되지 않았습니다</div>
            <div class="it-d">${isAdmin()?'오른쪽 위 <b>[주소·접속코드 설정]</b>에서 자료 서버 주소와 접속코드를 등록하세요.'
              :'관리자가 자료 서버 주소를 등록하면 여기에서 바로 볼 수 있습니다.'}</div>
          </div>`;
        } else if(!unlocked){
          html=`<div class="it-card" id="itLock">
            <div class="it-ic">${icon('lock')||''}</div>
            <div class="it-t">접속코드를 입력하세요</div>
            <div class="it-d">${esc(cfg.desc||'자료 서버 화면을 엽니다.')}<br>접속코드는 담당자에게 확인하세요.</div>
            <form class="it-form" id="itForm">
              <input type="password" id="itCode" inputmode="numeric" autocomplete="off" placeholder="● ● ● ●" aria-label="접속코드">
              <button class="btn pri" type="submit" style="height:42px">${icon('check')}열기</button>
            </form>
            <div class="it-err" id="itErr"></div>
            <div class="it-meta">${esc(maskHost(cfg.url))} · <b>사내망(회사 와이파이·유선)</b>에서만 열립니다.
              ${cfg.codeHash?'':'<br><b>접속코드가 등록돼 있지 않습니다</b> — 관리자에게 등록을 요청하세요.'}</div>
          </div>`;
        } else {
          // 잠금은 풀렸지만 끼워 넣을 수 없는 경우(http 주소) — 새 탭 안내
          html=`<div class="it-card warn">
            <div class="it-ic">${icon('external')||''}</div>
            <div class="it-t">새 탭으로 열었습니다</div>
            <div class="it-d">탭이 뜨지 않으면 아래 버튼을 눌러 주세요. (브라우저 팝업 차단)</div>
            <div class="it-addr">
              <code>${esc(cfg.url)}</code>
              <button class="btn ghost sm" id="itCopy">${icon('copy')}복사</button>
            </div>
            <div class="it-addr" style="margin-top:12px">
              <a class="btn pri lg" id="itOpen" href="${esc(cfg.url)}" target="_blank" rel="noopener">${icon('external')}자료 서버 열기</a>
            </div>
            <div class="it-note warn">${icon('alert')||''} <b>프로그램 안에 끼워 넣지 못했습니다.</b>
              이 프로그램은 <b>https</b> 로 열려 있는데 자료 서버 주소가 <b>http</b> 라서, 브라우저가 화면 끼워 넣기를 막습니다(혼합 콘텐츠).
              서버를 <b>https 주소</b>로 열 수 있게 되면 설정에서 주소만 바꾸면 이 화면 안에 그대로 들어옵니다.</div>
            ${cfg.desc?`<div class="it-note">${icon('info')||''} ${esc(cfg.desc)}</div>`:''}
          </div>`;
        }

        if(isAdmin()&&setup){
          const embedOk=canEmbed(cfg.url);
          html+=`<div class="it-setup">
            <h4>주소·접속코드 설정</h4>
            <div class="sd">여기서 저장한 값은 <b>팀 전체</b>에 공유됩니다.
              접속코드는 <b>해시로만</b> 저장해 설정을 들여다봐도 코드가 보이지 않습니다.
              다만 짧은 숫자 코드는 대입으로 풀릴 수 있으니, 실제 보호는 서버 자체 인증에 두세요.</div>
            <div class="it-grid">
              <div class="it-f"><label>표시 이름 <em>메뉴·제목에 쓰입니다</em></label>
                <input type="text" id="sfName" value="${esc(cfg.name||'')}" placeholder="예: 인사이트 자료 서버"></div>
              <div class="it-f"><label>주소 <em>https:// 면 프로그램 안에서 바로 보입니다</em></label>
                <input type="text" id="sfUrl" value="${esc(cfg.url||'')}" placeholder="https://example.trycloudflare.com"></div>
              <div class="it-f"><label>안내 문구 <em>선택</em></label>
                <input type="text" id="sfDesc" value="${esc(cfg.desc||'')}" placeholder="예: 사내망에서만 접속됩니다. 자료 반출 금지"></div>
              <div class="it-f"><label>접속코드 <em>${cfg.codeHash?'등록돼 있습니다 · 바꿀 때만 입력':'아직 등록되지 않았습니다'}</em></label>
                <input type="password" id="sfCode" autocomplete="new-password" placeholder="${cfg.codeHash?'비워 두면 그대로 유지':'새 접속코드'}"></div>
              <label class="chk" style="font-size:13px"><input type="checkbox" id="sfEmbed" ${cfg.embed!==false?'checked':''}>
                프로그램 안에서 보기(임베드) — 끄면 항상 새 탭으로 엽니다</label>
            </div>
            <div class="it-note ${embedOk?'':'warn'}" style="margin-top:14px">${icon(embedOk?'info':'alert')||''}
              ${embedOk
                ? '지금 주소는 <b>프로그램 안에서 바로 볼 수 있습니다.</b>'
                : '지금 주소는 <b>http</b> 라서 프로그램 안에 넣을 수 없고 새 탭으로만 열립니다. 서버를 <b>https</b> 주소로 열면 바로 임베드됩니다.'}</div>
            <div class="it-act">
              <span class="sp" id="sfMsg"></span>
              ${cfg.codeHash?`<button class="btn ghost sm" id="sfClear" style="color:var(--danger)">접속코드 지우기</button>`:''}
              <button class="btn ghost" id="sfCancel">취소</button>
              <button class="btn pri" id="sfSave">${icon('save')}저장</button>
            </div>
          </div>`;
        }
        body.innerHTML=`<div class="it-wrap">${html}</div>`;
        wire();
      }

      /* 임베드 화면 — 상대 서버가 끼워 넣기를 거부하면(X-Frame-Options 등) 알려 준다 */
      function wireLive(){
        const q=s=>body.querySelector(s);
        const fr=q('#itFrame'), load=q('#itLoad');
        let loaded=false;
        if(fr) fr.onload=()=>{ loaded=true; if(load) load.classList.add('gone'); };
        loadTimer=setTimeout(()=>{
          if(loaded||!root.isConnected||!load) return;
          load.innerHTML=`${icon('alert')||''}<div style="font-weight:700;color:var(--warn)">화면을 불러오지 못했습니다</div>
            <div style="font-size:12.5px;line-height:1.7;max-width:380px;text-align:center">
              서버가 꺼져 있거나, 사내망에 연결돼 있지 않거나,<br>그 서버가 <b>끼워 넣기를 거부</b>하는 설정일 수 있습니다.</div>
            <button class="btn sm" id="itPop2">${icon('external')}새 탭으로 열기</button>`;
          const p2=load.querySelector('#itPop2'); if(p2) p2.onclick=()=>openTab();
        }, 9000);
        const rl=q('#itReload'); if(rl) rl.onclick=()=>draw();
        const pp=q('#itPop'); if(pp) pp.onclick=()=>{ if(!openTab()) toast('팝업이 차단됐습니다'); };
        const lk=q('#itLock'); if(lk) lk.onclick=()=>{ unlocked=false; draw(); toast('잠갔습니다'); };
        const cb=root.querySelector('#itCfgBtn'); if(cb) cb.onclick=()=>{ setup=!setup; draw(); };
      }

      function wire(){
        const q=s=>body.querySelector(s);
        const cb=root.querySelector('#itCfgBtn'); if(cb) cb.onclick=()=>{ setup=!setup; draw(); };

        const form=q('#itForm');
        if(form) form.onsubmit=async e=>{
          e.preventDefault();
          const input=q('#itCode'), err=q('#itErr');
          const val=String(input.value||'').trim();
          if(!val){ err.textContent='접속코드를 입력하세요'; input.focus(); return; }
          if(!cfg.codeHash){ err.textContent='접속코드가 등록돼 있지 않습니다 — 관리자에게 요청하세요'; return; }
          err.textContent='';
          const h=await hashCode(val);
          if(!root.isConnected) return;
          if(h!==cfg.codeHash){
            tries++; input.value=''; input.focus();
            err.textContent=`접속코드가 맞지 않습니다${tries>=3?' · 담당자에게 확인해 주세요':''}`;
            const card=q('#itLock'); if(card){ card.classList.remove('it-shake'); void card.offsetWidth; card.classList.add('it-shake'); }
            return;
          }
          unlocked=true; tries=0;
          const embed=embedMode();
          if(typeof actLog==='function'){ try{ actLog('자료 서버 열기','모니터링',hostOf(cfg.url)); }catch(e){} }
          if(!embed){ const opened=openTab(); draw();
            toast(opened?'자료 서버를 새 탭으로 열었습니다':'팝업이 차단됐습니다 — [자료 서버 열기]를 눌러 주세요'); return; }
          draw();
        };
        const codeEl=q('#itCode'); if(codeEl) codeEl.focus();

        const cp=q('#itCopy'); if(cp) cp.onclick=()=>copyText(cfg.url);

        const save=q('#sfSave');
        if(save) save.onclick=async()=>{
          const msg=q('#sfMsg');
          const url=String(q('#sfUrl').value||'').trim();
          if(url && !/^https?:\/\//i.test(url)){ msg.innerHTML='<span style="color:var(--danger)">주소는 http:// 또는 https:// 로 시작해야 합니다</span>'; return; }
          const next={ name:String(q('#sfName').value||'').trim(), url, desc:String(q('#sfDesc').value||'').trim(),
            codeHash:cfg.codeHash||'', embed:!!q('#sfEmbed').checked };
          const raw=String(q('#sfCode').value||'').trim();
          if(raw) next.codeHash=await hashCode(raw);
          if(!root.isConnected) return;
          cfgStore().set(next); cfg=getCfg(); setup=false; unlocked=false;
          toast('저장했습니다 — 팀 전체에 반영됩니다'); draw();
        };
        const cc=q('#sfCancel'); if(cc) cc.onclick=()=>{ setup=false; draw(); };
        const cl=q('#sfClear'); if(cl) cl.onclick=()=>{
          if(!confirm('접속코드를 지울까요?\n코드를 다시 등록하기 전까지 아무도 들어갈 수 없습니다.')) return;
          const next=Object.assign({},cfg,{codeHash:''}); cfgStore().set(next); cfg=getCfg(); unlocked=false;
          toast('접속코드를 지웠습니다'); draw();
        };
      }

      draw();
    }
  };
})();
