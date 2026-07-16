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
    key:'cs.postpay', dept:'cs', sheet:'postpay', title:'견적/발주/후불', icon:'truck',
    desc:'견적·발주·후불 접수 건을 팀 공유로 기록·관리합니다. (구분·금액으로 진행 현황 파악 · 저장 시 고객 데이터베이스에 자동 누적)',
    dateField:'rdate', whoField:'agent',
    filterFields:[{k:'gubun',label:'구분'}],
    fields:[
      { k:'rdate',    label:'접수일자',  type:'date' },
      { k:'gubun',    label:'구분',      type:'select', options:['견적','발주','후불','결제요청','기타'], req:true },
      { k:'agent',    label:'담당자',    type:'agent',  options:['신아름','함인영'] },
      { k:'route',    label:'경로',      type:'select', options:['게시판','메일','전화','카톡','톡톡','대표님소개','업무폰','학교장터','연구비카드'] },
      { k:'custType', label:'고객유형',  type:'select', options:CS_CUSTOMER_TYPES },
      { k:'vendor',   label:'거래처명',  type:'text', ph:'학교/기관/업체명', newRow:true },  // 거래처명·이름·연락처는 둘째 줄
      { k:'name',     label:'이름',      type:'text', ph:'담당자/주문자명' },
      { k:'contact',  label:'연락처',    type:'text', ph:'연락처' },
      { k:'email',    label:'이메일',    type:'text', ph:'이메일' },
      { k:'amount',   label:'금액',      type:'text', ph:'예: 266,400' },
      { k:'content',  label:'내용',      type:'textarea', ph:'품목 및 내용' },
      { k:'memo',     label:'메모',      type:'textarea', ph:'특이사항/메모' },
    ],
    // 저장 시 고객 데이터베이스 원장(21_거래내역)에 자동 append/upsert · 고객유형→타겟 변환(00_요약 매칭)
    ledger:{ tab:'21_거래내역', source:'CS',
      map:(rec)=>({ id:rec.id,
        '날짜':rec.rdate||rec.day||'', '구분':rec.gubun||'', '타겟':custTypeToTarget(rec.custType), '거래처명':rec.vendor||'',
        '담당자':rec.name||'', '연락처':rec.contact||'', '이메일':rec.email||'', '품목/내용':rec.content||'',
        '금액':String(rec.amount==null?'':rec.amount).replace(/[^\d.-]/g,''), '할인율':'',
        '출고일':'', '주소':'', '메모':rec.memo||'', '소스':'CS', '등록자':rec.whoName||rec.agent||'' }) },
  });
})();
