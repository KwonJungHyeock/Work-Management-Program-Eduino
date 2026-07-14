/* ===========================================================================
   CS · 후불/발주
   - 후불 결제·발주 접수 내역을 팀 공유로 기록 (2026 에듀이노 일일 특이사항 시트 '후불/발주' 항목 기준)
   - 항목: 접수일자·구분·거래처명·이름·연락처·이메일·내용·금액·출고일·할인율·배송주소·메모
   - MD 현황판과 동일한 엔진(window.buildBoard) 재사용 · 서버 시트(cs:postpay) 누적
   - 기간/구분 필터·검색, 행 수정, CSV(관리자만)·삭제(관리자)
   =========================================================================== */
(function(){
  if(typeof window.buildBoard!=='function') return;   // md-boards.js(buildBoard) 로드 후 동작
  window.buildBoard({
    key:'cs.postpay', dept:'cs', sheet:'postpay', title:'후불/발주', icon:'truck',
    desc:'후불 결제·발주 접수 건을 팀 공유로 기록·관리합니다. (구분·금액·출고일로 진행 현황 파악)',
    dateField:'rdate',
    fields:[
      { k:'rdate',    label:'접수일자',  type:'date' },
      { k:'gubun',    label:'구분',      type:'select', options:['발주','견적','후불','결제요청','기타'], req:true },
      { k:'target',   label:'타겟(고객유형)', type:'select', options:CUSTDB_TARGETS },
      { k:'vendor',   label:'거래처명',  type:'text', ph:'학교/기관/업체명' },
      { k:'name',     label:'이름',      type:'text', ph:'담당자/주문자명' },
      { k:'contact',  label:'연락처',    type:'text', ph:'연락처' },
      { k:'email',    label:'이메일',    type:'text', ph:'이메일' },
      { k:'amount',   label:'금액',      type:'text', ph:'예: 266,400' },
      { k:'shipdate', label:'출고일',    type:'date' },
      { k:'discount', label:'할인율',    type:'text', ph:'예: 10%' },
      { k:'content',  label:'내용',      type:'textarea', ph:'품목 및 내용' },
      { k:'address',  label:'배송주소',  type:'textarea', ph:'배송 주소' },
      { k:'memo',     label:'메모',      type:'textarea', ph:'특이사항/메모' },
    ],
    // 저장 시 고객 데이터베이스 원장(21_거래내역)에 자동 append/upsert (구분·타겟별 집계 · 00_요약 자동 최신화)
    ledger:{ tab:'21_거래내역', source:'CS',
      map:(rec)=>({ id:rec.id,
        '날짜':rec.rdate||rec.day||'', '구분':rec.gubun||'', '타겟':rec.target||'', '거래처명':rec.vendor||'',
        '담당자':rec.name||'', '연락처':rec.contact||'', '이메일':rec.email||'', '품목/내용':rec.content||'',
        '금액':String(rec.amount==null?'':rec.amount).replace(/[^\d.-]/g,''), '할인율':rec.discount||'',
        '출고일':rec.shipdate||'', '주소':rec.address||'', '메모':rec.memo||'', '소스':'CS', '등록자':rec.whoName||'' }) },
  });
})();
