/* ===========================================================================
   목업 데이터 레이어
   - 지금은 DB 없이 이 파일의 상수로 동작합니다.
   - 나중에 백엔드가 생기면 이 파일의 EMPLOYEES / DEPARTMENTS 를
     API 응답으로 바꾸기만 하면 나머지 화면은 그대로 재사용됩니다.
   =========================================================================== */

/* 직원 계정 (초안: 평문 · 실제 연동 시 서버 인증으로 교체) */
const EMPLOYEES = [
  { id: 'admin', pw: '1234', name: '관리자',   dept: 'all',    role: '시스템 관리자' },
  { id: 'cs01',  pw: '1234', name: '김상담',   dept: 'cs',     role: 'CS 매니저' },
  { id: 'md01',  pw: '1234', name: '이엠디',   dept: 'md',     role: 'MD' },
  { id: 'acct01',pw: '1234', name: '박경리',   dept: 'acct',   role: '경리' },
  { id: 'des01', pw: '1234', name: '최디자인', dept: 'design', role: '디자이너' },
];

/* 부서 정의 */
const DEPARTMENTS = [
  { key:'cs',     name:'CS',    full:'고객 상담',   icon:'🎧', cls:'c-cs',
    desc:'문의 응대 · 반품/교환 · 배송 처리' },
  { key:'md',     name:'MD',    full:'상품 기획',   icon:'🛒', cls:'c-md',
    desc:'상품 데이터 · 가격/재고 · 등록 관리' },
  { key:'acct',   name:'경리',  full:'회계/정산',   icon:'🧾', cls:'c-acct',
    desc:'매출/매입 정리 · 정산 · 집계' },
  { key:'design', name:'디자인',full:'디자인',      icon:'🎨', cls:'c-design',
    desc:'상세페이지 · 이미지/에셋 · 배너' },
];

/* 각 부서의 기능(툴) 목록
   status: 'live' = 동작, 'soon' = 자리표시(예정)
   href : live 인 경우 이동 경로 (modules/ 기준 상대경로는 각 페이지에서 처리) */
const FEATURES = {
  cs: [
    { key:'templates', name:'답변 템플릿',   icon:'💬', status:'live', href:'index.html#templates',
      desc:'자주 쓰는 CS 답변을 카테고리별로 저장하고 한 번에 복사' },
    { key:'inquiry',   name:'문의 정리표',   icon:'📋', status:'soon',
      desc:'접수 문의를 상태별로 정리하고 처리 현황을 추적' },
    { key:'return',    name:'반품/교환 체크', icon:'🔁', status:'soon',
      desc:'반품·교환 접수 시 확인 항목 체크리스트' },
  ],
  md: [
    { key:'product',   name:'상품 데이터 관리 도구', icon:'📦', status:'live', href:'product-tool.html',
      desc:'CAFE24 상품 엑셀/CSV 일괄 편집 · 코드 붙이기 · 저장 (기존 도구)' },
    { key:'stock',     name:'재고/가격 일괄정리', icon:'🏷️', status:'soon',
      desc:'재고·가격을 규칙에 따라 일괄 조정' },
    { key:'newprod',   name:'신상품 등록 양식',   icon:'🆕', status:'soon',
      desc:'등록에 필요한 항목을 채워 업로드 양식 생성' },
  ],
  acct: [
    { key:'ledger',    name:'매출·매입 집계기', icon:'📊', status:'live', href:'index.html#ledger',
      desc:'거래 내역을 입력하면 공급가·부가세·합계를 자동 계산하고 CSV로 내보내기' },
    { key:'settle',    name:'정산표 생성',      icon:'🧮', status:'soon',
      desc:'채널별 정산 내역을 표로 정리' },
    { key:'tax',       name:'세금계산서 정리',  icon:'🧾', status:'soon',
      desc:'세금계산서 발행 목록 관리' },
  ],
  design: [
    { key:'rename',    name:'파일 이름 일괄변경', icon:'🔤', status:'live', href:'index.html#rename',
      desc:'이미지 파일을 규칙(접두/접미/넘버링)에 맞춰 새 이름으로 일괄 미리보기' },
    { key:'asset',     name:'에셋 관리',        icon:'🗂️', status:'soon',
      desc:'상세페이지/배너 에셋을 태그로 정리' },
    { key:'banner',    name:'배너 문구 도우미', icon:'✍️', status:'soon',
      desc:'프로모션 배너용 문구 후보 생성' },
  ],
};

/* 공통(부가) 기능 - 부서 무관 */
const COMMON_FEATURES = [
  { key:'notice',  name:'공지사항',   icon:'📢', status:'soon', desc:'사내 공지·업데이트 안내' },
  { key:'profile', name:'내 정보',    icon:'👤', status:'soon', desc:'계정/부서 정보 확인' },
];

const DEPT_MAP = Object.fromEntries(DEPARTMENTS.map(d => [d.key, d]));
