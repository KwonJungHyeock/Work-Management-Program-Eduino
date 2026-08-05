/* ===========================================================================
   의존성 없는 ZIP 생성기 (store 방식 · 무압축)
   - 이미지(jpg/png/webp)는 이미 압축돼 있어 무압축 저장으로 충분합니다.
   - makeZip([{name, blob}]) -> Promise<Blob>
   =========================================================================== */
const CRC_TABLE = (()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320 ^ (c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c>>>8); return (c ^ 0xFFFFFFFF)>>>0; }

async function makeZip(files){
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours()&31)<<11) | ((now.getMinutes()&63)<<5) | ((now.getSeconds()/2)&31);
  const dosDate = (((now.getFullYear()-1980)&127)<<9) | (((now.getMonth()+1)&15)<<5) | (now.getDate()&31);

  const parts=[]; const central=[]; let offset=0;
  const push=(u8)=>{ parts.push(u8); offset+=u8.length; };

  for(const f of files){
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const nameB = enc.encode(f.name);
    const crc = crc32(data), size = data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true); lh.setUint16(10,dosTime,true); lh.setUint16(12,dosDate,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,size,true); lh.setUint32(22,size,true);
    lh.setUint16(26,nameB.length,true); lh.setUint16(28,0,true);
    const localOffset = offset;
    push(new Uint8Array(lh.buffer)); push(nameB); push(data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true); ch.setUint16(12,dosTime,true); ch.setUint16(14,dosDate,true);
    ch.setUint32(16,crc,true); ch.setUint32(20,size,true); ch.setUint32(24,size,true);
    ch.setUint16(28,nameB.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true); ch.setUint32(42,localOffset,true);
    central.push({ head:new Uint8Array(ch.buffer), name:nameB });
  }

  const cdStart = offset;
  central.forEach(c=>{ push(c.head); push(c.name); });
  const cdSize = offset - cdStart;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0,0x06054b50,true); eocd.setUint16(8,files.length,true); eocd.setUint16(10,files.length,true);
  eocd.setUint32(12,cdSize,true); eocd.setUint32(16,cdStart,true);
  push(new Uint8Array(eocd.buffer));

  return new Blob(parts,{type:'application/zip'});
}
function downloadBlob(blob, filename){
  const a=el('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

/* ===========================================================================
   XlsxOut — 표 데이터를 진짜 .xlsx 파일로 저장 (makeZip 재사용 · 라이브러리 없음)
   · 문자열은 sharedStrings, 숫자는 숫자셀로 기록 → 엑셀에서 바로 정렬·필터 가능
   · XlsxOut.blob(rows, sheetName) → Promise<Blob> / XlsxOut.save(rows, 파일명, 시트명)
     rows = [[셀,셀,…], …] (첫 줄을 헤더로 쓰면 됨)
   =========================================================================== */
(function(){
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
  const colName = n => { let s=''; n=Number(n)+1; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; };
  const isNum = v => typeof v==='number' ? isFinite(v)
    : (typeof v==='string' && v.trim()!=='' && /^-?\d+(\.\d+)?$/.test(v.trim()));
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const NS  = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const blobOf = t => new Blob([t],{type:'application/xml'});

  async function blob(rows, sheetName){
    rows = Array.isArray(rows) ? rows : [];
    const name = String(sheetName||'Sheet1').replace(/[\[\]:*?\/\\]/g,' ').slice(0,31) || 'Sheet1';
    const sst=[], sstIdx=new Map();
    const strId = s => { if(sstIdx.has(s)) return sstIdx.get(s); const i=sst.length; sst.push(s); sstIdx.set(s,i); return i; };
    let body='';
    rows.forEach((row,r)=>{
      const cells=(row||[]).map((v,c)=>{
        if(v==null || v==='') return '';
        const ref=colName(c)+(r+1);
        if(isNum(v)) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
        return `<c r="${ref}" t="s"><v>${strId(String(v))}</v></c>`;
      }).join('');
      body += `<row r="${r+1}">${cells}</row>`;
    });
    const sheet = `${XML}<worksheet xmlns="${NS}"><sheetData>${body}</sheetData></worksheet>`;
    const shared = `${XML}<sst xmlns="${NS}" count="${sst.length}" uniqueCount="${sst.length}">`
      + sst.map(s=>`<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') + '</sst>';
    const files = [
      { name:'[Content_Types].xml', blob: blobOf(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>') },
      { name:'_rels/.rels', blob: blobOf(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name:'xl/workbook.xml', blob: blobOf(`${XML}<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
      { name:'xl/_rels/workbook.xml.rels', blob: blobOf(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>') },
      { name:'xl/worksheets/sheet1.xml', blob: blobOf(sheet) },
      { name:'xl/sharedStrings.xml', blob: blobOf(shared) },
    ];
    const z = await makeZip(files);
    return new Blob([z], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function save(rows, filename, sheetName){ downloadBlob(await blob(rows, sheetName), filename||'export.xlsx'); }
  if(typeof window!=='undefined') window.XlsxOut = { blob, save };
})();
