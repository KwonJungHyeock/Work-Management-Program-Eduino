/* ===========================================================================
   CS · 고객 정보 검색 — 상담 중 거래처명/연락처로 고객DB 이력 조회
   - 고객DB(구글시트) 원장[21_거래내역] + [01_고객마스터]를 검색해서
     그 거래처의 요약(구매건수·총구매액·최근구매일·담당자·타겟)과 거래 이력을 보여줌.
   - 연동 URL은 [입점사 발주 → 고객DB 연동]에 저장한 것과 동일(전사 공유).
   - 조회 전용(수정 없음).
   ========================================================================= */
(function(){
  const custDbUrl=()=> (store(STORE.custDbCfg).get({sheetUrl:''})||{}).sheetUrl||'';
  const won=n=>Number(n||0).toLocaleString();
  const parseAmt=v=>Number(String(v==null?'':v).replace(/[^\d.-]/g,''))||0;
  const gubunColor=g=>({'견적':['var(--muted)','var(--panel-2)'],'발주':['var(--info)','var(--info-bg)'],'후불':['var(--warn)','var(--warn-bg)']}[String(g||'').trim()]||['var(--ink-2)','var(--panel-2)']);
  const gBadge=g=>{ if(!g) return ''; const [c,bg]=gubunColor(g); return `<span style="display:inline-block;font-weight:800;font-size:11px;padding:2px 7px;border-radius:5px;color:${c};background:${bg}">${esc(g)}</span>`; };

  MODULES['cs.custdb']={
    title:'고객 정보 검색', icon:'search',
    render(root){
      let busy=false, last='';
      root.innerHTML=`
      <style>
        .cd-wrap{max-width:1000px}
        .cd-search{position:relative;max-width:620px}
        .cd-search .ic{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;display:flex}
        .cd-search .ic svg{width:19px;height:19px}
        .cd-search input{height:54px;font-size:17px;padding:0 16px 0 46px;border-width:1.5px;width:100%}
        .cd-search input:focus{border-color:var(--brand,#1f56a3);box-shadow:0 0 0 4px rgba(31,86,163,.12)}
        .cd-hint{font-size:12.5px;color:var(--muted);margin:10px 2px 0}
        .cd-list{margin-top:18px;display:flex;flex-direction:column;gap:16px}
        .cd-card{border:1px solid var(--line);border-radius:13px;overflow:hidden;box-shadow:var(--sh-sm);background:var(--panel)}
        .cd-top{display:flex;align-items:flex-start;gap:12px;padding:15px 18px;background:linear-gradient(0deg,var(--panel-2),var(--panel));border-bottom:1px solid var(--line);flex-wrap:wrap}
        .cd-top .nm{font-size:17px;font-weight:800;color:var(--ink);line-height:1.35}
        .cd-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
        .cd-tag{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:20px;background:var(--panel-2);color:var(--ink-2);border:1px solid var(--line)}
        .cd-tag.buy{background:var(--ok-bg);color:var(--ok);border-color:transparent}
        .cd-tag.new{background:var(--warn-bg);color:var(--warn);border-color:transparent}
        .cd-sp{flex:1}
        .cd-kpis{display:flex;gap:22px;flex-wrap:wrap;text-align:right}
        .cd-kpi .k{font-size:11px;color:var(--muted);font-weight:700}
        .cd-kpi .v{font-size:16px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
        .cd-kpi .v.won{color:var(--red)}
        .cd-info{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-bottom:1px solid var(--line)}
        @media(max-width:640px){.cd-info{grid-template-columns:1fr 1fr}}
        .cd-info .cell{padding:11px 16px;border-top:1px solid var(--line)}
        .cd-info .cell+.cell{border-left:1px solid var(--line)}
        .cd-info .k{font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px}
        .cd-info .v{font-size:13.5px;font-weight:600;color:var(--ink-2);word-break:break-all}
        table.cd-tx{border-collapse:collapse;width:100%;font-size:12.5px}
        table.cd-tx th{background:var(--panel-2);color:var(--ink-2);font-size:11px;font-weight:800;text-align:left;padding:8px 12px;border-bottom:1px solid var(--line-2);white-space:nowrap}
        table.cd-tx td{padding:8px 12px;border-bottom:1px solid var(--line);color:var(--ink-2);vertical-align:top}
        table.cd-tx td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
        table.cd-tx td.wrap{white-space:pre-wrap;word-break:break-word;line-height:1.4}
        .cd-txhd{padding:9px 16px;font-size:12px;font-weight:800;color:var(--muted);background:var(--panel)}
        .cd-empty{padding:44px 20px;text-align:center;color:var(--muted)}
        .cd-empty svg{width:34px;height:34px;opacity:.4;margin-bottom:10px}
        .cd-empty.bad{color:var(--danger)}
      </style>
      <div class="mhead pad"><div class="mhead-row">
        <div><div class="tt">고객 정보 검색</div><div class="ds">상담 중 <b>거래처명·연락처</b>로 고객DB(거래 이력·구매현황)를 조회합니다. 조회 전용입니다.</div></div>
      </div></div>
      <div class="mbody wide"><div class="cd-wrap">
        <div class="cd-search">
          <span class="ic">${icon('search')}</span>
          <input id="cdQ" type="search" placeholder="거래처명 또는 연락처 입력 후 Enter (예: 나주고, 010-1234)" autocomplete="off">
        </div>
        <div class="cd-hint" id="cdHint">거래처명 일부 또는 연락처(끝 4자리 이상)로 검색하세요.</div>
        <div class="cd-list" id="cdList"></div>
      </div></div>`;
      const q=root.querySelector('#cdQ'), hint=root.querySelector('#cdHint'), list=root.querySelector('#cdList');

      function card(c){
        const isNew=!c.inMaster;
        const status=c.status||(c.cnt>0?'구매':'견적/미구매');
        const info=[
          ['담당자', c.manager||'—'], ['연락처', c.phone||'—'], ['이메일', c.email||'—'],
          ['타겟', c.target||'—'], ['최초구매일', c.first||'—'], ['주소', c.addr||'—'],
        ];
        const txAll=c.txns||[]; const tx=txAll.slice(0,40);
        return `<div class="cd-card">
          <div class="cd-top">
            <div><div class="nm">${esc(c.name)}</div>
              <div class="cd-tags">
                <span class="cd-tag ${c.cnt>0?'buy':''}">${esc(status)}</span>
                ${isNew?'<span class="cd-tag new">신규(마스터 미등록)</span>':''}
                ${c.last?`<span class="cd-tag">최근거래 ${esc(c.last)}</span>`:''}
              </div></div>
            <span class="cd-sp"></span>
            <div class="cd-kpis">
              <div class="cd-kpi"><div class="k">구매건수</div><div class="v">${won(c.cnt)}건</div></div>
              <div class="cd-kpi"><div class="k">총구매액</div><div class="v won">${won(c.amount)}원</div></div>
            </div>
          </div>
          <div class="cd-info">${info.map(([k,v])=>`<div class="cell"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
          <div class="cd-txhd">거래 이력 ${txAll.length}건${txAll.length>40?' (최근 40건 표시)':''}</div>
          <div style="overflow:auto"><table class="cd-tx">
            <thead><tr><th>날짜</th><th>구분</th><th>품목/내용</th><th style="text-align:right">금액</th><th>담당자</th><th>메모</th></tr></thead>
            <tbody>${tx.length?tx.map(t=>`<tr>
              <td style="white-space:nowrap">${esc(t.date||'')}</td>
              <td>${gBadge(t.gubun)}</td>
              <td class="wrap" style="min-width:220px">${esc(t.item||'')}</td>
              <td class="num">${won(parseAmt(t.amount))}원</td>
              <td style="white-space:nowrap">${esc(t.manager||'')}</td>
              <td class="wrap" style="min-width:120px;color:var(--muted)">${esc(t.memo||'')}</td>
            </tr>`).join(''):`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">거래 이력 없음</td></tr>`}</tbody>
          </table></div>
        </div>`;
      }

      async function search(){
        const term=q.value.trim(); if(!term){ list.innerHTML=''; hint.textContent='거래처명 일부 또는 연락처(끝 4자리 이상)로 검색하세요.'; return; }
        if(busy||term===last) return;
        const url=custDbUrl();
        if(!url){ list.innerHTML=`<div class="cd-empty bad">${icon('alert')}<div>고객DB 연동 URL이 설정되지 않았습니다.<br><span style="font-size:12.5px">[입점사 발주 → 고객DB 연동]에서 웹 앱 URL을 먼저 저장하세요.</span></div></div>`; return; }
        busy=true; last=term; hint.textContent='검색 중…'; list.innerHTML=`<div class="cd-empty">${icon('search')}<div>검색 중…</div></div>`;
        try{
          const sep=url.indexOf('?')>=0?'&':'?';
          const res=await fetch(url+sep+'q='+encodeURIComponent(term)+'&limit=20',{method:'GET'});
          if(!res.ok) throw new Error('HTTP '+res.status);
          const d=await res.json();
          if(!d||d.ok===false) throw new Error((d&&d.error)||'조회 실패');
          const cs=d.customers||[];
          hint.textContent=cs.length?`"${term}" · ${d.total||cs.length}곳 검색됨${(d.total||0)>cs.length?` (상위 ${cs.length}곳 표시)`:''}`:`"${term}" 검색 결과 없음`;
          list.innerHTML=cs.length?cs.map(card).join(''):`<div class="cd-empty">${icon('search')}<div>"${esc(term)}"에 해당하는 고객DB 이력이 없습니다.</div></div>`;
        }catch(err){
          const cors=/failed to fetch|networkerror|load failed|cors/i.test(err.message||'');
          list.innerHTML=`<div class="cd-empty bad">${icon('alert')}<div>조회에 실패했습니다. ${esc(err.message||'')}${cors?'<br><span style="font-size:12px">고객DB Apps Script를 최신 코드로 재배포(액세스: 모든 사용자)했는지 확인하세요.</span>':''}</div></div>`;
          hint.textContent='';
        }finally{
          busy=false;
          // 검색 중 입력이 더 들어왔으면(최신어≠직전 검색어) 최신어로 재검색 — 오래된 결과가 남는 경쟁조건 방지
          const cur=q.value.trim();
          if(cur && cur!==last) search();
        }
      }
      q.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); last=''; search(); } });
      let t=null; q.addEventListener('input',()=>{ clearTimeout(t); t=setTimeout(()=>{ if(q.value.trim().length>=2) search(); },500); });
      setTimeout(()=>q.focus(),50);
    }
  };
})();
