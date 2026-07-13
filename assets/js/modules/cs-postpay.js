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
  });
})();
