/* ===========================================================================
   HR · 경리(사내 지원) — 요구사항 명세서 4-9 ~ 4-12
     hr.legal    법정의무교육 (5종 · 개인별 이수 매트릭스 · 이수요청 → 승인)
     hr.docreq   서류 발급 신청 (재직/경력/급여명세서/원천징수)
     hr.welfare  팀 복리비 (팀 한도·카드 전표 · 개인 법인카드 한도)
     hr.supply   소모품 관리 (원클릭 요청 · 요청 현황 · 연도별 지출)
   한 묶음 안에 여러 종류를 담을 때는 kind 로 구분한다(저장 버킷을 늘리지 않기 위함).
   =========================================================================== */
(function(){
  const TEAMS=[{k:'edutech',n:'에듀테크 사업팀'},{k:'aiot',n:'AIoT 교육플랫폼 사업팀'},{k:'pet',n:'펫테크 사업팀'}];
  const teamName=k=>{ const t=TEAMS.find(x=>x.k===k); return t?t.n:(k||'미지정'); };
  const PER_HEAD=50000;                       // 복리비 1인당 월 한도
  const thisYear=()=>String(new Date().getFullYear());
  const thisMonth=()=>new Date().toISOString().slice(0,7);
  const yearOf=s=>String(s||'').slice(0,4);
  const monthOf=s=>String(s||'').slice(0,7);
  const badge=(v,c)=>`<span class="he-st" style="color:${c[0]};background:${c[1]}">${esc(v)}</span>`;
  const num=v=>Number(v)||0;

  /* ─────────────────── 4-9 법정의무교육 ─────────────────── */
  const LEGAL_SEED=[
    ['산업안전보건교육','분기 1회(정기)'],['성희롱예방교육','연 1회'],['개인정보보호교육','연 1회'],
    ['장애인인식개선교육','연 1회'],['직장내괴롭힘예방교육','연 1회'],
  ];
  const L_ST={ '미이수':['#8a8f98','#eef0f3'], '요청':['#b4530a','#fff4e6'], '이수':['#12886a','#e6f7f0'] };

  HR.page('hr.legal','법정의무교육','법정의무교육 5종의 개인별 이수 현황입니다. 직원이 시청 후 이수를 요청하면 승인 처리합니다.',
  async function(host, s){
    HR.loading(host,s);
    const d=await HR.loadMany(['legal','staff'],s); if(!d||!host.isConnected) return;
    let year=thisYear(), editing=null;
    const draw=()=>{
      const courses=d.legal.filter(x=>x.kind==='course').sort((a,b)=>String(a.ord||'').localeCompare(String(b.ord||'')));
      const recs=d.legal.filter(x=>x.kind==='record' && x.year===year);
      const staff=d.staff.slice().sort((a,b)=>
        (TEAMS.findIndex(t=>t.k===a.team)-TEAMS.findIndex(t=>t.k===b.team))||String(a.name).localeCompare(String(b.name),'ko'));
      const stOf=(sid,cid)=>{ const r=recs.find(x=>x.staffId===sid&&x.courseId===cid); return r?(r.status||'미이수'):'미이수'; };
      const need=staff.length*courses.length;
      const donen=recs.filter(x=>x.status==='이수').length;
      const reqn=recs.filter(x=>x.status==='요청').length;
      const rate=need?Math.round(donen/need*100):0;
      HR.shell(host,s,`
        <div class="he-kpi">
          <div class="he-k"><div class="v">${rate}<small>%</small></div><div class="l">${esc(year)}년 이수율 · ${donen}/${need}건</div>
            <div class="he-bw"><div class="he-bb ${rate<50?'warn':''}" style="width:${Math.min(100,rate)}%"></div></div></div>
          <div class="he-k"><div class="v">${courses.length}<small>종</small></div><div class="l">등록된 교육 과정</div></div>
          <div class="he-k"><div class="v" style="${reqn?'color:var(--warn)':''}">${reqn}<small>건</small></div><div class="l">승인 대기(이수 요청)</div></div>
        </div>
        <div class="he-bar">
          <select id="lgYear">${[...new Set([thisYear(),String(Number(thisYear())-1),year])].sort().reverse().map(y=>`<option ${y===year?'selected':''}>${esc(y)}</option>`).join('')}</select>
          ${d.can_legal?`<button class="btn pri sm" id="lgAdd">${icon('plus')||''}과정 추가</button>`:''}
          ${(d.can_legal&&!courses.length)?`<button class="btn sm" id="lgSeed">${icon('upload')||''}법정 5종 한 번에 넣기</button>`:''}
          <span class="he-cnt">대상 ${staff.length}명</span>
        </div>
        ${d.can_legal?`<div class="he-f" id="lgForm" hidden>
          <div><label>교육명</label><input id="lgName" placeholder="예: 성희롱예방교육"></div>
          <div><label>주기</label><input id="lgCycle" placeholder="예: 연 1회"></div>
          <div class="wide"><label>영상 링크(선택) — 서버·드라이브에 올린 주소</label><input id="lgUrl" placeholder="https://"></div>
          <div class="a"><button class="btn pri sm" id="lgSave">${icon('check')||''}저장</button><button class="btn ghost sm" id="lgCancel">취소</button></div>
        </div>`:''}
        ${courses.length?`
          <div class="he-sec">${icon('clipboard')||''} 교육 과정 <span class="muted">${courses.length}종</span></div>
          <div class="he-wrap" style="margin-bottom:16px"><table class="he-tbl">
            <thead><tr><th>교육명</th><th style="width:140px">주기</th><th style="width:90px" class="mid">영상</th>${d.can_legal?'<th style="width:104px" class="act"></th>':''}</tr></thead>
            <tbody>${courses.map(c=>`<tr>
              <td><b>${esc(c.name||'')}</b></td><td>${esc(c.cycle||'')||'<span class="muted">-</span>'}</td>
              <td class="mid">${c.url?`<a href="${esc(c.url)}" target="_blank" rel="noopener">열기 ↗</a>`:'<span class="muted">-</span>'}</td>
              ${d.can_legal?`<td class="act"><button class="btn ghost sm" data-ce="${esc(c.id)}">수정</button><button class="btn ghost sm" data-cd="${esc(c.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
            </tr>`).join('')}</tbody></table></div>

          <div class="he-sec">${icon('users')||''} 개인별 이수 현황 <span class="muted">칸을 눌러 이수/미이수를 바꿉니다</span></div>
          ${staff.length?`<div class="he-wrap"><table class="he-tbl">
            <thead><tr><th style="width:86px">직원</th><th style="width:130px">소속팀</th>
              ${courses.map(c=>`<th class="mid" style="width:104px">${esc((c.name||'').replace('교육',''))}</th>`).join('')}</tr></thead>
            <tbody>${staff.map(p=>`<tr>
              <td><b>${esc(p.name||'')}</b></td><td style="white-space:nowrap">${esc(teamName(p.team))}</td>
              ${courses.map(c=>{ const v=stOf(p.id,c.id); const col=L_ST[v]||L_ST['미이수'];
                return `<td class="mid">${d.can_legal
                  ?`<button class="he-st" style="border:0;cursor:pointer;color:${col[0]};background:${col[1]}" data-cell="${esc(p.id)}|${esc(c.id)}" title="눌러서 상태 변경">${esc(v)}</button>`
                  :badge(v,col)}</td>`; }).join('')}
            </tr>`).join('')}</tbody></table></div>`
          :`<div class="he-empty">직원 마스터가 비어 있습니다. [홈·분기 현황]에서 명단을 먼저 등록하세요.</div>`}`
        :`<div class="he-empty">${icon('clipboard')||''}<div style="margin:8px 0 4px;font-weight:700;color:var(--ink)">등록된 교육 과정이 없습니다</div>
          <div style="font-size:12.5px">법정의무교육 5종을 한 번에 넣고 시작할 수 있습니다.</div></div>`}`);
      const $=x=>host.querySelector(x);
      $('#lgYear').onchange=e=>{ year=e.target.value; draw(); };
      if(!d.can_legal) return;
      const form=$('#lgForm');
      const open=c=>{ editing=c||null; form.hidden=false; $('#lgName').value=c?c.name||'':''; $('#lgCycle').value=c?c.cycle||'':''; $('#lgUrl').value=c?c.url||'':''; $('#lgName').focus(); };
      const add=$('#lgAdd'); if(add) add.onclick=()=>open(null);
      $('#lgCancel').onclick=()=>{ form.hidden=true; editing=null; };
      $('#lgSave').onclick=async()=>{
        const name=($('#lgName').value||'').trim(); if(!name){ toast('교육명을 입력하세요'); return; }
        const item={ id:(editing&&editing.id)||uuid(), kind:'course', shared:true, name, cycle:($('#lgCycle').value||'').trim(),
          url:($('#lgUrl').value||'').trim(), ord:(editing&&editing.ord)||String(Date.now()) };
        $('#lgSave').disabled=true; const r=await HR.api('put',{ name:'legal', item }); $('#lgSave').disabled=false;
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); return; }
        d.legal=editing?d.legal.map(x=>x.id===item.id?item:x):d.legal.concat([item]);
        toast(editing?'수정했습니다':'추가했습니다'); form.hidden=true; editing=null; draw();
      };
      const seed=$('#lgSeed');
      if(seed) seed.onclick=async()=>{
        if(!confirm('법정의무교육 5종을 한 번에 등록할까요?')) return;
        seed.disabled=true;
        for(let i=0;i<LEGAL_SEED.length;i++){
          const item={ id:uuid(), kind:'course', shared:true, name:LEGAL_SEED[i][0], cycle:LEGAL_SEED[i][1], url:'', ord:String(i).padStart(2,'0') };
          const r=await HR.api('put',{ name:'legal', item });
          if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); break; }
          d.legal.push(item);
        }
        toast('5종을 등록했습니다'); draw();
      };
      host.querySelectorAll('[data-ce]').forEach(b=>b.onclick=()=>{ open(d.legal.find(x=>x.id===b.dataset.ce)); form.scrollIntoView({behavior:'smooth',block:'center'}); });
      host.querySelectorAll('[data-cd]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 과정을 삭제할까요? (이수 기록은 남습니다)')) return;
        const r=await HR.api('del',{ name:'legal', id:b.dataset.cd });
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.legal=d.legal.filter(x=>x.id!==b.dataset.cd); toast('삭제했습니다'); draw();
      });
      /* 매트릭스 칸: 미이수 → 이수 → 미이수 (요청 상태에서 누르면 승인=이수) */
      host.querySelectorAll('[data-cell]').forEach(b=>b.onclick=async()=>{
        const [sid,cid]=b.dataset.cell.split('|');
        const p=d.staff.find(x=>x.id===sid);
        const cur=d.legal.find(x=>x.kind==='record'&&x.staffId===sid&&x.courseId===cid&&x.year===year);
        const next=(cur&&cur.status==='이수')?'미이수':'이수';
        const item={ id:(cur&&cur.id)||uuid(), kind:'record', year, staffId:sid, staffName:(p&&p.name)||'',
          staffLogin:(p&&p.loginId)||'', courseId:cid, status:next,
          reqAt:(cur&&cur.reqAt)||'', doneAt:next==='이수'?nowISO():'' };
        b.disabled=true; const r=await HR.api('put',{ name:'legal', item });
        if(r.relock){ s.relock(); return; } if(!r.ok){ b.disabled=false; toast(r.error||'변경 실패'); return; }
        d.legal=cur?d.legal.map(x=>x.id===item.id?item:x):d.legal.concat([item]);
        draw();
      });
    };
    draw();
  });

  /* ─────────────────── 4-10 서류 발급 신청 ─────────────────── */
  const DOCS=['재직증명서','경력증명서','급여명세서','원천징수영수증'];
  const D_ST={ '접수':['#b4530a','#fff4e6'], '발급완료':['#12886a','#e6f7f0'] };

  HR.page('hr.docreq','서류 발급 신청','필요한 증명서를 신청하고 처리 상태를 확인합니다.',
  async function(host, s){
    HR.loading(host,s);
    const d=await HR.loadMany(['docreq'],s); if(!d||!host.isConnected) return;
    const me=s.me||{}, mineOnly=d.self_docreq;      // 일반 직원 = 본인 신청분만
    let fSt='';
    const draw=()=>{
      const list=d.docreq.slice().filter(x=>!fSt||x.status===fSt)
        .sort((a,b)=>String(b.at).localeCompare(String(a.at)));
      const open=d.docreq.filter(x=>x.status!=='발급완료').length;
      HR.shell(host,s,`
        ${mineOnly?'':`<div class="he-kpi">
          <div class="he-k"><div class="v">${d.docreq.length}<small>건</small></div><div class="l">전체 신청</div></div>
          <div class="he-k"><div class="v" style="${open?'color:var(--warn)':''}">${open}<small>건</small></div><div class="l">처리 대기(접수)</div></div>
        </div>`}
        <div class="he-bar">
          <select id="dcSt"><option value="">상태 전체</option>${['접수','발급완료'].map(v=>`<option ${v===fSt?'selected':''}>${esc(v)}</option>`).join('')}</select>
          ${d.can_docreq?`<button class="btn pri sm" id="dcAdd">${icon('plus')||''}서류 신청</button>`:''}
          <span class="he-cnt">${list.length}건${mineOnly?' · 본인 신청분':''}</span>
        </div>
        ${d.can_docreq?`<div class="he-f" id="dcForm" hidden>
          <div><label>서류 종류</label><select id="dcType">${DOCS.map(v=>`<option>${esc(v)}</option>`).join('')}</select></div>
          <div><label>부수</label><input id="dcCnt" type="number" min="1" value="1"></div>
          <div><label>제출처·용도</label><input id="dcUse" placeholder="예: 은행 제출"></div>
          <div class="wide"><label>요청사항(선택)</label><input id="dcNote" placeholder="예: 주민번호 뒷자리 마스킹"></div>
          <div class="a"><button class="btn pri sm" id="dcSave">${icon('check')||''}신청</button><button class="btn ghost sm" id="dcCancel">취소</button></div>
        </div>`:''}
        ${list.length?`<div class="he-wrap"><table class="he-tbl">
          <thead><tr>${mineOnly?'':'<th style="width:86px">신청자</th>'}<th style="width:130px">서류</th>
            <th style="width:60px" class="mid">부수</th><th>제출처·용도</th><th>요청사항</th>
            <th style="width:116px">상태</th><th style="width:96px">신청일</th>${d.can_docreq?'<th style="width:56px" class="act"></th>':''}</tr></thead>
          <tbody>${list.map(x=>`<tr>
            ${mineOnly?'':`<td><b>${esc(x.by||'')}</b></td>`}
            <td>${esc(x.type||'')}</td><td class="mid">${num(x.count)||1}</td>
            <td>${esc(x.use||'')||'<span class="muted">-</span>'}</td>
            <td>${esc(x.note||'')||'<span class="muted">-</span>'}</td>
            <td>${(!mineOnly&&d.can_docreq)?`<select data-st="${esc(x.id)}" style="width:100%;height:30px;font-size:12px">${['접수','발급완료'].map(v=>`<option ${v===x.status?'selected':''}>${esc(v)}</option>`).join('')}</select>`:badge(x.status||'접수',D_ST[x.status]||D_ST['접수'])}</td>
            <td>${esc(String(x.at||'').slice(0,10))}</td>
            ${d.can_docreq?`<td class="act"><button class="btn ghost sm" data-d="${esc(x.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
          </tr>`).join('')}</tbody></table></div>`
        :`<div class="he-empty">${icon('inbox')||''}<div style="margin-top:8px">신청 내역이 없습니다.${d.can_docreq?' [서류 신청]으로 접수하세요.':''}</div></div>`}`);
      const $=x=>host.querySelector(x);
      $('#dcSt').onchange=e=>{ fSt=e.target.value; draw(); };
      if(!d.can_docreq) return;
      const form=$('#dcForm');
      $('#dcAdd').onclick=()=>{ form.hidden=false; $('#dcUse').focus(); };
      $('#dcCancel').onclick=()=>{ form.hidden=true; };
      $('#dcSave').onclick=async()=>{
        const item={ id:uuid(), type:$('#dcType').value, count:num($('#dcCnt').value)||1,
          use:($('#dcUse').value||'').trim(), note:($('#dcNote').value||'').trim(),
          by:me.name||'', byId:me.loginId||'', status:'접수', at:nowISO() };
        $('#dcSave').disabled=true; const r=await HR.api('put',{ name:'docreq', item }); $('#dcSave').disabled=false;
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'신청 실패'); return; }
        d.docreq.push(item); toast('신청했습니다'); form.hidden=true; draw();
      };
      host.querySelectorAll('[data-st]').forEach(sel=>sel.onchange=async()=>{
        const x=d.docreq.find(y=>y.id===sel.dataset.st); if(!x) return;
        const up={ ...x, status:sel.value, doneAt:sel.value==='발급완료'?nowISO():'' };
        const r=await HR.api('put',{ name:'docreq', item:up });
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'변경 실패'); draw(); return; }
        d.docreq=d.docreq.map(y=>y.id===x.id?up:y); toast(`'${sel.value}'로 변경했습니다`); draw();
      });
      host.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{
        if(!confirm('이 신청을 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'docreq', id:b.dataset.d });
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.docreq=d.docreq.filter(y=>y.id!==b.dataset.d); toast('삭제했습니다'); draw();
      });
    };
    draw();
  }, ['hr.docreq','hr.docme']);

  /* ─────────────────── 4-11 팀 복리비 ─────────────────── */
  HR.page('hr.welfare','팀 복리비','팀별 회식카드 한도와 사용액, 개인 명의 법인카드 한도를 관리합니다.',
  async function(host, s){
    HR.loading(host,s);
    const d=await HR.loadMany(['welfare','staff'],s); if(!d||!host.isConnected) return;
    let month=thisMonth(), tab='team', editing=null;
    const cfgOf=k=>d.welfare.find(x=>x.kind==='team'&&x.team===k);
    const headOf=k=>{ const c=cfgOf(k); if(c&&c.headcount!=null&&c.headcount!=='') return num(c.headcount);
      return d.staff.filter(p=>p.team===k).length; };        // 조정값이 없으면 직원 마스터 인원
    const draw=()=>{
      const slips=d.welfare.filter(x=>x.kind==='slip'&&monthOf(x.date)===month);
      const cards=d.welfare.filter(x=>x.kind==='card');
      const usedTeam=k=>slips.filter(x=>x.team===k).reduce((t,x)=>t+num(x.amount),0);
      const usedCard=n=>slips.filter(x=>(x.cardName||'')===n).reduce((t,x)=>t+num(x.amount),0);
      HR.shell(host,s,`
        <div class="he-bar">
          <label style="font-size:12px;color:var(--muted);font-weight:700">기준 월</label>
          <input type="month" id="wfMonth" value="${esc(month)}">
          <span class="he-cnt">전표 ${slips.length}건 · 합계 ${fmtNum(slips.reduce((t,x)=>t+num(x.amount),0))}원</span>
        </div>
        <div class="he-kpi">
          ${TEAMS.map(t=>{ const h=headOf(t.k), lim=h*PER_HEAD, u=usedTeam(t.k), left=lim-u, rate=lim?Math.round(u/lim*100):0;
            return `<div class="he-k"><div class="v">${fmtNum(Math.max(0,left))}<small>원</small></div>
              <div class="l">${esc(t.n)} 잔여 · 한도 ${fmtNum(lim)}원(${h}명) · 사용 ${fmtNum(u)}원</div>
              <div class="he-bw"><div class="he-bb ${rate>100?'over':rate>80?'warn':''}" style="width:${Math.min(100,rate)}%"></div></div></div>`; }).join('')}
        </div>
        <div class="he-bar">
          ${[['team','카드 전표'],['card','개인 법인카드'],['cfg','팀 인원 설정']].map(([k,n])=>`<button class="he-chip${tab===k?' on':''}" data-t="${k}">${n}</button>`).join('')}
          ${(d.can_welfare&&tab!=='cfg')?`<button class="btn pri sm" id="wfAdd" style="margin-left:8px">${icon('plus')||''}${tab==='team'?'전표 입력':'카드 등록'}</button>`:''}
        </div>

        ${tab==='team'?`
          ${d.can_welfare?`<div class="he-f" id="wfForm" hidden>
            <div><label>사용일</label><input type="date" id="wfDate" value="${esc(todayStr())}"></div>
            <div><label>팀</label><select id="wfTeam">${TEAMS.map(t=>`<option value="${t.k}">${esc(t.n)}</option>`).join('')}</select></div>
            <div><label>사용 카드(선택)</label><select id="wfCard"><option value="">팀 회식카드</option>${cards.map(c=>`<option>${esc(c.name)}</option>`).join('')}</select></div>
            <div><label>금액(원)</label><input id="wfAmt" type="number" min="0" step="1000"></div>
            <div><label>사용처</label><input id="wfPlace" placeholder="예: OO식당"></div>
            <div class="wide"><label>비고(선택)</label><input id="wfNote" placeholder="예: 분기 회식"></div>
            <div class="a"><button class="btn pri sm" id="wfSave">${icon('check')||''}저장</button><button class="btn ghost sm" id="wfCancel">취소</button></div>
          </div>`:''}
          ${slips.length?`<div class="he-wrap"><table class="he-tbl">
            <thead><tr><th style="width:96px">사용일</th><th style="width:150px">팀</th><th style="width:130px">카드</th>
              <th>사용처</th><th>비고</th><th style="width:100px" class="num">금액</th>${d.can_welfare?'<th style="width:56px" class="act"></th>':''}</tr></thead>
            <tbody>${slips.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(x=>`<tr>
              <td>${esc(x.date||'')}</td><td style="white-space:nowrap">${esc(teamName(x.team))}</td>
              <td>${esc(x.cardName||'')||'<span class="muted">팀 회식카드</span>'}</td>
              <td>${esc(x.place||'')||'<span class="muted">-</span>'}</td>
              <td>${esc(x.note||'')||'<span class="muted">-</span>'}</td>
              <td class="num">${fmtNum(x.amount)}원</td>
              ${d.can_welfare?`<td class="act"><button class="btn ghost sm" data-sd="${esc(x.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
            </tr>`).join('')}</tbody></table></div>`
          :`<div class="he-empty">${esc(month)} 전표가 없습니다.${d.can_welfare?' [전표 입력]으로 추가하세요.':''}</div>`}`
        :''}

        ${tab==='card'?`
          ${d.can_welfare?`<div class="he-f" id="wfCForm" hidden>
            <div><label>사용자</label><input id="wcName" placeholder="예: 최창조"></div>
            <div><label>구분</label><input id="wcRole" placeholder="예: 팀장 / 이사"></div>
            <div><label>월 한도(원)</label><input id="wcLimit" type="number" min="0" step="10000"></div>
            <div><label>이월</label><select id="wcRoll"><option value="">불가</option><option value="1">가능</option></select></div>
            <div class="wide"><label>비고</label><input id="wcNote" placeholder="예: 26년 연한도 모두 소진"></div>
            <div class="a"><button class="btn pri sm" id="wcSave">${icon('check')||''}저장</button><button class="btn ghost sm" id="wcCancel">취소</button></div>
          </div>`:''}
          ${cards.length?`<div class="he-wrap"><table class="he-tbl">
            <thead><tr><th style="width:96px">사용자</th><th style="width:100px">구분</th>
              <th style="width:110px" class="num">월 한도</th><th style="width:110px" class="num">이번 달 사용</th>
              <th style="width:110px" class="num">잔여</th><th style="width:72px" class="mid">이월</th><th>비고</th>
              ${d.can_welfare?'<th style="width:104px" class="act"></th>':''}</tr></thead>
            <tbody>${cards.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko')).map(c=>{
              const u=usedCard(c.name), left=num(c.limit)-u;
              return `<tr>
                <td><b>${esc(c.name||'')}</b></td><td>${esc(c.role||'')||'<span class="muted">-</span>'}</td>
                <td class="num">${fmtNum(c.limit)}원</td><td class="num">${fmtNum(u)}원</td>
                <td class="num" style="${left<0?'color:var(--danger);font-weight:800':''}">${fmtNum(left)}원</td>
                <td class="mid">${c.rollover?'<span class="he-tag" style="color:#12886a;background:#e6f7f0">가능</span>':'<span class="muted">불가</span>'}</td>
                <td>${esc(c.note||'')||'<span class="muted">-</span>'}</td>
                ${d.can_welfare?`<td class="act"><button class="btn ghost sm" data-ce2="${esc(c.id)}">수정</button><button class="btn ghost sm" data-cd2="${esc(c.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
              </tr>`; }).join('')}</tbody></table></div>`
          :`<div class="he-empty">등록된 개인 법인카드가 없습니다.${d.can_welfare?' [카드 등록]으로 추가하세요.':''}</div>`}`
        :''}

        ${tab==='cfg'?`
          <div class="nx-note" style="font-size:12.5px;margin-bottom:12px">${icon('info')||''}
            한도는 <b>1인당 ${fmtNum(PER_HEAD)}원 × 산정 인원</b>으로 계산합니다.
            비워 두면 <b>직원 마스터의 팀 인원</b>을 그대로 쓰고, 값을 넣으면 그 인원으로 계산합니다(팀장·이사 제외 등).</div>
          <div class="he-wrap"><table class="he-tbl">
            <thead><tr><th style="width:170px">팀</th><th style="width:110px" class="mid">마스터 인원</th>
              <th style="width:130px" class="mid">산정 인원</th><th style="width:120px" class="num">월 한도</th><th>비고</th></tr></thead>
            <tbody>${TEAMS.map(t=>{ const c=cfgOf(t.k), master=d.staff.filter(p=>p.team===t.k).length, h=headOf(t.k);
              return `<tr>
                <td><b>${esc(t.n)}</b></td><td class="mid">${master}명</td>
                <td class="mid">${d.can_welfare?`<input data-hc="${t.k}" type="number" min="0" style="width:72px;height:30px;text-align:center" value="${c&&c.headcount!=null?esc(String(c.headcount)):''}" placeholder="${master}">`:`${h}명`}</td>
                <td class="num">${fmtNum(h*PER_HEAD)}원</td>
                <td>${d.can_welfare?`<input data-tn="${t.k}" style="width:100%;height:30px" value="${esc((c&&c.note)||'')}" placeholder="예: 팀장 제외">`:esc((c&&c.note)||'')}</td>
              </tr>`; }).join('')}</tbody></table></div>
          ${d.can_welfare?`<div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn pri sm" id="wfCfgSave">${icon('check')||''}인원 설정 저장</button></div>`:''}`
        :''}`);
      const $=x=>host.querySelector(x);
      $('#wfMonth').onchange=e=>{ month=e.target.value||thisMonth(); draw(); };
      host.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ tab=b.dataset.t; editing=null; draw(); });
      if(!d.can_welfare) return;
      const add=$('#wfAdd');
      if(add) add.onclick=()=>{ const f=$(tab==='team'?'#wfForm':'#wfCForm'); if(f){ f.hidden=false; f.querySelector('input').focus(); } };

      if(tab==='team'){
        $('#wfCancel').onclick=()=>{ $('#wfForm').hidden=true; };
        $('#wfSave').onclick=async()=>{
          const amount=num($('#wfAmt').value);
          if(!amount){ toast('금액을 입력하세요'); return; }
          const item={ id:uuid(), kind:'slip', date:$('#wfDate').value||todayStr(), team:$('#wfTeam').value,
            cardName:$('#wfCard').value||'', amount, place:($('#wfPlace').value||'').trim(), note:($('#wfNote').value||'').trim() };
          $('#wfSave').disabled=true; const r=await HR.api('put',{ name:'welfare', item }); $('#wfSave').disabled=false;
          if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); return; }
          d.welfare.push(item); toast('전표를 입력했습니다'); $('#wfForm').hidden=true; draw();
        };
        host.querySelectorAll('[data-sd]').forEach(b=>b.onclick=async()=>{
          if(!confirm('이 전표를 삭제할까요?')) return;
          const r=await HR.api('del',{ name:'welfare', id:b.dataset.sd });
          if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'삭제 실패'); return; }
          d.welfare=d.welfare.filter(x=>x.id!==b.dataset.sd); toast('삭제했습니다'); draw();
        });
      }
      if(tab==='card'){
        const f=$('#wfCForm');
        const openC=c=>{ editing=c||null; f.hidden=false; $('#wcName').value=c?c.name||'':''; $('#wcRole').value=c?c.role||'':'';
          $('#wcLimit').value=c?(c.limit||''):''; $('#wcRoll').value=c&&c.rollover?'1':''; $('#wcNote').value=c?c.note||'':''; $('#wcName').focus(); };
        if(add) add.onclick=()=>openC(null);
        $('#wcCancel').onclick=()=>{ f.hidden=true; editing=null; };
        $('#wcSave').onclick=async()=>{
          const name=($('#wcName').value||'').trim(); if(!name){ toast('사용자 이름을 입력하세요'); return; }
          const item={ id:(editing&&editing.id)||uuid(), kind:'card', name, role:($('#wcRole').value||'').trim(),
            limit:num($('#wcLimit').value), rollover:$('#wcRoll').value==='1', note:($('#wcNote').value||'').trim() };
          $('#wcSave').disabled=true; const r=await HR.api('put',{ name:'welfare', item }); $('#wcSave').disabled=false;
          if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); return; }
          d.welfare=editing?d.welfare.map(x=>x.id===item.id?item:x):d.welfare.concat([item]);
          toast(editing?'수정했습니다':'등록했습니다'); f.hidden=true; editing=null; draw();
        };
        host.querySelectorAll('[data-ce2]').forEach(b=>b.onclick=()=>openC(d.welfare.find(x=>x.id===b.dataset.ce2)));
        host.querySelectorAll('[data-cd2]').forEach(b=>b.onclick=async()=>{
          if(!confirm('이 카드 정보를 삭제할까요?')) return;
          const r=await HR.api('del',{ name:'welfare', id:b.dataset.cd2 });
          if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'삭제 실패'); return; }
          d.welfare=d.welfare.filter(x=>x.id!==b.dataset.cd2); toast('삭제했습니다'); draw();
        });
      }
      if(tab==='cfg'){
        $('#wfCfgSave').onclick=async()=>{
          $('#wfCfgSave').disabled=true;
          for(const t of TEAMS){
            const hc=host.querySelector(`[data-hc="${t.k}"]`).value.trim();
            const note=host.querySelector(`[data-tn="${t.k}"]`).value.trim();
            const cur=cfgOf(t.k);
            const item={ id:(cur&&cur.id)||uuid(), kind:'team', team:t.k, headcount:hc===''?null:num(hc), note };
            const r=await HR.api('put',{ name:'welfare', item });
            if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); break; }
            d.welfare=cur?d.welfare.map(x=>x.id===item.id?item:x):d.welfare.concat([item]);
          }
          $('#wfCfgSave').disabled=false; toast('인원 설정을 저장했습니다'); draw();
        };
      }
    };
    draw();
  });

  /* ─────────────────── 4-12 소모품 관리 ─────────────────── */
  const S_ST={ '접수':['#b4530a','#fff4e6'], '처리완료':['#12886a','#e6f7f0'] };
  const SUPPLY_SEED=['A4용지','토너','볼펜','포스트잇','물티슈','커피믹스','건전지','테이프'];

  HR.page('hr.supply','소모품 관리','자주 쓰는 소모품을 눌러 바로 요청하고, 연도별 지출을 기록합니다.',
  async function(host, s){
    HR.loading(host,s);
    const d=await HR.loadMany(['supply'],s); if(!d||!host.isConnected) return;
    const me=s.me||{}, mineOnly=d.self_supply;
    let tab='req', year=thisYear();
    const draw=()=>{
      const items=d.supply.filter(x=>x.kind==='item');
      const reqs=d.supply.filter(x=>x.kind==='req').sort((a,b)=>String(b.at).localeCompare(String(a.at)));
      const spends=d.supply.filter(x=>x.kind==='spend'&&yearOf(x.date)===year).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      const openN=reqs.filter(x=>x.status!=='처리완료').length;
      const spendSum=spends.reduce((t,x)=>t+num(x.amount),0);
      HR.shell(host,s,`
        <div class="he-bar">
          ${[['req','요청 현황'],['spend','연도별 지출']].map(([k,n])=>`<button class="he-chip${tab===k?' on':''}" data-t="${k}">${n}</button>`).join('')}
          ${tab==='spend'?`<select id="spYear" style="margin-left:8px">${[...new Set([thisYear(),String(Number(thisYear())-1),year])].sort().reverse().map(y=>`<option ${y===year?'selected':''}>${esc(y)}</option>`).join('')}</select>`:''}
          <span class="he-cnt">${tab==='req'?`요청 ${reqs.length}건 · 대기 ${openN}건`:`${esc(year)}년 지출 ${fmtNum(spendSum)}원`}</span>
        </div>

        ${tab==='req'?`
          ${d.can_supply?`<div class="he-sec">${icon('plus')||''} 자주 쓰는 소모품 <span class="muted">눌러서 바로 요청</span>
              ${!items.length?`<button class="btn sm" id="spSeed">${icon('upload')||''}기본 품목 넣기</button>`:`<button class="btn ghost sm" id="spItemAdd">품목 추가</button>`}</div>
            <div class="he-bar" style="margin-bottom:14px">
              ${items.map(i=>`<button class="he-chip" data-quick="${esc(i.name)}">${esc(i.name)}</button>`).join('')||'<span class="muted" style="font-size:12.5px">등록된 품목이 없습니다.</span>'}
            </div>
            <div class="he-f" id="spForm">
              <div><label>품목</label><input id="spName" placeholder="직접 입력"></div>
              <div><label>수량</label><input id="spQty" type="number" min="1" value="1"></div>
              <div class="wide"><label>요청 사유(선택)</label><input id="spNote" placeholder="예: 재고 소진"></div>
              <div class="a"><button class="btn pri sm" id="spSave">${icon('check')||''}요청</button></div>
            </div>`:''}
          ${reqs.length?`<div class="he-wrap"><table class="he-tbl">
            <thead><tr>${mineOnly?'':'<th style="width:86px">요청자</th>'}<th style="width:150px">품목</th>
              <th style="width:60px" class="mid">수량</th><th>사유</th><th style="width:116px">상태</th>
              <th style="width:96px">요청일</th>${d.can_supply?'<th style="width:56px" class="act"></th>':''}</tr></thead>
            <tbody>${reqs.map(x=>`<tr>
              ${mineOnly?'':`<td><b>${esc(x.by||'')}</b></td>`}
              <td>${esc(x.name||'')}</td><td class="mid">${num(x.qty)||1}</td>
              <td>${esc(x.note||'')||'<span class="muted">-</span>'}</td>
              <td>${(!mineOnly&&d.can_supply)?`<select data-st="${esc(x.id)}" style="width:100%;height:30px;font-size:12px">${['접수','처리완료'].map(v=>`<option ${v===x.status?'selected':''}>${esc(v)}</option>`).join('')}</select>`:badge(x.status||'접수',S_ST[x.status]||S_ST['접수'])}</td>
              <td>${esc(String(x.at||'').slice(0,10))}</td>
              ${d.can_supply?`<td class="act"><button class="btn ghost sm" data-rd="${esc(x.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
            </tr>`).join('')}</tbody></table></div>`
          :`<div class="he-empty">요청 내역이 없습니다.</div>`}`
        :`
          ${d.can_supply?`<div class="he-f" id="spSpendForm">
            <div><label>지출일</label><input type="date" id="sdDate" value="${esc(todayStr())}"></div>
            <div><label>품목</label><input id="sdItem" placeholder="예: A4용지 5박스"></div>
            <div><label>금액(원)</label><input id="sdAmt" type="number" min="0" step="1000"></div>
            <div><label>구매처</label><input id="sdVendor" placeholder="예: 오피스디포"></div>
            <div class="a"><button class="btn pri sm" id="sdSave">${icon('check')||''}지출 기록</button></div>
          </div>`:''}
          ${spends.length?`<div class="he-wrap"><table class="he-tbl">
            <thead><tr><th style="width:96px">지출일</th><th>품목</th><th style="width:150px">구매처</th>
              <th style="width:110px" class="num">금액</th>${d.can_supply?'<th style="width:56px" class="act"></th>':''}</tr></thead>
            <tbody>${spends.map(x=>`<tr>
              <td>${esc(x.date||'')}</td><td>${esc(x.item||'')}</td>
              <td>${esc(x.vendor||'')||'<span class="muted">-</span>'}</td>
              <td class="num">${fmtNum(x.amount)}원</td>
              ${d.can_supply?`<td class="act"><button class="btn ghost sm" data-dd="${esc(x.id)}" style="color:var(--danger)">${icon('trash')||'삭제'}</button></td>`:''}
            </tr>`).join('')}
            <tr><td colspan="3" style="text-align:right;font-weight:800">${esc(year)}년 합계</td>
              <td class="num" style="font-weight:800">${fmtNum(spendSum)}원</td>${d.can_supply?'<td></td>':''}</tr></tbody></table></div>`
          :`<div class="he-empty">${esc(year)}년 지출 기록이 없습니다.</div>`}`}`);
      const $=x=>host.querySelector(x);
      host.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ tab=b.dataset.t; draw(); });
      const yr=$('#spYear'); if(yr) yr.onchange=e=>{ year=e.target.value; draw(); };
      if(!d.can_supply) return;

      const seed=$('#spSeed');
      if(seed) seed.onclick=async()=>{
        seed.disabled=true;
        for(const n of SUPPLY_SEED){
          const item={ id:uuid(), kind:'item', shared:true, name:n };
          const r=await HR.api('put',{ name:'supply', item });
          if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); break; }
          d.supply.push(item);
        }
        toast('기본 품목을 등록했습니다'); draw();
      };
      const itemAdd=$('#spItemAdd');
      if(itemAdd) itemAdd.onclick=async()=>{
        const n=(prompt('자주 쓰는 품목 이름','')||'').trim(); if(!n) return;
        const item={ id:uuid(), kind:'item', shared:true, name:n };
        const r=await HR.api('put',{ name:'supply', item });
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); return; }
        d.supply.push(item); toast('품목을 추가했습니다'); draw();
      };
      const sendReq=async(name,qty,note)=>{
        const item={ id:uuid(), kind:'req', name, qty:qty||1, note:note||'',
          by:me.name||'', byId:me.loginId||'', status:'접수', at:nowISO() };
        const r=await HR.api('put',{ name:'supply', item });
        if(r.relock){ s.relock(); return false; } if(!r.ok){ toast(r.error||'요청 실패'); return false; }
        d.supply.push(item); return true;
      };
      host.querySelectorAll('[data-quick]').forEach(b=>b.onclick=async()=>{
        b.disabled=true; if(await sendReq(b.dataset.quick,1,'')){ toast(`'${b.dataset.quick}' 요청했습니다`); draw(); } else b.disabled=false;
      });
      const sv=$('#spSave');
      if(sv) sv.onclick=async()=>{
        const n=($('#spName').value||'').trim(); if(!n){ toast('품목을 입력하세요'); return; }
        sv.disabled=true;
        if(await sendReq(n, num($('#spQty').value), ($('#spNote').value||'').trim())){ toast('요청했습니다'); draw(); } else sv.disabled=false;
      };
      host.querySelectorAll('[data-st]').forEach(sel=>sel.onchange=async()=>{
        const x=d.supply.find(y=>y.id===sel.dataset.st); if(!x) return;
        const up={ ...x, status:sel.value, doneAt:sel.value==='처리완료'?nowISO():'' };
        const r=await HR.api('put',{ name:'supply', item:up });
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'변경 실패'); draw(); return; }
        d.supply=d.supply.map(y=>y.id===x.id?up:y); toast(`'${sel.value}'로 변경했습니다`); draw();
      });
      host.querySelectorAll('[data-rd],[data-dd]').forEach(b=>b.onclick=async()=>{
        const id=b.dataset.rd||b.dataset.dd;
        if(!confirm('이 기록을 삭제할까요?')) return;
        const r=await HR.api('del',{ name:'supply', id });
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'삭제 실패'); return; }
        d.supply=d.supply.filter(y=>y.id!==id); toast('삭제했습니다'); draw();
      });
      const sd=$('#sdSave');
      if(sd) sd.onclick=async()=>{
        const it=($('#sdItem').value||'').trim(), amt=num($('#sdAmt').value);
        if(!it||!amt){ toast('품목과 금액을 입력하세요'); return; }
        const item={ id:uuid(), kind:'spend', date:$('#sdDate').value||todayStr(), item:it, amount:amt, vendor:($('#sdVendor').value||'').trim() };
        sd.disabled=true; const r=await HR.api('put',{ name:'supply', item }); sd.disabled=false;
        if(r.relock){ s.relock(); return; } if(!r.ok){ toast(r.error||'저장 실패'); return; }
        d.supply.push(item); toast('지출을 기록했습니다'); draw();
      };
    };
    draw();
  }, ['hr.supply','hr.supplyme']);
})();
