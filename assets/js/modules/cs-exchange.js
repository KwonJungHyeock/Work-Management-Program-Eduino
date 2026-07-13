/* ===========================================================================
   CS · 교환/반품
   - 교환·반품·환불·누락·사고 접수 내역을 팀 공유로 기록 (일일 특이사항 시트 '교환/반품/누락/사고' 항목 기준)
   - 항목: 접수일자·구분·거래처명·이름·연락처·이메일·주문경로·내용·금액·출고일·처리상태·메모
   - MD 현황판과 동일한 엔진(window.buildBoard) 재사용 · 서버 시트(cs:exchange) 누적
   - 기간/구분·처리상태 필터·검색, 행 수정, CSV(관리자만)·삭제(관리자)
   =========================================================================== */
(function(){
  if(typeof window.buildBoard!=='function') return;   // md-boards.js(buildBoard) 로드 후 동작
  const CHANNELS = ['메일','게시판','카카오톡','전화','네이버톡톡','학교장터','사이트','기타'];
  window.buildBoard({
    key:'cs.exchange', dept:'cs', sheet:'exchange', title:'교환/반품', icon:'refresh',
    desc:'교환·반품·환불·누락·사고 접수 건을 팀 공유로 기록·관리합니다. 처리상태로 진행 현황을 관리하세요.',
    dateField:'rdate',
    fields:[
      { k:'rdate',   label:'접수일자',  type:'date' },
      { k:'gubun',   label:'구분',      type:'select', options:['교환','반품','환불','누락','사고','기타'], req:true },
      { k:'vendor',  label:'거래처명',  type:'text', ph:'학교/기관/업체명' },
      { k:'name',    label:'이름',      type:'text', ph:'주문자/고객명' },
      { k:'contact', label:'연락처',    type:'text', ph:'연락처' },
      { k:'email',   label:'이메일',    type:'text', ph:'이메일' },
      { k:'route',   label:'주문경로',  type:'select', options:CHANNELS },
      { k:'amount',  label:'금액',      type:'text', ph:'환불/교환 금액' },
      { k:'shipdate',label:'출고일',    type:'date' },
      { k:'status',  label:'처리상태',  type:'select', options:['접수','처리중','완료','보류'], def:'접수' },
      { k:'content', label:'내용',      type:'textarea', ph:'교환·반품 사유 및 처리 내용' },
      { k:'memo',    label:'메모',      type:'textarea', ph:'특이사항/메모' },
    ],
  });
})();
